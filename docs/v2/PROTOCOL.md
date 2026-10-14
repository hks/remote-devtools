# Remote DevTools — Protokol v2

Kaynak kod: [`packages/protocol/src/index.ts`](../../packages/protocol/src/index.ts). Relay tarafı Faz 1'de uygulandı;
modül mesajları (§7) SDK ve UI ile birlikte Faz 2–8'de netleşecek.
Tüm SDK'lar (JS, Swift, Kotlin, Flutter) bu dokümana bağlıdır. Taşıma katmanı JSON metin mesajlı WebSocket'tir.

---

## 1. Uç noktalar

| Yol | Kim bağlanır |
|---|---|
| `/ws/device` | SDK (app) |
| `/ws/ui` | UI (desktop veya tarayıcı) |
| `GET /health` | İzleme: `{ ok, sessions, uptimeSec }` |
| `GET /discovery` | `isDevelopment` keşfi: `{ name: 'remote-devtools', version, protocol: 2, host, connectRequests }` |

`/health` ve `/discovery` sır içermez ve `Access-Control-Allow-Origin: *` döner (tarayıcıdaki SDK'lar da okuyabilsin diye).

mDNS (opsiyonel): servis tipi `_remotedevtools._tcp`. TXT kaydında `v=2`, `path=/ws/device` ve `name` bulunur.
mDNS protokolün zorunlu bir parçası değildir; bir SDK sadece QR, kod ve localhost yollarını destekleyerek de uyumlu sayılır.

## 2. Zarf

```ts
type Envelope<T extends string, P> = {
    v: 2;
    type: T;
    id: string;            // gönderen üretir
    ts: number;            // epoch ms
    replyTo?: string;      // bir isteğe cevapsa, isteğin id'si (relay'in kendi cevapları ve hataları dahil)
    deviceId?: string;     // UI ↔ relay yönünde hangi cihaz (UI'dan cihaza giderken hedef, cihazdan gelirken kaynak)
    payload: P;
};
```

Kurallar:
- `v` uyuşmazsa relay `error{code:'UNSUPPORTED_VERSION'}` gönderir ve bağlantıyı `4005` ile kapatır.
- Bilinmeyen bir `module.*` tipi relay için hata **değildir**; iletilir. Bilinmeyen çekirdek tipi `UNKNOWN_TYPE` hatası alır.
- `deviceId` cihazdan gelen mesajlarda relay tarafından doldurulur. Cihazın gönderdiği değerin üzerine yazılır.
- Hatalar: `error { code, message }`, isteğe bağlıysa `replyTo` ile.

## 3. Çekirdek mesajlar — UI ↔ Relay

| Yön | Tip | Payload |
|---|---|---|
| UI→R | `session.create` | `{}` |
| UI→R | `session.resume` | `{ sessionId, uiSecret }` |
| R→UI | `session` | `{ sessionId, uiSecret, deviceWsUrl, pairing: PairingInfo, devices: DeviceSnapshot[], pendingRequests: ConnectRequest[], trustedDevices: TrustedDevice[] }` |
| UI→R | `pairing.refresh` | `{}` → yeni QR token'ı ve 6 haneli kod |
| R→UI | `pairing` | `PairingInfo` — yenilendiğinde ve her eşleşmeden sonra (QR/kod tek kullanımlıktır) |
| R→UI | `device.status` | `{ deviceId, state: 'connected' \| 'disconnected' \| 'unpaired', device: DeviceSnapshot \| null }` |
| R→UI | `connect.request` | `ConnectRequest` (onay bekleyen cihaz) |
| UI→R | `connect.respond` | `{ requestId, approve: boolean, trust: boolean }` |
| R→UI | `connect.resolved` | `{ requestId, outcome: 'approved' \| 'rejected' \| 'expired' \| 'cancelled' }` — istek listeden kalkar |
| UI→R | `device.unpair` | `{ deviceId }` |
| UI→R | `trusted.remove` | `{ deviceId }` |
| R→UI | `trusted` | `{ devices: TrustedDevice[] }` — liste değiştiğinde |
| UI→D | `module.*` | zarfta hedef `deviceId` zorunlu; cihaz yoksa `DEVICE_NOT_FOUND`, çevrimdışıysa `DEVICE_OFFLINE` |

```ts
type PairingInfo = { qrToken: string; code: string; expiresAt: number };
type ConnectRequest = { requestId: string; deviceId: string; hello: Hello; via: 'local' | 'remote'; at: number; expiresAt: number };
type DeviceSnapshot = { deviceId: string; connected: boolean; pairedAt: number; expiresAt: number; lastSeenAt: number | null; hello: Hello | null; lifecycle: Lifecycle | null };
type TrustedDevice = { deviceId: string; appId: string; name: string; trustedAt: number };
```

`via`: relay mDNS ile localhost'u ayırt edemez; sadece adresin sınıfını bilir (loopback/özel ağ = `local`).

## 4. Çekirdek mesajlar — Device ↔ Relay

| Yön | Tip | Payload |
|---|---|---|
| D→R | `pair.qr` | `{ sessionId, qrToken, deviceId }` |
| D→R | `pair.code` | `{ code, deviceId }` |
| D→R | `connect` | `{ deviceId, hello }` (sadece `isDevelopment`; relay'in `CONNECT_REQUESTS` ayarına bağlı) |
| R→D | `connect.pending` | `{ requestId, expiresAt }` |
| R→D | `paired` | `{ sessionId, deviceSecret, expiresAt }` (QR, kod veya onaylanmış `connect` sonrası) |
| R→D | `connect.rejected` | `{ requestId \| null, reason: 'rejected' \| 'expired' \| 'disabled' \| 'noSession' \| 'deviceLimit' }` |
| D→R | `resume` | `{ sessionId, deviceId, deviceSecret }` |
| R→D | `resumed` | `{ sessionId, expiresAt }` |
| D→R | `unpair` | `{}` |
| R→D | `unpaired` | `{ reason: 'byUi' \| 'byDevice' \| 'expired' \| 'sessionNotFound' \| 'invalidSecret' \| 'replaced' }` → SDK sakladığı bilgiyi siler |

- `deviceId`: SDK'nın kurulum başına ürettiği sabit kimlik, `[A-Za-z0-9_-]{8,128}`.
- QR token'ı ve kod birlikte üretilir, **tek kullanımlıktır**; bir cihaz eşleşince ikisi de yenilenir.
- Aynı `deviceId` ile yeniden eşleşme eski kaydın yerini alır; eski sır geçersiz olur, eski soket `4000` ile kapanır.
- Eşleşme ömrü (`expiresAt`) kesin bir süredir; `resume` onu uzatmaz. Süre dolunca cihaz `unpaired{reason:'expired'}` alır.
- `connect` isteği UI'ı açık olan tüm oturumlara gösterilir; ilk cevap geçerlidir. Aynı cihazdan yeni bir istek eskisini iptal eder.
- Onaylı (trusted) bir cihaz, aynı `hello.app.id` ile `connect` gönderirse relay onay sormadan `paired` döner.
  Onay `deviceId` + `app.id` eşleşmesine dayanır; bu yüzden `CONNECT_REQUESTS` sadece güvenilen ağlarda açılmalıdır.

QR içeriği:
```json
{ "v": 2, "url": "wss://host/ws/device", "sessionId": "…", "qrToken": "…" }
```

### Kapanış kodları

| Kod | Anlamı |
|---|---|
| `4000` | Aynı cihazın yeni bağlantısı eskisinin yerini aldı |
| `4001` | Kimlik doğrulama/eşleşme başarısız |
| `4002` | Eşleşme kaldırıldı (`unpaired`) |
| `4003` | Süresinde kimlik doğrulanmadı |
| `4004` | Oturum süresi doldu |
| `4005` | Desteklenmeyen protokol sürümü |
| `4006` | Çok fazla başarısız eşleşme denemesi |
| `4007` | `connect` isteği reddedildi |

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
    sdk: { name: string; version: string };      // ör. "@himmetkaan/remote-devtools", "remote-devtools-swift"
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
UI→Device istekleri `id` taşır; cevap `module.<modül>.result` tipiyle ve `replyTo` ile döner
(tablolarda `→` ile gösterilen değer cevabın `result` alanıdır). Ortak cevap biçimi:
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

- Mesaj boyutu: varsayılan 5 MB (`MAX_PAYLOAD_MB`); aşan mesajda relay soketi kapatır. SDK büyük body'leri kısaltır ve `bodyTruncated` bilgisini ekler.
- `history` ve büyük listeler `final` bayrağıyla parçalanır.
- Hız sınırı: cihaz başına saniyede `DEVICE_MAX_MSGS_PER_SEC` (varsayılan 200) mesaj. Aşan mesajlar düşürülür ve UI'a
  saniyelik pencere başına bir kez `log { level: 'warn', tag: 'relay' }` gider.
- Eşleşme denemeleri: aynı IP'den pencere içinde `PAIR_FAILURE_LIMIT` (varsayılan 10 / 10 dk) başarısız denemeden sonra `RATE_LIMITED`.
- Oturum başına en fazla `MAX_DEVICES_PER_SESSION` (varsayılan 20) cihaz.
- Heartbeat: 15 sn ping/pong (v1 ile aynı).
