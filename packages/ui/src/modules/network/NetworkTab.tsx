import {memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {downloadText, timestampForFile, toHar, toJsonExport} from '../../lib/exporters.ts';
import {formatClock} from '../../lib/format.ts';
import {
    displayHost,
    displayPath,
    formatBytes,
    formatDuration,
    METHODS,
    type RowStatus,
    rowStatus,
    statusLabel,
} from '../../lib/requestFormat.ts';
import {type NetworkRow, useDeviceNetwork, useNetworkStore} from '../../store/useNetworkStore.ts';
import {RequestDetail} from './RequestDetail.tsx';

const STATUSES: {id: RowStatus; label: string}[] = [
    {id: 'success', label: 'Success'},
    {id: 'error', label: 'Error'},
    {id: 'pending', label: 'Pending'},
];

const STICK_THRESHOLD_PX = 40;

const RequestRow = memo(function RequestRow({deviceId, row, selected}: {deviceId: string; row: NetworkRow; selected: boolean}) {
    const status = rowStatus(row);
    const request = row.request;

    return (
        <tr
            className={`req-row is-${status}${selected ? ' is-selected' : ''}`}
            onClick={() => useNetworkStore.getState().select(deviceId, row.uuid)}
            data-uuid={row.uuid}
            aria-selected={selected}
        >
            <td>
                <span className={`status-pill is-${status}`}>{statusLabel(row)}</span>
            </td>
            <td className="method">{request?.method ?? '—'}</td>
            <td className="req-path" title={request?.url ?? row.uuid}>
                <span className="mono">{request ? displayPath(request) : '(request details missing)'}</span>
                {request && <span className="req-host">{displayHost(request)}</span>}
            </td>
            <td className="num">{formatDuration(row.response?.durationMs)}</td>
            <td className="num">{formatBytes(row.responseSize)}</td>
            <td className="num muted">{request?.startedAt ? formatClock(request.startedAt) : '—'}</td>
        </tr>
    );
});

export function NetworkTab({deviceId}: {deviceId: string}) {
    const rows = useDeviceNetwork(deviceId, (d) => d.rows);
    const selectedUuid = useDeviceNetwork(deviceId, (d) => d.selectedUuid);
    const paused = useDeviceNetwork(deviceId, (d) => d.paused);
    const pausedCount = useDeviceNetwork(deviceId, (d) => d.pausedBuffer.length);
    const {select, setPaused, clear} = useNetworkStore.getState();

    const [query, setQuery] = useState('');
    const [method, setMethod] = useState<string>('all');
    const [statuses, setStatuses] = useState<Set<RowStatus>>(() => new Set(STATUSES.map((s) => s.id)));
    const [autoScroll, setAutoScroll] = useState(true);
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());

    const listRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const counts = useMemo(() => {
        const c: Record<RowStatus, number> = {success: 0, error: 0, pending: 0};
        for (const row of rows) c[rowStatus(row)]++;
        return c;
    }, [rows]);

    const visible = useMemo(
        () =>
            rows.filter((row) => {
                if (!statuses.has(rowStatus(row))) return false;
                if (method !== 'all' && row.request?.method !== method) return false;
                if (!deferredQuery) return true;
                return (row.request?.url ?? row.uuid).toLowerCase().includes(deferredQuery);
            }),
        [rows, statuses, method, deferredQuery],
    );

    const selectedRow = useMemo(() => rows.find((r) => r.uuid === selectedUuid) ?? null, [rows, selectedUuid]);

    useLayoutEffect(() => {
        const el = listRef.current;
        if (autoScroll && el) el.scrollTop = el.scrollHeight;
    }, [visible, autoScroll]);

    // Keyboard: ↑/↓ move the selection, Esc closes the detail, p pauses, Cmd/Ctrl+F focuses search.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                searchRef.current?.focus();
                return;
            }
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
            if (e.key === 'Escape') {
                select(deviceId, null);
                return;
            }
            if (e.key === 'p' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const state = useNetworkStore.getState().byDevice[deviceId];
                setPaused(deviceId, !state?.paused);
                return;
            }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const current = useNetworkStore.getState().byDevice[deviceId]?.selectedUuid;
            const idx = visible.findIndex((r) => r.uuid === current);
            const nextIdx = idx < 0 ? (e.key === 'ArrowDown' ? 0 : visible.length - 1) : idx + (e.key === 'ArrowDown' ? 1 : -1);
            const next = visible[Math.max(0, Math.min(visible.length - 1, nextIdx))];
            if (!next) return;
            select(deviceId, next.uuid);
            setAutoScroll(false);
            listRef.current?.querySelector(`[data-uuid="${CSS.escape(next.uuid)}"]`)?.scrollIntoView({block: 'nearest'});
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [visible, select, setPaused, deviceId]);

    const toggleStatus = (status: RowStatus) =>
        setStatuses((prev) => {
            const next = new Set(prev);
            if (next.has(status)) next.delete(status);
            else next.add(status);
            return next;
        });

    return (
        <section className={`network${selectedRow ? ' has-detail' : ''}`}>
            <div className="toolbar">
                <input
                    ref={searchRef}
                    className="input"
                    type="search"
                    placeholder="Filter by URL…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <select className="input select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method filter">
                    <option value="all">All methods</option>
                    {METHODS.map((m) => (
                        <option key={m} value={m}>
                            {m}
                        </option>
                    ))}
                </select>
                <div className="chip-group" role="group" aria-label="Result filter">
                    {STATUSES.map((s) => (
                        <button
                            key={s.id}
                            className={`chip is-${s.id}${statuses.has(s.id) ? ' is-on' : ''}`}
                            aria-pressed={statuses.has(s.id)}
                            onClick={() => toggleStatus(s.id)}
                        >
                            {s.label} <span className="chip-count">{counts[s.id]}</span>
                        </button>
                    ))}
                </div>
                <span className="toolbar-spacer" />
                <button
                    className={`btn btn-small${paused ? ' is-active' : ''}`}
                    onClick={() => setPaused(deviceId, !paused)}
                    title={paused ? 'Apply buffered requests and resume (p)' : 'Pause adding new requests to the list (p)'}
                >
                    {paused ? `▶ Resume${pausedCount ? ` (${pausedCount})` : ''}` : '⏸ Pause'}
                </button>
                <details className="menu">
                    <summary
                        className={`btn btn-small${visible.length === 0 ? ' is-disabled' : ''}`}
                        title="Download the visible (filtered) requests"
                    >
                        ⤓ Export
                    </summary>
                    <div className="menu-items" role="menu">
                        <button
                            role="menuitem"
                            disabled={visible.length === 0}
                            onClick={(e) => {
                                downloadText(`requests-${timestampForFile()}.har`, toHar(visible));
                                e.currentTarget.closest('details')?.removeAttribute('open');
                            }}
                        >
                            HAR <span className="muted small">Chrome DevTools, Charles, Proxyman</span>
                        </button>
                        <button
                            role="menuitem"
                            disabled={visible.length === 0}
                            onClick={(e) => {
                                downloadText(`requests-${timestampForFile()}.json`, toJsonExport(visible));
                                e.currentTarget.closest('details')?.removeAttribute('open');
                            }}
                        >
                            JSON <span className="muted small">raw request + response</span>
                        </button>
                    </div>
                </details>
                <button className="btn btn-small" onClick={() => clear(deviceId)} disabled={rows.length === 0}>
                    Clear
                </button>
            </div>

            <div className="network-body">
                <div
                    ref={listRef}
                    className="req-list"
                    onScroll={(e) => {
                        const el = e.currentTarget;
                        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
                        if (atBottom !== autoScroll) setAutoScroll(atBottom);
                    }}
                >
                    {visible.length === 0 ? (
                        <p className="empty">
                            {rows.length === 0
                                ? 'No requests yet. They show up here as the app makes them.'
                                : 'No requests match the filters.'}
                        </p>
                    ) : (
                        <table className="req-table">
                            <colgroup>
                                <col className="c-status" />
                                <col className="c-method" />
                                <col />
                                <col className="c-num" />
                                <col className="c-num" />
                                <col className="c-time" />
                            </colgroup>
                            <thead>
                                <tr>
                                    <th>Status</th>
                                    <th>Method</th>
                                    <th>URL</th>
                                    <th className="num">Time</th>
                                    <th className="num">Size</th>
                                    <th className="num">Started</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((row) => (
                                    <RequestRow key={row.uuid} deviceId={deviceId} row={row} selected={row.uuid === selectedUuid} />
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {selectedRow && <RequestDetail row={selectedRow} onClose={() => select(deviceId, null)} />}
            </div>

            <footer className="statusbar">
                {visible.length} / {rows.length} requests
                {paused && <span className="statusbar-warn"> · Paused{pausedCount ? `, ${pausedCount} event(s) waiting` : ''}</span>}
            </footer>
        </section>
    );
}
