# Writing an SDK

The relay and the UI only speak the [protocol](./protocol), so an SDK for Swift, Kotlin, Flutter or any other platform
works with them as long as it follows that document. This page is a checklist of what a compatible SDK has to do, in
the order you will probably build it. The JS SDK (`packages/sdk-js`) is the reference implementation.

## 1. Transport and envelope

- Open a WebSocket to `<relay>/ws/device` and exchange JSON text messages.
- Every message is an envelope `{v: 2, type, id, ts, payload}`; add `replyTo` when answering a request.
- Generate a unique `id` per message. `payload` is always an object.
- Accept addresses as `ws(s)://host[:port]` or `http(s)://…` and append `/ws/device` when it is missing.

## 2. Device identity and storage

- Generate a `deviceId` once per installation (`[A-Za-z0-9_-]{8,128}`) and keep it.
- After pairing, store `{relayUrl, sessionId, deviceSecret, expiresAt}`. Use secure storage where the platform has it.

## 3. Pairing

Implement at least one of:

| Path | Send | Expect |
|---|---|---|
| QR | parse `{v, url, sessionId, qrToken}`, connect to `url`, send `pair.qr {sessionId, qrToken, deviceId}` | `paired {sessionId, deviceSecret, expiresAt}` |
| Code | connect to the relay the user typed, send `pair.code {code, deviceId}` | `paired` |
| Connect request | `GET /discovery` on candidate hosts; if `connectRequests` is not `off`, send `connect {deviceId, hello}` | `connect.pending`, then `paired` or `connect.rejected` |

On `error` or a close code (see the protocol's close codes) report the failure to the app. After `connect.rejected`
stop asking until the user retries.

## 4. Resume and reconnect

- On launch, if a stored pairing exists and has not expired locally, connect and send
  `resume {sessionId, deviceId, deviceSecret}` as the first message; expect `resumed`.
- On `unpaired` (any reason) delete the stored pairing and go back to idle.
- When the socket drops, reconnect with exponential backoff and jitter; retry immediately when the app returns to the
  foreground. Keep the pairing while retrying.
- Every message and every disconnect slides the expiry on the relay; mirror that locally so you can skip a resume that
  would certainly fail.

## 5. Hello and core messages

Right after `paired` or `resumed`, send in this order:

1. `hello {app, device, sdk: {name, version}, isDevelopment, meta, capabilities}`. Send it again whenever `meta`
   changes.
2. `lifecycle {state: 'active' | 'background' | 'inactive'}`, and again on every change.
3. If you buffered events while disconnected, `history {entries: [{type, payload, ts}], final}` in order, split into
   chunks below the message size limit.

Logs are `log {level, message, data?, tag?, at}`.

`capabilities` holds one key per enabled module. The UI shows a tab only for modules listed there; send
`capabilities.update` with the changed keys when a module's capabilities change while connected.

## 6. Modules

All module messages are `module.<module>.<event>`. UI requests carry an `id`; answer each one with
`module.<module>.result` and `replyTo: <request id>` containing `{ok: true, result}` or
`{ok: false, error: {code, message}}`. Never leave a request unanswered: unknown commands should still get an error.

Start with the modules that are cheapest on your platform:

- **functions** — validate arguments with the [field DSL](./field-dsl) rules before calling the handler.
- **network** — `module.network.request` and `module.network.response`, matched by `uuid`. Truncate large bodies and
  report `bodyTruncated`.
- **storage**, **state**, **flags**, **panels** — see their message tables in the protocol.

## 7. Safety and behaviour

- Off by default: nothing may open a socket or hook into the app until the developer enables the SDK.
- Never block or crash the host app: serialise payloads defensively (cycles, binary data, huge values) and catch every
  handler error.
- Keep within the relay's limits: 5 MB per message and 200 messages per second per device by default.

## Testing against the relay

Run a relay with `pnpm dev:relay` (connect requests enabled) and the UI with `pnpm dev:ui`, then pair your SDK. The JS
SDK's fake device (`node packages/sdk-js/scripts/fake-device.ts`) is a handy side-by-side reference, and
`packages/relay/scripts/smoke.ts` shows the full pairing flow in a few dozen lines.
