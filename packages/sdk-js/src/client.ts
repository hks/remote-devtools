import {
    type Capabilities,
    createEnvelope,
    type Envelope,
    type Hello,
    type HistoryEntry,
    type Lifecycle,
    type LogEntry,
    type LogLevel,
    MODULE_TYPE_PREFIX,
} from '@himmetkaan/remote-devtools-protocol';
import {Connection, type ConnectionState, type WebSocketConstructor} from './connection.ts';
import {detectDevice, type DeviceInfo} from './device.ts';
import {type DiscoveryProvider, localhostDiscovery, type LocalhostDiscoveryOptions} from './discovery.ts';
import {HistoryBuffer} from './history.ts';
import {browserLifecycle, type LifecycleSource} from './lifecycle.ts';
import type {EmitOptions, Logger, LogOptions, ModuleContext, RemoteModule} from './module.ts';
import {toSerializable} from './serialize.ts';
import {defaultStorage, type KeyValueStorage} from './storage.ts';

export const SDK_NAME = '@himmetkaan/remote-devtools';
export const SDK_VERSION = '0.1.0';

export type RemoteDevToolsOptions = {
    /** Required gate. When `false` nothing happens: no socket is opened, no modules are set up, no globals are patched. */
    enabled: boolean;
    /** Development mode: finds the local relay and sends a connect request (must be approved in the UI). */
    isDevelopment?: boolean;
    app: Hello['app'];
    /** Omitted fields are guessed from the environment. On React Native, `platform` and `os` should be provided. */
    device?: Partial<DeviceInfo>;
    /** Free-form fields shown on the device card in the UI (userId, apiEndpoint, env…). */
    meta?: Record<string, string>;
    modules?: RemoteModule[];
    /** For the pairing and the device id. On React Native, pass AsyncStorage. Default: localStorage or in-memory. */
    storage?: KeyValueStorage;
    /** Prefix for storage keys. */
    storageKey?: string;
    /** Foreground / background source. React Native: `reactNativeLifecycle(AppState)`. Default: browser visibility. */
    lifecycle?: LifecycleSource;
    /** Keeps logs and module events from before the connection in memory and sends them once connected. Off by default. */
    history?: {enabled: boolean; maxEntries?: number};
    discovery?: {
        /** Looks for a local relay via `GET /discovery` (on by default, `isDevelopment` only). */
        localhost?: boolean | LocalhostDiscoveryOptions;
        /** Additional discovery methods (e.g. an mDNS package). */
        providers?: DiscoveryProvider[];
        /** Retry interval when no relay is found. */
        intervalMs?: number;
    };
    /** Also sends `console.*` calls as logs (`true` = all levels). */
    captureConsole?: boolean | LogLevel[];
    reconnect?: {minDelayMs?: number; maxDelayMs?: number};
    /** Default: the global `WebSocket`. */
    WebSocket?: WebSocketConstructor;
    /** Writes the SDK's own internal logs to the console. */
    debug?: boolean;
};

export type ConnectionApi = {
    readonly state: ConnectionState;
    subscribe(listener: (state: ConnectionState) => void): () => void;
    pairWithQr(qr: string): Promise<void>;
    pairWithCode(code: string, relayUrl: string): Promise<void>;
    connect(): void;
    disconnect(): void;
    unpair(): void;
    discover(): Promise<void>;
};

const HISTORY_CHUNK_BYTES = 256 * 1024;
const CONSOLE_METHODS: Record<LogLevel, 'debug' | 'log' | 'warn' | 'error'> = {debug: 'debug', info: 'log', warn: 'warn', error: 'error'};
/** Originals are kept so the SDK's own output doesn't loop back into the captured console. */
const originalConsole = {...console};

const DISABLED_STATE: ConnectionState = {
    status: 'disabled',
    deviceId: null,
    relayUrl: null,
    sessionId: null,
    requestId: null,
    error: null,
    retryAt: null,
};

type Handler = (payload: unknown, message: Envelope) => void;

export class RemoteDevTools {
    static #instance: RemoteDevTools | null = null;

    /** Creates and starts the app-wide singleton. Calling it again destroys the previous one. */
    static init(options: RemoteDevToolsOptions): RemoteDevTools {
        RemoteDevTools.#instance?.destroy();
        RemoteDevTools.#instance = new RemoteDevTools(options);
        return RemoteDevTools.#instance;
    }

    /** The instance created by `init` (or `null`). */
    static get instance(): RemoteDevTools | null {
        return RemoteDevTools.#instance;
    }

    readonly enabled: boolean;
    readonly log: Logger;
    readonly connection: ConnectionApi;

    readonly #options: RemoteDevToolsOptions;
    readonly #connection: Connection | null;
    readonly #lifecycle: LifecycleSource;
    readonly #history: HistoryBuffer | null;
    readonly #storage: KeyValueStorage;
    readonly #handlers = new Map<string, Handler>();
    readonly #teardown: (() => void)[] = [];
    #meta: Record<string, string>;
    #destroyed = false;

    constructor(options: RemoteDevToolsOptions) {
        this.#options = options;
        this.enabled = options.enabled === true;
        this.#meta = {...options.meta};
        this.#storage = options.storage ?? defaultStorage();
        this.#lifecycle = options.lifecycle ?? browserLifecycle();
        this.#history = this.enabled && options.history?.enabled ? new HistoryBuffer(options.history.maxEntries ?? 500) : null;
        this.log = this.#createLogger();
        this.#connection = this.enabled ? this.#createConnection() : null;
        this.connection = this.#createConnectionApi();

        if (!this.#connection) return;
        this.#setupModules();
        this.#setupLifecycle();
        this.#setupConsoleCapture();
        void this.#connection.start();
    }

    /** Updates the `meta` fields; if connected, a new `hello` is sent to the UI. */
    updateMeta(meta: Record<string, string>): void {
        if (!this.enabled) return;
        this.#meta = {...this.#meta, ...meta};
        this.#send('hello', this.#hello(), {buffer: false});
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        for (const fn of this.#teardown.splice(0).reverse()) {
            try {
                fn();
            } catch (err) {
                this.#debug('teardown failed', err);
            }
        }
        this.#connection?.destroy();
        if (RemoteDevTools.#instance === this) RemoteDevTools.#instance = null;
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    #createConnection(): Connection {
        const o = this.#options;
        const WebSocketImpl = o.WebSocket ?? (globalThis as {WebSocket?: WebSocketConstructor}).WebSocket;
        if (!WebSocketImpl) throw new Error('No WebSocket implementation found; pass the `WebSocket` option');

        const discovery: DiscoveryProvider[] = [];
        const localhost = o.discovery?.localhost ?? true;
        if (localhost) discovery.push(localhostDiscovery(localhost === true ? {} : localhost));
        discovery.push(...(o.discovery?.providers ?? []));

        return new Connection({
            storage: this.#storage,
            storageKey: o.storageKey ?? 'remote-devtools',
            isDevelopment: o.isDevelopment === true,
            discovery,
            discoveryIntervalMs: o.discovery?.intervalMs ?? 5000,
            reconnectMinDelayMs: o.reconnect?.minDelayMs ?? 1000,
            reconnectMaxDelayMs: o.reconnect?.maxDelayMs ?? 30_000,
            openTimeoutMs: 10_000,
            WebSocket: WebSocketImpl,
            getHello: () => this.#hello(),
            onReady: () => this.#onReady(),
            onMessage: (msg) => this.#onMessage(msg),
            debug: (message, data) => this.#debug(message, data),
        });
    }

    #createConnectionApi(): ConnectionApi {
        const c = this.#connection;
        if (!c) {
            return {
                state: DISABLED_STATE,
                subscribe: (listener) => {
                    listener(DISABLED_STATE);
                    return () => {};
                },
                pairWithQr: async () => {},
                pairWithCode: async () => {},
                connect: () => {},
                disconnect: () => {},
                unpair: () => {},
                discover: async () => {},
            };
        }
        return {
            get state() {
                return c.state;
            },
            subscribe: (listener) => c.subscribe(listener),
            pairWithQr: (qr) => c.pairWithQr(qr),
            pairWithCode: (code, relayUrl) => c.pairWithCode(code, relayUrl),
            connect: () => c.connect(),
            disconnect: () => c.disconnect(),
            unpair: () => c.unpair(),
            discover: () => c.discover(),
        };
    }

    #setupModules() {
        const names = new Set<string>();
        for (const module of this.#options.modules ?? []) {
            if (names.has(module.name)) throw new Error(`Duplicate module name: ${module.name}`);
            names.add(module.name);
            const cleanup = module.setup?.(this.#moduleContext(module));
            if (typeof cleanup === 'function') this.#teardown.push(cleanup);
        }
    }

    #setupLifecycle() {
        const unsubscribe = this.#lifecycle.subscribe((state) => {
            this.#send('lifecycle', {state}, {buffer: false});
            if (state === 'active') this.#connection?.onForeground();
        });
        this.#teardown.push(unsubscribe);
    }

    #setupConsoleCapture() {
        const option = this.#options.captureConsole;
        if (!option) return;
        const levels: LogLevel[] = option === true ? ['debug', 'info', 'warn', 'error'] : option;
        for (const level of levels) {
            const method = CONSOLE_METHODS[level];
            const original = console[method];
            console[method] = (...args: unknown[]) => {
                original.apply(console, args);
                const [first, ...rest] = args;
                const message = typeof first === 'string' ? first : stringify(first);
                this.#log(level, message, rest.length === 0 ? undefined : rest.length === 1 ? rest[0] : rest, {tag: 'console'});
            };
            this.#teardown.push(() => {
                console[method] = original;
            });
        }
    }

    #moduleContext(module: RemoteModule): ModuleContext {
        // Modules are only set up when the SDK is enabled, so the connection always exists.
        const connection = this.#connection!;
        const prefix = `${MODULE_TYPE_PREFIX}${module.name}.`;
        const assertType = (type: string) => {
            if (!type.startsWith(prefix)) throw new Error(`Module "${module.name}" can only use "${prefix}*" message types (got "${type}")`);
        };
        return {
            get deviceId() {
                return connection.deviceId;
            },
            isConnected: () => connection.isConnected,
            emit: (type, payload, options) => {
                assertType(type);
                this.#send(type, payload, options);
            },
            handle: (type, handler) => {
                assertType(type);
                this.#handlers.set(type, (payload, message) => void this.#reply(`${prefix}result`, message, () => handler(payload as never, message as never)));
            },
            on: (type, listener) => {
                assertType(type);
                this.#handlers.set(type, listener as Handler);
            },
            updateCapabilities: () => {
                this.#send('capabilities.update', {[module.name]: module.capabilities?.() ?? {}}, {buffer: false});
            },
            storage: prefixedStorage(this.#storage, `${this.#options.storageKey ?? 'remote-devtools'}:module:${module.name}:`),
            log: this.log,
        };
    }

    // ─── Connection events ───────────────────────────────────────────────────

    #hello(): Hello {
        const capabilities: Capabilities = {};
        for (const module of this.#options.modules ?? []) capabilities[module.name] = module.capabilities?.() ?? {};
        const detected = detectDevice();
        return {
            app: this.#options.app,
            device: {...detected, ...this.#options.device} as DeviceInfo,
            sdk: {name: SDK_NAME, version: SDK_VERSION},
            isDevelopment: this.#options.isDevelopment === true,
            meta: {...this.#meta},
            capabilities,
        };
    }

    #onReady() {
        this.#sendNow('hello', this.#hello());
        this.#sendNow('lifecycle', {state: this.#lifecycle.current() satisfies Lifecycle});
        if (!this.#history?.size) return;
        const chunks = this.#history.drain(HISTORY_CHUNK_BYTES);
        chunks.forEach((entries, i) => this.#sendNow('history', {entries, final: i === chunks.length - 1}));
    }

    #onMessage(msg: Envelope) {
        const handler = this.#handlers.get(msg.type);
        if (handler) handler(msg.payload, msg);
        else if (msg.type !== 'error') this.#debug(`no handler for ${msg.type}`);
    }

    async #reply(type: string, request: Envelope, run: () => unknown) {
        let payload: unknown;
        try {
            payload = {ok: true, result: toSerializable(await run()) ?? null};
        } catch (err) {
            const e = err as {code?: unknown; message?: unknown};
            payload = {ok: false, error: {code: typeof e?.code === 'string' ? e.code : 'HANDLER_ERROR', message: String(e?.message ?? err)}};
        }
        this.#connection?.send(JSON.stringify(createEnvelope(type, payload, {replyTo: request.id})));
    }

    // ─── Sending ─────────────────────────────────────────────────────────────

    #sendNow(type: string, payload: unknown): boolean {
        return this.#connection?.send(JSON.stringify(createEnvelope(type, payload))) ?? false;
    }

    /** Sends if connected; otherwise (if allowed) puts it in the history buffer. */
    #send(type: string, payload: unknown, options: EmitOptions = {}) {
        if (!this.#connection || this.#destroyed) return;
        const safe = toSerializable(payload);
        if (this.#sendNow(type, safe)) return;
        if (this.#history && options.buffer !== false) this.#history.push({type, payload: safe, ts: Date.now()} satisfies HistoryEntry);
    }

    #createLogger(): Logger {
        const at = (level: LogLevel) => (message: string, data?: unknown, options?: LogOptions) => this.#log(level, message, data, options);
        return {debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error')};
    }

    #log(level: LogLevel, message: string, data: unknown, options: LogOptions = {}) {
        if (!this.enabled) return;
        const entry: LogEntry = {level, message: String(message), at: Date.now()};
        if (data !== undefined) entry.data = data;
        if (options.tag) entry.tag = options.tag;
        this.#send('log', entry);
    }

    #debug(message: string, data?: unknown) {
        if (!this.#options.debug) return;
        if (data === undefined) originalConsole.debug(`[remote-devtools] ${message}`);
        else originalConsole.debug(`[remote-devtools] ${message}`, data);
    }
}

function prefixedStorage(storage: KeyValueStorage, prefix: string): KeyValueStorage {
    return {
        getItem: (key) => storage.getItem(prefix + key),
        setItem: (key, value) => storage.setItem(prefix + key, value),
        removeItem: (key) => storage.removeItem(prefix + key),
    };
}

function stringify(value: unknown): string {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    try {
        return typeof value === 'object' ? JSON.stringify(toSerializable(value)) : String(value);
    } catch {
        return String(value);
    }
}
