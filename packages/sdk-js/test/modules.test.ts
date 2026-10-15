import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {after, before, describe, it} from 'node:test';
import {functionsModule, networkModule, validateArgs} from '../src/index.ts';
import {createClient, openUi, relayUrl, sleep, waitForStatus, withPairedClient, withRelay} from './helpers.ts';

describe('validateArgs', () => {
    const fields = {
        name: {type: 'text', required: true},
        count: {type: 'number', min: 1, max: 5, default: 1},
        loud: {type: 'boolean'},
        mode: {type: 'select', options: ['a', {label: 'B', value: 2}]},
        extra: {type: 'json'},
    } as const;

    it('applies defaults and drops unknown keys', () => {
        assert.deepEqual(validateArgs(fields, {name: 'x', unknown: 1}), {ok: true, args: {name: 'x', count: 1, loud: false}});
    });

    it('reports every invalid field', () => {
        const result = validateArgs(fields, {count: 9, loud: 'yes', mode: 'c'});
        assert.equal(result.ok, false);
        assert.deepEqual(Object.keys((result as {errors: object}).errors).sort(), ['count', 'loud', 'mode', 'name']);
    });

    it('accepts numeric select values and any JSON', () => {
        assert.deepEqual(validateArgs(fields, {name: 'x', mode: 2, extra: [1, {a: true}]}).ok, true);
    });
});

describe('functionsModule', () => {
    it('lists registered functions (without handlers) in hello and runs them', async () => {
        const functions = functionsModule();
        functions.register({
            id: 'add',
            title: 'Add',
            group: 'Math',
            args: {a: {type: 'number', required: true}, b: {type: 'number', default: 10}},
            handler: ({a, b}) => a + b,
        });
        await withPairedClient([functions], async (ui, deviceId) => {
            ui.send('module.functions.invoke', {commandId: 'add', args: {a: 2}}, {deviceId});
            assert.deepEqual((await ui.next('module.functions.result')).payload, {ok: true, result: 12});

            ui.send('module.functions.invoke', {commandId: 'add', args: {}}, {deviceId});
            const invalid = (await ui.next('module.functions.result')).payload;
            assert.equal(invalid.error.code, 'INVALID_ARGS');
            assert.match(invalid.error.message, /a is required/);

            ui.send('module.functions.invoke', {commandId: 'nope', args: {}}, {deviceId});
            assert.equal((await ui.next('module.functions.result')).payload.error.code, 'UNKNOWN_COMMAND');
        });
    });

    it('reports handler errors and async results', async () => {
        const functions = functionsModule();
        functions.register({id: 'slow', title: 'Slow', handler: async () => (await sleep(20), 'done')});
        functions.register({
            id: 'boom',
            title: 'Boom',
            handler: () => {
                throw new Error('kaboom');
            },
        });
        await withPairedClient([functions], async (ui, deviceId) => {
            ui.send('module.functions.invoke', {commandId: 'slow', args: {}}, {deviceId});
            assert.deepEqual((await ui.next('module.functions.result')).payload, {ok: true, result: 'done'});
            ui.send('module.functions.invoke', {commandId: 'boom', args: {}}, {deviceId});
            assert.deepEqual((await ui.next('module.functions.result')).payload, {
                ok: false,
                error: {code: 'HANDLER_ERROR', message: 'kaboom'},
            });
        });
    });

    it('updates the UI when functions are added or removed while connected', async () => {
        const functions = functionsModule();
        await withPairedClient([functions], async (ui) => {
            const unregister = functions.register({id: 'later', title: 'Later', handler: () => 1});
            assert.deepEqual(
                (await ui.next('capabilities.update')).payload.functions.commands.map((c: any) => c.id),
                ['later'],
            );
            assert.equal('handler' in (await Promise.resolve(functions.capabilities!() as any)).commands[0], false);
            unregister();
            assert.deepEqual((await ui.next('capabilities.update')).payload.functions.commands, []);
        });
    });
});

describe('networkModule', () => {
    let server: Server;
    let base: string;

    before(async () => {
        server = createServer((req, res) => {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
                if (req.url === '/json') {
                    res.writeHead(200, {'content-type': 'application/json', 'x-test': 'yes'});
                    res.end(JSON.stringify({hello: 'world', echo: body ? JSON.parse(body) : null}));
                } else if (req.url === '/big') {
                    res.writeHead(200, {'content-type': 'text/plain'});
                    res.end('x'.repeat(5000));
                } else {
                    res.writeHead(404, {'content-type': 'text/plain'});
                    res.end('not found');
                }
            });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    after(() => new Promise<void>((r) => server.close(() => r())));

    it('captures fetch requests and responses without disturbing the app', async () => {
        const original = globalThis.fetch;
        await withPairedClient([networkModule()], async (ui, deviceId) => {
            assert.notEqual(globalThis.fetch, original);
            const res = await fetch(`${base}/json`, {
                method: 'POST',
                headers: {'content-type': 'application/json', 'x-token': 'abc'},
                body: JSON.stringify({n: 1}),
            });
            assert.deepEqual(await res.json(), {hello: 'world', echo: {n: 1}});

            const request = await ui.next('module.network.request');
            assert.equal(request.deviceId, deviceId);
            assert.equal(request.payload.method, 'POST');
            assert.equal(request.payload.url, `${base}/json`);
            assert.equal(request.payload.headers['x-token'], 'abc');
            assert.deepEqual(request.payload.body, {n: 1});

            const response = (await ui.next('module.network.response')).payload;
            assert.equal(response.uuid, request.payload.uuid);
            assert.equal(response.status, 200);
            assert.equal(response.result, 'success');
            assert.equal(response.headers['x-test'], 'yes');
            assert.deepEqual(response.body, {hello: 'world', echo: {n: 1}});
            assert.ok(response.durationMs >= 0);
        });
        assert.equal(globalThis.fetch, original, 'fetch is restored on destroy');
    });

    it('marks HTTP errors and network failures', async () => {
        await withPairedClient([networkModule()], async (ui) => {
            await fetch(`${base}/missing`);
            await ui.next('module.network.request');
            const notFound = (await ui.next('module.network.response')).payload;
            assert.deepEqual(
                [notFound.status, notFound.result, notFound.errorMessage, notFound.body],
                [404, 'error', 'HTTP 404', 'not found'],
            );

            await assert.rejects(fetch('http://127.0.0.1:1/unreachable'));
            await ui.next('module.network.request');
            const failed = (await ui.next('module.network.response')).payload;
            assert.deepEqual([failed.status, failed.result], [null, 'error']);
            assert.ok(failed.errorMessage);
        });
    });

    it('truncates large bodies and honours ignoreUrls', async () => {
        await withPairedClient([networkModule({maxBodySize: 1000, ignoreUrls: ['/json']})], async (ui) => {
            await fetch(`${base}/json`);
            await (await fetch(`${base}/big`)).text();
            const request = (await ui.next('module.network.request')).payload;
            assert.equal(request.url, `${base}/big`);
            const response = (await ui.next('module.network.response')).payload;
            assert.equal(response.body.length, 1000);
            assert.deepEqual(response.bodyTruncated, {originalSize: 5000});
            await ui.none('module.network.request');
        });
    });

    it('does not capture the SDK’s own discovery requests', async () => {
        await withRelay({connectRequests: 'local'}, async ({port}) => {
            const ui = await openUi(port);
            const client = createClient({
                modules: [networkModule()],
                isDevelopment: true,
                discovery: {localhost: {port, hosts: ['127.0.0.1']}, intervalMs: 50},
                history: {enabled: true},
            });
            const request = (await ui.next('connect.request')).payload;
            ui.send('connect.respond', {requestId: request.requestId, approve: true, trust: false});
            await waitForStatus(client, 'connected');
            await ui.none('history');
            await ui.none('module.network.request');
            client.destroy();
            ui.close();
        });
    });

    it('buffers requests made before connecting when history is on', async () => {
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const client = createClient({modules: [networkModule()], history: {enabled: true}});
            try {
                await (await fetch(`${base}/json`)).text();
                await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
                await ui.next('hello');
                const history = (await ui.next('history')).payload;
                assert.deepEqual(
                    history.entries.map((e: any) => e.type),
                    ['module.network.request', 'module.network.response'],
                );
            } finally {
                client.destroy();
                ui.close();
            }
        });
    });

    it('captures XMLHttpRequest (used by axios and React Native fetch)', async () => {
        const g = globalThis as {XMLHttpRequest?: unknown};
        g.XMLHttpRequest = FakeXhr;
        try {
            await withPairedClient([networkModule({captureFetch: false})], async (ui) => {
                const xhr = new FakeXhr();
                FakeXhr.next = {status: 201, headers: 'Content-Type: application/json\r\nX-Id: 7', body: '{"created":true}'};
                xhr.open('PUT', 'https://api.example.com/items/7');
                xhr.setRequestHeader('Authorization', 'Bearer t');
                xhr.send('{"name":"x"}');
                const request = (await ui.next('module.network.request')).payload;
                assert.deepEqual(
                    [request.method, request.url, request.headers.Authorization, request.body],
                    ['PUT', 'https://api.example.com/items/7', 'Bearer t', {name: 'x'}],
                );
                const response = (await ui.next('module.network.response')).payload;
                assert.deepEqual(
                    [response.status, response.result, response.headers['x-id'], response.body],
                    [201, 'success', '7', {created: true}],
                );

                const failing = new FakeXhr();
                FakeXhr.next = {status: 0, headers: '', body: '', event: 'timeout'};
                failing.open('GET', 'https://api.example.com/slow');
                failing.send();
                await ui.next('module.network.request');
                const timedOut = (await ui.next('module.network.response')).payload;
                assert.deepEqual([timedOut.status, timedOut.result, timedOut.errorMessage], [null, 'error', 'Timed out']);
            });
            assert.equal(FakeXhr.prototype.send, fakeSend, 'XHR is restored on destroy');
        } finally {
            delete g.XMLHttpRequest;
        }
    });

    it('records manually and through axios interceptors', async () => {
        const network = networkModule({autoCapture: false});
        await withPairedClient([network], async (ui) => {
            const call = network.record({method: 'post', url: 'https://example.com/manual', body: {a: 1}});
            call.response({status: 500, body: {error: 'x'}});
            assert.equal((await ui.next('module.network.request')).payload.method, 'POST');
            assert.equal((await ui.next('module.network.response')).payload.result, 'error');

            const axios = fakeAxios();
            const eject = network.axios(axios);
            await axios.run(
                {method: 'get', baseURL: 'https://api.example.com/', url: '/users', params: {page: 2}},
                {status: 200, data: [1, 2], headers: {'x-a': 'b'}},
            );
            const request = (await ui.next('module.network.request')).payload;
            assert.equal(request.url, 'https://api.example.com/users?page=2');
            const response = (await ui.next('module.network.response')).payload;
            assert.deepEqual([response.status, response.body, response.headers['x-a']], [200, [1, 2], 'b']);

            await assert.rejects(axios.run({method: 'get', url: 'https://api.example.com/down'}, new Error('socket hang up')));
            await ui.next('module.network.request');
            assert.equal((await ui.next('module.network.response')).payload.errorMessage, 'socket hang up');
            eject();
            assert.equal(axios.handlers.request.length, 0);
        });
    });
});

// ─── Test helpers ────────────────────────────────────────────────────────────

type FakeResponse = {status: number; headers: string; body: string; event?: 'timeout' | 'abort' | 'error'};

class FakeXhr {
    static next: FakeResponse = {status: 200, headers: '', body: ''};
    status = 0;
    responseText = '';
    responseType = '';
    response: unknown = null;
    #headers = '';
    #listeners = new Map<string, (() => void)[]>();
    open(_method: string, _url: string) {}
    setRequestHeader(_name: string, _value: string) {}
    getAllResponseHeaders() {
        return this.#headers;
    }
    addEventListener(type: string, fn: () => void) {
        this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), fn]);
    }
    send(_body?: unknown) {
        const res = FakeXhr.next;
        setTimeout(() => {
            this.status = res.status;
            this.responseText = res.body;
            this.#headers = res.headers;
            if (res.event) this.#fire(res.event);
            this.#fire('loadend');
        }, 5);
    }
    #fire(type: string) {
        for (const fn of this.#listeners.get(type) ?? []) fn();
    }
}
const fakeSend = FakeXhr.prototype.send;

function fakeAxios() {
    const handlers = {request: [] as ((c: any) => any)[], response: [] as [(r: any) => any, (e: any) => any][]};
    return {
        handlers,
        interceptors: {
            request: {use: (fn: (c: any) => any) => handlers.request.push(fn) - 1, eject: () => void handlers.request.pop()},
            response: {
                use: (ok: (r: any) => any, err: (e: any) => any) => handlers.response.push([ok, err]) - 1,
                eject: () => void handlers.response.pop(),
            },
        },
        async run(config: any, outcome: any) {
            for (const fn of handlers.request) config = fn(config);
            if (outcome instanceof Error) {
                const error = Object.assign(outcome, {config});
                for (const [, err] of handlers.response) await err(error).catch(() => {});
                throw error;
            }
            let response = {...outcome, config};
            for (const [ok] of handlers.response) response = ok(response);
            return response;
        },
    };
}

describe('package', () => {
    it('SDK_VERSION matches package.json', async () => {
        const {SDK_VERSION} = await import('../src/index.ts');
        const pkg = JSON.parse(
            await import('node:fs/promises').then((fs) => fs.readFile(new URL('../package.json', import.meta.url), 'utf8')),
        );
        assert.equal(SDK_VERSION, pkg.version);
    });
});
