import {memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {LogLevel} from '@himmetkaan/remote-devtools-protocol/v1';
import {formatClock, stringifyData} from '../lib/format.ts';
import {type LogEntry, type LogSource, useDevtoolsStore} from '../store/useDevtoolsStore.ts';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const SOURCES: {id: LogSource | 'all'; label: string}[] = [
    {id: 'all', label: 'Tüm kaynaklar'},
    {id: 'device', label: 'Cihaz'},
    {id: 'relay', label: 'Relay'},
    {id: 'web', label: 'Web'},
];

/** Kullanıcı listenin dibinden bu kadar yukarıdaysa otomatik kaydırma durur. */
const STICK_THRESHOLD_PX = 40;

const LogRow = memo(function LogRow({entry}: {entry: LogEntry}) {
    const [open, setOpen] = useState(false);
    const hasData = entry.data !== undefined && entry.data !== null;

    return (
        <li className={`log-row is-${entry.level}`}>
            <button
                className="log-line"
                onClick={() => hasData && setOpen((v) => !v)}
                aria-expanded={hasData ? open : undefined}
                disabled={!hasData}
            >
                <span className="log-caret">{hasData ? (open ? '▾' : '▸') : ''}</span>
                <time className="log-time">{formatClock(entry.ts)}</time>
                <span className={`log-level is-${entry.level}`}>{entry.level}</span>
                <span className={`log-source is-${entry.source}`}>{entry.source}</span>
                <span className="log-message">{entry.message}</span>
            </button>
            {open && hasData && <pre className="log-data">{stringifyData(entry.data)}</pre>}
        </li>
    );
});

export function LogsTab() {
    const logs = useDevtoolsStore((s) => s.logs);
    const clearLogs = useDevtoolsStore((s) => s.clearLogs);

    const [query, setQuery] = useState('');
    const [levels, setLevels] = useState<Set<LogLevel>>(() => new Set(LEVELS));
    const [source, setSource] = useState<LogSource | 'all'>('all');
    const [autoScroll, setAutoScroll] = useState(true);
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());

    const listRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const counts = useMemo(() => {
        const c: Record<LogLevel, number> = {debug: 0, info: 0, warn: 0, error: 0};
        for (const entry of logs) c[entry.level]++;
        return c;
    }, [logs]);

    const visible = useMemo(
        () =>
            logs.filter((entry) => {
                if (!levels.has(entry.level)) return false;
                if (source !== 'all' && entry.source !== source) return false;
                if (!deferredQuery) return true;
                if (entry.message.toLowerCase().includes(deferredQuery)) return true;
                return entry.data !== undefined && stringifyData(entry.data).toLowerCase().includes(deferredQuery);
            }),
        [logs, levels, source, deferredQuery],
    );

    useLayoutEffect(() => {
        const el = listRef.current;
        if (autoScroll && el) el.scrollTop = el.scrollHeight;
    }, [visible, autoScroll]);

    // Ctrl/Cmd+F → log araması (sayfa içi arama yerine).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                searchRef.current?.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const toggleLevel = (level: LogLevel) =>
        setLevels((prev) => {
            const next = new Set(prev);
            if (next.has(level)) next.delete(level);
            else next.add(level);
            return next;
        });

    return (
        <section className="logs">
            <div className="toolbar">
                <input
                    ref={searchRef}
                    className="input"
                    type="search"
                    placeholder="Loglarda ara (mesaj + veri)…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <div className="chip-group" role="group" aria-label="Seviye filtresi">
                    {LEVELS.map((level) => (
                        <button
                            key={level}
                            className={`chip is-${level}${levels.has(level) ? ' is-on' : ''}`}
                            aria-pressed={levels.has(level)}
                            onClick={() => toggleLevel(level)}
                        >
                            {level} <span className="chip-count">{counts[level]}</span>
                        </button>
                    ))}
                </div>
                <select className="input select" value={source} onChange={(e) => setSource(e.target.value as LogSource | 'all')}>
                    {SOURCES.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                </select>
                <span className="toolbar-spacer"/>
                <label className="toggle">
                    <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)}/>
                    Otomatik kaydır
                </label>
                <button className="btn btn-small" onClick={clearLogs} disabled={logs.length === 0}>
                    Temizle
                </button>
            </div>

            <div
                ref={listRef}
                className="log-list"
                onScroll={(e) => {
                    const el = e.currentTarget;
                    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
                    if (atBottom !== autoScroll) setAutoScroll(atBottom);
                }}
            >
                {visible.length === 0 ? (
                    <p className="empty">{logs.length === 0 ? 'Henüz log yok.' : 'Filtreyle eşleşen log yok.'}</p>
                ) : (
                    <ol>
                        {visible.map((entry) => (
                            <LogRow key={entry.id} entry={entry}/>
                        ))}
                    </ol>
                )}
            </div>

            <footer className="statusbar">
                {visible.length} / {logs.length} log
            </footer>
        </section>
    );
}
