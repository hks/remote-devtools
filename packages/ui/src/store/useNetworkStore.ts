import {create} from 'zustand';
import type {NetworkEntry, NetworkRequest, NetworkResponse} from '@himmetkaan/remote-devtools-protocol/v1';

export type NetworkRow = {
    uuid: string;
    /** Sync'te veya cevap isteğinden önce gelirse `null` olabilir. */
    request: NetworkRequest | null;
    response: NetworkResponse | null;
    /** Response gövdesinin yaklaşık boyutu (JSON karakter sayısı). */
    responseSize: number | null;
    receivedAt: number;
    origin: 'live' | 'sync';
};

export type SyncState =
    | {status: 'idle'}
    | {status: 'syncing'; replyTo: string; received: number; added: number; total: number | null};

/** Bellekte tutulan en fazla istek (IndexedDB kalıcılığı Faz 6'da). */
const MAX_ROWS = 2000;

type LiveEvent = {kind: 'request'; payload: NetworkRequest} | {kind: 'response'; payload: NetworkResponse};

type NetworkState = {
    rows: NetworkRow[];
    selectedUuid: string | null;
    paused: boolean;
    /** Duraklatılmışken gelen canlı olaylar; devam edilince uygulanır. */
    pausedBuffer: LiveEvent[];
    sync: SyncState;

    addRequest(request: NetworkRequest): void;
    addResponse(response: NetworkResponse): void;
    /** Sync parçasını birleştirir; eklenen yeni kayıt sayısını döner. */
    mergeSync(entries: NetworkEntry[]): number;
    startSync(replyTo: string): void;
    updateSync(patch: {received: number; added: number; total: number}): void;
    finishSync(): void;
    setPaused(paused: boolean): void;
    select(uuid: string | null): void;
    clear(): void;
};

function measure(body: unknown): number | null {
    if (body === undefined || body === null) return 0;
    try {
        return typeof body === 'string' ? body.length : JSON.stringify(body).length;
    } catch {
        return null;
    }
}

function cap(rows: NetworkRow[]): NetworkRow[] {
    return rows.length > MAX_ROWS ? rows.slice(rows.length - MAX_ROWS) : rows;
}

function applyRequest(rows: NetworkRow[], request: NetworkRequest, origin: NetworkRow['origin']): NetworkRow[] {
    const idx = rows.findIndex((r) => r.uuid === request.uuid);
    if (idx >= 0) {
        const next = rows.slice();
        next[idx] = {...next[idx]!, request};
        return next;
    }
    return cap([...rows, {uuid: request.uuid, request, response: null, responseSize: null, receivedAt: Date.now(), origin}]);
}

function applyResponse(rows: NetworkRow[], response: NetworkResponse, origin: NetworkRow['origin']): NetworkRow[] {
    // Yeni kayıtlar sonda olduğundan sondan aramak daha hızlı.
    let idx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i]!.uuid === response.uuid) {
            idx = i;
            break;
        }
    }
    const responseSize = measure(response.body);
    if (idx >= 0) {
        const next = rows.slice();
        next[idx] = {...next[idx]!, response, responseSize};
        return next;
    }
    return cap([...rows, {uuid: response.uuid, request: null, response, responseSize, receivedAt: Date.now(), origin}]);
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
    rows: [],
    selectedUuid: null,
    paused: false,
    pausedBuffer: [],
    sync: {status: 'idle'},

    addRequest: (request) => {
        if (get().paused) {
            set((s) => ({pausedBuffer: [...s.pausedBuffer, {kind: 'request', payload: request}]}));
            return;
        }
        set((s) => ({rows: applyRequest(s.rows, request, 'live')}));
    },

    addResponse: (response) => {
        if (get().paused) {
            set((s) => ({pausedBuffer: [...s.pausedBuffer, {kind: 'response', payload: response}]}));
            return;
        }
        set((s) => ({rows: applyResponse(s.rows, response, 'live')}));
    },

    mergeSync: (entries) => {
        const existing = new Map(get().rows.map((r) => [r.uuid, r]));
        const added: NetworkRow[] = [];
        let changed = false;

        for (const entry of entries) {
            const current = existing.get(entry.request.uuid);
            if (!current) {
                added.push({
                    uuid: entry.request.uuid,
                    request: entry.request,
                    response: entry.response,
                    responseSize: entry.response ? measure(entry.response.body) : null,
                    receivedAt: Date.now(),
                    origin: 'sync',
                });
            } else if (!current.request || (!current.response && entry.response)) {
                // Eksik parçayı tamamla (ör. bağlantı koptuğu sırada gelen cevap).
                existing.set(current.uuid, {
                    ...current,
                    request: current.request ?? entry.request,
                    response: current.response ?? entry.response,
                    responseSize: current.response ? current.responseSize : entry.response ? measure(entry.response.body) : null,
                });
                changed = true;
            }
        }

        if (added.length === 0 && !changed) return 0;

        // Başlangıç zamanına göre sırala; zamanı bilinmeyen (0) kayıtlar başa, kendi sıralarıyla.
        const merged = [...added, ...existing.values()].sort(
            (a, b) => (a.request?.startedAt || 0) - (b.request?.startedAt || 0),
        );
        set({rows: cap(merged)});
        return added.length;
    },

    startSync: (replyTo) => set({sync: {status: 'syncing', replyTo, received: 0, added: 0, total: null}}),
    updateSync: ({received, added, total}) =>
        set((s) => (s.sync.status === 'syncing' ? {sync: {...s.sync, received, added, total}} : {})),
    finishSync: () => set({sync: {status: 'idle'}}),

    setPaused: (paused) => {
        if (paused) {
            set({paused: true});
            return;
        }
        const buffer = get().pausedBuffer;
        let rows = get().rows;
        for (const event of buffer) {
            rows = event.kind === 'request' ? applyRequest(rows, event.payload, 'live') : applyResponse(rows, event.payload, 'live');
        }
        set({paused: false, pausedBuffer: [], rows});
    },

    select: (selectedUuid) => set({selectedUuid}),
    clear: () => set({rows: [], selectedUuid: null, pausedBuffer: []}),
}));
