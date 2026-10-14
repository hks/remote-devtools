import {defineModule, ModuleError, RemoteDevTools} from '@himmetkaan/remote-devtools';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const DEV_KEY = 'example.isDevelopment';
const isDevelopment = localStorage.getItem(DEV_KEY) === '1';

// ─── Uygulama durumu (Functions tab'ından değiştirilir) ──────────────────────

let counter = 0;
const render = () => {
    $('counter').textContent = String(counter);
};

/**
 * Faz 4'teki `functionsModule` gelene kadar `defineModule` ile yazılmış örnek fonksiyonlar.
 * Argümanlar field DSL ile tanımlanır; UI formu bundan çizer.
 */
const functions = defineModule({
    name: 'functions',
    capabilities: () => ({
        commands: [
            {id: 'counter.increment', title: 'Increment counter', group: 'Counter', args: {by: {type: 'number', label: 'By', min: 1, max: 100, default: 1}}},
            {id: 'counter.reset', title: 'Reset counter', group: 'Counter', confirm: 'Reset the counter to 0?', danger: true},
            {
                id: 'greeting.set',
                title: 'Set greeting',
                group: 'Page',
                description: 'Changes the greeting text on the page.',
                args: {
                    text: {type: 'text', label: 'Text', required: true, placeholder: 'Hi there'},
                    tone: {type: 'select', label: 'Tone', options: ['plain', 'excited', 'shouting'], default: 'plain', required: true},
                    emoji: {type: 'boolean', label: 'Add emoji'},
                },
            },
            {id: 'page.info', title: 'Page info', group: 'Page', description: 'Returns details about this page.'},
            {id: 'echo.json', title: 'Echo JSON', group: 'Page', args: {value: {type: 'json', label: 'Value', default: {hello: 'world'}}}},
            {id: 'fail', title: 'Always fails', group: 'Page', description: 'Shows how errors are reported.'},
        ],
    }),
    setup(ctx) {
        ctx.handle<{commandId: string; args: Record<string, any>}>('module.functions.invoke', ({commandId, args}) => {
            switch (commandId) {
                case 'counter.increment':
                    counter += Number(args.by ?? 1);
                    render();
                    return {counter};
                case 'counter.reset':
                    counter = 0;
                    render();
                    return {counter};
                case 'greeting.set': {
                    let text = String(args.text);
                    if (args.tone === 'excited') text += '!';
                    if (args.tone === 'shouting') text = text.toUpperCase() + '!!!';
                    if (args.emoji) text += ' 👋';
                    $('greeting').textContent = text;
                    return text;
                }
                case 'page.info':
                    return {url: location.href, userAgent: navigator.userAgent, viewport: `${innerWidth}×${innerHeight}`};
                case 'echo.json':
                    return args.value;
                case 'fail':
                    throw new ModuleError('EXAMPLE_FAILURE', 'This command always fails');
                default:
                    throw new ModuleError('UNKNOWN_COMMAND', `Unknown command: ${commandId}`);
            }
        });
    },
});

// ─── SDK ─────────────────────────────────────────────────────────────────────

const devtools = RemoteDevTools.init({
    enabled: true,
    isDevelopment,
    app: {id: 'dev.remote-devtools.example.web', name: 'Web Example', version: '1.0.0'},
    meta: {page: location.pathname, environment: 'example'},
    history: {enabled: true},
    captureConsole: ['warn', 'error'],
    modules: [functions],
    debug: true,
});

devtools.connection.subscribe((state) => {
    $('status').textContent = state.status + (state.error ? ` — ${state.error.message}` : '');
});
devtools.log.info('Example page loaded', {href: location.href});

// ─── Kontroller ──────────────────────────────────────────────────────────────

$<HTMLInputElement>('relay').value = `ws://${location.hostname}:8080`;
$<HTMLInputElement>('dev').checked = isDevelopment;

const report = (err: unknown) => alert((err as Error).message);

$('pair-code').onclick = () => {
    devtools.connection.pairWithCode($<HTMLInputElement>('code').value, $<HTMLInputElement>('relay').value).catch(report);
};
$('pair-qr').onclick = () => {
    devtools.connection.pairWithQr($<HTMLTextAreaElement>('qr').value).catch(report);
};
$('disconnect').onclick = () => devtools.connection.disconnect();
$('connect').onclick = () => devtools.connection.connect();
$('unpair').onclick = () => devtools.connection.unpair();
$('dev').onchange = (e) => {
    localStorage.setItem(DEV_KEY, (e.target as HTMLInputElement).checked ? '1' : '0');
    location.reload();
};
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-log]')) {
    const level = button.dataset.log as 'debug' | 'info' | 'warn' | 'error';
    button.onclick = () => devtools.log[level](`A ${level} message from the example page`, {clickedAt: new Date().toISOString()}, {tag: 'example'});
}
$('console').onclick = () => console.warn('console.warn from the example page', {captured: true});
