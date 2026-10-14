import {type LogEntry, useDevtoolsStore} from '../store/useDevtoolsStore.ts';
import {type NetworkRow, useNetworkStore} from '../store/useNetworkStore.ts';

/**
 * İstekleri ve logları IndexedDB'de tutar; sayfa yenilenince geri yüklenir.
 * Tarayıcı başına tek veri seti (localStorage'daki oturum gibi); incognito'da kapanınca silinir.
 *
 * Yazımlar artımlıdır: store'daki satırlar immutable olduğu için değişenler referansla bulunur,
 * sadece onlar yazılır/silinir (2000 satırı her olayda baştan yazmamak için).
 */

const DB_NAME = 'remote-devtools';
const DB_VERSION = 1;
const STORE_REQUESTS = 'requests';
const STORE_LOGS = 'logs';
const FLUSH_DELAY_MS = 400;

let db: IDBDatabase | null = null;
/**
 * Aynı tarayıcıda birden fazla sekme açıkken yalnızca biri yazar (Web Locks). Log id'leri sekmeye özel
 * olduğundan hepsi yazsaydı loglar çoğalır/ezilirdi. Yazan sekme kapanınca kilit diğerine geçer.
 */
let isWriter = false;
const WRITER_LOCK = 'remote-devtools-persistence-writer';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const database = req.result;
            if (!database.objectStoreNames.contains(STORE_REQUESTS)) database.createObjectStore(STORE_REQUESTS, {keyPath: 'uuid'});
            if (!database.objectStoreNames.contains(STORE_LOGS)) database.createObjectStore(STORE_LOGS, {keyPath: 'id'});
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function readAll<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
        const req = db!.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
    });
}

type Pending = {put: Map<IDBValidKey, unknown>; del: Set<IDBValidKey>; clear: boolean};
const pending: Record<string, Pending> = {
    [STORE_REQUESTS]: {put: new Map(), del: new Set(), clear: false},
    [STORE_LOGS]: {put: new Map(), del: new Set(), clear: false},
};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

function flush() {
    flushTimer = null;
    if (!db) return;
    for (const [name, p] of Object.entries(pending)) {
        if (!p.clear && p.put.size === 0 && p.del.size === 0) continue;
        const store = db.transaction(name, 'readwrite').objectStore(name);
        if (p.clear) store.clear();
        for (const key of p.del) store.delete(key);
        for (const value of p.put.values()) store.put(value);
        pending[name] = {put: new Map(), del: new Set(), clear: false};
    }
}

function diff<T extends object>(storeName: string, prev: T[], next: T[], key: (item: T) => IDBValidKey) {
    if (!isWriter || prev === next) return;
    const p = pending[storeName]!;
    if (next.length === 0 && prev.length > 0) {
        p.clear = true;
        p.put.clear();
        p.del.clear();
        scheduleFlush();
        return;
    }
    const prevSet = new Set(prev);
    const nextKeys = new Set<IDBValidKey>();
    for (const item of next) {
        const k = key(item);
        nextKeys.add(k);
        if (!prevSet.has(item)) {
            p.put.set(k, item);
            p.del.delete(k);
        }
    }
    for (const item of prev) {
        const k = key(item);
        if (!nextKeys.has(k)) {
            p.del.add(k);
            p.put.delete(k);
        }
    }
    scheduleFlush();
}

/** Yazıcı olunca bellekteki durumu baştan yazar (önceki yazıcının id'leriyle karışmasın diye). */
function becomeWriter() {
    isWriter = true;
    pending[STORE_REQUESTS] = {put: new Map(useNetworkStore.getState().rows.map((r) => [r.uuid, r])), del: new Set(), clear: true};
    pending[STORE_LOGS] = {put: new Map(useDevtoolsStore.getState().logs.map((l) => [l.id, l])), del: new Set(), clear: true};
    flush();
}

function acquireWriterRole() {
    if (!('locks' in navigator)) {
        becomeWriter();
        return;
    }
    // Kilit sekme kapanana kadar bırakılmaz (dönen promise hiç çözülmez).
    void navigator.locks.request(WRITER_LOCK, () => {
        becomeWriter();
        return new Promise<void>(() => {});
    });
}

/** Kayıtlı veriyi store'lara yükler ve değişiklikleri izlemeye başlar. IndexedDB yoksa sessizce devre dışı. */
export async function startPersistence(): Promise<void> {
    try {
        db = await openDb();
        const [rows, logs] = await Promise.all([readAll<NetworkRow>(STORE_REQUESTS), readAll<LogEntry>(STORE_LOGS)]);

        if (rows.length > 0) {
            rows.sort((a, b) => (a.request?.startedAt || a.receivedAt) - (b.request?.startedAt || b.receivedAt));
            useNetworkStore.setState({rows});
        }
        if (logs.length > 0) {
            logs.sort((a, b) => a.id - b.id);
            useDevtoolsStore.getState().hydrateLogs(logs);
        }
        if (rows.length > 0 || logs.length > 0) {
            useDevtoolsStore.getState().addLog({
                level: 'debug',
                source: 'web',
                message: `Önceki kayıtlar geri yüklendi: ${rows.length} istek, ${logs.length} log`,
            });
        }

        useNetworkStore.subscribe((s, prev) => diff(STORE_REQUESTS, prev.rows, s.rows, (r) => r.uuid));
        useDevtoolsStore.subscribe((s, prev) => diff(STORE_LOGS, prev.logs, s.logs, (l) => l.id));
        window.addEventListener('pagehide', flush);
        acquireWriterRole();
    } catch (e) {
        db = null;
        console.warn('[RemoteDevtools] IndexedDB kullanılamıyor, kayıtlar kalıcı değil', e);
    }
}
