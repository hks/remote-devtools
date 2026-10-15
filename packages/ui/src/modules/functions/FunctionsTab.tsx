import type {CommandDef} from '@himmetkaan/remote-devtools-protocol';
import {memo, useMemo, useState} from 'react';
import {FieldForm} from '../../components/FieldForm.tsx';
import {type FormErrors, initialValues, toArgs} from '../../lib/fields.ts';
import {formatClock, stringifyData} from '../../lib/format.ts';
import {relayClient} from '../../lib/relayClient.ts';
import {useUnavailable} from '../../lib/useUnavailable.ts';
import {commandKey, useCommandsStore} from '../../store/useCommandsStore.ts';
import {useDevtoolsStore} from '../../store/useDevtoolsStore.ts';

const DEFAULT_GROUP = 'General';

async function invoke(deviceId: string, command: CommandDef, args: Record<string, unknown>) {
    const key = commandKey(deviceId, command.id);
    const store = useCommandsStore.getState();
    store.setRunning(key, true);
    const startedAt = Date.now();
    const outcome = await relayClient.request('module.functions.invoke', {commandId: command.id, args}, deviceId);
    const durationMs = Date.now() - startedAt;
    store.setResult(key, {
        ok: outcome.ok,
        result: outcome.ok ? outcome.result : null,
        error: outcome.ok ? null : outcome.error,
        at: Date.now(),
        durationMs,
    });
    const hasResult = outcome.ok && outcome.result !== null && outcome.result !== undefined;
    useDevtoolsStore.getState().addLog(
        outcome.ok
            ? {
                  level: 'info',
                  source: 'ui',
                  message: `Ran ${command.title} (${durationMs} ms)`,
                  data: hasResult ? outcome.result : undefined,
                  deviceId,
              }
            : {
                  level: 'error',
                  source: 'ui',
                  message: `${command.title} failed — ${outcome.error.message}`,
                  data: outcome.error,
                  deviceId,
              },
    );
}

const CommandCard = memo(function CommandCard({
    deviceId,
    command,
    unavailable,
}: {
    deviceId: string;
    command: CommandDef;
    unavailable: string | null;
}) {
    const key = commandKey(deviceId, command.id);
    const running = useCommandsStore((s) => Boolean(s.running[key]));
    const lastRun = useCommandsStore((s) => s.lastRun[key]);
    const fields = command.args ?? {};
    const hasArgs = Object.keys(fields).length > 0;
    const [values, setValues] = useState(() => initialValues(fields));
    const [errors, setErrors] = useState<FormErrors>({});

    const run = () => {
        const {args, errors: nextErrors} = toArgs(fields, values);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;
        if (command.confirm && !confirm(command.confirm)) return;
        void invoke(deviceId, command, args);
    };

    const resultText = lastRun?.ok && lastRun.result !== null && lastRun.result !== undefined ? stringifyData(lastRun.result) : null;

    return (
        <article className={`cmd-card${command.danger ? ' is-danger' : ''}${unavailable ? ' is-unavailable' : ''}`}>
            <header className="cmd-head">
                <h3>{command.title}</h3>
                <code className="cmd-id">{command.id}</code>
            </header>
            <p className="cmd-desc">{command.description}</p>

            {hasArgs && (
                <FieldForm
                    fields={fields}
                    values={values}
                    errors={errors}
                    disabled={Boolean(unavailable)}
                    onChange={setValues}
                    idPrefix={`cmd-${command.id}`}
                />
            )}

            <div className="cmd-actions">
                <button
                    className={`btn btn-small ${command.danger ? 'btn-danger' : 'btn-primary'}`}
                    onClick={run}
                    disabled={Boolean(unavailable) || running}
                    title={unavailable ?? undefined}
                >
                    {running ? <span className="spin">⟳</span> : '▶'} Run
                </button>
            </div>

            {/* Fixed height: the card and grid don't reflow when a result arrives. */}
            <div className="cmd-status" title={lastRun?.error?.message ?? resultText ?? undefined}>
                {unavailable ? (
                    <span className="muted">{unavailable}</span>
                ) : running ? (
                    <span className="muted">Running…</span>
                ) : lastRun ? (
                    <span className={lastRun.ok ? 'ok' : 'err'}>
                        {lastRun.ok ? '✓' : '✗'} {formatClock(lastRun.at).slice(0, 8)} · {lastRun.durationMs} ms
                        {lastRun.ok ? (resultText ? ` · ${resultText}` : '') : ` · ${lastRun.error?.message ?? 'error'}`}
                    </span>
                ) : (
                    <span className="muted">Not run yet</span>
                )}
            </div>
        </article>
    );
});

export function FunctionsTab({deviceId}: {deviceId: string}) {
    const device = useDevtoolsStore((s) => s.devices[deviceId]);
    const unavailable = useUnavailable(deviceId);
    const [query, setQuery] = useState('');

    const commands = (device?.hello?.capabilities.functions?.commands ?? []) as CommandDef[];

    const q = query.trim().toLowerCase();
    const groups = useMemo(() => {
        const filtered = q
            ? commands.filter((c) => `${c.title} ${c.id} ${c.description ?? ''} ${c.group ?? ''}`.toLowerCase().includes(q))
            : commands;
        // Groups in the order reported by the device.
        const byGroup = new Map<string, CommandDef[]>();
        for (const command of filtered) {
            const group = command.group || DEFAULT_GROUP;
            byGroup.set(group, [...(byGroup.get(group) ?? []), command]);
        }
        return [...byGroup];
    }, [commands, q]);

    return (
        <section className="functions">
            <div className="toolbar">
                <input
                    className="input"
                    type="search"
                    placeholder="Search functions…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <span className="toolbar-spacer" />
                <span className="muted small">{commands.length} function(s) registered by the app</span>
            </div>

            <div className="functions-body">
                {groups.map(([group, items]) => (
                    <section key={group} className="cmd-group">
                        <h2>{group}</h2>
                        <div className="cmd-grid">
                            {items.map((command) => (
                                <CommandCard
                                    key={`${command.id}:${JSON.stringify(command.args ?? {})}`}
                                    deviceId={deviceId}
                                    command={command}
                                    unavailable={unavailable}
                                />
                            ))}
                        </div>
                    </section>
                ))}
                {commands.length === 0 && <p className="empty">The app has not registered any functions.</p>}
                {commands.length > 0 && groups.length === 0 && <p className="empty">No functions match the search.</p>}
            </div>
        </section>
    );
}
