import type {ComponentType} from 'react';
import type {DeviceSnapshot} from '@himmetkaan/remote-devtools-protocol';
import {FunctionsTab} from './functions/FunctionsTab.tsx';
import {LogsTab} from './logs/LogsTab.tsx';
import {NetworkTab} from './network/NetworkTab.tsx';

/**
 * UI modülü = bir tab. `capability` cihazın `hello.capabilities` içindeki anahtarıdır;
 * cihaz bildirmezse tab görünmez. `null` → çekirdek modül, her cihazda vardır.
 */
export type UiModule = {
    id: string;
    title: string;
    icon: string;
    capability: string | null;
    Component: ComponentType<{deviceId: string}>;
};

export const MODULES: UiModule[] = [
    {id: 'logs', title: 'Logs', icon: '📜', capability: null, Component: LogsTab},
    {id: 'network', title: 'Network', icon: '🌐', capability: 'network', Component: NetworkTab},
    {id: 'functions', title: 'Functions', icon: '🧩', capability: 'functions', Component: FunctionsTab},
];

const KNOWN_CAPABILITIES = new Set(MODULES.map((m) => m.capability).filter(Boolean));

export function modulesFor(device: DeviceSnapshot | null): UiModule[] {
    const capabilities = device?.hello?.capabilities ?? {};
    return MODULES.filter((m) => m.capability === null || m.capability in capabilities);
}

/** Cihazın bildirdiği ama bu UI sürümünün tanımadığı modüller (daha yeni bir SDK olabilir). */
export function unknownCapabilities(device: DeviceSnapshot | null): string[] {
    return Object.keys(device?.hello?.capabilities ?? {}).filter((key) => !KNOWN_CAPABILITIES.has(key));
}
