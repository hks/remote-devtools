import type {DeviceSnapshot, Hello, Lifecycle, PairingInfo, TrustedDevice} from '@himmetkaan/remote-devtools-protocol';
import {randomCode, randomToken, safeEqual} from './secrets.ts';

/** An endpoint the relay can send messages to (the subset of WebSocket we need). */
export type Peer = {
    send(data: string): void;
    close(code?: number, reason?: string): void;
};

export type DeviceRecord = {
    deviceId: string;
    secret: string;
    pairedAt: number;
    /** When the pairing is forgotten while disconnected (last activity + idle timeout). */
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
    /** Last time at least one UI was connected — the TTL is computed from this. */
    lastUiSeenAt: number;
    uis: Set<Peer>;
    pairing: PairingInfo;
    devices: Map<string, DeviceRecord>;
    trusted: Map<string, TrustedDevice>;
};

export type PairFailure = 'SESSION_NOT_FOUND' | 'INVALID_PAIR_TOKEN' | 'PAIR_TOKEN_EXPIRED' | 'INVALID_CODE' | 'DEVICE_LIMIT';

/** `replaced`: the record previously paired with the same `deviceId` (the caller must close its socket, if any). */
export type AddedDevice = {device: DeviceRecord; replaced: DeviceRecord | null};

export type PairResult = ({ok: true; session: Session} & AddedDevice) | {ok: false; code: PairFailure};

export type DeviceAuthResult =
    | {ok: true; session: Session; device: DeviceRecord}
    | {ok: false; reason: 'sessionNotFound' | 'invalidSecret' | 'expired'};

/** A socket-free session snapshot that can be written to disk. */
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
    deviceIdleTtlMs: number;
    sessionTtlMs: number;
    maxSessions: number;
    maxDevicesPerSession: number;
    now?: () => number;
    /** Called when persistent metadata changes (to write it to the file). */
    onChange?: () => void;
};

export class SessionStore {
    readonly #sessions = new Map<string, Session>();
    /** 6-digit code → session id. Codes are unique across all sessions. */
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

    // ─── Session ─────────────────────────────────────────────────────────────

    /** Returns `null` if the limit is reached. */
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

    // ─── Pairing (QR + code) ─────────────────────────────────────────────────

    /** Invalidates the old QR token and code and generates new ones. */
    issuePairing(session: Session): PairingInfo {
        this.#codes.delete(session.pairing.code);
        let code: string;
        do code = randomCode();
        while (this.#codes.has(code));
        this.#codes.set(code, session.id);
        session.pairing = {qrToken: randomToken(16), code, expiresAt: this.#now() + this.#opts.pairingTtlMs};
        return session.pairing;
    }

    /** Renews it if expired, so the UI sees a current QR when it reconnects. */
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
        // Single-use: a new one is generated right away for the next device.
        this.issuePairing(session);
        return {ok: true, session, ...this.addDevice(session, deviceId)};
    }

    // ─── Devices ─────────────────────────────────────────────────────────────

    canAddDevice(session: Session, deviceId: string): boolean {
        return session.devices.has(deviceId) || session.devices.size < this.#opts.maxDevicesPerSession;
    }

    /**
     * Adds the device to the session (replacing an existing `deviceId` with a new secret).
     * The old record's socket is not closed; the caller must close it.
     */
    addDevice(session: Session, deviceId: string): AddedDevice {
        const now = this.#now();
        const previous = session.devices.get(deviceId) ?? null;
        const device: DeviceRecord = {
            deviceId,
            secret: randomToken(),
            pairedAt: now,
            expiresAt: now + this.#opts.deviceIdleTtlMs,
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
        if (this.#isExpired(device)) return {ok: false, reason: 'expired'};
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

    /** Activity: restarts the idle timeout. */
    touchDevice(device: DeviceRecord): void {
        const now = this.#now();
        device.lastSeenAt = now;
        device.expiresAt = now + this.#opts.deviceIdleTtlMs;
    }

    /** Socket dropped: the timeout starts running from now. Also persisted to the file (for a correct timeout after a crash). */
    markDisconnected(device: DeviceRecord): void {
        device.socket = null;
        this.touchDevice(device);
        this.#changed();
    }

    /** Pairings of connected devices do not expire. */
    #isExpired(device: DeviceRecord): boolean {
        return device.socket === null && device.expiresAt <= this.#now();
    }

    snapshot(device: DeviceRecord): DeviceSnapshot {
        return {
            deviceId: device.deviceId,
            connected: device.socket !== null,
            pairedAt: device.pairedAt,
            // The timeout does not run while connected; the shown value is when it would expire "if it dropped now".
            expiresAt: device.socket ? this.#now() + this.#opts.deviceIdleTtlMs : device.expiresAt,
            lastSeenAt: device.lastSeenAt,
            hello: device.hello,
            lifecycle: device.lifecycle,
        };
    }

    snapshots(session: Session): DeviceSnapshot[] {
        return [...session.devices.values()].map((d) => this.snapshot(d));
    }

    // ─── Trusted devices ─────────────────────────────────────────────────────

    trust(session: Session, entry: Omit<TrustedDevice, 'trustedAt'>): void {
        session.trusted.set(entry.deviceId, {...entry, trustedAt: this.#now()});
        this.#changed();
    }

    untrust(session: Session, deviceId: string): boolean {
        const removed = session.trusted.delete(deviceId);
        if (removed) this.#changed();
        return removed;
    }

    /** Finds the session that trusted this device (for the same app). */
    findTrustingSession(deviceId: string, appId: string): Session | null {
        for (const session of this.#sessions.values()) {
            const entry = session.trusted.get(deviceId);
            if (entry && entry.appId === appId) return session;
        }
        return null;
    }

    // ─── Garbage collection ──────────────────────────────────────────────────

    /** Deletes and returns sessions to which no UI connected within the TTL. */
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

    /** Removes disconnected devices whose idle timeout has elapsed from their sessions and returns them. */
    collectExpiredDevices(): {session: Session; device: DeviceRecord}[] {
        const now = this.#now();
        const expired: {session: Session; device: DeviceRecord}[] = [];
        for (const session of this.#sessions.values()) {
            for (const device of session.devices.values()) {
                if (device.socket === null && device.expiresAt <= now) {
                    expired.push({session, device});
                    session.devices.delete(device.deviceId);
                }
            }
        }
        if (expired.length) this.#changed();
        return expired;
    }

    // ─── Persistence ─────────────────────────────────────────────────────────

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
