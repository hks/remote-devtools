# Introduction

Remote DevTools lets you inspect and control a running app from your computer. You add the JavaScript SDK to your app
(React Native / Expo, a web page or Node), pair the app with the Remote DevTools UI, and get tabs for logs, network
requests, state, storage, feature flags, functions you expose and panels you design yourself.

It is built for the moments when the usual debugger is out of reach: a physical phone on the desk, a TestFlight or
internal build, a QA colleague's device, or a production build where you switched the developer menu on.

## How it fits together

```
┌──────────────────────────┐   ws / wss   ┌────────────────────────────┐
│ Your app                 │◄────────────►│ Relay                      │
│  └─ @himmetkaan/remote-  │  /ws/device  │  sessions · pairing ·      │
│     devtools + modules   │              │  forwards module messages  │
└──────────────────────────┘              └─────────────┬──────────────┘
                                                        │ /ws/ui
                                          ┌─────────────┴──────────────┐
                                          │ UI (React)                 │
                                          │  ├─ desktop app (Electron, │
                                          │  │   relay built in)       │
                                          │  └─ browser (Docker image) │
                                          └────────────────────────────┘
```

- **SDK** — a thin core plus optional modules. It is **off by default**: until you pass `enabled: true` it opens no
  socket, patches nothing and every API is a no-op.
- **Relay** — a small Node server that pairs devices with UI sessions and forwards messages. It never looks inside
  module messages, so new modules need no relay changes. It runs inside the desktop app, or as a Docker image you host.
- **UI** — shows one tab per capability the app reports. A tab only appears if the app enables that module.
  The UI keeps everything in memory; closing it discards logs and requests.

## Tabs

| Tab | Appears when | What it does |
|---|---|---|
| 📜 Logs | Always | Device logs and connection / lifecycle events; level, source and tag filters, search |
| 🌐 Network | `networkModule()` | Requests and responses; filters, JSON tree, cURL, HAR / JSON export |
| 🧩 Functions | `functionsModule()` | Functions the app registered; arguments rendered as forms |
| 🗄️ Storage | `storageModule()` | AsyncStorage / MMKV / localStorage / SecureStore keys; view, edit, delete |
| 🧠 State | `stateModule()` | Redux / Zustand state as a JSON tree with a live change timeline |
| 🚩 Flags | `flagsModule()` | Flags the app defined; type-aware editors and persistent overrides |
| 🧱 Custom | `panelsModule()` | Your own panels: text, stats, key-value, tables, JSON, buttons, forms |

Several devices can be connected at once; pick one in the sidebar.

## Packages

| Package | Purpose |
|---|---|
| `@himmetkaan/remote-devtools` | The JS SDK (React Native, browsers, Node) with all built-in modules |
| `@himmetkaan/remote-devtools-protocol` | Message types, the field DSL and helpers shared by the SDK, relay and UI |
| Desktop app | macOS app with the relay and UI built in ([Desktop app](./desktop-app)) |
| Docker image | Relay + UI for a server or your LAN ([Self-hosting](./self-hosting)) |

The wire protocol is documented in full ([Protocol](../reference/protocol)), so SDKs for other platforms can be written
against it ([Writing an SDK](../reference/write-an-sdk)).

## Next steps

- [Quick start: web](./quick-start-web)
- [Quick start: React Native / Expo](./quick-start-react-native)
- [Connecting devices](./connecting)
