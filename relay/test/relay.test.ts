import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {WebSocket} from 'ws';
import {createEnvelope, type Envelope, PROTOCOL_VERSION, WS_PATH_DEVICE, WS_PATH_WEB} from '../../shared/protocol.ts';
import type {RelayConfig} from '../src/config.ts';
import {startServer, type RunningServer} from '../src/server.ts';

const baseConfig: RelayConfig = {
    port: 0,
    host: '127.0.0.1',
    publicUrl: null,
    webDistDir: null,
    sessionTtlMs: 60_000,
    pairTokenTtlMs: 60_000,
    heartbeatIntervalMs: 60_000,
    authTimeoutMs: 5_000,
    maxPayloadBytes: 1024 * 1024,
    maxSessions: 100,
    gcIntervalMs: 60_000,
};

// ─── Test istemcisi ──────────────────────────────────────────────────────────

type Client = {
    ws: WebSocket;
    send(type: string, payload?: unknown): string;
    sendRaw(data: string): void;
    next(type: string, timeoutMs?: number): Promise<Envelope<string, any>>;
    closed: Promise<{code: number; reason: string}>;
    close(): void;
};

async function connect(port: number, path: string): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const inbox: Envelope<string, any>[] = [];
    const waiters: {type: string; resolve: (m: Envelope<string, any>) => void}[] = [];

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Envelope<string, any>;
        const idx = waiters.findIndex((w) => w.type === msg.type);
        if (idx >= 0) waiters.splice(idx, 1)[0]!.resolve(msg);
        else inbox.push(msg);
    });

    const closed = new Promise<{code: number; reason: string}>((resolve) => {
        ws.on('close', (code, reason) => resolve({code, reason: reason.toString()}));
    });

    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });

    return {
        ws,
        send(type, payload = {}) {
            const env = createEnvelope(type, payload);
            ws.send(JSON.stringify(env));
            return env.id;
        },
        sendRaw: (data) => ws.send(data),
        next(type, timeoutMs = 2000) {
            const idx = inbox.findIndex((m) => m.type === type);
            if (idx >= 0) return Promise.resolve(inbox.splice(idx, 1)[0]!);
            return new Promise((resolve, reject) => {
                const waiter = {type, resolve: (m: Envelope<string, any>) => {
                    clearTimeout(timer);
                    resolve(m);
                }};
                const timer = setTimeout(() => {
                    waiters.splice(waiters.indexOf(waiter), 1);
                    reject(new Error(`Timed out waiting for "${type}". Inbox: ${inbox.map((m) => m.type).join(', ')}`));
                }, timeoutMs);
                waiters.push(waiter);
            });
        },
        closed,
        close: () => ws.close(),
    };
}

/** Yeni oturum açan web + o oturuma eşlenmiş cihaz. */
async function pairedPair(port: number) {
    const web = await connect(port, WS_PATH_WEB);
    web.send('createSession');
    const session = (await web.next('session')).payload;

    const device = await connect(port, WS_PATH_DEVICE);
    device.send('pair', {sessionId: session.sessionId, pairToken: session.pairToken});
    const paired = (await device.next('paired')).payload;
    await web.next('deviceStatus');

    return {web, device, session, deviceSecret: paired.deviceSecret as string};
}

// ─── Testler ─────────────────────────────────────────────────────────────────

describe('relay', () => {
    let server: RunningServer;
    let port: number;

    before(async () => {
        server = await startServer(baseConfig);
        port = server.port;
    });

    after(async () => {
        await server.close();
    });

    it('serves /health', async () => {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
    });

    it('rejects upgrades on unknown paths', async () => {
        await assert.rejects(connect(port, '/ws/nope'));
    });

    it('creates a session with a pair token', async () => {
        const web = await connect(port, WS_PATH_WEB);
        web.send('createSession');
        const {payload} = await web.next('session');
        assert.ok(payload.sessionId);
        assert.ok(payload.webSecret);
        assert.ok(payload.pairToken);
        assert.ok(payload.pairTokenExpiresAt > Date.now());
        assert.equal(payload.device, null);
        assert.equal(payload.deviceWsUrl, null);
        web.close();
    });

    it('requires authentication before other web messages', async () => {
        const web = await connect(port, WS_PATH_WEB);
        const id = web.send('sync');
        const err = await web.next('error');
        assert.equal(err.payload.code, 'NOT_AUTHENTICATED');
        assert.equal(err.payload.replyTo, id);
        web.close();
    });

    it('rejects invalid envelopes and other protocol versions', async () => {
        const web = await connect(port, WS_PATH_WEB);
        web.sendRaw('not json');
        assert.equal((await web.next('error')).payload.code, 'BAD_MESSAGE');
        web.sendRaw(JSON.stringify({...createEnvelope('createSession', {}), v: PROTOCOL_VERSION + 1}));
        assert.equal((await web.next('error')).payload.code, 'UNSUPPORTED_VERSION');
        web.close();
    });

    it('returns SESSION_NOT_FOUND for a bad resume', async () => {
        const web = await connect(port, WS_PATH_WEB);
        web.send('resumeSession', {sessionId: 'nope', webSecret: 'nope'});
        assert.equal((await web.next('error')).payload.code, 'SESSION_NOT_FOUND');
        web.close();
    });

    it('pairs a device and notifies the web', async () => {
        const web = await connect(port, WS_PATH_WEB);
        web.send('createSession');
        const session = (await web.next('session')).payload;

        const device = await connect(port, WS_PATH_DEVICE);
        device.send('pair', {sessionId: session.sessionId, pairToken: session.pairToken});
        const paired = await device.next('paired');
        assert.equal(paired.payload.sessionId, session.sessionId);
        assert.ok(paired.payload.deviceSecret);

        const status = await web.next('deviceStatus');
        assert.equal(status.payload.state, 'connected');
        assert.equal(status.payload.device.connected, true);

        web.close();
        device.close();
    });

    it('rejects a wrong pair token and closes the device socket', async () => {
        const web = await connect(port, WS_PATH_WEB);
        web.send('createSession');
        const session = (await web.next('session')).payload;

        const device = await connect(port, WS_PATH_DEVICE);
        device.send('pair', {sessionId: session.sessionId, pairToken: 'wrong'});
        assert.equal((await device.next('error')).payload.code, 'INVALID_PAIR_TOKEN');
        assert.equal((await device.closed).code, 4001);
        web.close();
    });

    it('allows only one device per session (pair token is single-use)', async () => {
        const {web, device, session} = await pairedPair(port);

        const second = await connect(port, WS_PATH_DEVICE);
        second.send('pair', {sessionId: session.sessionId, pairToken: session.pairToken});
        assert.equal((await second.next('error')).payload.code, 'DEVICE_ALREADY_PAIRED');

        web.send('refreshPairToken');
        assert.equal((await web.next('error')).payload.code, 'DEVICE_ALREADY_PAIRED');

        web.close();
        device.close();
    });

    it('forwards device → web and web → device messages', async () => {
        const {web, device} = await pairedPair(port);

        device.send('hello', {platform: 'ios', commands: ['tryBoost']});
        assert.equal((await web.next('hello')).payload.platform, 'ios');

        device.send('request', {uuid: 'u1', method: 'get', url: '/x'});
        assert.equal((await web.next('request')).payload.uuid, 'u1');

        const invokeId = web.send('invoke', {commandId: 'tryBoost', args: null});
        const invoke = await device.next('invoke');
        assert.equal(invoke.id, invokeId);
        assert.equal(invoke.payload.commandId, 'tryBoost');

        device.send('invokeResult', {replyTo: invokeId, commandId: 'tryBoost', ok: true, error: null});
        assert.equal((await web.next('invokeResult')).payload.replyTo, invokeId);

        web.send('sync');
        await device.next('sync');

        device.send('createSession');
        assert.equal((await device.next('error')).payload.code, 'UNKNOWN_TYPE');

        web.close();
        device.close();
    });

    it('reports DEVICE_OFFLINE when forwarding without a device', async () => {
        const web = await connect(port, WS_PATH_WEB);
        web.send('createSession');
        await web.next('session');
        const id = web.send('sync');
        const err = await web.next('error');
        assert.equal(err.payload.code, 'DEVICE_OFFLINE');
        assert.equal(err.payload.replyTo, id);
        web.close();
    });

    it('lets the device resume after disconnecting and keeps its snapshot', async () => {
        const {web, device, session, deviceSecret} = await pairedPair(port);
        device.send('hello', {platform: 'android', commands: []});
        await web.next('hello');
        device.send('lifecycle', {state: 'background'});
        await web.next('lifecycle');

        device.close();
        const down = await web.next('deviceStatus');
        assert.equal(down.payload.state, 'disconnected');
        assert.equal(down.payload.device.connected, false);
        assert.equal(down.payload.device.lifecycle, 'background');

        const again = await connect(port, WS_PATH_DEVICE);
        again.send('resume', {sessionId: session.sessionId, deviceSecret});
        assert.equal((await again.next('resumed')).payload.sessionId, session.sessionId);
        const up = await web.next('deviceStatus');
        assert.equal(up.payload.state, 'connected');
        assert.equal(up.payload.device.info.platform, 'android');

        web.close();
        again.close();
    });

    it('replaces a stale device connection on resume', async () => {
        const {web, device, session, deviceSecret} = await pairedPair(port);

        const again = await connect(port, WS_PATH_DEVICE);
        again.send('resume', {sessionId: session.sessionId, deviceSecret});
        await again.next('resumed');
        assert.equal((await device.closed).code, 4000);

        // Eski soketin kapanması "disconnected" yayınlamamalı; yeni bağlantı "connected" yayınlar.
        assert.equal((await web.next('deviceStatus')).payload.state, 'connected');
        again.send('log', {level: 'info', message: 'still here', data: null});
        assert.equal((await web.next('log')).payload.message, 'still here');

        web.close();
        again.close();
    });

    it('shares a session between tabs of the same browser', async () => {
        const {web, device, session} = await pairedPair(port);

        const tab2 = await connect(port, WS_PATH_WEB);
        tab2.send('resumeSession', {sessionId: session.sessionId, webSecret: session.webSecret});
        const resumed = (await tab2.next('session')).payload;
        assert.equal(resumed.device.connected, true);
        assert.equal(resumed.pairToken, null);

        device.send('lifecycle', {state: 'active'});
        await web.next('lifecycle');
        await tab2.next('lifecycle');

        web.close();
        tab2.close();
        device.close();
    });

    it('unpairs from the web: device is told, web gets a fresh pair token', async () => {
        const {web, device, session, deviceSecret} = await pairedPair(port);

        web.send('unpair');
        assert.equal((await device.next('unpaired')).payload.reason, 'unpairedByWeb');
        assert.equal((await device.closed).code, 4002);

        assert.equal((await web.next('deviceStatus')).payload.state, 'unpaired');
        const fresh = (await web.next('pairToken')).payload;
        assert.notEqual(fresh.pairToken, session.pairToken);

        const stale = await connect(port, WS_PATH_DEVICE);
        stale.send('resume', {sessionId: session.sessionId, deviceSecret});
        assert.equal((await stale.next('unpaired')).payload.reason, 'invalidSecret');

        const next = await connect(port, WS_PATH_DEVICE);
        next.send('pair', {sessionId: session.sessionId, pairToken: fresh.pairToken});
        await next.next('paired');

        web.close();
        next.close();
    });

    it('unpairs from the device', async () => {
        const {web, device} = await pairedPair(port);
        device.send('unpair');
        assert.equal((await device.next('unpaired')).payload.reason, 'unpairedByDevice');
        assert.equal((await web.next('deviceStatus')).payload.state, 'unpaired');
        await web.next('pairToken');
        web.close();
    });

    it('tells an unknown session device to forget its pairing', async () => {
        const device = await connect(port, WS_PATH_DEVICE);
        device.send('resume', {sessionId: 'gone', deviceSecret: 'x'});
        assert.equal((await device.next('unpaired')).payload.reason, 'sessionNotFound');
    });
});

describe('relay timing', () => {
    it('rejects an expired pair token and refreshes on request', async () => {
        const server = await startServer({...baseConfig, pairTokenTtlMs: 50});
        try {
            const web = await connect(server.port, WS_PATH_WEB);
            web.send('createSession');
            const session = (await web.next('session')).payload;
            await new Promise((r) => setTimeout(r, 80));

            const device = await connect(server.port, WS_PATH_DEVICE);
            device.send('pair', {sessionId: session.sessionId, pairToken: session.pairToken});
            assert.equal((await device.next('error')).payload.code, 'PAIR_TOKEN_EXPIRED');

            web.send('refreshPairToken');
            const fresh = (await web.next('pairToken')).payload;
            assert.ok(fresh.expiresAt > Date.now());
            web.close();
        } finally {
            await server.close();
        }
    });

    it('closes sockets that do not authenticate in time', async () => {
        const server = await startServer({...baseConfig, authTimeoutMs: 50});
        try {
            const device = await connect(server.port, WS_PATH_DEVICE);
            assert.equal((await device.closed).code, 4003);
        } finally {
            await server.close();
        }
    });

    it('expires sessions without a web tab and unpairs the device', async () => {
        const server = await startServer({...baseConfig, sessionTtlMs: 30, gcIntervalMs: 50});
        try {
            const {web, device} = await pairedPair(server.port);
            web.close();
            assert.equal((await device.next('unpaired', 1000)).payload.reason, 'sessionExpired');
            assert.equal((await device.closed).code, 4004);
            assert.equal(server.relay.store.size, 0);
        } finally {
            await server.close();
        }
    });

    it('terminates sockets that stop answering heartbeats and reports the device offline', async () => {
        const server = await startServer({...baseConfig, heartbeatIntervalMs: 40});
        try {
            const web = await connect(server.port, WS_PATH_WEB);
            web.send('createSession');
            const session = (await web.next('session')).payload;

            // Pong'a cevap vermeyen (ör. arka planda askıya alınmış) cihaz.
            const silent = new WebSocket(`ws://127.0.0.1:${server.port}${WS_PATH_DEVICE}`, {autoPong: false});
            await new Promise((r) => silent.once('open', r));
            silent.send(JSON.stringify(createEnvelope('pair', {sessionId: session.sessionId, pairToken: session.pairToken})));
            assert.equal((await web.next('deviceStatus')).payload.state, 'connected');

            const down = await web.next('deviceStatus', 1000);
            assert.equal(down.payload.state, 'disconnected');
            web.close();
        } finally {
            await server.close();
        }
    });

    it('enforces the session limit', async () => {
        const server = await startServer({...baseConfig, maxSessions: 1});
        try {
            const a = await connect(server.port, WS_PATH_WEB);
            a.send('createSession');
            await a.next('session');
            const b = await connect(server.port, WS_PATH_WEB);
            b.send('createSession');
            assert.equal((await b.next('error')).payload.code, 'SESSION_LIMIT');
            a.close();
            b.close();
        } finally {
            await server.close();
        }
    });

    it('builds deviceWsUrl from PUBLIC_URL', async () => {
        const server = await startServer({...baseConfig, publicUrl: 'https://devtools.example.com'});
        try {
            const web = await connect(server.port, WS_PATH_WEB);
            web.send('createSession');
            assert.equal((await web.next('session')).payload.deviceWsUrl, `wss://devtools.example.com${WS_PATH_DEVICE}`);
            web.close();
        } finally {
            await server.close();
        }
    });
});
