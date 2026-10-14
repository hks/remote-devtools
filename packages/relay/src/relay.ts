import type {IncomingMessage, Server} from 'node:http';
import type {Duplex} from 'node:stream';
import {WebSocket, WebSocketServer} from 'ws';
import {
    type ConnectOutcome,
    type ConnectRejectReason,
    type ConnectRequest,
    createEnvelope,
    createMessageId,
    DEVICE_TO_UI_TYPES,
    type Envelope,
    type ErrorCode,
    type Hello,
    isModuleType,
    isValidDeviceId,
    type Lifecycle,
    type MessageOf,
    parseEnvelope,
    PROTOCOL_VERSION,
    type RelayToDevice,
    type RelayToUi,
    type UnpairReason,
    WS_PATH_DEVICE,
    WS_PATH_UI,
} from '@himmetkaan/remote-devtools-protocol';
import type {RelayConfig} from './config.ts';
import {log} from './log.ts';
import {clientAddress, FailureLimiter, isLocalAddress} from './net.ts';
import {type AddedDevice, type DeviceRecord, type PairFailure, type PairResult, type Session, SessionStore} from './sessions.ts';
import {createStateWriter, loadState} from './state.ts';

type Role = 'ui' | 'device';

type SocketState = {
    role: Role;
    address: string;
    session: Session | null;
    /** Device sockets only: the authenticated device record. */
    device: DeviceRecord | null;
    /** Device sockets only: the `connect` request awaiting UI approval. */
    pendingRequestId: string | null;
    alive: boolean;
    authTimer: NodeJS.Timeout | null;
    rate: { windowStart: number; count: number; dropped: number };
};

type Pending = {
    request: ConnectRequest;
    ws: WebSocket;
    /** Id of the device's `connect` message; `paired` is sent as a reply to it. */
    messageId: string;
    /** Sessions the request is shown to. A reply from any of them is valid. */
    sessionIds: Set<string>;
    timer: NodeJS.Timeout;
};

export const CloseCode = {
    replaced: 4000,
    authFailed: 4001,
    unpaired: 4002,
    authTimeout: 4003,
    sessionExpired: 4004,
    unsupportedVersion: 4005,
    rateLimited: 4006,
    connectRejected: 4007,
} as const;

const DEVICE_FORWARD = new Set<string>(DEVICE_TO_UI_TYPES);

export type Relay = {
    store: SessionStore;
    /** Changes the address written into the QR (e.g. when the LAN IP changes in the desktop app). Takes effect in subsequent `session` messages. */
    setPublicUrl(publicUrl: string | null): void;
    close(): Promise<void>;
};

function toDeviceWsUrl(publicUrl: string | null): string | null {
    return publicUrl ? publicUrl.replace(/\/+$/, '').replace(/^http/, 'ws') + WS_PATH_DEVICE : null;
}

function isString(value: unknown, max = 512): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isHello(value: unknown): value is Hello {
    const h = value as Hello | null;
    return typeof h === 'object' && h !== null && typeof h.app === 'object' && h.app !== null && isString(h.app.id);
}

function deviceLabel(hello: Hello): string {
    return hello.device?.name ?? hello.device?.model ?? hello.app.name ?? hello.app.id;
}

const PAIR_FAILURE_MESSAGES: Record<PairFailure, string> = {
    SESSION_NOT_FOUND: 'Session not found',
    INVALID_PAIR_TOKEN: 'Invalid pairing token',
    PAIR_TOKEN_EXPIRED: 'Pairing token expired',
    INVALID_CODE: 'Invalid or expired pairing code',
    DEVICE_LIMIT: 'Session device limit reached',
};

export function attachRelay(server: Server, config: RelayConfig): Relay {
    const persisted = config.stateFile ? loadState(config.stateFile) : [];
    const writer = config.stateFile ? createStateWriter(config.stateFile, () => store.export()) : null;
    const store = new SessionStore({
        pairingTtlMs: config.pairingTtlMs,
        deviceIdleTtlMs: config.deviceIdleTtlMs,
        sessionTtlMs: config.sessionTtlMs,
        maxSessions: config.maxSessions,
        maxDevicesPerSession: config.maxDevicesPerSession,
        onChange: () => writer?.schedule(),
    });
    store.import(persisted);
    if (persisted.length) log.info('state restored', {sessions: persisted.length, file: config.stateFile});

    const sockets = new Map<WebSocket, SocketState>();
    const pending = new Map<string, Pending>();
    const pairFailures = new FailureLimiter(config.pairFailureLimit, config.pairFailureWindowMs);
    const wss = new WebSocketServer({noServer: true, maxPayload: config.maxPayloadBytes});
    let deviceWsUrl = toDeviceWsUrl(config.publicUrl);

    // ─── Send helpers ────────────────────────────────────────────────────────

    function sendRaw(ws: WebSocket, data: string) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }

    function sendToUi<K extends keyof RelayToUi & string>(ws: WebSocket, type: K, payload: RelayToUi[K], replyTo?: string) {
        sendRaw(ws, JSON.stringify(createEnvelope(type, payload, {replyTo}) as MessageOf<RelayToUi>));
    }

    function sendToDevice<K extends keyof RelayToDevice & string>(ws: WebSocket, type: K, payload: RelayToDevice[K], replyTo?: string) {
        sendRaw(ws, JSON.stringify(createEnvelope(type, payload, {replyTo}) as MessageOf<RelayToDevice>));
    }

    function sendError(ws: WebSocket, code: ErrorCode, message: string, replyTo?: string) {
        sendRaw(ws, JSON.stringify(createEnvelope('error', {code, message}, {replyTo})));
    }

    function broadcastToUis<K extends keyof RelayToUi & string>(session: Session, type: K, payload: RelayToUi[K]) {
        for (const ui of session.uis) sendToUi(ui as WebSocket, type, payload);
    }

    function broadcastRawToUis(session: Session, data: string) {
        for (const ui of session.uis) sendRaw(ui as WebSocket, data);
    }

    function broadcastDeviceStatus(session: Session, device: DeviceRecord, state: 'connected' | 'disconnected') {
        broadcastToUis(session, 'device.status', {deviceId: device.deviceId, state, device: store.snapshot(device)});
    }

    function sendSession(ws: WebSocket, session: Session, replyTo: string) {
        sendToUi(
            ws,
            'session',
            {
                sessionId: session.id,
                uiSecret: session.uiSecret,
                deviceWsUrl,
                pairing: store.ensureFreshPairing(session),
                devices: store.snapshots(session),
                pendingRequests: [...pending.values()].filter((p) => p.sessionIds.has(session.id)).map((p) => p.request),
                trustedDevices: [...session.trusted.values()],
            },
            replyTo,
        );
    }

    function clearAuthTimer(state: SocketState) {
        if (state.authTimer) {
            clearTimeout(state.authTimer);
            state.authTimer = null;
        }
    }

    // ─── Device attach / detach ──────────────────────────────────────────────

    /** Binds the socket to the authenticated device record; the same device's previous connection is closed. */
    function attachDevice(ws: WebSocket, state: SocketState, session: Session, device: DeviceRecord) {
        const previous = device.socket as WebSocket | null;
        if (previous && previous !== ws) detachSocket(previous, CloseCode.replaced, 'replaced');
        clearAuthTimer(state);
        state.session = session;
        state.device = device;
        state.pendingRequestId = null;
        device.socket = ws;
        store.touchDevice(device);
        broadcastDeviceStatus(session, device, 'connected');
    }

    /** Unbinds the socket from its session (so the close event does not broadcast status) and closes it. */
    function detachSocket(ws: WebSocket, code: number, reason: string) {
        const state = sockets.get(ws);
        if (state) {
            state.session = null;
            state.device = null;
        }
        ws.close(code, reason);
    }

    /**
     * Completes a new pairing: adds the device to the session (replacing any previous record),
     * sends the device its secret and notifies the UIs.
     */
    function completePairing(ws: WebSocket, state: SocketState, session: Session, {device, replaced}: AddedDevice, replyTo: string) {
        const oldSocket = replaced?.socket as WebSocket | null | undefined;
        if (oldSocket && oldSocket !== ws) detachSocket(oldSocket, CloseCode.replaced, 'replaced');
        sendToDevice(ws, 'paired', {sessionId: session.id, deviceSecret: device.secret, expiresAt: device.expiresAt}, replyTo);
        attachDevice(ws, state, session, device);
        broadcastToUis(session, 'pairing', session.pairing);
        log.info('device paired', {session: session.id, device: device.deviceId, devices: session.devices.size});
    }

    function unpairDevice(session: Session, deviceId: string, reason: UnpairReason) {
        const device = store.removeDevice(session, deviceId);
        if (!device) return;
        const socket = device.socket as WebSocket | null;
        if (socket) {
            sendToDevice(socket, 'unpaired', {reason});
            detachSocket(socket, CloseCode.unpaired, reason);
        }
        broadcastToUis(session, 'device.status', {deviceId, state: 'unpaired', device: null});
        log.info('device unpaired', {session: session.id, device: deviceId, reason});
    }

    // ─── Connect requests (connect) ──────────────────────────────────────────

    function resolvePending(requestId: string, outcome: ConnectOutcome): Pending | null {
        const entry = pending.get(requestId);
        if (!entry) return null;
        clearTimeout(entry.timer);
        pending.delete(requestId);
        const state = sockets.get(entry.ws);
        if (state) state.pendingRequestId = null;
        for (const id of entry.sessionIds) {
            const session = store.get(id);
            if (session) broadcastToUis(session, 'connect.resolved', {requestId, outcome});
        }
        return entry;
    }

    function rejectConnect(ws: WebSocket, requestId: string | null, reason: ConnectRejectReason, replyTo?: string) {
        sendToDevice(ws, 'connect.rejected', {requestId, reason}, replyTo);
        ws.close(CloseCode.connectRejected, reason);
    }

    function handleConnect(ws: WebSocket, state: SocketState, msg: Envelope, payload: Record<string, unknown>) {
        const allowed =
            config.connectRequests === 'any' || (config.connectRequests === 'local' && isLocalAddress(state.address));
        if (!allowed) return rejectConnect(ws, null, 'disabled', msg.id);
        if (!isValidDeviceId(payload.deviceId) || !isHello(payload.hello)) {
            return rejectDevice(ws, 'BAD_MESSAGE', 'deviceId and hello are required', msg.id);
        }
        const deviceId = payload.deviceId;
        const hello = payload.hello;

        const trusting = store.findTrustingSession(deviceId, hello.app.id);
        if (trusting && store.canAddDevice(trusting, deviceId)) {
            completePairing(ws, state, trusting, store.addDevice(trusting, deviceId), msg.id);
            return;
        }

        const targets = [...store.sessions()].filter((s) => s.uis.size > 0);
        if (targets.length === 0) return rejectConnect(ws, null, 'noSession', msg.id);

        // A new request replaces any earlier pending request from the same device.
        for (const [id, entry] of pending) {
            if (entry.request.deviceId === deviceId) {
                resolvePending(id, 'cancelled');
                if (entry.ws !== ws) rejectConnect(entry.ws, id, 'rejected');
            }
        }

        const now = Date.now();
        const request: ConnectRequest = {
            requestId: createMessageId(),
            deviceId,
            hello,
            via: isLocalAddress(state.address) ? 'local' : 'remote',
            at: now,
            expiresAt: now + config.connectRequestTtlMs,
        };
        const timer = setTimeout(() => {
            if (resolvePending(request.requestId, 'expired')) rejectConnect(ws, request.requestId, 'expired');
        }, config.connectRequestTtlMs);
        pending.set(request.requestId, {request, ws, messageId: msg.id, sessionIds: new Set(targets.map((s) => s.id)), timer});

        clearAuthTimer(state);
        state.pendingRequestId = request.requestId;
        sendToDevice(ws, 'connect.pending', {requestId: request.requestId, expiresAt: request.expiresAt}, msg.id);
        for (const session of targets) broadcastToUis(session, 'connect.request', request);
        log.info('connect request', {device: deviceId, app: hello.app.id, via: request.via, sessions: targets.length});
    }

    function respondToConnect(ws: WebSocket, session: Session, msg: Envelope, payload: Record<string, unknown>) {
        if (!isString(payload.requestId) || typeof payload.approve !== 'boolean') {
            return sendError(ws, 'BAD_MESSAGE', 'requestId and approve are required', msg.id);
        }
        const entry = pending.get(payload.requestId);
        if (!entry || !entry.sessionIds.has(session.id)) {
            return sendError(ws, 'REQUEST_NOT_FOUND', 'Connect request not found or already resolved', msg.id);
        }
        const {request} = entry;
        const deviceState = sockets.get(entry.ws);

        if (!payload.approve) {
            resolvePending(request.requestId, 'rejected');
            rejectConnect(entry.ws, request.requestId, 'rejected');
            return;
        }
        if (!store.canAddDevice(session, request.deviceId)) {
            resolvePending(request.requestId, 'rejected');
            rejectConnect(entry.ws, request.requestId, 'deviceLimit');
            return sendError(ws, 'DEVICE_LIMIT', 'Session device limit reached', msg.id);
        }

        resolvePending(request.requestId, 'approved');
        if (payload.trust === true) {
            store.trust(session, {deviceId: request.deviceId, appId: request.hello.app.id, name: deviceLabel(request.hello)});
            broadcastToUis(session, 'trusted', {devices: [...session.trusted.values()]});
        }
        if (deviceState) completePairing(entry.ws, deviceState, session, store.addDevice(session, request.deviceId), entry.messageId);
    }

    // ─── UI messages ─────────────────────────────────────────────────────────

    function handleUi(ws: WebSocket, state: SocketState, msg: Envelope, raw: string) {
        const payload = msg.payload as Record<string, unknown>;
        const session = state.session;

        if (!session) {
            if (msg.type === 'session.create') {
                const created = store.create();
                if (!created) return sendError(ws, 'SESSION_LIMIT', 'Relay session limit reached', msg.id);
                clearAuthTimer(state);
                state.session = created;
                created.uis.add(ws);
                sendSession(ws, created, msg.id);
                log.info('session created', {session: created.id, total: store.size});
                return;
            }
            if (msg.type === 'session.resume') {
                if (!isString(payload.sessionId) || !isString(payload.uiSecret)) {
                    return sendError(ws, 'BAD_MESSAGE', 'sessionId and uiSecret are required', msg.id);
                }
                const resumed = store.authenticateUi(payload.sessionId, payload.uiSecret);
                if (!resumed) return sendError(ws, 'SESSION_NOT_FOUND', 'Session not found', msg.id);
                clearAuthTimer(state);
                state.session = resumed;
                resumed.uis.add(ws);
                store.touchUi(resumed);
                sendSession(ws, resumed, msg.id);
                return;
            }
            return sendError(ws, 'NOT_AUTHENTICATED', 'Send session.create or session.resume first', msg.id);
        }

        store.touchUi(session);

        if (isModuleType(msg.type)) {
            if (!isString(msg.deviceId)) return sendError(ws, 'BAD_MESSAGE', 'deviceId is required for module messages', msg.id);
            const device = session.devices.get(msg.deviceId);
            if (!device) return sendError(ws, 'DEVICE_NOT_FOUND', 'Device is not paired with this session', msg.id);
            if (!device.socket) return sendError(ws, 'DEVICE_OFFLINE', 'Device is offline', msg.id);
            sendRaw(device.socket as WebSocket, raw);
            return;
        }

        switch (msg.type) {
            case 'pairing.refresh':
                broadcastToUis(session, 'pairing', store.issuePairing(session));
                return;
            case 'connect.respond':
                return respondToConnect(ws, session, msg, payload);
            case 'device.unpair':
                if (!isString(payload.deviceId) || !session.devices.has(payload.deviceId)) {
                    return sendError(ws, 'DEVICE_NOT_FOUND', 'Device is not paired with this session', msg.id);
                }
                unpairDevice(session, payload.deviceId, 'byUi');
                return;
            case 'trusted.remove':
                if (!isString(payload.deviceId)) return sendError(ws, 'BAD_MESSAGE', 'deviceId is required', msg.id);
                if (store.untrust(session, payload.deviceId)) {
                    broadcastToUis(session, 'trusted', {devices: [...session.trusted.values()]});
                }
                return;
            default:
                return sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${msg.type}`, msg.id);
        }
    }

    // ─── Device messages ─────────────────────────────────────────────────────

    function rejectDevice(ws: WebSocket, code: ErrorCode, message: string, replyTo: string) {
        sendError(ws, code, message, replyTo);
        ws.close(CloseCode.authFailed, code);
    }

    function handlePairResult(ws: WebSocket, state: SocketState, msg: Envelope, result: PairResult) {
        if (!result.ok) {
            if (result.code !== 'DEVICE_LIMIT') pairFailures.record(state.address);
            return rejectDevice(ws, result.code, PAIR_FAILURE_MESSAGES[result.code], msg.id);
        }
        completePairing(ws, state, result.session, result, msg.id);
    }

    /** Counts messages in a one-second window; returns `false` over the limit and warns the UIs once per window. */
    function withinRateLimit(state: SocketState): boolean {
        const now = Date.now();
        if (now - state.rate.windowStart >= 1000) state.rate = {windowStart: now, count: 0, dropped: 0};
        if (++state.rate.count <= config.deviceMaxMessagesPerSec) return true;
        if (state.rate.dropped++ === 0 && state.session && state.device) {
            const warning = createEnvelope(
                'log',
                {level: 'warn', message: `Relay is dropping messages: more than ${config.deviceMaxMessagesPerSec}/s`, tag: 'relay', at: now},
                {deviceId: state.device.deviceId},
            );
            broadcastRawToUis(state.session, JSON.stringify(warning));
        }
        return false;
    }

    function handleDevice(ws: WebSocket, state: SocketState, msg: Envelope) {
        const payload = msg.payload as Record<string, unknown>;
        const session = state.session;
        const device = state.device;

        if (!session || !device) {
            if (state.pendingRequestId) return sendError(ws, 'NOT_AUTHENTICATED', 'Waiting for connect approval', msg.id);

            switch (msg.type) {
                case 'pair.qr':
                case 'pair.code': {
                    if (pairFailures.blocked(state.address)) {
                        sendError(ws, 'RATE_LIMITED', 'Too many failed pairing attempts, try again later', msg.id);
                        ws.close(CloseCode.rateLimited, 'RATE_LIMITED');
                        return;
                    }
                    if (!isValidDeviceId(payload.deviceId)) return rejectDevice(ws, 'BAD_MESSAGE', 'A valid deviceId is required', msg.id);
                    if (msg.type === 'pair.qr') {
                        if (!isString(payload.sessionId) || !isString(payload.qrToken)) {
                            return rejectDevice(ws, 'BAD_MESSAGE', 'sessionId and qrToken are required', msg.id);
                        }
                        return handlePairResult(ws, state, msg, store.pairByQr(payload.sessionId, payload.qrToken, payload.deviceId));
                    }
                    if (typeof payload.code !== 'string' || !/^\d{6}$/.test(payload.code)) {
                        pairFailures.record(state.address);
                        return rejectDevice(ws, 'INVALID_CODE', PAIR_FAILURE_MESSAGES.INVALID_CODE, msg.id);
                    }
                    return handlePairResult(ws, state, msg, store.pairByCode(payload.code, payload.deviceId));
                }
                case 'connect':
                    return handleConnect(ws, state, msg, payload);
                case 'resume': {
                    if (!isString(payload.sessionId) || !isString(payload.deviceId) || !isString(payload.deviceSecret)) {
                        return rejectDevice(ws, 'BAD_MESSAGE', 'sessionId, deviceId and deviceSecret are required', msg.id);
                    }
                    const auth = store.authenticateDevice(payload.sessionId, payload.deviceId, payload.deviceSecret);
                    if (!auth.ok) {
                        if (auth.reason === 'expired') {
                            const expiredSession = store.get(payload.sessionId);
                            if (expiredSession) unpairDevice(expiredSession, payload.deviceId, 'expired');
                        }
                        sendToDevice(ws, 'unpaired', {reason: auth.reason}, msg.id);
                        ws.close(CloseCode.unpaired, auth.reason);
                        return;
                    }
                    sendToDevice(ws, 'resumed', {sessionId: auth.session.id, expiresAt: auth.device.expiresAt}, msg.id);
                    attachDevice(ws, state, auth.session, auth.device);
                    return;
                }
                default:
                    return rejectDevice(ws, 'NOT_AUTHENTICATED', 'Send pair.qr, pair.code, connect or resume first', msg.id);
            }
        }

        store.touchDevice(device);

        if (msg.type === 'unpair') {
            unpairDevice(session, device.deviceId, 'byDevice');
            return;
        }

        if (DEVICE_FORWARD.has(msg.type) || isModuleType(msg.type)) {
            if (!withinRateLimit(state)) return;
            if (msg.type === 'hello' && isHello(msg.payload)) device.hello = msg.payload;
            if (msg.type === 'lifecycle') device.lifecycle = payload.state as Lifecycle;
            broadcastRawToUis(session, JSON.stringify({...msg, deviceId: device.deviceId}));
            return;
        }

        sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${msg.type}`, msg.id);
    }

    // ─── Connection lifecycle ────────────────────────────────────────────────

    function onConnection(ws: WebSocket, role: Role, address: string) {
        const state: SocketState = {
            role,
            address,
            session: null,
            device: null,
            pendingRequestId: null,
            alive: true,
            authTimer: null,
            rate: {windowStart: Date.now(), count: 0, dropped: 0},
        };
        state.authTimer = setTimeout(() => {
            if (!state.session && !state.pendingRequestId) ws.close(CloseCode.authTimeout, 'auth timeout');
        }, config.authTimeoutMs);
        sockets.set(ws, state);

        ws.on('pong', () => {
            state.alive = true;
        });

        ws.on('message', (data, isBinary) => {
            state.alive = true;
            if (isBinary) return sendError(ws, 'BAD_MESSAGE', 'Binary frames are not supported');
            const raw = data.toString();
            const msg = parseEnvelope(raw);
            if (!msg) return sendError(ws, 'BAD_MESSAGE', 'Invalid envelope');
            if (msg.v !== PROTOCOL_VERSION) {
                sendError(ws, 'UNSUPPORTED_VERSION', `Relay speaks protocol v${PROTOCOL_VERSION}`, msg.id);
                ws.close(CloseCode.unsupportedVersion, 'UNSUPPORTED_VERSION');
                return;
            }
            if (role === 'ui') handleUi(ws, state, msg, raw);
            else handleDevice(ws, state, msg);
        });

        ws.on('close', () => {
            clearAuthTimer(state);
            sockets.delete(ws);
            if (state.pendingRequestId) resolvePending(state.pendingRequestId, 'cancelled');
            const session = state.session;
            if (!session) return;
            if (role === 'ui') {
                session.uis.delete(ws);
                store.touchUi(session);
            } else if (state.device && state.device.socket === ws) {
                store.markDisconnected(state.device);
                broadcastDeviceStatus(session, state.device, 'disconnected');
            }
        });

        ws.on('error', (err) => {
            log.warn('socket error', {role, error: err.message});
        });
    }

    function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;
        const role: Role | null = path === WS_PATH_UI ? 'ui' : path === WS_PATH_DEVICE ? 'device' : null;
        if (!role) {
            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        const address = clientAddress(req, config.trustProxy);
        wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, role, address));
    }

    server.on('upgrade', onUpgrade);

    // ─── Periodic jobs ───────────────────────────────────────────────────────

    const heartbeat = setInterval(() => {
        for (const [ws, state] of sockets) {
            if (!state.alive) {
                ws.terminate();
                continue;
            }
            state.alive = false;
            ws.ping();
        }
    }, config.heartbeatIntervalMs);

    const gc = setInterval(() => {
        for (const session of store.collectExpiredSessions()) {
            for (const device of session.devices.values()) {
                const socket = device.socket as WebSocket | null;
                if (!socket) continue;
                sendToDevice(socket, 'unpaired', {reason: 'sessionNotFound'});
                detachSocket(socket, CloseCode.sessionExpired, 'session expired');
            }
            for (const [id, entry] of pending) {
                entry.sessionIds.delete(session.id);
                if (entry.sessionIds.size === 0 && resolvePending(id, 'cancelled')) rejectConnect(entry.ws, id, 'noSession');
            }
            log.info('session expired', {session: session.id, total: store.size});
        }
        for (const {session, device} of store.collectExpiredDevices()) {
            const socket = device.socket as WebSocket | null;
            if (socket) {
                sendToDevice(socket, 'unpaired', {reason: 'expired'});
                detachSocket(socket, CloseCode.unpaired, 'expired');
            }
            broadcastToUis(session, 'device.status', {deviceId: device.deviceId, state: 'unpaired', device: null});
            log.info('device pairing expired', {session: session.id, device: device.deviceId});
        }
        pairFailures.prune();
    }, config.gcIntervalMs);

    return {
        store,
        setPublicUrl: (publicUrl) => {
            deviceWsUrl = toDeviceWsUrl(publicUrl);
        },
        close: () =>
            new Promise<void>((resolve) => {
                clearInterval(heartbeat);
                clearInterval(gc);
                for (const entry of pending.values()) clearTimeout(entry.timer);
                pending.clear();
                server.off('upgrade', onUpgrade);
                for (const ws of sockets.keys()) ws.terminate();
                wss.close(() => {
                    void (writer?.flush() ?? Promise.resolve()).then(() => resolve());
                });
            }),
    };
}
