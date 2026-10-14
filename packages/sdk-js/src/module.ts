import type {Envelope, LogLevel} from '@himmetkaan/remote-devtools-protocol';

export type LogOptions = { tag?: string };

export type Logger = Record<LogLevel, (message: string, data?: unknown, options?: LogOptions) => void>;

export type EmitOptions = {
    /** Bağlı değilken `history` açıksa tampona alınsın mı (varsayılan `true`). */
    buffer?: boolean;
};

export type ModuleContext = {
    readonly deviceId: string;
    isConnected(): boolean;
    /** Mesajı UI'a gönderir. Tip `module.<modül adı>.` ile başlamalıdır. */
    emit(type: string, payload: unknown, options?: EmitOptions): void;
    /**
     * UI'dan gelen bir isteği karşılar. Dönen değer (veya Promise) `module.<modül adı>.result` ile `{ok:true, result}` olarak,
     * fırlatılan hata `{ok:false, error}` olarak cevaplanır.
     */
    handle<P = any>(type: string, handler: (payload: P, message: Envelope<string, P>) => unknown): void;
    /** Cevap beklemeyen UI mesajlarını dinler. */
    on<P = any>(type: string, listener: (payload: P, message: Envelope<string, P>) => void): void;
    /** `capabilities()` değiştiğinde çağrılır; bağlıysa UI'a `capabilities.update` gider, değilse bir sonraki `hello`'ya girer. */
    updateCapabilities(): void;
    log: Logger;
};

export type RemoteModule = {
    /** `hello.capabilities` anahtarı ve mesaj ad alanı (`module.<name>.*`). */
    name: string;
    /** UI'a bildirilen yetenek bilgisi. Tanımlanmazsa modül `{}` ile bildirilir. */
    capabilities?(): unknown;
    /** SDK etkinse bir kez çağrılır. Dönen fonksiyon `destroy()`'da çağrılır. Global yamalar (fetch vb.) burada yapılmalıdır. */
    setup?(ctx: ModuleContext): void | (() => void);
};

export function defineModule<M extends RemoteModule>(module: M): M {
    return module;
}

/** Handler'dan fırlatılınca UI'a belirtilen kodla iletilir. */
export class ModuleError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'ModuleError';
        this.code = code;
    }
}
