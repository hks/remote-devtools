import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {app} from 'electron';

/** User preferences kept between launches (userData/settings.json). Connection state lives in relay-state.json. */
export type Settings = {advertiseOnLan: boolean};

const DEFAULTS: Settings = {advertiseOnLan: false};

const file = () => join(app.getPath('userData'), 'settings.json');

export function loadSettings(): Settings {
    try {
        return {...DEFAULTS, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>)};
    } catch {
        return {...DEFAULTS};
    }
}

export function saveSettings(settings: Settings): void {
    try {
        writeFileSync(file(), JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error('[settings] could not save', error);
    }
}
