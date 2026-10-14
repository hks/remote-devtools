/**
 * Gerçek uygulama yerine geçen sahte cihaz — UI'ı ve relay'i cihaz olmadan denemek için. SDK'nın kendisini kullanır.
 *
 *   node scripts/fake-device.ts qr '<QR içeriği (JSON)>'
 *   node scripts/fake-device.ts code <6 haneli kod> [ws://127.0.0.1:8080]
 *   node scripts/fake-device.ts dev [port]          # isDevelopment: yerel relay'i bulur, UI'dan onay ister
 *
 * Bağlandıktan sonra stdin komutları:
 *   bg / fg       → lifecycle: background / active
 *   log <mesaj>   → info log      warn <mesaj> / err <mesaj> / debug <mesaj>
 *   name <ad>     → `meta.user` alanını değiştirir (UI'a yeni hello gider)
 *   net <url>     → fetch ile istek atar (Network tab'ında görünür)
 *   set <k> <v>   → sahte depoya yazar (Storage tab'ı)
 *   inc           → sahte store'daki sayacı artırır (State tab'ı)
 *   flags         → flag değerlerini yazdırır (Flags tab'ı)
 *   drop          → bağlantıyı kapat (eşleşme saklanır)
 *   resume        → kayıtlı eşleşmeyle yeniden bağlan
 *   unpair        → eşleşmeyi cihazdan kaldır
 *   quit
 */
import {createInterface} from 'node:readline';
import type {Lifecycle, LogLevel} from '@himmetkaan/remote-devtools-protocol';
import {
    flagsModule,
    functionsModule,
    type LifecycleSource,
    memoryStorage,
    networkModule,
    RemoteDevTools,
    stateModule,
    type StorageAdapter,
    storageModule,
} from '../src/index.ts';

const USAGE = `Usage:
  node scripts/fake-device.ts qr '<QR JSON>'
  node scripts/fake-device.ts code <6-digit code> [ws://127.0.0.1:8080]
  node scripts/fake-device.ts dev [port]`;

const [mode, arg1, arg2] = process.argv.slice(2);
if (!mode || !['qr', 'code', 'dev'].includes(mode) || (mode !== 'dev' && !arg1)) {
    console.error(USAGE);
    process.exit(1);
}

// stdin'den yönetilen yaşam döngüsü.
let lifecycleState: Lifecycle = 'active';
const lifecycleListeners = new Set<(state: Lifecycle) => void>();
const lifecycle: LifecycleSource = {
    current: () => lifecycleState,
    subscribe(listener) {
        lifecycleListeners.add(listener);
        return () => lifecycleListeners.delete(listener);
    },
};
function setLifecycle(state: Lifecycle) {
    lifecycleState = state;
    for (const listener of lifecycleListeners) listener(state);
}

const functions = functionsModule();
const network = networkModule();

functions.register({id: 'ping', title: 'Ping', description: 'Returns pong.', group: 'Demo', handler: () => 'pong'});
functions.register({
    id: 'echo',
    title: 'Echo',
    description: 'Returns the given text.',
    group: 'Demo',
    args: {text: {type: 'text', label: 'Text', required: true}, times: {type: 'number', min: 1, max: 5, default: 1}},
    handler: ({text, times}) => Array.from({length: times}, () => text),
});

// Storage: bellekte bir depo (değişiklikleri UI'a bildirir).
const fakeStore = new Map<string, string>([['user', JSON.stringify({id: 1234567, name: 'Fake User'})], ['onboarding.done', 'true']]);
const storeListeners = new Set<(key: string | null) => void>();
const memoryAdapter: StorageAdapter = {
    id: 'memory',
    title: 'Memory',
    keys: () => [...fakeStore.keys()],
    get: (key) => fakeStore.get(key),
    set: (key, value) => void (fakeStore.set(key, value), storeListeners.forEach((l) => l(key))),
    remove: (key) => void (fakeStore.delete(key), storeListeners.forEach((l) => l(key))),
    subscribe(listener) {
        storeListeners.add(listener);
        return () => storeListeners.delete(listener);
    },
};

// State: Redux benzeri küçük bir store.
let appState = {counter: 0, cart: {items: [] as string[]}};
const stateListeners = new Set<(action?: string) => void>();
const appStore = {
    id: 'app',
    title: 'App',
    getState: () => appState,
    subscribe(listener: (action?: string) => void) {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
    },
};
function dispatch(action: string, next: typeof appState) {
    appState = next;
    stateListeners.forEach((l) => l(action));
}

const flags = flagsModule();
flags.define({key: 'checkout.v2', title: 'New checkout', field: {type: 'boolean'}});
flags.define({key: 'api.timeout', title: 'API timeout (s)', field: {type: 'number', min: 1, max: 60, default: 30}});

const devtools = RemoteDevTools.init({
    enabled: true,
    isDevelopment: mode === 'dev',
    app: {id: 'dev.remote-devtools.fake', name: 'Fake App', version: '1.0.0', build: '1'},
    device: {platform: 'ios', os: '26.1', model: 'iPhone', name: 'Fake iPhone'},
    meta: {userId: '1234567', apiEndpoint: 'https://api.example.com'},
    storage: memoryStorage(),
    lifecycle,
    history: {enabled: true},
    discovery: {localhost: {port: Number(arg1 ?? 8080), hosts: ['127.0.0.1']}},
    modules: [functions, network, storageModule({adapters: [memoryAdapter]}), stateModule({stores: [appStore]}), flags],
});

let lastStatus = '';
devtools.connection.subscribe((state) => {
    const line = `${state.status}${state.error ? ` (${state.error.code}: ${state.error.message})` : ''}`;
    if (line === lastStatus) return;
    lastStatus = line;
    console.log(`… ${line}`);
});

if (mode === 'qr') await devtools.connection.pairWithQr(arg1!);
if (mode === 'code') await devtools.connection.pairWithCode(arg1!, arg2 ?? 'ws://127.0.0.1:8080');

const LOG_COMMANDS: Record<string, LogLevel> = {log: 'info', debug: 'debug', warn: 'warn', err: 'error'};

createInterface({input: process.stdin}).on('line', (line) => {
    const [cmd = '', ...rest] = line.trim().split(' ');
    const text = rest.join(' ');
    if (cmd === 'bg') setLifecycle('background');
    else if (cmd === 'fg') setLifecycle('active');
    else if (cmd in LOG_COMMANDS) devtools.log[LOG_COMMANDS[cmd]!](text || cmd, {example: true});
    else if (cmd === 'name') devtools.updateMeta({user: text});
    else if (cmd === 'net') void fetch(text || 'https://example.com').then((r) => console.log(`  ${r.status} ${r.url}`), (e: Error) => console.log(`  ✖ ${e.message}`));
    else if (cmd === 'set' && rest[0]) memoryAdapter.set!(rest[0], rest.slice(1).join(' '));
    else if (cmd === 'inc') dispatch('counter/increment', {...appState, counter: appState.counter + 1});
    else if (cmd === 'flags') console.log(`  checkout.v2=${flags.get('checkout.v2')} api.timeout=${flags.get('api.timeout')}`);
    else if (cmd === 'drop') devtools.connection.disconnect();
    else if (cmd === 'resume') devtools.connection.connect();
    else if (cmd === 'unpair') devtools.connection.unpair();
    else if (cmd === 'quit') {
        devtools.destroy();
        process.exit(0);
    } else if (cmd) console.log('  commands: bg, fg, log/debug/warn/err <message>, name <text>, net <url>, set <key> <value>, inc, flags, drop, resume, unpair, quit');
});
