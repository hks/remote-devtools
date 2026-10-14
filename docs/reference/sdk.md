# JS SDK

`@himmetkaan/remote-devtools` runs in React Native, browsers and Node. It ships as ESM and CommonJS with type
definitions and targets ES2020 (Hermes compatible). It has no native dependencies and does not import `react-native`.

## `RemoteDevTools.init(options)`

Creates the app-wide instance and starts it. Calling it again destroys the previous instance first.
`RemoteDevTools.instance` returns the current one (or `null`).

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | — | **Required.** When `false` nothing happens: no socket, no modules, no patched globals; every API is a no-op |
| `isDevelopment` | `boolean` | `false` | Look for a local relay and send a connect request |
| `app` | `{id, name, version, build?}` | — | Shown in the UI; `id` is part of the trusted-device check |
| `device` | `{platform, os, model?, name?}` | detected | Guessed in browsers and Node; pass `platform` and `os` in React Native |
| `meta` | `Record<string, string>` | `{}` | Free-form fields on the device card (user id, environment…) |
| `modules` | `RemoteModule[]` | `[]` | Modules to enable; each needs a unique `name` |
| `storage` | `KeyValueStorage` | `localStorage`, else memory | Device id, pairing and module data (e.g. flag overrides). Pass AsyncStorage in React Native |
| `storageKey` | `string` | `'remote-devtools'` | Prefix for storage keys |
| `lifecycle` | `LifecycleSource` | page visibility | Foreground / background source; `reactNativeLifecycle(AppState)` in React Native |
| `history` | `{enabled, maxEntries?}` | off | Buffer logs and module events while not connected; `maxEntries` defaults to 500 |
| `discovery.localhost` | `boolean \| {port?, hosts?, timeoutMs?}` | on | Local relay probing (only with `isDevelopment`); ports `[8787, 8080]`, hosts `['localhost', '10.0.2.2']` |
| `discovery.providers` | `DiscoveryProvider[]` | `[]` | Extra discovery methods |
| `discovery.intervalMs` | `number` | `5000` | Retry interval when no relay is found |
| `captureConsole` | `boolean \| LogLevel[]` | off | Forward `console.*` calls as logs |
| `reconnect` | `{minDelayMs?, maxDelayMs?}` | `1000` / `30000` | Exponential backoff with jitter |
| `WebSocket` | constructor | global `WebSocket` | For environments without one (e.g. the `ws` package in older Node) |
| `debug` | `boolean` | `false` | Print the SDK's own diagnostics to the console |

## Instance

```ts
devtools.enabled;                         // the `enabled` option
devtools.log.info(message, data?, {tag?}); // debug / info / warn / error
devtools.updateMeta({userId: '42'});      // merges and re-sends the device info
devtools.destroy();                       // close the socket, tear down modules, restore patched globals
```

## Connection

```ts
devtools.connection.state;                         // ConnectionState
devtools.connection.subscribe((state) => {});      // called immediately and on every change; returns unsubscribe
await devtools.connection.pairWithQr(qrText);
await devtools.connection.pairWithCode(code, relayUrl);   // relayUrl: http(s):// or ws(s):// base address
devtools.connection.connect();                     // resume with the stored pairing
devtools.connection.disconnect();                  // close, keep the pairing
devtools.connection.unpair();                      // close and forget the pairing on both sides
await devtools.connection.discover();              // run local discovery now
```

```ts
type ConnectionState = {
    status: 'disabled' | 'idle' | 'discovering' | 'connecting' | 'pending-approval' | 'connected' | 'reconnecting';
    deviceId: string | null;
    relayUrl: string | null;
    sessionId: string | null;
    requestId: string | null;        // pending connect request
    error: {code: string; message: string} | null;
    retryAt: number | null;          // next reconnect attempt
};
```

## Helpers

| Export | Purpose |
|---|---|
| `reactNativeLifecycle(AppState)`, `browserLifecycle()`, `staticLifecycle()` | Lifecycle sources |
| `memoryStorage()`, `defaultStorage()` | `KeyValueStorage` implementations |
| `localhostDiscovery(options)` | The built-in discovery provider, to combine with custom ones |
| `defineModule`, `ModuleError` | [Writing a module](../modules/custom-modules) |
| `toSerializable(value, {maxDepth?, omitFunctions?})` | The safe serialiser used for every payload |
| `validateArgs(fields, input)` | [Field DSL](./field-dsl) validation |
| `functionsModule`, `networkModule`, `storageModule`, `stateModule`, `flagsModule`, `panelsModule` | Built-in modules |
| `asyncStorageAdapter`, `mmkvAdapter`, `webStorageAdapter`, `secureStoreAdapter` | Storage adapters |
| `reduxAdapter`, `zustandAdapter` | State adapters |

### Interfaces you can implement

```ts
type KeyValueStorage = {
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): void | Promise<void>;
    removeItem(key: string): void | Promise<void>;
};

type LifecycleSource = {
    current(): 'active' | 'background' | 'inactive';
    subscribe(listener: (state: 'active' | 'background' | 'inactive') => void): () => void;
};

type DiscoveryProvider = {
    name: string;
    /** Device WebSocket URLs of relays that accept connect requests, e.g. ws://192.168.1.10:8787/ws/device */
    find(signal: AbortSignal): Promise<string[]>;
};
```
