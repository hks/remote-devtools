import type {Field, Fields, SelectOption} from '@himmetkaan/remote-devtools-protocol';

/**
 * Field DSL (docs/v2/PROTOCOL.md §6) için form durumu.
 * Form değerleri input'ların ham hâlidir (sayılar ve JSON metin olarak); gönderirken `toArgs` ile dönüştürülür.
 */
export type FormValues = Record<string, string | boolean>;
export type FormErrors = Record<string, string>;

export function optionValue(option: SelectOption): string | number {
    return typeof option === 'string' ? option : option.value;
}

export function optionLabel(option: SelectOption): string {
    return typeof option === 'string' ? option : option.label;
}

function initialValue(field: Field): string | boolean {
    switch (field.type) {
        case 'boolean':
            return field.default ?? false;
        case 'number':
            return field.default === undefined ? '' : String(field.default);
        case 'select': {
            const fallback = field.required && field.options[0] !== undefined ? optionValue(field.options[0]) : '';
            return String(field.default ?? fallback);
        }
        case 'json':
            return field.default === undefined ? '' : JSON.stringify(field.default, null, 2);
        case 'text':
            return field.default ?? '';
    }
}

export function initialValues(fields: Fields): FormValues {
    return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, initialValue(field)]));
}

export function fieldLabel(key: string, field: Field): string {
    return field.label ?? key;
}

/** Form değerlerini cihaza gönderilecek argümanlara çevirir; hatalıysa `errors` doludur. Boş opsiyonel alanlar gönderilmez. */
export function toArgs(fields: Fields, values: FormValues): {args: Record<string, unknown>; errors: FormErrors} {
    const args: Record<string, unknown> = {};
    const errors: FormErrors = {};

    for (const [key, field] of Object.entries(fields)) {
        const raw = values[key];
        if (field.type === 'boolean') {
            args[key] = raw === true;
            continue;
        }
        const text = typeof raw === 'string' ? raw : '';
        const required = 'required' in field && field.required === true;
        if (text.trim() === '') {
            if (required) errors[key] = 'Required';
            continue;
        }
        switch (field.type) {
            case 'text':
                args[key] = text;
                break;
            case 'number': {
                const n = Number(text);
                if (!Number.isFinite(n)) errors[key] = 'Not a number';
                else if (field.min !== undefined && n < field.min) errors[key] = `Must be ≥ ${field.min}`;
                else if (field.max !== undefined && n > field.max) errors[key] = `Must be ≤ ${field.max}`;
                else args[key] = n;
                break;
            }
            case 'select': {
                // Seçenek değeri sayı olabilir; <select> her zaman metin döner.
                const match = field.options.map(optionValue).find((v) => String(v) === text);
                if (match === undefined) errors[key] = 'Not one of the options';
                else args[key] = match;
                break;
            }
            case 'json':
                try {
                    args[key] = JSON.parse(text);
                } catch {
                    errors[key] = 'Invalid JSON';
                }
                break;
        }
    }
    return {args, errors};
}
