/**
 * For starting the relay as a library (e.g. the Electron desktop app).
 * For CLI usage see `main.ts` (reads environment variables).
 */
import {defaultConfig, type RelayConfig} from './config.ts';
import {type RunningServer, startServer} from './server.ts';

export type {ConnectRequestPolicy, RelayConfig} from './config.ts';
export {defaultConfig, loadConfig} from './config.ts';
export type {RunningServer} from './server.ts';

export function createRelay(options: Partial<RelayConfig> = {}): Promise<RunningServer> {
    return startServer({...defaultConfig, ...options});
}
