# Connecting devices

A UI **session** is what you see in one browser profile or in the desktop app. Any number of devices can join it.
There are four ways for a device to join:

| Method | When to use | Security |
|---|---|---|
| QR code | Physical devices, any network | Single-use token, valid for 2 minutes |
| 6-digit code | No camera, or a web app | Single-use, short-lived, failed attempts are rate limited per IP |
| Local discovery | Simulators, emulators, dev builds on your LAN | The UI must approve the connect request |
| mDNS (planned) | LAN discovery without knowing the host | Same approval as local discovery |

The QR code and the code are generated together and both become invalid as soon as one device uses them; the UI then
shows a fresh pair.

## QR code and 6-digit code

```ts
await devtools.connection.pairWithQr(qrText);                       // the QR contains the relay address
await devtools.connection.pairWithCode('123456', 'ws://192.168.1.10:8787');
```

The relay address for the code is shown under the code in the UI. The QR code points at the relay's `PUBLIC_URL`; if
the UI was opened on `localhost` it warns that a phone cannot reach that address.

## Local discovery and connect requests

When `isDevelopment: true`, the SDK probes `GET /discovery` on the configured hosts and ports (default hosts
`localhost` and `10.0.2.2`, ports `8787` and `8080`) and sends a **connect request** to the first relay that accepts
them. The UI shows the request at the top of every view:

- **Approve** pairs the device once.
- **Always allow** also remembers the device and app id; the next request from them is approved without asking.
- **Reject** tells the app to stop asking.

The relay only accepts connect requests when `CONNECT_REQUESTS` allows it: `off` (default for servers), `local`
(loopback and private networks; the desktop app and `pnpm dev:relay` use this) or `any`.

Trusted devices are listed on the pairing screen and can be removed there.

## Staying connected

After pairing, the SDK stores `{relayUrl, sessionId, deviceSecret}` in the `storage` you passed (AsyncStorage,
`localStorage` or memory) and resumes it on the next launch, so killing and reopening the app reconnects without
pairing again.

- While connected the pairing never expires. After the device disconnects, the relay forgets it after
  `DEVICE_IDLE_TTL_MIN` minutes (default 60) of inactivity.
- Network drops are retried with exponential backoff; returning to the foreground retries immediately.
- `connection.disconnect()` closes the socket but keeps the pairing (`connection.connect()` resumes it).
  `connection.unpair()` forgets it on both sides. **Unpair** in the UI does the same from the other end.

## Connection states

```ts
devtools.connection.subscribe((state) => {
    // state.status:
    //   'disabled'          enabled: false
    //   'idle'              not paired, or disconnect() was called
    //   'discovering'       looking for a local relay (isDevelopment)
    //   'connecting'
    //   'pending-approval'  waiting for Approve in the UI
    //   'connected'
    //   'reconnecting'      lost the connection, retrying with the stored pairing (state.retryAt)
    // state.error: the last failure, cleared on the next successful connection
});
```

## Several devices

Every device gets its own entry in the sidebar with its status, app and platform. Each device keeps separate logs,
requests and module state. Use `[` and `]` to switch devices and `1`–`9` to switch tabs.
