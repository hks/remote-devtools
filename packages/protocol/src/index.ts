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
    | { type: 'select'; label?: string; options: readonly SelectOption[]; default?: string | number; required?: boolean }
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
    group?: string;
    field: Field;
    /** Geçerli değer: override varsa o, yoksa `baseValue`. */
    value: unknown;
    /** Override yokken geçerli olan değer (app'in verdiği değer, yoksa `field.default`). */
    baseValue: unknown;
    overridden: boolean;
};

export type StorageAdapterInfo = {
    id: string;
    title: string;
    /** `set` / `remove` / `clear` destekleniyor mu. */
    editable: boolean;
    /** Değerler hassas: listede önizleme gönderilmez, UI değeri istenene kadar gizler. */
    masked?: boolean;
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
    storage?: { adapters: StorageAdapterInfo[] };
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

/** Bağlantı öncesi tamponlanmış bir mesaj: normalde canlı gönderilecek olan `type` + `payload`. */
export type HistoryEntry = { type: string; payload: unknown; ts: number };

/** Sıra korunur; büyük tamponlar birden çok parçaya bölünür, son parçada `final: true`. */
export type HistoryChunk = { entries: HistoryEntry[]; final: boolean };

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

/** `size`: değerin karakter sayısı. `preview`: kısaltılmış değer (maskeli adapter'da boş). */
export type StorageEntry = { key: string; size: number; preview: string };

export type JsonPatchOp = { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown };

/**
 * State değişikliği. `patch` son gönderilen duruma göre farktır; fark çok büyükse onun yerine tam `state` gelir.
 * `actions`: bu aralıkta adapter'ın bildirdiği action adları (Redux), bilinmiyorsa boş.
 */
export type StateChange = { storeId: string; at: number; actions: string[]; patch?: JsonPatchOp[]; state?: unknown };

export type ModuleMessages = {
    'module.network.request': NetworkRequest;
    'module.network.response': NetworkResponse;

    'module.functions.invoke': { commandId: string; args: Record<string, unknown> };
    'module.functions.result': ModuleResult;

    /** → `{ entries: StorageEntry[] }` */
    'module.storage.list': { adapterId: string };
    /** → `{ value: string | null }` */
    'module.storage.get': { adapterId: string; key: string };
    'module.storage.set': { adapterId: string; key: string; value: string };
    'module.storage.remove': { adapterId: string; key: string };
    'module.storage.clear': { adapterId: string };
    'module.storage.result': ModuleResult;
    /** `key: null` → birden çok anahtar değişti (ör. temizleme), liste yeniden alınmalı. */
    'module.storage.changed': { adapterId: string; key: string | null };

    /** → `{ state }` */
    'module.state.snapshot': { storeId: string };
    /**
     * Değişiklik akışını başlatır veya süresini uzatır (`STATE_SUBSCRIPTION_TTL_MS`). → `{ state }`;
     * `renew: true` ise sadece süre uzar, `state` gönderilmez.
     */
    'module.state.subscribe': { storeId: string; renew?: boolean };
    'module.state.unsubscribe': { storeId: string };
    'module.state.result': ModuleResult;
    'module.state.change': StateChange;

    /** Override verir. → `FlagDef`. Değerler ve override durumu `capabilities.update` ile de gelir. */
    'module.flags.set': { key: string; value: unknown };
    /** `key` yoksa tüm override'lar silinir. */
    'module.flags.reset': { key?: string };
    'module.flags.result': ModuleResult;

    'module.panels.update': { panelId: string; blockId: string; data: Partial<Block> };
    'module.panels.action': { panelId: string; actionId: string; row?: unknown; values?: Record<string, unknown> };
    'module.panels.result': ModuleResult;
};

/** State aboneliği bu süre içinde yenilenmezse cihaz akışı durdurur (UI kapanıp `unsubscribe` gönderemese bile). */
export const STATE_SUBSCRIPTION_TTL_MS = 60_000;

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

// ─── Field DSL doğrulama ─────────────────────────────────────────────────────

export type ArgsValidation = { ok: true; args: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

function optionValues(field: Extract<Field, { type: 'select' }>): (string | number)[] {
    return field.options.map((o) => (typeof o === 'string' ? o : o.value));
}

/**
 * Gelen argümanları alan tanımına göre doğrular. Eksik alanlara `default` uygulanır, tanımsız anahtarlar atılır.
 * SDK'lar handler'ı çağırmadan önce kullanır; böylece UI dışından gelen (veya eski bir UI'ın gönderdiği) değerler de denetlenir.
 */
export function validateArgs(fields: Fields, input: unknown): ArgsValidation {
    const source = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const args: Record<string, unknown> = {};
    const errors: Record<string, string> = {};

    for (const [key, field] of Object.entries(fields)) {
        let value = source[key];
        if (value === undefined || value === null || value === '') {
            if ('default' in field && field.default !== undefined) value = field.default;
            else if (field.type === 'boolean') value = false;
            else {
                if ('required' in field && field.required) errors[key] = 'is required';
                continue;
            }
        }
        switch (field.type) {
            case 'text':
                if (typeof value !== 'string') errors[key] = 'must be a string';
                break;
            case 'number':
                if (typeof value !== 'number' || !Number.isFinite(value)) errors[key] = 'must be a number';
                else if (field.min !== undefined && value < field.min) errors[key] = `must be ≥ ${field.min}`;
                else if (field.max !== undefined && value > field.max) errors[key] = `must be ≤ ${field.max}`;
                break;
            case 'boolean':
                if (typeof value !== 'boolean') errors[key] = 'must be true or false';
                break;
            case 'select':
                if (!optionValues(field).includes(value as string | number)) errors[key] = 'must be one of the options';
                break;
            case 'json':
                break;
        }
        if (!(key in errors)) args[key] = value;
    }
    return Object.keys(errors).length ? {ok: false, errors} : {ok: true, args};
}

// ─── JSON Patch (state modülü) ───────────────────────────────────────────────

export type DiffOptions = {
    /** Yaprak değerleri (ve eklenen alt ağaçları) JSON'a çevirir. Varsayılan: değeri olduğu gibi kullanır. */
    serialize?: (value: unknown) => unknown;
    /** `true` dönen değerler yokmuş gibi davranılır (ör. Zustand store'larındaki fonksiyonlar). */
    skip?: (value: unknown) => boolean;
    /** Bu derinlikten sonra alt ağaç karşılaştırılmaz, değiştiyse tamamen değiştirilir. */
    maxDepth?: number;
    /** Bu kadar işlemi aşınca `null` döner (çağıran tam durumu göndermeli). */
    maxOps?: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function escapePointer(segment: string | number): string {
    return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function parsePointer(path: string): string[] {
    if (path === '') return [];
    return path.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * İki değer arasındaki farkı JSON Patch (RFC 6902; sadece add / remove / replace) olarak üretir.
 * Aynı referanslar karşılaştırılmaz; bu yüzden değişmez (immutable) güncellenen state'lerde ucuzdur.
 * Düz nesneler ve diziler gezilir, diğer her şey yaprak kabul edilir. `maxOps` aşılırsa `null`.
 */
export function diffJson(prev: unknown, next: unknown, options: DiffOptions = {}): JsonPatchOp[] | null {
    const serialize = options.serialize ?? ((v: unknown) => v);
    const skip = options.skip ?? (() => false);
    const maxDepth = options.maxDepth ?? 32;
    const maxOps = options.maxOps ?? Infinity;
    const ops: JsonPatchOp[] = [];

    function walk(a: unknown, b: unknown, path: string, depth: number): boolean {
        if (a === b) return true;
        const bothArrays = Array.isArray(a) && Array.isArray(b);
        const bothObjects = isPlainObject(a) && isPlainObject(b);
        if (depth >= maxDepth || (!bothArrays && !bothObjects)) {
            // Farklı referanslı ama aynı serileşen yapraklar (ör. aynı ana ait iki Date) değişmemiş sayılır.
            const leaf = !isPlainObject(a) && !Array.isArray(a);
            if (leaf && Object.is(serialize(a), serialize(b))) return true;
            ops.push({op: 'replace', path, value: serialize(b)});
            return ops.length <= maxOps;
        }
        if (bothArrays) {
            const x = a as unknown[];
            const y = b as unknown[];
            const common = Math.min(x.length, y.length);
            for (let i = 0; i < common; i++) if (!walk(x[i], y[i], `${path}/${i}`, depth + 1)) return false;
            for (let i = common; i < y.length; i++) {
                ops.push({op: 'add', path: `${path}/${i}`, value: serialize(y[i]) ?? null});
                if (ops.length > maxOps) return false;
            }
            // Sondan başa: her silme sonraki indeksleri kaydırmasın.
            for (let i = x.length - 1; i >= common; i--) {
                ops.push({op: 'remove', path: `${path}/${i}`});
                if (ops.length > maxOps) return false;
            }
            return true;
        }
        const x = a as Record<string, unknown>;
        const y = b as Record<string, unknown>;
        for (const key of Object.keys(x)) {
            if (skip(x[key]) || x[key] === undefined) continue;
            const childPath = `${path}/${escapePointer(key)}`;
            if (!(key in y) || skip(y[key]) || y[key] === undefined) {
                ops.push({op: 'remove', path: childPath});
                if (ops.length > maxOps) return false;
            } else if (!walk(x[key], y[key], childPath, depth + 1)) return false;
        }
        for (const key of Object.keys(y)) {
            if (skip(y[key]) || y[key] === undefined) continue;
            if (key in x && !skip(x[key]) && x[key] !== undefined) continue;
            ops.push({op: 'add', path: `${path}/${escapePointer(key)}`, value: serialize(y[key])});
            if (ops.length > maxOps) return false;
        }
        return true;
    }

    return walk(prev, next, '', 0) ? ops : null;
}

/** JSON pointer ile değere ulaşır; yoksa `undefined`. */
export function getAtPointer(doc: unknown, path: string): unknown {
    let current = doc;
    for (const segment of parsePointer(path)) {
        if (current === null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}

/**
 * Patch'i uygular ve yeni bir değer döner (değişen yol boyunca kopyalanır, diğer dallar paylaşılır).
 * Geçersiz bir yol hata fırlatır.
 */
export function applyPatch(doc: unknown, patch: readonly JsonPatchOp[]): unknown {
    let root = doc;
    for (const op of patch) {
        const segments = parsePointer(op.path);
        if (segments.length === 0) {
            if (op.op === 'remove') throw new Error('Cannot remove the root');
            root = op.value;
            continue;
        }
        root = applyAt(root, segments, op);
    }
    return root;
}

function applyAt(node: unknown, segments: string[], op: JsonPatchOp): unknown {
    const [head, ...rest] = segments as [string, ...string[]];
    if (Array.isArray(node)) {
        const copy = node.slice();
        const index = head === '-' ? copy.length : Number(head);
        if (!Number.isInteger(index) || index < 0 || index > copy.length) throw new Error(`Invalid array index "${head}"`);
        if (rest.length) copy[index] = applyAt(copy[index], rest, op);
        else if (op.op === 'add') copy.splice(index, 0, op.value);
        else if (op.op === 'remove') copy.splice(index, 1);
        else copy[index] = op.value;
        return copy;
    }
    if (node === null || typeof node !== 'object') throw new Error(`Path segment "${head}" does not exist`);
    const copy: Record<string, unknown> = {...(node as Record<string, unknown>)};
    if (rest.length) copy[head] = applyAt(copy[head], rest, op);
    else if (op.op === 'remove') delete copy[head];
    else copy[head] = op.value;
    return copy;
}
