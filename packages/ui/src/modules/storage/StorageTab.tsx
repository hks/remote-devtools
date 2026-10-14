import {type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react';
import type {ModuleResult, StorageAdapterInfo, StorageEntry} from '@himmetkaan/remote-devtools-protocol';
import {JsonTree} from '../../components/JsonTree.tsx';
import {formatBytes} from '../../lib/requestFormat.ts';
import {relayClient} from '../../lib/relayClient.ts';
import {useUnavailable} from '../../lib/useUnavailable.ts';
import {useDevtoolsStore} from '../../store/useDevtoolsStore.ts';

type Selection =
    | {mode: 'view'; key: string; value: string | null; loading: boolean}
    | {mode: 'edit'; key: string; draft: string}
    | {mode: 'new'; key: string; draft: string};

const NO_ADAPTERS: StorageAdapterInfo[] = [];

/** JSON nesne/dizi ise ağaç olarak gösterilir; değilse `undefined`. */
function parseJson(text: string): unknown {
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

function request<R>(deviceId: string, type: string, payload: unknown): Promise<ModuleResult<R>> {
    return relayClient.request<R>(type, payload, deviceId);
}

function logFailure(deviceId: string, action: string, outcome: ModuleResult) {
    if (outcome.ok) return;
    useDevtoolsStore.getState().addLog({level: 'error', source: 'ui', message: `Storage: ${action} failed — ${outcome.error.message}`, data: outcome.error, deviceId});
}

export function StorageTab({deviceId}: {deviceId: string}) {
    const adapters = useDevtoolsStore((s) => (s.devices[deviceId]?.hello?.capabilities.storage?.adapters as StorageAdapterInfo[] | undefined) ?? NO_ADAPTERS);
    const unavailable = useUnavailable(deviceId);
    const [adapterId, setAdapterId] = useState<string | null>(null);
    const adapter = adapters.find((a) => a.id === adapterId) ?? adapters[0] ?? null;
    const activeId = adapter?.id ?? null;

    const [entries, setEntries] = useState<StorageEntry[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [revealed, setRevealed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [query, setQuery] = useState('');
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());

    // Asenkron cevaplar geldiğinde hâlâ aynı depoya bakılıyor mu?
    const currentAdapter = useRef<string | null>(null);
    currentAdapter.current = adapter?.id ?? null;
    const selectionRef = useRef(selection);
    selectionRef.current = selection;

    const loadList = useCallback(async () => {
        if (!activeId || unavailable) return;
        const id = activeId;
        setLoading(true);
        const outcome = await request<{entries: StorageEntry[]}>(deviceId, 'module.storage.list', {adapterId: id});
        if (currentAdapter.current !== id) return;
        setLoading(false);
        if (outcome.ok) {
            setEntries(outcome.result.entries);
            setError(null);
        } else {
            setError(outcome.error.message);
        }
    }, [deviceId, activeId, unavailable]);

    const loadValue = useCallback(
        async (key: string) => {
            if (!activeId) return;
            const id = activeId;
            setSelection({mode: 'view', key, value: null, loading: true});
            const outcome = await request<{value: string | null}>(deviceId, 'module.storage.get', {adapterId: id, key});
            const current = selectionRef.current;
            if (currentAdapter.current !== id || current?.key !== key || current.mode !== 'view') return;
            if (!outcome.ok) logFailure(deviceId, `reading "${key}"`, outcome);
            setSelection({mode: 'view', key, value: outcome.ok ? outcome.result.value : null, loading: false});
        },
        [deviceId, activeId],
    );

    // Depo değişince (veya cihaz yeniden bağlanınca) listeyi yeniden al.
    useEffect(() => {
        setEntries(null);
        setSelection(null);
        setRevealed(false);
        void loadList();
    }, [loadList]);

    // Cihazın bildirdiği değişiklikler: listeyi (kısa bir gecikmeyle, toplu) ve açık değeri yenile.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = relayClient.subscribe((msg) => {
            if (msg.type !== 'module.storage.changed' || msg.deviceId !== deviceId) return;
            const {adapterId: changedAdapter, key} = msg.payload as {adapterId: string; key: string | null};
            if (changedAdapter !== currentAdapter.current) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void loadList(), 250);
            const current = selectionRef.current;
            if (current?.mode === 'view' && (key === null || key === current.key)) void loadValue(current.key);
        });
        return () => {
            unsubscribe();
            if (timer) clearTimeout(timer);
        };
    }, [deviceId, loadList, loadValue]);

    const visible = useMemo(() => {
        if (!entries) return [];
        if (!deferredQuery) return entries;
        return entries.filter((e) => e.key.toLowerCase().includes(deferredQuery) || e.preview.toLowerCase().includes(deferredQuery));
    }, [entries, deferredQuery]);

    const totalSize = useMemo(() => entries?.reduce((sum, e) => sum + e.size, 0) ?? 0, [entries]);

    if (!adapter) return <p className="empty">The app has not registered any storage.</p>;

    const editable = adapter.editable && !unavailable;

    const save = async (key: string, value: string) => {
        if (!key) return;
        setBusy(true);
        const outcome = await request(deviceId, 'module.storage.set', {adapterId: adapter.id, key, value});
        setBusy(false);
        logFailure(deviceId, `saving "${key}"`, outcome);
        if (!outcome.ok) return;
        useDevtoolsStore.getState().addLog({level: 'info', source: 'ui', message: `Storage: saved "${key}" in ${adapter.title}`, deviceId});
        setSelection({mode: 'view', key, value, loading: false});
        void loadList();
    };

    const remove = async (key: string) => {
        if (!confirm(`Delete "${key}" from ${adapter.title}?`)) return;
        setBusy(true);
        const outcome = await request(deviceId, 'module.storage.remove', {adapterId: adapter.id, key});
        setBusy(false);
        logFailure(deviceId, `deleting "${key}"`, outcome);
        if (!outcome.ok) return;
        useDevtoolsStore.getState().addLog({level: 'info', source: 'ui', message: `Storage: deleted "${key}" from ${adapter.title}`, deviceId});
        setSelection(null);
        void loadList();
    };

    const clearAll = async () => {
        if (!confirm(`Delete all ${entries?.length ?? 0} key(s) from ${adapter.title}? This cannot be undone.`)) return;
        setBusy(true);
        const outcome = await request(deviceId, 'module.storage.clear', {adapterId: adapter.id});
        setBusy(false);
        logFailure(deviceId, 'clearing', outcome);
        if (!outcome.ok) return;
        useDevtoolsStore.getState().addLog({level: 'warn', source: 'ui', message: `Storage: cleared ${adapter.title}`, deviceId});
        setSelection(null);
        void loadList();
    };

    return (
        <section className={`storage${selection ? ' has-detail' : ''}`}>
            <div className="toolbar">
                {adapters.length > 1 && (
                    <div className="chip-group" role="group" aria-label="Storage">
                        {adapters.map((a) => (
                            <button key={a.id} className={`chip is-plain${a.id === adapter.id ? ' is-on' : ''}`} aria-pressed={a.id === adapter.id} onClick={() => setAdapterId(a.id)}>
                                {a.title}
                            </button>
                        ))}
                    </div>
                )}
                <input className="input" type="search" placeholder="Filter keys and values…" value={query} onChange={(e) => setQuery(e.target.value)}/>
                <span className="toolbar-spacer"/>
                {!adapter.editable && <span className="badge">Read-only</span>}
                <button className="btn btn-small" onClick={() => void loadList()} disabled={Boolean(unavailable) || loading} title={unavailable ?? 'Reload the keys'}>
                    {loading ? <span className="spin">⟳</span> : '⟳'} Refresh
                </button>
                {adapter.editable && (
                    <>
                        <button className="btn btn-small" disabled={!editable} title={unavailable ?? 'Add a new key'} onClick={() => setSelection({mode: 'new', key: '', draft: ''})}>
                            ＋ Add
                        </button>
                        <button className="btn btn-small btn-danger" disabled={!editable || busy || !entries?.length} title={unavailable ?? 'Delete every key'} onClick={() => void clearAll()}>
                            Clear all
                        </button>
                    </>
                )}
            </div>

            <div className="split-body">
                <div className="req-list">
                    {error ? (
                        <p className="empty">Could not read {adapter.title}: {error}</p>
                    ) : entries === null ? (
                        <p className="empty">{unavailable ?? 'Loading…'}</p>
                    ) : visible.length === 0 ? (
                        <p className="empty">{entries.length === 0 ? `${adapter.title} is empty.` : 'No keys match the filter.'}</p>
                    ) : (
                        <table className="req-table">
                            <colgroup>
                                <col className="c-key"/>
                                <col className="c-num"/>
                                <col/>
                            </colgroup>
                            <thead>
                                <tr>
                                    <th>Key</th>
                                    <th className="num">Size</th>
                                    <th>Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((entry) => (
                                    <tr
                                        key={entry.key}
                                        className={`req-row${selection?.key === entry.key && selection.mode !== 'new' ? ' is-selected' : ''}`}
                                        onClick={() => {
                                            setRevealed(false);
                                            void loadValue(entry.key);
                                        }}
                                    >
                                        <td className="mono" title={entry.key}>{entry.key}</td>
                                        <td className="num">{formatBytes(entry.size)}</td>
                                        <td className="mono muted" title={adapter.masked ? undefined : entry.preview}>{adapter.masked ? '••••••••' : entry.preview}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {selection && (
                    <aside className="detail">
                        <header className="detail-head">
                            {selection.mode === 'new' ? (
                                <strong>New key</strong>
                            ) : (
                                <code className="detail-url" title={selection.key}>{selection.key}</code>
                            )}
                            <button className="icon-btn" onClick={() => setSelection(null)} aria-label="Close">✕</button>
                        </header>
                        <div className="detail-body">
                            {selection.mode === 'view' ? (
                                <ValueView
                                    selection={selection}
                                    masked={Boolean(adapter.masked) && !revealed}
                                    onReveal={() => setRevealed(true)}
                                    actions={
                                        <>
                                            {selection.value !== null && (
                                                <button className="btn btn-small" onClick={() => void navigator.clipboard?.writeText(selection.value ?? '')} disabled={Boolean(adapter.masked) && !revealed}>
                                                    Copy
                                                </button>
                                            )}
                                            {adapter.editable && (
                                                <>
                                                    <button className="btn btn-small" disabled={!editable || selection.loading} onClick={() => setSelection({mode: 'edit', key: selection.key, draft: selection.value ?? ''})}>
                                                        Edit
                                                    </button>
                                                    <button className="btn btn-small btn-danger" disabled={!editable || busy} onClick={() => void remove(selection.key)}>
                                                        Delete
                                                    </button>
                                                </>
                                            )}
                                        </>
                                    }
                                />
                            ) : (
                                <Editor
                                    selection={selection}
                                    busy={busy}
                                    disabled={!editable}
                                    onChange={setSelection}
                                    onCancel={() => (selection.mode === 'edit' ? void loadValue(selection.key) : setSelection(null))}
                                    onSave={() => void save(selection.key.trim(), selection.draft)}
                                    exists={selection.mode === 'new' && Boolean(entries?.some((e) => e.key === selection.key.trim()))}
                                />
                            )}
                        </div>
                    </aside>
                )}
            </div>

            <footer className="statusbar">
                {entries ? `${visible.length} / ${entries.length} keys · ${formatBytes(totalSize)}` : ' '}
            </footer>
        </section>
    );
}

function ValueView({selection, masked, onReveal, actions}: {selection: Extract<Selection, {mode: 'view'}>; masked: boolean; onReveal(): void; actions: ReactNode}) {
    const [raw, setRaw] = useState(false);
    const json = useMemo(() => (selection.value === null ? undefined : parseJson(selection.value)), [selection.value]);

    return (
        <section className="detail-section">
            <header>
                <h3>Value{selection.value !== null && ` · ${formatBytes(selection.value.length)}`}</h3>
                <div className="row-actions">
                    {json !== undefined && !masked && (
                        <button className="btn btn-small" onClick={() => setRaw((v) => !v)}>{raw ? 'Tree' : 'Raw'}</button>
                    )}
                    {actions}
                </div>
            </header>
            {selection.loading ? (
                <p className="muted">Loading…</p>
            ) : selection.value === null ? (
                <p className="muted">This key no longer exists.</p>
            ) : masked ? (
                <div className="masked">
                    <span className="mono">••••••••••••</span>
                    <button className="btn btn-small" onClick={onReveal}>Reveal</button>
                </div>
            ) : json !== undefined && !raw ? (
                <JsonTree value={json} defaultExpandDepth={2}/>
            ) : (
                <pre className="code-block">{selection.value}</pre>
            )}
        </section>
    );
}

function Editor({selection, busy, disabled, exists, onChange, onCancel, onSave}: {
    selection: Extract<Selection, {mode: 'edit' | 'new'}>;
    busy: boolean;
    disabled: boolean;
    exists: boolean;
    onChange(selection: Selection): void;
    onCancel(): void;
    onSave(): void;
}) {
    const json = parseJson(selection.draft);
    const looksJson = /^\s*[[{]/.test(selection.draft);
    return (
        <section className="detail-section storage-editor">
            {selection.mode === 'new' && (
                <div className="field">
                    <label className="field-label" htmlFor="storage-new-key">Key</label>
                    <input id="storage-new-key" className="input mono" autoFocus value={selection.key} onChange={(e) => onChange({...selection, key: e.target.value})}/>
                    {exists && <span className="field-error is-warn">This key exists and will be overwritten.</span>}
                </div>
            )}
            <div className="field">
                <label className="field-label" htmlFor="storage-value">Value</label>
                <textarea
                    id="storage-value"
                    className="input textarea mono"
                    rows={14}
                    spellCheck={false}
                    autoFocus={selection.mode === 'edit'}
                    value={selection.draft}
                    onChange={(e) => onChange({...selection, draft: e.target.value})}
                />
                {looksJson && json === undefined && <span className="field-error is-warn">Not valid JSON — it will be saved as plain text.</span>}
            </div>
            <div className="row-actions">
                {json !== undefined && (
                    <button className="btn btn-small" onClick={() => onChange({...selection, draft: JSON.stringify(json, null, 2)})}>Format JSON</button>
                )}
                <span className="toolbar-spacer"/>
                <button className="btn btn-small" onClick={onCancel}>Cancel</button>
                <button className="btn btn-small btn-primary" disabled={disabled || busy || !selection.key.trim()} onClick={onSave}>
                    {busy ? <span className="spin">⟳</span> : null} Save
                </button>
            </div>
        </section>
    );
}
