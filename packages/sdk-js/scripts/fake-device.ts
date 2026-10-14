/**
 * Fake device standing in for a real app — to try the UI and relay without a device. Uses the SDK itself.
 *
 *   node scripts/fake-device.ts qr '<QR content (JSON)>'
 *   node scripts/fake-device.ts code <6-digit code> [ws://127.0.0.1:8080]
 *   node scripts/fake-device.ts dev [port]          # isDevelopment: finds the local relay, asks for approval in the UI
 *
 * stdin commands once connected:
 *   bg / fg       → lifecycle: background / active
 *   log <msg>     → info log      warn <msg> / err <msg> / debug <msg>
 *   name <name>   → changes the `meta.user` field (a new hello is sent to the UI)
 *   net <url>     → makes a request with fetch (shows up in the Network tab)
 *   set <k> <v>   → writes to the fake store (Storage tab)
 *   inc           → increments the counter in the fake store (State tab)
 *   flags         → prints flag values (Flags tab)
 *   drop          → close the connection (pairing is kept)
 *   resume        → reconnect with the stored pairing
 *   unpair        → remove the pairing from the device
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
    panelsModule,
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

// Lifecycle driven from stdin.
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

// Storage: an in-memory store (reports changes to the UI).
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

// State: a small Redux-like store.
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

// Custom panel: shows the counter store.
const panels = panelsModule();
const counterPanel = panels.define({
    id: 'counter',
    title: 'Counter',
    icon: '🔢',
    blocks: [
        {id: 'value', type: 'stats', items: [{label: 'Counter', value: 0}]},
        {id: 'tools', type: 'actions', actions: [{id: 'inc', label: 'Increment', handler: () => (inc(), appState.counter)}]},
    ],
});
function inc() {
    dispatch('counter/increment', {...appState, counter: appState.counter + 1});
    counterPanel.update('value', {items: [{label: 'Counter', value: appState.counter}]});
}

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
    modules: [functions, network, storageModule({adapters: [memoryAdapter]}), stateModule({stores: [appStore]}), flags, panels],
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
    else if (cmd === 'inc') inc();
    else if (cmd === 'flags') console.log(`  checkout.v2=${flags.get('checkout.v2')} api.timeout=${flags.get('api.timeout')}`);
    else if (cmd === 'drop') devtools.connection.disconnect();
    else if (cmd === 'resume') devtools.connection.connect();
    else if (cmd === 'unpair') devtools.connection.unpair();
    else if (cmd === 'quit') {
        devtools.destroy();
        process.exit(0);
    } else if (cmd) console.log('  commands: bg, fg, log/debug/warn/err <message>, name <text>, net <url>, set <key> <value>, inc, flags, drop, resume, unpair, quit');
});
