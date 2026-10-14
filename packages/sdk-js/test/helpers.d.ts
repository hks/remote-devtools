import { type Envelope } from '@himmetkaan/remote-devtools-protocol';
import { type RelayConfig, type RunningServer } from '@himmetkaan/remote-devtools-relay';
import { type ConnectionStatus, RemoteDevTools, type RemoteDevToolsOptions } from '../src/index.ts';
export declare const sleep: (ms: number) => Promise<unknown>;
export declare function withRelay(overrides: Partial<RelayConfig>, fn: (relay: RunningServer) => Promise<void>): Promise<void>;
export type Msg = Envelope<string, any>;
/** Simple client standing in for the UI (global WebSocket). */
export type Ui = {
    send(type: string, payload?: unknown, extra?: {
        deviceId?: string;
    }): string;
    next(type: string, timeoutMs?: number): Promise<Msg>;
    none(type: string, waitMs?: number): Promise<void>;
    close(): void;
    session: any;
};
export declare function openUi(port: number, resume?: {
    sessionId: string;
    uiSecret: string;
}): Promise<Ui>;
export declare function relayUrl(port: number): string;
export declare function createClient(overrides?: Partial<RemoteDevToolsOptions>): RemoteDevTools;
export declare function waitForStatus(client: RemoteDevTools, status: ConnectionStatus, timeoutMs?: number): Promise<void>;
