/**
 * A realistic device for documentation screenshots: "Bloom", a made-up flower shop app, with logs, API traffic, a cart
 * store, key-value storage, flags and an orders panel. Used by screenshots.ts; not part of any package.
 */
import {
    flagsModule,
    functionsModule,
    memoryStorage,
    networkModule,
    panelsModule,
    RemoteDevTools,
    type StateAdapter,
    type StorageAdapter,
    stateModule,
    staticLifecycle,
    storageModule,
} from '@himmetkaan/remote-devtools';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const API = 'https://api.bloom.example/v1';

/** Minimal Zustand-like store (subscribe / getState / setState). */
function createStore<S extends object>(initial: S) {
    let state = initial;
    const listeners = new Set<() => void>();
    return {
        getState: () => state,
        setState(partial: Partial<S>, action?: string) {
            state = {...state, ...partial};
            for (const listener of listeners) listener();
            return action;
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

function mapAdapter(
    id: string,
    title: string,
    entries: Record<string, string>,
    options: {editable?: boolean; masked?: boolean} = {},
): StorageAdapter {
    const data = new Map(Object.entries(entries));
    const adapter: StorageAdapter = {
        id,
        title,
        keys: () => [...data.keys()],
        get: (key) => data.get(key) ?? null,
        masked: options.masked,
    };
    if (options.editable !== false) {
        adapter.set = (key, value) => void data.set(key, value);
        adapter.remove = (key) => void data.delete(key);
    }
    return adapter;
}

type CartItem = {sku: string; name: string; qty: number; price: number};

export type DemoDevice = {
    devtools: RemoteDevTools;
    /** Runs the scripted session: logs, requests and state changes spread over a few seconds. */
    play(): Promise<void>;
    /** More cart changes, for the State tab's timeline (it only records changes while open). */
    playCart(): Promise<void>;
    destroy(): void;
};

export type DemoDeviceOptions = {
    name?: string;
    platform?: 'ios' | 'android';
    /** Finds the relay on this port and sends a connect request (instead of pairing with a code). */
    discoveryPort?: number;
};

export function createDemoDevice(options: DemoDeviceOptions = {}): DemoDevice {
    const functions = functionsModule();
    const network = networkModule({autoCapture: false});
    const flags = flagsModule();
    const panels = panelsModule();

    const cart = createStore({
        items: [] as CartItem[],
        coupon: null as string | null,
        totals: {subtotal: 0, discount: 0, shipping: 4.9, total: 4.9},
        status: 'browsing' as 'browsing' | 'checkout' | 'paid',
    });
    const session = createStore({
        user: {id: 48213, name: 'Ada Lovelace', email: 'ada@bloom.example', tier: 'gold'},
        locale: 'en-GB',
        currency: 'GBP',
        experiments: {homeLayout: 'grid', checkoutV2: true},
    });
    /** Name of the action being dispatched; listeners run synchronously inside setState, like Redux. */
    let currentAction: string | undefined;
    const store =
        (s: typeof cart | typeof session): StateAdapter['subscribe'] =>
        (listener) =>
            s.subscribe(() => listener(currentAction));

    const recompute = (items: CartItem[], coupon: string | null) => {
        const subtotal = Math.round(items.reduce((sum, i) => sum + i.qty * i.price, 0) * 100) / 100;
        const discount = coupon ? Math.round(subtotal * 0.15 * 100) / 100 : 0;
        const shipping = subtotal > 40 ? 0 : 4.9;
        return {subtotal, discount, shipping, total: Math.round((subtotal - discount + shipping) * 100) / 100};
    };
    const dispatch = (action: string, next: Partial<ReturnType<typeof cart.getState>>) => {
        currentAction = action;
        try {
            cart.setState(next);
        } finally {
            currentAction = undefined;
        }
    };

    const state = stateModule({
        stores: [
            {id: 'cart', title: 'Cart', getState: cart.getState, subscribe: store(cart)},
            {id: 'session', title: 'Session', getState: session.getState, subscribe: store(session)},
        ],
    });

    const storage = storageModule({
        adapters: [
            mapAdapter('async-storage', 'AsyncStorage', {
                'auth.session': JSON.stringify({userId: 48213, expiresAt: '2026-11-14T09:12:00Z', scopes: ['orders', 'profile']}),
                'onboarding.completed': 'true',
                'search.recent': JSON.stringify(['peonies', 'birthday bouquet', 'succulents', 'same-day delivery']),
                'cart.draft': JSON.stringify({items: 2, savedAt: '2026-10-15T08:41:00Z'}),
                'settings.notifications': JSON.stringify({orders: true, offers: false, reminders: true}),
                'remote-devtools:device-id': 'b1f0c2d9e8a74f6c',
            }),
            mapAdapter('mmkv', 'MMKV · cache', {
                'catalog.etag': 'W/"5f2-1a9c"',
                'catalog.updatedAt': '1792061520',
                'images.prefetched': '128',
            }),
            mapAdapter(
                'secure-store',
                'SecureStore',
                {'auth.refreshToken': 'rt_9f2c4b1e7a0d', 'auth.biometricKey': 'bk_33a1'},
                {editable: false, masked: true},
            ),
        ],
    });

    functions.register({
        id: 'auth.loginAsTestUser',
        title: 'Sign in as test user',
        group: 'Account',
        args: {account: {type: 'select', options: ['ada (gold)', 'grace (new)', 'alan (blocked)'], required: true}},
        handler: ({account}) => `Signed in as ${account}`,
    });
    functions.register({
        id: 'onboarding.reset',
        title: 'Reset onboarding',
        group: 'Account',
        confirm: 'Show the onboarding again on next launch?',
        handler: () => 'done',
    });
    functions.register({
        id: 'cart.seed',
        title: 'Add sample items',
        group: 'Cart',
        args: {count: {type: 'number', min: 1, max: 10, default: 3}},
        handler: ({count}) => `${count} items added`,
    });
    functions.register({
        id: 'cart.clear',
        title: 'Empty cart',
        group: 'Cart',
        danger: true,
        confirm: 'Remove every item from the cart?',
        handler: () => 'cart emptied',
    });
    functions.register({
        id: 'push.simulate',
        title: 'Simulate push notification',
        group: 'Notifications',
        description: 'Delivers a notification through the app’s own handler.',
        args: {
            kind: {
                type: 'select',
                options: ['order shipped', 'order delivered', 'back in stock', 'promo'],
                default: 'order shipped',
                required: true,
            },
            orderId: {type: 'text', placeholder: 'BL-10427'},
            silent: {type: 'boolean', label: 'Silent'},
        },
        handler: ({kind}) => `Delivered “${kind}”`,
    });
    functions.register({
        id: 'debug.crash',
        title: 'Trigger a crash',
        group: 'Debug',
        danger: true,
        confirm: 'Crash the app now?',
        handler: () => 'crashed',
    });

    flags.define({
        key: 'checkout.v2',
        title: 'New checkout',
        group: 'Checkout',
        description: 'One-page checkout with Apple Pay.',
        field: {type: 'boolean'},
        value: false,
    });
    flags.define({key: 'checkout.expressShipping', title: 'Express shipping', group: 'Checkout', field: {type: 'boolean'}, value: true});
    flags.define({
        key: 'home.layout',
        title: 'Home layout',
        group: 'Home',
        field: {type: 'select', options: ['feed', 'grid', 'stories'], default: 'feed'},
        value: 'grid',
    });
    flags.define({
        key: 'home.promoBanner',
        title: 'Promo banner',
        group: 'Home',
        field: {type: 'text', default: ''},
        value: 'Free delivery on orders over £40',
    });
    flags.define({
        key: 'api.timeoutSeconds',
        title: 'API timeout (s)',
        group: 'Network',
        field: {type: 'number', min: 1, max: 60, default: 15},
        value: 15,
    });

    const orders = [
        {id: 'BL-10431', customer: 'Grace H.', items: 3, total: '£58.40', status: 'pending'},
        {id: 'BL-10430', customer: 'Alan T.', items: 1, total: '£24.00', status: 'payment failed'},
        {id: 'BL-10429', customer: 'Ada L.', items: 2, total: '£41.80', status: 'shipped'},
        {id: 'BL-10428', customer: 'Katherine J.', items: 5, total: '£96.10', status: 'shipped'},
        {id: 'BL-10427', customer: 'Margaret H.', items: 2, total: '£33.50', status: 'delivered'},
    ];
    panels.define({
        id: 'orders',
        title: 'Orders',
        icon: '📦',
        blocks: [
            {
                id: 'note',
                type: 'text',
                tone: 'info',
                text: 'Live view of the order queue on this device. Retrying re-sends the payment intent.',
            },
            {
                id: 'stats',
                type: 'stats',
                items: [
                    {label: 'Pending', value: 1},
                    {label: 'Shipped today', value: 2, tone: 'success'},
                    {label: 'Failed', value: 1, tone: 'error'},
                    {label: 'Revenue today', value: '£253.80', hint: '5 orders'},
                ],
            },
            {
                id: 'orders',
                type: 'table',
                title: 'Recent orders',
                columns: [
                    {key: 'id', title: 'Order'},
                    {key: 'customer', title: 'Customer'},
                    {key: 'items', title: 'Items'},
                    {key: 'total', title: 'Total'},
                    {key: 'status', title: 'Status'},
                ],
                rows: orders,
                rowActions: [
                    {id: 'retry', label: 'Retry payment', handler: (row: {id: string}) => `${row.id} retried`},
                    {
                        id: 'cancel',
                        label: 'Cancel',
                        danger: true,
                        confirm: 'Cancel this order?',
                        handler: (row: {id: string}) => `${row.id} cancelled`,
                    },
                ],
            },
            {
                id: 'create',
                type: 'form',
                title: 'Create a test order',
                fields: {
                    product: {
                        type: 'select',
                        options: ['Peony bouquet', 'Rose box', 'Succulent trio'],
                        default: 'Peony bouquet',
                        required: true,
                    },
                    quantity: {type: 'number', min: 1, max: 10, default: 1},
                    express: {type: 'boolean', label: 'Express delivery'},
                },
                submit: {label: 'Create order', handler: () => 'BL-10432 created'},
            },
            {
                id: 'tools',
                type: 'actions',
                title: 'Queue',
                actions: [
                    {id: 'sync', label: 'Sync now', handler: () => 'synced'},
                    {id: 'purge', label: 'Purge delivered', danger: true, handler: () => 'purged'},
                ],
            },
        ],
    });

    const devtools = new RemoteDevTools({
        enabled: true,
        isDevelopment: options.discoveryPort !== undefined,
        app: {id: 'com.example.bloom', name: 'Bloom', version: '2.4.0', build: '312'},
        device:
            options.platform === 'android'
                ? {platform: 'android', os: '16', model: 'Pixel 9', name: options.name ?? 'Pixel 9'}
                : {platform: 'ios', os: '26.1', model: 'iPhone 17 Pro', name: options.name ?? 'iPhone 17 Pro'},
        meta: {userId: '48213', environment: 'staging', apiEndpoint: 'https://api.bloom.example'},
        storage: memoryStorage(),
        lifecycle: staticLifecycle(),
        discovery:
            options.discoveryPort === undefined
                ? {localhost: false}
                : {localhost: {port: options.discoveryPort, hosts: ['127.0.0.1']}, intervalMs: 500},
        modules: [functions, network, storage, state, flags, panels],
    });

    async function request(
        method: string,
        path: string,
        opts: {body?: unknown; status?: number; response?: unknown; ms?: number; error?: string} = {},
    ) {
        const call = network.record({
            method,
            url: `${API}${path}`,
            headers: {accept: 'application/json', authorization: 'Bearer eyJhbGciOi…', 'x-app-version': '2.4.0 (312)'},
            body: opts.body,
        });
        await sleep(opts.ms ?? 120);
        call.response({
            status: opts.status ?? 200,
            headers: {'content-type': 'application/json; charset=utf-8', 'x-request-id': Math.random().toString(16).slice(2, 10)},
            body: opts.response ?? {ok: true},
            error: opts.error ?? null,
        });
    }

    async function play() {
        const log = devtools.log;
        log.info('App launched', {build: '2.4.0 (312)', coldStart: true, launchMs: 812}, {tag: 'lifecycle'});
        log.debug('Restored session from storage', {userId: 48213}, {tag: 'auth'});
        await request('GET', '/me', {ms: 140, response: {id: 48213, name: 'Ada Lovelace', tier: 'gold', addresses: 2}});
        await request('GET', '/catalog?category=bouquets&page=1', {
            ms: 310,
            response: {
                page: 1,
                total: 48,
                items: [
                    {sku: 'PEO-012', name: 'Peony bouquet', price: 34.9, stock: 12, tags: ['seasonal', 'bestseller']},
                    {sku: 'ROS-004', name: 'Rose box', price: 42, stock: 3, tags: ['gift']},
                    {sku: 'SUC-031', name: 'Succulent trio', price: 19.5, stock: 40, tags: ['plants']},
                ],
            },
        });
        log.info('Home rendered', {layout: 'grid', products: 24}, {tag: 'home'});
        await request('GET', '/recommendations?for=48213', {ms: 95, response: {items: ['PEO-012', 'LIL-007', 'TUL-002']}});

        dispatch('cart/addItem', {
            items: [{sku: 'PEO-012', name: 'Peony bouquet', qty: 1, price: 34.9}],
            totals: recompute([{sku: 'PEO-012', name: 'Peony bouquet', qty: 1, price: 34.9}], null),
        });
        await request('POST', '/cart/items', {
            body: {sku: 'PEO-012', qty: 1},
            ms: 180,
            status: 201,
            response: {cartId: 'c_8812', items: 1},
        });
        log.info('Added to cart', {sku: 'PEO-012'}, {tag: 'cart'});
        await sleep(250);
        const items = [
            {sku: 'PEO-012', name: 'Peony bouquet', qty: 1, price: 34.9},
            {sku: 'SUC-031', name: 'Succulent trio', qty: 2, price: 19.5},
        ];
        dispatch('cart/addItem', {items, totals: recompute(items, null)});
        await request('POST', '/cart/items', {
            body: {sku: 'SUC-031', qty: 2},
            ms: 160,
            status: 201,
            response: {cartId: 'c_8812', items: 2},
        });
        await sleep(250);
        log.warn('Coupon service slow', {ms: 2380, endpoint: '/coupons/validate'}, {tag: 'api'});
        await request('POST', '/coupons/validate', {body: {code: 'SPRING15'}, ms: 520, response: {valid: true, percentOff: 15}});
        dispatch('cart/applyCoupon', {coupon: 'SPRING15', totals: recompute(items, 'SPRING15')});
        await sleep(250);
        await request('GET', '/delivery/slots?postcode=EC1A', {ms: 230, response: {slots: ['Today 16:00–18:00', 'Tomorrow 09:00–12:00']}});
        dispatch('checkout/start', {status: 'checkout'});
        await request('POST', '/payments/intent', {
            body: {amount: 6672, currency: 'GBP'},
            ms: 640,
            status: 502,
            response: {error: 'Bad gateway', retryable: true},
        });
        log.error('Payment intent failed', {status: 502, orderId: 'BL-10430', retry: 1}, {tag: 'checkout'});
        await request('POST', '/payments/intent', {
            body: {amount: 6672, currency: 'GBP'},
            ms: 410,
            response: {id: 'pi_3QK9', status: 'requires_confirmation'},
        });
        log.info('Payment intent created', {id: 'pi_3QK9'}, {tag: 'checkout'});
        await request('GET', '/images/peony-012@3x.webp', {ms: 60, response: '[binary 182 KB]'});
        log.debug('Prefetched 12 images', undefined, {tag: 'images'});
    }

    async function playCart() {
        const step = async (action: string, next: CartItem[], coupon: string | null) => {
            dispatch(action, {items: next, coupon, totals: recompute(next, coupon)});
            await sleep(450);
        };
        const base = cart.getState().items;
        await step(
            'cart/updateQuantity',
            base.map((i) => (i.sku === 'PEO-012' ? {...i, qty: 2} : i)),
            cart.getState().coupon,
        );
        await step(
            'cart/addItem',
            [...cart.getState().items, {sku: 'ROS-004', name: 'Rose box', qty: 1, price: 42}],
            cart.getState().coupon,
        );
        await step(
            'cart/removeItem',
            cart.getState().items.filter((i) => i.sku !== 'SUC-031'),
            cart.getState().coupon,
        );
        dispatch('checkout/confirmPayment', {status: 'paid'});
        await sleep(450);
    }

    return {devtools, play, playCart, destroy: () => devtools.destroy()};
}
