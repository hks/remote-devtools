# State

The State tab shows a store's state as a JSON tree and a timeline of changes next to it, each with the action name
(when known) and the changed paths as `old → new`.

```ts
import {reduxAdapter, stateModule, zustandAdapter} from '@himmetkaan/remote-devtools';

const state = stateModule({
    stores: [
        reduxAdapter(store),                                          // id 'redux'
        zustandAdapter(useCartStore, {id: 'cart', title: 'Cart'}),
        zustandAdapter(useSessionStore, {id: 'session', title: 'Session'}),
    ],
});
```

The tab is read-only. To change state from the UI, expose a [function](./functions) or a [panel](./panels) action.

## How changes are sent

- The device only watches a store while the State tab for it is open. The UI renews its subscription every 20 seconds;
  if it stops (the tab closed, the computer slept), the device stops after 60 seconds by itself.
- On subscribe the UI receives the whole state once. After that the device sends **JSON Patch** differences,
  at most every `throttleMs` (default 100 ms), merging changes in between. If a difference has more than `maxPatchOps`
  operations (default 500), the whole state is sent instead.
- The difference is computed against the last state sent and skips branches whose reference did not change. This
  assumes immutable updates, which is how Redux and Zustand work. A store that mutates objects in place will show
  stale values; give it a custom adapter whose `getState` returns a fresh copy or a summary.
- Functions in the state (Zustand actions) are left out. Values are serialised safely (dates, maps, sets, errors, cycles).
- When the UI resubscribes after a gap, it shows the difference as a "Changes while not watching" entry.

```ts
stateModule({stores, throttleMs: 250, maxPatchOps: 1000});
```

## Action names

`reduxAdapter` wraps `store.dispatch` while a subscription is active to learn the action type. Actions dispatched from
inside middleware (for example inside a thunk) bypass the wrapper and show up as "State changed". Zustand has no
action names.

## Your own adapter

```ts
import type {StateAdapter} from '@himmetkaan/remote-devtools';

const jotaiAdapter: StateAdapter = {
    id: 'settings',
    title: 'Settings',
    getState: () => jotaiStore.get(settingsAtom),
    subscribe: (listener) => jotaiStore.sub(settingsAtom, () => listener()),   // listener(actionName?)
};
```
