import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {applyPatch, diffJson, getAtPointer} from '@himmetkaan/remote-devtools-protocol';
import {
    asyncStorageAdapter,
    flagsModule,
    type KeyValueStorage,
    memoryStorage,
    mmkvAdapter,
    reduxAdapter,
    secureStoreAdapter,
    stateModule,
    storageModule,
    webStorageAdapter,
    zustandAdapter,
} from '../src/index.ts';
import {createClient, openUi, relayUrl, sleep, type Ui, waitForStatus, withPairedClient, withRelay} from './helpers.ts';

/** Sends a request from the UI to the device and returns the reply payload. */
async function call(ui: Ui, deviceId: string, type: string, payload: unknown) {
    const resultType = `${type.split('.').slice(0, 2).join('.')}.result`;
    const id = ui.send(type, payload, {deviceId});
    const reply = await ui.next(resultType);
    assert.equal(reply.replyTo, id);
    return reply.payload;
}

function fakeAsyncStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getAllKeys: async () => [...data.keys()],
        getItem: async (key: string) => data.get(key) ?? null,
        multiGet: async (keys: readonly string[]) => keys.map((key) => [key, data.get(key) ?? null] as const),
        setItem: async (key: string, value: string) => void data.set(key, value),
        removeItem: async (key: string) => void data.delete(key),
        multiRemove: async (keys: readonly string[]) => keys.forEach((key) => data.delete(key)),
    };
}

function fakeMmkv(initial: Record<string, string | number | boolean> = {}) {
    const data = new Map<string, string | number | boolean>(Object.entries(initial));
    const listeners = new Set<(key: string) => void>();
    const notify = (key: string) => listeners.forEach((l) => l(key));
    return {
        data,
        getAllKeys: () => [...data.keys()],
        getString: (key: string) => (typeof data.get(key) === 'string' ? (data.get(key) as string) : undefined),
        getNumber: (key: string) => (typeof data.get(key) === 'number' ? (data.get(key) as number) : 0),
        getBoolean: (key: string) => (typeof data.get(key) === 'boolean' ? (data.get(key) as boolean) : undefined),
        contains: (key: string) => data.has(key),
        set: (key: string, value: string) => (data.set(key, value), notify(key)),
        remove: (key: string) => (data.delete(key), notify(key)),
        clearAll: () => [...data.keys()].forEach((key) => (data.delete(key), notify(key))),
        addOnValueChangedListener(listener: (key: string) => void) {
            listeners.add(listener);
            return {remove: () => listeners.delete(listener)};
        },
    };
}

/** A simple Redux store (without depending on the redux package). */
function createReduxStore<S>(reducer: (state: S | undefined, action: {type: string; [k: string]: unknown}) => S) {
    let state = reducer(undefined, {type: '@@INIT'});
    const listeners = new Set<() => void>();
    return {
        getState: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        dispatch(action: {type: string; [k: string]: unknown}) {
            state = reducer(state, action);
            listeners.forEach((l) => l());
            return action;
        },
    };
}

/** A small store that behaves like Zustand's vanilla store. */
function createZustandStore<S extends object>(initial: S) {
    let state = initial;
    const listeners = new Set<(state: S, prev: S) => void>();
    return {
        getState: () => state,
        setState(partial: Partial<S>) {
            const prev = state;
            state = {...state, ...partial};
            listeners.forEach((l) => l(state, prev));
        },
        subscribe(listener: (state: S, prev: S) => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

describe('JSON patch', () => {
    it('diffs nested objects and arrays and applies the patch back', () => {
        const prev = {a: 1, b: {c: [1, 2, 3], d: 'x'}, e: true, 'we/ird~': 1};
        const next = {a: 2, b: {c: [1, 5], d: 'x', f: {g: null}}, 'we/ird~': 2};
        const patch = diffJson(prev, next)!;
        assert.deepEqual(applyPatch(prev, patch), next);
        assert.ok(patch.some((op) => op.path === '/we~1ird~0'));
        assert.deepEqual(getAtPointer(next, '/b/f'), {g: null});
    });

    it('skips identical references, omits skipped values and gives up past maxOps', () => {
        const shared = {big: Array.from({length: 1000}, (_, i) => i)};
        assert.deepEqual(diffJson({shared, n: 1}, {shared, n: 2}), [{op: 'replace', path: '/n', value: 2}]);
        const fn = () => {};
        assert.deepEqual(diffJson({fn, a: 1}, {fn, a: 1, other: fn}, {skip: (v) => typeof v === 'function'}), []);
        assert.equal(diffJson({list: [] as number[]}, {list: [1, 2, 3]}, {maxOps: 2}), null);
    });

    it('does not mutate the original document', () => {
        const doc = {list: [1, 2], nested: {x: 1}};
        const copy = structuredClone(doc);
        const out = applyPatch(doc, [{op: 'add', path: '/list/1', value: 9}, {op: 'remove', path: '/nested/x'}]);
        assert.deepEqual(doc, copy);
        assert.deepEqual(out, {list: [1, 9, 2], nested: {}});
    });
});

describe('storageModule', () => {
    it('lists, reads, edits and removes AsyncStorage entries', async () => {
        const async = fakeAsyncStorage({b: 'two', a: 'x'.repeat(500)});
        const storage = storageModule({adapters: [asyncStorageAdapter(async)]});
        await withPairedClient([storage], async (ui, deviceId) => {
            const {result} = await call(ui, deviceId, 'module.storage.list', {adapterId: 'async-storage'});
            assert.deepEqual(result.entries.map((e: any) => e.key), ['a', 'b']);
            assert.equal(result.entries[0].size, 500);
            assert.equal(result.entries[0].preview.length, 120);

            assert.deepEqual(await call(ui, deviceId, 'module.storage.get', {adapterId: 'async-storage', key: 'b'}), {ok: true, result: {value: 'two'}});
            assert.deepEqual(await call(ui, deviceId, 'module.storage.get', {adapterId: 'async-storage', key: 'zzz'}), {ok: true, result: {value: null}});

            assert.equal((await call(ui, deviceId, 'module.storage.set', {adapterId: 'async-storage', key: 'c', value: '{"n":1}'})).ok, true);
            assert.equal(async.data.get('c'), '{"n":1}');
            // AsyncStorage doesn't report changes, so the module reports its own writes (for other UI windows).
            assert.deepEqual((await ui.next('module.storage.changed')).payload, {adapterId: 'async-storage', key: 'c'});

            await call(ui, deviceId, 'module.storage.remove', {adapterId: 'async-storage', key: 'a'});
            assert.equal(async.data.has('a'), false);
            await call(ui, deviceId, 'module.storage.clear', {adapterId: 'async-storage'});
            assert.equal(async.data.size, 0);

            const invalid = await call(ui, deviceId, 'module.storage.set', {adapterId: 'async-storage', key: 'k', value: 5});
            assert.equal(invalid.error.code, 'INVALID_VALUE');
            assert.equal((await call(ui, deviceId, 'module.storage.list', {adapterId: 'nope'})).error.code, 'UNKNOWN_ADAPTER');
        });
    });

    it('forwards MMKV change events and reads non-string values', async () => {
        const mmkv = fakeMmkv({token: 'abc', count: 3, enabled: false});
        const storage = storageModule({adapters: [mmkvAdapter(mmkv)]});
        await withPairedClient([storage], async (ui, deviceId) => {
            const {result} = await call(ui, deviceId, 'module.storage.list', {adapterId: 'mmkv'});
            assert.deepEqual(result.entries.map((e: any) => [e.key, e.preview]), [['count', '3'], ['enabled', 'false'], ['token', 'abc']]);
            mmkv.set('token', 'changed in app');
            assert.deepEqual((await ui.next('module.storage.changed')).payload, {adapterId: 'mmkv', key: 'token'});
            await call(ui, deviceId, 'module.storage.remove', {adapterId: 'mmkv', key: 'count'});
            // A single notification: the adapter's own event (the module doesn't report it again).
            assert.deepEqual((await ui.next('module.storage.changed')).payload, {adapterId: 'mmkv', key: 'count'});
            await ui.none('module.storage.changed');
        });
    });

    it('keeps SecureStore read-only and masked', async () => {
        const secure = {getItemAsync: async (key: string) => (key === 'auth.token' ? 'secret' : null)};
        const storage = storageModule({adapters: [secureStoreAdapter(secure, {keys: ['auth.token', 'missing']})]});
        assert.deepEqual((storage.capabilities!() as any).adapters, [{id: 'secure-store', title: 'SecureStore', editable: false, masked: true}]);
        await withPairedClient([storage], async (ui, deviceId) => {
            const {result} = await call(ui, deviceId, 'module.storage.list', {adapterId: 'secure-store'});
            assert.deepEqual(result.entries, [{key: 'auth.token', size: 6, preview: ''}]);
            assert.deepEqual((await call(ui, deviceId, 'module.storage.get', {adapterId: 'secure-store', key: 'auth.token'})).result, {value: 'secret'});
            assert.equal((await call(ui, deviceId, 'module.storage.remove', {adapterId: 'secure-store', key: 'auth.token'})).error.code, 'READ_ONLY');
        });
    });

    it('works with Web Storage and registers adapters at runtime', async () => {
        const data = new Map<string, string>([['theme', 'dark']]);
        const fakeStorage = {
            get length() {
                return data.size;
            },
            key: (i: number) => [...data.keys()][i] ?? null,
            getItem: (k: string) => data.get(k) ?? null,
            setItem: (k: string, v: string) => void data.set(k, v),
            removeItem: (k: string) => void data.delete(k),
            clear: () => data.clear(),
        } as unknown as Storage;
        const storage = storageModule();
        await withPairedClient([storage], async (ui, deviceId) => {
            const unregister = storage.register(webStorageAdapter(fakeStorage, {id: 'session', title: 'sessionStorage'}));
            assert.deepEqual((await ui.next('capabilities.update')).payload.storage.adapters, [{id: 'session', title: 'sessionStorage', editable: true}]);
            assert.deepEqual((await call(ui, deviceId, 'module.storage.list', {adapterId: 'session'})).result.entries, [{key: 'theme', size: 4, preview: 'dark'}]);
            unregister();
            assert.deepEqual((await ui.next('capabilities.update')).payload.storage.adapters, []);
        });
    });
});

describe('stateModule', () => {
    it('streams Redux changes as throttled patches with action names', async () => {
        const store = createReduxStore<{count: number; items: string[]}>((state = {count: 0, items: []}, action) => {
            if (action.type === 'inc') return {...state, count: state.count + 1};
            if (action.type === 'add') return {...state, items: [...state.items, String(action.item)]};
            return state;
        });
        const state = stateModule({stores: [reduxAdapter(store, {id: 'app', title: 'App'})], throttleMs: 20});
        await withPairedClient([state], async (ui, deviceId) => {
            assert.deepEqual((await call(ui, deviceId, 'module.state.snapshot', {storeId: 'app'})).result, {state: {count: 0, items: []}});
            // No changes are sent without a subscription.
            store.dispatch({type: 'inc'});
            await ui.none('module.state.change', 60);

            const sub = await call(ui, deviceId, 'module.state.subscribe', {storeId: 'app'});
            assert.deepEqual(sub.result, {state: {count: 1, items: []}});

            store.dispatch({type: 'inc'});
            store.dispatch({type: 'add', item: 'apple'});
            const change = (await ui.next('module.state.change')).payload;
            assert.deepEqual(change.actions, ['inc', 'add']);
            assert.deepEqual(applyPatch(sub.result.state, change.patch), {count: 2, items: ['apple']});

            assert.deepEqual((await call(ui, deviceId, 'module.state.subscribe', {storeId: 'app', renew: true})).result, {});
            await call(ui, deviceId, 'module.state.unsubscribe', {storeId: 'app'});
            store.dispatch({type: 'inc'});
            await ui.none('module.state.change', 60);
            assert.equal(typeof store.dispatch, 'function');
        });
    });

    it('omits Zustand actions and falls back to the full state for large changes', async () => {
        const store = createZustandStore({user: {name: 'Ada'}, list: [] as number[], setName: (_name: string) => {}});
        const state = stateModule({stores: [zustandAdapter(store)], throttleMs: 10, maxPatchOps: 5});
        await withPairedClient([state], async (ui, deviceId) => {
            const sub = await call(ui, deviceId, 'module.state.subscribe', {storeId: 'zustand'});
            assert.deepEqual(sub.result.state, {user: {name: 'Ada'}, list: []});

            store.setState({user: {name: 'Grace'}});
            const small = (await ui.next('module.state.change')).payload;
            assert.deepEqual(small.patch, [{op: 'replace', path: '/user/name', value: 'Grace'}]);
            assert.deepEqual(small.actions, []);

            store.setState({list: Array.from({length: 20}, (_, i) => i)});
            const big = (await ui.next('module.state.change')).payload;
            assert.equal(big.patch, undefined);
            assert.equal(big.state.list.length, 20);
        });
    });

    it('gives a reconnecting UI the current state on a fresh subscribe', async () => {
        const store = createZustandStore({n: 0});
        const state = stateModule({stores: [zustandAdapter(store)], throttleMs: 10});
        await withPairedClient([state], async (ui, deviceId) => {
            await call(ui, deviceId, 'module.state.subscribe', {storeId: 'zustand'});
            store.setState({n: 1});
            await ui.next('module.state.change');
            assert.equal((await call(ui, deviceId, 'module.state.subscribe', {storeId: 'zustand'})).result.state.n, 1);
        });
    });
});

describe('flagsModule', () => {
    it('reports flags, applies validated overrides from the UI and resets them', async () => {
        const flags = flagsModule();
        const checkout = flags.define({key: 'checkout.v2', title: 'New checkout', field: {type: 'boolean'}});
        const timeout = flags.define({key: 'api.timeout', field: {type: 'number', min: 1, max: 60, default: 30}});
        const variant = flags.define({key: 'home.variant', field: {type: 'select', options: ['a', 'b'] as const, default: 'a'}, value: 'b'});
        assert.equal(checkout.get(), false);
        assert.equal(variant.get(), 'b');

        const seen: unknown[] = [];
        checkout.subscribe((value) => seen.push(value));

        const storage = memoryStorage();
        await withPairedClient([flags], async (ui, deviceId) => {
            const set = await call(ui, deviceId, 'module.flags.set', {key: 'checkout.v2', value: true});
            assert.deepEqual(set.result, {key: 'checkout.v2', title: 'New checkout', field: {type: 'boolean'}, value: true, baseValue: false, overridden: true});
            assert.equal(checkout.get(), true);
            assert.deepEqual(seen, [true]);
            const update = (await ui.next('capabilities.update')).payload.flags.flags;
            assert.equal(update.find((f: any) => f.key === 'checkout.v2').overridden, true);

            assert.equal((await call(ui, deviceId, 'module.flags.set', {key: 'api.timeout', value: 99})).error.code, 'INVALID_VALUE');
            assert.equal((await call(ui, deviceId, 'module.flags.set', {key: 'nope', value: 1})).error.code, 'UNKNOWN_FLAG');
            await call(ui, deviceId, 'module.flags.set', {key: 'api.timeout', value: 5});
            assert.equal(timeout.get(), 5);

            // The override stays in effect even if the app's value changes.
            flags.setValue('api.timeout', 10);
            assert.equal(timeout.get(), 5);

            await call(ui, deviceId, 'module.flags.reset', {key: 'checkout.v2'});
            assert.equal(checkout.get(), false);
            await call(ui, deviceId, 'module.flags.reset', {});
            assert.equal(timeout.get(), 10);
            assert.equal(flags.isOverridden('api.timeout'), false);
        }, {storage});
    });

    it('persists overrides across restarts and ignores them while disabled', async () => {
        const storage: KeyValueStorage = memoryStorage();
        await withRelay({}, async ({port}) => {
            const ui = await openUi(port);
            const first = flagsModule();
            const flag = first.define({key: 'beta', field: {type: 'boolean'}});
            const client = createClient({modules: [first], storage});
            await client.connection.pairWithCode(ui.session.pairing.code, relayUrl(port));
            await waitForStatus(client, 'connected');
            await ui.next('hello');
            await call(ui, client.connection.state.deviceId!, 'module.flags.set', {key: 'beta', value: true});
            assert.equal(flag.get(), true);
            client.destroy();
            // On destroy, it reverts to the app's value.
            assert.equal(flag.get(), false);
            ui.close();
        });

        // Restart: the override is read from storage (immediately, since memoryStorage is synchronous).
        const second = flagsModule();
        const again = second.define({key: 'beta', field: {type: 'boolean'}});
        const client = createClient({modules: [second], storage, discovery: {localhost: false}});
        await second.ready();
        assert.equal(again.get(), true);
        assert.equal(second.isOverridden('beta'), true);
        client.destroy();

        // Overrides are not applied while the SDK is disabled.
        const disabled = flagsModule();
        const off = disabled.define({key: 'beta', field: {type: 'boolean'}});
        const noop = createClient({modules: [disabled], storage, enabled: false});
        await disabled.ready();
        assert.equal(off.get(), false);
        noop.destroy();
    });

    it('waits for async storage and drops overrides that no longer match the field', async () => {
        const data = new Map<string, string>();
        const asyncStorage: KeyValueStorage = {
            getItem: async (key) => (await sleep(10), data.get(key) ?? null),
            setItem: async (key, value) => void data.set(key, value),
            removeItem: async (key) => void data.delete(key),
        };
        data.set('remote-devtools:module:flags:overrides', JSON.stringify({mode: 'removed-option', level: 3, later: 'x'}));
        const flags = flagsModule();
        const mode = flags.define({key: 'mode', field: {type: 'select', options: ['a', 'b'], default: 'a'}});
        const level = flags.define({key: 'level', field: {type: 'number', default: 1}});
        const client = createClient({modules: [flags], storage: asyncStorage});
        assert.equal(level.get(), 1);
        await flags.ready();
        assert.equal(level.get(), 3);
        assert.equal(mode.get(), 'a');
        // The override of a not-yet-defined flag is kept and applied once it is defined.
        assert.equal(flags.define({key: 'later', field: {type: 'text'}}).get(), 'x');
        client.destroy();
    });
});
