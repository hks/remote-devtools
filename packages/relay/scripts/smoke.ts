/**
 * Çalışan bir relay'e karşı uçtan uca eşleşme testi.
 *   node scripts/smoke.ts                       # ws://127.0.0.1:8080
 *   node scripts/smoke.ts wss://devtools.example.com
 */
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {createEnvelope, type Envelope, WS_PATH_DEVICE, WS_PATH_UI} from '@himmetkaan/remote-devtools-protocol';

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

const send = (ws: WebSocket, type: string, payload: unknown = {}, extra: {deviceId?: string} = {}) =>
    ws.send(JSON.stringify(createEnvelope(type, payload, extra)));
const step = (label: string) => console.log(`✔ ${label}`);
const deviceId = randomUUID().replaceAll('-', '');

const ui = await open(WS_PATH_UI);
send(ui, 'session.create');
const session = (await next(ui, 'session')).payload;
step(`session ${session.sessionId} (deviceWsUrl: ${session.deviceWsUrl ?? 'origin'})`);

const device = await open(WS_PATH_DEVICE);
send(device, 'pair.code', {code: session.pairing.code, deviceId});
await next(device, 'paired');
await next(ui, 'device.status');
step('device paired with code');

send(device, 'log', {level: 'info', message: 'smoke', at: Date.now()});
await next(ui, 'log');
step('device → UI forwarded');

send(ui, 'module.smoke.ping', {}, {deviceId});
await next(device, 'module.smoke.ping');
step('UI → device forwarded');

send(ui, 'device.unpair', {deviceId});
await next(device, 'unpaired');
const status = (await next(ui, 'device.status')).payload;
if (status.state !== 'unpaired') throw new Error(`expected unpaired, got ${status.state}`);
step('device unpaired');

ui.close();
device.close();
console.log('smoke OK');
