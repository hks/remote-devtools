# Development setup

Requirements: Node 24+ and pnpm (`corepack enable` is enough). Run commands from the repository root.

```bash
pnpm install
```

## Repository layout

```
packages/
  protocol/     @himmetkaan/remote-devtools-protocol: message types, field DSL, JSON patch helpers (no dependencies)
  relay/        @himmetkaan/remote-devtools-relay: Node + ws; library (createRelay) and CLI
  sdk-js/       @himmetkaan/remote-devtools: the JS SDK and its modules; scripts/fake-device.ts
  ui/           @himmetkaan/remote-devtools-ui: Vite + React; one folder per tab in src/modules
apps/
  desktop/      Electron app: embedded relay + UI
  server/       Docker image (UI build + bundled relay), compose file with Caddy
examples/
  web/          A page that uses every SDK module
docs/           This site (VitePress)
```

TypeScript runs directly in Node through type stripping during development, so the relay, tests and scripts need no
build step. Only "erasable" TypeScript is used (no enums or namespaces).

## Everyday commands

```bash
pnpm dev:relay        # relay on :8080 with CONNECT_REQUESTS=local
pnpm dev:ui           # UI on :5173, proxies /ws and /health to the relay
pnpm dev:example      # example page on :5174
pnpm dev:desktop      # build and open the Electron app
pnpm docs:dev         # this documentation site
```

```bash
pnpm typecheck && pnpm test      # every package
pnpm build                       # every package, the desktop app bundle and the docs
```

## Trying things without a phone

The fake device uses the SDK itself:

```bash
node packages/sdk-js/scripts/fake-device.ts dev 8080              # find the local relay, ask to connect
node packages/sdk-js/scripts/fake-device.ts code 123456 ws://127.0.0.1:8080
node packages/sdk-js/scripts/fake-device.ts qr '<QR content>'
```

Type commands on stdin: `bg`, `fg`, `log|debug|warn|err <message>`, `name <text>`, `net <url>`, `set <key> <value>`,
`inc`, `flags`, `drop`, `resume`, `unpair`, `quit`. The fake device registers sample functions, a storage adapter, a
state store, two flags and a panel.

The relay smoke test runs the whole pairing flow against a running relay:

```bash
node packages/relay/scripts/smoke.ts ws://127.0.0.1:8080
```

## Adding a UI tab for a module

1. Create `packages/ui/src/modules/<name>/<Name>Tab.tsx`; it receives `{deviceId}`.
2. Register it in `packages/ui/src/modules/registry.ts` with the capability key that turns it on.
3. Read the capability from `device.hello.capabilities[<name>]`, send requests with `relayClient.request(...)` and
   listen to events with `relayClient.subscribe(...)` (see `modules/network/ingest.ts`).

## Changing the protocol

`packages/protocol/src/index.ts` and [the protocol page](../reference/protocol) must change together. Bump
`PROTOCOL_VERSION` for incompatible changes: the relay rejects other versions with `UNSUPPORTED_VERSION`.
