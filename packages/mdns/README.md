# @himmetkaan/remote-devtools-mdns

Optional mDNS (Bonjour) discovery for the [Remote DevTools](https://hks.github.io/remote-devtools/) SDK. Development
builds on the same Wi-Fi find a relay that advertises itself (the desktop app with **Network → Advertise on Local
Network**) without knowing the computer's address, then send a connect request you approve in the UI.

```bash
npx expo install @himmetkaan/remote-devtools-mdns react-native-zeroconf
```

```ts
import Zeroconf from 'react-native-zeroconf';
import {mdnsDiscovery, zeroconfBrowser} from '@himmetkaan/remote-devtools-mdns';

RemoteDevTools.init({
    // …
    isDevelopment: __DEV__,
    discovery: {providers: [mdnsDiscovery(zeroconfBrowser(new Zeroconf()))]},
});
```

Expo: add the config plugin (needs a development build; Expo Go cannot browse mDNS):

```json
{"expo": {"plugins": ["@himmetkaan/remote-devtools-mdns/plugin"]}}
```

Node: `mdnsDiscovery(bonjourBrowser(new Bonjour()))` with `bonjour-service`.

See [Connecting devices](https://hks.github.io/remote-devtools/guide/connecting#mdns-discovery). MIT licensed.
