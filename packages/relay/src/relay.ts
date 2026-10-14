import type {IncomingMessage, Server} from 'node:http';
import type {Duplex} from 'node:stream';
import {WebSocket, WebSocketServer} from 'ws';
import {
    createEnvelope,
    DEVICE_TO_WEB_TYPES,
    type DeviceInfo,
    type AppLifecycleState,
    type Envelope,
    type ErrorCode,
    type MessageOf,
    parseEnvelope,
    PROTOCOL_VERSION,
    type RelayToDevice,
    type RelayToWeb,
    WEB_TO_DEVICE_TYPES,
    WS_PATH_DEVICE,
    WS_PATH_WEB,
} from '@remote-devtools/protocol';
import type {RelayConfig} from './config.ts';
import {log} from './log.ts';
import {type Session, SessionStore} from './sessions.ts';

type Role = 'web' | 'device';

type SocketState = {
    role: Role;
    session: Session | null;
    alive: boolean;
    authTimer: NodeJS.Timeout | null;
};

export const CloseCode = {
    replaced: 4000,
    authFailed: 4001,
    unpaired: 4002,
    authTimeout: 4003,
    sessionExpired: 4004,
} as const;

const WEB_FORWARD = new Set<string>(WEB_TO_DEVICE_TYPES);
const DEVICE_FORWARD = new Set<string>(DEVICE_TO_WEB_TYPES);

export type Relay = {
    store: SessionStore;
    close(): Promise<void>;
};

function isString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length < 512;
}

export function attachRelay(server: Server, config: RelayConfig): Relay {
    const store = new SessionStore({
        pairTokenTtlMs: config.pairTokenTtlMs,
        sessionTtlMs: config.sessionTtlMs,
        maxSessions: config.maxSessions,
    });
    const sockets = new Map<WebSocket, SocketState>();
    const wss = new WebSocketServer({noServer: true, maxPayload: config.maxPayloadBytes});
    const deviceWsUrl = config.publicUrl ? config.publicUrl.replace(/^http/, 'ws') + WS_PATH_DEVICE : null;

    // ─── Gönderim yardımcıları ───────────────────────────────────────────────

    function sendRaw(ws: WebSocket, data: string) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }

    function sendToWeb<K extends keyof RelayToWeb & string>(ws: WebSocket, type: K, payload: RelayToWeb[K]) {
        sendRaw(ws, JSON.stringify(createEnvelope(type, payload) as MessageOf<RelayToWeb>));
    }

    function sendToDevice<K extends keyof RelayToDevice & string>(ws: WebSocket, type: K, payload: RelayToDevice[K]) {
        sendRaw(ws, JSON.stringify(createEnvelope(type, payload) as MessageOf<RelayToDevice>));
    }

    function sendError(ws: WebSocket, code: ErrorCode, message: string, replyTo: string | null = null) {
        sendRaw(ws, JSON.stringify(createEnvelope('error', {code, message, replyTo})));
    }

    function broadcastToWebs<K extends keyof RelayToWeb & string>(session: Session, type: K, payload: RelayToWeb[K]) {
        for (const web of session.webs) sendToWeb(web as WebSocket, type, payload);
    }

    function broadcastDeviceStatus(session: Session, state: RelayToWeb['deviceStatus']['state']) {
        broadcastToWebs(session, 'deviceStatus', {state, at: Date.now(), device: store.snapshot(session)});
    }

    function sendSession(ws: WebSocket, session: Session) {
        sendToWeb(ws, 'session', {
            sessionId: session.id,
            webSecret: session.webSecret,
            deviceWsUrl,
            pairToken: session.pairToken,
            pairTokenExpiresAt: session.pairTokenExpiresAt,
            device: store.snapshot(session),
        });
    }

    function bind(ws: WebSocket, state: SocketState, session: Session) {
        state.session = session;
        if (state.authTimer) {
            clearTimeout(state.authTimer);
            state.authTimer = null;
        }
    }

    /** Eşleşmeyi kaldırır, cihaza haber verir, web'lere yeni QR gönderir. */
    function unpairSession(session: Session, reason: RelayToDevice['unpaired']['reason']) {
        const device = store.unpair(session) as WebSocket | null;
        if (device) {
            const deviceState = sockets.get(device);
            if (deviceState) deviceState.session = null;
            sendToDevice(device, 'unpaired', {reason});
            device.close(CloseCode.unpaired, reason);
        }
        broadcastDeviceStatus(session, 'unpaired');
        if (session.pairToken !== null && session.pairTokenExpiresAt !== null) {
            broadcastToWebs(session, 'pairToken', {pairToken: session.pairToken, expiresAt: session.pairTokenExpiresAt});
        }
        log.info('device unpaired', {session: session.id, reason});
    }

    // ─── Web mesajları ───────────────────────────────────────────────────────

    function handleWeb(ws: WebSocket, state: SocketState, msg: Envelope, raw: string) {
        const payload = msg.payload as Record<string, unknown>;
        const session = state.session;

        if (!session) {
            if (msg.type === 'createSession') {
                const created = store.create();
                if (!created) return sendError(ws, 'SESSION_LIMIT', 'Relay session limit reached', msg.id);
                bind(ws, state, created);
                created.webs.add(ws);
                sendSession(ws, created);
                log.info('session created', {session: created.id, total: store.size});
                return;
            }
            if (msg.type === 'resumeSession') {
                if (!isString(payload.sessionId) || !isString(payload.webSecret)) {
                    return sendError(ws, 'BAD_MESSAGE', 'sessionId and webSecret are required', msg.id);
                }
                const resumed = store.authenticateWeb(payload.sessionId, payload.webSecret);
                if (!resumed) return sendError(ws, 'SESSION_NOT_FOUND', 'Session not found', msg.id);
                bind(ws, state, resumed);
                resumed.webs.add(ws);
                store.touchWeb(resumed);
                if (!store.isPaired(resumed) && (resumed.pairTokenExpiresAt ?? 0) < Date.now()) {
                    store.issuePairToken(resumed);
                }
                sendSession(ws, resumed);
                return;
            }
            return sendError(ws, 'NOT_AUTHENTICATED', 'Send createSession or resumeSession first', msg.id);
        }

        store.touchWeb(session);

        if (WEB_FORWARD.has(msg.type)) {
            if (!session.device) return sendError(ws, 'DEVICE_OFFLINE', 'No device connected', msg.id);
            sendRaw(session.device as WebSocket, raw);
            return;
        }

        switch (msg.type) {
            case 'refreshPairToken': {
                const issued = store.issuePairToken(session);
                if (!issued) return sendError(ws, 'DEVICE_ALREADY_PAIRED', 'A device is already paired', msg.id);
                broadcastToWebs(session, 'pairToken', issued);
                return;
            }
            case 'unpair':
                unpairSession(session, 'unpairedByWeb');
                return;
            default:
                return sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${msg.type}`, msg.id);
        }
    }

    // ─── Cihaz mesajları ─────────────────────────────────────────────────────

    function rejectDevice(ws: WebSocket, code: ErrorCode, message: string, replyTo: string) {
        sendError(ws, code, message, replyTo);
        ws.close(CloseCode.authFailed, code);
    }

    function attachDevice(ws: WebSocket, state: SocketState, session: Session) {
        const previous = session.device as WebSocket | null;
        if (previous && previous !== ws) {
            // Aynı cihazın eski (yarı açık) bağlantısı — yenisiyle değiştir.
            const prevState = sockets.get(previous);
            if (prevState) prevState.session = null;
            previous.close(CloseCode.replaced, 'replaced');
        }
        bind(ws, state, session);
        session.device = ws;
        store.touchDevice(session);
    }

    function handleDevice(ws: WebSocket, state: SocketState, msg: Envelope, raw: string) {
        const payload = msg.payload as Record<string, unknown>;
        const session = state.session;

        if (!session) {
            if (msg.type === 'pair') {
                if (!isString(payload.sessionId) || !isString(payload.pairToken)) {
                    return rejectDevice(ws, 'BAD_MESSAGE', 'sessionId and pairToken are required', msg.id);
                }
                const result = store.pair(payload.sessionId, payload.pairToken);
                if (!result.ok) return rejectDevice(ws, result.code, 'Pairing failed', msg.id);
                const paired = store.get(payload.sessionId)!;
                attachDevice(ws, state, paired);
                sendToDevice(ws, 'paired', {sessionId: paired.id, deviceSecret: result.deviceSecret});
                broadcastDeviceStatus(paired, 'connected');
                log.info('device paired', {session: paired.id});
                return;
            }
            if (msg.type === 'resume') {
                if (!isString(payload.sessionId) || !isString(payload.deviceSecret)) {
                    return rejectDevice(ws, 'BAD_MESSAGE', 'sessionId and deviceSecret are required', msg.id);
                }
                const resumed = store.authenticateDevice(payload.sessionId, payload.deviceSecret);
                if (!resumed) {
                    const reason = store.get(payload.sessionId) ? 'invalidSecret' : 'sessionNotFound';
                    sendToDevice(ws, 'unpaired', {reason});
                    ws.close(CloseCode.unpaired, reason);
                    return;
                }
                attachDevice(ws, state, resumed);
                sendToDevice(ws, 'resumed', {sessionId: resumed.id});
                broadcastDeviceStatus(resumed, 'connected');
                return;
            }
            return rejectDevice(ws, 'NOT_AUTHENTICATED', 'Send pair or resume first', msg.id);
        }

        store.touchDevice(session);

        if (DEVICE_FORWARD.has(msg.type)) {
            if (msg.type === 'hello') session.deviceInfo = msg.payload as DeviceInfo;
            if (msg.type === 'lifecycle') session.lifecycle = payload.state as AppLifecycleState;
            for (const web of session.webs) sendRaw(web as WebSocket, raw);
            return;
        }

        if (msg.type === 'unpair') {
            unpairSession(session, 'unpairedByDevice');
            return;
        }

        sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${msg.type}`, msg.id);
    }

    // ─── Bağlantı yaşam döngüsü ──────────────────────────────────────────────

    function onConnection(ws: WebSocket, role: Role) {
        const state: SocketState = {role, session: null, alive: true, authTimer: null};
        state.authTimer = setTimeout(() => {
            if (!state.session) ws.close(CloseCode.authTimeout, 'auth timeout');
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
                return sendError(ws, 'UNSUPPORTED_VERSION', `Relay speaks v${PROTOCOL_VERSION}`, msg.id);
            }
            if (role === 'web') handleWeb(ws, state, msg, raw);
            else handleDevice(ws, state, msg, raw);
        });

        ws.on('close', () => {
            if (state.authTimer) clearTimeout(state.authTimer);
            sockets.delete(ws);
            const session = state.session;
            if (!session) return;
            if (role === 'web') {
                session.webs.delete(ws);
                store.touchWeb(session);
            } else if (session.device === ws) {
                session.device = null;
                broadcastDeviceStatus(session, 'disconnected');
            }
        });

        ws.on('error', (err) => {
            log.warn('socket error', {role, error: err.message});
        });
    }

    function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;
        const role: Role | null = path === WS_PATH_WEB ? 'web' : path === WS_PATH_DEVICE ? 'device' : null;
        if (!role) {
            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, role));
    }

    server.on('upgrade', onUpgrade);

    // ─── Periyodik işler ─────────────────────────────────────────────────────

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
        for (const session of store.collectExpired()) {
            const device = session.device as WebSocket | null;
            if (device) {
                const deviceState = sockets.get(device);
                if (deviceState) deviceState.session = null;
                sendToDevice(device, 'unpaired', {reason: 'sessionExpired'});
                device.close(CloseCode.sessionExpired, 'session expired');
            }
            log.info('session expired', {session: session.id, total: store.size});
        }
    }, config.gcIntervalMs);

    return {
        store,
        close: () =>
            new Promise<void>((resolve) => {
                clearInterval(heartbeat);
                clearInterval(gc);
                server.off('upgrade', onUpgrade);
                for (const ws of sockets.keys()) ws.terminate();
                wss.close(() => resolve());
            }),
    };
}
