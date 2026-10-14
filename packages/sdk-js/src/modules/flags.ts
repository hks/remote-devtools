import {type Field, type FlagDef, validateArgs} from '@himmetkaan/remote-devtools-protocol';
import {defineModule, type ModuleContext, ModuleError, type RemoteModule} from '../module.ts';
import {toSerializable} from '../serialize.ts';

/** The flag's value type derived from its `field` definition (approximate). */
export type FlagValue<F extends Field> = F extends {type: 'boolean'}
    ? boolean
    : F extends {type: 'number'}
      ? number
      : F extends {type: 'text'}
        ? string
        : F extends {type: 'select'; options: readonly (infer O)[]}
          ? O extends {value: infer V} ? V : O
          : unknown;

export type FlagOptions<F extends Field = Field> = {
    key: string;
    title?: string;
    description?: string;
    group?: string;
    /** Value type and the editor in the UI. `default` is the effective value when there is no override and no `value`. */
    field: F;
    /** The value provided by the app (e.g. from remote config). Can be changed later with `setValue`. */
    value?: FlagValue<F>;
};

export type Flag<T = unknown> = {
    readonly key: string;
    /** The override if any, otherwise the app's value, otherwise `field.default`. */
    get(): T;
    /** Called when the effective value changes. */
    subscribe(listener: (value: T) => void): () => void;
};

export type FlagsModule = RemoteModule & {
    /** Defines a flag (if the key exists, updates the definition and keeps the override). */
    define<F extends Field>(options: FlagOptions<F>): Flag<FlagValue<F>>;
    /** Removes the definition; the stored override is kept. */
    undefine(key: string): void;
    get<T = unknown>(key: string): T | undefined;
    /** Changes the app's value (the effective value doesn't change while overridden). */
    setValue(key: string, value: unknown): void;
    isOverridden(key: string): boolean;
    /** Clears the override (all overrides if no key is given). */
    reset(key?: string): void;
    /** Called when any flag's effective value changes. */
    subscribe(listener: (key: string, value: unknown) => void): () => void;
    /** Resolves once stored overrides are loaded (immediately when the SDK is disabled). */
    ready(): Promise<void>;
};

type Entry = {options: FlagOptions; value: unknown};

const OVERRIDES_KEY = 'overrides';

const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

function fieldDefault(field: Field): unknown {
    if ('default' in field && field.default !== undefined) return field.default;
    return field.type === 'boolean' ? false : undefined;
}

/**
 * Feature flags: defined by the app, overridden from the UI. Overrides are stored in the SDK's `storage` and still
 * apply after the app restarts. When the SDK is disabled (`enabled: false`) overrides are not applied; `get` returns the app's value.
 *
 *     const flags = flagsModule();
 *     const newCheckout = flags.define({key: 'checkout.v2', title: 'New checkout', field: {type: 'boolean'}});
 *     if (newCheckout.get()) …
 */
export function flagsModule(): FlagsModule {
    const entries = new Map<string, Entry>();
    /** Undefined keys are kept too: they apply once the flag is defined later. */
    let overrides: Record<string, unknown> = {};
    const listeners = new Set<(key: string, value: unknown) => void>();
    let ctx: ModuleContext | null = null;
    let readyPromise: Promise<void> = Promise.resolve();

    const baseValue = (entry: Entry) => (entry.value !== undefined ? entry.value : fieldDefault(entry.options.field));
    const isOverridden = (key: string) => ctx !== null && hasOwn(overrides, key) && entries.has(key);
    const current = (key: string) => {
        const entry = entries.get(key);
        if (!entry) return undefined;
        return isOverridden(key) ? overrides[key] : baseValue(entry);
    };

    const validate = (field: Field, value: unknown): {ok: true; value: unknown} | {ok: false; message: string} => {
        const result = validateArgs({value: field}, {value});
        return result.ok ? {ok: true, value: result.args.value} : {ok: false, message: result.errors.value ?? 'is invalid'};
    };

    /**
     * `fn` may change effective values; changes are reported to listeners, and to the UI if a value or override state
     * changed (or `definitionChanged`).
     */
    const mutate = (fn: () => void, definitionChanged = false) => {
        const before = new Map([...entries.keys()].map((key) => [key, {value: current(key), overridden: isOverridden(key)}]));
        fn();
        let changed = definitionChanged;
        for (const key of entries.keys()) {
            const previous = before.get(key);
            const value = current(key);
            if (!previous || previous.overridden !== isOverridden(key)) changed = true;
            if (previous && !Object.is(previous.value, value)) {
                changed = true;
                for (const listener of listeners) listener(key, value);
            }
        }
        if (changed) ctx?.updateCapabilities();
    };

    const persist = () => {
        if (!ctx) return;
        const result = Object.keys(overrides).length
            ? ctx.storage.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
            : ctx.storage.removeItem(OVERRIDES_KEY);
        if (result instanceof Promise) result.catch((err) => ctx?.log.warn('Could not save flag overrides', err, {tag: 'flags'}));
    };

    /** Applies stored overrides; those that don't match the definition (e.g. a removed option) are dropped. */
    const applyStored = (raw: string | null) => {
        let stored: Record<string, unknown> = {};
        try {
            const parsed = raw ? JSON.parse(raw) : {};
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
        } catch {
            // a corrupt record is ignored
        }
        mutate(() => {
            overrides = {...stored, ...overrides};
            dropInvalid();
        });
    };

    const dropInvalid = () => {
        let dropped = false;
        for (const [key, value] of Object.entries(overrides)) {
            const entry = entries.get(key);
            if (entry && !validate(entry.options.field, value).ok) {
                delete overrides[key];
                dropped = true;
            }
        }
        if (dropped) persist();
    };

    const describe = (key: string, entry: Entry): FlagDef => {
        const {options} = entry;
        const def: FlagDef = {
            key,
            field: options.field,
            value: toSerializable(current(key)) ?? null,
            baseValue: toSerializable(baseValue(entry)) ?? null,
            overridden: isOverridden(key),
        };
        if (options.title) def.title = options.title;
        if (options.description) def.description = options.description;
        if (options.group) def.group = options.group;
        return def;
    };

    const handle = <T>(key: string): Flag<T> => ({
        key,
        get: () => current(key) as T,
        subscribe(listener) {
            const wrapped = (changedKey: string, value: unknown) => {
                if (changedKey === key) listener(value as T);
            };
            listeners.add(wrapped);
            return () => listeners.delete(wrapped);
        },
    });

    return defineModule({
        name: 'flags',

        capabilities: () => ({flags: [...entries].map(([key, entry]) => describe(key, entry))}),

        setup(context: ModuleContext) {
            ctx = context;
            let raw: string | null | Promise<string | null>;
            try {
                raw = context.storage.getItem(OVERRIDES_KEY);
            } catch {
                raw = null;
            }
            // With synchronous stores (localStorage, MMKV), overrides are applied before `init` returns.
            if (raw instanceof Promise) {
                readyPromise = raw.then(applyStored, () => applyStored(null));
            } else {
                applyStored(raw);
            }

            context.handle<{key: string; value: unknown}>('module.flags.set', ({key, value}) => {
                const entry = entries.get(key);
                if (!entry) throw new ModuleError('UNKNOWN_FLAG', `No flag with key "${key}"`);
                const result = validate(entry.options.field, value);
                if (!result.ok) throw new ModuleError('INVALID_VALUE', `Invalid value: ${result.message}`);
                mutate(() => {
                    overrides = {...overrides, [key]: result.value};
                });
                persist();
                return describe(key, entry);
            });

            context.handle<{key?: string}>('module.flags.reset', ({key}) => {
                reset(key);
                return null;
            });

            return () => {
                // On teardown, revert to the app's values (overrides stay on disk).
                mutate(() => {
                    ctx = null;
                });
                overrides = {};
            };
        },

        define<F extends Field>(options: FlagOptions<F>) {
            if (!options.key || !options.field) throw new Error('A flag needs a key and a field');
            mutate(() => {
                entries.set(options.key, {options: options as FlagOptions, value: options.value});
                dropInvalid();
            }, true);
            return handle<FlagValue<F>>(options.key);
        },

        undefine(key) {
            if (!entries.has(key)) return;
            mutate(() => entries.delete(key), true);
        },

        get: <T>(key: string) => current(key) as T | undefined,

        setValue(key, value) {
            const entry = entries.get(key);
            if (!entry) throw new Error(`No flag with key "${key}"`);
            mutate(() => {
                entry.value = value;
            });
        },

        isOverridden,

        reset,

        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        ready: () => readyPromise,
    });

    function reset(key?: string) {
        if (key !== undefined && !hasOwn(overrides, key)) return;
        mutate(() => {
            if (key === undefined) overrides = {};
            else {
                const {[key]: _removed, ...rest} = overrides;
                overrides = rest;
            }
        });
        persist();
    }
}
