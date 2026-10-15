import type {Field, Fields} from '@himmetkaan/remote-devtools-protocol';
import {type FormErrors, type FormValues, fieldLabel, optionLabel, optionValue} from '../lib/fields.ts';

type Props = {
    fields: Fields;
    values: FormValues;
    errors: FormErrors;
    disabled?: boolean;
    onChange(values: FormValues): void;
    /** Keeps input ids unique. */
    idPrefix: string;
};

/** Field DSL (PROTOCOL §6) form. Shared by Functions, flags and panel forms. */
export function FieldForm({fields, values, errors, disabled, onChange, idPrefix}: Props) {
    const set = (key: string, value: string | boolean) => onChange({...values, [key]: value});

    return (
        <div className="field-form">
            {Object.entries(fields).map(([key, field]) => {
                const id = `${idPrefix}-${key}`;
                const error = errors[key];
                const required = 'required' in field && field.required;
                return (
                    <div key={key} className={`field${error ? ' has-error' : ''}${field.type === 'boolean' ? ' is-inline' : ''}`}>
                        {field.type === 'boolean' ? (
                            <label className="toggle" htmlFor={id}>
                                <input
                                    id={id}
                                    type="checkbox"
                                    checked={values[key] === true}
                                    disabled={disabled}
                                    onChange={(e) => set(key, e.target.checked)}
                                />
                                {fieldLabel(key, field)}
                            </label>
                        ) : (
                            <>
                                <label className="field-label" htmlFor={id}>
                                    {fieldLabel(key, field)}
                                    {required && (
                                        <span className="field-required" aria-hidden="true">
                                            *
                                        </span>
                                    )}
                                </label>
                                <Input
                                    id={id}
                                    field={field}
                                    value={String(values[key] ?? '')}
                                    disabled={disabled}
                                    onChange={(v) => set(key, v)}
                                />
                            </>
                        )}
                        {error && <span className="field-error">{error}</span>}
                    </div>
                );
            })}
        </div>
    );
}

function Input({
    id,
    field,
    value,
    disabled,
    onChange,
}: {
    id: string;
    field: Field;
    value: string;
    disabled?: boolean;
    onChange(v: string): void;
}) {
    switch (field.type) {
        case 'select':
            return (
                <select id={id} className="input select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
                    {!field.required && <option value="">—</option>}
                    {field.options.map((option) => (
                        <option key={String(optionValue(option))} value={String(optionValue(option))}>
                            {optionLabel(option)}
                        </option>
                    ))}
                </select>
            );
        case 'number':
            return (
                <input
                    id={id}
                    className="input"
                    type="number"
                    value={value}
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 'any'}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        case 'json':
            return (
                <textarea
                    id={id}
                    className="input textarea mono"
                    rows={3}
                    value={value}
                    placeholder="{ }"
                    spellCheck={false}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        case 'text':
            return field.multiline ? (
                <textarea
                    id={id}
                    className="input textarea"
                    rows={3}
                    value={value}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                />
            ) : (
                <input
                    id={id}
                    className="input"
                    type="text"
                    value={value}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
        case 'boolean':
            return null;
    }
}
