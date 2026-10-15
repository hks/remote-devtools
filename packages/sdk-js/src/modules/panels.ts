import {type ActionDef, type Block, type PanelDef, validateArgs} from '@himmetkaan/remote-devtools-protocol';
import {defineModule, type ModuleContext, ModuleError, type RemoteModule} from '../module.ts';

/** The return value (or Promise) is shown as the result in the UI; a thrown error is reported as a failure. */
export type PanelAction = ActionDef & {handler(): unknown};
export type PanelRowAction<Row = Record<string, unknown>> = ActionDef & {handler(row: Row): unknown};

type BlockOf<T extends Block['type']> = Extract<Block, {type: T}>;

/** SDK-side block definition: same as the protocol block, but actions and form submit carry a handler. */
export type PanelBlock =
    | BlockOf<'text'>
    | BlockOf<'stats'>
    | BlockOf<'keyValue'>
    | BlockOf<'json'>
    | (Omit<BlockOf<'table'>, 'rowActions'> & {rowActions?: PanelRowAction<any>[]})
    | (Omit<BlockOf<'actions'>, 'actions'> & {actions: PanelAction[]})
    | (Omit<BlockOf<'form'>, 'submit'> & {submit: {label: string; danger?: boolean; handler(values: Record<string, any>): unknown}});

/** Fields that can be changed with `update` (depending on the block type). */
export type PanelBlockData = PanelBlock extends infer B ? (B extends PanelBlock ? Partial<Omit<B, 'id' | 'type'>> : never) : never;

export type PanelOptions = {id: string; title: string; icon?: string; blocks: PanelBlock[]};

export type Panel = {
    readonly id: string;
    /** Changes the given fields of a block (e.g. `{rows}`); if connected, the UI updates immediately. */
    update(blockId: string, data: PanelBlockData): void;
    /** Replaces all blocks (to add/remove blocks). */
    setBlocks(blocks: PanelBlock[]): void;
    remove(): void;
};

export type PanelsModule = RemoteModule & {
    /** Defines a panel (replaces one with the same id). Each panel becomes its own tab in the UI. */
    define(options: PanelOptions): Panel;
    remove(id: string): void;
};

const FORM_SUBMIT_ID = 'submit';
const BLOCK_TYPES = new Set<Block['type']>(['text', 'stats', 'keyValue', 'json', 'table', 'actions', 'form']);

const stripHandler = ({handler: _handler, ...action}: ActionDef & {handler?: unknown}): ActionDef => action;

/** Strips handlers; the block sent to the UI. */
function toWire(block: PanelBlock): Block {
    switch (block.type) {
        case 'actions':
            return {...block, actions: block.actions.map(stripHandler)};
        case 'table': {
            const {rowActions, ...rest} = block;
            return rowActions ? {...rest, rowActions: rowActions.map(stripHandler)} : rest;
        }
        case 'form': {
            const {handler: _handler, ...submit} = block.submit;
            return {...block, submit: {...submit, actionId: FORM_SUBMIT_ID}};
        }
        default:
            return block;
    }
}

function checkBlocks(panelId: string, blocks: PanelBlock[]) {
    const ids = new Set<string>();
    for (const block of blocks) {
        if (!block.id) throw new Error(`Panel "${panelId}": every block needs an id`);
        if (!BLOCK_TYPES.has(block.type)) throw new Error(`Panel "${panelId}": unknown block type "${(block as {type: string}).type}"`);
        if (ids.has(block.id)) throw new Error(`Panel "${panelId}": duplicate block id "${block.id}"`);
        ids.add(block.id);
    }
}

/**
 * Custom panels defined by the app; each panel becomes its own tab in the UI. Blocks: text, stats, keyValue, json, table,
 * actions, form.
 *
 *     const panels = panelsModule();
 *     const cache = panels.define({id: 'cache', title: 'Cache', icon: '🗃️', blocks: [
 *         {id: 'size', type: 'stats', items: [{label: 'Size', value: '12 MB'}]},
 *         {id: 'tools', type: 'actions', actions: [{id: 'clear', label: 'Clear', danger: true, handler: () => cache.clear()}]},
 *     ]});
 *     cache.update('size', {items: [{label: 'Size', value: '0 MB'}]});
 */
export function panelsModule(): PanelsModule {
    const panels = new Map<string, PanelOptions>();
    let ctx: ModuleContext | null = null;

    const changed = () => ctx?.updateCapabilities();

    const find = (panelId: string, blockId: string) => {
        const panel = panels.get(panelId);
        if (!panel) throw new ModuleError('UNKNOWN_PANEL', `No panel with id "${panelId}"`);
        const block = panel.blocks.find((b) => b.id === blockId);
        if (!block) throw new ModuleError('UNKNOWN_BLOCK', `Panel "${panelId}" has no block "${blockId}"`);
        return block;
    };

    const remove = (id: string) => {
        if (panels.delete(id)) changed();
    };

    return defineModule({
        name: 'panels',

        capabilities: () =>
            [...panels.values()].map(({id, title, icon, blocks}): PanelDef => {
                const def: PanelDef = {id, title, blocks: blocks.map(toWire)};
                if (icon) def.icon = icon;
                return def;
            }),

        setup(context: ModuleContext) {
            ctx = context;
            context.handle<{panelId: string; blockId: string; actionId: string; row?: unknown; values?: unknown}>(
                'module.panels.action',
                ({panelId, blockId, actionId, row, values}) => {
                    const block = find(panelId, blockId);
                    const unknownAction = () => new ModuleError('UNKNOWN_ACTION', `Block "${blockId}" has no action "${actionId}"`);
                    switch (block.type) {
                        case 'actions': {
                            const action = block.actions.find((a) => a.id === actionId);
                            if (!action) throw unknownAction();
                            return action.handler();
                        }
                        case 'table': {
                            const action = block.rowActions?.find((a) => a.id === actionId);
                            if (!action) throw unknownAction();
                            return action.handler(row);
                        }
                        case 'form': {
                            if (actionId !== FORM_SUBMIT_ID) throw unknownAction();
                            const validation = validateArgs(block.fields, values);
                            if (!validation.ok) {
                                const details = Object.entries(validation.errors)
                                    .map(([key, msg]) => `${key} ${msg}`)
                                    .join(', ');
                                throw new ModuleError('INVALID_ARGS', `Invalid values: ${details}`);
                            }
                            return block.submit.handler(validation.args);
                        }
                        default:
                            throw unknownAction();
                    }
                },
            );
            return () => {
                ctx = null;
            };
        },

        define(options) {
            if (!options.id || !options.title) throw new Error('A panel needs an id and a title');
            checkBlocks(options.id, options.blocks);
            const panel: PanelOptions = {...options, blocks: [...options.blocks]};
            panels.set(options.id, panel);
            changed();

            const current = () => (panels.get(options.id) === panel ? panel : null);
            return {
                id: options.id,
                update(blockId, data) {
                    if (!current()) return;
                    const index = panel.blocks.findIndex((b) => b.id === blockId);
                    if (index < 0) throw new Error(`Panel "${panel.id}" has no block "${blockId}"`);
                    const next = {...panel.blocks[index], ...data} as PanelBlock;
                    panel.blocks[index] = next;
                    // Only the changed fields are sent (with handlers stripped).
                    const wire = toWire(next) as Record<string, unknown>;
                    const payload = Object.fromEntries(
                        Object.keys(data)
                            .filter((key) => key in wire)
                            .map((key) => [key, wire[key]]),
                    );
                    ctx?.emit('module.panels.update', {panelId: panel.id, blockId, data: payload}, {buffer: false});
                },
                setBlocks(blocks) {
                    if (!current()) return;
                    checkBlocks(panel.id, blocks);
                    panel.blocks = [...blocks];
                    changed();
                },
                remove: () => {
                    if (current()) remove(options.id);
                },
            };
        },

        remove,
    });
}
