import type {DeviceSnapshot, Hello, Lifecycle, PairingInfo, TrustedDevice} from '@himmetkaan/remote-devtools-protocol';
import {randomCode, randomToken, safeEqual} from './secrets.ts';

/** Relay'in mesaj gönderebildiği uç (WebSocket'in ihtiyaç duyduğumuz alt kümesi). */
export type Peer = {
    send(data: string): void;
    close(code?: number, reason?: string): void;
};

export type DeviceRecord = {
    deviceId: string;
    secret: string;
    pairedAt: number;
    expiresAt: number;
    lastSeenAt: number | null;
    hello: Hello | null;
    lifecycle: Lifecycle | null;
    socket: Peer | null;
};

export type Session = {
    id: string;
    uiSecret: string;
    createdAt: number;
    /** Son kez en az bir UI'ın bağlı olduğu an — TTL buna göre hesaplanır. */
    lastUiSeenAt: number;
    uis: Set<Peer>;
    pairing: PairingInfo;
    devices: Map<string, DeviceRecord>;
    trusted: Map<string, TrustedDevice>;
};

export type PairFailure = 'SESSION_NOT_FOUND' | 'INVALID_PAIR_TOKEN' | 'PAIR_TOKEN_EXPIRED' | 'INVALID_CODE' | 'DEVICE_LIMIT';

/** `replaced`: aynı `deviceId` ile daha önce eşleşmiş kayıt (soketi varsa çağıran kapatmalıdır). */
export type AddedDevice = { device: DeviceRecord; replaced: DeviceRecord | null };

export type PairResult = ({ ok: true; session: Session } & AddedDevice) | { ok: false; code: PairFailure };

export type DeviceAuthResult =
    | { ok: true; session: Session; device: DeviceRecord }
    | { ok: false; reason: 'sessionNotFound' | 'invalidSecret' | 'expired' };

/** Diske yazılabilen, soket içermeyen oturum görüntüsü. */
export type PersistedSession = {
    id: string;
    uiSecret: string;
    createdAt: number;
    lastUiSeenAt: number;
    devices: Omit<DeviceRecord, 'socket' | 'lifecycle'>[];
    trusted: TrustedDevice[];
};

export type SessionStoreOptions = {
    pairingTtlMs: number;
    devicePairingTtlMs: number;
    sessionTtlMs: number;
    maxSessions: number;
    maxDevicesPerSession: number;
    now?: () => number;
    /** Kalıcı metadata değiştiğinde çağrılır (dosyaya yazmak için). */
    onChange?: () => void;
};

export class SessionStore {
    readonly #sessions = new Map<string, Session>();
    /** 6 haneli kod → oturum id'si. Kodlar tüm oturumlar arasında benzersizdir. */
    readonly #codes = new Map<string, string>();
    readonly #opts: SessionStoreOptions;
    readonly #now: () => number;

    constructor(opts: SessionStoreOptions) {
        this.#opts = opts;
        this.#now = opts.now ?? Date.now;
    }

    get size(): number {
        return this.#sessions.size;
    }

    sessions(): IterableIterator<Session> {
        return this.#sessions.values();
    }

    #changed() {
        this.#opts.onChange?.();
    }

    // ─── Oturum ──────────────────────────────────────────────────────────────

    /** Limit doluysa `null` döner. */
    create(): Session | null {
        if (this.#sessions.size >= this.#opts.maxSessions) return null;
        const now = this.#now();
        const session: Session = {
            id: randomToken(12),
            uiSecret: randomToken(),
            createdAt: now,
            lastUiSeenAt: now,
            uis: new Set(),
            pairing: {qrToken: '', code: '', expiresAt: 0},
            devices: new Map(),
            trusted: new Map(),
        };
        this.#sessions.set(session.id, session);
        this.issuePairing(session);
        this.#changed();
        return session;
    }

    get(sessionId: string): Session | undefined {
        return this.#sessions.get(sessionId);
    }

    authenticateUi(sessionId: string, uiSecret: string): Session | null {
        const session = this.#sessions.get(sessionId);
        if (!session || !safeEqual(session.uiSecret, uiSecret)) return null;
        return session;
    }

    touchUi(session: Session): void {
        session.lastUiSeenAt = this.#now();
    }

    // ─── Eşleşme (QR + kod) ──────────────────────────────────────────────────

    /** Eski QR token'ını ve kodu geçersiz kılıp yenilerini üretir. */
    issuePairing(session: Session): PairingInfo {
        this.#codes.delete(session.pairing.code);
        let code: string;
        do code = randomCode(); while (this.#codes.has(code));
        this.#codes.set(code, session.id);
        session.pairing = {qrToken: randomToken(16), code, expiresAt: this.#now() + this.#opts.pairingTtlMs};
        return session.pairing;
    }

    /** Süresi dolmuşsa yeniler; UI tekrar bağlandığında güncel bir QR görsün diye. */
    ensureFreshPairing(session: Session): PairingInfo {
        return session.pairing.expiresAt <= this.#now() ? this.issuePairing(session) : session.pairing;
    }

    pairByQr(sessionId: string, qrToken: string, deviceId: string): PairResult {
        const session = this.#sessions.get(sessionId);
        if (!session) return {ok: false, code: 'SESSION_NOT_FOUND'};
        if (!safeEqual(session.pairing.qrToken, qrToken)) return {ok: false, code: 'INVALID_PAIR_TOKEN'};
        if (session.pairing.expiresAt <= this.#now()) return {ok: false, code: 'PAIR_TOKEN_EXPIRED'};
        return this.#consumePairing(session, deviceId);
    }

    pairByCode(code: string, deviceId: string): PairResult {
        const sessionId = this.#codes.get(code);
        const session = sessionId ? this.#sessions.get(sessionId) : undefined;
        if (!session || session.pairing.expiresAt <= this.#now()) return {ok: false, code: 'INVALID_CODE'};
        return this.#consumePairing(session, deviceId);
    }

    #consumePairing(session: Session, deviceId: string): PairResult {
        if (!this.canAddDevice(session, deviceId)) return {ok: false, code: 'DEVICE_LIMIT'};
        // Tek kullanımlık: bir sonraki cihaz için hemen yenisi üretilir.
        this.issuePairing(session);
        return {ok: true, session, ...this.addDevice(session, deviceId)};
    }

    // ─── Cihazlar ────────────────────────────────────────────────────────────

    canAddDevice(session: Session, deviceId: string): boolean {
        return session.devices.has(deviceId) || session.devices.size < this.#opts.maxDevicesPerSession;
    }

    /**
     * Cihazı oturuma ekler (aynı `deviceId` varsa yeni sırla değiştirir).
     * Eski kaydın soketi kapatılmaz; çağıran kapatmalıdır.
     */
    addDevice(session: Session, deviceId: string): AddedDevice {
        const now = this.#now();
        const previous = session.devices.get(deviceId) ?? null;
        const device: DeviceRecord = {
            deviceId,
            secret: randomToken(),
            pairedAt: now,
            expiresAt: now + this.#opts.devicePairingTtlMs,
            lastSeenAt: now,
            hello: previous?.hello ?? null,
            lifecycle: null,
            socket: null,
        };
        session.devices.set(deviceId, device);
        this.#changed();
        return {device, replaced: previous};
    }

    authenticateDevice(sessionId: string, deviceId: string, secret: string): DeviceAuthResult {
        const session = this.#sessions.get(sessionId);
        if (!session) return {ok: false, reason: 'sessionNotFound'};
        const device = session.devices.get(deviceId);
        if (!device || !safeEqual(device.secret, secret)) return {ok: false, reason: 'invalidSecret'};
        if (device.expiresAt <= this.#now()) return {ok: false, reason: 'expired'};
        return {ok: true, session, device};
    }

    removeDevice(session: Session, deviceId: string): DeviceRecord | null {
        const device = session.devices.get(deviceId) ?? null;
        if (device) {
            session.devices.delete(deviceId);
            this.#changed();
        }
        return device;
    }

    touchDevice(device: DeviceRecord): void {
        device.lastSeenAt = this.#now();
    }

    snapshot(device: DeviceRecord): DeviceSnapshot {
        return {
            deviceId: device.deviceId,
            connected: device.socket !== null,
            pairedAt: device.pairedAt,
            expiresAt: device.expiresAt,
            lastSeenAt: device.lastSeenAt,
            hello: device.hello,
            lifecycle: device.lifecycle,
        };
    }

    snapshots(session: Session): DeviceSnapshot[] {
        return [...session.devices.values()].map((d) => this.snapshot(d));
    }

    // ─── Onaylı cihazlar ─────────────────────────────────────────────────────

    trust(session: Session, entry: Omit<TrustedDevice, 'trustedAt'>): void {
        session.trusted.set(entry.deviceId, {...entry, trustedAt: this.#now()});
        this.#changed();
    }

    untrust(session: Session, deviceId: string): boolean {
        const removed = session.trusted.delete(deviceId);
        if (removed) this.#changed();
        return removed;
    }

    /** Bu cihazı (aynı uygulama için) onaylamış oturumu bulur. */
    findTrustingSession(deviceId: string, appId: string): Session | null {
        for (const session of this.#sessions.values()) {
            const entry = session.trusted.get(deviceId);
            if (entry && entry.appId === appId) return session;
        }
        return null;
    }

    // ─── Çöp toplama ─────────────────────────────────────────────────────────

    /** Hiçbir UI'ın TTL süresince bağlanmadığı oturumları siler ve döndürür. */
    collectExpiredSessions(): Session[] {
        const now = this.#now();
        const expired: Session[] = [];
        for (const session of this.#sessions.values()) {
            if (session.uis.size === 0 && now - session.lastUiSeenAt > this.#opts.sessionTtlMs) {
                expired.push(session);
                this.#sessions.delete(session.id);
                this.#codes.delete(session.pairing.code);
            }
        }
        if (expired.length) this.#changed();
        return expired;
    }

    /** Eşleşme süresi dolmuş cihazları oturumlarından siler ve döndürür. */
    collectExpiredDevices(): { session: Session; device: DeviceRecord }[] {
        const now = this.#now();
        const expired: { session: Session; device: DeviceRecord }[] = [];
        for (const session of this.#sessions.values()) {
            for (const device of session.devices.values()) {
                if (device.expiresAt <= now) {
                    expired.push({session, device});
                    session.devices.delete(device.deviceId);
                }
            }
        }
        if (expired.length) this.#changed();
        return expired;
    }

    // ─── Kalıcılık ───────────────────────────────────────────────────────────

    export(): PersistedSession[] {
        return [...this.#sessions.values()].map((s) => ({
            id: s.id,
            uiSecret: s.uiSecret,
            createdAt: s.createdAt,
            lastUiSeenAt: s.lastUiSeenAt,
            devices: [...s.devices.values()].map(({socket: _s, lifecycle: _l, ...rest}) => rest),
            trusted: [...s.trusted.values()],
        }));
    }

    import(data: PersistedSession[]): void {
        for (const p of data) {
            const session: Session = {
                id: p.id,
                uiSecret: p.uiSecret,
                createdAt: p.createdAt,
                lastUiSeenAt: p.lastUiSeenAt,
                uis: new Set(),
                pairing: {qrToken: '', code: '', expiresAt: 0},
                devices: new Map(p.devices.map((d) => [d.deviceId, {...d, lifecycle: null, socket: null}])),
                trusted: new Map(p.trusted.map((t) => [t.deviceId, t])),
            };
            this.#sessions.set(session.id, session);
            this.issuePairing(session);
        }
    }
}
