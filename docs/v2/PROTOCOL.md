# Remote DevTools — Protokol v2 (taslak)

Bu doküman Faz 1'de `packages/protocol` olarak koda dökülecek sözleşmenin taslağıdır.
Tüm SDK'lar (JS, Swift, Kotlin, Flutter) bu dokümana bağlıdır. Taşıma katmanı JSON metin mesajlı WebSocket'tir.

---

## 1. Uç noktalar

| Yol | Kim bağlanır |
|---|---|
| `/ws/device` | SDK (app) |
| `/ws/ui` | UI (desktop veya tarayıcı) |
| `GET /health` | İzleme |
| `GET /discovery` | `isDevelopment` keşfi: `{ name, version, protocol: 2 }` |

mDNS (opsiyonel): servis tipi `_remotedevtools._tcp`. TXT kaydında `v=2`, `path=/ws/device` ve `name` bulunur.
mDNS protokolün zorunlu bir parçası değildir; bir SDK sadece QR, kod ve localhost yollarını destekleyerek de uyumlu sayılır.

## 2. Zarf

```ts
type Envelope<T extends string, P> = {
    v: 2;
    type: T;
    id: string;            // gönderen üretir
    ts: number;            // epoch ms
    replyTo?: string;      // bir isteğe cevapsa, isteğin id'si
    deviceId?: string;     // UI ↔ relay yönünde hangi cihaz (UI'dan cihaza giderken hedef, cihazdan gelirken kaynak)
    payload: P;
};
```

Kurallar:
- `v` uyuşmazsa relay `error{code:'UNSUPPORTED_VERSION'}` gönderir ve bağlantıyı kapatır.
- Bilinmeyen bir `module.*` tipi relay için hata **değildir**; iletilir. Bilinmeyen çekirdek tipi `UNKNOWN_TYPE` hatası alır.
- `deviceId` cihaz bağlantısında relay tarafından doldurulur. Cihazın gönderdiği değer dikkate alınmaz.

## 3. Çekirdek mesajlar — UI ↔ Relay

| Yön | Tip | Payload |
|---|---|---|
| UI→R | `session.create` | `{}` |
| UI→R | `session.resume` | `{ sessionId, uiSecret }` |
| R→UI | `session` | `{ sessionId, uiSecret, deviceWsUrl, pairing: PairingInfo, devices: DeviceSnapshot[], pendingRequests: ConnectRequest[], trustedDevices: TrustedDevice[] }` |
| UI→R | `pairing.refresh` | `{}` → yeni QR token'ı ve 6 haneli kod |
| R→UI | `pairing` | `PairingInfo` |
| R→UI | `device.status` | `{ deviceId, state: 'connected' \| 'disconnected' \| 'unpaired', device: DeviceSnapshot \| null }` |
| R→UI | `connect.request` | `ConnectRequest` (onay bekleyen cihaz) |
| UI→R | `connect.respond` | `{ requestId, approve: boolean, trust: boolean }` |
| UI→R | `device.unpair` | `{ deviceId }` |
| UI→R | `trusted.remove` | `{ deviceId }` |

```ts
type PairingInfo = { qrToken: string; code: string; expiresAt: number };
type ConnectRequest = { requestId: string; deviceId: string; hello: Hello; via: 'mdns' | 'localhost'; at: number };
type DeviceSnapshot = { deviceId: string; connected: boolean; pairedAt: number; expiresAt: number; lastSeenAt: number | null; hello: Hello | null; lifecycle: Lifecycle | null };
```

## 4. Çekirdek mesajlar — Device ↔ Relay

| Yön | Tip | Payload |
|---|---|---|
| D→R | `pair.qr` | `{ sessionId, qrToken, deviceId }` |
| D→R | `pair.code` | `{ code, deviceId }` |
| D→R | `connect` | `{ deviceId, hello }` (sadece `isDevelopment`, mDNS/localhost) |
| R→D | `connect.pending` | `{ requestId }` |
| R→D | `paired` | `{ sessionId, deviceSecret, expiresAt }` (QR, kod veya onaylanmış `connect` sonrası) |
| R→D | `connect.rejected` | `{ requestId }` |
| D→R | `resume` | `{ sessionId, deviceId, deviceSecret }` |
| R→D | `resumed` | `{ sessionId, expiresAt }` |
| D→R | `unpair` | `{}` |
| R→D | `unpaired` | `{ reason: 'byUi' \| 'byDevice' \| 'expired' \| 'sessionNotFound' \| 'invalidSecret' }` → SDK sakladığı bilgiyi siler |

Onaylı (trusted) bir cihaz `connect` gönderirse relay onay sormadan `paired` döner.

QR içeriği:
```json
{ "v": 2, "url": "wss://host/ws/device", "sessionId": "…", "qrToken": "…" }
```

## 5. Device → UI çekirdek mesajları (relay iletir)

| Tip | Payload |
|---|---|
| `hello` | `Hello` — her bağlantı/resume sonrası ilk mesaj |
| `capabilities.update` | `Partial<Capabilities>` — komut/flag/panel tanımları değişince |
| `lifecycle` | `{ state: 'active' \| 'background' \| 'inactive' }` |
| `log` | `{ level: 'debug' \| 'info' \| 'warn' \| 'error', message: string, data?: unknown, tag?: string, at: number }` |
| `history` | `{ logs: LogPayload[], modules: Record<string, unknown[]>, final: boolean }` — `history.enabled` ise bağlanınca parça parça |

```ts
type Hello = {
    app: { id: string; name: string; version: string; build?: string };
    device: { platform: 'ios' | 'android' | 'web' | 'macos' | 'windows' | 'linux' | string; os: string; model?: string; name?: string };
    sdk: { name: string; version: string };      // ör. "@remote-devtools/sdk", "remote-devtools-swift"
    isDevelopment: boolean;
    meta: Record<string, string>;                // developer'ın serbest alanları (userId, apiEndpoint, env…)
    capabilities: Capabilities;
};

type Capabilities = {
    network?: { autoCapture: boolean };
    functions?: { commands: CommandDef[] };
    storage?: { adapters: { id: string; title: string; editable: boolean }[] };
    state?: { stores: { id: string; title: string }[] };
    flags?: { flags: FlagDef[] };
    panels?: PanelDef[];
    [custom: string]: unknown;                   // ileride eklenecek modüller
};
```

## 6. Field DSL

Komut argümanları, flag'ler ve form blokları aynı alan tanımını kullanır.

```ts
type Field =
    | { type: 'text'; label?: string; placeholder?: string; multiline?: boolean; default?: string; required?: boolean }
    | { type: 'number'; label?: string; min?: number; max?: number; step?: number; default?: number; required?: boolean }
    | { type: 'boolean'; label?: string; default?: boolean }
    | { type: 'select'; label?: string; options: (string | { label: string; value: string | number })[]; default?: string | number; required?: boolean }
    | { type: 'json'; label?: string; default?: unknown };

type Fields = Record<string, Field>;   // anahtar = argüman adı; sıra korunur
```

SDK'lar `invoke` geldiğinde argümanları bu tanıma göre doğrular. Geçersizse handler çağrılmadan `ok:false` döner.

## 7. Modül mesajları

Tüm modül mesajları `module.<modül>.<olay>` biçimindedir. Relay bunların içine bakmaz.
UI→Device istekleri `id` taşır; cevaplar `replyTo` ile döner. Ortak cevap biçimi:
`{ ok: true, result } | { ok: false, error: { code, message } }`.

### network
| Yön | Tip | Payload |
|---|---|---|
| D→UI | `module.network.request` | `{ uuid, method, url, headers, body, startedAt }` |
| D→UI | `module.network.response` | `{ uuid, status, headers, body, durationMs, result: 'success' \| 'error', errorMessage, bodyTruncated?: { originalSize } }` |

### functions
```ts
type CommandDef = { id: string; title: string; description?: string; group?: string; confirm?: string; danger?: boolean; args?: Fields };
```
| Yön | Tip | Payload |
|---|---|---|
| UI→D | `module.functions.invoke` | `{ commandId, args }` |
| D→UI | `module.functions.result` | ortak cevap biçimi (`replyTo` ile) |

### storage
| Yön | Tip | Payload |
|---|---|---|
| UI→D | `module.storage.list` | `{ adapterId }` → `{ entries: { key, size, preview }[] }` |
| UI→D | `module.storage.get` | `{ adapterId, key }` → `{ value }` |
| UI→D | `module.storage.set` | `{ adapterId, key, value }` |
| UI→D | `module.storage.remove` | `{ adapterId, key }` |
| D→UI | `module.storage.changed` | `{ adapterId, key }` (adapter destekliyorsa) |

### state
| Yön | Tip | Payload |
|---|---|---|
| UI→D | `module.state.snapshot` | `{ storeId }` → `{ state }` |
| UI→D | `module.state.subscribe` / `unsubscribe` | `{ storeId }` |
| D→UI | `module.state.change` | `{ storeId, action?: string, state?: unknown, patch?: JsonPatch[] }` |

### flags
```ts
type FlagDef = { key: string; title?: string; description?: string; field: Field; value: unknown; overridden: boolean };
```
| Yön | Tip | Payload |
|---|---|---|
| UI→D | `module.flags.set` | `{ key, value }` |
| UI→D | `module.flags.reset` | `{ key? }` (boşsa hepsi) |
| D→UI | `module.flags.changed` | `{ key, value, overridden }` |

### panels
```ts
type PanelDef = { id: string; title: string; icon?: string; blocks: Block[] };

type Block =
    | { id: string; type: 'keyValue'; title?: string; data: Record<string, string | number | boolean | null> }
    | { id: string; type: 'table'; title?: string; columns: { key: string; title: string }[]; rows: Record<string, unknown>[]; rowActions?: ActionDef[] }
    | { id: string; type: 'json'; title?: string; data: unknown }
    | { id: string; type: 'actions'; title?: string; actions: ActionDef[] }
    | { id: string; type: 'form'; title?: string; fields: Fields; submit: { actionId: string; label: string } };

type ActionDef = { id: string; label: string; confirm?: string; danger?: boolean };
```
| Yön | Tip | Payload |
|---|---|---|
| D→UI | `module.panels.update` | `{ panelId, blockId, data }` (bloğun veri alanlarını değiştirir) |
| UI→D | `module.panels.action` | `{ panelId, actionId, row?: unknown, values?: Record<string, unknown> }` → ortak cevap |

## 8. Sınırlar

- Mesaj boyutu: varsayılan 1 MB (`MAX_PAYLOAD_BYTES`). SDK büyük body'leri kısaltır ve `bodyTruncated` bilgisini ekler.
- `history` ve büyük listeler `final` bayrağıyla parçalanır.
- Hız sınırı: cihaz başına saniyede N mesaj (relay ayarı). Aşılırsa mesajlar düşürülür ve UI'a bir kez `warn` logu gider.
- Heartbeat: 15 sn ping/pong (v1 ile aynı).
