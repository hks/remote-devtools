/**
 * Telefon yerine geçen sahte cihaz — web arayüzünü telefon olmadan denemek için.
 *
 *   node scripts/fake-device.ts '<QR içeriği (JSON)>'
 *
 * Bağlandıktan sonra stdin komutları:
 *   bg            → lifecycle: background
 *   fg            → lifecycle: active
 *   log <mesaj>   → info log      warn <mesaj> / err <mesaj> / debug <mesaj>
 *   drop          → soketi kapat (uygulama kapandı / ağ gitti)
 *   resume        → kayıtlı deviceSecret ile yeniden bağlan
 *   unpair        → eşleşmeyi telefondan kaldır
 *   name <ad>     → cihaz adını değiştirip hello'yu yeniden gönder
 *   quit
 */
import {createInterface} from 'node:readline';
import {WebSocket} from 'ws';
import {createEnvelope, type DeviceInfo, type LogLevel, parseEnvelope, type QrPayload} from '@remote-devtools/protocol';

const qrArg = process.argv[2];
if (!qrArg) {
    console.error("Kullanım: node scripts/fake-device.ts '<QR JSON>'");
    process.exit(1);
}
const qr = JSON.parse(qrArg) as QrPayload;

const info: DeviceInfo = {
    platform: 'ios',
    osVersion: '26.1',
    appVersion: '5.12.0',
    buildNumber: '5120',
    deviceName: 'Fake iPhone',
    userId: 1234567,
    apiEndpoint: 'https://api.example.com',
    commands: ['tryBoost', 'trySuperLike', 'rateUs.showPopup'],
};

let ws: WebSocket | null = null;
let deviceSecret: string | null = null;

function send(type: string, payload: unknown = {}) {
    if (ws?.readyState !== WebSocket.OPEN) {
        console.log('  (bağlı değil)');
        return;
    }
    ws.send(JSON.stringify(createEnvelope(type, payload)));
}

function connect(mode: 'pair' | 'resume') {
    const socket = new WebSocket(qr.url);
    ws = socket;
    socket.on('open', () => {
        if (mode === 'pair') send('pair', {sessionId: qr.sessionId, pairToken: qr.pairToken});
        else send('resume', {sessionId: qr.sessionId, deviceSecret});
    });
    socket.on('message', (data) => {
        const msg = parseEnvelope(data.toString());
        if (!msg) return;
        const payload = msg.payload as Record<string, unknown>;
        switch (msg.type) {
            case 'paired':
                deviceSecret = payload.deviceSecret as string;
                console.log('✔ eşleşti');
                send('hello', info);
                send('lifecycle', {state: 'active'});
                break;
            case 'resumed':
                console.log('✔ yeniden bağlandı');
                send('hello', info);
                send('lifecycle', {state: 'active'});
                break;
            case 'unpaired':
                console.log(`✖ eşleşme kaldırıldı (${payload.reason})`);
                deviceSecret = null;
                break;
            case 'error':
                console.log(`✖ relay hatası: ${payload.code}`);
                break;
            default:
                console.log(`← ${msg.type}`, JSON.stringify(msg.payload));
        }
    });
    socket.on('close', (code) => console.log(`… soket kapandı (${code})`));
    socket.on('error', (err) => console.log(`✖ ${err.message}`));
}

connect('pair');

const LOG_COMMANDS: Record<string, LogLevel> = {log: 'info', debug: 'debug', warn: 'warn', err: 'error'};

createInterface({input: process.stdin}).on('line', (line) => {
    const [cmd = '', ...rest] = line.trim().split(' ');
    const text = rest.join(' ');
    if (cmd === 'bg') send('lifecycle', {state: 'background'});
    else if (cmd === 'fg') send('lifecycle', {state: 'active'});
    else if (cmd in LOG_COMMANDS) send('log', {level: LOG_COMMANDS[cmd], message: text || cmd, data: {example: true, at: Date.now()}});
    else if (cmd === 'drop') ws?.terminate();
    else if (cmd === 'resume') deviceSecret ? connect('resume') : console.log('  (deviceSecret yok)');
    else if (cmd === 'unpair') send('unpair');
    else if (cmd === 'name') {
        info.deviceName = text || null;
        send('hello', info);
    }
    else if (cmd === 'quit') process.exit(0);
    else if (cmd) console.log('  komutlar: bg, fg, log/debug/warn/err <mesaj>, name <ad>, drop, resume, unpair, quit');
});
