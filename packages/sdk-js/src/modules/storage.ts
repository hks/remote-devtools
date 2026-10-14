import type {StorageAdapterInfo, StorageEntry} from '@himmetkaan/remote-devtools-protocol';
import {defineModule, type ModuleContext, ModuleError, type RemoteModule} from '../module.ts';

type Awaitable<T> = T | Promise<T>;

/**
 * Storage tab'ında görünen bir anahtar-değer deposu. Değerler metindir. `set` / `remove` yoksa depo salt okunurdur.
 * Hazır adapter'lar: `asyncStorageAdapter`, `mmkvAdapter`, `webStorageAdapter`, `secureStoreAdapter`.
 */
export type StorageAdapter = {
    id: string;
    title: string;
    keys(): Awaitable<readonly string[]>;
    get(key: string): Awaitable<string | null | undefined>;
    /** Birden çok anahtarı tek seferde okur (ör. AsyncStorage `multiGet`). Yoksa `get` tek tek çağrılır. */
    getMany?(keys: readonly string[]): Awaitable<(string | null | undefined)[]>;
    set?(key: string, value: string): Awaitable<void>;
    remove?(key: string): Awaitable<void>;
    /** Yoksa listelenen anahtarlar tek tek silinir. */
    clear?(): Awaitable<void>;
    /** Depo dışarıdan değiştiğinde haber verir (`null` = birden çok anahtar). UI açık listeyi yeniler. */
    subscribe?(listener: (key: string | null) => void): () => void;
    /** Değerler hassas: listede önizleme gönderilmez, UI değeri gizli gösterir. */
    masked?: boolean;
};

export type StorageAdapterOptions = {id?: string; title?: string};

export type StorageModuleOptions = {adapters?: StorageAdapter[]};

export type StorageModule = RemoteModule & {
    /** Adapter ekler (aynı id varsa değiştirir). Dönen fonksiyon kaldırır. */
    register(adapter: StorageAdapter): () => void;
    unregister(id: string): void;
};

const PREVIEW_LENGTH = 120;

const isEditable = (a: StorageAdapter) => typeof a.set === 'function' && typeof a.remove === 'function';

/**
 * Uygulamanın depolarını (AsyncStorage, MMKV, localStorage…) UI'da listeler, düzenler ve siler.
 *
 *     const storage = storageModule({adapters: [asyncStorageAdapter(AsyncStorage), mmkvAdapter(mmkv)]});
 */
export function storageModule(options: StorageModuleOptions = {}): StorageModule {
    const adapters = new Map<string, StorageAdapter>();
    const unsubscribes = new Map<string, () => void>();
    let ctx: ModuleContext | null = null;

    const watch = (adapter: StorageAdapter) => {
        if (!ctx || !adapter.subscribe) return;
        const context = ctx;
        unsubscribes.set(adapter.id, adapter.subscribe((key) => context.emit('module.storage.changed', {adapterId: adapter.id, key}, {buffer: false})));
    };
    const unwatch = (id: string) => {
        unsubscribes.get(id)?.();
        unsubscribes.delete(id);
    };

    const find = (id: string, write = false) => {
        const adapter = adapters.get(id);
        if (!adapter) throw new ModuleError('UNKNOWN_ADAPTER', `No storage adapter with id "${id}"`);
        if (write && !isEditable(adapter)) throw new ModuleError('READ_ONLY', `"${adapter.title}" is read-only`);
        return adapter;
    };

    /** Kendi değişikliklerimizi, kendisi haber vermeyen depolar için diğer UI'lara bildir. */
    const changed = (adapter: StorageAdapter, key: string | null) => {
        if (!adapter.subscribe) ctx?.emit('module.storage.changed', {adapterId: adapter.id, key}, {buffer: false});
    };

    const unregister = (id: string) => {
        if (!adapters.delete(id)) return;
        unwatch(id);
        ctx?.updateCapabilities();
    };

    for (const adapter of options.adapters ?? []) adapters.set(adapter.id, adapter);

    return defineModule({
        name: 'storage',

        capabilities: () => ({
            adapters: [...adapters.values()].map((a): StorageAdapterInfo => {
                const info: StorageAdapterInfo = {id: a.id, title: a.title, editable: isEditable(a)};
                if (a.masked) info.masked = true;
                return info;
            }),
        }),

        setup(context: ModuleContext) {
            ctx = context;
            for (const adapter of adapters.values()) watch(adapter);

            context.handle<{adapterId: string}>('module.storage.list', async ({adapterId}) => {
                const adapter = find(adapterId);
                const keys = [...(await adapter.keys())].sort((a, b) => a.localeCompare(b));
                const values = adapter.getMany ? await adapter.getMany(keys) : await Promise.all(keys.map((key) => adapter.get(key)));
                const entries: StorageEntry[] = [];
                keys.forEach((key, i) => {
                    const value = values[i];
                    if (value === null || value === undefined) return;
                    const text = String(value);
                    entries.push({key, size: text.length, preview: adapter.masked ? '' : text.slice(0, PREVIEW_LENGTH)});
                });
                return {entries};
            });

            context.handle<{adapterId: string; key: string}>('module.storage.get', async ({adapterId, key}) => {
                const value = await find(adapterId).get(key);
                return {value: value === null || value === undefined ? null : String(value)};
            });

            context.handle<{adapterId: string; key: string; value: unknown}>('module.storage.set', async ({adapterId, key, value}) => {
                const adapter = find(adapterId, true);
                if (typeof key !== 'string' || key === '') throw new ModuleError('INVALID_KEY', 'The key must be a non-empty string');
                if (typeof value !== 'string') throw new ModuleError('INVALID_VALUE', 'The value must be a string');
                await adapter.set!(key, value);
                changed(adapter, key);
                return null;
            });

            context.handle<{adapterId: string; key: string}>('module.storage.remove', async ({adapterId, key}) => {
                const adapter = find(adapterId, true);
                await adapter.remove!(key);
                changed(adapter, key);
                return null;
            });

            context.handle<{adapterId: string}>('module.storage.clear', async ({adapterId}) => {
                const adapter = find(adapterId, true);
                if (adapter.clear) await adapter.clear();
                else for (const key of await adapter.keys()) await adapter.remove!(key);
                changed(adapter, null);
                return null;
            });

            return () => {
                for (const id of [...unsubscribes.keys()]) unwatch(id);
                ctx = null;
            };
        },

        register(adapter) {
            if (!adapter.id || !adapter.title) throw new Error('A storage adapter needs an id and a title');
            unwatch(adapter.id);
            adapters.set(adapter.id, adapter);
            watch(adapter);
            ctx?.updateCapabilities();
            return () => {
                if (adapters.get(adapter.id) === adapter) unregister(adapter.id);
            };
        },

        unregister,
    });
}

// ─── Hazır adapter'lar (SDK bu paketleri import etmez; örnekleri verilir) ─────

/** `@react-native-async-storage/async-storage` default export'unun kullanılan kısmı. */
type AsyncStorageLike = {
    getAllKeys(): Promise<readonly string[]>;
    getItem(key: string): Promise<string | null>;
    multiGet?(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    multiRemove?(keys: readonly string[]): Promise<void>;
};

/** React Native AsyncStorage. `clear` sadece listelenen anahtarları siler (`AsyncStorage.clear()` çağrılmaz). */
export function asyncStorageAdapter(storage: AsyncStorageLike, options: StorageAdapterOptions = {}): StorageAdapter {
    return {
        id: options.id ?? 'async-storage',
        title: options.title ?? 'AsyncStorage',
        keys: () => storage.getAllKeys(),
        get: (key) => storage.getItem(key),
        getMany: storage.multiGet ? async (keys) => (await storage.multiGet!(keys)).map(([, value]) => value) : undefined,
        set: (key, value) => storage.setItem(key, value),
        remove: (key) => storage.removeItem(key),
        clear: storage.multiRemove ? async () => storage.multiRemove!(await storage.getAllKeys()) : undefined,
    };
}

/** `react-native-mmkv` instance'ının kullanılan kısmı (v3: `delete`, v4: `remove`). */
type MmkvLike = {
    getAllKeys(): string[];
    getString(key: string): string | undefined;
    getNumber?(key: string): number | undefined;
    getBoolean?(key: string): boolean | undefined;
    contains?(key: string): boolean;
    set(key: string, value: string): void;
    remove?(key: string): unknown;
    delete?(key: string): void;
    clearAll(): void;
    addOnValueChangedListener?(listener: (key: string) => void): {remove(): void};
};

/**
 * react-native-mmkv (v3 ve v4). Değerler metin olarak okunur; metin olmayan değerler sayıya, sonra boolean'a çevrilmeye
 * çalışılır. Düzenleme her zaman metin yazar.
 */
export function mmkvAdapter(mmkv: MmkvLike, options: StorageAdapterOptions = {}): StorageAdapter {
    return {
        id: options.id ?? 'mmkv',
        title: options.title ?? 'MMKV',
        keys: () => mmkv.getAllKeys(),
        get: (key) => {
            const text = mmkv.getString(key);
            if (text !== undefined) return text;
            if (mmkv.contains && !mmkv.contains(key)) return null;
            const bool = mmkv.getBoolean?.(key);
            if (bool !== undefined) return String(bool);
            const num = mmkv.getNumber?.(key);
            return num !== undefined ? String(num) : null;
        },
        set: (key, value) => mmkv.set(key, value),
        remove: (key) => {
            if (mmkv.remove) mmkv.remove(key);
            else mmkv.delete?.(key);
        },
        clear: () => mmkv.clearAll(),
        subscribe: mmkv.addOnValueChangedListener
            ? (listener) => {
                  const subscription = mmkv.addOnValueChangedListener!((key) => listener(key));
                  return () => subscription.remove();
              }
            : undefined,
    };
}

/**
 * Tarayıcıda `localStorage` (varsayılan) veya `sessionStorage`. Başka sekmelerden gelen değişiklikler (`storage` olayı)
 * UI'a bildirilir; aynı sayfadaki yazmalar için Storage tab'ındaki Refresh kullanılır.
 */
export function webStorageAdapter(storage?: Storage, options: StorageAdapterOptions = {}): StorageAdapter {
    const target = storage ?? (globalThis as {localStorage?: Storage}).localStorage;
    if (!target) throw new Error('webStorageAdapter: no Web Storage available');
    const events = (globalThis as {addEventListener?: Window['addEventListener']; removeEventListener?: Window['removeEventListener']});
    return {
        id: options.id ?? 'local-storage',
        title: options.title ?? 'localStorage',
        keys: () => Array.from({length: target.length}, (_, i) => target.key(i)).filter((k): k is string => k !== null),
        get: (key) => target.getItem(key),
        set: (key, value) => target.setItem(key, value),
        remove: (key) => target.removeItem(key),
        clear: () => target.clear(),
        subscribe: events.addEventListener
            ? (listener) => {
                  const onStorage = (e: StorageEvent) => {
                      if (e.storageArea === target) listener(e.key);
                  };
                  events.addEventListener!('storage', onStorage);
                  return () => events.removeEventListener?.('storage', onStorage);
              }
            : undefined,
    };
}

/** `expo-secure-store` modülünün kullanılan kısmı. */
type SecureStoreLike = {getItemAsync(key: string): Promise<string | null>};

/**
 * expo-secure-store, salt okunur ve maskeli. SecureStore anahtarları listeleyemediği için gösterilecek anahtarlar verilmelidir;
 * değeri olmayanlar listede görünmez.
 */
export function secureStoreAdapter(secureStore: SecureStoreLike, options: StorageAdapterOptions & {keys: readonly string[]}): StorageAdapter {
    return {
        id: options.id ?? 'secure-store',
        title: options.title ?? 'SecureStore',
        masked: true,
        keys: () => options.keys,
        get: (key) => secureStore.getItemAsync(key),
    };
}
