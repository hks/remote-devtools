/**
 * Eşleşme bilgisi ve cihaz kimliği için anahtar-değer deposu.
 * AsyncStorage (React Native) ve `localStorage` (tarayıcı) bu arayüze doğrudan uyar.
 */
export type KeyValueStorage = {
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): void | Promise<void>;
    removeItem(key: string): void | Promise<void>;
};

/** Sadece bellekte tutar; uygulama kapanınca eşleşme unutulur. */
export function memoryStorage(): KeyValueStorage {
    const data = new Map<string, string>();
    return {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => void data.set(key, value),
        removeItem: (key) => void data.delete(key),
    };
}

/** Tarayıcıda `localStorage`, yoksa (ör. Node, gizli mod kısıtı) bellek. */
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
        // erişim engelli
    }
    return memoryStorage();
}
