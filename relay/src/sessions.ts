import type {AppLifecycleState, DeviceInfo, DeviceSnapshot} from '../../shared/protocol.ts';
import {randomToken, safeEqual} from './secrets.ts';

/** Relay'in mesaj gönderebildiği uç (WebSocket'in ihtiyaç duyduğumuz alt kümesi). */
export type Peer = {
    send(data: string): void;
    close(code?: number, reason?: string): void;
};

export type Session = {
    id: string;
    webSecret: string;
    createdAt: number;
    /** Son kez en az bir web sekmesinin bağlı olduğu an — TTL buna göre hesaplanır. */
    lastWebSeenAt: number;
    webs: Set<Peer>;

    pairToken: string | null;
    pairTokenExpiresAt: number | null;

    /** `null` ise cihaz eşleşmemiş demektir. */
    deviceSecret: string | null;
    pairedAt: number | null;
    device: Peer | null;
    deviceLastSeenAt: number | null;
    deviceInfo: DeviceInfo | null;
    lifecycle: AppLifecycleState | null;
};

export type PairResult =
    | { ok: true; deviceSecret: string }
    | { ok: false; code: 'SESSION_NOT_FOUND' | 'INVALID_PAIR_TOKEN' | 'PAIR_TOKEN_EXPIRED' | 'DEVICE_ALREADY_PAIRED' };

export type SessionStoreOptions = {
    pairTokenTtlMs: number;
    sessionTtlMs: number;
    maxSessions: number;
    now?: () => number;
};

export class SessionStore {
    readonly #sessions = new Map<string, Session>();
    readonly #opts: SessionStoreOptions;
    readonly #now: () => number;

    constructor(opts: SessionStoreOptions) {
        this.#opts = opts;
        this.#now = opts.now ?? Date.now;
    }

    get size(): number {
        return this.#sessions.size;
    }

    /** Limit doluysa `null` döner. */
    create(): Session | null {
        if (this.#sessions.size >= this.#opts.maxSessions) return null;
        const now = this.#now();
        const session: Session = {
            id: randomToken(12),
            webSecret: randomToken(),
            createdAt: now,
            lastWebSeenAt: now,
            webs: new Set(),
            pairToken: null,
            pairTokenExpiresAt: null,
            deviceSecret: null,
            pairedAt: null,
            device: null,
            deviceLastSeenAt: null,
            deviceInfo: null,
            lifecycle: null,
        };
        this.#sessions.set(session.id, session);
        this.issuePairToken(session);
        return session;
    }

    get(sessionId: string): Session | undefined {
        return this.#sessions.get(sessionId);
    }

    authenticateWeb(sessionId: string, webSecret: string): Session | null {
        const session = this.#sessions.get(sessionId);
        if (!session || !safeEqual(session.webSecret, webSecret)) return null;
        return session;
    }

    authenticateDevice(sessionId: string, deviceSecret: string): Session | null {
        const session = this.#sessions.get(sessionId);
        if (!session || session.deviceSecret === null || !safeEqual(session.deviceSecret, deviceSecret)) return null;
        return session;
    }

    isPaired(session: Session): boolean {
        return session.deviceSecret !== null;
    }

    /** Cihaz eşleşmemişse yeni (tek kullanımlık) pair token üretir. */
    issuePairToken(session: Session): { pairToken: string; expiresAt: number } | null {
        if (this.isPaired(session)) return null;
        session.pairToken = randomToken(16);
        session.pairTokenExpiresAt = this.#now() + this.#opts.pairTokenTtlMs;
        return {pairToken: session.pairToken, expiresAt: session.pairTokenExpiresAt};
    }

    pair(sessionId: string, pairToken: string): PairResult {
        const session = this.#sessions.get(sessionId);
        if (!session) return {ok: false, code: 'SESSION_NOT_FOUND'};
        if (this.isPaired(session)) return {ok: false, code: 'DEVICE_ALREADY_PAIRED'};
        if (session.pairToken === null || !safeEqual(session.pairToken, pairToken)) {
            return {ok: false, code: 'INVALID_PAIR_TOKEN'};
        }
        if (session.pairTokenExpiresAt === null || session.pairTokenExpiresAt < this.#now()) {
            return {ok: false, code: 'PAIR_TOKEN_EXPIRED'};
        }
        session.pairToken = null;
        session.pairTokenExpiresAt = null;
        session.deviceSecret = randomToken();
        session.pairedAt = this.#now();
        return {ok: true, deviceSecret: session.deviceSecret};
    }

    /** Cihaz eşleşmesini kaldırır ve yeni pair token üretir. Bağlı cihaz soketini döndürür (kapatmak çağırana ait). */
    unpair(session: Session): Peer | null {
        const device = session.device;
        session.deviceSecret = null;
        session.pairedAt = null;
        session.device = null;
        session.deviceLastSeenAt = null;
        session.deviceInfo = null;
        session.lifecycle = null;
        this.issuePairToken(session);
        return device;
    }

    snapshot(session: Session): DeviceSnapshot | null {
        if (session.pairedAt === null) return null;
        return {
            connected: session.device !== null,
            pairedAt: session.pairedAt,
            lastSeenAt: session.deviceLastSeenAt,
            info: session.deviceInfo,
            lifecycle: session.lifecycle,
        };
    }

    touchWeb(session: Session): void {
        session.lastWebSeenAt = this.#now();
    }

    touchDevice(session: Session): void {
        session.deviceLastSeenAt = this.#now();
    }

    /** Hiçbir web sekmesinin TTL süresince bağlanmadığı oturumları siler ve döndürür. */
    collectExpired(): Session[] {
        const now = this.#now();
        const expired: Session[] = [];
        for (const session of this.#sessions.values()) {
            if (session.webs.size === 0 && now - session.lastWebSeenAt > this.#opts.sessionTtlMs) {
                expired.push(session);
                this.#sessions.delete(session.id);
            }
        }
        return expired;
    }
}
