import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {createEnvelope, PROTOCOL_VERSION, WS_PATH_DEVICE, WS_PATH_UI} from '@himmetkaan/remote-devtools-protocol';
import {type RunningServer, startServer} from '../src/server.ts';
import {connect, makeHello, newDeviceId, openUi, pairedDevice, testConfig} from './helpers.ts';

describe('relay', () => {
    let server: RunningServer;
    let port: number;

    before(async () => {
        server = await startServer(testConfig);
        port = server.port;
    });

    after(async () => {
        await server.close();
    });

    // ─── HTTP ────────────────────────────────────────────────────────────────

    it('serves /health and /discovery', async () => {
        const health = await fetch(`http://127.0.0.1:${port}/health`);
        assert.equal(health.status, 200);
        assert.equal((await health.json()).ok, true);

        const discovery = await fetch(`http://127.0.0.1:${port}/discovery`);
        assert.equal(discovery.headers.get('access-control-allow-origin'), '*');
        const body = await discovery.json();
        assert.equal(body.name, 'remote-devtools');
        assert.equal(body.protocol, PROTOCOL_VERSION);
        assert.equal(body.connectRequests, 'off');
    });

    it('rejects upgrades on unknown paths (including the v1 /ws/web path)', async () => {
        await assert.rejects(connect(port, '/ws/nope'));
        await assert.rejects(connect(port, '/ws/web'));
    });

    // ─── Envelope / authentication ───────────────────────────────────────────

    it('creates a session with a QR token and a 6-digit code', async () => {
        const {ui, session} = await openUi(port);
        assert.ok(session.sessionId);
        assert.ok(session.uiSecret);
        assert.ok(session.pairing.qrToken);
        assert.match(session.pairing.code, /^\d{6}$/);
        assert.ok(session.pairing.expiresAt > Date.now());
        assert.deepEqual(session.devices, []);
        assert.deepEqual(session.pendingRequests, []);
        assert.deepEqual(session.trustedDevices, []);
        assert.equal(session.deviceWsUrl, null);
        ui.close();
    });

    it('answers requests with replyTo on the envelope', async () => {
        const ui = await connect(port, WS_PATH_UI);
        const id = ui.send('session.create');
        assert.equal((await ui.next('session')).replyTo, id);
        ui.close();
    });

    it('requires authentication before other UI messages', async () => {
        const ui = await connect(port, WS_PATH_UI);
        const id = ui.send('pairing.refresh');
        const err = await ui.next('error');
        assert.equal(err.payload.code, 'NOT_AUTHENTICATED');
        assert.equal(err.replyTo, id);
        ui.close();
    });

    it('rejects invalid envelopes', async () => {
        const ui = await connect(port, WS_PATH_UI);
        ui.sendRaw('not json');
        assert.equal((await ui.next('error')).payload.code, 'BAD_MESSAGE');
        ui.close();
    });

    it('rejects other protocol versions and closes the socket', async () => {
        const ui = await connect(port, WS_PATH_UI);
        ui.sendRaw(JSON.stringify({...createEnvelope('session.create', {}), v: 1}));
        assert.equal((await ui.next('error')).payload.code, 'UNSUPPORTED_VERSION');
        assert.equal((await ui.closed).code, 4005);
    });

    it('returns SESSION_NOT_FOUND for a bad resume', async () => {
        const ui = await connect(port, WS_PATH_UI);
        ui.send('session.resume', {sessionId: 'nope', uiSecret: 'nope'});
        assert.equal((await ui.next('error')).payload.code, 'SESSION_NOT_FOUND');
        ui.close();
    });

    // ─── Pairing ─────────────────────────────────────────────────────────────

    it('pairs a device by QR and notifies the UI', async () => {
        const {ui, device, deviceId, deviceSecret, status} = await pairedDevice(port);
        assert.ok(deviceSecret);
        assert.equal(status.deviceId, deviceId);
        assert.equal(status.state, 'connected');
        assert.equal(status.device.connected, true);
        assert.ok(status.device.expiresAt > Date.now());
        ui.close();
        device.close();
    });

    it('rotates the QR token after use so it is single-use', async () => {
        const {ui, session} = await openUi(port);
        const first = await connect(port, WS_PATH_DEVICE);
        first.send('pair.qr', {sessionId: session.sessionId, qrToken: session.pairing.qrToken, deviceId: newDeviceId()});
        await first.next('paired');
        const fresh = (await ui.next('pairing')).payload;
        assert.notEqual(fresh.qrToken, session.pairing.qrToken);
        assert.notEqual(fresh.code, session.pairing.code);

        const second = await connect(port, WS_PATH_DEVICE);
        second.send('pair.qr', {sessionId: session.sessionId, qrToken: session.pairing.qrToken, deviceId: newDeviceId()});
        assert.equal((await second.next('error')).payload.code, 'INVALID_PAIR_TOKEN');
        assert.equal((await second.closed).code, 4001);
        ui.close();
        first.close();
    });

    it('pairs a device with the 6-digit code', async () => {
        const {ui, session} = await openUi(port);
        const device = await connect(port, WS_PATH_DEVICE);
        const deviceId = newDeviceId();
        device.send('pair.code', {code: session.pairing.code, deviceId});
        const paired = (await device.next('paired')).payload;
        assert.equal(paired.sessionId, session.sessionId);
        assert.equal((await ui.next('device.status')).payload.deviceId, deviceId);
        ui.close();
        device.close();
    });

    it('rejects a wrong code', async () => {
        const device = await connect(port, WS_PATH_DEVICE);
        device.send('pair.code', {code: 'abc', deviceId: newDeviceId()});
        assert.equal((await device.next('error')).payload.code, 'INVALID_CODE');
        assert.equal((await device.closed).code, 4001);
    });

    it('requires a valid deviceId', async () => {
        const {ui, session} = await openUi(port);
        const device = await connect(port, WS_PATH_DEVICE);
        device.send('pair.qr', {sessionId: session.sessionId, qrToken: session.pairing.qrToken, deviceId: 'x'});
        assert.equal((await device.next('error')).payload.code, 'BAD_MESSAGE');
        ui.close();
    });

    it('lets several devices join the same session', async () => {
        const first = await pairedDevice(port);
        const second = await pairedDevice(port, first);
        assert.notEqual(first.deviceId, second.deviceId);

        const ui2 = await connect(port, WS_PATH_UI);
        ui2.send('session.resume', {sessionId: first.session.sessionId, uiSecret: first.session.uiSecret});
        const snapshot = (await ui2.next('session')).payload;
        assert.deepEqual(snapshot.devices.map((d: any) => d.deviceId).sort(), [first.deviceId, second.deviceId].sort());
        first.ui.close();
        ui2.close();
        first.device.close();
        second.device.close();
    });

    // ─── Routing ─────────────────────────────────────────────────────────────

    it('forwards device messages to the UI stamped with deviceId', async () => {
        const {ui, device, deviceId} = await pairedDevice(port);

        device.send('hello', makeHello());
        const hello = await ui.next('hello');
        assert.equal(hello.deviceId, deviceId);
        assert.equal(hello.payload.app.id, 'com.example.app');

        device.send('log', {level: 'info', message: 'hi', at: Date.now()}, {deviceId: 'spoofed'});
        assert.equal((await ui.next('log')).deviceId, deviceId);

        device.send('module.custom.event', {anything: true});
        const custom = await ui.next('module.custom.event');
        assert.equal(custom.deviceId, deviceId);
        assert.deepEqual(custom.payload, {anything: true});

        ui.close();
        device.close();
    });

    it('routes UI module messages only to the targeted device', async () => {
        const a = await pairedDevice(port);
        const b = await pairedDevice(port, a);

        const id = a.ui.send('module.functions.invoke', {commandId: 'ping', args: {}}, {deviceId: b.deviceId});
        const received = await b.device.next('module.functions.invoke');
        assert.equal(received.id, id);
        await a.device.none('module.functions.invoke');

        b.device.ws.send(JSON.stringify(createEnvelope('module.functions.result', {ok: true, result: 'pong'}, {replyTo: id})));
        const result = await a.ui.next('module.functions.result');
        assert.equal(result.replyTo, id);
        assert.equal(result.deviceId, b.deviceId);

        a.ui.close();
        a.device.close();
        b.device.close();
    });

    it('validates the target of UI module messages', async () => {
        const {ui, device, deviceId} = await pairedDevice(port);

        ui.send('module.functions.invoke', {});
        assert.equal((await ui.next('error')).payload.code, 'BAD_MESSAGE');

        ui.send('module.functions.invoke', {}, {deviceId: 'unknown-device'});
        assert.equal((await ui.next('error')).payload.code, 'DEVICE_NOT_FOUND');

        device.close();
        await ui.next('device.status');
        ui.send('module.functions.invoke', {}, {deviceId});
        assert.equal((await ui.next('error')).payload.code, 'DEVICE_OFFLINE');
        ui.close();
    });

    it('does not forward core relay types from the UI', async () => {
        const {ui, device, deviceId} = await pairedDevice(port);
        ui.send('paired', {}, {deviceId});
        assert.equal((await ui.next('error')).payload.code, 'UNKNOWN_TYPE');
        await device.none('paired');
        ui.close();
        device.close();
    });

    it('rejects module messages from an unauthenticated device', async () => {
        const device = await connect(port, WS_PATH_DEVICE);
        device.send('module.network.request', {});
        assert.equal((await device.next('error')).payload.code, 'NOT_AUTHENTICATED');
        assert.equal((await device.closed).code, 4001);
    });

    // ─── Resume / replacement ────────────────────────────────────────────────

    it('lets the device resume and keeps its snapshot', async () => {
        const {ui, session, device, deviceId, deviceSecret} = await pairedDevice(port);
        device.send('hello', makeHello());
        device.send('lifecycle', {state: 'background'});
        await ui.next('hello');
        await ui.next('lifecycle');
        device.close();
        assert.equal((await ui.next('device.status')).payload.state, 'disconnected');

        const again = await connect(port, WS_PATH_DEVICE);
        again.send('resume', {sessionId: session.sessionId, deviceId, deviceSecret});
        const resumed = (await again.next('resumed')).payload;
        assert.equal(resumed.sessionId, session.sessionId);
        const status = (await ui.next('device.status')).payload;
        assert.equal(status.state, 'connected');
        assert.equal(status.device.hello.app.id, 'com.example.app');
        assert.equal(status.device.lifecycle, 'background');
        ui.close();
        again.close();
    });

    it('rejects a resume with the wrong secret', async () => {
        const {ui, session, device, deviceId} = await pairedDevice(port);
        const other = await connect(port, WS_PATH_DEVICE);
        other.send('resume', {sessionId: session.sessionId, deviceId, deviceSecret: 'wrong'});
        assert.equal((await other.next('unpaired')).payload.reason, 'invalidSecret');
        ui.close();
        device.close();
    });

    it('tells a device with an unknown session to forget its pairing', async () => {
        const device = await connect(port, WS_PATH_DEVICE);
        device.send('resume', {sessionId: 'gone', deviceId: newDeviceId(), deviceSecret: 'x'});
        assert.equal((await device.next('unpaired')).payload.reason, 'sessionNotFound');
        assert.equal((await device.closed).code, 4002);
    });

    it('replaces a stale connection of the same device on resume', async () => {
        const {ui, session, device, deviceId, deviceSecret} = await pairedDevice(port);
        const fresh = await connect(port, WS_PATH_DEVICE);
        fresh.send('resume', {sessionId: session.sessionId, deviceId, deviceSecret});
        await fresh.next('resumed');
        assert.equal((await device.closed).code, 4000);
        // Closing the old socket must not broadcast "disconnected".
        assert.equal((await ui.next('device.status')).payload.state, 'connected');
        await ui.none('device.status');
        ui.close();
        fresh.close();
    });

    it('replaces the old record when the same device pairs again', async () => {
        const first = await pairedDevice(port);
        const again = await connect(port, WS_PATH_DEVICE);
        first.ui.send('pairing.refresh');
        const pairing = (await first.ui.next('pairing')).payload;
        again.send('pair.qr', {sessionId: first.session.sessionId, qrToken: pairing.qrToken, deviceId: first.deviceId});
        const paired = (await again.next('paired')).payload;
        assert.notEqual(paired.deviceSecret, first.deviceSecret);
        assert.equal((await first.device.closed).code, 4000);

        const stale = await connect(port, WS_PATH_DEVICE);
        stale.send('resume', {sessionId: first.session.sessionId, deviceId: first.deviceId, deviceSecret: first.deviceSecret});
        assert.equal((await stale.next('unpaired')).payload.reason, 'invalidSecret');
        first.ui.close();
        again.close();
    });

    // ─── Unpairing ───────────────────────────────────────────────────────────

    it('unpairs one device from the UI and leaves the others', async () => {
        const a = await pairedDevice(port);
        const b = await pairedDevice(port, a);

        a.ui.send('device.unpair', {deviceId: a.deviceId});
        assert.equal((await a.device.next('unpaired')).payload.reason, 'byUi');
        assert.equal((await a.device.closed).code, 4002);
        const status = (await a.ui.next('device.status')).payload;
        assert.equal(status.state, 'unpaired');
        assert.equal(status.deviceId, a.deviceId);
        assert.equal(status.device, null);

        b.device.send('log', {level: 'info', message: 'still here', at: Date.now()});
        assert.equal((await a.ui.next('log')).deviceId, b.deviceId);

        a.ui.send('device.unpair', {deviceId: a.deviceId});
        assert.equal((await a.ui.next('error')).payload.code, 'DEVICE_NOT_FOUND');
        a.ui.close();
        b.device.close();
    });

    it('unpairs from the device', async () => {
        const {ui, device, deviceId} = await pairedDevice(port);
        device.send('unpair');
        assert.equal((await device.next('unpaired')).payload.reason, 'byDevice');
        const status = (await ui.next('device.status')).payload;
        assert.equal(status.state, 'unpaired');
        assert.equal(status.deviceId, deviceId);
        ui.close();
    });
});
