# Self-hosting with Docker

The Docker image contains the relay and the built UI. Host it on a server to pair devices from anywhere over
`wss://`, or run it on your LAN.

## Single container

```bash
docker run -d --name remote-devtools -p 8080:8080 \
  -e PUBLIC_URL=http://192.168.1.10:8080 \
  ghcr.io/hks/remote-devtools
```

Open `http://localhost:8080`. `PUBLIC_URL` is the address written into the QR code, the one phones connect to. For
a LAN setup use your computer's IP (`ipconfig getifaddr en0` on macOS). If it is empty, the UI uses its own origin,
and warns when that is `localhost`.

## With TLS (docker compose + Caddy)

The repository ships a compose file that puts Caddy in front of the relay. Caddy gets a Let's Encrypt certificate
automatically when `SITE_ADDRESS` is a domain.

```bash
cd apps/server
cp .env.example .env     # edit the values
docker compose up -d --build
```

`.env` for a server:

```dotenv
PUBLIC_URL=https://devtools.example.com
SITE_ADDRESS=devtools.example.com
HTTP_PORT=80
HTTPS_PORT=443
```

The DNS record must point at the server and ports **80 and 443** must be reachable. Locally, `SITE_ADDRESS=:80` serves
plain HTTP on ports `8080` / `8443`.

Health check: `GET /health` → `{"ok": true, "sessions": N, "uptimeSec": N}`.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `PUBLIC_URL` | — | External address written into the QR code (`https://…` becomes `wss://…/ws/device`) |
| `WEB_DIST_DIR` | set in the image | Directory of the built UI to serve |
| `SESSION_TTL_HOURS` | `24` | A session with no UI connected is deleted after this; its device pairings go with it |
| `PAIR_TOKEN_TTL_SEC` | `120` | Lifetime of the QR token and the 6-digit code (both single-use) |
| `DEVICE_IDLE_TTL_MIN` | `60` | A disconnected device is forgotten after this much inactivity; never while connected |
| `CONNECT_REQUESTS` | `off` | Development connections without a code: `off` · `local` (loopback / private networks) · `any` |
| `CONNECT_REQUEST_TTL_SEC` | `120` | How long a connect request waits for an answer |
| `TRUST_PROXY` | `false` | Read the client address from `X-Forwarded-For` (`true` in the compose file) |
| `HEARTBEAT_INTERVAL_SEC` | `15` | Ping interval; a socket that misses a round is dropped |
| `AUTH_TIMEOUT_SEC` | `10` | Time a new socket has to authenticate |
| `MAX_PAYLOAD_MB` | `5` | Maximum size of one message |
| `MAX_SESSIONS` | `1000` | Concurrent session limit |
| `MAX_DEVICES_PER_SESSION` | `20` | Devices per session |
| `DEVICE_MAX_MSGS_PER_SEC` | `200` | Per-device message rate limit; excess messages are dropped |
| `PAIR_FAILURE_LIMIT` / `PAIR_FAILURE_WINDOW_SEC` | `10` / `600` | Failed pairing attempts allowed per IP and window |
| `STATE_FILE` | — | File for sessions, pairings and trusted devices; memory only when empty |

By default the relay keeps sessions in memory, so a restart drops all pairings. With `STATE_FILE`, sessions, device
pairings and trusted devices survive restarts. Only connection metadata is written (mode `0600`), never app data.

::: danger Keep `CONNECT_REQUESTS=off` on public servers
Connect requests let anyone who can reach the relay ask your UI to accept a device. On an internet-facing relay,
pair with the QR code or the 6-digit code instead.
:::

## Running without Docker

```bash
pnpm install && pnpm build
PUBLIC_URL=http://192.168.1.10:8787 WEB_DIST_DIR=packages/ui/dist PORT=8787 node packages/relay/dist/main.js
```

After deploying you can check the whole flow with the smoke test from the repository root:

```bash
node packages/relay/scripts/smoke.ts wss://devtools.example.com
```
