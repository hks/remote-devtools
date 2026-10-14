/**
 * Remote DevTools — WebSocket protokolü (v1, KULLANIMDAN KALKIYOR)
 *
 * Sadece UI v2'ye taşınana kadar (Faz 3) derlenebilsin diye tutulur; relay artık v2 konuşur.
 *
 * Relay, web ve mobile-app arasında ortak sözleşme.
 * mobile-app'teki `helpers/developer/remote/RemoteProtocol.ts` bu dosyanın kopyasıdır;
 * burada yapılan değişiklik oraya da taşınmalıdır.
 *
 * Sadece "erasable" TypeScript kullanılır (enum / namespace yok) — Node type stripping ile
 * derlemeden çalışabilmesi için.
 */

export const PROTOCOL_VERSION = 1;

export const WS_PATH_WEB = '/ws/web';
export const WS_PATH_DEVICE = '/ws/device';

// ─── Zarf ────────────────────────────────────────────────────────────────────

export type Envelope<T extends string = string, P = unknown> = {
    v: number;
    type: T;
    /** Mesajın benzersiz id'si (gönderen üretir). Cevaplar `replyTo` ile buna referans verir. */
    id: string;
    /** Gönderim zamanı (epoch ms). */
    ts: number;
    payload: P;
};

/** `{ type: payload }` haritasından tüm olası zarfların union'ını üretir. */
export type MessageOf<M> = { [K in keyof M & string]: Envelope<K, M[K]> }[keyof M & string];

// ─── Ortak tipler ────────────────────────────────────────────────────────────

/** QR kodun içeriği (JSON.stringify edilmiş hali QR'a yazılır). */
export type QrPayload = {
    v: number;
    /** Telefonun bağlanacağı tam adres, ör. `wss://devtools.example.com/ws/device` */
    url: string;
    sessionId: string;
    pairToken: string;
};

export type AppLifecycleState = 'active' | 'background' | 'inactive';

export type DeviceInfo = {
    platform: string;
    osVersion: string;
    appVersion: string;
    buildNumber: string;
    deviceName: string | null;
    userId: number | null;
    apiEndpoint: string;
    /** Telefonun desteklediği `invoke` komut id'leri. */
    commands: string[];
};

export type DeviceSnapshot = {
    connected: boolean;
    pairedAt: number;
    lastSeenAt: number | null;
    info: DeviceInfo | null;
    lifecycle: AppLifecycleState | null;
};

export type NetworkRequest = {
    uuid: string;
    method: string;
    url: string;
    baseURL: string | null;
    headers: Record<string, unknown>;
    params: unknown;
    body: unknown;
    startedAt: number;
};

export type NetworkResponse = {
    uuid: string;
    status: number | null;
    headers: Record<string, unknown> | null;
    body: unknown;
    durationMs: number | null;
    result: 'success' | 'error';
    errorMessage: string | null;
};

export type NetworkEntry = {
    request: NetworkRequest;
    response: NetworkResponse | null;
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ErrorCode =
    | 'BAD_MESSAGE'
    | 'UNSUPPORTED_VERSION'
    | 'NOT_AUTHENTICATED'
    | 'SESSION_NOT_FOUND'
    | 'SESSION_LIMIT'
    | 'INVALID_PAIR_TOKEN'
    | 'PAIR_TOKEN_EXPIRED'
    | 'DEVICE_ALREADY_PAIRED'
    | 'DEVICE_OFFLINE'
    | 'UNKNOWN_TYPE';

export type ErrorPayload = {
    code: ErrorCode;
    message: string;
    replyTo: string | null;
};

// ─── Web ↔ Relay ─────────────────────────────────────────────────────────────

export type WebToRelay = {
    createSession: Record<string, never>;
    resumeSession: { sessionId: string; webSecret: string };
    refreshPairToken: Record<string, never>;
    /** Bağlı cihazın eşleşmesini kaldırır; oturum yeni bir QR ile devam eder. */
    unpair: Record<string, never>;
};

export type RelayToWeb = {
    session: {
        sessionId: string;
        webSecret: string;
        /** Relay'de `PUBLIC_URL` tanımlıysa QR'a yazılacak cihaz adresi; değilse web kendi origin'inden türetir. */
        deviceWsUrl: string | null;
        pairToken: string | null;
        pairTokenExpiresAt: number | null;
        device: DeviceSnapshot | null;
    };
    pairToken: { pairToken: string; expiresAt: number };
    deviceStatus: {
        state: 'connected' | 'disconnected' | 'unpaired';
        at: number;
        device: DeviceSnapshot | null;
    };
    error: ErrorPayload;
};

// ─── Device ↔ Relay ──────────────────────────────────────────────────────────

export type DeviceToRelay = {
    pair: { sessionId: string; pairToken: string };
    resume: { sessionId: string; deviceSecret: string };
    /** Telefon tarafından eşleşmeyi kaldırma (Remote tab → Bağlantıyı kes). */
    unpair: Record<string, never>;
};

export type RelayToDevice = {
    paired: { sessionId: string; deviceSecret: string };
    resumed: { sessionId: string };
    /** Telefon kayıtlı bağlantı bilgisini silmeli. */
    unpaired: { reason: 'unpairedByWeb' | 'unpairedByDevice' | 'sessionNotFound' | 'invalidSecret' | 'sessionExpired' };
    error: ErrorPayload;
};

// ─── Device → Web (relay üzerinden iletilir) ─────────────────────────────────

export type DeviceToWeb = {
    hello: DeviceInfo;
    lifecycle: { state: AppLifecycleState };
    request: NetworkRequest;
    response: NetworkResponse;
    /** Büyük geçmiş relay'in mesaj sınırını aşmasın diye parçalar halinde gönderilir; son parçada `final: true`. */
    syncResult: { replyTo: string; entries: NetworkEntry[]; total: number; final: boolean };
    /** `result`: komutun web'de gösterilecek dönüş değeri (yoksa null). */
    invokeResult: { replyTo: string; commandId: string; ok: boolean; error: string | null; result: unknown };
    log: { level: LogLevel; message: string; data: unknown };
};

// ─── Web → Device (relay üzerinden iletilir) ─────────────────────────────────

export type WebToDevice = {
    sync: Record<string, never>;
    invoke: { commandId: string; args: unknown };
};

// ─── Union'lar & yönlendirme listeleri ───────────────────────────────────────

export type WebOutgoing = MessageOf<WebToRelay> | MessageOf<WebToDevice>;
export type WebIncoming = MessageOf<RelayToWeb> | MessageOf<DeviceToWeb>;
export type DeviceOutgoing = MessageOf<DeviceToRelay> | MessageOf<DeviceToWeb>;
export type DeviceIncoming = MessageOf<RelayToDevice> | MessageOf<WebToDevice>;

/** Relay'in web'den alıp cihaza aynen ilettiği tipler. */
export const WEB_TO_DEVICE_TYPES: readonly (keyof WebToDevice)[] = ['sync', 'invoke'];

/** Relay'in cihazdan alıp web'lere aynen ilettiği tipler. */
export const DEVICE_TO_WEB_TYPES: readonly (keyof DeviceToWeb)[] = [
    'hello',
    'lifecycle',
    'request',
    'response',
    'syncResult',
    'invokeResult',
    'log',
];

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

let counter = 0;

export function createMessageId(): string {
    counter = (counter + 1) % 1_000_000;
    return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEnvelope<T extends string, P>(type: T, payload: P): Envelope<T, P> {
    return { v: PROTOCOL_VERSION, type, id: createMessageId(), ts: Date.now(), payload };
}

/** Gelen ham veriyi zarf olarak doğrular; geçersizse `null` döner. Payload içeriğini doğrulamaz. */
export function parseEnvelope(raw: string): Envelope | null {
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof data !== 'object' || data === null) return null;
    const e = data as Record<string, unknown>;
    if (typeof e.v !== 'number' || typeof e.type !== 'string' || typeof e.id !== 'string' || typeof e.ts !== 'number') {
        return null;
    }
    if (typeof e.payload !== 'object' || e.payload === null) return null;
    return e as unknown as Envelope;
}
