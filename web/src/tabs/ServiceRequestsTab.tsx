import {memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {RequestDetail} from '../components/RequestDetail.tsx';
import {downloadText, timestampForFile, toHar, toJsonExport} from '../lib/exporters.ts';
import {formatClock} from '../lib/format.ts';
import {
    displayHost,
    displayPath,
    formatBytes,
    formatDuration,
    fullUrl,
    METHODS,
    type RowStatus,
    rowStatus,
    statusLabel,
} from '../lib/requestFormat.ts';
import {type NetworkRow, useNetworkStore} from '../store/useNetworkStore.ts';

const STATUSES: {id: RowStatus; label: string}[] = [
    {id: 'success', label: 'Başarılı'},
    {id: 'error', label: 'Hata'},
    {id: 'pending', label: 'Bekleyen'},
];

const STICK_THRESHOLD_PX = 40;

const RequestRow = memo(function RequestRow({row, selected}: {row: NetworkRow; selected: boolean}) {
    const select = useNetworkStore((s) => s.select);
    const status = rowStatus(row);
    const request = row.request;

    return (
        <tr
            className={`req-row is-${status}${selected ? ' is-selected' : ''}`}
            onClick={() => select(row.uuid)}
            data-uuid={row.uuid}
            aria-selected={selected}
        >
            <td><span className={`status-pill is-${status}`}>{statusLabel(row)}</span></td>
            <td className="method">{request?.method ?? '—'}</td>
            <td className="req-path" title={request ? fullUrl(request) : row.uuid}>
                <span className="mono">{request ? displayPath(request) : '(istek bilgisi yok)'}</span>
                {request && <span className="req-host">{displayHost(request)}</span>}
            </td>
            <td className="num">{formatDuration(row.response?.durationMs)}</td>
            <td className="num">{formatBytes(row.responseSize)}</td>
            <td className="num muted">{request?.startedAt ? formatClock(request.startedAt) : '—'}</td>
        </tr>
    );
});

export function ServiceRequestsTab() {
    const rows = useNetworkStore((s) => s.rows);
    const selectedUuid = useNetworkStore((s) => s.selectedUuid);
    const paused = useNetworkStore((s) => s.paused);
    const pausedCount = useNetworkStore((s) => s.pausedBuffer.length);
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
                return (row.request ? fullUrl(row.request) : row.uuid).toLowerCase().includes(deferredQuery);
            }),
        [rows, statuses, method, deferredQuery],
    );

    const selectedRow = useMemo(() => rows.find((r) => r.uuid === selectedUuid) ?? null, [rows, selectedUuid]);

    useLayoutEffect(() => {
        const el = listRef.current;
        if (autoScroll && el) el.scrollTop = el.scrollHeight;
    }, [visible, autoScroll]);

    // Klavye: ↑/↓ seçimi gezdirir, Esc detayı kapatır, Cmd/Ctrl+F aramaya odaklanır.
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
                select(null);
                return;
            }
            if (e.key === 'p' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const state = useNetworkStore.getState();
                state.setPaused(!state.paused);
                return;
            }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const idx = visible.findIndex((r) => r.uuid === useNetworkStore.getState().selectedUuid);
            const nextIdx = idx < 0 ? (e.key === 'ArrowDown' ? 0 : visible.length - 1) : idx + (e.key === 'ArrowDown' ? 1 : -1);
            const next = visible[Math.max(0, Math.min(visible.length - 1, nextIdx))];
            if (!next) return;
            select(next.uuid);
            setAutoScroll(false);
            listRef.current?.querySelector(`[data-uuid="${CSS.escape(next.uuid)}"]`)?.scrollIntoView({block: 'nearest'});
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [visible, select]);

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
                    placeholder="URL'de ara…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <select className="input select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method filtresi">
                    <option value="all">Tüm method'lar</option>
                    {METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                    ))}
                </select>
                <div className="chip-group" role="group" aria-label="Sonuç filtresi">
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
                <span className="toolbar-spacer"/>
                <button
                    className={`btn btn-small${paused ? ' is-active' : ''}`}
                    onClick={() => setPaused(!paused)}
                    title={paused ? 'Biriken istekleri uygula ve devam et' : 'Yeni istekleri listeye eklemeyi duraklat'}
                >
                    {paused ? `▶ Devam${pausedCount ? ` (${pausedCount})` : ''}` : '⏸ Duraklat'}
                </button>
                <details className="menu">
                    <summary className={`btn btn-small${visible.length === 0 ? ' is-disabled' : ''}`} title="Görünen (filtrelenmiş) istekleri indir">
                        ⤓ Dışa aktar
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
                            JSON <span className="muted small">ham istek + yanıt</span>
                        </button>
                    </div>
                </details>
                <button className="btn btn-small" onClick={clear} disabled={rows.length === 0}>
                    Temizle
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
                                ? 'Henüz istek yok. Uygulamada gezindikçe istekler burada görünür; önceki istekler için Sync.'
                                : 'Filtreyle eşleşen istek yok.'}
                        </p>
                    ) : (
                        <table className="req-table">
                            <colgroup>
                                <col className="c-status"/>
                                <col className="c-method"/>
                                <col/>
                                <col className="c-num"/>
                                <col className="c-num"/>
                                <col className="c-time"/>
                            </colgroup>
                            <thead>
                                <tr>
                                    <th>Status</th>
                                    <th>Method</th>
                                    <th>URL</th>
                                    <th className="num">Süre</th>
                                    <th className="num">Boyut</th>
                                    <th className="num">Zaman</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((row) => (
                                    <RequestRow key={row.uuid} row={row} selected={row.uuid === selectedUuid}/>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {selectedRow && <RequestDetail row={selectedRow} onClose={() => select(null)}/>}
            </div>

            <footer className="statusbar">
                {visible.length} / {rows.length} istek
                {paused && <span className="statusbar-warn"> · Duraklatıldı{pausedCount ? `, ${pausedCount} olay bekliyor` : ''}</span>}
            </footer>
        </section>
    );
}
