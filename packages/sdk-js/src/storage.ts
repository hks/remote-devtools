/**
 * Key-value store for the pairing and the device id.
 * AsyncStorage (React Native) and `localStorage` (browser) fit this interface directly.
 */
export type KeyValueStorage = {
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): void | Promise<void>;
    removeItem(key: string): void | Promise<void>;
};

/** In-memory only; the pairing is forgotten when the app closes. */
export function memoryStorage(): KeyValueStorage {
    const data = new Map<string, string>();
    return {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => void data.set(key, value),
        removeItem: (key) => void data.delete(key),
    };
}

/** `localStorage` in the browser, otherwise (e.g. Node, private-mode restrictions) in-memory. */
export function defaultStorage(): KeyValueStorage {
    try {
        const ls = (globalThis as {localStorage?: Storage}).localStorage;
        if (ls) {
            const probe = '__remote_devtools_probe__';
            ls.setItem(probe, '1');
            ls.removeItem(probe);
            return ls;
        }
    } catch {
        // access denied
    }
    return memoryStorage();
}
