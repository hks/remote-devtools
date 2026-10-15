import {
    flagsModule,
    functionsModule,
    ModuleError,
    networkModule,
    panelsModule,
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

// ─── App state (changed from the Functions tab) ──────────────────────────────

let counter = 0;
const render = () => {
    $('counter').textContent = String(counter);
    syncPanel();
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

functions.register({
    id: 'echo.json',
    title: 'Echo JSON',
    group: 'Page',
    args: {value: {type: 'json', label: 'Value', default: {hello: 'world'}}},
    handler: ({value}) => value,
});

functions.register({
    id: 'fail',
    title: 'Always fails',
    group: 'Page',
    description: 'Shows how errors are reported.',
    handler: () => {
        throw new ModuleError('EXAMPLE_FAILURE', 'This command always fails');
    },
});

// A function registered while connected shows up in the UI immediately.
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

let nextTodoId = 2;
const todoStore = createStore<TodoState>()((set) => ({
    todos: [{id: 1, title: 'Try the State tab', done: false}],
    filter: 'all',
    add: (title) => set((s) => ({todos: [...s.todos, {id: nextTodoId++, title, done: false}]})),
    toggle: (id) => set((s) => ({todos: s.todos.map((t) => (t.id === id ? {...t, done: !t.done} : t))})),
}));

const state = stateModule({stores: [zustandAdapter(todoStore, {id: 'todos', title: 'Todos'})]});

const flags = flagsModule();
const bannerVisible = flags.define({key: 'banner.visible', title: 'Show banner', group: 'Page', field: {type: 'boolean', default: true}});
const bannerText = flags.define({
    key: 'banner.text',
    title: 'Banner text',
    group: 'Page',
    field: {type: 'text', default: 'Welcome to the example!'},
});
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

// ─── Custom panel (all block types) ───────────────────────────────────────────

const panels = panelsModule();

type TodoRow = {id: number; title: string; status: string};

const todoBlocks = () => {
    const {todos, filter} = todoStore.getState();
    const done = todos.filter((t) => t.done).length;
    return {
        stats: [
            {label: 'Todos', value: todos.length},
            {label: 'Open', value: todos.length - done, tone: todos.length - done > 3 ? ('warn' as const) : undefined},
            {label: 'Done', value: done, tone: 'success' as const},
        ],
        rows: todos.map((t): TodoRow => ({id: t.id, title: t.title, status: t.done ? 'done' : 'open'})),
        info: {filter, counter, url: location.pathname},
    };
};

const initial = todoBlocks();
const todoPanel = panels.define({
    id: 'todos',
    title: 'Todo panel',
    icon: '✅',
    blocks: [
        {
            id: 'note',
            type: 'text',
            tone: 'info',
            text: 'A custom panel defined by the page with panelsModule(). It updates live as the todo list changes.',
        },
        {id: 'stats', type: 'stats', items: initial.stats},
        {
            id: 'list',
            type: 'table',
            title: 'Todos',
            columns: [
                {key: 'title', title: 'Title'},
                {key: 'status', title: 'Status'},
            ],
            rows: initial.rows,
            rowActions: [
                {id: 'toggle', label: 'Toggle', handler: (row: TodoRow) => todoStore.getState().toggle(row.id)},
                {
                    id: 'delete',
                    label: 'Delete',
                    danger: true,
                    confirm: 'Delete this todo?',
                    handler: (row: TodoRow) => todoStore.setState((s) => ({todos: s.todos.filter((t) => t.id !== row.id)})),
                },
            ],
        },
        {
            id: 'add',
            type: 'form',
            title: 'Add a todo',
            fields: {
                title: {type: 'text', label: 'Title', required: true, placeholder: 'Water the plants'},
                count: {type: 'number', label: 'How many', min: 1, max: 5, default: 1},
            },
            submit: {
                label: 'Add',
                handler: ({title, count}: {title: string; count: number}) => {
                    for (let i = 0; i < count; i++) todoStore.getState().add(count > 1 ? `${title} #${i + 1}` : title);
                    return `${count} added`;
                },
            },
        },
        {
            id: 'tools',
            type: 'actions',
            title: 'Tools',
            actions: [
                {
                    id: 'complete',
                    label: 'Complete all',
                    handler: () => todoStore.setState((s) => ({todos: s.todos.map((t) => ({...t, done: true}))})),
                },
                {
                    id: 'clearDone',
                    label: 'Remove done',
                    danger: true,
                    confirm: 'Remove all done todos?',
                    handler: () => {
                        const before = todoStore.getState().todos.length;
                        todoStore.setState((s) => ({todos: s.todos.filter((t) => !t.done)}));
                        return `${before - todoStore.getState().todos.length} removed`;
                    },
                },
            ],
        },
        {id: 'info', type: 'keyValue', title: 'Page', data: initial.info},
        {id: 'raw', type: 'json', title: 'Raw todos', data: todoStore.getState().todos},
    ],
});

const syncPanel = () => {
    const next = todoBlocks();
    todoPanel.update('stats', {items: next.stats});
    todoPanel.update('list', {rows: next.rows});
    todoPanel.update('info', {data: next.info});
    todoPanel.update('raw', {data: todoStore.getState().todos});
};
todoStore.subscribe(syncPanel);

// ─── SDK ─────────────────────────────────────────────────────────────────────

const devtools = RemoteDevTools.init({
    enabled: true,
    isDevelopment,
    app: {id: 'dev.remote-devtools.example.web', name: 'Web Example', version: '1.0.0'},
    meta: {page: location.pathname, environment: 'example'},
    history: {enabled: true},
    captureConsole: ['warn', 'error'],
    modules: [functions, network, storage, state, flags, panels],
    debug: true,
});
renderFlags();

devtools.connection.subscribe((state) => {
    $('status').textContent = state.status + (state.error ? ` — ${state.error.message}` : '');
});
devtools.log.info('Example page loaded', {href: location.href});

// ─── Controls ────────────────────────────────────────────────────────────────

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
    button.onclick = () =>
        devtools.log[level](`A ${level} message from the example page`, {clickedAt: new Date().toISOString()}, {tag: 'example'});
}
$('console').onclick = () => console.warn('console.warn from the example page', {captured: true});

// ─── Network requests (Network tab) ───────────────────────────────────────────

const relayHttp = () => $<HTMLInputElement>('relay').value.replace(/^ws/, 'http');
$('net-ok').onclick = () => void fetch(`${relayHttp()}/health`).then((r) => r.json());
$('net-404').onclick = () => void fetch(`${relayHttp()}/does-not-exist`).catch(() => {});
$('net-post').onclick = () =>
    void fetch('https://httpbin.org/post', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({counter}),
    }).catch(() => {});
$('net-fail').onclick = () => void fetch('http://127.0.0.1:1/unreachable').catch(() => {});
$('net-xhr').onclick = () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${relayHttp()}/discovery`);
    xhr.send();
};

// ─── Storage and state controls ───────────────────────────────────────────────

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
