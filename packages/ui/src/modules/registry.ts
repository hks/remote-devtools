import type {ComponentType} from 'react';
import type {DeviceSnapshot, PanelDef} from '@himmetkaan/remote-devtools-protocol';
import {FlagsTab} from './flags/FlagsTab.tsx';
import {FunctionsTab} from './functions/FunctionsTab.tsx';
import {LogsTab} from './logs/LogsTab.tsx';
import {NetworkTab} from './network/NetworkTab.tsx';
import {PanelTab} from './panels/PanelTab.tsx';
import {StateTab} from './state/StateTab.tsx';
import {StorageTab} from './storage/StorageTab.tsx';

/**
 * UI module = one tab. `capability` is the key in the device's `hello.capabilities`;
 * the tab is hidden if the device doesn't report it. `null` → core module, present on every device.
 */
export type UiModule = {
    id: string;
    title: string;
    icon: string;
    capability: string | null;
    Component: ComponentType<{deviceId: string; panelId?: string}>;
    /** Custom panel defined by the app (each panel is its own tab). */
    panelId?: string;
};

export const MODULES: UiModule[] = [
    {id: 'logs', title: 'Logs', icon: '📜', capability: null, Component: LogsTab},
    {id: 'network', title: 'Network', icon: '🌐', capability: 'network', Component: NetworkTab},
    {id: 'functions', title: 'Functions', icon: '🧩', capability: 'functions', Component: FunctionsTab},
    {id: 'storage', title: 'Storage', icon: '🗄️', capability: 'storage', Component: StorageTab},
    {id: 'state', title: 'State', icon: '🧠', capability: 'state', Component: StateTab},
    {id: 'flags', title: 'Flags', icon: '🚩', capability: 'flags', Component: FlagsTab},
];

const KNOWN_CAPABILITIES = new Set([...MODULES.map((m) => m.capability).filter(Boolean), 'panels']);

const DEFAULT_PANEL_ICON = '🧱';

/** Built-in modules, then panels defined by the device (in reported order). */
export function modulesFor(device: DeviceSnapshot | null): UiModule[] {
    const capabilities = device?.hello?.capabilities ?? {};
    const builtIn = MODULES.filter((m) => m.capability === null || m.capability in capabilities);
    const panels = Array.isArray(capabilities.panels) ? (capabilities.panels as PanelDef[]) : [];
    return [
        ...builtIn,
        ...panels.map((panel): UiModule => ({
            id: `panel:${panel.id}`,
            title: panel.title,
            icon: panel.icon || DEFAULT_PANEL_ICON,
            capability: 'panels',
            Component: PanelTab,
            panelId: panel.id,
        })),
    ];
}

/** Modules the device reports but this UI version doesn't know (could be a newer SDK). */
export function unknownCapabilities(device: DeviceSnapshot | null): string[] {
    return Object.keys(device?.hello?.capabilities ?? {}).filter((key) => !KNOWN_CAPABILITIES.has(key));
}
