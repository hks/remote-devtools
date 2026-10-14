import {createEnvelope, type Envelope, WS_PATH_UI} from '@himmetkaan/remote-devtools-protocol';
import {createRelay, type RelayConfig, type RunningServer} from '@himmetkaan/remote-devtools-relay';
import {type ConnectionStatus, memoryStorage, RemoteDevTools, type RemoteDevToolsOptions, type RemoteModule, staticLifecycle} from '../src/index.ts';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRelay(overrides: Partial<RelayConfig>, fn: (relay: RunningServer) => Promise<void>) {
    const relay = await createRelay({port: 0, host: '127.0.0.1', ...overrides});
    try {
        await fn(relay);
    } finally {
        await relay.close();
    }
}

export type Msg = Envelope<string, any>;

/** Simple client standing in for the UI (global WebSocket). */
export type Ui = {
    send(type: string, payload?: unknown, extra?: {deviceId?: string}): string;
    next(type: string, timeoutMs?: number): Promise<Msg>;
    none(type: string, waitMs?: number): Promise<void>;
    close(): void;
    session: any;
};

export async function openUi(port: number, resume?: {sessionId: string; uiSecret: string}): Promise<Ui> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH_UI}`);
    const inbox: Msg[] = [];
    const waiters: {type: string; resolve: (m: Msg) => void}[] = [];
    ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as Msg;
        const idx = waiters.findIndex((w) => w.type === msg.type);
        if (idx >= 0) waiters.splice(idx, 1)[0]!.resolve(msg);
        else inbox.push(msg);
    };
    await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('UI socket failed'));
    });

    const ui: Ui = {
        session: null,
        send(type, payload = {}, extra = {}) {
            const env = createEnvelope(type, payload, extra);
            ws.send(JSON.stringify(env));
            return env.id;
        },
        next(type, timeoutMs = 3000) {
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
        async none(type, waitMs = 150) {
            await sleep(waitMs);
            const found = inbox.find((m) => m.type === type);
            if (found) throw new Error(`Unexpected "${type}": ${JSON.stringify(found.payload)}`);
        },
        close: () => ws.close(),
    };

    if (resume) ui.send('session.resume', resume);
    else ui.send('session.create');
    ui.session = (await ui.next('session')).payload;
    return ui;
}

export function relayUrl(port: number) {
    return `ws://127.0.0.1:${port}`;
}

export function createClient(overrides: Partial<RemoteDevToolsOptions> = {}) {
    return new RemoteDevTools({
        enabled: true,
        app: {id: 'com.example.test', name: 'Test App', version: '1.2.3'},
        device: {platform: 'test', os: '1.0', name: 'Test Device'},
        storage: memoryStorage(),
        lifecycle: staticLifecycle(),
        discovery: {localhost: false},
        reconnect: {minDelayMs: 30, maxDelayMs: 100},
        ...overrides,
    });
}

export function waitForStatus(client: RemoteDevTools, status: ConnectionStatus, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
        let unsubscribe: () => void = () => {};
        const timer = setTimeout(() => {
            unsubscribe();
            reject(new Error(`Timed out waiting for status "${status}" (now "${client.connection.state.status}", error ${JSON.stringify(client.connection.state.error)})`));
        }, timeoutMs);
        unsubscribe = client.connection.subscribe((state) => {
            if (state.status !== status) return;
            clearTimeout(timer);
            queueMicrotask(() => unsubscribe());
            resolve();
        });
    });
}

/** Sets up a UI + paired client, runs the test, cleans up. */
export async function withPairedClient(modules: RemoteModule[], fn: (ui: Ui, deviceId: string) => Promise<void>, extra: Partial<RemoteDevToolsOptions> = {}) {
    await withRelay({}, async ({port}) => {
        const ui = await openUi(port);
        const client = createClient({modules, ...extra});
        try {
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await waitForStatus(client, 'connected');
            await ui.next('hello');
            await fn(ui, client.connection.state.deviceId!);
        } finally {
            client.destroy();
            ui.close();
        }
    });
}
