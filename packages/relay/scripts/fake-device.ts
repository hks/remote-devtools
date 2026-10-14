/**
 * Gerçek uygulama yerine geçen sahte cihaz — UI'ı ve relay'i cihaz olmadan denemek için.
 * Faz 2'de JS SDK üzerine yeniden yazılacak.
 *
 *   node scripts/fake-device.ts qr '<QR içeriği (JSON)>'
 *   node scripts/fake-device.ts code <6 haneli kod> [ws://127.0.0.1:8080/ws/device]
 *   node scripts/fake-device.ts connect [ws://127.0.0.1:8080/ws/device]     # relay CONNECT_REQUESTS=local olmalı
 *
 * Bağlandıktan sonra stdin komutları:
 *   bg / fg       → lifecycle: background / active
 *   log <mesaj>   → info log      warn <mesaj> / err <mesaj> / debug <mesaj>
 *   name <ad>     → cihaz adını değiştirip hello'yu yeniden gönder
 *   drop          → soketi kapat (uygulama kapandı / ağ gitti)
 *   resume        → kayıtlı deviceSecret ile yeniden bağlan
 *   unpair        → eşleşmeyi cihazdan kaldır
 *   quit
 */
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {WebSocket} from 'ws';
import {
    createEnvelope,
    type Hello,
    type LogLevel,
    parseEnvelope,
    parseQrPayload,
    PROTOCOL_VERSION,
    WS_PATH_DEVICE,
} from '@himmetkaan/remote-devtools-protocol';

const DEFAULT_URL = `ws://127.0.0.1:8080${WS_PATH_DEVICE}`;
const USAGE = `Usage:
  node scripts/fake-device.ts qr '<QR JSON>'
  node scripts/fake-device.ts code <6-digit code> [${DEFAULT_URL}]
  node scripts/fake-device.ts connect [${DEFAULT_URL}]`;

type Start = { kind: 'qr'; url: string; sessionId: string; qrToken: string } | { kind: 'code'; url: string; code: string } | { kind: 'connect'; url: string };

function parseArgs(): Start {
    const [mode, a, b] = process.argv.slice(2);
    if (mode === 'qr' && a) {
        const qr = parseQrPayload(a);
        if (!qr) throw new Error('Invalid QR JSON');
        if (qr.v !== PROTOCOL_VERSION) throw new Error(`QR is for protocol v${qr.v}, this script speaks v${PROTOCOL_VERSION}`);
        return {kind: 'qr', url: qr.url, sessionId: qr.sessionId, qrToken: qr.qrToken};
    }
    if (mode === 'code' && a) return {kind: 'code', url: b ?? DEFAULT_URL, code: a};
    if (mode === 'connect') return {kind: 'connect', url: a ?? DEFAULT_URL};
    console.error(USAGE);
    process.exit(1);
}

const start = parseArgs();
const deviceId = randomUUID().replaceAll('-', '');

const hello: Hello = {
    app: {id: 'dev.remote-devtools.fake', name: 'Fake App', version: '1.0.0', build: '1'},
    device: {platform: 'ios', os: '26.1', model: 'iPhone', name: 'Fake iPhone'},
    sdk: {name: 'fake-device', version: '0.0.0'},
    isDevelopment: start.kind === 'connect',
    meta: {userId: '1234567', apiEndpoint: 'https://api.example.com'},
    capabilities: {
        functions: {
            commands: [
                {id: 'ping', title: 'Ping', description: 'Returns pong.', group: 'Demo'},
                {
                    id: 'echo',
                    title: 'Echo',
                    description: 'Returns the given arguments.',
                    group: 'Demo',
                    args: {text: {type: 'text', label: 'Text', required: true}, times: {type: 'number', min: 1, max: 5, default: 1}},
                },
            ],
        },
    },
};

let ws: WebSocket | null = null;
let session: {sessionId: string; deviceSecret: string} | null = null;

function send(type: string, payload: unknown = {}, replyTo?: string) {
    if (ws?.readyState !== WebSocket.OPEN) {
        console.log('  (not connected)');
        return;
    }
    ws.send(JSON.stringify(createEnvelope(type, payload, {replyTo})));
}

function announce() {
    send('hello', hello);
    send('lifecycle', {state: 'active'});
}

function handleInvoke(id: string, payload: {commandId: string; args: Record<string, unknown>}) {
    const result =
        payload.commandId === 'ping'
            ? {ok: true, result: 'pong'}
            : payload.commandId === 'echo'
              ? {ok: true, result: Array.from({length: Number(payload.args.times ?? 1)}, () => payload.args.text)}
              : {ok: false, error: {code: 'UNKNOWN_COMMAND', message: `Unknown command: ${payload.commandId}`}};
    console.log(`← invoke ${payload.commandId}`, JSON.stringify(payload.args));
    send('module.functions.result', result, id);
}

function open(mode: 'start' | 'resume') {
    const socket = new WebSocket(start.url);
    ws = socket;
    socket.on('open', () => {
        if (mode === 'resume' && session) send('resume', {...session, deviceId});
        else if (start.kind === 'qr') send('pair.qr', {sessionId: start.sessionId, qrToken: start.qrToken, deviceId});
        else if (start.kind === 'code') send('pair.code', {code: start.code, deviceId});
        else send('connect', {deviceId, hello});
    });
    socket.on('message', (data) => {
        const msg = parseEnvelope(data.toString());
        if (!msg) return;
        const payload = msg.payload as Record<string, any>;
        switch (msg.type) {
            case 'paired':
                session = {sessionId: payload.sessionId, deviceSecret: payload.deviceSecret};
                console.log(`✔ paired (expires ${new Date(payload.expiresAt).toLocaleString()})`);
                announce();
                break;
            case 'resumed':
                console.log('✔ resumed');
                announce();
                break;
            case 'connect.pending':
                console.log('… waiting for approval in the UI');
                break;
            case 'connect.rejected':
                console.log(`✖ connect rejected (${payload.reason})`);
                break;
            case 'unpaired':
                console.log(`✖ unpaired (${payload.reason})`);
                session = null;
                break;
            case 'error':
                console.log(`✖ relay error: ${payload.code} — ${payload.message}`);
                break;
            case 'module.functions.invoke':
                handleInvoke(msg.id, payload as {commandId: string; args: Record<string, unknown>});
                break;
            default:
                console.log(`← ${msg.type}`, JSON.stringify(msg.payload));
        }
    });
    socket.on('close', (code) => console.log(`… socket closed (${code})`));
    socket.on('error', (err) => console.log(`✖ ${err.message}`));
}

open('start');

const LOG_COMMANDS: Record<string, LogLevel> = {log: 'info', debug: 'debug', warn: 'warn', err: 'error'};

createInterface({input: process.stdin}).on('line', (line) => {
    const [cmd = '', ...rest] = line.trim().split(' ');
    const text = rest.join(' ');
    if (cmd === 'bg') send('lifecycle', {state: 'background'});
    else if (cmd === 'fg') send('lifecycle', {state: 'active'});
    else if (cmd in LOG_COMMANDS) send('log', {level: LOG_COMMANDS[cmd], message: text || cmd, data: {example: true}, at: Date.now()});
    else if (cmd === 'drop') ws?.terminate();
    else if (cmd === 'resume') session ? open('resume') : console.log('  (no saved pairing)');
    else if (cmd === 'unpair') send('unpair');
    else if (cmd === 'name') {
        hello.device.name = text || undefined;
        send('hello', hello);
    } else if (cmd === 'quit') process.exit(0);
    else if (cmd) console.log('  commands: bg, fg, log/debug/warn/err <message>, name <name>, drop, resume, unpair, quit');
});
