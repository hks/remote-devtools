export type RelayConfig = {
    port: number;
    host: string;
    /** Telefonun göreceği dış adres (ör. `https://devtools.example.com`). Boşsa web kendi origin'ini kullanır. */
    publicUrl: string | null;
    /** Build edilmiş web arayüzünün klasörü. Yoksa statik sunum devre dışı. */
    webDistDir: string | null;
    sessionTtlMs: number;
    pairTokenTtlMs: number;
    heartbeatIntervalMs: number;
    /** Bağlanan soketin kimlik doğrulaması için verilen süre. */
    authTimeoutMs: number;
    maxPayloadBytes: number;
    maxSessions: number;
    gcIntervalMs: number;
};

function num(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid number for ${name}: ${raw}`);
    }
    return value;
}

function str(name: string): string | null {
    const raw = process.env[name]?.trim();
    return raw ? raw : null;
}

export function loadConfig(): RelayConfig {
    return {
        port: num('PORT', 8080),
        host: str('HOST') ?? '0.0.0.0',
        publicUrl: str('PUBLIC_URL')?.replace(/\/+$/, '') ?? null,
        webDistDir: str('WEB_DIST_DIR'),
        sessionTtlMs: num('SESSION_TTL_HOURS', 24) * 60 * 60 * 1000,
        pairTokenTtlMs: num('PAIR_TOKEN_TTL_SEC', 120) * 1000,
        heartbeatIntervalMs: num('HEARTBEAT_INTERVAL_SEC', 15) * 1000,
        authTimeoutMs: num('AUTH_TIMEOUT_SEC', 10) * 1000,
        maxPayloadBytes: num('MAX_PAYLOAD_MB', 5) * 1024 * 1024,
        maxSessions: num('MAX_SESSIONS', 1000),
        gcIntervalMs: num('GC_INTERVAL_SEC', 600) * 1000,
    };
}
