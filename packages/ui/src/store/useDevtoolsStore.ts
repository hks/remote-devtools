import {create} from 'zustand';
import type {AppLifecycleState, DeviceInfo, DeviceSnapshot, LogLevel} from '@himmetkaan/remote-devtools-protocol/v1';

export type RelayConnectionState = 'connecting' | 'open' | 'reconnecting';

export type LogSource = 'web' | 'relay' | 'device';

export type LogEntry = {
    id: number;
    ts: number;
    level: LogLevel;
    source: LogSource;
    message: string;
    data?: unknown;
};

export type PairingInfo = {
    sessionId: string;
    deviceWsUrl: string | null;
    pairToken: string | null;
    pairTokenExpiresAt: number | null;
};

export type TabId = 'logs' | 'serviceRequests' | 'functions';

/** Bellekte tutulan en fazla log sayısı (IndexedDB kalıcılığı Faz 6'da). */
const MAX_LOGS = 5000;

type DevtoolsState = {
    relay: RelayConnectionState;
    pairing: PairingInfo | null;
    /** `null` → cihaz eşleşmemiş, QR ekranı gösterilir. */
    device: DeviceSnapshot | null;
    logs: LogEntry[];
    activeTab: TabId;

    setRelay(state: RelayConnectionState): void;
    setPairing(pairing: PairingInfo): void;
    setPairToken(pairToken: string, expiresAt: number): void;
    setDevice(device: DeviceSnapshot | null): void;
    setDeviceInfo(info: DeviceInfo): void;
    setLifecycle(lifecycle: AppLifecycleState): void;
    addLog(entry: Omit<LogEntry, 'id' | 'ts'> & {ts?: number}): void;
    clearLogs(): void;
    /** IndexedDB'den geri yükleme; yeni id'ler en büyük kayıtlı id'den devam eder. */
    hydrateLogs(logs: LogEntry[]): void;
    setActiveTab(tab: TabId): void;
};

let logSeq = 0;

export const useDevtoolsStore = create<DevtoolsState>((set) => ({
    relay: 'connecting',
    pairing: null,
    device: null,
    logs: [],
    activeTab: 'logs',

    setRelay: (relay) => set({relay}),
    setPairing: (pairing) => set({pairing}),
    setPairToken: (pairToken, expiresAt) =>
        set((s) => (s.pairing ? {pairing: {...s.pairing, pairToken, pairTokenExpiresAt: expiresAt}} : {})),
    setDevice: (device) => set({device}),
    setDeviceInfo: (info) => set((s) => (s.device ? {device: {...s.device, info}} : {})),
    setLifecycle: (lifecycle) => set((s) => (s.device ? {device: {...s.device, lifecycle, lastSeenAt: Date.now()}} : {})),
    addLog: ({ts, ...entry}) =>
        set((s) => {
            const next = [...s.logs, {...entry, id: ++logSeq, ts: ts ?? Date.now()}];
            return {logs: next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next};
        }),
    clearLogs: () => set({logs: []}),
    hydrateLogs: (logs) => {
        logSeq = Math.max(logSeq, ...logs.map((l) => l.id));
        set((s) => ({logs: [...logs, ...s.logs]}));
    },
    setActiveTab: (activeTab) => set({activeTab}),
}));

export type DeviceStatus = 'online' | 'background' | 'offline';

export function getDeviceStatus(device: DeviceSnapshot): DeviceStatus {
    if (!device.connected) return 'offline';
    if (device.lifecycle === 'background') return 'background';
    return 'online';
}
