# Security

Remote DevTools shows a lot of an app's internals, including request headers, tokens in storage and application state.
Treat a paired UI like a debugger attached to the app.

## What protects a session

- **The SDK is off by default.** Nothing happens until the app passes `enabled: true`. Decide carefully which builds
  and which users can switch it on.
- **Pairing tokens are single-use.** The QR token and the 6-digit code expire after two minutes (`PAIR_TOKEN_TTL_SEC`)
  and become invalid once any device uses them. Failed code attempts are rate limited per IP.
- **Secrets are random and compared in constant time.** The UI and device secrets are random 24+ byte values.
- **Sessions are isolated.** A device belongs to exactly one UI session. Another browser that opens the UI gets its own
  empty session and sees nothing.
- **Connect requests need approval.** Development builds can only join after you click **Approve**, and only when the
  relay allows connect requests at all (`CONNECT_REQUESTS`). Trusting a device skips the prompt for that device id
  and app id, so enable connect requests only on networks you trust.
- **Nothing is stored in the UI.** Logs, requests and state live in memory and are gone when the page closes. The relay
  forwards messages without storing them; with `STATE_FILE` it stores connection metadata only.

## What is not protected yet

- **The UI has no login.** Anyone who can open the UI can create a session and show a pairing code. They cannot see your
  devices, but they can pair a device of their own. On a public server, restrict access with a VPN, an IP allowlist or
  HTTP basic auth in front of the relay (for example Caddy's `basic_auth`).
- **Data is not masked.** Request headers (including `Authorization`), bodies, storage values and state are sent as
  they are. Use `network.ignoreUrls`, read-only or masked storage adapters, and state adapters that leave out secrets
  where needed.
- **Local relays use plain `ws://`.** Traffic on your LAN is unencrypted. Use `wss://` through a TLS-terminating proxy
  for anything beyond a trusted network.

## Reporting a vulnerability

Please report security issues privately through GitHub's
[security advisories](https://github.com/hks/remote-devtools/security/advisories/new) rather than in a public issue.
