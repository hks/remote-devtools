import {create} from 'zustand';
import type {NetworkRequest, NetworkResponse} from '@himmetkaan/remote-devtools-protocol';

export type NetworkRow = {
    uuid: string;
    /** Cevap isteğinden önce gelirse `null` olabilir. */
    request: NetworkRequest | null;
    response: NetworkResponse | null;
    /** Response gövdesinin yaklaşık boyutu (JSON karakter sayısı). */
    responseSize: number | null;
    receivedAt: number;
    /** `history`: cihaz bağlanmadan önce tamponlanmıştı. */
    origin: 'live' | 'history';
};

type LiveEvent = {kind: 'request'; payload: NetworkRequest; origin: NetworkRow['origin']} | {kind: 'response'; payload: NetworkResponse; origin: NetworkRow['origin']};

export type DeviceNetwork = {
    rows: NetworkRow[];
    selectedUuid: string | null;
    paused: boolean;
    /** Duraklatılmışken gelen olaylar; devam edilince uygulanır. */
    pausedBuffer: LiveEvent[];
};

/** Cihaz başına bellekte tutulan en fazla istek. Kalıcılık yok (G14). */
const MAX_ROWS = 2000;

export const EMPTY_NETWORK: DeviceNetwork = {rows: [], selectedUuid: null, paused: false, pausedBuffer: []};

type NetworkState = {
    byDevice: Record<string, DeviceNetwork>;
    addRequest(deviceId: string, request: NetworkRequest, origin: NetworkRow['origin']): void;
    addResponse(deviceId: string, response: NetworkResponse, origin: NetworkRow['origin']): void;
    setPaused(deviceId: string, paused: boolean): void;
    select(deviceId: string, uuid: string | null): void;
    clear(deviceId: string): void;
    removeDevice(deviceId: string): void;
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

function findFromEnd(rows: NetworkRow[], uuid: string): number {
    // Yeni kayıtlar sonda olduğundan sondan aramak daha hızlı.
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.uuid === uuid) return i;
    return -1;
}

function apply(rows: NetworkRow[], event: LiveEvent): NetworkRow[] {
    const idx = findFromEnd(rows, event.payload.uuid);
    if (event.kind === 'request') {
        if (idx >= 0) {
            const next = rows.slice();
            next[idx] = {...next[idx]!, request: event.payload};
            return next;
        }
        return cap([...rows, {uuid: event.payload.uuid, request: event.payload, response: null, responseSize: null, receivedAt: Date.now(), origin: event.origin}]);
    }
    const responseSize = measure(event.payload.body);
    if (idx >= 0) {
        const next = rows.slice();
        next[idx] = {...next[idx]!, response: event.payload, responseSize};
        return next;
    }
    return cap([...rows, {uuid: event.payload.uuid, request: null, response: event.payload, responseSize, receivedAt: Date.now(), origin: event.origin}]);
}

export const useNetworkStore = create<NetworkState>((set, get) => {
    const update = (deviceId: string, fn: (state: DeviceNetwork) => Partial<DeviceNetwork>) =>
        set((s) => {
            const current = s.byDevice[deviceId] ?? EMPTY_NETWORK;
            return {byDevice: {...s.byDevice, [deviceId]: {...current, ...fn(current)}}};
        });

    const ingest = (deviceId: string, event: LiveEvent) => {
        const current = get().byDevice[deviceId] ?? EMPTY_NETWORK;
        if (current.paused) update(deviceId, (d) => ({pausedBuffer: [...d.pausedBuffer, event]}));
        else update(deviceId, (d) => ({rows: apply(d.rows, event)}));
    };

    return {
        byDevice: {},
        addRequest: (deviceId, payload, origin) => ingest(deviceId, {kind: 'request', payload, origin}),
        addResponse: (deviceId, payload, origin) => ingest(deviceId, {kind: 'response', payload, origin}),
        setPaused: (deviceId, paused) =>
            update(deviceId, (d) => {
                if (paused) return {paused: true};
                return {paused: false, pausedBuffer: [], rows: d.pausedBuffer.reduce(apply, d.rows)};
            }),
        select: (deviceId, selectedUuid) => update(deviceId, () => ({selectedUuid})),
        clear: (deviceId) => update(deviceId, () => ({rows: [], selectedUuid: null, pausedBuffer: []})),
        removeDevice: (deviceId) =>
            set((s) => {
                const {[deviceId]: _removed, ...byDevice} = s.byDevice;
                return {byDevice};
            }),
    };
});

export function useDeviceNetwork<T>(deviceId: string, selector: (state: DeviceNetwork) => T): T {
    return useNetworkStore((s) => selector(s.byDevice[deviceId] ?? EMPTY_NETWORK));
}
