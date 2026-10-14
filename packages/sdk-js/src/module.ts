import type {Envelope, LogLevel} from '@himmetkaan/remote-devtools-protocol';
import type {KeyValueStorage} from './storage.ts';

export type LogOptions = { tag?: string };

export type Logger = Record<LogLevel, (message: string, data?: unknown, options?: LogOptions) => void>;

export type EmitOptions = {
    /** Whether to buffer while disconnected when `history` is enabled (default `true`). */
    buffer?: boolean;
};

export type ModuleContext = {
    readonly deviceId: string;
    isConnected(): boolean;
    /** Sends a message to the UI. The type must start with `module.<module name>.`. */
    emit(type: string, payload: unknown, options?: EmitOptions): void;
    /**
     * Handles a request from the UI. The return value (or Promise) is answered via `module.<module name>.result` as `{ok:true, result}`,
     * a thrown error as `{ok:false, error}`.
     */
    handle<P = any>(type: string, handler: (payload: P, message: Envelope<string, P>) => unknown): void;
    /** Listens for UI messages that expect no reply. */
    on<P = any>(type: string, listener: (payload: P, message: Envelope<string, P>) => void): void;
    /** Call when `capabilities()` changes; if connected, `capabilities.update` is sent to the UI, otherwise it goes into the next `hello`. */
    updateCapabilities(): void;
    /** The SDK's `storage` option; keys are stored under a module-specific prefix (e.g. flag overrides). */
    storage: KeyValueStorage;
    log: Logger;
};

export type RemoteModule = {
    /** The `hello.capabilities` key and the message namespace (`module.<name>.*`). */
    name: string;
    /** Capabilities reported to the UI. If not defined, the module is reported with `{}`. */
    capabilities?(): unknown;
    /** Called once if the SDK is enabled. The returned function is called on `destroy()`. Global patches (fetch etc.) belong here. */
    setup?(ctx: ModuleContext): void | (() => void);
};

export function defineModule<M extends RemoteModule>(module: M): M {
    return module;
}

/** When thrown from a handler, it is forwarded to the UI with the given code. */
export class ModuleError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'ModuleError';
        this.code = code;
    }
}
