import {type CommandDef, type Fields, validateArgs} from '@himmetkaan/remote-devtools-protocol';
import {defineModule, type ModuleContext, ModuleError, type RemoteModule} from '../module.ts';

/** The argument type the handler receives, derived from the `args` definition (approximate). */
type ArgsOf<F extends Fields | undefined> = F extends Fields
    ? {
          [K in keyof F]: F[K] extends {type: 'number'}
              ? number
              : F[K] extends {type: 'boolean'}
                ? boolean
                : F[K] extends {type: 'text'}
                  ? string
                  : unknown;
      }
    : Record<string, never>;

export type FunctionDef<F extends Fields | undefined = Fields | undefined> = Omit<CommandDef, 'args'> & {
    args?: F;
    /** The return value (or Promise) is shown as the result in the UI. A thrown error is reported as a failure. */
    handler(args: ArgsOf<F>): unknown;
};

export type FunctionsModule = RemoteModule & {
    /** Registers a function (replaces one with the same id). If the SDK is connected, the UI updates immediately. The returned function unregisters it. */
    register<F extends Fields | undefined>(def: FunctionDef<F>): () => void;
    unregister(id: string): void;
    /** Ids of registered functions. */
    list(): string[];
};

/**
 * App-defined functions shown in the UI's Functions tab.
 *
 *     const functions = functionsModule();
 *     RemoteDevTools.init({..., modules: [functions]});
 *     functions.register({id: 'cache.clear', title: 'Clear cache', danger: true, handler: () => cache.clear()});
 */
export function functionsModule(): FunctionsModule {
    const defs = new Map<string, FunctionDef>();
    let ctx: ModuleContext | null = null;

    const changed = () => ctx?.updateCapabilities();

    return defineModule({
        name: 'functions',

        capabilities: () => ({
            commands: [...defs.values()].map(({handler: _handler, ...command}) => command satisfies CommandDef),
        }),

        setup(context: ModuleContext) {
            ctx = context;
            context.handle<{commandId: string; args: unknown}>('module.functions.invoke', async ({commandId, args}) => {
                const def = defs.get(commandId);
                if (!def) throw new ModuleError('UNKNOWN_COMMAND', `No function registered with id "${commandId}"`);
                const validation = validateArgs(def.args ?? {}, args);
                if (!validation.ok) {
                    const details = Object.entries(validation.errors)
                        .map(([key, msg]) => `${key} ${msg}`)
                        .join(', ');
                    throw new ModuleError('INVALID_ARGS', `Invalid arguments: ${details}`);
                }
                return def.handler(validation.args as never);
            });
            return () => {
                ctx = null;
            };
        },

        register(def) {
            if (!def.id || !def.title) throw new Error('A function needs an id and a title');
            defs.set(def.id, def as FunctionDef);
            changed();
            return () => {
                if (defs.get(def.id) === def) {
                    defs.delete(def.id);
                    changed();
                }
            };
        },

        unregister(id) {
            if (defs.delete(id)) changed();
        },

        list: () => [...defs.keys()],
    });
}
