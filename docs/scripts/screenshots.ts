/**
 * Captures the UI screenshots used by the landing page (docs/public/landing/*.webp).
 *
 *   pnpm docs:screenshots
 *
 * Starts a relay that serves the built UI, opens it in headless Chrome (DevTools protocol, 2× pixel density, dark
 * scheme), pairs the demo device from demo-device.ts, lets a second device ask to connect, and visits every tab.
 * Requires Google Chrome; set CHROME_PATH to use another Chromium build.
 */
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRelay} from '@himmetkaan/remote-devtools-relay';
import {createDemoDevice} from './demo-device.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const outDir = join(root, 'docs/public/landing');
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = 9333;
const VIEWPORT = {width: 1440, height: 900};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tiny DevTools-protocol client over the global WebSocket. */
async function connectCdp(wsUrl: string) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });
    let nextId = 1;
    const pending = new Map<number, {resolve: (v: any) => void; reject: (e: Error) => void}>();
    ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
        const call = msg.id ? pending.get(msg.id) : undefined;
        if (!call) return;
        pending.delete(msg.id);
        if (msg.error) call.reject(new Error(msg.error.message));
        else call.resolve(msg.result);
    };
    const send = (method: string, params: Record<string, unknown> = {}): Promise<any> =>
        new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, {resolve, reject});
            ws.send(JSON.stringify({id, method, params}));
        });
    return {send, close: () => ws.close()};
}

const relay = await createRelay({
    port: 0,
    host: '127.0.0.1',
    webDistDir: join(root, 'packages/ui/dist'),
    connectRequests: 'local',
    // What the desktop app would advertise on a LAN; the pairing screen shows it instead of a localhost warning.
    publicUrl: 'http://192.168.1.24:8787',
});
const base = `http://127.0.0.1:${relay.port}`;
const profile = mkdtempSync(join(tmpdir(), 'rdt-shots-'));
const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    'about:blank',
]);

const devices: {destroy(): void}[] = [];
try {
    let targets: {type: string; webSocketDebuggerUrl: string}[] = [];
    for (let i = 0; i < 50 && targets.length === 0; i++) {
        await sleep(200);
        targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
            .then((r) => r.json() as Promise<typeof targets>)
            .then((all) => all.filter((t) => t.type === 'page'))
            .catch(() => []);
    }
    if (!targets[0]) throw new Error('Chrome did not start');
    const cdp = await connectCdp(targets[0].webSocketDebuggerUrl);
    await cdp.send('Emulation.setDeviceMetricsOverride', {...VIEWPORT, deviceScaleFactor: 2, mobile: false});
    await cdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: 'dark'}]});

    const evaluate = async <T>(expression: string): Promise<T> => {
        const {result, exceptionDetails} = await cdp.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
        return result.value as T;
    };
    const waitFor = async (expression: string, timeoutMs = 10_000) => {
        const started = Date.now();
        while (!(await evaluate<boolean>(`Boolean(${expression})`))) {
            if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${expression}`);
            await sleep(100);
        }
    };
    const click = (selector: string, text?: string) =>
        evaluate<void>(
            `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!el) throw new Error('not found: ${selector} ${text ?? ''}'); el.click(); })()`,
        );
    const openTab = async (title: string) => {
        await click('.tab', title);
        await sleep(600);
    };
    mkdirSync(outDir, {recursive: true});
    const shot = async (name: string) => {
        await sleep(300);
        const {data} = await cdp.send('Page.captureScreenshot', {format: 'webp', quality: 86});
        writeFileSync(join(outDir, `${name}.webp`), Buffer.from(data, 'base64'));
        console.log(`  ${name}.webp`);
    };

    await cdp.send('Page.navigate', {url: base});
    await waitFor(`document.querySelector('.pairing-code')?.textContent.trim().length > 6`);
    await shot('pairing');

    // The demo iPhone pairs with the code shown on screen.
    const code = (await evaluate<string>(`document.querySelector('.pairing-code').textContent`)).replace(/\D/g, '');
    const phone = createDemoDevice();
    devices.push(phone);
    await phone.devtools.connection.pairWithCode(code, `ws://127.0.0.1:${relay.port}`);
    await waitFor(`document.querySelector('.tabbar')`);
    await phone.play();
    await sleep(800);

    // A development build on the same network asks to connect.
    const pixel = createDemoDevice({platform: 'android', discoveryPort: relay.port});
    devices.push(pixel);
    await waitFor(`document.querySelector('.request-card')`);
    await openTab('Logs');
    await shot('connect-request');
    await click('.request-card button', 'Approve');
    await waitFor(`!document.querySelector('.request-card')`);
    await click('.device-item', 'iPhone 17 Pro');
    await sleep(500);
    await shot('logs');

    await openTab('Network');
    await click('.req-row', '/catalog');
    await sleep(500);
    await shot('network');

    await openTab('Functions');
    await shot('functions');

    await openTab('Storage');
    await click('.req-row', 'auth.session');
    await sleep(500);
    await shot('storage');

    await openTab('State');
    await sleep(500);
    await phone.playCart();
    await sleep(600);
    await shot('state');

    await openTab('Flags');
    await click('.flag-card .switch', '');
    await sleep(600);
    await shot('flags');

    await openTab('Orders');
    await shot('panel');

    cdp.close();
} finally {
    for (const device of devices) device.destroy();
    chrome.kill();
    await relay.close();
    rmSync(profile, {recursive: true, force: true});
}
