import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {WS_PATH_DEVICE, WS_PATH_UI} from '@himmetkaan/remote-devtools-protocol';
import {connect, makeHello, newDeviceId, openUi, withServer} from './helpers.ts';

/** A development device that sends `connect`. */
async function requestConnect(port: number, deviceId = newDeviceId(), headers: Record<string, string> = {}) {
    const device = await connect(port, WS_PATH_DEVICE, headers);
    device.send('connect', {deviceId, hello: makeHello()});
    return {device, deviceId};
}

describe('connect requests', () => {
    it('are rejected when the policy is off', async () => {
        await withServer({connectRequests: 'off'}, async ({port}) => {
            const {ui} = await openUi(port);
            const {device} = await requestConnect(port);
            assert.equal((await device.next('connect.rejected')).payload.reason, 'disabled');
            assert.equal((await device.closed).code, 4007);
            await ui.none('connect.request');
            ui.close();
        });
    });

    it('accept only local addresses with the local policy', async () => {
        await withServer({connectRequests: 'local', trustProxy: true}, async ({port}) => {
            const {ui} = await openUi(port);
            const remote = await requestConnect(port, newDeviceId(), {'X-Forwarded-For': '203.0.113.7'});
            assert.equal((await remote.device.next('connect.rejected')).payload.reason, 'disabled');

            const lan = await requestConnect(port, newDeviceId(), {'X-Forwarded-For': '192.168.1.20'});
            await lan.device.next('connect.pending');
            assert.equal((await ui.next('connect.request')).payload.via, 'local');
            ui.close();
            lan.device.close();
        });
    });

    it('are rejected when no UI is open', async () => {
        await withServer({connectRequests: 'local'}, async ({port}) => {
            const {device} = await requestConnect(port);
            assert.equal((await device.next('connect.rejected')).payload.reason, 'noSession');
        });
    });

    it('pair the device once the UI approves', async () => {
        await withServer({connectRequests: 'local'}, async ({port}) => {
            const {ui, session} = await openUi(port);
            const {device, deviceId} = await requestConnect(port);

            const pendingMsg = (await device.next('connect.pending')).payload;
            const request = (await ui.next('connect.request')).payload;
            assert.equal(request.requestId, pendingMsg.requestId);
            assert.equal(request.deviceId, deviceId);
            assert.equal(request.hello.app.id, 'com.example.app');

            ui.send('connect.respond', {requestId: request.requestId, approve: true, trust: false});
            assert.deepEqual((await ui.next('connect.resolved')).payload, {requestId: request.requestId, outcome: 'approved'});
            const paired = (await device.next('paired')).payload;
            assert.equal(paired.sessionId, session.sessionId);
            assert.equal((await ui.next('device.status')).payload.state, 'connected');
            await ui.none('trusted');

            device.send('log', {level: 'info', message: 'hi', at: Date.now()});
            assert.equal((await ui.next('log')).deviceId, deviceId);
            ui.close();
            device.close();
        });
    });

    it('are rejected when the UI declines', async () => {
        await withServer({connectRequests: 'local'}, async ({port}) => {
            const {ui} = await openUi(port);
            const {device} = await requestConnect(port);
            const request = (await ui.next('connect.request')).payload;
            ui.send('connect.respond', {requestId: request.requestId, approve: false, trust: false});
            assert.equal((await ui.next('connect.resolved')).payload.outcome, 'rejected');
            assert.equal((await device.next('connect.rejected')).payload.reason, 'rejected');
            assert.equal((await device.closed).code, 4007);
            ui.close();
        });
    });

    it('show up in the session snapshot while pending and are cancelled when the device leaves', async () => {
        await withServer({connectRequests: 'local'}, async ({port}) => {
            const {ui, session} = await openUi(port);
            const {device} = await requestConnect(port);
            const request = (await ui.next('connect.request')).payload;

            const second = await connect(port, WS_PATH_UI);
            second.send('session.resume', {sessionId: session.sessionId, uiSecret: session.uiSecret});
            const snapshot = (await second.next('session')).payload;
            assert.deepEqual(snapshot.pendingRequests.map((r: any) => r.requestId), [request.requestId]);

            device.close();
            assert.equal((await ui.next('connect.resolved')).payload.outcome, 'cancelled');
            ui.send('connect.respond', {requestId: request.requestId, approve: true, trust: false});
            assert.equal((await ui.next('error')).payload.code, 'REQUEST_NOT_FOUND');
            ui.close();
            second.close();
        });
    });

    it('expire when nobody answers', async () => {
        await withServer({connectRequests: 'local', connectRequestTtlMs: 60}, async ({port}) => {
            const {ui} = await openUi(port);
            const {device} = await requestConnect(port);
            await ui.next('connect.request');
            assert.equal((await device.next('connect.rejected', 1000)).payload.reason, 'expired');
            assert.equal((await ui.next('connect.resolved')).payload.outcome, 'expired');
            ui.close();
        });
    });

    it('keep the pending socket open past the auth timeout', async () => {
        await withServer({connectRequests: 'local', authTimeoutMs: 50}, async ({port}) => {
            const {ui} = await openUi(port);
            const {device} = await requestConnect(port);
            const request = (await ui.next('connect.request')).payload;
            await new Promise((r) => setTimeout(r, 120));
            ui.send('connect.respond', {requestId: request.requestId, approve: true, trust: false});
            await device.next('paired');
            ui.close();
            device.close();
        });
    });

    it('replace an earlier pending request from the same device', async () => {
        await withServer({connectRequests: 'local'}, async ({port}) => {
            const {ui} = await openUi(port);
            const deviceId = newDeviceId();
            const first = await requestConnect(port, deviceId);
            const firstRequest = (await ui.next('connect.request')).payload;
            const second = await requestConnect(port, deviceId);

            assert.deepEqual((await ui.next('connect.resolved')).payload, {requestId: firstRequest.requestId, outcome: 'cancelled'});
            assert.equal((await first.device.next('connect.rejected')).payload.reason, 'rejected');
            const secondRequest = (await ui.next('connect.request')).payload;
            assert.notEqual(secondRequest.requestId, firstRequest.requestId);
            ui.close();
            second.device.close();
        });
    });

    it('skip approval for trusted devices of the same app', async () => {
        await withServer({connectRequests: 'local'}, async ({port}) => {
            const {ui, session} = await openUi(port);
            const {device, deviceId} = await requestConnect(port);
            const request = (await ui.next('connect.request')).payload;
            ui.send('connect.respond', {requestId: request.requestId, approve: true, trust: true});
            await device.next('paired');
            const trusted = (await ui.next('trusted')).payload.devices;
            assert.deepEqual(
                trusted.map((t: any) => [t.deviceId, t.appId, t.name]),
                [[deviceId, 'com.example.app', 'Test iPhone']],
            );
            device.send('unpair');
            await ui.next('device.status');
            await ui.next('device.status');

            // A trusted device that lost its secret (e.g. its pairing was removed): pairs without asking for approval.
            const again = await requestConnect(port, deviceId);
            assert.equal((await again.device.next('paired')).payload.sessionId, session.sessionId);
            await ui.none('connect.request');

            // Same device id, different app: approval is still required.
            const otherApp = await connect(port, WS_PATH_DEVICE);
            otherApp.send('connect', {deviceId, hello: makeHello({app: {id: 'com.other', name: 'Other', version: '1'}})});
            await otherApp.next('connect.pending');

            ui.send('trusted.remove', {deviceId});
            assert.deepEqual((await ui.next('trusted')).payload.devices, []);
            ui.close();
            again.device.close();
            otherApp.close();
        });
    });
});
