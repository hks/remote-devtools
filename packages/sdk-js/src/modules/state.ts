import {diffJson, STATE_SUBSCRIPTION_TTL_MS, type StateChange} from '@himmetkaan/remote-devtools-protocol';
import {defineModule, type ModuleContext, ModuleError, type RemoteModule} from '../module.ts';
import {toSerializable} from '../serialize.ts';

/**
 * State tab'ında görünen bir store. State'in değişmez (immutable) güncellendiği varsayılır (Redux, Zustand):
 * fark hesaplanırken aynı referanslı dallar atlanır.
 */
export type StateAdapter = {
    id: string;
    title: string;
    getState(): unknown;
    /** State değişince çağrılır; biliniyorsa action adı verilir. */
    subscribe(listener: (action?: string) => void): () => void;
};

export type StateAdapterOptions = {id?: string; title?: string};

export type StateModuleOptions = {
    stores?: StateAdapter[];
    /** Değişiklikler en fazla bu sıklıkta gönderilir (ms). Varsayılan 100. */
    throttleMs?: number;
    /** Fark bu kadar işlemi aşarsa tam state gönderilir. Varsayılan 500. */
    maxPatchOps?: number;
};

export type StateModule = RemoteModule & {
    /** Store ekler (aynı id varsa değiştirir). Dönen fonksiyon kaldırır. */
    register(adapter: StateAdapter): () => void;
    unregister(id: string): void;
};

const MAX_DEPTH = 32;
/** Bir aralıkta toplanan action adı sınırı (döngüde dispatch eden uygulamalar mesajı şişirmesin). */
const MAX_ACTIONS = 50;

const serialize = (value: unknown) => toSerializable(value, {maxDepth: MAX_DEPTH, omitFunctions: true});
const isFunction = (value: unknown) => typeof value === 'function';

type Subscription = {
    adapter: StateAdapter;
    unsubscribe: () => void;
    /** UI'a en son gönderilen ham state (fark buna göre hesaplanır). */
    sent: unknown;
    actions: string[];
    timer: ReturnType<typeof setTimeout> | null;
    expiresAt: number;
};

/**
 * Uygulama state'ini (Redux, Zustand…) UI'da canlı gösterir. UI sadece State tab'ı açıkken abone olur;
 * abonelik yoksa store dinlenmez.
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
                // Yeni (veya yeniden bağlanan) bir UI: bekleyen değişiklikleri diğer UI'lara gönder, sonra tam state ver.
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

// ─── Hazır adapter'lar ───────────────────────────────────────────────────────

type ReduxStoreLike = {
    getState(): unknown;
    subscribe(listener: () => void): () => void;
    dispatch: (action: any) => any;
};

/**
 * Redux store'u. Action adları için `store.dispatch` sarılır (abonelik süresince); middleware içinden yapılan
 * dispatch'ler (ör. thunk'ların içi) adsız görünür.
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

/** Zustand store'u (v4 ve v5; `create` ile oluşturulan hook da olur). Fonksiyonlar (action'lar) gösterilmez. */
export function zustandAdapter(store: ZustandStoreLike, options: StateAdapterOptions = {}): StateAdapter {
    return {
        id: options.id ?? 'zustand',
        title: options.title ?? 'Zustand',
        getState: () => store.getState(),
        subscribe: (listener) => store.subscribe(() => listener()),
    };
}
