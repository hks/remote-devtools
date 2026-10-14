import {memo, useEffect, useState} from 'react';
import {STATE_SUBSCRIPTION_TTL_MS} from '@himmetkaan/remote-devtools-protocol';
import {JsonTree} from '../../components/JsonTree.tsx';
import {formatClock} from '../../lib/format.ts';
import {relayClient} from '../../lib/relayClient.ts';
import {useUnavailable} from '../../lib/useUnavailable.ts';
import {useDevtoolsStore} from '../../store/useDevtoolsStore.ts';
import {type ChangeLine, EMPTY_VIEW, stateKey, type TimelineEntry, useStateStore} from '../../store/useStateStore.ts';

type StoreInfo = {id: string; title: string};

const NO_STORES: StoreInfo[] = [];
/** Renew before expiry (the device drops subscriptions not renewed within `STATE_SUBSCRIPTION_TTL_MS`). */
const RENEW_MS = STATE_SUBSCRIPTION_TTL_MS / 3;
const INLINE_LINES = 6;
const MAX_VALUE_CHARS = 140;

function compact(value: unknown): string {
    if (value === undefined) return '—';
    let text: string;
    try {
        text = JSON.stringify(value) ?? String(value);
    } catch {
        text = String(value);
    }
    return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
}

function Line({line}: {line: ChangeLine}) {
    return (
        <li className={`change-line is-${line.op}`}>
            <code className="change-path">{line.path || '(root)'}</code>
            {line.op === 'add' ? (
                <span className="change-to">{compact(line.to)}</span>
            ) : line.op === 'remove' ? (
                <span className="change-from">{compact(line.from)}</span>
            ) : (
                <>
                    <span className="change-from">{compact(line.from)}</span>
                    <span className="muted">→</span>
                    <span className="change-to">{compact(line.to)}</span>
                </>
            )}
        </li>
    );
}

const Entry = memo(function Entry({entry}: {entry: TimelineEntry}) {
    const [expanded, setExpanded] = useState(false);
    const lines = expanded ? entry.changes : entry.changes.slice(0, INLINE_LINES);
    const hidden = entry.total - lines.length;
    const label = entry.actions.length
        ? entry.actions.join(', ')
        : entry.kind === 'resync'
          ? 'Changes while not watching'
          : entry.kind === 'full'
            ? 'Large change (full state)'
            : 'State changed';

    return (
        <li className="timeline-entry">
            <header>
                <span className="muted mono">{formatClock(entry.at).slice(0, 12)}</span>
                <span className={`timeline-label${entry.actions.length ? ' is-action' : ''}`} title={label}>{label}</span>
                <span className="muted small">{entry.total} change(s)</span>
            </header>
            <ul className="change-lines">
                {lines.map((line, i) => <Line key={i} line={line}/>)}
            </ul>
            {hidden > 0 && (
                <button className="jt-more" onClick={() => setExpanded((v) => !v)}>
                    {expanded ? 'Show less' : `… ${hidden} more`}
                </button>
            )}
        </li>
    );
});

export function StateTab({deviceId}: {deviceId: string}) {
    const stores = useDevtoolsStore((s) => (s.devices[deviceId]?.hello?.capabilities.state?.stores as StoreInfo[] | undefined) ?? NO_STORES);
    const unavailable = useUnavailable(deviceId);
    const [storeId, setStoreId] = useState<string | null>(null);
    const store = stores.find((s) => s.id === storeId) ?? stores[0] ?? null;
    const key = store ? stateKey(deviceId, store.id) : '';
    const view = useStateStore((s) => s.views[key] ?? EMPTY_VIEW);
    const [error, setError] = useState<string | null>(null);
    const [refreshToken, setRefreshToken] = useState(0);
    const activeId = store?.id ?? null;

    // If a patch couldn't be applied, resubscribe from scratch.
    useEffect(() => {
        if (view.stale) setRefreshToken((n) => n + 1);
    }, [view.stale]);

    // Subscribe while the tab is open (and the device connected); unsubscribe when it closes.
    useEffect(() => {
        if (!activeId || unavailable) return;
        let cancelled = false;
        const subscribe = async (renew: boolean) => {
            const outcome = await relayClient.request<{state?: unknown}>('module.state.subscribe', {storeId: activeId, renew}, deviceId);
            if (cancelled) return;
            if (!outcome.ok) {
                setError(outcome.error.message);
                return;
            }
            setError(null);
            // State in the renew response means the device dropped the subscription (e.g. the app restarted).
            if ('state' in outcome.result) useStateStore.getState().setSnapshot(stateKey(deviceId, activeId), outcome.result.state);
        };
        void subscribe(false);
        const timer = setInterval(() => void subscribe(true), RENEW_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
            void relayClient.request('module.state.unsubscribe', {storeId: activeId}, deviceId);
        };
    }, [deviceId, activeId, unavailable, refreshToken]);

    if (!store) return <p className="empty">The app has not registered any state stores.</p>;

    const timeline = view.timeline.slice().reverse();

    return (
        <section className="state">
            <div className="toolbar">
                {stores.length > 1 ? (
                    <div className="chip-group" role="group" aria-label="Store">
                        {stores.map((s) => (
                            <button key={s.id} className={`chip is-plain${s.id === store.id ? ' is-on' : ''}`} aria-pressed={s.id === store.id} onClick={() => setStoreId(s.id)}>
                                {s.title}
                            </button>
                        ))}
                    </div>
                ) : (
                    <strong>{store.title}</strong>
                )}
                <span className="toolbar-spacer"/>
                {!unavailable && view.loaded && <span className="badge is-online"><span className="dot"/>Live</span>}
                <button className="btn btn-small" disabled={Boolean(unavailable)} title={unavailable ?? 'Fetch the whole state again'} onClick={() => setRefreshToken((n) => n + 1)}>
                    ⟳ Refresh
                </button>
                <button className="btn btn-small" disabled={view.timeline.length === 0} onClick={() => useStateStore.getState().clearTimeline(key)}>
                    Clear changes
                </button>
            </div>

            <div className="state-body">
                <div className="state-tree">
                    {error ? (
                        <p className="empty">Could not read {store.title}: {error}</p>
                    ) : !view.loaded ? (
                        <p className="empty">{unavailable ?? 'Loading…'}</p>
                    ) : (
                        <JsonTree value={view.state} defaultExpandDepth={1}/>
                    )}
                </div>
                <aside className="state-timeline">
                    <h3>Changes</h3>
                    {timeline.length === 0 ? (
                        <p className="muted small">Changes show up here as the app updates the state.</p>
                    ) : (
                        <ol>
                            {timeline.map((entry) => <Entry key={entry.id} entry={entry}/>)}
                        </ol>
                    )}
                </aside>
            </div>

            <footer className="statusbar">
                {unavailable ? `${unavailable} — showing the last known state` : `${view.timeline.length} change(s) recorded`}
            </footer>
        </section>
    );
}
