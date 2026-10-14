import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {WebSocket} from 'ws';
import {createEnvelope, WS_PATH_DEVICE, WS_PATH_UI} from '@himmetkaan/remote-devtools-protocol';
import {startServer} from '../src/server.ts';
import {connect, newDeviceId, openUi, pairedDevice, sleep, testConfig, withServer} from './helpers.ts';

describe('relay timing & limits', () => {
    it('rejects an expired QR token and code, and refreshes on request', async () => {
        await withServer({pairingTtlMs: 50}, async ({port}) => {
            const {ui, session} = await openUi(port);
            await sleep(80);

            const byQr = await connect(port, WS_PATH_DEVICE);
            byQr.send('pair.qr', {sessionId: session.sessionId, qrToken: session.pairing.qrToken, deviceId: newDeviceId()});
            assert.equal((await byQr.next('error')).payload.code, 'PAIR_TOKEN_EXPIRED');

            const byCode = await connect(port, WS_PATH_DEVICE);
            byCode.send('pair.code', {code: session.pairing.code, deviceId: newDeviceId()});
            assert.equal((await byCode.next('error')).payload.code, 'INVALID_CODE');

            ui.send('pairing.refresh');
            const fresh = (await ui.next('pairing')).payload;
            assert.ok(fresh.expiresAt > Date.now());
            ui.close();
        });
    });

    it('closes sockets that do not authenticate in time', async () => {
        await withServer({authTimeoutMs: 50}, async ({port}) => {
            const device = await connect(port, WS_PATH_DEVICE);
            assert.equal((await device.closed).code, 4003);
        });
    });

    it('expires sessions without a UI and tells devices to forget them', async () => {
        await withServer({sessionTtlMs: 30, gcIntervalMs: 50}, async (server) => {
            const {ui, device} = await pairedDevice(server.port);
            ui.close();
            assert.equal((await device.next('unpaired', 1000)).payload.reason, 'sessionNotFound');
            assert.equal((await device.closed).code, 4004);
            assert.equal(server.relay.store.size, 0);
        });
    });

    it('never expires a connected device, but forgets a disconnected one after the idle TTL', async () => {
        await withServer({deviceIdleTtlMs: 150, gcIntervalMs: 40}, async ({port}) => {
            const online = await pairedDevice(port);
            const offline = await pairedDevice(port, online);
            offline.device.close();
            assert.equal((await online.ui.next('device.status')).payload.state, 'disconnected');

            const gone = (await online.ui.next('device.status', 1000)).payload;
            assert.deepEqual([gone.deviceId, gone.state], [offline.deviceId, 'unpaired']);

            // A connected device stays paired well past its TTL, even when silent.
            await sleep(300);
            await online.device.none('unpaired');
            await online.ui.none('device.status');

            const late = await connect(port, WS_PATH_DEVICE);
            late.send('resume', {sessionId: offline.session.sessionId, deviceId: offline.deviceId, deviceSecret: offline.deviceSecret});
            assert.equal((await late.next('unpaired')).payload.reason, 'invalidSecret');
            online.ui.close();
            online.device.close();
        });
    });

    it('restarts the idle TTL on every reconnect', async () => {
        await withServer({deviceIdleTtlMs: 150, gcIntervalMs: 20}, async ({port}) => {
            const {ui, session, device, deviceId, deviceSecret} = await pairedDevice(port);
            device.close();
            await ui.next('device.status');

            // Total elapsed time far exceeds the TTL, but each gap between disconnects is shorter than it.
            for (let i = 0; i < 4; i++) {
                await sleep(80);
                const again = await connect(port, WS_PATH_DEVICE);
                again.send('resume', {sessionId: session.sessionId, deviceId, deviceSecret});
                const resumed = (await again.next('resumed')).payload;
                assert.ok(resumed.expiresAt > Date.now());
                await sleep(80);
                again.close();
                await ui.next('device.status');
                await ui.next('device.status');
            }
            ui.close();
        });
    });

    it('rejects resume of an expired pairing before GC runs', async () => {
        await withServer({deviceIdleTtlMs: 50}, async ({port}) => {
            const {ui, session, device, deviceId, deviceSecret} = await pairedDevice(port);
            device.close();
            await ui.next('device.status');
            await sleep(80);
            const late = await connect(port, WS_PATH_DEVICE);
            late.send('resume', {sessionId: session.sessionId, deviceId, deviceSecret});
            assert.equal((await late.next('unpaired')).payload.reason, 'expired');
            assert.equal((await ui.next('device.status')).payload.state, 'unpaired');
            ui.close();
        });
    });

    it('terminates sockets that stop answering heartbeats and reports the device offline', async () => {
        await withServer({heartbeatIntervalMs: 40}, async ({port}) => {
            const {ui, session} = await openUi(port);
            // A device that does not answer pings (e.g. suspended in the background).
            const silent = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH_DEVICE}`, {autoPong: false});
            await new Promise((r) => silent.once('open', r));
            silent.send(JSON.stringify(createEnvelope('pair.qr', {sessionId: session.sessionId, qrToken: session.pairing.qrToken, deviceId: newDeviceId()})));
            assert.equal((await ui.next('device.status')).payload.state, 'connected');
            assert.equal((await ui.next('device.status', 1000)).payload.state, 'disconnected');
            ui.close();
        });
    });

    it('enforces the session limit', async () => {
        await withServer({maxSessions: 1}, async ({port}) => {
            const {ui} = await openUi(port);
            const other = await connect(port, WS_PATH_UI);
            other.send('session.create');
            assert.equal((await other.next('error')).payload.code, 'SESSION_LIMIT');
            ui.close();
            other.close();
        });
    });

    it('enforces the per-session device limit', async () => {
        await withServer({maxDevicesPerSession: 1}, async ({port}) => {
            const first = await pairedDevice(port);
            first.ui.send('pairing.refresh');
            const pairing = (await first.ui.next('pairing')).payload;
            const second = await connect(port, WS_PATH_DEVICE);
            second.send('pair.code', {code: pairing.code, deviceId: newDeviceId()});
            assert.equal((await second.next('error')).payload.code, 'DEVICE_LIMIT');
            first.ui.close();
            first.device.close();
        });
    });

    it('rate-limits failed pairing attempts per address', async () => {
        await withServer({pairFailureLimit: 3}, async ({port}) => {
            for (let i = 0; i < 3; i++) {
                const device = await connect(port, WS_PATH_DEVICE);
                device.send('pair.code', {code: '000000', deviceId: newDeviceId()});
                assert.equal((await device.next('error')).payload.code, 'INVALID_CODE');
            }
            const {ui, session} = await openUi(port);
            const blocked = await connect(port, WS_PATH_DEVICE);
            blocked.send('pair.code', {code: session.pairing.code, deviceId: newDeviceId()});
            assert.equal((await blocked.next('error')).payload.code, 'RATE_LIMITED');
            assert.equal((await blocked.closed).code, 4006);
            ui.close();
        });
    });

    it('drops device messages above the rate limit and warns the UI once', async () => {
        await withServer({deviceMaxMessagesPerSec: 5}, async ({port}) => {
            const {ui, device, deviceId} = await pairedDevice(port);
            for (let i = 0; i < 20; i++) device.send('module.test.tick', {i});
            const received: number[] = [];
            for (let i = 0; i < 5; i++) received.push((await ui.next('module.test.tick')).payload.i);
            assert.deepEqual(received, [0, 1, 2, 3, 4]);
            const warning = await ui.next('log');
            assert.equal(warning.deviceId, deviceId);
            assert.equal(warning.payload.tag, 'relay');
            await ui.none('module.test.tick');
            await ui.none('log');
            ui.close();
            device.close();
        });
    });

    it('builds deviceWsUrl from PUBLIC_URL', async () => {
        await withServer({publicUrl: 'https://devtools.example.com'}, async ({port}) => {
            const {ui, session} = await openUi(port);
            assert.equal(session.deviceWsUrl, `wss://devtools.example.com${WS_PATH_DEVICE}`);
            ui.close();
        });
    });

    it('applies setPublicUrl to later sessions', async () => {
        await withServer({}, async (server) => {
            server.relay.setPublicUrl('http://192.168.1.20:8787/');
            const first = await openUi(server.port);
            assert.equal(first.session.deviceWsUrl, `ws://192.168.1.20:8787${WS_PATH_DEVICE}`);
            server.relay.setPublicUrl(null);
            const second = await openUi(server.port);
            assert.equal(second.session.deviceWsUrl, null);
            first.ui.close();
            second.ui.close();
        });
    });

    it('rejects when the port is already in use and releases its resources', async () => {
        await withServer({}, async (server) => {
            await assert.rejects(startServer({...testConfig, port: server.port}), {code: 'EADDRINUSE'});
        });
    });

    it('persists sessions, pairings and trusted devices to STATE_FILE across restarts', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'relay-state-'));
        const stateFile = join(dir, 'state.json');
        try {
            const first = await startServer({...testConfig, stateFile});
            const {ui, session, device, deviceId, deviceSecret} = await pairedDevice(first.port);
            ui.close();
            device.close();
            await first.close();

            assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
            assert.ok((await readFile(stateFile, 'utf8')).includes(deviceId));

            const second = await startServer({...testConfig, stateFile});
            try {
                const ui2 = await connect(second.port, WS_PATH_UI);
                ui2.send('session.resume', {sessionId: session.sessionId, uiSecret: session.uiSecret});
                const restored = (await ui2.next('session')).payload;
                assert.deepEqual(restored.devices.map((d: any) => [d.deviceId, d.connected]), [[deviceId, false]]);

                const back = await connect(second.port, WS_PATH_DEVICE);
                back.send('resume', {sessionId: session.sessionId, deviceId, deviceSecret});
                await back.next('resumed');
                ui2.close();
                back.close();
            } finally {
                await second.close();
            }
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });
});
