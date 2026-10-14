import {functionsModule, ModuleError, networkModule, RemoteDevTools} from '@himmetkaan/remote-devtools';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const DEV_KEY = 'example.isDevelopment';
const isDevelopment = localStorage.getItem(DEV_KEY) === '1';

// ─── Uygulama durumu (Functions tab'ından değiştirilir) ──────────────────────

let counter = 0;
const render = () => {
    $('counter').textContent = String(counter);
};

const functions = functionsModule();
const network = networkModule();

functions.register({
    id: 'counter.increment',
    title: 'Increment counter',
    group: 'Counter',
    args: {by: {type: 'number', label: 'By', min: 1, max: 100, default: 1}},
    handler: ({by}) => {
        counter += by;
        render();
        return {counter};
    },
});

functions.register({
    id: 'counter.reset',
    title: 'Reset counter',
    group: 'Counter',
    confirm: 'Reset the counter to 0?',
    danger: true,
    handler: () => {
        counter = 0;
        render();
        return {counter};
    },
});

functions.register({
    id: 'greeting.set',
    title: 'Set greeting',
    group: 'Page',
    description: 'Changes the greeting text on the page.',
    args: {
        text: {type: 'text', label: 'Text', required: true, placeholder: 'Hi there'},
        tone: {type: 'select', label: 'Tone', options: ['plain', 'excited', 'shouting'], default: 'plain', required: true},
        emoji: {type: 'boolean', label: 'Add emoji'},
    },
    handler: ({text, tone, emoji}) => {
        let value = text;
        if (tone === 'excited') value += '!';
        if (tone === 'shouting') value = value.toUpperCase() + '!!!';
        if (emoji) value += ' 👋';
        $('greeting').textContent = value;
        return value;
    },
});

functions.register({
    id: 'page.info',
    title: 'Page info',
    group: 'Page',
    description: 'Returns details about this page.',
    handler: () => ({url: location.href, userAgent: navigator.userAgent, viewport: `${innerWidth}×${innerHeight}`}),
});

functions.register({id: 'echo.json', title: 'Echo JSON', group: 'Page', args: {value: {type: 'json', label: 'Value', default: {hello: 'world'}}}, handler: ({value}) => value});

functions.register({
    id: 'fail',
    title: 'Always fails',
    group: 'Page',
    description: 'Shows how errors are reported.',
    handler: () => {
        throw new ModuleError('EXAMPLE_FAILURE', 'This command always fails');
    },
});

// Bağlıyken eklenen fonksiyon UI'da hemen görünür.
let extraRegistered = false;
functions.register({
    id: 'functions.toggleExtra',
    title: 'Toggle an extra function',
    group: 'Dynamic',
    description: 'Registers or removes another function at runtime.',
    handler: () => {
        if (extraRegistered) functions.unregister('dynamic.hello');
        else functions.register({id: 'dynamic.hello', title: 'Hello from a dynamic function', group: 'Dynamic', handler: () => 'hello'});
        extraRegistered = !extraRegistered;
        return extraRegistered ? 'registered' : 'removed';
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
    modules: [functions, network],
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

// ─── Ağ istekleri (Network tab'ı) ─────────────────────────────────────────────

const relayHttp = () => $<HTMLInputElement>('relay').value.replace(/^ws/, 'http');
$('net-ok').onclick = () => void fetch(`${relayHttp()}/health`).then((r) => r.json());
$('net-404').onclick = () => void fetch(`${relayHttp()}/does-not-exist`).catch(() => {});
$('net-post').onclick = () =>
    void fetch('https://httpbin.org/post', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({counter})}).catch(() => {});
$('net-fail').onclick = () => void fetch('http://127.0.0.1:1/unreachable').catch(() => {});
$('net-xhr').onclick = () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${relayHttp()}/discovery`);
    xhr.send();
};
