import type {NetworkRequest} from '@himmetkaan/remote-devtools-protocol/v1';
import type {NetworkRow} from '../store/useNetworkStore.ts';

export function fullUrl(request: NetworkRequest): string {
    if (/^https?:\/\//i.test(request.url) || !request.baseURL) return request.url;
    return request.baseURL.replace(/\/+$/, '') + '/' + request.url.replace(/^\/+/, '');
}

/** Listede gösterilecek kısa yol: host olmadan path + query. */
export function displayPath(request: NetworkRequest): string {
    const url = fullUrl(request);
    try {
        const parsed = new URL(url);
        return parsed.pathname + parsed.search;
    } catch {
        return url;
    }
}

export function displayHost(request: NetworkRequest): string {
    try {
        return new URL(fullUrl(request)).host;
    } catch {
        return '';
    }
}

export function formatBytes(chars: number | null): string {
    if (chars === null) return '—';
    if (chars < 1024) return `${chars} B`;
    if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
    return `${(chars / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}

export type RowStatus = 'pending' | 'success' | 'error';

export function rowStatus(row: NetworkRow): RowStatus {
    if (!row.response) return 'pending';
    return row.response.result;
}

/** Status kolonu: HTTP kodu; ağ hatasında "ERR". */
export function statusLabel(row: NetworkRow): string {
    if (!row.response) return '…';
    return row.response.status === null ? 'ERR' : String(row.response.status);
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
