import {memo, useMemo, useState} from 'react';
import type {FlagDef} from '@himmetkaan/remote-devtools-protocol';
import {FieldForm} from '../../components/FieldForm.tsx';
import {type FormErrors, type FormValues, toArgs, toFormValue} from '../../lib/fields.ts';
import {stringifyData} from '../../lib/format.ts';
import {relayClient} from '../../lib/relayClient.ts';
import {useUnavailable} from '../../lib/useUnavailable.ts';
import {useDevtoolsStore} from '../../store/useDevtoolsStore.ts';

const DEFAULT_GROUP = 'General';
const NO_FLAGS: FlagDef[] = [];

async function send(deviceId: string, type: 'module.flags.set' | 'module.flags.reset', payload: unknown, description: string) {
    const outcome = await relayClient.request(type, payload, deviceId);
    useDevtoolsStore.getState().addLog(
        outcome.ok
            ? {level: 'info', source: 'ui', message: `Flags: ${description}`, deviceId}
            : {level: 'error', source: 'ui', message: `Flags: ${description} failed — ${outcome.error.message}`, data: outcome.error, deviceId},
    );
    return outcome;
}

function display(value: unknown): string {
    return value === null || value === undefined ? '—' : typeof value === 'string' ? value : stringifyData(value);
}

const FlagCard = memo(function FlagCard({deviceId, flag, unavailable}: {deviceId: string; flag: FlagDef; unavailable: string | null}) {
    const field = flag.field;
    const fields = useMemo(() => ({value: {...field, label: field.label ?? 'Value'}}), [field]);
    const initial = useMemo<FormValues>(() => ({value: toFormValue(field, flag.value)}), [field, flag.value]);
    const [values, setValues] = useState(initial);
    const [errors, setErrors] = useState<FormErrors>({});
    const [busy, setBusy] = useState(false);
    const dirty = values.value !== initial.value;

    const apply = async (next: FormValues) => {
        const {args, errors: nextErrors} = toArgs(fields, next);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;
        setBusy(true);
        const outcome = await send(deviceId, 'module.flags.set', {key: flag.key, value: args.value ?? null}, `set ${flag.title ?? flag.key} to ${display(args.value)}`);
        setBusy(false);
        if (!outcome.ok) setErrors({value: outcome.error.message});
    };

    const reset = async () => {
        setBusy(true);
        await send(deviceId, 'module.flags.reset', {key: flag.key}, `reset ${flag.title ?? flag.key}`);
        setBusy(false);
    };

    const disabled = Boolean(unavailable) || busy;

    return (
        <article className={`cmd-card flag-card${flag.overridden ? ' is-overridden' : ''}${unavailable ? ' is-unavailable' : ''}`}>
            <header className="cmd-head">
                <h3>{flag.title ?? flag.key}</h3>
                {flag.overridden && <span className="badge is-override">Overridden</span>}
            </header>
            <code className="cmd-id">{flag.key}</code>
            {flag.description && <p className="cmd-desc">{flag.description}</p>}

            {field.type === 'boolean' ? (
                <label className="switch">
                    <input
                        type="checkbox"
                        checked={flag.value === true}
                        disabled={disabled}
                        title={unavailable ?? undefined}
                        onChange={(e) => void apply({value: e.target.checked})}
                    />
                    <span className="switch-track" aria-hidden/>
                    <span>{flag.value === true ? 'On' : 'Off'}</span>
                </label>
            ) : (
                <form
                    className="flag-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void apply(values);
                    }}
                >
                    <FieldForm fields={fields} values={values} errors={errors} disabled={disabled} onChange={setValues} idPrefix={`flag-${flag.key}`}/>
                    <div className="cmd-actions">
                        {dirty && (
                            <button type="button" className="btn btn-small" onClick={() => (setValues(initial), setErrors({}))} disabled={busy}>
                                Undo
                            </button>
                        )}
                        <button type="submit" className="btn btn-small btn-primary" disabled={disabled || !dirty} title={unavailable ?? undefined}>
                            Apply
                        </button>
                    </div>
                </form>
            )}
            {field.type === 'boolean' && errors.value && <span className="field-error">{errors.value}</span>}

            <footer className="flag-foot">
                <span className="muted small" title={display(flag.baseValue)}>App value: <code>{display(flag.baseValue)}</code></span>
                {flag.overridden && (
                    <button className="btn btn-small" onClick={() => void reset()} disabled={disabled} title={unavailable ?? 'Remove the override'}>
                        Reset
                    </button>
                )}
            </footer>
        </article>
    );
});

export function FlagsTab({deviceId}: {deviceId: string}) {
    const flags = useDevtoolsStore((s) => (s.devices[deviceId]?.hello?.capabilities.flags?.flags as FlagDef[] | undefined) ?? NO_FLAGS);
    const unavailable = useUnavailable(deviceId);
    const [query, setQuery] = useState('');
    const [onlyOverridden, setOnlyOverridden] = useState(false);

    const overridden = flags.filter((f) => f.overridden).length;
    const q = query.trim().toLowerCase();
    const groups = useMemo(() => {
        const byGroup = new Map<string, FlagDef[]>();
        for (const flag of flags) {
            if (onlyOverridden && !flag.overridden) continue;
            if (q && !`${flag.key} ${flag.title ?? ''} ${flag.description ?? ''} ${flag.group ?? ''}`.toLowerCase().includes(q)) continue;
            const group = flag.group || DEFAULT_GROUP;
            byGroup.set(group, [...(byGroup.get(group) ?? []), flag]);
        }
        return [...byGroup];
    }, [flags, q, onlyOverridden]);

    const resetAll = () => {
        if (!confirm(`Remove all ${overridden} override(s)? The app's own values apply again.`)) return;
        void send(deviceId, 'module.flags.reset', {}, 'reset all overrides');
    };

    return (
        <section className="functions">
            <div className="toolbar">
                <input className="input" type="search" placeholder="Search flags…" value={query} onChange={(e) => setQuery(e.target.value)}/>
                <label className="toggle">
                    <input type="checkbox" checked={onlyOverridden} onChange={(e) => setOnlyOverridden(e.target.checked)}/>
                    Overridden only
                </label>
                <span className="toolbar-spacer"/>
                <span className="muted small">{flags.length} flag(s) · {overridden} overridden</span>
                <button className="btn btn-small btn-danger" disabled={overridden === 0 || Boolean(unavailable)} title={unavailable ?? undefined} onClick={resetAll}>
                    Reset all
                </button>
            </div>

            <div className="functions-body">
                <p className="muted small flags-note">Overrides are saved on the device and stay in effect after the app restarts, until you reset them.</p>
                {groups.map(([group, items]) => (
                    <section key={group} className="cmd-group">
                        <h2>{group}</h2>
                        <div className="cmd-grid">
                            {items.map((flag) => (
                                <FlagCard key={`${flag.key}:${JSON.stringify(flag.field)}:${JSON.stringify(flag.value)}`} deviceId={deviceId} flag={flag} unavailable={unavailable}/>
                            ))}
                        </div>
                    </section>
                ))}
                {flags.length === 0 && <p className="empty">The app has not defined any flags.</p>}
                {flags.length > 0 && groups.length === 0 && <p className="empty">No flags match the filters.</p>}
            </div>
        </section>
    );
}
