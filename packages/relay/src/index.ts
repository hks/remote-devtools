/**
 * Relay'i bir kütüphane olarak başlatmak için (ör. Electron desktop app).
 * CLI kullanımı için bkz. `main.ts` (ortam değişkenlerinden okur).
 */
import {defaultConfig, type RelayConfig} from './config.ts';
import {type RunningServer, startServer} from './server.ts';

export type {ConnectRequestPolicy, RelayConfig} from './config.ts';
export {defaultConfig, loadConfig} from './config.ts';
export type {RunningServer} from './server.ts';

export function createRelay(options: Partial<RelayConfig> = {}): Promise<RunningServer> {
    return startServer({...defaultConfig, ...options});
}
