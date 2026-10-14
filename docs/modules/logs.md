# Logs

The Logs tab is always there. It shows the app's logs next to connection and lifecycle events (paired, disconnected,
moved to the background…), with level, source and tag filters and a search box.

## Writing logs

```ts
devtools.log.debug('Cache warmed', {entries: 120});
devtools.log.info('Logged in', {userId});
devtools.log.warn('Slow response', {ms: 2400}, {tag: 'api'});
devtools.log.error('Payment failed', error, {tag: 'checkout'});
```

`data` can be anything: errors, circular objects, `Map`/`Set`, `BigInt` and deep structures are converted safely
before they are sent. `tag` shows up as a label and as a filter in the UI.

## Capturing the console

```ts
RemoteDevTools.init({
    // …
    captureConsole: ['warn', 'error'],   // or true for every level
});
```

Captured calls still reach the original console. They are tagged `console`.

## Logs from before pairing

With `history` on, the SDK keeps logs and module events (network requests, for example) in memory while it is not
connected and sends them, in order, right after it connects. The UI marks them as historic and slots them into the
timeline by their original time.

```ts
RemoteDevTools.init({
    // …
    history: {enabled: true, maxEntries: 500},   // off by default; the oldest entries are dropped first
});
```

The buffer lives in memory only, so it is lost when the app is killed.

## Device info

The device card above the tabs shows the app, platform and the `meta` fields you pass. Update them at any time:

```ts
devtools.updateMeta({userId: String(user.id), environment: 'staging'});
```
