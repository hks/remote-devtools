import {type ReactNode, useState} from 'react';
import {toCurl, toEntryJson} from '../lib/exporters.ts';
import {copyText, formatClock, stringifyData} from '../lib/format.ts';
import {formatBytes, formatDuration, fullUrl, rowStatus, statusLabel} from '../lib/requestFormat.ts';
import type {NetworkRow} from '../store/useNetworkStore.ts';
import {JsonTree} from './JsonTree.tsx';

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
            {done ? 'Kopyalandı ✓' : label}
        </button>
    );
}

function KeyValueTable({data}: {data: Record<string, unknown> | null | undefined}) {
    const entries = Object.entries(data ?? {});
    if (entries.length === 0) return <p className="muted small">Yok</p>;
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

function isEmptyBody(body: unknown): boolean {
    return body === null || body === undefined || body === '' || (typeof body === 'object' && Object.keys(body).length === 0);
}

function Body({value}: {value: unknown}) {
    if (isEmptyBody(value)) return <p className="muted small">Boş</p>;
    if (typeof value === 'string') return <pre className="code-block">{value}</pre>;
    const truncated = (value as {__truncated?: boolean}).__truncated;
    if (truncated) {
        const t = value as {sizeChars: number; preview: string};
        return (
            <>
                <p className="callout callout-warn">Gövde çok büyük ({formatBytes(t.sizeChars)}), telefonda kısaltıldı. İlk 5.000 karakter:</p>
                <pre className="code-block">{t.preview}</pre>
            </>
        );
    }
    return <JsonTree value={value}/>;
}

export function RequestDetail({row, onClose}: {row: NetworkRow; onClose: () => void}) {
    const [tab, setTab] = useState<DetailTab>('summary');
    const {request, response} = row;
    const status = rowStatus(row);

    return (
        <aside className="detail" aria-label="İstek detayı">
            <header className="detail-head">
                <span className={`status-pill is-${status}`}>{statusLabel(row)}</span>
                <span className="method">{request?.method ?? '—'}</span>
                <span className="detail-url mono" title={request ? fullUrl(request) : row.uuid}>
                    {request ? fullUrl(request) : '(istek bilgisi yok)'}
                </span>
                {request && <CopyButton label="cURL" text={() => toCurl(request)}/>}
                <CopyButton label="JSON" text={() => toEntryJson(row)}/>
                <button className="icon-btn" onClick={onClose} aria-label="Kapat" title="Kapat (Esc)">✕</button>
            </header>

            <nav className="detail-tabs" role="tablist">
                {([['summary', 'Özet'], ['request', 'İstek'], ['response', 'Yanıt']] as const).map(([id, title]) => (
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
                        <Section title="Genel">
                            <KeyValueTable
                                data={{
                                    URL: request ? fullUrl(request) : '—',
                                    Method: request?.method ?? '—',
                                    'HTTP status': response?.status ?? (response ? 'Ağ hatası' : 'Bekleniyor'),
                                    Sonuç: response ? (response.result === 'success' ? 'Başarılı' : `Hata — ${response.errorMessage ?? ''}`) : 'Bekleniyor',
                                    Süre: formatDuration(response?.durationMs),
                                    'Yanıt boyutu': formatBytes(row.responseSize),
                                    Başlangıç: request?.startedAt ? formatClock(request.startedAt) : 'Bilinmiyor',
                                    Kaynak: row.origin === 'sync' ? 'Sync (geçmiş)' : 'Canlı',
                                    UUID: row.uuid,
                                }}
                            />
                        </Section>
                        <Section title="İstek header'ları">
                            <KeyValueTable data={request?.headers}/>
                        </Section>
                        <Section title="Yanıt header'ları">
                            <KeyValueTable data={response?.headers}/>
                        </Section>
                    </>
                )}

                {tab === 'request' && (
                    <>
                        <Section title="Query parametreleri">
                            {isEmptyBody(request?.params) ? <p className="muted small">Yok</p> : <JsonTree value={request?.params}/>}
                        </Section>
                        <Section
                            title="Gövde"
                            actions={!isEmptyBody(request?.body) && <CopyButton label="JSON kopyala" text={() => stringifyData(request?.body)}/>}
                        >
                            <Body value={request?.body}/>
                        </Section>
                    </>
                )}

                {tab === 'response' && (
                    response ? (
                        <Section
                            title="Gövde"
                            actions={!isEmptyBody(response.body) && <CopyButton label="JSON kopyala" text={() => stringifyData(response.body)}/>}
                        >
                            {response.errorMessage && (
                                <p className={`callout ${response.result === 'error' ? 'callout-err' : ''}`}>{response.errorMessage}</p>
                            )}
                            <Body value={response.body}/>
                        </Section>
                    ) : (
                        <p className="empty">Yanıt bekleniyor…</p>
                    )
                )}
            </div>
        </aside>
    );
}
