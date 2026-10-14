import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {createEnvelope, type Envelope, type Hello, WS_PATH_DEVICE, WS_PATH_UI} from '@himmetkaan/remote-devtools-protocol';
import {defaultConfig, type RelayConfig} from '../src/config.ts';
import {startServer, type RunningServer} from '../src/server.ts';

export const testConfig: RelayConfig = {
    ...defaultConfig,
    port: 0,
    host: '127.0.0.1',
    sessionTtlMs: 60_000,
    pairingTtlMs: 60_000,
    heartbeatIntervalMs: 60_000,
    authTimeoutMs: 5_000,
    maxPayloadBytes: 1024 * 1024,
    maxSessions: 100,
    gcIntervalMs: 60_000,
};

export async function withServer(overrides: Partial<RelayConfig>, fn: (server: RunningServer) => Promise<void>) {
    const server = await startServer({...testConfig, ...overrides});
    try {
        await fn(server);
    } finally {
        await server.close();
    }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const newDeviceId = () => randomUUID().replaceAll('-', '');

export function makeHello(overrides: Partial<Hello> = {}): Hello {
    return {
        app: {id: 'com.example.app', name: 'Example', version: '1.0.0'},
        device: {platform: 'ios', os: '18.0', name: 'Test iPhone'},
        sdk: {name: 'test', version: '0.0.0'},
        isDevelopment: true,
        meta: {},
        capabilities: {},
        ...overrides,
    };
}

// ─── Test client ─────────────────────────────────────────────────────────────

export type Msg = Envelope<string, any>;

export type Client = {
    ws: WebSocket;
    send(type: string, payload?: unknown, extra?: {deviceId?: string}): string;
    sendRaw(data: string): void;
    next(type: string, timeoutMs?: number): Promise<Msg>;
    /** Asserts that no message of this type arrives within the given time. */
    none(type: string, waitMs?: number): Promise<void>;
    closed: Promise<{code: number; reason: string}>;
    close(): void;
};

export async function connect(port: number, path: string, headers: Record<string, string> = {}): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {headers});
    const inbox: Msg[] = [];
    const waiters: {type: string; resolve: (m: Msg) => void}[] = [];

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Msg;
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

    const client: Client = {
        ws,
        send(type, payload = {}, extra = {}) {
            const env = createEnvelope(type, payload, extra);
            ws.send(JSON.stringify(env));
            return env.id;
        },
        sendRaw: (data) => ws.send(data),
        next(type, timeoutMs = 2000) {
            const idx = inbox.findIndex((m) => m.type === type);
            if (idx >= 0) return Promise.resolve(inbox.splice(idx, 1)[0]!);
            return new Promise((resolve, reject) => {
                const waiter = {
                    type,
                    resolve: (m: Msg) => {
                        clearTimeout(timer);
                        resolve(m);
                    },
                };
                const timer = setTimeout(() => {
                    waiters.splice(waiters.indexOf(waiter), 1);
                    reject(new Error(`Timed out waiting for "${type}". Inbox: ${inbox.map((m) => m.type).join(', ')}`));
                }, timeoutMs);
                waiters.push(waiter);
            });
        },
        async none(type, waitMs = 100) {
            await sleep(waitMs);
            const found = inbox.find((m) => m.type === type);
            if (found) throw new Error(`Unexpected "${type}": ${JSON.stringify(found.payload)}`);
        },
        closed,
        close: () => ws.close(),
    };
    return client;
}

export async function openUi(port: number) {
    const ui = await connect(port, WS_PATH_UI);
    ui.send('session.create');
    const session = (await ui.next('session')).payload;
    return {ui, session};
}

/** A UI session + a device paired via QR. */
export async function pairedDevice(port: number, existing?: {ui: Client; session: any}) {
    const {ui, session} = existing ?? (await openUi(port));
    // Earlier pairings may have consumed the QR; use the current token.
    const pairing = existing ? await currentPairing(ui) : session.pairing;
    const deviceId = newDeviceId();
    const device = await connect(port, WS_PATH_DEVICE);
    device.send('pair.qr', {sessionId: session.sessionId, qrToken: pairing.qrToken, deviceId});
    const paired = (await device.next('paired')).payload;
    const status = await ui.next('device.status');
    await ui.next('pairing');
    return {ui, session, device, deviceId, deviceSecret: paired.deviceSecret as string, status: status.payload};
}

async function currentPairing(ui: Client) {
    ui.send('pairing.refresh');
    return (await ui.next('pairing')).payload;
}
