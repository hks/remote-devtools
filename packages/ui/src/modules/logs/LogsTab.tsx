import type {LogLevel} from '@himmetkaan/remote-devtools-protocol';
import {memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {formatClock, stringifyData} from '../../lib/format.ts';
import {type LogEntry, type LogSource, useDevtoolsStore} from '../../store/useDevtoolsStore.ts';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const SOURCES: {id: LogSource | 'all'; label: string}[] = [
    {id: 'all', label: 'All sources'},
    {id: 'device', label: 'Device'},
    {id: 'relay', label: 'Relay'},
    {id: 'ui', label: 'UI'},
];

/** Auto-scroll stops when the user is this far above the bottom of the list. */
const STICK_THRESHOLD_PX = 40;

const LogRow = memo(function LogRow({entry}: {entry: LogEntry}) {
    const [open, setOpen] = useState(false);
    const hasData = entry.data !== undefined && entry.data !== null;

    return (
        <li className={`log-row is-${entry.level}${entry.historic ? ' is-historic' : ''}`}>
            <button
                className="log-line"
                onClick={() => hasData && setOpen((v) => !v)}
                aria-expanded={hasData ? open : undefined}
                disabled={!hasData}
                title={entry.historic ? 'Buffered on the device before it connected' : undefined}
            >
                <span className="log-caret">{hasData ? (open ? '▾' : '▸') : ''}</span>
                <time className="log-time">{formatClock(entry.ts)}</time>
                <span className={`log-level is-${entry.level}`}>{entry.level}</span>
                <span className={`log-source is-${entry.source}`}>{entry.source}</span>
                <span className="log-message">
                    {entry.tag && <span className="log-tag">{entry.tag}</span>}
                    {entry.message}
                </span>
            </button>
            {open && hasData && <pre className="log-data">{stringifyData(entry.data)}</pre>}
        </li>
    );
});

/** Core module: present on every device. Logs of the selected device + (optionally) session-wide events. */
export function LogsTab({deviceId}: {deviceId: string}) {
    const allLogs = useDevtoolsStore((s) => s.logs);
    const clearLogs = useDevtoolsStore((s) => s.clearLogs);

    const [query, setQuery] = useState('');
    const [levels, setLevels] = useState<Set<LogLevel>>(() => new Set(LEVELS));
    const [source, setSource] = useState<LogSource | 'all'>('all');
    const [tag, setTag] = useState<string>('all');
    const [showSession, setShowSession] = useState(true);
    const [autoScroll, setAutoScroll] = useState(true);
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());

    const listRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const logs = useMemo(
        () => allLogs.filter((l) => l.deviceId === deviceId || (showSession && l.deviceId === null)),
        [allLogs, deviceId, showSession],
    );

    const counts = useMemo(() => {
        const c: Record<LogLevel, number> = {debug: 0, info: 0, warn: 0, error: 0};
        for (const entry of logs) c[entry.level]++;
        return c;
    }, [logs]);

    const tags = useMemo(() => [...new Set(logs.map((l) => l.tag).filter((t): t is string => Boolean(t)))].sort(), [logs]);

    const visible = useMemo(
        () =>
            logs.filter((entry) => {
                if (!levels.has(entry.level)) return false;
                if (source !== 'all' && entry.source !== source) return false;
                if (tag !== 'all' && entry.tag !== tag) return false;
                if (!deferredQuery) return true;
                if (entry.message.toLowerCase().includes(deferredQuery)) return true;
                if (entry.tag?.toLowerCase().includes(deferredQuery)) return true;
                return entry.data !== undefined && stringifyData(entry.data).toLowerCase().includes(deferredQuery);
            }),
        [logs, levels, source, tag, deferredQuery],
    );

    useLayoutEffect(() => {
        const el = listRef.current;
        if (autoScroll && el) el.scrollTop = el.scrollHeight;
    }, [visible, autoScroll]);

    // Ctrl/Cmd+F → log search (instead of in-page find).
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
                    placeholder="Search logs (message, tag, data)…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <div className="chip-group" role="group" aria-label="Level filter">
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
                <select
                    className="input select"
                    value={source}
                    onChange={(e) => setSource(e.target.value as LogSource | 'all')}
                    aria-label="Source filter"
                >
                    {SOURCES.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.label}
                        </option>
                    ))}
                </select>
                {tags.length > 0 && (
                    <select className="input select" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag filter">
                        <option value="all">All tags</option>
                        {tags.map((t) => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                )}
                <span className="toolbar-spacer" />
                <label className="toggle" title="Relay and UI events that are not tied to a device">
                    <input type="checkbox" checked={showSession} onChange={(e) => setShowSession(e.target.checked)} />
                    Session events
                </label>
                <label className="toggle">
                    <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
                    Auto-scroll
                </label>
                <button className="btn btn-small" onClick={() => clearLogs(deviceId)} disabled={logs.length === 0}>
                    Clear
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
                    <p className="empty">{logs.length === 0 ? 'No logs yet.' : 'No logs match the filters.'}</p>
                ) : (
                    <ol>
                        {visible.map((entry) => (
                            <LogRow key={entry.id} entry={entry} />
                        ))}
                    </ol>
                )}
            </div>

            <footer className="statusbar">
                {visible.length} / {logs.length} logs
            </footer>
        </section>
    );
}
