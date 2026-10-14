# Functions

Functions are actions your app exposes to the UI: reset onboarding, open a screen, seed test data, trigger a push
handler. The UI renders a card per function, with a form for its arguments, and shows the result or the error.

```ts
import {functionsModule, ModuleError} from '@himmetkaan/remote-devtools';

const functions = functionsModule();
RemoteDevTools.init({/* … */ modules: [functions]});

functions.register({
    id: 'onboarding.reset',
    title: 'Reset onboarding',
    group: 'Onboarding',
    description: 'Shows the onboarding again on the next launch.',
    confirm: 'Reset onboarding for this user?',
    danger: true,
    handler: async () => {
        await onboarding.reset();
        return 'done';
    },
});

functions.register({
    id: 'user.setPlan',
    title: 'Set plan',
    group: 'Account',
    args: {
        plan: {type: 'select', options: ['free', 'pro', 'team'], required: true},
        months: {type: 'number', min: 1, max: 24, default: 1},
        notify: {type: 'boolean', label: 'Send e-mail'},
    },
    handler: ({plan, months, notify}) => account.setPlan(plan, months, {notify}),
});
```

- `args` uses the [field DSL](../reference/field-dsl). Arguments are validated on the device before the handler runs,
  defaults are applied and unknown keys are dropped. Invalid input fails with `INVALID_ARGS`.
- Whatever the handler returns (or resolves to) is shown as the result. A thrown error is reported as a failure; throw
  `new ModuleError('CODE', 'message')` to choose the error code.
- `confirm` asks before running; `danger` styles the card as destructive.

## Changing functions at runtime

Functions can be registered before or after the SDK connects. Changes reach the UI right away.

```ts
const unregister = functions.register({id: 'debug.crash', title: 'Crash', handler: () => { throw new Error('boom'); }});
unregister();                    // or functions.unregister('debug.crash')
functions.list();                // registered ids
```
