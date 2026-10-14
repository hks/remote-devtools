import {
    flagsModule,
    functionsModule,
    ModuleError,
    networkModule,
    RemoteDevTools,
    stateModule,
    storageModule,
    webStorageAdapter,
    zustandAdapter,
} from '@himmetkaan/remote-devtools';
import {createStore} from 'zustand/vanilla';

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

// ─── Storage, State, Flags ───────────────────────────────────────────────────

const storage = storageModule({
    adapters: [webStorageAdapter(localStorage), webStorageAdapter(sessionStorage, {id: 'session-storage', title: 'sessionStorage'})],
});

type Todo = {id: number; title: string; done: boolean};
type TodoState = {todos: Todo[]; filter: 'all' | 'open' | 'done'; add(title: string): void; toggle(id: number): void};

const todoStore = createStore<TodoState>()((set) => ({
    todos: [{id: 1, title: 'Try the State tab', done: false}],
    filter: 'all',
    add: (title) => set((s) => ({todos: [...s.todos, {id: Date.now(), title, done: false}]})),
    toggle: (id) => set((s) => ({todos: s.todos.map((t) => (t.id === id ? {...t, done: !t.done} : t))})),
}));

const state = stateModule({stores: [zustandAdapter(todoStore, {id: 'todos', title: 'Todos'})]});

const flags = flagsModule();
const bannerVisible = flags.define({key: 'banner.visible', title: 'Show banner', group: 'Page', field: {type: 'boolean', default: true}});
const bannerText = flags.define({key: 'banner.text', title: 'Banner text', group: 'Page', field: {type: 'text', default: 'Welcome to the example!'}});
const accent = flags.define({
    key: 'theme.accent',
    title: 'Accent colour',
    group: 'Theme',
    description: 'Changes the colour of the primary buttons.',
    field: {type: 'select', options: ['pink', 'blue', 'green'] as const, default: 'pink'},
});
flags.define({key: 'api.retries', title: 'API retries', group: 'Network', field: {type: 'number', min: 0, max: 5, default: 2}});

const ACCENTS = {pink: '#d6336c', blue: '#0969da', green: '#1a7f37'} as const;
const renderFlags = () => {
    $('banner').hidden = !bannerVisible.get();
    $('banner').textContent = bannerText.get();
    document.documentElement.style.setProperty('--accent', ACCENTS[accent.get()]);
};
flags.subscribe(renderFlags);

// ─── SDK ─────────────────────────────────────────────────────────────────────

const devtools = RemoteDevTools.init({
    enabled: true,
    isDevelopment,
    app: {id: 'dev.remote-devtools.example.web', name: 'Web Example', version: '1.0.0'},
    meta: {page: location.pathname, environment: 'example'},
    history: {enabled: true},
    captureConsole: ['warn', 'error'],
    modules: [functions, network, storage, state, flags],
    debug: true,
});
renderFlags();

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

// ─── Storage ve state kontrolleri ─────────────────────────────────────────────

$('storage-write').onclick = () => {
    localStorage.setItem('example.lastClick', JSON.stringify({at: new Date().toISOString(), counter}));
    sessionStorage.setItem('example.visits', String(Number(sessionStorage.getItem('example.visits') ?? 0) + 1));
};

const renderTodos = () => {
    const list = $('todos');
    list.replaceChildren(
        ...todoStore.getState().todos.map((todo) => {
            const item = document.createElement('li');
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = todo.done;
            box.onchange = () => todoStore.getState().toggle(todo.id);
            item.append(box, ` ${todo.title}`);
            return item;
        }),
    );
};
todoStore.subscribe(renderTodos);
renderTodos();
$('todo-add').onclick = () => {
    const input = $<HTMLInputElement>('todo-title');
    if (input.value.trim()) todoStore.getState().add(input.value.trim());
    input.value = '';
};
$('todo-filter').onclick = () => {
    const order = ['all', 'open', 'done'] as const;
    todoStore.setState((s) => ({filter: order[(order.indexOf(s.filter) + 1) % order.length]!}));
};
