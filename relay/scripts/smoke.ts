/**
 * Çalışan bir relay'e karşı uçtan uca eşleşme testi.
 *   node scripts/smoke.ts                       # ws://127.0.0.1:8080
 *   node scripts/smoke.ts wss://devtools.example.com
 */
import {WebSocket} from 'ws';
import {createEnvelope, type Envelope, WS_PATH_DEVICE, WS_PATH_WEB} from '../../shared/protocol.ts';

const base = (process.argv[2] ?? 'ws://127.0.0.1:8080').replace(/\/+$/, '');

function open(path: string): Promise<WebSocket> {
    const ws = new WebSocket(base + path);
    return new Promise((resolve, reject) => {
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
}

function next(ws: WebSocket, type: string): Promise<Envelope<string, any>> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 5000);
        const onMessage = (data: WebSocket.RawData) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'error') {
                clearTimeout(timer);
                ws.off('message', onMessage);
                reject(new Error(`relay error: ${msg.payload.code}`));
            } else if (msg.type === type) {
                clearTimeout(timer);
                ws.off('message', onMessage);
                resolve(msg);
            }
        };
        ws.on('message', onMessage);
    });
}

const send = (ws: WebSocket, type: string, payload: unknown = {}) => ws.send(JSON.stringify(createEnvelope(type, payload)));
const step = (label: string) => console.log(`✔ ${label}`);

const web = await open(WS_PATH_WEB);
send(web, 'createSession');
const session = (await next(web, 'session')).payload;
step(`session ${session.sessionId} (deviceWsUrl: ${session.deviceWsUrl ?? 'origin'})`);

const device = await open(WS_PATH_DEVICE);
send(device, 'pair', {sessionId: session.sessionId, pairToken: session.pairToken});
await next(device, 'paired');
await next(web, 'deviceStatus');
step('device paired');

send(device, 'hello', {platform: 'smoke', commands: []});
await next(web, 'hello');
step('device → web forwarded');

send(web, 'sync');
await next(device, 'sync');
step('web → device forwarded');

send(web, 'unpair');
await next(device, 'unpaired');
await next(web, 'pairToken');
step('unpaired, fresh pair token issued');

web.close();
device.close();
console.log('smoke OK');
