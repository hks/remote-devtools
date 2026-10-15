import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {createRelay} from '@himmetkaan/remote-devtools-relay';
import {defineModule, type LifecycleSource, localhostDiscovery, ModuleError, memoryStorage, RemoteDevTools} from '../src/index.ts';
import {createClient, openUi, relayUrl, sleep, waitForStatus, withRelay} from './helpers.ts';

describe('disabled SDK', () => {
    it('does nothing: no socket, no module setup, no-op APIs', async () => {
        let setupCalled = false;
        const client = createClient({
            enabled: false,
            WebSocket: class {
                constructor() {
                    throw new Error('must not open a socket');
                }
            } as never,
            modules: [defineModule({name: 'probe', setup: () => void (setupCalled = true)})],
        });
        client.log.info('ignored');
        await client.connection.pairWithCode('123456', 'ws://localhost');
        assert.equal(client.connection.state.status, 'disabled');
        assert.equal(setupCalled, false);
        client.destroy();
    });
});

describe('pairing & connection', () => {
    it('pairs with a code, then sends hello (with capabilities) and lifecycle', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const storage = memoryStorage();
            const client = createClient({
                storage,
                meta: {userId: '42'},
                modules: [defineModule({name: 'demo', capabilities: () => ({answer: 42})})],
            });
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await waitForStatus(client, 'connected');

            const status = (await ui.next('device.status')).payload;
            assert.equal(status.state, 'connected');
            const hello = await ui.next('hello');
            assert.equal(hello.deviceId, client.connection.state.deviceId);
            assert.deepEqual(hello.payload.app, {id: 'com.example.test', name: 'Test App', version: '1.2.3'});
            assert.equal(hello.payload.device.name, 'Test Device');
            assert.deepEqual(hello.payload.meta, {userId: '42'});
            assert.deepEqual(hello.payload.capabilities, {demo: {answer: 42}});
            assert.equal(hello.payload.sdk.name, '@himmetkaan/remote-devtools');
            assert.equal((await ui.next('lifecycle')).payload.state, 'active');

            const saved = JSON.parse((await storage.getItem('remote-devtools:pairing'))!);
            assert.equal(saved.sessionId, ui.session.sessionId);
            assert.ok(saved.idleTtlMs > 0);
            client.destroy();
            ui.close();
        });
    });

    it('pairs with a QR code', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const client = createClient();
            const qr = JSON.stringify({
                v: 2,
                url: `${relayUrl(port)}/ws/device`,
                sessionId: ui.session.sessionId,
                qrToken: ui.session.pairing.qrToken,
            });
            await client.connection.pairWithQr(qr);
            await waitForStatus(client, 'connected');
            await assert.rejects(client.connection.pairWithQr('{"v":1}'), /QR/);
            client.destroy();
            ui.close();
        });
    });

    it('reports a failed pairing attempt and stays idle', async () => {
        await withRelay({}, async ({port}) => {
            const client = createClient();
            await client.connection.pairWithCode('000000', relayUrl(port));
            await waitForStatus(client, 'idle');
            assert.equal(client.connection.state.error?.code, 'INVALID_CODE');
            await assert.rejects(client.connection.pairWithCode('12', relayUrl(port)), /6 digits/);
            client.destroy();
        });
    });

    it('resumes the stored pairing after an app restart', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const storage = memoryStorage();
            const first = createClient({storage});
            await first.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await waitForStatus(first, 'connected');
            const deviceId = first.connection.state.deviceId;
            first.destroy();
            assert.equal((await ui.next('device.status')).payload.state, 'connected');
            assert.equal((await ui.next('device.status')).payload.state, 'disconnected');

            const second = createClient({storage});
            await waitForStatus(second, 'connected');
            assert.equal(second.connection.state.deviceId, deviceId);
            const status = (await ui.next('device.status')).payload;
            assert.deepEqual([status.deviceId, status.state], [deviceId, 'connected']);
            second.destroy();
            ui.close();
        });
    });

    it('forgets a stored pairing that is past its idle TTL without contacting the relay', async () => {
        const storage = memoryStorage();
        await storage.setItem('remote-devtools:device-id', 'a'.repeat(32));
        await storage.setItem(
            'remote-devtools:pairing',
            JSON.stringify({
                relayUrl: 'ws://127.0.0.1:1/ws/device',
                sessionId: 's',
                deviceSecret: 'x',
                idleTtlMs: 1000,
                lastActiveAt: Date.now() - 5000,
            }),
        );
        const client = createClient({
            storage,
            WebSocket: class {
                constructor() {
                    throw new Error('must not open a socket');
                }
            } as never,
        });
        await new Promise<void>((resolve) => client.connection.subscribe((state) => state.deviceId && resolve()));
        assert.equal(client.connection.state.status, 'idle');
        assert.equal(await storage.getItem('remote-devtools:pairing'), null);
        client.destroy();
    });

    it('forgets the pairing when the UI unpairs the device', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const storage = memoryStorage();
            const client = createClient({storage});
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await waitForStatus(client, 'connected');
            ui.send('device.unpair', {deviceId: client.connection.state.deviceId});
            await waitForStatus(client, 'idle');
            assert.equal(client.connection.state.error?.code, 'UNPAIRED');
            assert.equal(await storage.getItem('remote-devtools:pairing'), null);
            client.destroy();
            ui.close();
        });
    });

    it('unpairs from the device', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const storage = memoryStorage();
            const client = createClient({storage});
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await waitForStatus(client, 'connected');
            client.connection.unpair();
            assert.equal(client.connection.state.status, 'idle');
            assert.equal(await storage.getItem('remote-devtools:pairing'), null);
            await ui.next('device.status');
            assert.equal((await ui.next('device.status')).payload.state, 'unpaired');
            client.destroy();
            ui.close();
        });
    });

    it('reconnects after the relay restarts and keeps the pairing', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sdk-relay-'));
        const stateFile = join(dir, 'state.json');
        try {
            const first = await createRelay({port: 0, host: '127.0.0.1', stateFile});
            const port = first.port;
            const ui = await openUi(port);
            const client = createClient();
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await waitForStatus(client, 'connected');
            ui.close();
            await first.close();
            await waitForStatus(client, 'reconnecting');

            const second = await createRelay({port, host: '127.0.0.1', stateFile});
            try {
                await waitForStatus(client, 'connected', 5000);
                const ui2 = await openUi(port, {sessionId: ui.session.sessionId, uiSecret: ui.session.uiSecret});
                assert.deepEqual(
                    ui2.session.devices.map((d: any) => d.connected),
                    [true],
                );
                ui2.close();
            } finally {
                client.destroy();
                await second.close();
            }
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });

    it('disconnect() keeps the pairing and connect() resumes it', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const client = createClient();
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await waitForStatus(client, 'connected');
            client.connection.disconnect();
            assert.equal(client.connection.state.status, 'idle');
            client.connection.connect();
            await waitForStatus(client, 'connected');
            client.destroy();
            ui.close();
        });
    });
});

describe('development discovery', () => {
    const devOptions = (port: number) => ({
        isDevelopment: true,
        discovery: {localhost: {port, hosts: ['127.0.0.1']}, intervalMs: 50},
    });

    it('finds the local relay, waits for approval and connects', async () => {
        await withRelay({connectRequests: 'local'}, async ({port}) => {
            const ui = await openUi(port);
            const seen: string[] = [];
            const client = createClient(devOptions(port));
            client.connection.subscribe((s) => seen.push(s.status));

            const request = (await ui.next('connect.request')).payload;
            assert.equal(request.hello.app.id, 'com.example.test');
            await waitForStatus(client, 'pending-approval');
            ui.send('connect.respond', {requestId: request.requestId, approve: true, trust: false});
            await waitForStatus(client, 'connected');
            assert.deepEqual([...new Set(seen)], ['idle', 'discovering', 'connecting', 'pending-approval', 'connected']);
            client.destroy();
            ui.close();
        });
    });

    it('keeps looking until a UI is opened', async () => {
        await withRelay({connectRequests: 'local'}, async ({port}) => {
            const client = createClient(devOptions(port));
            await sleep(150);
            assert.equal(client.connection.state.status, 'discovering');
            const ui = await openUi(port);
            const request = (await ui.next('connect.request')).payload;
            ui.send('connect.respond', {requestId: request.requestId, approve: true, trust: false});
            await waitForStatus(client, 'connected');
            client.destroy();
            ui.close();
        });
    });

    it('stops after a rejection until discover() is called again', async () => {
        await withRelay({connectRequests: 'local'}, async ({port}) => {
            const ui = await openUi(port);
            const client = createClient(devOptions(port));
            const request = (await ui.next('connect.request')).payload;
            ui.send('connect.respond', {requestId: request.requestId, approve: false, trust: false});
            await waitForStatus(client, 'idle');
            assert.equal(client.connection.state.error?.code, 'CONNECT_REJECTED');
            await ui.none('connect.request', 200);

            void client.connection.discover();
            const again = (await ui.next('connect.request')).payload;
            ui.send('connect.respond', {requestId: again.requestId, approve: true, trust: false});
            await waitForStatus(client, 'connected');
            client.destroy();
            ui.close();
        });
    });

    it('probes several ports and returns only live relays', async () => {
        await withRelay({connectRequests: 'local'}, async ({port}) => {
            const found = await localhostDiscovery({port: [1, port], hosts: ['127.0.0.1']}).find(new AbortController().signal);
            assert.deepEqual(found, [`ws://127.0.0.1:${port}/ws/device`]);
        });
    });

    it('does not discover relays that refuse connect requests', async () => {
        await withRelay({connectRequests: 'off'}, async ({port}) => {
            const found = await localhostDiscovery({port, hosts: ['127.0.0.1']}).find(new AbortController().signal);
            assert.deepEqual(found, []);
        });
    });
});

describe('logs, history and modules', () => {
    it('sends logs with serialized data and tags', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const client = createClient();
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await waitForStatus(client, 'connected');

            const cyclic: Record<string, unknown> = {name: 'loop'};
            cyclic.self = cyclic;
            client.log.error('boom', {err: new TypeError('bad'), cyclic, big: 10n}, {tag: 'auth'});
            const log = (await ui.next('log')).payload;
            assert.equal(log.level, 'error');
            assert.equal(log.message, 'boom');
            assert.equal(log.tag, 'auth');
            assert.equal(log.data.err.name, 'TypeError');
            assert.equal(log.data.err.message, 'bad');
            assert.equal(log.data.cyclic.self, '[Circular]');
            assert.equal(log.data.big, '10n');
            client.destroy();
            ui.close();
        });
    });

    it('drops pre-connection logs unless history is enabled', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const client = createClient();
            client.log.info('lost');
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await waitForStatus(client, 'connected');
            await ui.none('history');
            await ui.none('log');
            client.destroy();
            ui.close();
        });
    });

    it('buffers pre-connection messages in order and sends them after hello', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            let emit: (n: number) => void = () => {};
            const client = createClient({
                history: {enabled: true, maxEntries: 3},
                modules: [defineModule({name: 'tick', setup: (ctx) => void (emit = (n) => ctx.emit('module.tick.event', {n}))})],
            });
            client.log.info('one');
            emit(2);
            client.log.info('three');
            client.log.info('four');
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await ui.next('hello');
            const history = (await ui.next('history')).payload;
            assert.equal(history.final, true);
            assert.deepEqual(
                history.entries.map((e: any) => [e.type, e.payload.message ?? e.payload.n]),
                [
                    ['module.tick.event', 2],
                    ['log', 'three'],
                    ['log', 'four'],
                ],
            );

            client.log.info('live');
            assert.equal((await ui.next('log')).payload.message, 'live');
            client.destroy();
            ui.close();
        });
    });

    it('answers UI requests through module handlers', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const client = createClient({
                modules: [
                    defineModule({
                        name: 'calc',
                        setup(ctx) {
                            ctx.handle<{a: number; b: number}>('module.calc.add', ({a, b}) => a + b);
                            ctx.handle('module.calc.fail', async () => {
                                throw new ModuleError('NOPE', 'not allowed');
                            });
                            assert.throws(() => ctx.emit('module.other.x', {}), /module\.calc\./);
                        },
                    }),
                ],
            });
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await waitForStatus(client, 'connected');
            const deviceId = client.connection.state.deviceId!;

            const id = ui.send('module.calc.add', {a: 2, b: 3}, {deviceId});
            const ok = await ui.next('module.calc.result');
            assert.equal(ok.replyTo, id);
            assert.deepEqual(ok.payload, {ok: true, result: 5});

            ui.send('module.calc.fail', {}, {deviceId});
            assert.deepEqual((await ui.next('module.calc.result')).payload, {ok: false, error: {code: 'NOPE', message: 'not allowed'}});
            client.destroy();
            ui.close();
        });
    });

    it('sends capabilities.update when a module changes', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const items: string[] = [];
            let update = () => {};
            const client = createClient({
                modules: [
                    defineModule({
                        name: 'list',
                        capabilities: () => ({items: [...items]}),
                        setup: (ctx) => void (update = ctx.updateCapabilities),
                    }),
                ],
            });
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            assert.deepEqual((await ui.next('hello')).payload.capabilities.list, {items: []});
            items.push('a');
            update();
            assert.deepEqual((await ui.next('capabilities.update')).payload, {list: {items: ['a']}});
            client.destroy();
            ui.close();
        });
    });

    it('forwards lifecycle changes', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            let notify: (s: 'active' | 'background') => void = () => {};
            const lifecycle: LifecycleSource = {current: () => 'active', subscribe: (l) => ((notify = l), () => {})};
            const client = createClient({lifecycle});
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await ui.next('lifecycle');
            notify('background');
            assert.equal((await ui.next('lifecycle')).payload.state, 'background');
            client.destroy();
            ui.close();
        });
    });

    it('captures console output when asked and restores it on destroy', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const real = console.warn;
            const printed: unknown[][] = [];
            const stub = (...args: unknown[]) => void printed.push(args);
            console.warn = stub;
            try {
                const client = createClient({captureConsole: ['warn']});
                await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
                await waitForStatus(client, 'connected');
                console.warn('careful', {a: 1});
                assert.deepEqual(printed, [['careful', {a: 1}]]);
                const log = (await ui.next('log')).payload;
                assert.deepEqual([log.level, log.message, log.tag, log.data], ['warn', 'careful', 'console', {a: 1}]);
                client.destroy();
                assert.equal(console.warn, stub);
            } finally {
                console.warn = real;
            }
            ui.close();
        });
    });

    it('init() keeps a single instance', () => {
        const a = RemoteDevTools.init({enabled: false, app: {id: 'a', name: 'a', version: '1'}});
        assert.equal(RemoteDevTools.instance, a);
        const b = RemoteDevTools.init({enabled: false, app: {id: 'b', name: 'b', version: '1'}});
        assert.equal(RemoteDevTools.instance, b);
        b.destroy();
        assert.equal(RemoteDevTools.instance, null);
    });
});
