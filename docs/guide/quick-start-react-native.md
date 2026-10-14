# Quick start: React Native / Expo

The SDK is plain TypeScript with no native code, so it works in Expo Go, development builds and bare React Native.
It does not import `react-native` itself; you hand it the few platform pieces it needs.

## 1. Install

```bash
npx expo install @himmetkaan/remote-devtools @react-native-async-storage/async-storage
```

AsyncStorage is used to remember the device id and the pairing, so the app reconnects by itself after a restart.

## 2. Initialise

Create the instance once, for example in a module imported by your root layout:

```ts
// devtools.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {AppState, Platform} from 'react-native';
import {
    functionsModule,
    networkModule,
    reactNativeLifecycle,
    RemoteDevTools,
} from '@himmetkaan/remote-devtools';

export const functions = functionsModule();

export const devtools = RemoteDevTools.init({
    enabled: __DEV__ || isInternalBuild,          // off in production unless you switch it on
    isDevelopment: __DEV__,                       // simulators / emulators find the local relay
    app: {id: 'com.example.app', name: 'Example', version: '1.4.0', build: '210'},
    device: {platform: Platform.OS, os: String(Platform.Version)},
    meta: {environment: 'staging'},               // shown on the device card in the UI
    storage: AsyncStorage,
    lifecycle: reactNativeLifecycle(AppState),
    history: {enabled: true, maxEntries: 500},    // send what happened before pairing
    captureConsole: ['warn', 'error'],
    modules: [functions, networkModule()],
});
```

`networkModule()` captures `XMLHttpRequest` (which React Native's `fetch` and axios use) automatically.

::: tip Enabling it outside development
`enabled` is the only gate. A common pattern is to start the SDK when a hidden developer menu is switched on and call
`devtools.destroy()` when it is switched off. While disabled the SDK opens no sockets and patches nothing.
:::

## 3. Connect

**Simulator / emulator** — with `isDevelopment: true` the app looks for a relay on `localhost` (iOS simulator) and
`10.0.2.2` (Android emulator), ports `8787` and `8080`, and sends a connect request you approve in the UI.

**Physical device on the same network** — add your computer's address to the discovery hosts. In Expo the Metro
host is a good guess:

```ts
import Constants from 'expo-constants';

const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];

RemoteDevTools.init({
    // …
    discovery: {localhost: {hosts: ['localhost', '10.0.2.2', ...(metroHost ? [metroHost] : [])]}},
});
```

**Any device, any network** — scan the QR code or type the 6-digit code shown in the UI:

```ts
await devtools.connection.pairWithQr(scannedText);
await devtools.connection.pairWithCode('123456', 'https://devtools.example.com');
```

The SDK only gives you state and actions; the connect screen is yours to design. Subscribe to the state to show it:

```tsx
const [state, setState] = useState(devtools.connection.state);
useEffect(() => devtools.connection.subscribe(setState), []);
// state.status: 'idle' | 'discovering' | 'connecting' | 'pending-approval' | 'connected' | 'reconnecting' | 'disabled'
```

## 4. Add more modules

```ts
import {asyncStorageAdapter, flagsModule, stateModule, storageModule, zustandAdapter} from '@himmetkaan/remote-devtools';

const flags = flagsModule();
export const newCheckout = flags.define({key: 'checkout.v2', title: 'New checkout', field: {type: 'boolean'}});

RemoteDevTools.init({
    // …
    modules: [
        functions,
        networkModule(),
        storageModule({adapters: [asyncStorageAdapter(AsyncStorage)]}),
        stateModule({stores: [zustandAdapter(useCartStore, {id: 'cart', title: 'Cart'})]}),
        flags,
    ],
});
```

Each module has its own page under **Modules**.

## Troubleshooting

- **The app does not find the relay.** Check that the relay accepts connect requests (`CONNECT_REQUESTS=local`; the
  desktop app does by default) and that the phone and computer are on the same network. Guest and corporate Wi-Fi
  networks often block traffic between devices.
- **iOS asks for local network access.** Allow it (Settings → Privacy & Security → Local Network); without it the app
  cannot reach your computer.
- **Plain `ws://` to a non-local address fails on iOS.** App Transport Security blocks it. Use a `wss://` relay
  ([Self-hosting](./self-hosting)) or a tunnel such as `cloudflared`.
