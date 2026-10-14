# Network

```ts
import {networkModule} from '@himmetkaan/remote-devtools';

const network = networkModule();
RemoteDevTools.init({/* … */ modules: [network]});
```

The Network tab lists requests with their status, method, URL, duration and size. Selecting one shows headers, the
request and response bodies as a JSON tree, and a cURL command. Filter by URL, method and result, pause the list, and
export the visible requests as HAR (Chrome DevTools, Charles, Proxyman) or JSON.

## Automatic capture

By default the module captures `fetch` and `XMLHttpRequest`. In React Native only `XMLHttpRequest` is patched, because
React Native's `fetch` and axios are built on it; patching both would show every request twice.

HTTP status ≥ 400 and network failures are marked as errors. The SDK's own discovery requests are never captured, and
the patches are removed when the SDK is destroyed.

## Options

```ts
networkModule({
    autoCapture: true,          // patch fetch / XMLHttpRequest
    captureFetch: true,         // default: true except in React Native
    captureXhr: true,
    ignoreUrls: [/\/analytics\//, 'https://sentry.io'],   // strings match as substrings
    maxBodySize: 1024 * 1024,   // longer bodies are truncated; the UI shows the original size
});
```

## axios and manual recording

With `autoCapture: false` you decide what is recorded. Attach to an axios instance:

```ts
const network = networkModule({autoCapture: false});
const detach = network.axios(apiClient);   // adds request / response interceptors
```

Or record calls from your own HTTP layer:

```ts
const call = network.record({method: 'POST', url, headers, body});
try {
    const res = await send();
    call.response({status: res.status, headers: res.headers, body: res.data});
} catch (e) {
    call.response({error: String(e)});
}
```

Pass `error` to mark a response as failed even when the HTTP status was fine (for example an API that reports errors
in the body).
