![Remote DevTools](./docs/public/banner.webp)

# Remote DevTools

Your app's developer menu, on your computer. Add a small SDK to a React Native, Expo or web app, pair it with a QR code,
and inspect logs, network traffic, state, storage and feature flags from a desktop app or a self-hosted web UI. Expose
functions and custom panels to drive the app from the same place.

**[Documentation](https://hks.github.io/remote-devtools/)** ·
[Quick start (React Native)](https://hks.github.io/remote-devtools/guide/quick-start-react-native) ·
[Quick start (web)](https://hks.github.io/remote-devtools/guide/quick-start-web) ·
[Protocol](https://hks.github.io/remote-devtools/reference/protocol)

## Features

- **Logs** with levels and tags, captured `console` output, and events from before the device connected.
- **Network**: `fetch`, `XMLHttpRequest` and axios, with a JSON tree, cURL and HAR export.
- **Functions**: register actions in the app and run them from the UI, with forms for their arguments.
- **Storage**: browse and edit AsyncStorage, MMKV, `localStorage` and (read-only) SecureStore.
- **State**: Redux and Zustand state as a live JSON tree with a change timeline.
- **Flags**: typed feature flags with overrides that persist on the device.
- **Custom panels**: describe your own tabs with tables, stats, forms and buttons, without UI code.
- **Pairing**: QR code, 6-digit code, or automatic discovery for simulators and development builds. Several devices at once.
- **Safe by default**: the SDK does nothing unless enabled; the UI keeps nothing on disk.

## Quick look

```ts
import {functionsModule, networkModule, RemoteDevTools} from '@himmetkaan/remote-devtools';

const functions = functionsModule();

const devtools = RemoteDevTools.init({
    enabled: __DEV__,                       // false makes every API a no-op
    isDevelopment: __DEV__,                 // find the local relay and ask to connect
    app: {id: 'com.example.app', name: 'Example', version: '1.0.0'},
    modules: [functions, networkModule()],
});

functions.register({
    id: 'cache.clear',
    title: 'Clear cache',
    args: {scope: {type: 'select', options: ['images', 'all'], default: 'images'}},
    handler: ({scope}) => cache.clear(scope),
});

devtools.log.info('Ready');
```

Then open the [desktop app](https://hks.github.io/remote-devtools/guide/desktop-app) or run the relay and UI with Docker:

```bash
docker run --rm -p 8080:8080 -e CONNECT_REQUESTS=local ghcr.io/hks/remote-devtools
```

## Repository

| Path | Contents |
|---|---|
| `packages/sdk-js` | `@himmetkaan/remote-devtools`, the JS SDK and its modules |
| `packages/protocol` | `@himmetkaan/remote-devtools-protocol`, the wire protocol types and helpers |
| `packages/relay` | The relay server (Node + ws) |
| `packages/ui` | The web UI (React) |
| `apps/desktop` | The Electron desktop app (relay and UI built in) |
| `apps/server` | Docker image and compose file |
| `examples/web` | An example page using every module |
| `docs` | The documentation site |

```bash
pnpm install
pnpm dev:relay      # relay on :8080
pnpm dev:ui         # UI on :5173
pnpm dev:example    # example app on :5174
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [development guide](https://hks.github.io/remote-devtools/maintainers/development).

## License

[MIT](./LICENSE)
