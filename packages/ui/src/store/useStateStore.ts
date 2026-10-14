import {create} from 'zustand';
import {applyPatch, diffJson, getAtPointer, type JsonPatchOp, type StateChange} from '@himmetkaan/remote-devtools-protocol';

export type ChangeLine = {op: JsonPatchOp['op']; path: string; from: unknown; to: unknown};

export type TimelineEntry = {
    id: number;
    at: number;
    actions: string[];
    /** `full`: fark çok büyüktü, tam state geldi. `resync`: izlenmeyen sürede oluşan fark (yeniden abone olunca). */
    kind: 'patch' | 'full' | 'resync';
    changes: ChangeLine[];
    /** `changes` kısaltıldıysa toplam sayı. */
    total: number;
};

export type StoreView = {
    state: unknown;
    loaded: boolean;
    timeline: TimelineEntry[];
    /** Patch uygulanamadı (ör. kaçırılmış bir mesaj); tab yeniden abone olur. */
    stale: boolean;
};

/** Store başına tutulan en fazla zaman çizelgesi girdisi ve girdi başına satır. Kalıcılık yok (G14). */
const MAX_ENTRIES = 300;
const MAX_LINES = 200;

export const EMPTY_VIEW: StoreView = {state: undefined, loaded: false, timeline: [], stale: false};

export const stateKey = (deviceId: string, storeId: string) => `${deviceId}\u0000${storeId}`;

let nextId = 1;

function linesFor(doc: unknown, patch: readonly JsonPatchOp[]): {state: unknown; lines: ChangeLine[]} {
    let state = doc;
    const lines: ChangeLine[] = [];
    for (const op of patch) {
        if (lines.length < MAX_LINES) lines.push({op: op.op, path: op.path, from: getAtPointer(state, op.path), to: op.value});
        state = applyPatch(state, [op]);
    }
    return {state, lines};
}

type StateStore = {
    views: Record<string, StoreView>;
    /** Abonelik cevabı: ilk yüklemede sadece state; daha önce görülmüşse aradaki fark zaman çizelgesine eklenir. */
    setSnapshot(key: string, state: unknown): void;
    applyChange(key: string, change: StateChange): void;
    clearTimeline(key: string): void;
    removeDevice(deviceId: string): void;
};

export const useStateStore = create<StateStore>((set, get) => {
    const update = (key: string, fn: (view: StoreView) => Partial<StoreView>) =>
        set((s) => {
            const view = s.views[key] ?? EMPTY_VIEW;
            return {views: {...s.views, [key]: {...view, ...fn(view)}}};
        });

    const push = (timeline: TimelineEntry[], entry: Omit<TimelineEntry, 'id'>) => {
        const next = [...timeline, {...entry, id: nextId++}];
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    };

    return {
        views: {},

        setSnapshot: (key, state) =>
            update(key, (view) => {
                if (!view.loaded) return {state, loaded: true, stale: false};
                const patch = diffJson(view.state, state, {maxOps: 5000});
                if (patch?.length === 0) return {state, stale: false};
                const lines = patch ? linesFor(view.state, patch).lines : [{op: 'replace' as const, path: '', from: view.state, to: state}];
                return {
                    state,
                    stale: false,
                    timeline: push(view.timeline, {at: Date.now(), actions: [], kind: 'resync', changes: lines, total: patch?.length ?? 1}),
                };
            }),

        applyChange: (key, change) => {
            const view = get().views[key];
            if (!view?.loaded || view.stale) return;
            if (change.state !== undefined) {
                update(key, (v) => ({
                    state: change.state,
                    timeline: push(v.timeline, {at: change.at, actions: change.actions, kind: 'full', changes: [{op: 'replace', path: '', from: v.state, to: change.state}], total: 1}),
                }));
                return;
            }
            const patch = change.patch ?? [];
            try {
                const {state, lines} = linesFor(view.state, patch);
                update(key, (v) => ({state, timeline: push(v.timeline, {at: change.at, actions: change.actions, kind: 'patch', changes: lines, total: patch.length})}));
            } catch {
                update(key, () => ({stale: true}));
            }
        },

        clearTimeline: (key) => update(key, () => ({timeline: []})),

        removeDevice: (deviceId) =>
            set((s) => ({views: Object.fromEntries(Object.entries(s.views).filter(([key]) => !key.startsWith(`${deviceId}\u0000`)))})),
    };
});
