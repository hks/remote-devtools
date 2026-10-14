import {type ReactNode, useState} from 'react';
import {JsonTree} from '../../components/JsonTree.tsx';
import {toCurl, toEntryJson} from '../../lib/exporters.ts';
import {copyText, formatClock, stringifyData} from '../../lib/format.ts';
import {formatBytes, formatDuration, rowStatus, statusLabel} from '../../lib/requestFormat.ts';
import type {NetworkRow} from '../../store/useNetworkStore.ts';

type DetailTab = 'summary' | 'request' | 'response';

function CopyButton({label, text}: {label: string; text: () => string}) {
    const [done, setDone] = useState(false);
    return (
        <button
            className="btn btn-small"
            onClick={async () => {
                setDone(await copyText(text()));
                setTimeout(() => setDone(false), 1200);
            }}
        >
            {done ? 'Copied ✓' : label}
        </button>
    );
}

function KeyValueTable({data}: {data: Record<string, unknown> | null | undefined}) {
    const entries = Object.entries(data ?? {});
    if (entries.length === 0) return <p className="muted small">None</p>;
    return (
        <table className="kv">
            <tbody>
                {entries.map(([key, value]) => (
                    <tr key={key}>
                        <th>{key}</th>
                        <td className="mono">{typeof value === 'string' ? value : stringifyData(value)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function Section({title, actions, children}: {title: string; actions?: ReactNode; children: ReactNode}) {
    return (
        <section className="detail-section">
            <header>
                <h3>{title}</h3>
                {actions}
            </header>
            {children}
        </section>
    );
}

function queryParams(url: string | undefined): Record<string, string> | null {
    if (!url) return null;
    try {
        const params: Record<string, string> = {};
        for (const [key, value] of new URL(url).searchParams) params[key] = key in params ? `${params[key]}, ${value}` : value;
        return params;
    } catch {
        return null;
    }
}

function isEmptyBody(body: unknown): boolean {
    return body === null || body === undefined || body === '' || (typeof body === 'object' && Object.keys(body).length === 0);
}

function Body({value, truncated}: {value: unknown; truncated?: {originalSize: number}}) {
    const notice = truncated && (
        <p className="callout callout-warn">The body was too large ({formatBytes(truncated.originalSize)}) and was truncated on the device.</p>
    );
    if (isEmptyBody(value)) return notice || <p className="muted small">Empty</p>;
    return (
        <>
            {notice}
            {typeof value === 'string' ? <pre className="code-block">{value}</pre> : <JsonTree value={value}/>}
        </>
    );
}

export function RequestDetail({row, onClose}: {row: NetworkRow; onClose: () => void}) {
    const [tab, setTab] = useState<DetailTab>('summary');
    const {request, response} = row;
    const status = rowStatus(row);

    return (
        <aside className="detail" aria-label="Request details">
            <header className="detail-head">
                <span className={`status-pill is-${status}`}>{statusLabel(row)}</span>
                <span className="method">{request?.method ?? '—'}</span>
                <span className="detail-url mono" title={request?.url ?? row.uuid}>
                    {request?.url ?? '(request details missing)'}
                </span>
                {request && <CopyButton label="cURL" text={() => toCurl(request)}/>}
                <CopyButton label="JSON" text={() => toEntryJson(row)}/>
                <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">✕</button>
            </header>

            <nav className="detail-tabs" role="tablist">
                {([['summary', 'Summary'], ['request', 'Request'], ['response', 'Response']] as const).map(([id, title]) => (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={tab === id}
                        className={`tab${tab === id ? ' is-active' : ''}`}
                        onClick={() => setTab(id)}
                    >
                        {title}
                    </button>
                ))}
            </nav>

            <div className="detail-body">
                {tab === 'summary' && (
                    <>
                        <Section title="General">
                            <KeyValueTable
                                data={{
                                    URL: request?.url ?? '—',
                                    Method: request?.method ?? '—',
                                    'HTTP status': response?.status ?? (response ? 'Network error' : 'Waiting'),
                                    Result: response ? (response.result === 'success' ? 'Success' : `Error — ${response.errorMessage ?? ''}`) : 'Waiting',
                                    Duration: formatDuration(response?.durationMs),
                                    'Response size': formatBytes(row.responseSize),
                                    Started: request?.startedAt ? formatClock(request.startedAt) : 'Unknown',
                                    Origin: row.origin === 'history' ? 'Buffered before the device connected' : 'Live',
                                    UUID: row.uuid,
                                }}
                            />
                        </Section>
                        <Section title="Request headers">
                            <KeyValueTable data={request?.headers}/>
                        </Section>
                        <Section title="Response headers">
                            <KeyValueTable data={response?.headers}/>
                        </Section>
                    </>
                )}

                {tab === 'request' && (
                    <>
                        <Section title="Query parameters">
                            <KeyValueTable data={queryParams(request?.url)}/>
                        </Section>
                        <Section
                            title="Body"
                            actions={!isEmptyBody(request?.body) && <CopyButton label="Copy" text={() => stringifyData(request?.body)}/>}
                        >
                            <Body value={request?.body}/>
                        </Section>
                    </>
                )}

                {tab === 'response' && (
                    response ? (
                        <Section
                            title="Body"
                            actions={!isEmptyBody(response.body) && <CopyButton label="Copy" text={() => stringifyData(response.body)}/>}
                        >
                            {response.errorMessage && (
                                <p className={`callout ${response.result === 'error' ? 'callout-err' : ''}`}>{response.errorMessage}</p>
                            )}
                            <Body value={response.body} truncated={response.bodyTruncated}/>
                        </Section>
                    ) : (
                        <p className="empty">Waiting for the response…</p>
                    )
                )}
            </div>
        </aside>
    );
}
