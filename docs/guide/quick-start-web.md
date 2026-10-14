# Quick start: web

This page adds Remote DevTools to a web app and pairs it with a relay running on your machine.

## 1. Start a relay

Use the [desktop app](./desktop-app) (relay on port `8787`), or run the Docker image:

```bash
docker run --rm -p 8080:8080 -e CONNECT_REQUESTS=local ghcr.io/hks/remote-devtools
```

Open the UI at `http://localhost:8080` (or the desktop app window). With no devices connected it shows a QR code and a
6-digit pairing code.

## 2. Install the SDK

::: code-group

```bash [npm]
npm install @himmetkaan/remote-devtools
```

```bash [pnpm]
pnpm add @himmetkaan/remote-devtools
```

```bash [yarn]
yarn add @himmetkaan/remote-devtools
```

:::

## 3. Initialise it

```ts
import {functionsModule, networkModule, RemoteDevTools} from '@himmetkaan/remote-devtools';

const functions = functionsModule();

const devtools = RemoteDevTools.init({
    enabled: import.meta.env.DEV,          // required: false makes every API a no-op
    isDevelopment: import.meta.env.DEV,    // find the local relay and ask to connect
    app: {id: 'com.example.web', name: 'Example', version: '1.0.0'},
    captureConsole: ['warn', 'error'],
    modules: [functions, networkModule()],
});

functions.register({
    id: 'cache.clear',
    title: 'Clear cache',
    args: {scope: {type: 'select', options: ['images', 'all'], default: 'images'}},
    handler: ({scope}) => cache.clear(scope),
});

devtools.log.info('App started', {build: __BUILD__});
```

In a browser the SDK stores its device id and pairing in `localStorage` and follows page visibility for the
foreground / background state, so no extra options are needed.

## 4. Connect

With `isDevelopment: true` the page looks for a relay on `localhost:8787` and `localhost:8080`. The UI shows a
**connect request**; click **Approve** (tick **Always allow** to skip the prompt next time).

You can also pair explicitly, for example from a small dev-only form:

```ts
await devtools.connection.pairWithCode('123456', 'ws://localhost:8080');
```

See [Connecting devices](./connecting) for every pairing method.

## Try the example

The repository contains a complete example page that uses every module:

```bash
pnpm install
pnpm dev:relay      # relay on :8080 with connect requests enabled
pnpm dev:ui         # UI on :5173
pnpm dev:example    # example page on :5174
```
