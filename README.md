![Remote DevTools](./docs/banner.webp)

# Remote DevTools

Uygulamadaki Developer Menu'yü bilgisayardan kullanmak için web arayüzü + WebSocket relay.

- **Telefon → Web:** servis istekleri (canlı + Sync ile geçmiş), uygulama yaşam döngüsü, loglar
- **Web → Telefon:** Dev Menu fonksiyonlarını tetikleme

> ⚠️ **`feat/generic-platform` dalı:** relay protokol v2'ye geçti ([docs/v2](./docs/v2/PLAN.md)). UI ve mobile-app henüz v1
> konuştuğu için bu dalda birlikte çalışmazlar (UI Faz 3'te, mobile-app Faz 5'te taşınacak). Relay'i denemek için
> aşağıdaki `fake-device.ts` (JS SDK üzerinde) ve `smoke.ts` kullanılabilir.

Plan ve kararlar: [PLAN.md](./PLAN.md) · İlerleme: [ROADMAP.md](./ROADMAP.md)

```
┌───────────────┐   wss    ┌──────────────────────┐   wss    ┌──────────────┐
│  web arayüzü  │◄────────►│  relay (Node + ws)   │◄────────►│  mobile-app  │
│  /ws/web      │          │  oturum + yönlendirme│          │  /ws/device  │
└───────────────┘          └──────────────────────┘          └──────────────┘
```

> Bu repo ([hks/relay-devtools-sociallift](https://github.com/hks/relay-devtools-sociallift)) mobile-app'ten bağımsızdır.
> Mobile-app tarafı (`panjur/SocialLiftAppExpo`): `helpers/developer/remote/`, Dev Menu → 🔗 Remote tabı.

---

## Klasör yapısı

```
package.json, pnpm-workspace.yaml   # pnpm workspaces monorepo
packages/
  protocol/              # @himmetkaan/remote-devtools-protocol — mesaj sözleşmesi (relay + ui). mobile-app'te kopyası: helpers/developer/remote/RemoteProtocol.ts
  relay/                 # @himmetkaan/remote-devtools-relay — Node 24 + ws. Geliştirmede .ts dosyaları derlenmeden çalışır (type stripping)
    src/                 #   relay.ts (WebSocket akışı), sessions.ts (oturum deposu), static.ts, server.ts
    test/                #   uçtan uca testler (pnpm test)
    scripts/             #   build.ts (esbuild → dist/main.js), smoke.ts
  sdk-js/                # @himmetkaan/remote-devtools — JS SDK (RN/Expo, tarayıcı, Node); scripts/fake-device.ts
  ui/                    # @himmetkaan/remote-devtools-ui — Vite + React + TS
apps/
  server/                # docker imajı: Dockerfile (ui build + paketlenmiş relay), docker-compose.yml (relay + caddy), Caddyfile, .env.example
docs/v2/                 # generic platform planı (v2)
```

---

## Kullanım

1. Web arayüzünü aç → QR görünür (2 dk geçerli, tek kullanımlık, kendiliğinden yenilenir).
2. Telefonda Dev Menu → **🔗 Remote** → **📷 QR Okut**.
3. Bağlanınca web'de cihaz kartı dolar, telefonda dev butonunda yeşil nokta belirir.

Eşleşme telefonda saklanır: uygulama arka plandan dönünce veya yeniden açılınca kendiliğinden bağlanır.
Başka bir cihaz bağlamak için web'de veya telefonda **Bağlantıyı Kes**.

| Tab | Ne yapar |
|---|---|
| 📜 Logs | Bağlandı / koptu / arka plan / ön plan, komut sonuçları, Sync özetleri |
| 🛎️ Service Requests | Canlı istekler; **Sync** ile telefonda biriken geçmiş. Filtre, arama, JSON ağacı, cURL, HAR/JSON export |
| 🧩 Functions | Dev Menu fonksiyonları. Telefonun desteklemediği komutlar pasif görünür |

Klavye: `1`/`2`/`3` tab · `/` ara · `s` Sync · `p` duraklat · `↑`/`↓` gezin · `Esc` kapat · `?` tüm kısayollar

Notlar:

- Remote yalnızca Dev Menu açıkken (`showDevMenu`) çalışır; son kullanıcıya etkisi yoktur.
- Bir tarayıcı = bir oturum = bir cihaz. İkinci cihaz için incognito pencere (ayrı oturum) kullan.
- İstekler ve loglar tarayıcının IndexedDB'sinde tutulur; sayfa yenilenince geri gelir. Temizle butonları siler.
- Gövdesi 1 MB'tan büyük istek/yanıtlar telefonda kısaltılır (ilk 5.000 karakter + gerçek boyut).

---

## Lokal geliştirme

Gereksinim: Node 24+ ve pnpm (`corepack enable` yeterli). Komutlar repo kökünden çalıştırılır.

```bash
pnpm install
```

**Tek süreç (build edilmiş web'i relay sunar):**

```bash
pnpm build
```

```bash
PUBLIC_URL=http://<MAC_LAN_IP>:8787 WEB_DIST_DIR=packages/ui/dist PORT=8787 node packages/relay/dist/main.js
```

`http://localhost:8787` → QR. `PUBLIC_URL`, QR'a yazılan ve telefonun bağlanacağı adrestir; telefonla aynı Wi-Fi'daki
Mac'in IP'si olmalı (`ipconfig getifaddr en0`). Boş bırakılırsa QR'a sayfanın kendi adresi yazılır — `localhost`
ise sayfa bunun telefondan erişilemeyeceği uyarısını gösterir.

**Arayüz üzerinde çalışırken (hot reload):**

```bash
pnpm dev:relay        # :8080
```

```bash
pnpm dev:ui           # :5173, /ws ve /health relay'e proxy'lenir
```

**Cihaz olmadan deneme (v2):** sahte cihaz JS SDK'nın kendisini kullanır.

```bash
node packages/sdk-js/scripts/fake-device.ts qr '<QR içeriği>'
```

```bash
node packages/sdk-js/scripts/fake-device.ts code <6 haneli kod> ws://127.0.0.1:8080
```

```bash
node packages/sdk-js/scripts/fake-device.ts dev 8080
```

`dev` modu (`isDevelopment`) yerel relay'i bulur ve UI'dan onay ister; relay'in `CONNECT_REQUESTS=local` ile çalışması
gerekir (`pnpm dev:relay` bunu açar). Komutlar (stdin): `bg`, `fg`, `log|debug|warn|err <mesaj>`, `name <metin>`, `drop`,
`resume`, `unpair`, `quit`. Sahte cihaz `ping` ve `echo` fonksiyonlarını bildirir ve çağrılara cevap verir.

**Testler:**

```bash
pnpm typecheck && pnpm test                              # tüm paketler: relay 70, SDK 22 test
```

```bash
node packages/relay/scripts/smoke.ts ws://127.0.0.1:8787   # çalışan bir relay'e karşı uçtan uca
```

### Telefon relay'e bağlanamıyorsa

- Telefon ile Mac **aynı ağda** mı? Misafir/kurumsal Wi-Fi'lar cihazlar arası trafiği engelleyebilir.
- iOS **Yerel Ağ** izni: Ayarlar → Gizlilik ve Güvenlik → Yerel Ağ → uygulama açık olmalı.
- `PUBLIC_URL` Mac'in güncel LAN IP'si mi? (IP DHCP ile değişebilir.)
- macOS güvenlik duvarı Node'a gelen bağlantıları engelliyor olabilir.
- Lokalde bağlantı `ws://` (şifresiz). iOS dev build'inde `NSAllowsLocalNetworking` açık olduğu için LAN IP'leri sorunsuz;
  LAN dışı bir `ws://` adresi ATS'e takılır → sunucu kurulumunu (wss) veya bir tünel (`cloudflared`, `ngrok`) kullan.

---

## Sunucu kurulumu (docker-compose)

Aynı compose lokal ve sunucuda çalışır; fark sadece `.env`.

```bash
cd apps/server
cp .env.example .env     # değerleri düzenle
docker compose up -d --build
```

Sunucu için `.env`:

```dotenv
PUBLIC_URL=https://devtools.example.com
SITE_ADDRESS=devtools.example.com
HTTP_PORT=80
HTTPS_PORT=443
```

- Caddy, `SITE_ADDRESS` bir domain olduğunda Let's Encrypt ile otomatik TLS alır → `wss://`.
  Bunun için DNS kaydı sunucuyu göstermeli ve **80 ile 443 dışarı açık** olmalı.
- Lokalde `SITE_ADDRESS=:80` → düz HTTP, portlar varsayılan `8080`/`8443`.
- Sağlık kontrolü: `GET /health` → `{"ok":true,"sessions":N,"uptimeSec":N}`.
- Kurulumdan sonra: `node packages/relay/scripts/smoke.ts wss://devtools.example.com` (repo kökünden).

### Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PUBLIC_URL` | — | QR'a yazılan dış adres (`https://…` → `wss://…/ws/device`) |
| `SITE_ADDRESS` | `:80` | Caddy site adresi; domain verilirse otomatik TLS |
| `HTTP_PORT` / `HTTPS_PORT` | `8080` / `8443` | Host'a açılan portlar (sunucuda 80/443) |
| `SESSION_TTL_HOURS` | `24` | Hiçbir UI'ın bağlı olmadığı oturum bu süre sonra silinir; cihaz eşleşmeleri de düşer |
| `PAIR_TOKEN_TTL_SEC` | `120` | QR token'ı ve 6 haneli kodun geçerlilik süresi (ikisi de tek kullanımlık) |
| `DEVICE_IDLE_TTL_MIN` | `60` | Cihaz eşleşmesinin hareketsizlik süresi: bağlıyken düşmez; bağlantı koptuktan sonra bu süre içinde geri gelmezse unutulur |
| `CONNECT_REQUESTS` | `off` | Kodsuz geliştirme bağlantıları (UI'dan onaylı): `off` · `local` (loopback/özel ağ) · `any` |
| `CONNECT_REQUEST_TTL_SEC` | `120` | Bekleyen bağlantı isteğinin cevaplanma süresi |
| `TRUST_PROXY` | `false` | İstemci adresini `X-Forwarded-For`'dan oku (compose'da `true`) |
| `HEARTBEAT_INTERVAL_SEC` | `15` | Ping aralığı; cevap vermeyen soket bir sonraki turda düşürülür |
| `MAX_PAYLOAD_MB` | `5` | Tek mesaj sınırı |
| `MAX_SESSIONS` | `1000` | Eşzamanlı oturum sınırı |
| `MAX_DEVICES_PER_SESSION` | `20` | Bir oturuma bağlanabilecek cihaz sayısı |
| `DEVICE_MAX_MSGS_PER_SEC` | `200` | Cihaz başına mesaj hızı sınırı; aşanlar düşürülür |
| `PAIR_FAILURE_LIMIT` / `PAIR_FAILURE_WINDOW_SEC` | `10` / `600` | IP başına başarısız eşleşme denemesi sınırı |
| `STATE_FILE` | — | Oturum, eşleşme ve onaylı cihaz bilgisinin saklanacağı dosya; boşsa sadece bellek |

Relay oturumları varsayılan olarak **bellekte** tutar: relay yeniden başlarsa eşleşmeler düşer. `STATE_FILE` verilirse
oturumlar, cihaz eşleşmeleri ve onaylı cihazlar bu dosyada saklanır (veri değil, sadece bağlantı bilgisi; dosya `0600`).

---

## Güvenlik

Şu an **web arayüzüne herkes erişebilir** (login yok, roadmap'te). Koruma eşleşme modeline dayanır:

- QR'daki `pairToken` tek kullanımlık ve 2 dakika geçerli; eşleşince geçersiz olur.
- Oturuma tek cihaz bağlanabilir; `webSecret` ve `deviceSecret` 24+ byte rastgele, sabit-zamanlı karşılaştırılır.
- Telefon tarafı yalnızca Dev Menu açıkken (backend'in izin verdiği kullanıcılar) çalışır.

Ancak servis istekleri (auth header'ları dahil) **maskelenmeden** web'e gider. Sunucuya kurulumda en azından
erişimi kısıtla (VPN, IP allowlist veya Caddy `basicauth`) — login gelene kadar.

---

## Protokol

Tüm mesajlar `{v, type, id, ts, payload}` zarfıyla taşınır; tipler [packages/protocol/src/index.ts](./packages/protocol/src/index.ts) içinde.
Relay payload içeriğini doğrulamaz, sadece yönlendirir (`sync`/`invoke` web → cihaz; `hello`, `lifecycle`, `request`,
`response`, `syncResult`, `invokeResult`, `log` cihaz → web).

Protokolü değiştirirken:

1. `packages/protocol/src/index.ts` ve mobile-app'teki `helpers/developer/remote/RemoteProtocol.ts`'i **birlikte** güncelle.
2. Uyumsuz değişiklikte `PROTOCOL_VERSION`'ı artır (relay farklı sürümü `UNSUPPORTED_VERSION` ile reddeder;
   telefon da QR'daki sürüm uyuşmazsa eşleşmez).

### Yeni bir Dev Menu fonksiyonu eklemek

İki taraf bilerek ayrı kodlanır (mevcut `Dev*` bileşenlerine dokunmamak için):

1. **mobile-app:** `helpers/developer/remote/RemoteCommands.ts` → `REMOTE_COMMANDS`'a `id: (args) => …` ekle.
   Dönen değer web'de sonuç olarak görünür; hata fırlatırsa başarısız sayılır.
2. **web:** `packages/ui/src/lib/commands.ts` → `COMMANDS`'a aynı `id` ile başlık/açıklama/grup ekle.

Sadece telefona eklenirse web Functions tabında "web'de tanımlı olmayan komut" uyarısı çıkar; sadece web'e eklenirse
kart "Bu uygulama sürümünde yok" olarak pasif görünür.
