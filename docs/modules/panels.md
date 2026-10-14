# Custom panels

Panels let an app add its own tabs without any UI code. You describe a panel as a list of blocks; the UI draws it as a
tab next to the built-in ones, and button clicks and form submissions run handlers in your app.

```ts
import {panelsModule} from '@himmetkaan/remote-devtools';

const panels = panelsModule();
RemoteDevTools.init({/* … */ modules: [panels]});

const queue = panels.define({
    id: 'jobs',
    title: 'Job queue',
    icon: '📬',
    blocks: [
        {id: 'note', type: 'text', tone: 'info', text: 'Failed jobs are retried three times.'},
        {id: 'stats', type: 'stats', items: [{label: 'Pending', value: 0}, {label: 'Failed', value: 0, tone: 'error'}]},
        {
            id: 'list',
            type: 'table',
            title: 'Jobs',
            columns: [{key: 'id', title: 'ID'}, {key: 'name', title: 'Name'}, {key: 'state', title: 'State'}],
            rows: [],
            rowActions: [
                {id: 'retry', label: 'Retry', handler: (row) => jobs.retry(row.id)},
                {id: 'drop', label: 'Drop', danger: true, confirm: 'Drop this job?', handler: (row) => jobs.drop(row.id)},
            ],
        },
        {
            id: 'enqueue',
            type: 'form',
            title: 'Enqueue a job',
            fields: {name: {type: 'text', required: true}, priority: {type: 'number', min: 0, max: 9, default: 5}},
            submit: {label: 'Enqueue', handler: ({name, priority}) => jobs.add(name, priority)},
        },
        {id: 'tools', type: 'actions', actions: [{id: 'flush', label: 'Flush all', danger: true, handler: () => jobs.flush()}]},
        {id: 'config', type: 'keyValue', title: 'Config', data: {concurrency: 4, backoff: 'exponential'}},
        {id: 'raw', type: 'json', title: 'Raw state', data: jobs.snapshot()},
    ],
});
```

## Blocks

| Type | Fields | Shows |
|---|---|---|
| `text` | `text`, `tone?` | A note; `tone` is `info`, `success`, `warn` or `error` |
| `stats` | `items: {label, value, hint?, tone?}[]` | Big number cards |
| `keyValue` | `data: Record<string, string \| number \| boolean \| null>` | A two-column table |
| `table` | `columns: {key, title}[]`, `rows`, `rowActions?` | A table; a filter appears from 8 rows |
| `json` | `data` | A collapsible JSON tree |
| `actions` | `actions: {id, label, confirm?, danger?, handler}[]` | Buttons |
| `form` | `fields`, `submit: {label, danger?, handler}` | A form built from the [field DSL](../reference/field-dsl) |

Every block has an `id` (unique in the panel) and an optional `title`.

Handlers run on the device. Their return value appears under the block and in Logs; a thrown error is reported as a
failure. Row actions receive the row as the UI shows it. Form values are validated against `fields` on the device
before `submit.handler` runs.

## Updating a panel

Push changes whenever your data changes. Only the fields you pass are sent:

```ts
jobs.on('change', () => {
    queue.update('stats', {items: [{label: 'Pending', value: jobs.pending}, {label: 'Failed', value: jobs.failed, tone: 'error'}]});
    queue.update('list', {rows: jobs.list().map(({id, name, state}) => ({id, name, state}))});
});
```

- `queue.setBlocks(blocks)` replaces all blocks (to add or remove blocks).
- `queue.remove()` or `panels.remove('jobs')` removes the tab.
- Panels can be defined before the SDK connects; the current content is sent when it does.
