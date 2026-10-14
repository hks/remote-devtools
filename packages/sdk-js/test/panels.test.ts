import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {panelsModule} from '../src/index.ts';
import {type Ui, withPairedClient} from './helpers.ts';

async function act(ui: Ui, deviceId: string, payload: Record<string, unknown>) {
    const id = ui.send('module.panels.action', payload, {deviceId});
    const reply = await ui.next('module.panels.result');
    assert.equal(reply.replyTo, id);
    return reply.payload;
}

describe('panelsModule', () => {
    it('describes panels without handlers and runs actions, row actions and forms', async () => {
        const panels = panelsModule();
        const cache = new Map([['a', 10], ['b', 20]]);
        panels.define({
            id: 'cache',
            title: 'Cache',
            icon: '🗃️',
            blocks: [
                {id: 'note', type: 'text', text: 'Entries expire after an hour.', tone: 'info'},
                {id: 'size', type: 'stats', items: [{label: 'Entries', value: 2}]},
                {
                    id: 'entries',
                    type: 'table',
                    columns: [{key: 'key', title: 'Key'}, {key: 'size', title: 'Size'}],
                    rows: [{key: 'a', size: 10}, {key: 'b', size: 20}],
                    rowActions: [{id: 'evict', label: 'Evict', danger: true, handler: (row: {key: string}) => cache.delete(row.key)}],
                },
                {id: 'tools', type: 'actions', actions: [{id: 'count', label: 'Count', handler: () => cache.size}]},
                {
                    id: 'add',
                    type: 'form',
                    fields: {key: {type: 'text', required: true}, size: {type: 'number', min: 1, default: 1}},
                    submit: {label: 'Add', handler: ({key, size}) => (cache.set(key, size), cache.size)},
                },
            ],
        });

        const wire = panels.capabilities!() as any[];
        assert.equal(wire[0].icon, '🗃️');
        assert.deepEqual(wire[0].blocks[2].rowActions, [{id: 'evict', label: 'Evict', danger: true}]);
        assert.deepEqual(wire[0].blocks[3].actions, [{id: 'count', label: 'Count'}]);
        assert.deepEqual(wire[0].blocks[4].submit, {label: 'Add', actionId: 'submit'});

        await withPairedClient([panels], async (ui, deviceId) => {
            assert.deepEqual(await act(ui, deviceId, {panelId: 'cache', blockId: 'tools', actionId: 'count'}), {ok: true, result: 2});
            assert.deepEqual(await act(ui, deviceId, {panelId: 'cache', blockId: 'entries', actionId: 'evict', row: {key: 'a', size: 10}}), {ok: true, result: true});
            assert.equal(cache.has('a'), false);
            assert.deepEqual(await act(ui, deviceId, {panelId: 'cache', blockId: 'add', actionId: 'submit', values: {key: 'c'}}), {ok: true, result: 2});
            assert.equal(cache.get('c'), 1);

            const invalid = await act(ui, deviceId, {panelId: 'cache', blockId: 'add', actionId: 'submit', values: {size: 0}});
            assert.equal(invalid.error.code, 'INVALID_ARGS');
            assert.match(invalid.error.message, /key is required/);
            assert.equal((await act(ui, deviceId, {panelId: 'nope', blockId: 'x', actionId: 'y'})).error.code, 'UNKNOWN_PANEL');
            assert.equal((await act(ui, deviceId, {panelId: 'cache', blockId: 'x', actionId: 'y'})).error.code, 'UNKNOWN_BLOCK');
            assert.equal((await act(ui, deviceId, {panelId: 'cache', blockId: 'note', actionId: 'y'})).error.code, 'UNKNOWN_ACTION');
        });
    });

    it('sends partial block updates and panel changes while connected', async () => {
        const panels = panelsModule();
        await withPairedClient([panels], async (ui) => {
            const panel = panels.define({
                id: 'queue',
                title: 'Queue',
                blocks: [
                    {id: 'stats', type: 'stats', items: [{label: 'Pending', value: 0}]},
                    {id: 'tools', type: 'actions', actions: [{id: 'flush', label: 'Flush', handler: () => null}]},
                ],
            });
            assert.equal((await ui.next('capabilities.update')).payload.panels[0].id, 'queue');

            panel.update('stats', {items: [{label: 'Pending', value: 3}]});
            assert.deepEqual((await ui.next('module.panels.update')).payload, {panelId: 'queue', blockId: 'stats', data: {items: [{label: 'Pending', value: 3}]}});

            // When actions are updated, handlers are not sent to the UI.
            panel.update('tools', {actions: [{id: 'retry', label: 'Retry', handler: () => 'ok'}]});
            assert.deepEqual((await ui.next('module.panels.update')).payload.data, {actions: [{id: 'retry', label: 'Retry'}]});

            assert.throws(() => panel.update('missing', {}), /no block "missing"/);
            assert.throws(() => panel.setBlocks([{id: 'a', type: 'json', data: 1}, {id: 'a', type: 'json', data: 2}]), /duplicate block id/);

            panel.remove();
            assert.deepEqual((await ui.next('capabilities.update')).payload.panels, []);
            panel.update('stats', {items: []}); // removed panel: silently ignored
            await ui.none('module.panels.update');
        });
    });
});
