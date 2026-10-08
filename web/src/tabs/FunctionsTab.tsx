import {memo, useMemo, useState} from 'react';
import {COMMAND_GROUPS, COMMANDS, type CommandDef} from '../lib/commands.ts';
import {formatClock, stringifyData} from '../lib/format.ts';
import {invokeCommand} from '../lib/invoke.ts';
import {useCommandsStore} from '../store/useCommandsStore.ts';
import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';

type Availability = {enabled: true} | {enabled: false; reason: string};

const CommandCard = memo(function CommandCard({command, availability}: {command: CommandDef; availability: Availability}) {
    const running = useCommandsStore((s) => Boolean(s.running[command.id]));
    const lastRun = useCommandsStore((s) => s.lastRun[command.id]);
    const [optionIndex, setOptionIndex] = useState(0);

    const run = () => {
        if (command.confirm && !confirm(command.confirm)) return;
        const args = command.options ? command.options[optionIndex]?.args ?? null : null;
        invokeCommand(command.id, args);
    };

    const disabled = !availability.enabled || running;
    const resultText = lastRun?.ok && lastRun.result !== null && lastRun.result !== undefined ? stringifyData(lastRun.result) : null;

    return (
        <article className={`cmd-card${command.danger ? ' is-danger' : ''}${availability.enabled ? '' : ' is-unavailable'}`}>
            <header className="cmd-head">
                <h3>{command.title}</h3>
                <code className="cmd-id">{command.id}</code>
            </header>
            <p className="cmd-desc">{command.description}</p>

            <div className="cmd-actions">
                {command.options && (
                    <select
                        className="input select"
                        value={optionIndex}
                        onChange={(e) => setOptionIndex(Number(e.target.value))}
                        disabled={!availability.enabled}
                        aria-label={`${command.title} seçeneği`}
                    >
                        {command.options.map((o, i) => (
                            <option key={o.label} value={i}>{o.label}</option>
                        ))}
                    </select>
                )}
                <button
                    className={`btn btn-small ${command.danger ? 'btn-danger' : 'btn-primary'}`}
                    onClick={run}
                    disabled={disabled}
                    title={availability.enabled ? undefined : availability.reason}
                >
                    {running ? <span className="spin">⟳</span> : '▶'} Çalıştır
                </button>
            </div>

            {/* Sabit yükseklik: sonuç gelince kart ve grid yeniden dizilmez. */}
            <div className="cmd-status" title={lastRun?.error ?? resultText ?? undefined}>
                {!availability.enabled ? (
                    <span className="muted">{availability.reason}</span>
                ) : running ? (
                    <span className="muted">Çalışıyor…</span>
                ) : lastRun ? (
                    <span className={lastRun.ok ? 'ok' : 'err'}>
                        {lastRun.ok ? '✓' : '✗'} {formatClock(lastRun.at).slice(0, 8)} · {lastRun.durationMs} ms
                        {lastRun.ok ? (resultText ? ` · ${resultText}` : '') : ` · ${lastRun.error ?? 'hata'}`}
                    </span>
                ) : (
                    <span className="muted">Henüz çalıştırılmadı</span>
                )}
            </div>
        </article>
    );
});

export function FunctionsTab() {
    const device = useDevtoolsStore((s) => s.device);
    const relay = useDevtoolsStore((s) => s.relay);
    const [query, setQuery] = useState('');

    const supported = useMemo(() => new Set(device?.info?.commands ?? []), [device?.info?.commands]);

    const availabilityOf = (command: CommandDef): Availability => {
        if (relay !== 'open') return {enabled: false, reason: 'Relay bağlantısı yok'};
        if (!device?.connected) return {enabled: false, reason: 'Cihaz bağlı değil'};
        if (!device.info) return {enabled: false, reason: 'Cihaz bilgisi bekleniyor'};
        if (!supported.has(command.id)) return {enabled: false, reason: 'Bu uygulama sürümünde yok'};
        return {enabled: true};
    };

    const q = query.trim().toLowerCase();
    const filtered = q
        ? COMMANDS.filter((c) => `${c.title} ${c.id} ${c.description}`.toLowerCase().includes(q))
        : COMMANDS;

    // Telefonda olup web listesinde olmayan komutlar (web güncellenmemiş olabilir).
    const unknownOnDevice = [...supported].filter((id) => !COMMANDS.some((c) => c.id === id));

    return (
        <section className="functions">
            <div className="toolbar">
                <input
                    className="input"
                    type="search"
                    placeholder="Fonksiyon ara…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <span className="toolbar-spacer"/>
                <span className="muted small">
                    {device?.info ? `Telefon ${supported.size} komut destekliyor` : ''}
                </span>
            </div>

            <div className="functions-body">
                {COMMAND_GROUPS.map((group) => {
                    const items = filtered.filter((c) => c.group === group);
                    if (items.length === 0) return null;
                    return (
                        <section key={group} className="cmd-group">
                            <h2>{group}</h2>
                            <div className="cmd-grid">
                                {items.map((command) => (
                                    <CommandCard key={command.id} command={command} availability={availabilityOf(command)}/>
                                ))}
                            </div>
                        </section>
                    );
                })}
                {filtered.length === 0 && <p className="empty">Eşleşen fonksiyon yok.</p>}
                {unknownOnDevice.length > 0 && (
                    <p className="callout callout-warn">
                        Telefon web'de tanımlı olmayan komutlar da bildiriyor: <code>{unknownOnDevice.join(', ')}</code>.
                        Web'deki <code>lib/commands.ts</code> listesine eklenebilir.
                    </p>
                )}
            </div>
        </section>
    );
}
