import type {NetworkRequest, NetworkResponse} from '@himmetkaan/remote-devtools-protocol';
import {randomDeviceId} from '../connection.ts';
import {defineModule, type ModuleContext, type RemoteModule} from '../module.ts';

export type NetworkModuleOptions = {
    /** Automatically capture fetch/XHR (default `true`). When off, only `record()` and `axios()` record entries. */
    autoCapture?: boolean;
    /**
     * Capture the global `fetch`. Default: `true` outside React Native.
     * On React Native `fetch` already runs on XMLHttpRequest; capturing both would show every request twice.
     */
    captureFetch?: boolean;
    /** Capture `XMLHttpRequest` (including axios and fetch on RN). Default `true`. */
    captureXhr?: boolean;
    /** Requests to these URLs are not recorded. Metro's `/symbolicate` requests are excluded by default. */
    ignoreUrls?: (string | RegExp)[];
    /** Request/response bodies longer than this (in characters) are truncated. Default 1 MB. */
    maxBodySize?: number;
};

export type ManualResponse = {
    status?: number | null;
    headers?: Record<string, unknown> | null;
    body?: unknown;
    /** If set, the request is considered failed (network error etc.). */
    error?: string | null;
};

export type ManualRequest = {
    method?: string;
    url: string;
    headers?: Record<string, unknown> | null;
    body?: unknown;
};

/** The part of an axios instance we need (the SDK doesn't import axios). */
type AxiosLike = {
    interceptors: {
        request: {use(onFulfilled: (config: any) => any): number; eject(id: number): void};
        response: {use(onFulfilled: (response: any) => any, onRejected: (error: any) => any): number; eject(id: number): void};
    };
};

export type NetworkModule = RemoteModule & {
    /** Manual recording (e.g. apps with their own HTTP layer). Record the response with the returned object. */
    record(request: ManualRequest): {response(response: ManualResponse): void};
    /** Adds interceptors to an axios instance (when auto-capture is off). The returned function removes them. */
    axios(instance: AxiosLike): () => void;
};

/** Holds the original on the patched fetch; the SDK's own requests (discovery) use it. */
export const ORIGINAL_FETCH = Symbol.for('remote-devtools.original-fetch');
const XHR_STATE = Symbol.for('remote-devtools.xhr-state');

const DEFAULT_IGNORE: RegExp[] = [/\/symbolicate(\?|$)/];
const DEFAULT_MAX_BODY = 1024 * 1024;

const isReactNative = () => (globalThis as {navigator?: {product?: string}}).navigator?.product === 'ReactNative';

// ─── Body and header conversions ─────────────────────────────────────────────

function resolveUrl(url: string): string {
    try {
        const base = (globalThis as {location?: {href?: string}}).location?.href;
        return base ? new URL(url, base).href : url;
    } catch {
        return url;
    }
}

function normalizeHeaders(headers: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!headers) return out;
    const h = headers as {forEach?: (cb: (value: string, key: string) => void) => void};
    if (typeof h.forEach === 'function' && !Array.isArray(headers)) {
        h.forEach((value, key) => (out[key] = String(value)));
        return out;
    }
    const entries = Array.isArray(headers) ? (headers as [string, unknown][]) : Object.entries(headers as Record<string, unknown>);
    for (const [key, value] of entries) {
        if (value !== undefined && value !== null && typeof value !== 'object') out[key] = String(value);
    }
    return out;
}

function parseRawHeaders(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of raw.trim().split(/[\r\n]+/)) {
        const idx = line.indexOf(':');
        if (idx > 0) out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    return out;
}

/** Tries to parse a text body as JSON; otherwise leaves it as text. */
function parseText(text: string): unknown {
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            return JSON.parse(text);
        } catch {
            // not JSON
        }
    }
    return text;
}

/** Converts a request body passed to fetch/XHR into a displayable value. */
function describeBody(body: unknown): unknown {
    if (body === undefined || body === null) return null;
    if (typeof body === 'string') return parseText(body);
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const out: Record<string, unknown> = {};
        body.forEach((value, key) => (out[key] = typeof value === 'string' ? value : `[file ${(value as File).name ?? ''}]`));
        return {formData: out};
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) return `[binary ${body.size} bytes]`;
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `[binary ${(body as ArrayBuffer).byteLength} bytes]`;
    if (typeof body === 'object') return body;
    return String(body);
}

function limitBody(body: unknown, max: number): {body: unknown; truncated?: {originalSize: number}} {
    if (body === null || body === undefined) return {body: null};
    const text = typeof body === 'string' ? body : safeStringify(body);
    if (text === null || text.length <= max) return {body};
    return {body: text.slice(0, max), truncated: {originalSize: text.length}};
}

function safeStringify(value: unknown): string | null {
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}

const isError = (status: number | null) => status === null || status === 0 || status >= 400;

// ─── Module ──────────────────────────────────────────────────────────────────

/**
 * Request/response recording for the Network tab.
 *
 *     const network = networkModule();                 // fetch + XHR automatically
 *     RemoteDevTools.init({..., modules: [network]});
 */
export function networkModule(options: NetworkModuleOptions = {}): NetworkModule {
    const autoCapture = options.autoCapture ?? true;
    const ignore = [...DEFAULT_IGNORE, ...(options.ignoreUrls ?? [])];
    const maxBody = options.maxBodySize ?? DEFAULT_MAX_BODY;
    let ctx: ModuleContext | null = null;

    const ignored = (url: string) => ignore.some((p) => (typeof p === 'string' ? url.includes(p) : p.test(url)));

    function emitRequest(request: NetworkRequest) {
        const {body} = limitBody(request.body, maxBody);
        ctx?.emit('module.network.request', {...request, body});
    }

    function emitResponse(response: NetworkResponse) {
        const {body, truncated} = limitBody(response.body, maxBody);
        ctx?.emit('module.network.response', truncated ? {...response, body, bodyTruncated: truncated} : {...response, body});
    }

    /** `headers`: may be a plain object, `Headers` or `[name, value][]` (fetch/XHR/axios). */
    function start(input: Omit<ManualRequest, 'headers'> & {headers?: unknown}): {uuid: string; startedAt: number} | null {
        const url = resolveUrl(input.url);
        if (!ctx || ignored(url)) return null;
        const uuid = randomDeviceId();
        const startedAt = Date.now();
        emitRequest({
            uuid,
            method: (input.method ?? 'GET').toUpperCase(),
            url,
            headers: normalizeHeaders(input.headers),
            body: describeBody(input.body),
            startedAt,
        });
        return {uuid, startedAt};
    }

    function finish(started: {uuid: string; startedAt: number}, res: ManualResponse) {
        const status = res.status ?? null;
        emitResponse({
            uuid: started.uuid,
            status,
            headers: res.headers ? normalizeHeaders(res.headers) : null,
            body: res.body ?? null,
            durationMs: Date.now() - started.startedAt,
            result: res.error || isError(status) ? 'error' : 'success',
            errorMessage: res.error ?? (status !== null && status >= 400 ? `HTTP ${status}` : null),
        });
    }

    // ─── fetch ───────────────────────────────────────────────────────────────

    function patchFetch(): (() => void) | null {
        const g = globalThis as {fetch?: typeof fetch & {[ORIGINAL_FETCH]?: typeof fetch}};
        const original = g.fetch;
        if (typeof original !== 'function') return null;

        const patched = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const req = input as Request;
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : req.url;
            const started = start({
                url,
                method: init?.method ?? (typeof input === 'object' && 'method' in input ? req.method : 'GET'),
                headers: init?.headers ?? (typeof input === 'object' && 'headers' in input ? req.headers : null),
                body: init?.body,
            });
            if (!started) return original(input, init);
            let response: Response;
            try {
                response = await original(input, init);
            } catch (err) {
                finish(started, {error: (err as Error)?.message || 'Network error'});
                throw err;
            }
            const headers = normalizeHeaders(response.headers);
            const contentType = headers['content-type'] ?? '';
            if (contentType.includes('text/event-stream')) {
                finish(started, {status: response.status, headers, body: '[event stream]'});
            } else {
                // The body is read from a clone, so the response the app reads is unaffected.
                response
                    .clone()
                    .text()
                    .then((text) => finish(started, {status: response.status, headers, body: parseText(text)}))
                    .catch(() => finish(started, {status: response.status, headers, body: '[unreadable body]'}));
            }
            return response;
        }) as typeof fetch & {[ORIGINAL_FETCH]?: typeof fetch};
        patched[ORIGINAL_FETCH] = original;
        g.fetch = patched;
        return () => {
            if (g.fetch === patched) g.fetch = original;
        };
    }

    // ─── XMLHttpRequest ──────────────────────────────────────────────────────

    function patchXhr(): (() => void) | null {
        const Xhr = (globalThis as {XMLHttpRequest?: typeof XMLHttpRequest}).XMLHttpRequest;
        if (!Xhr) return null;
        const proto = Xhr.prototype;
        const {open, send, setRequestHeader} = proto;
        type State = {method: string; url: string; headers: Record<string, string>; failure?: string};
        type Tracked = XMLHttpRequest & {[XHR_STATE]?: State};

        proto.open = function (this: Tracked, method: string, url: string | URL, ...rest: unknown[]) {
            this[XHR_STATE] = {method, url: String(url), headers: {}};
            return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
        } as typeof proto.open;

        proto.setRequestHeader = function (this: Tracked, name: string, value: string) {
            const state = this[XHR_STATE];
            if (state) state.headers[name] = value;
            return setRequestHeader.call(this, name, value);
        };

        proto.send = function (this: Tracked, body?: Document | XMLHttpRequestBodyInit | null) {
            const state = this[XHR_STATE];
            const started = state ? start({method: state.method, url: state.url, headers: state.headers, body}) : null;
            if (started && state) {
                this.addEventListener('abort', () => (state.failure = 'Aborted'));
                this.addEventListener('timeout', () => (state.failure = 'Timed out'));
                this.addEventListener('error', () => (state.failure ??= 'Network error'));
                this.addEventListener('loadend', () => {
                    const status = this.status || null;
                    let responseBody: unknown = null;
                    try {
                        if (this.responseType === '' || this.responseType === 'text') responseBody = parseText(this.responseText);
                        else if (this.responseType === 'json') responseBody = this.response;
                        else responseBody = `[${this.responseType} response]`;
                    } catch {
                        responseBody = '[unreadable body]';
                    }
                    finish(started, {
                        status,
                        headers: parseRawHeaders(this.getAllResponseHeaders() ?? ''),
                        body: responseBody,
                        error: status === null ? (state.failure ?? 'Network error') : null,
                    });
                });
            }
            return send.call(this, body);
        };

        return () => {
            proto.open = open;
            proto.send = send;
            proto.setRequestHeader = setRequestHeader;
        };
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    return defineModule({
        name: 'network',
        capabilities: () => ({autoCapture}),

        setup(context: ModuleContext) {
            ctx = context;
            const cleanups: (() => void)[] = [];
            if (autoCapture) {
                if (options.captureFetch ?? !isReactNative()) {
                    const undo = patchFetch();
                    if (undo) cleanups.push(undo);
                }
                if (options.captureXhr ?? true) {
                    const undo = patchXhr();
                    if (undo) cleanups.push(undo);
                }
            }
            return () => {
                for (const undo of cleanups.reverse()) undo();
                ctx = null;
            };
        },

        record(request) {
            const started = start(request);
            return {response: (res) => started && finish(started, res)};
        },

        axios(instance) {
            const KEY = '__remoteDevtools';
            const requestId = instance.interceptors.request.use((config) => {
                const url =
                    config.baseURL && !/^https?:\/\//i.test(config.url ?? '')
                        ? `${String(config.baseURL).replace(/\/+$/, '')}/${String(config.url ?? '').replace(/^\/+/, '')}`
                        : config.url;
                let full = String(url ?? '');
                if (config.params && typeof config.params === 'object') {
                    const query = new URLSearchParams(
                        Object.entries(config.params)
                            .filter(([, v]) => v !== undefined && v !== null)
                            .map(([k, v]) => [k, String(v)]),
                    ).toString();
                    if (query) full += (full.includes('?') ? '&' : '?') + query;
                }
                config[KEY] = start({method: config.method, url: full, headers: config.headers, body: config.data});
                return config;
            });
            const responseId = instance.interceptors.response.use(
                (response) => {
                    const started = response?.config?.[KEY];
                    if (started) finish(started, {status: response.status, headers: response.headers, body: response.data});
                    return response;
                },
                (error) => {
                    const started = error?.config?.[KEY];
                    if (started) {
                        const res = error.response;
                        finish(
                            started,
                            res ? {status: res.status, headers: res.headers, body: res.data} : {error: error.message || 'Network error'},
                        );
                    }
                    return Promise.reject(error);
                },
            );
            return () => {
                instance.interceptors.request.eject(requestId);
                instance.interceptors.response.eject(responseId);
            };
        },
    });
}
