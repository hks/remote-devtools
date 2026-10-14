import {create} from 'zustand';
import type {
    Capabilities,
    ConnectRequest,
    DeviceSnapshot,
    Hello,
    Lifecycle,
    LogLevel,
    PairingInfo,
    TrustedDevice,
} from '@himmetkaan/remote-devtools-protocol';

export type RelayConnectionState = 'connecting' | 'open' | 'reconnecting';

export type LogSource = 'device' | 'relay' | 'ui';

export type LogEntry = {
    id: number;
    ts: number;
    level: LogLevel;
    source: LogSource;
    message: string;
    data?: unknown;
    tag?: string;
    /** `null`: oturum geneli olay (relay bağlantısı vb.). */
    deviceId: string | null;
    /** Cihaz bağlanmadan önce tamponlanıp `history` ile gelen kayıt. */
    historic?: boolean;
};

export type NewLogEntry = Omit<LogEntry, 'id' | 'ts'> & {ts?: number};

export type SessionInfo = {
    sessionId: string;
    deviceWsUrl: string | null;
    pairing: PairingInfo;
};

/** Bellekte tutulan en fazla log sayısı (tüm cihazlar). Kalıcılık yok (G14). */
const MAX_LOGS = 10_000;

type DevtoolsState = {
    relay: RelayConnectionState;
    session: SessionInfo | null;
    devices: Record<string, DeviceSnapshot>;
    pendingRequests: ConnectRequest[];
    trusted: TrustedDevice[];
    selectedDeviceId: string | null;
    /** Cihazlar varken "Add device" ile açılan eşleşme görünümü. */
    showPairing: boolean;
    activeTab: string;
    logs: LogEntry[];

    setRelay(state: RelayConnectionState): void;
    setSession(session: SessionInfo, devices: DeviceSnapshot[], pending: ConnectRequest[], trusted: TrustedDevice[]): void;
    setPairing(pairing: PairingInfo): void;
    upsertDevice(device: DeviceSnapshot): void;
    removeDevice(deviceId: string): void;
    setHello(deviceId: string, hello: Hello): void;
    mergeCapabilities(deviceId: string, patch: Partial<Capabilities>): void;
    setLifecycle(deviceId: string, lifecycle: Lifecycle): void;
    addPendingRequest(request: ConnectRequest): void;
    removePendingRequest(requestId: string): void;
    setTrusted(devices: TrustedDevice[]): void;
    selectDevice(deviceId: string | null): void;
    setShowPairing(show: boolean): void;
    setActiveTab(tab: string): void;
    addLog(entry: NewLogEntry): void;
    /** Toplu ekleme (ör. `history`); zaman sırasına yerleştirilir. */
    addLogs(entries: NewLogEntry[]): void;
    clearLogs(deviceId: string | null): void;
};

let logSeq = 0;

function capLogs(logs: LogEntry[]): LogEntry[] {
    return logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs;
}

function toEntry({ts, ...entry}: NewLogEntry): LogEntry {
    return {...entry, id: ++logSeq, ts: ts ?? Date.now()};
}

/** Seçili cihaz yoksa veya kaldırıldıysa listede kalan ilk cihaz. */
function pickSelection(devices: Record<string, DeviceSnapshot>, current: string | null): string | null {
    if (current && devices[current]) return current;
    return sortDevices(Object.values(devices))[0]?.deviceId ?? null;
}

export function sortDevices(devices: DeviceSnapshot[]): DeviceSnapshot[] {
    return [...devices].sort((a, b) => a.pairedAt - b.pairedAt);
}

export const useDevtoolsStore = create<DevtoolsState>((set) => ({
    relay: 'connecting',
    session: null,
    devices: {},
    pendingRequests: [],
    trusted: [],
    selectedDeviceId: null,
    showPairing: false,
    activeTab: 'logs',
    logs: [],

    setRelay: (relay) => set({relay}),

    setSession: (session, deviceList, pendingRequests, trusted) =>
        set((s) => {
            const devices = Object.fromEntries(deviceList.map((d) => [d.deviceId, d]));
            return {session, devices, pendingRequests, trusted, selectedDeviceId: pickSelection(devices, s.selectedDeviceId)};
        }),

    setPairing: (pairing) => set((s) => (s.session ? {session: {...s.session, pairing}} : {})),

    upsertDevice: (device) =>
        set((s) => {
            const previous = s.devices[device.deviceId];
            // Relay'in anlık görüntüsünde hello olmayabilir (ör. resume'dan hemen sonra); bilineni kaybetme.
            const merged = {...device, hello: device.hello ?? previous?.hello ?? null};
            const devices = {...s.devices, [device.deviceId]: merged};
            const isNew = !previous;
            return {
                devices,
                selectedDeviceId: isNew && (s.showPairing || !s.selectedDeviceId) ? device.deviceId : pickSelection(devices, s.selectedDeviceId),
                showPairing: isNew ? false : s.showPairing,
            };
        }),

    removeDevice: (deviceId) =>
        set((s) => {
            const {[deviceId]: _removed, ...devices} = s.devices;
            return {
                devices,
                selectedDeviceId: pickSelection(devices, s.selectedDeviceId === deviceId ? null : s.selectedDeviceId),
                logs: s.logs.filter((l) => l.deviceId !== deviceId),
            };
        }),

    setHello: (deviceId, hello) =>
        set((s) => {
            const device = s.devices[deviceId];
            return device ? {devices: {...s.devices, [deviceId]: {...device, hello}}} : {};
        }),

    mergeCapabilities: (deviceId, patch) =>
        set((s) => {
            const device = s.devices[deviceId];
            if (!device?.hello) return {};
            const hello = {...device.hello, capabilities: {...device.hello.capabilities, ...patch}};
            return {devices: {...s.devices, [deviceId]: {...device, hello}}};
        }),

    setLifecycle: (deviceId, lifecycle) =>
        set((s) => {
            const device = s.devices[deviceId];
            return device ? {devices: {...s.devices, [deviceId]: {...device, lifecycle, lastSeenAt: Date.now()}}} : {};
        }),

    addPendingRequest: (request) =>
        set((s) => ({pendingRequests: [...s.pendingRequests.filter((r) => r.requestId !== request.requestId), request]})),
    removePendingRequest: (requestId) => set((s) => ({pendingRequests: s.pendingRequests.filter((r) => r.requestId !== requestId)})),
    setTrusted: (trusted) => set({trusted}),

    selectDevice: (selectedDeviceId) => set({selectedDeviceId, showPairing: false}),
    setShowPairing: (showPairing) => set({showPairing}),
    setActiveTab: (activeTab) => set({activeTab}),

    addLog: (entry) => set((s) => ({logs: capLogs([...s.logs, toEntry(entry)])})),
    addLogs: (entries) =>
        set((s) => {
            if (entries.length === 0) return {};
            // Sıralama kararlıdır: aynı zamandaki kayıtlar geliş sırasını korur.
            const merged = [...s.logs, ...entries.map(toEntry)].sort((a, b) => a.ts - b.ts);
            return {logs: capLogs(merged)};
        }),
    clearLogs: (deviceId) => set((s) => ({logs: s.logs.filter((l) => l.deviceId !== deviceId && l.deviceId !== null)})),
}));

export type DeviceStatus = 'online' | 'background' | 'offline';

export function getDeviceStatus(device: DeviceSnapshot): DeviceStatus {
    if (!device.connected) return 'offline';
    if (device.lifecycle === 'background') return 'background';
    return 'online';
}

export function deviceName(device: DeviceSnapshot): string {
    const hello = device.hello;
    return hello?.device.name || hello?.device.model || hello?.app.name || `Device ${device.deviceId.slice(0, 6)}`;
}

export function useSelectedDevice(): DeviceSnapshot | null {
    return useDevtoolsStore((s) => (s.selectedDeviceId ? s.devices[s.selectedDeviceId] ?? null : null));
}
