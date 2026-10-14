import {diffJson, STATE_SUBSCRIPTION_TTL_MS, type StateChange} from '@himmetkaan/remote-devtools-protocol';
import {defineModule, type ModuleContext, ModuleError, type RemoteModule} from '../module.ts';
import {toSerializable} from '../serialize.ts';

/**
 * A store shown in the State tab. State is assumed to be updated immutably (Redux, Zustand):
 * branches with the same reference are skipped when computing the diff.
 */
export type StateAdapter = {
    id: string;
    title: string;
    getState(): unknown;
    /** Called when the state changes; the action name is passed if known. */
    subscribe(listener: (action?: string) => void): () => void;
};

export type StateAdapterOptions = {id?: string; title?: string};

export type StateModuleOptions = {
    stores?: StateAdapter[];
    /** Changes are sent at most this often (ms). Default 100. */
    throttleMs?: number;
    /** If the diff exceeds this many operations, the full state is sent. Default 500. */
    maxPatchOps?: number;
};

export type StateModule = RemoteModule & {
    /** Adds a store (replaces one with the same id). The returned function removes it. */
    register(adapter: StateAdapter): () => void;
    unregister(id: string): void;
};

const MAX_DEPTH = 32;
/** Limit on action names collected per interval (so apps dispatching in a loop don't bloat the message). */
const MAX_ACTIONS = 50;

const serialize = (value: unknown) => toSerializable(value, {maxDepth: MAX_DEPTH, omitFunctions: true});
const isFunction = (value: unknown) => typeof value === 'function';

type Subscription = {
    adapter: StateAdapter;
    unsubscribe: () => void;
    /** The raw state last sent to the UI (the diff is computed against it). */
    sent: unknown;
    actions: string[];
    timer: ReturnType<typeof setTimeout> | null;
    expiresAt: number;
};

/**
 * Shows app state (Redux, Zustand…) live in the UI. The UI only subscribes while the State tab is open;
 * without a subscription the store is not listened to.
 *
 *     const state = stateModule({stores: [zustandAdapter(useCartStore, {id: 'cart', title: 'Cart'})]});
 */
export function stateModule(options: StateModuleOptions = {}): StateModule {
    const throttleMs = options.throttleMs ?? 100;
    const maxOps = options.maxPatchOps ?? 500;
    const adapters = new Map<string, StateAdapter>();
    const subscriptions = new Map<string, Subscription>();
    let ctx: ModuleContext | null = null;

    for (const adapter of options.stores ?? []) adapters.set(adapter.id, adapter);

    const find = (id: string) => {
        const adapter = adapters.get(id);
        if (!adapter) throw new ModuleError('UNKNOWN_STORE', `No state store with id "${id}"`);
        return adapter;
    };

    const stop = (id: string) => {
        const sub = subscriptions.get(id);
        if (!sub) return;
        if (sub.timer) clearTimeout(sub.timer);
        sub.unsubscribe();
        subscriptions.delete(id);
    };

    const flush = (sub: Subscription) => {
        sub.timer = null;
        if (Date.now() > sub.expiresAt || !ctx) {
            stop(sub.adapter.id);
            return;
        }
        const current = sub.adapter.getState();
        const actions = sub.actions.splice(0);
        if (current === sub.sent) return;
        const change: StateChange = {storeId: sub.adapter.id, at: Date.now(), actions};
        const patch = diffJson(sub.sent, current, {serialize, skip: isFunction, maxDepth: MAX_DEPTH, maxOps});
        if (patch === null) change.state = serialize(current);
        else if (patch.length === 0) return;
        else change.patch = patch;
        sub.sent = current;
        ctx.emit('module.state.change', change, {buffer: false});
    };

    const schedule = (sub: Subscription, action?: string) => {
        if (action && sub.actions.length < MAX_ACTIONS) sub.actions.push(action);
        sub.timer ??= setTimeout(() => flush(sub), throttleMs);
    };

    const start = (adapter: StateAdapter): Subscription => {
        const sub: Subscription = {adapter, unsubscribe: () => {}, sent: adapter.getState(), actions: [], timer: null, expiresAt: 0};
        sub.unsubscribe = adapter.subscribe((action) => schedule(sub, action));
        subscriptions.set(adapter.id, sub);
        return sub;
    };

    const unregister = (id: string) => {
        if (!adapters.delete(id)) return;
        stop(id);
        ctx?.updateCapabilities();
    };

    return defineModule({
        name: 'state',

        capabilities: () => ({stores: [...adapters.values()].map(({id, title}) => ({id, title}))}),

        setup(context: ModuleContext) {
            ctx = context;

            context.handle<{storeId: string}>('module.state.snapshot', ({storeId}) => ({state: serialize(find(storeId).getState())}));

            context.handle<{storeId: string; renew?: boolean}>('module.state.subscribe', ({storeId, renew}) => {
                const adapter = find(storeId);
                let sub = subscriptions.get(storeId);
                const expiresAt = Date.now() + STATE_SUBSCRIPTION_TTL_MS;
                if (sub && renew) {
                    sub.expiresAt = expiresAt;
                    return {};
                }
                // A new (or reconnecting) UI: flush pending changes to the other UIs, then return the full state.
                if (sub) {
                    if (sub.timer) clearTimeout(sub.timer);
                    flush(sub);
                }
                sub = subscriptions.get(storeId) ?? start(adapter);
                sub.expiresAt = expiresAt;
                sub.sent = adapter.getState();
                return {state: serialize(sub.sent)};
            });

            context.handle<{storeId: string}>('module.state.unsubscribe', ({storeId}) => {
                stop(storeId);
                return null;
            });

            return () => {
                for (const id of [...subscriptions.keys()]) stop(id);
                ctx = null;
            };
        },

        register(adapter) {
            if (!adapter.id || !adapter.title) throw new Error('A state store needs an id and a title');
            stop(adapter.id);
            adapters.set(adapter.id, adapter);
            ctx?.updateCapabilities();
            return () => {
                if (adapters.get(adapter.id) === adapter) unregister(adapter.id);
            };
        },

        unregister,
    });
}

// ─── Built-in adapters ───────────────────────────────────────────────────────

type ReduxStoreLike = {
    getState(): unknown;
    subscribe(listener: () => void): () => void;
    dispatch: (action: any) => any;
};

/**
 * A Redux store. `store.dispatch` is wrapped for action names (while subscribed); dispatches made from inside
 * middleware (e.g. inside thunks) appear unnamed.
 */
export function reduxAdapter(store: ReduxStoreLike, options: StateAdapterOptions = {}): StateAdapter {
    return {
        id: options.id ?? 'redux',
        title: options.title ?? 'Redux',
        getState: () => store.getState(),
        subscribe(listener) {
            let action: string | undefined;
            const original = store.dispatch;
            const wrapped = (a: any) => {
                const previous = action;
                action = typeof a?.type === 'string' ? a.type : undefined;
                try {
                    return original(a);
                } finally {
                    action = previous;
                }
            };
            store.dispatch = wrapped;
            const unsubscribe = store.subscribe(() => listener(action));
            return () => {
                unsubscribe();
                if (store.dispatch === wrapped) store.dispatch = original;
            };
        },
    };
}

type ZustandStoreLike = {
    getState(): unknown;
    subscribe(listener: (state: any, previous: any) => void): () => void;
};

/** A Zustand store (v4 and v5; the hook returned by `create` works too). Functions (actions) are not shown. */
export function zustandAdapter(store: ZustandStoreLike, options: StateAdapterOptions = {}): StateAdapter {
    return {
        id: options.id ?? 'zustand',
        title: options.title ?? 'Zustand',
        getState: () => store.getState(),
        subscribe: (listener) => store.subscribe(() => listener()),
    };
}
