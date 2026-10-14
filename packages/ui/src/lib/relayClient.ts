import {
    createEnvelope,
    type Envelope,
    type HistoryChunk,
    isModuleType,
    type ModuleResult,
    parseEnvelope,
    type RelayToUi,
    type UiToRelay,
    WS_PATH_DEVICE,
    WS_PATH_UI,
} from '@himmetkaan/remote-devtools-protocol';
import {deviceName, useDevtoolsStore} from '../store/useDevtoolsStore.ts';
import {describeDevice} from './format.ts';

type Credentials = {sessionId: string; uiSecret: string};

/** Cihazdan gelen (relay'in `deviceId` eklediği) mesaj. `history` içindekiler açılıp `historic: true` ile tek tek iletilir. */
export type DeviceMessage = Envelope<string, any> & {deviceId: string; historic?: boolean};
type DeviceListener = (msg: DeviceMessage) => void;

/** Aynı tarayıcı = tek oturum; incognito'nun localStorage'ı ayrı olduğundan orada yeni oturum açılır. */
const STORAGE_KEY = 'remote-devtools.session.v2';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

function readCredentials(): Credentials | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<Credentials>;
        return parsed.sessionId && parsed.uiSecret ? {sessionId: parsed.sessionId, uiSecret: parsed.uiSecret} : null;
    } catch {
        return null;
    }
}

function writeCredentials(creds: Credentials | null) {
    try {
        if (creds) localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Depolama kapalıysa oturum sadece bu sekmede yaşar.
    }
}

function relayWsUrl(path: string): string {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}${path}`;
}

/** QR'a yazılacak cihaz adresi: relay `PUBLIC_URL` verdiyse o, yoksa sayfanın origin'i. */
export function resolveDeviceWsUrl(deviceWsUrl: string | null): string {
    return deviceWsUrl ?? relayWsUrl(WS_PATH_DEVICE);
}

/** Kod ile eşleşirken uygulamaya girilecek relay adresi (cihaz WebSocket yolu olmadan). */
export function resolveRelayBaseUrl(deviceWsUrl: string | null): string {
    return resolveDeviceWsUrl(deviceWsUrl).replace(/\/ws\/device$/, '');
}

type PendingRequest = {resolve: (result: ModuleResult) => void; timer: ReturnType<typeof setTimeout>};

class RelayClient {
    #ws: WebSocket | null = null;
    #creds: Credentials | null = readCredentials();
    #retryMs = RECONNECT_MIN_MS;
    #retryTimer: ReturnType<typeof setTimeout> | null = null;
    #pendingResumeId: string | null = null;
    #wasOpen = false;
    #started = false;
    #listeners = new Set<DeviceListener>();
    #requests = new Map<string, PendingRequest>();

    start() {
        if (this.#started) return;
        this.#started = true;
        window.addEventListener('storage', this.#onStorage);
        this.#connect();
    }

    /** Relay'e mesaj gönderir. Bağlantı yoksa `null` döner. */
    send<K extends keyof UiToRelay & string>(type: K, payload: UiToRelay[K]): string | null {
        return this.#sendRaw(type, payload);
    }

    /**
     * Cihaza modül isteği gönderir ve `replyTo` ile gelen cevabı bekler.
     * Relay hatası (cihaz çevrimdışı vb.) ve zaman aşımı da `{ok: false}` olarak döner.
     */
    request<R = unknown>(type: string, payload: unknown, deviceId: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<ModuleResult<R>> {
        if (!isModuleType(type)) throw new Error(`Not a module message type: ${type}`);
        const id = this.#sendRaw(type, payload, {deviceId});
        if (!id) return Promise.resolve({ok: false, error: {code: 'RELAY_OFFLINE', message: 'Not connected to the relay'}});
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.#requests.delete(id);
                resolve({ok: false, error: {code: 'TIMEOUT', message: 'The device did not answer in time'}});
            }, timeoutMs);
            this.#requests.set(id, {resolve: resolve as PendingRequest['resolve'], timer});
        });
    }

    /** Cihazlardan gelen tüm mesajlar (çekirdek + modül). */
    subscribe(listener: DeviceListener): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    #sendRaw(type: string, payload: unknown, extra: {deviceId?: string} = {}): string | null {
        if (this.#ws?.readyState !== WebSocket.OPEN) return null;
        const envelope = createEnvelope(type, payload, extra);
        this.#ws.send(JSON.stringify(envelope));
        return envelope.id;
    }

    #connect() {
        const store = useDevtoolsStore.getState();
        store.setRelay(this.#wasOpen ? 'reconnecting' : 'connecting');

        const ws = new WebSocket(relayWsUrl(WS_PATH_UI));
        this.#ws = ws;

        ws.onopen = () => {
            this.#retryMs = RECONNECT_MIN_MS;
            if (this.#wasOpen) store.addLog({level: 'info', source: 'ui', message: 'Reconnected to the relay', deviceId: null});
            this.#wasOpen = true;
            useDevtoolsStore.getState().setRelay('open');
            this.#authenticate();
        };

        ws.onmessage = (event) => {
            const msg = typeof event.data === 'string' ? parseEnvelope(event.data) : null;
            if (msg) this.#handle(msg);
        };

        ws.onclose = () => {
            if (this.#ws !== ws) return;
            this.#ws = null;
            const state = useDevtoolsStore.getState();
            if (state.relay === 'open') {
                state.addLog({level: 'warn', source: 'ui', message: 'Lost the relay connection, retrying…', deviceId: null});
            }
            this.#scheduleReconnect();
        };
    }

    #scheduleReconnect() {
        useDevtoolsStore.getState().setRelay(this.#wasOpen ? 'reconnecting' : 'connecting');
        if (this.#retryTimer) clearTimeout(this.#retryTimer);
        this.#retryTimer = setTimeout(() => {
            this.#retryTimer = null;
            this.#connect();
        }, this.#retryMs);
        this.#retryMs = Math.min(this.#retryMs * 2, RECONNECT_MAX_MS);
    }

    #reconnectNow() {
        if (this.#retryTimer) clearTimeout(this.#retryTimer);
        this.#retryTimer = null;
        const ws = this.#ws;
        this.#ws = null;
        ws?.close();
        this.#connect();
    }

    #authenticate() {
        if (this.#creds) this.#pendingResumeId = this.send('session.resume', this.#creds);
        else this.send('session.create', {});
    }

    /** Başka bir sekme yeni oturum açtıysa ona geç. */
    #onStorage = (event: StorageEvent) => {
        if (event.key !== STORAGE_KEY) return;
        const next = readCredentials();
        if (!next || next.sessionId === this.#creds?.sessionId) return;
        this.#creds = next;
        this.#reconnectNow();
    };

    #handle(msg: Envelope) {
        // Modül isteğinin cevabı (veya relay'in o isteğe döndüğü hata).
        if (msg.replyTo) {
            const pending = this.#requests.get(msg.replyTo);
            if (pending) {
                clearTimeout(pending.timer);
                this.#requests.delete(msg.replyTo);
                pending.resolve(
                    msg.type === 'error'
                        ? {ok: false, error: msg.payload as {code: string; message: string}}
                        : (msg.payload as ModuleResult),
                );
                return;
            }
        }

        if (msg.deviceId) {
            this.#handleDevice(msg as DeviceMessage);
            return;
        }

        const store = useDevtoolsStore.getState();
        const relayMsg = msg as {[K in keyof RelayToUi]: Envelope<K, RelayToUi[K]>}[keyof RelayToUi];
        switch (relayMsg.type) {
            case 'session': {
                const p = relayMsg.payload;
                const isNew = p.sessionId !== this.#creds?.sessionId;
                this.#creds = {sessionId: p.sessionId, uiSecret: p.uiSecret};
                writeCredentials(this.#creds);
                store.setSession({sessionId: p.sessionId, deviceWsUrl: p.deviceWsUrl, pairing: p.pairing}, p.devices, p.pendingRequests, p.trustedDevices);
                const online = p.devices.filter((d) => d.connected).length;
                store.addLog({
                    level: 'info',
                    source: 'relay',
                    message: `${isNew ? 'Started a new session' : 'Resumed the session'} (${p.devices.length} paired device(s), ${online} online)`,
                    data: {sessionId: p.sessionId},
                    deviceId: null,
                });
                break;
            }
            case 'pairing':
                store.setPairing(relayMsg.payload);
                break;
            case 'device.status':
                this.#handleDeviceStatus(relayMsg.payload);
                break;
            case 'connect.request': {
                const request = relayMsg.payload;
                store.addPendingRequest(request);
                store.addLog({
                    level: 'info',
                    source: 'relay',
                    message: `Connect request from ${request.hello.device.name ?? request.hello.app.name} (${request.via})`,
                    data: request.hello,
                    deviceId: null,
                });
                break;
            }
            case 'connect.resolved':
                store.removePendingRequest(relayMsg.payload.requestId);
                break;
            case 'trusted':
                store.setTrusted(relayMsg.payload.devices);
                break;
            case 'error':
                if (relayMsg.payload.code === 'SESSION_NOT_FOUND' && msg.replyTo === this.#pendingResumeId) {
                    store.addLog({level: 'warn', source: 'relay', message: 'Previous session not found (it may have expired); starting a new one', deviceId: null});
                    this.#creds = null;
                    writeCredentials(null);
                    this.send('session.create', {});
                } else {
                    store.addLog({level: 'error', source: 'relay', message: `${relayMsg.payload.code}: ${relayMsg.payload.message}`, data: relayMsg.payload, deviceId: null});
                }
                break;
        }
    }

    #handleDevice(msg: DeviceMessage) {
        if (msg.type === 'history') {
            const chunk = msg.payload as HistoryChunk;
            for (const [i, entry] of chunk.entries.entries()) {
                this.#emit({...msg, id: `${msg.id}#${i}`, type: entry.type, ts: entry.ts, payload: entry.payload, historic: true});
            }
            useDevtoolsStore.getState().addLog({
                level: 'debug',
                source: 'device',
                message: `Received ${chunk.entries.length} buffered event(s) from before the connection${chunk.final ? '' : '…'}`,
                deviceId: msg.deviceId,
            });
            return;
        }
        this.#emit(msg);
    }

    #emit(msg: DeviceMessage) {
        const store = useDevtoolsStore.getState();
        const {deviceId} = msg;
        switch (msg.type) {
            case 'hello': {
                const known = store.devices[deviceId]?.hello;
                store.setHello(deviceId, msg.payload);
                if (!known) store.addLog({level: 'info', source: 'device', message: `Device info received — ${describeDevice(msg.payload)}`, data: msg.payload, deviceId});
                break;
            }
            case 'capabilities.update':
                store.mergeCapabilities(deviceId, msg.payload);
                break;
            case 'lifecycle': {
                if (msg.historic) break;
                const previous = store.devices[deviceId]?.lifecycle;
                store.setLifecycle(deviceId, msg.payload.state);
                if (msg.payload.state === previous) break;
                if (msg.payload.state === 'background') store.addLog({level: 'warn', source: 'device', message: 'App moved to the background', deviceId});
                else if (msg.payload.state === 'active' && previous === 'background') store.addLog({level: 'info', source: 'device', message: 'App returned to the foreground', deviceId});
                break;
            }
            case 'log': {
                const p = msg.payload;
                const entry = {level: p.level, source: 'device' as const, message: p.message, data: p.data, tag: p.tag, ts: p.at ?? msg.ts, deviceId, historic: msg.historic};
                if (msg.historic) store.addLogs([entry]);
                else store.addLog(entry);
                break;
            }
        }
        for (const listener of this.#listeners) listener(msg);
    }

    #handleDeviceStatus(payload: RelayToUi['device.status']) {
        const store = useDevtoolsStore.getState();
        const {deviceId} = payload;
        const previous = store.devices[deviceId];
        const name = previous ? deviceName(previous) : payload.device ? deviceName(payload.device) : `Device ${deviceId.slice(0, 6)}`;

        if (payload.state === 'unpaired' || !payload.device) {
            if (previous) store.addLog({level: 'info', source: 'relay', message: `${name} was unpaired`, deviceId: null});
            store.removeDevice(deviceId);
            return;
        }
        store.upsertDevice(payload.device);
        if (payload.state === 'connected') {
            store.addLog({level: 'info', source: 'relay', message: previous ? 'Device reconnected' : 'Device paired', deviceId});
        } else {
            store.addLog({
                level: 'warn',
                source: 'relay',
                message: previous?.lifecycle === 'background' ? 'Device disconnected (app was in the background)' : 'Device disconnected (app closed or network lost)',
                deviceId,
            });
        }
    }
}

export const relayClient = new RelayClient();
