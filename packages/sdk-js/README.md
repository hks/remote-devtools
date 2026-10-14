# @himmetkaan/remote-devtools

The JavaScript SDK for [Remote DevTools](https://hks.github.io/remote-devtools/): inspect and control your React
Native, Expo, web or Node app from a desktop app or a self-hosted web UI.

```bash
npm install @himmetkaan/remote-devtools
```

```ts
import {functionsModule, networkModule, RemoteDevTools} from '@himmetkaan/remote-devtools';

const devtools = RemoteDevTools.init({
    enabled: __DEV__,          // off unless you enable it
    isDevelopment: __DEV__,    // find a local relay and ask to connect
    app: {id: 'com.example.app', name: 'Example', version: '1.0.0'},
    modules: [functionsModule(), networkModule()],
});

devtools.log.info('Ready');
```

Built-in modules: logs, network (fetch / XHR / axios), functions, storage (AsyncStorage, MMKV, Web Storage,
SecureStore), state (Redux, Zustand), flags and custom panels. No native dependencies; ES2020 output (Hermes compatible),
ESM and CommonJS with types.

- [Quick start: React Native / Expo](https://hks.github.io/remote-devtools/guide/quick-start-react-native)
- [Quick start: web](https://hks.github.io/remote-devtools/guide/quick-start-web)
- [SDK reference](https://hks.github.io/remote-devtools/reference/sdk)

MIT licensed.
