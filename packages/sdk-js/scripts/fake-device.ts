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
 *   drop          → bağlantıyı kapat (eşleşme saklanır)
 *   resume        → kayıtlı eşleşmeyle yeniden bağlan
 *   unpair        → eşleşmeyi cihazdan kaldır
 *   quit
 */
import {createInterface} from 'node:readline';
import type {Lifecycle, LogLevel} from '@himmetkaan/remote-devtools-protocol';
import {defineModule, type LifecycleSource, memoryStorage, ModuleError, RemoteDevTools} from '../src/index.ts';

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

/** Faz 4'teki functions modülüne kadar örnek: `defineModule` ile elle yazılmış iki komut. */
const demoFunctions = defineModule({
    name: 'functions',
    capabilities: () => ({
        commands: [
            {id: 'ping', title: 'Ping', description: 'Returns pong.', group: 'Demo'},
            {
                id: 'echo',
                title: 'Echo',
                description: 'Returns the given text.',
                group: 'Demo',
                args: {text: {type: 'text', label: 'Text', required: true}, times: {type: 'number', min: 1, max: 5, default: 1}},
            },
        ],
    }),
    setup(ctx) {
        ctx.handle<{commandId: string; args: Record<string, unknown>}>('module.functions.invoke', ({commandId, args}) => {
            console.log(`← invoke ${commandId}`, JSON.stringify(args));
            if (commandId === 'ping') return 'pong';
            if (commandId === 'echo') return Array.from({length: Number(args.times ?? 1)}, () => args.text);
            throw new ModuleError('UNKNOWN_COMMAND', `Unknown command: ${commandId}`);
        });
    },
});

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
    modules: [demoFunctions],
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
    else if (cmd === 'drop') devtools.connection.disconnect();
    else if (cmd === 'resume') devtools.connection.connect();
    else if (cmd === 'unpair') devtools.connection.unpair();
    else if (cmd === 'quit') {
        devtools.destroy();
        process.exit(0);
    } else if (cmd) console.log('  commands: bg, fg, log/debug/warn/err <message>, name <text>, drop, resume, unpair, quit');
});
