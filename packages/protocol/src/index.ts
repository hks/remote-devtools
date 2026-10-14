/**
 * Remote DevTools — WebSocket protokolü (v2)
 *
 * Relay, UI ve tüm SDK'lar arasındaki sözleşme. İnsan okunur sürümü: docs/v2/PROTOCOL.md.
 * Swift / Kotlin / Flutter SDK'ları bu dosyaya değil o dokümana bağlıdır; ikisi birlikte güncellenmelidir.
 *
 * Sadece "erasable" TypeScript kullanılır (enum / namespace yok) — Node type stripping ile
 * derlemeden çalışabilmesi için.
 */

export const PROTOCOL_VERSION = 2;

export const WS_PATH_UI = '/ws/ui';
export const WS_PATH_DEVICE = '/ws/device';
export const DISCOVERY_PATH = '/discovery';
/** Opsiyonel mDNS keşfi için servis tipi. */
export const MDNS_SERVICE_TYPE = '_remotedevtools._tcp';

// ─── Zarf ────────────────────────────────────────────────────────────────────

export type Envelope<T extends string = string, P = unknown> = {
    v: number;
    type: T;
    /** Mesajın benzersiz id'si (gönderen üretir). */
    id: string;
    /** Gönderim zamanı (epoch ms). */
    ts: number;
    /** Bir isteğe cevapsa, isteğin `id`'si. */
    replyTo?: string;
    /**
     * UI ↔ relay yönünde ilgili cihaz: UI'dan cihaza giderken hedef, cihazdan gelirken kaynak.
     * Cihaz bağlantısında relay tarafından doldurulur; cihazın gönderdiği değer dikkate alınmaz.
     */
    deviceId?: string;
    payload: P;
};

/** `{ type: payload }` haritasından tüm olası zarfların union'ını üretir. */
export type MessageOf<M> = { [K in keyof M & string]: Envelope<K, M[K]> }[keyof M & string];

// ─── Field DSL ───────────────────────────────────────────────────────────────

export type SelectOption = string | { label: string; value: string | number };

/** Komut argümanları, flag'ler ve form blokları için ortak alan tanımı. */
export type Field =
    | { type: 'text'; label?: string; placeholder?: string; multiline?: boolean; default?: string; required?: boolean }
    | { type: 'number'; label?: string; min?: number; max?: number; step?: number; default?: number; required?: boolean }
    | { type: 'boolean'; label?: string; default?: boolean }
    | { type: 'select'; label?: string; options: SelectOption[]; default?: string | number; required?: boolean }
    | { type: 'json'; label?: string; default?: unknown };

/** Anahtar = argüman adı; sıra korunur. */
export type Fields = Record<string, Field>;

// ─── Yetenekler (hello) ──────────────────────────────────────────────────────

export type Lifecycle = 'active' | 'background' | 'inactive';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = { level: LogLevel; message: string; data?: unknown; tag?: string; at: number };

export type CommandDef = {
    id: string;
    title: string;
    description?: string;
    group?: string;
    /** Varsa çalıştırmadan önce bu metinle onay istenir. */
    confirm?: string;
    danger?: boolean;
    args?: Fields;
};

export type FlagDef = {
    key: string;
    title?: string;
    description?: string;
    field: Field;
    value: unknown;
    overridden: boolean;
};

export type ActionDef = { id: string; label: string; confirm?: string; danger?: boolean };

export type Block =
    | { id: string; type: 'keyValue'; title?: string; data: Record<string, string | number | boolean | null> }
    | {
          id: string;
          type: 'table';
          title?: string;
          columns: { key: string; title: string }[];
          rows: Record<string, unknown>[];
          rowActions?: ActionDef[];
      }
    | { id: string; type: 'json'; title?: string; data: unknown }
    | { id: string; type: 'actions'; title?: string; actions: ActionDef[] }
    | { id: string; type: 'form'; title?: string; fields: Fields; submit: { actionId: string; label: string } };

export type PanelDef = { id: string; title: string; icon?: string; blocks: Block[] };

export type Capabilities = {
    network?: { autoCapture: boolean };
    functions?: { commands: CommandDef[] };
    storage?: { adapters: { id: string; title: string; editable: boolean }[] };
    state?: { stores: { id: string; title: string }[] };
    flags?: { flags: FlagDef[] };
    panels?: PanelDef[];
    /** İleride eklenecek modüller. UI tanımadığı anahtarları yok sayar. */
    [custom: string]: unknown;
};

export type Hello = {
    app: { id: string; name: string; version: string; build?: string };
    device: { platform: string; os: string; model?: string; name?: string };
    /** ör. `{ name: '@himmetkaan/remote-devtools', version: '0.1.0' }` */
    sdk: { name: string; version: string };
    isDevelopment: boolean;
    /** Developer'ın serbest alanları (userId, apiEndpoint, env…). UI cihaz kartında gösterir. */
    meta: Record<string, string>;
    capabilities: Capabilities;
};

// ─── Oturum / cihaz durumları ────────────────────────────────────────────────

/** QR kodun içeriği (JSON.stringify edilmiş hali QR'a yazılır). */
export type QrPayload = {
    v: number;
    /** Cihazın bağlanacağı tam adres, ör. `wss://devtools.example.com/ws/device` */
    url: string;
    sessionId: string;
    qrToken: string;
};

/** QR token'ı ve 6 haneli kod birlikte üretilir, ikisi de tek kullanımlıktır ve aynı anda düşer. */
export type PairingInfo = { qrToken: string; code: string; expiresAt: number };

export type ConnectVia = 'local' | 'remote';

export type ConnectRequest = {
    requestId: string;
    deviceId: string;
    hello: Hello;
    /** Bağlantının geldiği adres sınıfı (loopback/özel ağ = `local`). */
    via: ConnectVia;
    at: number;
    expiresAt: number;
};

export type DeviceSnapshot = {
    deviceId: string;
    connected: boolean;
    pairedAt: number;
    /** Eşleşmenin düşeceği an; bundan sonra `resume` reddedilir. */
    expiresAt: number;
    lastSeenAt: number | null;
    hello: Hello | null;
    lifecycle: Lifecycle | null;
};

export type TrustedDevice = { deviceId: string; appId: string; name: string; trustedAt: number };

export type UnpairReason = 'byUi' | 'byDevice' | 'expired' | 'sessionNotFound' | 'invalidSecret' | 'replaced';

export type ConnectRejectReason = 'rejected' | 'expired' | 'disabled' | 'noSession' | 'deviceLimit';

export type ConnectOutcome = 'approved' | 'rejected' | 'expired' | 'cancelled';

export type ErrorCode =
    | 'BAD_MESSAGE'
    | 'UNSUPPORTED_VERSION'
    | 'NOT_AUTHENTICATED'
    | 'SESSION_NOT_FOUND'
    | 'SESSION_LIMIT'
    | 'DEVICE_LIMIT'
    | 'INVALID_PAIR_TOKEN'
    | 'PAIR_TOKEN_EXPIRED'
    | 'INVALID_CODE'
    | 'RATE_LIMITED'
    | 'DEVICE_NOT_FOUND'
    | 'DEVICE_OFFLINE'
    | 'REQUEST_NOT_FOUND'
    | 'UNKNOWN_TYPE';

export type ErrorPayload = { code: ErrorCode; message: string };

// ─── UI ↔ Relay ──────────────────────────────────────────────────────────────

export type UiToRelay = {
    'session.create': Record<string, never>;
    'session.resume': { sessionId: string; uiSecret: string };
    /** Mevcut QR token'ını ve kodu geçersiz kılıp yenilerini üretir. */
    'pairing.refresh': Record<string, never>;
    /** `trust: true` ise cihaz onaylı listeye eklenir ve sonraki isteklerinde onay sorulmaz. */
    'connect.respond': { requestId: string; approve: boolean; trust: boolean };
    'device.unpair': { deviceId: string };
    'trusted.remove': { deviceId: string };
};

export type RelayToUi = {
    session: {
        sessionId: string;
        uiSecret: string;
        /** Relay'de `PUBLIC_URL` tanımlıysa QR'a yazılacak cihaz adresi; değilse UI kendi origin'inden türetir. */
        deviceWsUrl: string | null;
        pairing: PairingInfo;
        devices: DeviceSnapshot[];
        pendingRequests: ConnectRequest[];
        trustedDevices: TrustedDevice[];
    };
    pairing: PairingInfo;
    'device.status': {
        deviceId: string;
        state: 'connected' | 'disconnected' | 'unpaired';
        /** `unpaired` durumunda `null`. */
        device: DeviceSnapshot | null;
    };
    'connect.request': ConnectRequest;
    /** Bekleyen istek listeden çıkar (başka bir UI sekmesinde cevaplanmış, süresi dolmuş veya cihaz vazgeçmiş olabilir). */
    'connect.resolved': { requestId: string; outcome: ConnectOutcome };
    trusted: { devices: TrustedDevice[] };
    error: ErrorPayload;
};

// ─── Device ↔ Relay ──────────────────────────────────────────────────────────

export type DeviceToRelay = {
    'pair.qr': { sessionId: string; qrToken: string; deviceId: string };
    'pair.code': { code: string; deviceId: string };
    /** Sadece `isDevelopment` cihazlar (localhost / LAN keşfi). Relay UI'dan onay ister. */
    connect: { deviceId: string; hello: Hello };
    resume: { sessionId: string; deviceId: string; deviceSecret: string };
    unpair: Record<string, never>;
};

export type RelayToDevice = {
    paired: { sessionId: string; deviceSecret: string; expiresAt: number };
    resumed: { sessionId: string; expiresAt: number };
    'connect.pending': { requestId: string; expiresAt: number };
    'connect.rejected': { requestId: string | null; reason: ConnectRejectReason };
    /** Cihaz sakladığı bağlantı bilgisini silmeli. */
    unpaired: { reason: UnpairReason };
    error: ErrorPayload;
};

// ─── Device → UI çekirdek mesajları (relay iletir) ───────────────────────────

export type HistoryChunk = { logs: LogEntry[]; modules: Record<string, unknown[]>; final: boolean };

export type DeviceToUi = {
    /** Her bağlantı/resume sonrası cihazın ilk mesajı. */
    hello: Hello;
    'capabilities.update': Partial<Capabilities>;
    lifecycle: { state: Lifecycle };
    log: LogEntry;
    /** `history.enabled` ise bağlantı öncesi tampon, bağlanınca parça parça gönderilir. */
    history: HistoryChunk;
};

/** Relay'in cihazdan alıp UI'lara (deviceId ekleyerek) ilettiği çekirdek tipler. Ayrıca tüm `module.*` tipleri iletilir. */
export const DEVICE_TO_UI_TYPES: readonly (keyof DeviceToUi)[] = ['hello', 'capabilities.update', 'lifecycle', 'log', 'history'];

// ─── Modül mesajları (relay içeriğine bakmaz) ────────────────────────────────

export const MODULE_TYPE_PREFIX = 'module.';

/** UI → Device isteklerinin ortak cevap biçimi (`replyTo` ile döner). */
export type ModuleResult<R = unknown> = { ok: true; result: R } | { ok: false; error: { code: string; message: string } };

export type NetworkRequest = {
    uuid: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
    startedAt: number;
};

export type NetworkResponse = {
    uuid: string;
    status: number | null;
    headers: Record<string, string> | null;
    body: unknown;
    durationMs: number | null;
    result: 'success' | 'error';
    errorMessage: string | null;
    bodyTruncated?: { originalSize: number };
};

export type StorageEntry = { key: string; size: number; preview: string };

export type JsonPatchOp = { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown };

export type ModuleMessages = {
    'module.network.request': NetworkRequest;
    'module.network.response': NetworkResponse;

    'module.functions.invoke': { commandId: string; args: Record<string, unknown> };
    'module.functions.result': ModuleResult;

    'module.storage.list': { adapterId: string };
    'module.storage.get': { adapterId: string; key: string };
    'module.storage.set': { adapterId: string; key: string; value: unknown };
    'module.storage.remove': { adapterId: string; key: string };
    'module.storage.result': ModuleResult;
    'module.storage.changed': { adapterId: string; key: string };

    'module.state.snapshot': { storeId: string };
    'module.state.subscribe': { storeId: string };
    'module.state.unsubscribe': { storeId: string };
    'module.state.result': ModuleResult;
    'module.state.change': { storeId: string; action?: string; state?: unknown; patch?: JsonPatchOp[] };

    'module.flags.set': { key: string; value: unknown };
    'module.flags.reset': { key?: string };
    'module.flags.result': ModuleResult;
    'module.flags.changed': { key: string; value: unknown; overridden: boolean };

    'module.panels.update': { panelId: string; blockId: string; data: Partial<Block> };
    'module.panels.action': { panelId: string; actionId: string; row?: unknown; values?: Record<string, unknown> };
    'module.panels.result': ModuleResult;
};

export function isModuleType(type: string): boolean {
    return type.startsWith(MODULE_TYPE_PREFIX) && type.length > MODULE_TYPE_PREFIX.length;
}

// ─── Union'lar ───────────────────────────────────────────────────────────────

export type UiOutgoing = MessageOf<UiToRelay> | MessageOf<ModuleMessages>;
export type UiIncoming = MessageOf<RelayToUi> | MessageOf<DeviceToUi> | MessageOf<ModuleMessages>;
export type DeviceOutgoing = MessageOf<DeviceToRelay> | MessageOf<DeviceToUi> | MessageOf<ModuleMessages>;
export type DeviceIncoming = MessageOf<RelayToDevice> | MessageOf<ModuleMessages>;

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

let counter = 0;

export function createMessageId(): string {
    counter = (counter + 1) % 1_000_000;
    return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEnvelope<T extends string, P>(
    type: T,
    payload: P,
    extra: { replyTo?: string; deviceId?: string } = {},
): Envelope<T, P> {
    const env: Envelope<T, P> = {v: PROTOCOL_VERSION, type, id: createMessageId(), ts: Date.now(), payload};
    if (extra.replyTo !== undefined) env.replyTo = extra.replyTo;
    if (extra.deviceId !== undefined) env.deviceId = extra.deviceId;
    return env;
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
    if (e.replyTo !== undefined && typeof e.replyTo !== 'string') return null;
    if (e.deviceId !== undefined && typeof e.deviceId !== 'string') return null;
    if (typeof e.payload !== 'object' || e.payload === null) return null;
    return e as unknown as Envelope;
}

/** `deviceId` SDK tarafından üretilir ve kurulum boyunca sabittir. */
export function isValidDeviceId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

/** QR içeriğini çözer; geçersizse `null`. */
export function parseQrPayload(raw: string): QrPayload | null {
    try {
        const data = JSON.parse(raw) as Partial<QrPayload>;
        if (
            typeof data.v === 'number' &&
            typeof data.url === 'string' &&
            typeof data.sessionId === 'string' &&
            typeof data.qrToken === 'string'
        ) {
            return data as QrPayload;
        }
    } catch {
        // geçersiz JSON
    }
    return null;
}
