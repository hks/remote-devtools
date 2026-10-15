import {
    type ConnectRejectReason,
    createEnvelope,
    type Envelope,
    type Hello,
    PROTOCOL_VERSION,
    parseEnvelope,
    parseQrPayload,
    type UnpairReason,
    WS_PATH_DEVICE,
} from '@himmetkaan/remote-devtools-protocol';
import type {DiscoveryProvider} from './discovery.ts';
import type {KeyValueStorage} from './storage.ts';

export type ConnectionStatus =
    /** SDK is disabled (`enabled: false`). */
    | 'disabled'
    /** No pairing, or `disconnect()` was called; waiting for a QR/code or `connect()`. */
    | 'idle'
    /** `isDevelopment`: looking for a relay. */
    | 'discovering'
    | 'connecting'
    /** The connect request is awaiting approval in the UI. */
    | 'pending-approval'
    | 'connected'
    /** Connection lost; will retry with the stored pairing. */
    | 'reconnecting';

export type ConnectionError = {code: string; message: string};

export type ConnectionState = {
    status: ConnectionStatus;
    deviceId: string | null;
    relayUrl: string | null;
    sessionId: string | null;
    /** Id of the pending request while `pending-approval`. */
    requestId: string | null;
    /** Error of the last failed operation; cleared once a new connection is established. */
    error: ConnectionError | null;
    /** Time of the next attempt while `reconnecting`. */
    retryAt: number | null;
};

export type WebSocketLike = {
    readonly readyState: number;
    onopen: ((ev: unknown) => void) | null;
    onmessage: ((ev: {data: unknown}) => void) | null;
    onclose: ((ev: {code: number; reason?: string}) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    send(data: string): void;
    close(code?: number, reason?: string): void;
};

export type WebSocketConstructor = new (url: string) => WebSocketLike;

/** Pairing stored on the device. The expiry slides on the relay; it is kept here only to guess when it is no longer valid. */
type StoredPairing = {
    relayUrl: string;
    sessionId: string;
    deviceSecret: string;
    idleTtlMs: number;
    /** Last activity time (updated periodically while connected). */
    lastActiveAt: number;
};

export type ConnectionOptions = {
    storage: KeyValueStorage;
    storageKey: string;
    isDevelopment: boolean;
    discovery: DiscoveryProvider[];
    discoveryIntervalMs: number;
    reconnectMinDelayMs: number;
    reconnectMaxDelayMs: number;
    openTimeoutMs: number;
    WebSocket: WebSocketConstructor;
    getHello(): Hello;
    onReady(): void;
    onMessage(message: Envelope): void;
    debug(message: string, data?: unknown): void;
};

const OPEN = 1;
const ACTIVITY_SAVE_INTERVAL_MS = 60_000;
/** How long to wait before asking again if the user didn't answer the pending request. */
const EXPIRED_REQUEST_BACKOFF_MS = 60_000;

/** Relay close codes (see docs/reference/protocol.md). */
const Close = {replaced: 4000, unpaired: 4002, unsupportedVersion: 4005} as const;

/** A development device that loses its pairing for these reasons starts discovery again; not if the user removed it. */
const REDISCOVER_AFTER: ReadonlySet<UnpairReason> = new Set(['expired', 'sessionNotFound', 'invalidSecret']);

type FirstMessage = {type: 'pair.qr' | 'pair.code' | 'resume' | 'connect'; payload: unknown};

export function randomDeviceId(): string {
    const bytes = new Uint8Array(16);
    const c = (globalThis as {crypto?: Crypto}).crypto;
    if (c?.getRandomValues) c.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Converts inputs like `https://host`, `ws://host:8080`, `host:8080` into the device WebSocket URL. */
export function toDeviceWsUrl(input: string): string {
    let url = input.trim().replace(/\/+$/, '');
    if (!/^[a-z]+:\/\//i.test(url)) url = `ws://${url}`;
    url = url.replace(/^http(s?):\/\//i, 'ws$1://');
    return url.endsWith(WS_PATH_DEVICE) ? url : url + WS_PATH_DEVICE;
}

export class Connection {
    readonly #o: ConnectionOptions;
    readonly #listeners = new Set<(state: ConnectionState) => void>();
    #state: ConnectionState = {
        status: 'idle',
        deviceId: null,
        relayUrl: null,
        sessionId: null,
        requestId: null,
        error: null,
        retryAt: null,
    };

    #deviceId = '';
    #pairing: StoredPairing | null = null;
    #ws: WebSocketLike | null = null;
    #wsUrl = '';
    #first: FirstMessage | null = null;
    /** This socket's close is expected (should not be reacted to). */
    #expectClose = false;
    #attempt = 0;
    #retryTimer: ReturnType<typeof setTimeout> | null = null;
    #openTimer: ReturnType<typeof setTimeout> | null = null;
    #activityTimer: ReturnType<typeof setInterval> | null = null;
    #discoveryAbort: AbortController | null = null;
    #destroyed = false;
    #ready: Promise<void> | null = null;

    constructor(options: ConnectionOptions) {
        this.#o = options;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    get state(): ConnectionState {
        return this.#state;
    }

    get deviceId(): string {
        return this.#deviceId;
    }

    get isConnected(): boolean {
        return this.#state.status === 'connected';
    }

    subscribe(listener: (state: ConnectionState) => void): () => void {
        this.#listeners.add(listener);
        listener(this.#state);
        return () => this.#listeners.delete(listener);
    }

    #set(patch: Partial<ConnectionState>) {
        this.#state = {...this.#state, ...patch};
        if (patch.status) this.#o.debug(`status → ${patch.status}`, patch.error ?? undefined);
        for (const listener of this.#listeners) listener(this.#state);
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    get #pairingKey() {
        return `${this.#o.storageKey}:pairing`;
    }

    async #loadDeviceId(): Promise<string> {
        const key = `${this.#o.storageKey}:device-id`;
        const stored = await this.#o.storage.getItem(key);
        if (stored && /^[A-Za-z0-9_-]{8,128}$/.test(stored)) return stored;
        const created = randomDeviceId();
        await this.#o.storage.setItem(key, created);
        return created;
    }

    async #loadPairing(): Promise<StoredPairing | null> {
        try {
            const raw = await this.#o.storage.getItem(this.#pairingKey);
            const p = raw ? (JSON.parse(raw) as StoredPairing) : null;
            if (p && typeof p.relayUrl === 'string' && typeof p.sessionId === 'string' && typeof p.deviceSecret === 'string') return p;
        } catch {
            // corrupt record
        }
        return null;
    }

    #savePairing() {
        if (this.#pairing) void this.#o.storage.setItem(this.#pairingKey, JSON.stringify(this.#pairing));
    }

    #forgetPairing() {
        this.#pairing = null;
        void this.#o.storage.removeItem(this.#pairingKey);
        this.#set({sessionId: null});
    }

    #pairingExpired(p: StoredPairing): boolean {
        return Date.now() > p.lastActiveAt + p.idleTtlMs;
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /** Loads the device id and stored pairing; resumes if paired, otherwise (in development) starts discovery. */
    start(): Promise<void> {
        this.#ready ??= (async () => {
            this.#deviceId = await this.#loadDeviceId();
            this.#pairing = await this.#loadPairing();
            this.#set({deviceId: this.#deviceId});
            if (this.#destroyed) return;
            this.connect();
        })();
        return this.#ready;
    }

    /** Connects with the stored pairing; without one, starts discovery in development mode. */
    connect(): void {
        if (this.#destroyed || !this.#deviceId) return;
        if (['connected', 'connecting', 'pending-approval'].includes(this.#state.status)) return;
        if (this.#pairing && this.#pairingExpired(this.#pairing)) {
            this.#o.debug('stored pairing is past its idle TTL, forgetting it');
            this.#forgetPairing();
        }
        if (this.#pairing) {
            this.#attempt = 0;
            this.#resume();
        } else if (this.#o.isDevelopment && this.#o.discovery.length) {
            void this.discover();
        } else {
            this.#stop();
            this.#set({status: 'idle'});
        }
    }

    /** Pairs using QR content. Any existing pairing is dropped. */
    async pairWithQr(raw: string): Promise<void> {
        const qr = parseQrPayload(raw);
        if (!qr) throw new Error('Not a Remote DevTools QR code');
        if (qr.v !== PROTOCOL_VERSION) throw new Error(`QR code is for protocol v${qr.v}; this SDK speaks v${PROTOCOL_VERSION}`);
        await this.start();
        this.#beginPairing(qr.url, {type: 'pair.qr', payload: {sessionId: qr.sessionId, qrToken: qr.qrToken, deviceId: this.#deviceId}});
    }

    /** Pairs using a 6-digit code. `relayUrl`: the relay's address (`https://…`, `ws://host:port` or the full device URL). */
    async pairWithCode(code: string, relayUrl: string): Promise<void> {
        const normalized = code.replace(/\s+/g, '');
        if (!/^\d{6}$/.test(normalized)) throw new Error('Pairing code must be 6 digits');
        await this.start();
        this.#beginPairing(toDeviceWsUrl(relayUrl), {type: 'pair.code', payload: {code: normalized, deviceId: this.#deviceId}});
    }

    /** Closes the connection but keeps the pairing; resume with `connect()`. */
    disconnect(): void {
        this.#stop();
        this.#set({status: 'idle', requestId: null, retryAt: null});
    }

    /** Removes the pairing from the relay and the device. */
    unpair(): void {
        if (this.isConnected) this.send(JSON.stringify(createEnvelope('unpair', {})));
        this.#stop();
        this.#forgetPairing();
        this.#set({status: 'idle', relayUrl: null, requestId: null, retryAt: null, error: null});
    }

    /** Starts development discovery immediately (e.g. to retry after the user rejected). */
    async discover(): Promise<void> {
        if (this.#destroyed || !this.#deviceId) return;
        this.#stop();
        const abort = new AbortController();
        this.#discoveryAbort = abort;
        this.#set({status: 'discovering', requestId: null, retryAt: null});

        const urls: string[] = [];
        for (const provider of this.#o.discovery) {
            try {
                urls.push(...(await provider.find(abort.signal)));
            } catch (err) {
                this.#o.debug(`discovery provider "${provider.name}" failed`, err);
            }
            if (abort.signal.aborted) return;
            if (urls.length) break;
        }
        if (abort.signal.aborted) return;
        this.#discoveryAbort = null;

        const url = urls[0];
        if (!url) {
            this.#scheduleDiscovery(this.#o.discoveryIntervalMs);
            return;
        }
        this.#open(url, {type: 'connect', payload: {deviceId: this.#deviceId, hello: this.#o.getHello()}});
    }

    /** Retries right away when returning to the foreground. */
    onForeground(): void {
        if (this.#state.status === 'reconnecting' || (this.#state.status === 'discovering' && !this.#discoveryAbort)) this.connect();
    }

    send(data: string): boolean {
        if (!this.isConnected || this.#ws?.readyState !== OPEN) return false;
        this.#ws.send(data);
        return true;
    }

    destroy(): void {
        this.#destroyed = true;
        this.#stop();
        this.#listeners.clear();
    }

    // ─── Socket ──────────────────────────────────────────────────────────────

    #beginPairing(url: string, first: FirstMessage) {
        this.#forgetPairing();
        this.#open(url, first);
    }

    #resume() {
        const p = this.#pairing!;
        this.#open(p.relayUrl, {type: 'resume', payload: {sessionId: p.sessionId, deviceId: this.#deviceId, deviceSecret: p.deviceSecret}});
    }

    /** Clears timers and closes the open socket (as an expected close). */
    #stop() {
        if (this.#retryTimer) clearTimeout(this.#retryTimer);
        if (this.#activityTimer) clearInterval(this.#activityTimer);
        this.#retryTimer = null;
        this.#activityTimer = null;
        this.#discoveryAbort?.abort();
        this.#discoveryAbort = null;
        this.#closeSocket();
    }

    #closeSocket(code = 1000) {
        if (this.#openTimer) clearTimeout(this.#openTimer);
        this.#openTimer = null;
        const ws = this.#ws;
        this.#ws = null;
        if (!ws) return;
        if (this.#state.status === 'connected') this.#touchActivity();
        ws.onopen = ws.onmessage = ws.onerror = null;
        ws.onclose = null;
        try {
            ws.close(code);
        } catch {
            // already closed
        }
    }

    #open(url: string, first: FirstMessage) {
        this.#stop();
        this.#wsUrl = url;
        this.#first = first;
        this.#expectClose = false;
        this.#set({status: 'connecting', relayUrl: url, requestId: null, retryAt: null});

        let ws: WebSocketLike;
        try {
            ws = new this.#o.WebSocket(url);
        } catch (err) {
            this.#set({error: {code: 'CONNECT_FAILED', message: (err as Error).message}});
            this.#afterSocketLost();
            return;
        }
        this.#ws = ws;
        this.#openTimer = setTimeout(() => {
            this.#o.debug('socket did not open in time');
            ws.close();
            if (this.#ws === ws) this.#handleClose(ws, 1006);
        }, this.#o.openTimeoutMs);

        ws.onopen = () => {
            if (this.#openTimer) clearTimeout(this.#openTimer);
            this.#openTimer = null;
            ws.send(JSON.stringify(createEnvelope(first.type, first.payload)));
        };
        ws.onmessage = (ev) => {
            if (this.#ws !== ws) return;
            const msg = parseEnvelope(typeof ev.data === 'string' ? ev.data : String(ev.data));
            if (msg) this.#handleMessage(msg);
        };
        ws.onerror = () => {
            // A close event follows.
        };
        ws.onclose = (ev) => this.#handleClose(ws, ev.code);
    }

    #handleMessage(msg: Envelope) {
        const p = msg.payload as Record<string, any>;
        switch (msg.type) {
            case 'paired':
                this.#pairing = {
                    relayUrl: this.#wsUrl,
                    sessionId: p.sessionId,
                    deviceSecret: p.deviceSecret,
                    idleTtlMs: Math.max(0, p.expiresAt - Date.now()),
                    lastActiveAt: Date.now(),
                };
                this.#savePairing();
                return this.#onAuthenticated(p.sessionId);
            case 'resumed':
                if (this.#pairing) {
                    this.#pairing.idleTtlMs = Math.max(0, p.expiresAt - Date.now());
                    this.#pairing.lastActiveAt = Date.now();
                    this.#savePairing();
                }
                return this.#onAuthenticated(p.sessionId);
            case 'connect.pending':
                this.#set({status: 'pending-approval', requestId: p.requestId});
                return;
            case 'connect.rejected':
                this.#expectClose = true;
                return this.#onConnectRejected(p.reason as ConnectRejectReason);
            case 'unpaired':
                this.#expectClose = true;
                return this.#onUnpaired(p.reason as UnpairReason);
            case 'error':
                if (this.isConnected) {
                    this.#o.debug(`relay error: ${p.code}`, p.message);
                    this.#o.onMessage(msg);
                } else {
                    // Pairing failed (invalid code/token, expired, limit…). The relay will close the socket.
                    this.#expectClose = true;
                    this.#closeSocket();
                    this.#set({status: 'idle', error: {code: p.code, message: p.message}});
                }
                return;
            default:
                if (this.isConnected) this.#o.onMessage(msg);
        }
    }

    #onAuthenticated(sessionId: string) {
        this.#attempt = 0;
        this.#set({status: 'connected', sessionId, relayUrl: this.#wsUrl, requestId: null, retryAt: null, error: null});
        if (this.#activityTimer) clearInterval(this.#activityTimer);
        this.#activityTimer = setInterval(() => this.#touchActivity(), ACTIVITY_SAVE_INTERVAL_MS);
        this.#o.onReady();
    }

    #touchActivity() {
        if (!this.#pairing) return;
        this.#pairing.lastActiveAt = Date.now();
        this.#savePairing();
    }

    #onConnectRejected(reason: ConnectRejectReason) {
        this.#closeSocket();
        switch (reason) {
            case 'noSession':
                // The UI isn't open yet; retry so it sees the request once it opens.
                this.#scheduleDiscovery(this.#o.discoveryIntervalMs);
                return;
            case 'expired':
                this.#set({error: {code: 'CONNECT_EXPIRED', message: 'The connect request was not answered in time'}});
                this.#scheduleDiscovery(EXPIRED_REQUEST_BACKOFF_MS);
                return;
            default:
                this.#set({
                    status: 'idle',
                    requestId: null,
                    error: {
                        code: `CONNECT_${reason.toUpperCase()}`,
                        message: `Connect request ${reason === 'rejected' ? 'was rejected' : `failed: ${reason}`}`,
                    },
                });
        }
    }

    #onUnpaired(reason: UnpairReason) {
        this.#closeSocket();
        if (this.#activityTimer) clearInterval(this.#activityTimer);
        this.#activityTimer = null;
        this.#forgetPairing();
        this.#set({status: 'idle', requestId: null, error: {code: 'UNPAIRED', message: `Unpaired: ${reason}`}});
        if (this.#o.isDevelopment && REDISCOVER_AFTER.has(reason)) void this.discover();
    }

    #handleClose(ws: WebSocketLike, code: number) {
        if (this.#ws !== ws) return;
        const wasConnected = this.#state.status === 'connected';
        this.#ws = null;
        if (this.#openTimer) clearTimeout(this.#openTimer);
        this.#openTimer = null;
        if (this.#activityTimer) clearInterval(this.#activityTimer);
        this.#activityTimer = null;
        if (wasConnected) this.#touchActivity();
        if (this.#expectClose || this.#destroyed) return;

        this.#o.debug(`socket closed (${code})`);
        if (code === Close.replaced) {
            this.#set({status: 'idle', error: {code: 'REPLACED', message: 'Another connection of this device took over'}});
            return;
        }
        if (code === Close.unpaired) return this.#onUnpaired('invalidSecret');
        if (code === Close.unsupportedVersion) {
            this.#set({
                status: 'idle',
                error: {code: 'UNSUPPORTED_VERSION', message: `Relay does not speak protocol v${PROTOCOL_VERSION}`},
            });
            return;
        }
        this.#afterSocketLost();
    }

    /** Network error / relay closed: reconnect if paired, search again if discovering. */
    #afterSocketLost() {
        // A pairing only exists after `paired`/`resumed`; a socket lost while pairing via QR/code is not retried.
        if (this.#pairing) {
            this.#scheduleReconnect();
        } else if (this.#first?.type === 'connect') {
            this.#scheduleDiscovery(this.#o.discoveryIntervalMs);
        } else {
            this.#set({status: 'idle', error: this.#state.error ?? {code: 'CONNECT_FAILED', message: `Could not reach ${this.#wsUrl}`}});
        }
    }

    #scheduleReconnect() {
        const base = Math.min(this.#o.reconnectMaxDelayMs, this.#o.reconnectMinDelayMs * 2 ** this.#attempt);
        const delay = Math.round(base * (0.8 + Math.random() * 0.4));
        this.#attempt++;
        this.#set({status: 'reconnecting', retryAt: Date.now() + delay});
        this.#retryTimer = setTimeout(() => {
            this.#retryTimer = null;
            if (!this.#pairing) return this.connect();
            if (this.#pairingExpired(this.#pairing)) {
                this.#o.debug('gave up reconnecting: pairing is past its idle TTL');
                return this.connect();
            }
            this.#resume();
        }, delay);
    }

    #scheduleDiscovery(delay: number) {
        if (!this.#o.isDevelopment || !this.#o.discovery.length) {
            this.#set({status: 'idle'});
            return;
        }
        this.#set({status: 'discovering', requestId: null, retryAt: Date.now() + delay});
        this.#retryTimer = setTimeout(() => {
            this.#retryTimer = null;
            void this.discover();
        }, delay);
    }
}
