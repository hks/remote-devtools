# Storage

The Storage tab lists the keys of your app's key-value stores with their size and a preview. Selecting a key shows its
value, as a JSON tree when it is JSON. Editable stores also let you change values, add keys, delete keys and clear the
store, each delete asking for confirmation.

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {asyncStorageAdapter, mmkvAdapter, secureStoreAdapter, storageModule} from '@himmetkaan/remote-devtools';
import * as SecureStore from 'expo-secure-store';

const storage = storageModule({
    adapters: [
        asyncStorageAdapter(AsyncStorage),
        mmkvAdapter(mmkv, {id: 'mmkv-cache', title: 'MMKV · cache'}),
        secureStoreAdapter(SecureStore, {keys: ['auth.token', 'auth.refresh']}),
    ],
});
```

The SDK never imports these libraries; you pass the instances in.

## Built-in adapters

| Adapter | Notes |
|---|---|
| `asyncStorageAdapter(AsyncStorage)` | Uses `multiGet` when available. **Clear** removes the listed keys (it does not call `AsyncStorage.clear()`) |
| `mmkvAdapter(instance)` | react-native-mmkv v3 and v4. Reports changes to the UI live. Non-string values are shown as numbers or booleans |
| `webStorageAdapter(localStorage)` | Also takes `sessionStorage`. Changes from other browser tabs show up live; use **Refresh** for the same page |
| `secureStoreAdapter(SecureStore, {keys})` | Read-only and masked: previews are not sent and values stay hidden until you click **Reveal**. SecureStore cannot list keys, so you pass the ones to show |

Every adapter takes `{id, title}` to tell several stores of the same kind apart.

## Read-only stores

An adapter without `set` and `remove` is read-only, and the UI hides the editing controls. To show an editable store
read-only, drop those methods:

```ts
const {set, remove, clear, ...readOnly} = asyncStorageAdapter(AsyncStorage);
storageModule({adapters: [readOnly]});
```

## Your own adapter

```ts
import type {StorageAdapter} from '@himmetkaan/remote-devtools';

const cacheAdapter: StorageAdapter = {
    id: 'image-cache',
    title: 'Image cache',
    keys: () => cache.keys(),
    get: (key) => cache.describe(key),            // string | null
    remove: (key) => cache.evict(key),            // optional (with set) to make it editable
    set: (key, value) => cache.put(key, value),
    subscribe: (listener) => cache.onChange((key) => listener(key)),   // optional live updates
    // masked: true                               // hide values until revealed
};
```

Adapters can be added and removed at runtime with `storage.register(adapter)` and `storage.unregister(id)`.
