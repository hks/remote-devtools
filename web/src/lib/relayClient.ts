import {
    createEnvelope,
    type DeviceToWeb,
    type MessageOf,
    parseEnvelope,
    type RelayToWeb,
    type WebToDevice,
    type WebToRelay,
    WS_PATH_DEVICE,
    WS_PATH_WEB,
} from '../../../shared/protocol.ts';
import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';
import {describeDevice} from './format.ts';

type Credentials = {sessionId: string; webSecret: string};
type Incoming = MessageOf<RelayToWeb> | MessageOf<DeviceToWeb>;
type Listener = (msg: Incoming) => void;

/** Aynı tarayıcı = tek oturum; incognito'nun localStorage'ı ayrı olduğundan orada yeni oturum açılır. */
const STORAGE_KEY = 'remote-devtools.session.v1';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;

function readCredentials(): Credentials | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<Credentials>;
        return parsed.sessionId && parsed.webSecret ? {sessionId: parsed.sessionId, webSecret: parsed.webSecret} : null;
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

class RelayClient {
    #ws: WebSocket | null = null;
    #creds: Credentials | null = readCredentials();
    #retryMs = RECONNECT_MIN_MS;
    #retryTimer: ReturnType<typeof setTimeout> | null = null;
    #pendingResumeId: string | null = null;
    #wasOpen = false;
    #started = false;
    #listeners = new Set<Listener>();

    start() {
        if (this.#started) return;
        this.#started = true;
        window.addEventListener('storage', this.#onStorage);
        this.#connect();
    }

    /** Relay'e veya (relay üzerinden) cihaza mesaj gönderir. Bağlantı yoksa `null` döner. */
    send<K extends (keyof WebToRelay | keyof WebToDevice) & string>(
        type: K,
        payload: K extends keyof WebToRelay ? WebToRelay[K] : K extends keyof WebToDevice ? WebToDevice[K] : never,
    ): string | null {
        if (this.#ws?.readyState !== WebSocket.OPEN) return null;
        const envelope = createEnvelope(type, payload);
        this.#ws.send(JSON.stringify(envelope));
        return envelope.id;
    }

    /** Faz 4/5'te Service Requests ve Functions tabları bu kanal üzerinden mesaj dinler. */
    subscribe(listener: Listener): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    #connect() {
        const store = useDevtoolsStore.getState();
        store.setRelay(this.#wasOpen ? 'reconnecting' : 'connecting');

        const ws = new WebSocket(relayWsUrl(WS_PATH_WEB));
        this.#ws = ws;

        ws.onopen = () => {
            this.#retryMs = RECONNECT_MIN_MS;
            if (this.#wasOpen) store.addLog({level: 'info', source: 'web', message: "Relay'e yeniden bağlanıldı"});
            this.#wasOpen = true;
            useDevtoolsStore.getState().setRelay('open');
            this.#authenticate();
        };

        ws.onmessage = (event) => {
            const msg = typeof event.data === 'string' ? parseEnvelope(event.data) : null;
            if (msg) this.#handle(msg as Incoming);
        };

        ws.onclose = () => {
            if (this.#ws !== ws) return;
            this.#ws = null;
            const state = useDevtoolsStore.getState();
            if (state.relay === 'open') {
                state.addLog({level: 'warn', source: 'web', message: 'Relay bağlantısı koptu, yeniden deneniyor…'});
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
        if (this.#creds) {
            this.#pendingResumeId = this.send('resumeSession', this.#creds);
        } else {
            this.send('createSession', {});
        }
    }

    /** Başka bir sekme yeni oturum açtıysa ona geç. */
    #onStorage = (event: StorageEvent) => {
        if (event.key !== STORAGE_KEY) return;
        const next = readCredentials();
        if (!next || next.sessionId === this.#creds?.sessionId) return;
        this.#creds = next;
        this.#reconnectNow();
    };

    #handle(msg: Incoming) {
        const store = useDevtoolsStore.getState();

        switch (msg.type) {
            case 'session': {
                const p = msg.payload;
                const isNew = p.sessionId !== this.#creds?.sessionId;
                this.#creds = {sessionId: p.sessionId, webSecret: p.webSecret};
                writeCredentials(this.#creds);
                store.setPairing({
                    sessionId: p.sessionId,
                    deviceWsUrl: p.deviceWsUrl,
                    pairToken: p.pairToken,
                    pairTokenExpiresAt: p.pairTokenExpiresAt,
                });
                store.setDevice(p.device);
                const deviceText = p.device
                    ? p.device.connected ? 'cihaz bağlı' : 'cihaz eşleşmiş, şu an bağlı değil'
                    : 'cihaz bekleniyor';
                store.addLog({
                    level: 'info',
                    source: 'relay',
                    message: `${isNew ? 'Yeni oturum açıldı' : 'Oturuma bağlanıldı'} (${deviceText})`,
                    data: {sessionId: p.sessionId},
                });
                break;
            }
            case 'pairToken':
                store.setPairToken(msg.payload.pairToken, msg.payload.expiresAt);
                break;
            case 'deviceStatus':
                this.#handleDeviceStatus(msg.payload);
                break;
            case 'error':
                if (msg.payload.code === 'SESSION_NOT_FOUND' && msg.payload.replyTo === this.#pendingResumeId) {
                    store.addLog({level: 'warn', source: 'relay', message: 'Önceki oturum bulunamadı (süresi dolmuş olabilir), yeni oturum açılıyor'});
                    this.#creds = null;
                    writeCredentials(null);
                    this.send('createSession', {});
                } else {
                    store.addLog({level: 'error', source: 'relay', message: `${msg.payload.code}: ${msg.payload.message}`, data: msg.payload});
                }
                break;
            case 'hello':
                store.setDeviceInfo(msg.payload);
                store.addLog({level: 'info', source: 'device', message: `Cihaz bilgisi alındı — ${describeDevice(msg.payload)}`, data: msg.payload});
                break;
            case 'lifecycle': {
                const previous = store.device?.lifecycle;
                store.setLifecycle(msg.payload.state);
                if (msg.payload.state === 'background') {
                    store.addLog({level: 'warn', source: 'device', message: 'Uygulama arka plana alındı'});
                } else if (msg.payload.state === 'active') {
                    store.addLog({level: 'info', source: 'device', message: previous === 'background' ? 'Uygulama ön plana geldi' : 'Uygulama aktif'});
                } else {
                    store.addLog({level: 'debug', source: 'device', message: 'Uygulama inactive durumda'});
                }
                break;
            }
            case 'log':
                store.addLog({level: msg.payload.level, source: 'device', message: msg.payload.message, data: msg.payload.data ?? undefined});
                break;
            default:
                break;
        }

        for (const listener of this.#listeners) listener(msg);
    }

    #handleDeviceStatus(payload: RelayToWeb['deviceStatus']) {
        const store = useDevtoolsStore.getState();
        const wasBackground = store.device?.lifecycle === 'background';
        store.setDevice(payload.device);

        switch (payload.state) {
            case 'connected':
                store.addLog({level: 'info', source: 'relay', message: 'Cihaz bağlandı', ts: payload.at});
                break;
            case 'disconnected':
                store.addLog({
                    level: 'warn',
                    source: 'relay',
                    message: wasBackground
                        ? 'Cihaz bağlantısı koptu (uygulama arka plandaydı)'
                        : 'Cihaz bağlantısı koptu (uygulama kapandı veya ağ gitti)',
                    ts: payload.at,
                });
                break;
            case 'unpaired':
                store.addLog({level: 'info', source: 'relay', message: 'Cihaz eşleşmesi kaldırıldı', ts: payload.at});
                break;
        }
    }
}

export const relayClient = new RelayClient();
