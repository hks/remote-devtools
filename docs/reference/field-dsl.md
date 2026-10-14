# Field DSL

Function arguments, flag values and panel forms all describe their inputs with the same small, portable schema. The UI
turns it into a form; the device validates the submitted values against it before running any handler.

```ts
type Field =
    | {type: 'text'; label?: string; placeholder?: string; multiline?: boolean; default?: string; required?: boolean}
    | {type: 'number'; label?: string; min?: number; max?: number; step?: number; default?: number; required?: boolean}
    | {type: 'boolean'; label?: string; default?: boolean}
    | {type: 'select'; label?: string; options: (string | {label: string; value: string | number})[]; default?: string | number; required?: boolean}
    | {type: 'json'; label?: string; default?: unknown};

type Fields = Record<string, Field>;   // key = argument name; order is kept in the form
```

## Example

```ts
const args = {
    email: {type: 'text', label: 'E-mail', required: true, placeholder: 'ada@example.com'},
    note: {type: 'text', multiline: true},
    retries: {type: 'number', min: 0, max: 5, step: 1, default: 3},
    verbose: {type: 'boolean', label: 'Verbose logging'},
    region: {type: 'select', options: ['eu', 'us', {label: 'Asia Pacific', value: 'apac'}], default: 'eu', required: true},
    payload: {type: 'json', default: {hello: 'world'}},
} as const;
```

With `as const`, handlers get typed arguments (`retries: number`, `verbose: boolean`, `region: 'eu' | 'us' | …`).

## Validation rules

`validateArgs(fields, input)` (exported by the SDK and the protocol package) returns
`{ok: true, args}` or `{ok: false, errors: {[key]: message}}`:

- A missing, `null` or empty value takes `default`; booleans default to `false`.
- A `required` field without a value is an error.
- `text` must be a string, `boolean` a boolean, `number` a finite number within `min` / `max`.
- `select` must equal one of the option values (numbers stay numbers).
- `json` accepts any value.
- Keys that are not in `fields` are dropped.

SDKs for other platforms should apply the same rules so that every UI behaves the same.
