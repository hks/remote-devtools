export type ConnectRequestPolicy = 'off' | 'local' | 'any';

export type RelayConfig = {
    port: number;
    host: string;
    /** Cihazın göreceği dış adres (ör. `https://devtools.example.com`). Boşsa UI kendi origin'ini kullanır. */
    publicUrl: string | null;
    /** Build edilmiş UI'ın klasörü. Yoksa statik sunum devre dışı. */
    webDistDir: string | null;
    /** Hiçbir UI'ın bağlı olmadığı oturum bu süre sonra silinir. */
    sessionTtlMs: number;
    /** QR token'ı ve 6 haneli kodun geçerlilik süresi. */
    pairingTtlMs: number;
    /**
     * Cihaz eşleşmesinin hareketsizlik süresi. Bağlıyken düşmez; her mesaj ve bağlantının kopması süreyi yeniden başlatır.
     * Cihaz bu süre boyunca bağlanmazsa eşleşme unutulur ve `resume` reddedilir.
     */
    deviceIdleTtlMs: number;
    /** Bekleyen bağlantı isteğinin UI'da cevaplanma süresi. */
    connectRequestTtlMs: number;
    /**
     * Kodsuz/QR'sız `connect` isteklerinin kabulü:
     * `off` kapalı, `local` sadece loopback/özel ağ adreslerinden, `any` her yerden.
     */
    connectRequests: ConnectRequestPolicy;
    /** `X-Forwarded-For` başlığına güvenilsin mi (reverse proxy arkasında). */
    trustProxy: boolean;
    heartbeatIntervalMs: number;
    /** Bağlanan soketin kimlik doğrulaması için verilen süre. */
    authTimeoutMs: number;
    maxPayloadBytes: number;
    maxSessions: number;
    maxDevicesPerSession: number;
    /** Cihaz başına saniyede kabul edilen mesaj sayısı; aşan mesajlar düşürülür. */
    deviceMaxMessagesPerSec: number;
    /** Bir IP'nin pencere içinde yapabileceği başarısız eşleşme denemesi. */
    pairFailureLimit: number;
    pairFailureWindowMs: number;
    gcIntervalMs: number;
    /** Bağlantı metadata'sının (oturumlar, eşleşmeler, onaylı cihazlar) saklanacağı dosya. Boşsa sadece bellek. */
    stateFile: string | null;
};

export const defaultConfig: RelayConfig = {
    port: 8080,
    host: '0.0.0.0',
    publicUrl: null,
    webDistDir: null,
    sessionTtlMs: 24 * 60 * 60 * 1000,
    pairingTtlMs: 120 * 1000,
    deviceIdleTtlMs: 60 * 60 * 1000,
    connectRequestTtlMs: 120 * 1000,
    connectRequests: 'off',
    trustProxy: false,
    heartbeatIntervalMs: 15 * 1000,
    authTimeoutMs: 10 * 1000,
    maxPayloadBytes: 5 * 1024 * 1024,
    maxSessions: 1000,
    maxDevicesPerSession: 20,
    deviceMaxMessagesPerSec: 200,
    pairFailureLimit: 10,
    pairFailureWindowMs: 10 * 60 * 1000,
    gcIntervalMs: 60 * 1000,
    stateFile: null,
};

type Env = Record<string, string | undefined>;

function num(env: Env, name: string, fallback: number, scale = 1): number {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid number for ${name}: ${raw}`);
    }
    return value * scale;
}

function str(env: Env, name: string): string | null {
    const raw = env[name]?.trim();
    return raw ? raw : null;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
    const raw = str(env, name);
    if (raw === null) return fallback;
    if (['1', 'true', 'yes'].includes(raw.toLowerCase())) return true;
    if (['0', 'false', 'no'].includes(raw.toLowerCase())) return false;
    throw new Error(`Invalid boolean for ${name}: ${raw}`);
}

function policy(env: Env, name: string, fallback: ConnectRequestPolicy): ConnectRequestPolicy {
    const raw = str(env, name);
    if (raw === null) return fallback;
    if (raw === 'off' || raw === 'local' || raw === 'any') return raw;
    throw new Error(`Invalid value for ${name}: ${raw} (expected off | local | any)`);
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

export function loadConfig(env: Env = process.env): RelayConfig {
    const d = defaultConfig;
    return {
        port: num(env, 'PORT', d.port),
        host: str(env, 'HOST') ?? d.host,
        publicUrl: str(env, 'PUBLIC_URL')?.replace(/\/+$/, '') ?? null,
        webDistDir: str(env, 'WEB_DIST_DIR'),
        sessionTtlMs: num(env, 'SESSION_TTL_HOURS', d.sessionTtlMs, HOUR),
        pairingTtlMs: num(env, 'PAIR_TOKEN_TTL_SEC', d.pairingTtlMs, SEC),
        deviceIdleTtlMs: num(env, 'DEVICE_IDLE_TTL_MIN', d.deviceIdleTtlMs, MIN),
        connectRequestTtlMs: num(env, 'CONNECT_REQUEST_TTL_SEC', d.connectRequestTtlMs, SEC),
        connectRequests: policy(env, 'CONNECT_REQUESTS', d.connectRequests),
        trustProxy: bool(env, 'TRUST_PROXY', d.trustProxy),
        heartbeatIntervalMs: num(env, 'HEARTBEAT_INTERVAL_SEC', d.heartbeatIntervalMs, SEC),
        authTimeoutMs: num(env, 'AUTH_TIMEOUT_SEC', d.authTimeoutMs, SEC),
        maxPayloadBytes: num(env, 'MAX_PAYLOAD_MB', d.maxPayloadBytes, 1024 * 1024),
        maxSessions: num(env, 'MAX_SESSIONS', d.maxSessions),
        maxDevicesPerSession: num(env, 'MAX_DEVICES_PER_SESSION', d.maxDevicesPerSession),
        deviceMaxMessagesPerSec: num(env, 'DEVICE_MAX_MSGS_PER_SEC', d.deviceMaxMessagesPerSec),
        pairFailureLimit: num(env, 'PAIR_FAILURE_LIMIT', d.pairFailureLimit),
        pairFailureWindowMs: num(env, 'PAIR_FAILURE_WINDOW_SEC', d.pairFailureWindowMs, SEC),
        gcIntervalMs: num(env, 'GC_INTERVAL_SEC', d.gcIntervalMs, SEC),
        stateFile: str(env, 'STATE_FILE'),
    };
}
