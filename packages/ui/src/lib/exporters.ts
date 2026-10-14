import type {NetworkRequest} from '@himmetkaan/remote-devtools-protocol/v1';
import type {NetworkRow} from '../store/useNetworkStore.ts';
import {fullUrl} from './requestFormat.ts';

/** axios `params` objesini URL'e ekler (axios'un yaptığı gibi). */
export function urlWithParams(request: NetworkRequest): string {
    const base = fullUrl(request);
    const params = request.params;
    if (!params || typeof params !== 'object' || Object.keys(params).length === 0) return base;
    const url = new URL(base, 'http://placeholder.invalid');
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        if (value === undefined || value === null) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) url.searchParams.append(key, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    return url.origin === 'http://placeholder.invalid' ? url.pathname + url.search : url.toString();
}

function headerEntries(headers: Record<string, unknown> | null | undefined): {name: string; value: string}[] {
    return Object.entries(headers ?? {})
        .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
        .map(([name, value]) => ({name, value: String(value)}));
}

function bodyText(body: unknown): string | null {
    if (body === null || body === undefined || body === '') return null;
    if (typeof body === 'string') return body;
    if ((body as {__truncated?: boolean}).__truncated) return null;
    return JSON.stringify(body);
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export function toCurl(request: NetworkRequest): string {
    // Her satır bir seçenek (bayrak + değeri birlikte).
    const lines = [`curl ${shellQuote(urlWithParams(request))}`];
    if (request.method !== 'GET') lines.push(`-X ${request.method}`);
    for (const {name, value} of headerEntries(request.headers)) {
        lines.push(`-H ${shellQuote(`${name}: ${value}`)}`);
    }
    const body = bodyText(request.body);
    if (body !== null && request.method !== 'GET') lines.push(`--data-raw ${shellQuote(body)}`);
    return lines.join(' \\\n  ');
}

/** Tek kaydın tamamı (istek + yanıt) — "JSON olarak kopyala". */
export function toEntryJson(row: NetworkRow): string {
    return JSON.stringify({request: row.request, response: row.response}, null, 2);
}

export function toJsonExport(rows: NetworkRow[]): string {
    return JSON.stringify(
        {
            exportedAt: new Date().toISOString(),
            count: rows.length,
            entries: rows.map((r) => ({request: r.request, response: r.response})),
        },
        null,
        2,
    );
}

/** HAR 1.2 — Chrome DevTools, Charles, Proxyman vb. ile açılabilir. */
export function toHar(rows: NetworkRow[]): string {
    const entries = rows
        .filter((r): r is NetworkRow & {request: NetworkRequest} => r.request !== null)
        .map((row) => {
            const {request, response} = row;
            const reqBody = bodyText(request.body);
            const resBody = response ? bodyText(response.body) : null;
            const url = urlWithParams(request);
            let queryString: {name: string; value: string}[] = [];
            try {
                queryString = [...new URL(url).searchParams].map(([name, value]) => ({name, value}));
            } catch {
                // Göreli URL — query çıkarılamaz.
            }
            const time = response?.durationMs ?? 0;
            const contentType = (key: Record<string, unknown> | null | undefined) =>
                String(Object.entries(key ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? 'application/json');

            return {
                startedDateTime: new Date(request.startedAt || row.receivedAt).toISOString(),
                time,
                request: {
                    method: request.method,
                    url,
                    httpVersion: 'HTTP/1.1',
                    headers: headerEntries(request.headers),
                    queryString,
                    cookies: [],
                    headersSize: -1,
                    bodySize: reqBody?.length ?? 0,
                    ...(reqBody !== null ? {postData: {mimeType: contentType(request.headers), text: reqBody}} : {}),
                },
                response: {
                    status: response?.status ?? 0,
                    statusText: response?.errorMessage ?? '',
                    httpVersion: 'HTTP/1.1',
                    headers: headerEntries(response?.headers),
                    cookies: [],
                    content: {
                        size: resBody?.length ?? 0,
                        mimeType: contentType(response?.headers),
                        ...(resBody !== null ? {text: resBody} : {}),
                    },
                    redirectURL: '',
                    headersSize: -1,
                    bodySize: resBody?.length ?? -1,
                },
                cache: {},
                timings: {send: 0, wait: time, receive: 0},
                _uuid: row.uuid,
                _result: response?.result ?? 'pending',
            };
        });

    return JSON.stringify({log: {version: '1.2', creator: {name: 'Remote DevTools', version: '1'}, entries}}, null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], {type: mime}));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function timestampForFile(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
