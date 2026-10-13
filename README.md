![Remote DevTools](./docs/banner.webp)

# Remote DevTools

Uygulamadaki Developer Menu'yü bilgisayardan kullanmak için web arayüzü + WebSocket relay.

- **Telefon → Web:** servis istekleri (canlı + Sync ile geçmiş), uygulama yaşam döngüsü, loglar
- **Web → Telefon:** Dev Menu fonksiyonlarını tetikleme

Plan ve kararlar: [PLAN.md](./PLAN.md) · İlerleme: [ROADMAP.md](./ROADMAP.md)

```
┌───────────────┐   wss    ┌──────────────────────┐   wss    ┌──────────────┐
│  web arayüzü  │◄────────►│  relay (Node + ws)   │◄────────►│  mobile-app  │
│  /ws/web      │          │  oturum + yönlendirme│          │  /ws/device  │
└───────────────┘          └──────────────────────┘          └──────────────┘
```

> Bu repo ([hks/relay-devtools-sociallift](https://github.com/hks/relay-devtools-sociallift)) mobile-app'ten bağımsızdır.
> Lokalde mobile-app reposunun içinde `devtools-web/` olarak durur; mobile-app bu klasörü `.git/info/exclude` ile yok sayar.
> Mobile-app tarafı (`panjur/SocialLiftAppExpo`): `helpers/developer/remote/`, Dev Menu → 🔗 Remote tabı.

---

## Klasör yapısı

```
devtools-web/
  shared/protocol.ts     # Mesaj sözleşmesi (relay + web). mobile-app'te kopyası: helpers/developer/remote/RemoteProtocol.ts
  relay/                 # Node 24 + ws. .ts dosyaları derlenmeden çalışır (type stripping)
    src/                 #   relay.ts (WebSocket akışı), sessions.ts (oturum deposu), static.ts, server.ts
    test/                #   uçtan uca testler (npm test)
    scripts/             #   smoke.ts, fake-device.ts
  web/                   # Vite + React + TS
  desktop/               # Electron: relay + web tek masaüstü uygulamasında (yalnızca yerel ağ)
  Dockerfile             # web build + relay → tek imaj
  docker-compose.yml     # relay + caddy (TLS)
  Caddyfile
  .env.example
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

Gereksinim: Node 24+.

```bash
cd devtools-web/relay && npm install
cd devtools-web/web && npm install
```

**Tek süreç (build edilmiş web'i relay sunar):**

```bash
cd devtools-web/web && npm run build
cd devtools-web/relay && PUBLIC_URL=http://<MAC_LAN_IP>:8787 WEB_DIST_DIR=../web/dist PORT=8787 node src/main.ts
```

`http://localhost:8787` → QR. `PUBLIC_URL`, QR'a yazılan ve telefonun bağlanacağı adrestir; telefonla aynı Wi-Fi'daki
Mac'in IP'si olmalı (`ipconfig getifaddr en0`). Boş bırakılırsa QR'a sayfanın kendi adresi yazılır — `localhost`
ise sayfa bunun telefondan erişilemeyeceği uyarısını gösterir.

**Arayüz üzerinde çalışırken (hot reload):**

```bash
cd devtools-web/relay && npm run dev        # :8080
cd devtools-web/web && npm run dev          # :5173, /ws ve /health relay'e proxy'lenir
```

**Telefon olmadan deneme:** QR ekranındaki "QR içeriği" alanını kopyala:

```bash
cd devtools-web/relay && node scripts/fake-device.ts '<QR içeriği>'
```

Komutlar (stdin): `bg`, `fg`, `log|debug|warn|err <mesaj>`, `name <cihaz adı>`, `drop`, `resume`, `unpair`, `quit`.
Simülatörde uygulama varsa QR içeriği Remote tabındaki "QR içeriğini yapıştır" alanına da yapıştırılabilir.

**Testler:**

```bash
cd devtools-web/relay && npm test                         # 23 senaryo
cd devtools-web/relay && npm run smoke -- ws://127.0.0.1:8787   # çalışan bir relay'e karşı uçtan uca
cd devtools-web/web && npm run typecheck
```

### Telefon relay'e bağlanamıyorsa

- Telefon ile Mac **aynı ağda** mı? Misafir/kurumsal Wi-Fi'lar cihazlar arası trafiği engelleyebilir.
- iOS **Yerel Ağ** izni: Ayarlar → Gizlilik ve Güvenlik → Yerel Ağ → uygulama açık olmalı.
- `PUBLIC_URL` Mac'in güncel LAN IP'si mi? (IP DHCP ile değişebilir.)
- macOS güvenlik duvarı Node'a gelen bağlantıları engelliyor olabilir.
- Lokalde bağlantı `ws://` (şifresiz). iOS dev build'inde `NSAllowsLocalNetworking` açık olduğu için LAN IP'leri sorunsuz;
  LAN dışı bir `ws://` adresi ATS'e takılır → sunucu kurulumunu (wss) veya bir tünel (`cloudflared`, `ngrok`) kullan.

---

## Masaüstü uygulaması (Electron)

Sunucu gerektirmeyen, yalnızca yerel ağda çalışan sürüm. Relay uygulamanın içinde çalışır; telefon ile bilgisayar
aynı ağda olmalıdır. Sunucu kurulumundan bağımsızdır, ikisi birlikte kullanılabilir.

**Paket üretmek** (Node 24+, macOS):

```bash
cd devtools-web/desktop && npm ci
npm run dist
```

Çıktı `desktop/release/` altına yazılır: `RemoteDevTools-<v>-mac-arm64.dmg` ve `.zip`. Yalnızca Apple Silicon hedeflenir.
İmzasız olduğu için ilk açılışta sağ tık → Aç kullanılmalı. "Hasarlı" uyarısı çıkarsa
`xattr -cr "/Applications/Remote DevTools.app"` çalıştırılmalı.

Windows (kurulumsuz `.exe`) ve Linux (`.AppImage`) yapılandırması `electron-builder.yml`'de duruyor ama şimdilik release'e
dahil değil. Gerektiğinde `npx electron-builder --win` / `--linux` ile üretilebilir.

İkon: `desktop/build/icon.png` (1024×1024).

macOS paketleri yalnızca ad-hoc imzalıdır. Anahtar zincirindeki Apple sertifikaları bilerek kullanılmaz (`identity: null`).

**Davranış:**

- Relay `0.0.0.0:8787` adresinde dinler; port doluysa uyarı verir. Başka bir port için uygulamayı `DEVTOOLS_PORT` ortam değişkeniyle başlat.
- QR'a yazılan adres, bilgisayarın LAN IP'sidir ve otomatik seçilir. Pencere başlığında görünür. Yanlış arayüz (VPN, Docker vb.)
  seçildiyse **Ağ** menüsünden doğrusunu seç. IP değişirse adres güncellenir ve sayfa yenilenir.
- Oturumlar, istekler ve loglar yalnızca bellekte tutulur; uygulama kapanınca hepsi unutulur.
  Yeniden açıldığında telefonla tekrar QR okutularak eşleşilir.
- İlk açılışta işletim sisteminin güvenlik duvarı gelen bağlantılara izin isteyebilir; izin verilmezse telefon bağlanamaz.

**Geliştirme:** `cd devtools-web/desktop && npm ci && npm run setup` (bir kez), sonra `npm run start`.
Bu komut web'i ve main process'i build edip Electron'u açar. Ayrı bir relay sürecine gerek yoktur:
`src/main.ts`, `relay/src/server.ts`'i doğrudan içe aktarır ve esbuild ile bundle'lar.

---

## Sunucu kurulumu (docker-compose)

Aynı compose lokal ve sunucuda çalışır; fark sadece `.env`.

```bash
cd devtools-web
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
- Kurulumdan sonra: `npm run smoke -- wss://devtools.example.com` (relay/ içinde).

### Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PUBLIC_URL` | — | QR'a yazılan dış adres (`https://…` → `wss://…/ws/device`) |
| `SITE_ADDRESS` | `:80` | Caddy site adresi; domain verilirse otomatik TLS |
| `HTTP_PORT` / `HTTPS_PORT` | `8080` / `8443` | Host'a açılan portlar (sunucuda 80/443) |
| `SESSION_TTL_HOURS` | `24` | Hiçbir web sekmesinin bağlı olmadığı oturum bu süre sonra silinir; cihaz eşleşmesi de düşer |
| `PAIR_TOKEN_TTL_SEC` | `120` | QR geçerlilik süresi |
| `HEARTBEAT_INTERVAL_SEC` | `15` | Ping aralığı; cevap vermeyen soket bir sonraki turda düşürülür |
| `MAX_PAYLOAD_MB` | `5` | Tek mesaj sınırı (Sync zaten ~1 MB'lık parçalarla gönderilir) |
| `MAX_SESSIONS` | `1000` | Eşzamanlı oturum sınırı |

Relay oturumları **bellekte** tutar: relay yeniden başlarsa web otomatik yeni oturum açar, telefonun eşleşmesi düşer
ve QR'ın yeniden okutulması gerekir.

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

Tüm mesajlar `{v, type, id, ts, payload}` zarfıyla taşınır; tipler [shared/protocol.ts](./shared/protocol.ts) içinde.
Relay payload içeriğini doğrulamaz, sadece yönlendirir (`sync`/`invoke` web → cihaz; `hello`, `lifecycle`, `request`,
`response`, `syncResult`, `invokeResult`, `log` cihaz → web).

Protokolü değiştirirken:

1. `shared/protocol.ts` ve mobile-app'teki `helpers/developer/remote/RemoteProtocol.ts`'i **birlikte** güncelle.
2. Uyumsuz değişiklikte `PROTOCOL_VERSION`'ı artır (relay farklı sürümü `UNSUPPORTED_VERSION` ile reddeder;
   telefon da QR'daki sürüm uyuşmazsa eşleşmez).

### Yeni bir Dev Menu fonksiyonu eklemek

İki taraf bilerek ayrı kodlanır (mevcut `Dev*` bileşenlerine dokunmamak için):

1. **mobile-app:** `helpers/developer/remote/RemoteCommands.ts` → `REMOTE_COMMANDS`'a `id: (args) => …` ekle.
   Dönen değer web'de sonuç olarak görünür; hata fırlatırsa başarısız sayılır.
2. **web:** `web/src/lib/commands.ts` → `COMMANDS`'a aynı `id` ile başlık/açıklama/grup ekle.

Sadece telefona eklenirse web Functions tabında "web'de tanımlı olmayan komut" uyarısı çıkar; sadece web'e eklenirse
kart "Bu uygulama sürümünde yok" olarak pasif görünür.
