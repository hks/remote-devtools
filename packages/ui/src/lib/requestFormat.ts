import type {NetworkRequest} from '@himmetkaan/remote-devtools-protocol';
import type {NetworkRow} from '../store/useNetworkStore.ts';

/** Short path shown in the list: path + query without the host. */
export function displayPath(request: NetworkRequest): string {
    try {
        const parsed = new URL(request.url);
        return parsed.pathname + parsed.search;
    } catch {
        return request.url;
    }
}

export function displayHost(request: NetworkRequest): string {
    try {
        return new URL(request.url).host;
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

/** Status column: HTTP code; "ERR" on network errors. */
export function statusLabel(row: NetworkRow): string {
    if (!row.response) return '…';
    return row.response.status === null ? 'ERR' : String(row.response.status);
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
