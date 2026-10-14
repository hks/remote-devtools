import {memo, useMemo, useState} from 'react';
import type {ActionDef, Block, PanelDef} from '@himmetkaan/remote-devtools-protocol';
import {FieldForm} from '../../components/FieldForm.tsx';
import {JsonTree} from '../../components/JsonTree.tsx';
import {type FormErrors, initialValues, toArgs} from '../../lib/fields.ts';
import {formatClock, stringifyData} from '../../lib/format.ts';
import {relayClient} from '../../lib/relayClient.ts';
import {useUnavailable} from '../../lib/useUnavailable.ts';
import {useDevtoolsStore} from '../../store/useDevtoolsStore.ts';

type BlockOf<T extends Block['type']> = Extract<Block, {type: T}>;

type Run = {ok: boolean; label: string; text: string | null; at: number; durationMs: number};

type BlockProps<T extends Block['type']> = {
    deviceId: string;
    panel: PanelDef;
    block: BlockOf<T>;
    unavailable: string | null;
};

/** Tables with more rows than this get a search box. */
const TABLE_FILTER_FROM = 8;
const TABLE_PAGE = 200;

function cellText(value: unknown): string {
    if (value === null || value === undefined) return '—';
    return typeof value === 'object' ? stringifyData(value) : String(value);
}

/** Runs the action on the device, writes the result to Logs and returns it for the block's status line. */
function useAction(deviceId: string, panel: PanelDef, blockId: string) {
    const [running, setRunning] = useState<string | null>(null);
    const [lastRun, setLastRun] = useState<Run | null>(null);

    const run = async (action: Pick<ActionDef, 'id' | 'label' | 'confirm'>, extra: {row?: unknown; values?: Record<string, unknown>} = {}) => {
        if (action.confirm && !confirm(action.confirm)) return;
        setRunning(action.id);
        const startedAt = Date.now();
        const outcome = await relayClient.request('module.panels.action', {panelId: panel.id, blockId, actionId: action.id, ...extra}, deviceId);
        const durationMs = Date.now() - startedAt;
        setRunning(null);
        const hasResult = outcome.ok && outcome.result !== null && outcome.result !== undefined;
        setLastRun({
            ok: outcome.ok,
            label: action.label,
            text: outcome.ok ? (hasResult ? stringifyData(outcome.result) : null) : outcome.error.message,
            at: Date.now(),
            durationMs,
        });
        useDevtoolsStore.getState().addLog(
            outcome.ok
                ? {level: 'info', source: 'ui', message: `${panel.title}: ${action.label} (${durationMs} ms)`, data: hasResult ? outcome.result : undefined, deviceId}
                : {level: 'error', source: 'ui', message: `${panel.title}: ${action.label} failed — ${outcome.error.message}`, data: outcome.error, deviceId},
        );
        return outcome;
    };

    return {running, lastRun, run};
}

function RunStatus({lastRun}: {lastRun: Run | null}) {
    if (!lastRun) return null;
    return (
        <div className="cmd-status" title={lastRun.text ?? undefined}>
            <span className={lastRun.ok ? 'ok' : 'err'}>
                {lastRun.ok ? '✓' : '✗'} {lastRun.label} · {formatClock(lastRun.at).slice(0, 8)} · {lastRun.durationMs} ms
                {lastRun.text ? ` · ${lastRun.text}` : ''}
            </span>
        </div>
    );
}

function TextBlock({block}: BlockProps<'text'>) {
    return <p className={`panel-text${block.tone ? ` is-${block.tone}` : ''}`}>{block.text}</p>;
}

function StatsBlock({block}: BlockProps<'stats'>) {
    return (
        <div className="stat-grid">
            {block.items.map((item, i) => (
                <div key={`${item.label}:${i}`} className={`stat${item.tone ? ` is-${item.tone}` : ''}`}>
                    <span className="stat-label">{item.label}</span>
                    <span className="stat-value">{item.value}</span>
                    {item.hint && <span className="stat-hint">{item.hint}</span>}
                </div>
            ))}
        </div>
    );
}

function KeyValueBlock({block}: BlockProps<'keyValue'>) {
    const entries = Object.entries(block.data);
    if (entries.length === 0) return <p className="muted small">No values.</p>;
    return (
        <table className="kv">
            <tbody>
                {entries.map(([key, value]) => (
                    <tr key={key}>
                        <th>{key}</th>
                        <td className="mono">{cellText(value)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function JsonBlock({block}: BlockProps<'json'>) {
    return <JsonTree value={block.data} defaultExpandDepth={2}/>;
}

function ActionsBlock({deviceId, panel, block, unavailable}: BlockProps<'actions'>) {
    const {running, lastRun, run} = useAction(deviceId, panel, block.id);
    return (
        <>
            <div className="panel-actions">
                {block.actions.map((action) => (
                    <button
                        key={action.id}
                        className={`btn btn-small ${action.danger ? 'btn-danger' : ''}`}
                        disabled={Boolean(unavailable) || running !== null}
                        title={unavailable ?? undefined}
                        onClick={() => void run(action)}
                    >
                        {running === action.id && <span className="spin">⟳</span>} {action.label}
                    </button>
                ))}
            </div>
            <RunStatus lastRun={lastRun}/>
        </>
    );
}

function TableBlock({deviceId, panel, block, unavailable}: BlockProps<'table'>) {
    const {running, lastRun, run} = useAction(deviceId, panel, block.id);
    const [query, setQuery] = useState('');
    const [visibleCount, setVisibleCount] = useState(TABLE_PAGE);
    const rowActions = block.rowActions ?? [];
    const q = query.trim().toLowerCase();
    const rows = useMemo(
        () => (q ? block.rows.filter((row) => block.columns.some((c) => cellText(row[c.key]).toLowerCase().includes(q))) : block.rows),
        [block.rows, block.columns, q],
    );

    return (
        <>
            {block.rows.length >= TABLE_FILTER_FROM && (
                <input className="input panel-filter" type="search" placeholder="Filter rows…" value={query} onChange={(e) => setQuery(e.target.value)}/>
            )}
            {rows.length === 0 ? (
                <p className="muted small">{block.rows.length === 0 ? 'No rows.' : 'No rows match the filter.'}</p>
            ) : (
                <div className="panel-table-wrap">
                    <table className="req-table panel-table">
                        <thead>
                            <tr>
                                {block.columns.map((c) => <th key={c.key}>{c.title}</th>)}
                                {rowActions.length > 0 && <th className="panel-row-actions"/>}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.slice(0, visibleCount).map((row, i) => (
                                <tr key={i}>
                                    {block.columns.map((c) => (
                                        <td key={c.key} title={cellText(row[c.key])}>{cellText(row[c.key])}</td>
                                    ))}
                                    {rowActions.length > 0 && (
                                        <td className="panel-row-actions">
                                            <div className="panel-row-buttons">
                                            {rowActions.map((action) => (
                                                <button
                                                    key={action.id}
                                                    className={`btn btn-small ${action.danger ? 'btn-danger' : ''}`}
                                                    disabled={Boolean(unavailable) || running !== null}
                                                    title={unavailable ?? undefined}
                                                    onClick={() => void run(action, {row})}
                                                >
                                                    {action.label}
                                                </button>
                                            ))}
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {rows.length > visibleCount && (
                <button className="jt-more" onClick={() => setVisibleCount((n) => n + TABLE_PAGE)}>… show {rows.length - visibleCount} more</button>
            )}
            <RunStatus lastRun={lastRun}/>
        </>
    );
}

function FormBlock({deviceId, panel, block, unavailable}: BlockProps<'form'>) {
    const {running, lastRun, run} = useAction(deviceId, panel, block.id);
    const [values, setValues] = useState(() => initialValues(block.fields));
    const [errors, setErrors] = useState<FormErrors>({});

    const submit = () => {
        const {args, errors: nextErrors} = toArgs(block.fields, values);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;
        void run({id: block.submit.actionId, label: block.submit.label}, {values: args});
    };

    return (
        <form
            className="panel-form"
            onSubmit={(e) => {
                e.preventDefault();
                submit();
            }}
        >
            <FieldForm fields={block.fields} values={values} errors={errors} disabled={Boolean(unavailable)} onChange={setValues} idPrefix={`panel-${panel.id}-${block.id}`}/>
            <div className="cmd-actions">
                <button type="submit" className={`btn btn-small ${block.submit.danger ? 'btn-danger' : 'btn-primary'}`} disabled={Boolean(unavailable) || running !== null} title={unavailable ?? undefined}>
                    {running && <span className="spin">⟳</span>} {block.submit.label}
                </button>
            </div>
            <RunStatus lastRun={lastRun}/>
        </form>
    );
}

const PanelBlock = memo(function PanelBlock(props: BlockProps<Block['type']>) {
    const {block} = props;
    let content;
    switch (block.type) {
        case 'text':
            content = <TextBlock {...(props as BlockProps<'text'>)}/>;
            break;
        case 'stats':
            content = <StatsBlock {...(props as BlockProps<'stats'>)}/>;
            break;
        case 'keyValue':
            content = <KeyValueBlock {...(props as BlockProps<'keyValue'>)}/>;
            break;
        case 'json':
            content = <JsonBlock {...(props as BlockProps<'json'>)}/>;
            break;
        case 'actions':
            content = <ActionsBlock {...(props as BlockProps<'actions'>)}/>;
            break;
        case 'table':
            content = <TableBlock {...(props as BlockProps<'table'>)}/>;
            break;
        case 'form':
            // Form is rebuilt when the fields change.
            content = <FormBlock key={JSON.stringify(block.fields)} {...(props as BlockProps<'form'>)}/>;
            break;
        default:
            content = <p className="muted small">Unsupported block type “{(block as {type: string}).type}” — update Remote DevTools.</p>;
    }
    return (
        <section className={`panel-block is-${block.type}`}>
            {block.title && <h2>{block.title}</h2>}
            {content}
        </section>
    );
});

export function PanelTab({deviceId, panelId}: {deviceId: string; panelId?: string}) {
    const panel = useDevtoolsStore((s) => (s.devices[deviceId]?.hello?.capabilities.panels as PanelDef[] | undefined)?.find((p) => p.id === panelId));
    const unavailable = useUnavailable(deviceId);

    if (!panel) return <p className="empty">This panel is no longer available.</p>;

    return (
        <section className="panel-view">
            <div className="panel-body">
                {panel.blocks.map((block) => (
                    <PanelBlock key={`${block.id}:${block.type}`} deviceId={deviceId} panel={panel} block={block} unavailable={unavailable}/>
                ))}
                {panel.blocks.length === 0 && <p className="empty">This panel has no content yet.</p>}
            </div>
            {unavailable && <footer className="statusbar">{unavailable} — showing the last known content</footer>}
        </section>
    );
}
