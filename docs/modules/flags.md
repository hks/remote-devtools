# Flags

Flags are values your app reads to decide behaviour: feature switches, variants, limits. The app defines them and
provides their value; the Flags tab shows each one with an editor for its type and lets you **override** it on the
device. Overrides are stored on the device and survive restarts until you reset them.

```ts
import {flagsModule} from '@himmetkaan/remote-devtools';

export const flags = flagsModule();

export const newCheckout = flags.define({
    key: 'checkout.v2',
    title: 'New checkout',
    group: 'Checkout',
    field: {type: 'boolean'},
});

export const homeVariant = flags.define({
    key: 'home.variant',
    title: 'Home variant',
    field: {type: 'select', options: ['feed', 'grid', 'swipe'] as const, default: 'feed'},
    value: remoteConfig.homeVariant,      // the app's own value, e.g. from remote config
});

RemoteDevTools.init({/* … */ modules: [flags]});
```

## Reading flags

```ts
newCheckout.get();                         // boolean
homeVariant.get();                         // 'feed' | 'grid' | 'swipe'
const off = homeVariant.subscribe((v) => render(v));

flags.get('checkout.v2');
flags.subscribe((key, value) => {});       // any flag
```

The value is resolved as **override → app value → `field.default`**. Update the app value whenever your source
changes; an active override keeps winning:

```ts
flags.setValue('home.variant', remoteConfig.homeVariant);
```

## Overrides

- The UI validates the new value against the flag's [field](../reference/field-dsl); the device validates it again.
- Overrides are saved in the SDK's `storage` (AsyncStorage, `localStorage`…) and applied on the next launch. With an
  asynchronous store they arrive shortly after start; `await flags.ready()` if you need them before the first read.
- When the SDK is disabled (`enabled: false`), overrides are ignored and `get()` returns the app value.
- A stored override that no longer fits the definition (for example a removed select option) is dropped.
- **Reset** removes one override; **Reset all** removes every override. In code: `flags.reset(key?)`,
  `flags.isOverridden(key)`.

## Changing definitions

`define` with an existing key updates the definition and keeps the override. `flags.undefine(key)` removes the flag
from the UI; its stored override is kept in case the flag comes back.
