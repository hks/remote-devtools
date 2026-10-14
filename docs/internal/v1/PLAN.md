# Remote DevTools — Plan

Uygulama içindeki Developer Menu'nün bir web sitesi üzerinden, WebSocket ile çift yönlü olarak kullanılabilmesi.

- **Telefon → Web:** servis istekleri, uygulama yaşam döngüsü olayları, (ileride) loglar
- **Web → Telefon:** Dev Menu fonksiyonlarını tetikleme, geçmiş verileri senkronlama

---

## 0. Kararlar (Soru–Cevap özeti)

| # | Konu | Karar |
|---|---|---|
| A1 | Sunucu | Ayrı sunucuda, **docker-compose** ile. Aynı compose lokalde de çalışır. |
| A2 | Web konumu | Repo içinde `devtools-web/`, **commit'lenmiyor** (`.git/info/exclude` ile hariç tutuldu). |
| A3 | Ortamlar | Tek relay. Relay ortamdan bağımsız; bağlantı bilgisi QR ile telefona geçer. |
| B4 | Web erişimi | Şimdilik herkese açık. Login ileride (roadmap). |
| B5 | Yaşam döngüsü | Arka plan / ön plan web'de log olarak görünür; ön plana dönünce otomatik yeniden bağlanır. |
| B6 | Hassas veri | Maskeleme yok. |
| C7 | Kapsam v1 | **Logs** (web'e özel, ilk tab), **Service Requests**, **Functions**. |
| C8 | Geçmiş veri | Otomatik gönderilmez. Web'deki **Sync** butonu ile istenir. |
| C9 | Web ekstraları | Telefonu etkilemeyen her geliştirici kolaylığı eklenebilir. |
| C10 | Kod paylaşımı | Web ve app ayrı kodlanır. Mevcut `Dev*` bileşenleri refactor edilmez. |
| C11 | Eşzamanlılık | Bir tarayıcı = bir oturum = bir cihaz. Başka cihaz için "Bağlantıyı Kes" gerekir. Incognito ayrı oturumdur. |
| D12 | App UI | Dev Menu'de yeni **🔗 Remote** tabı. |
| D13 | Native bağımlılık | `expo-camera` eklenebilir (OTA kullanılmıyor, Bitrise native build). |
| D14 | Mevcut güvenlik notları | Kapsam dışı (bkz. §7). |

---

## 1. Mimari

```
┌───────────────┐   wss    ┌──────────────────────┐   wss    ┌──────────────┐
│  devtools-web │◄────────►│  relay (Node + ws)   │◄────────►│  mobile-app  │
│  (React/Vite) │          │  oturum + yönlendirme│          │  Remote tab  │
└───────────────┘          └──────────────────────┘          └──────────────┘
        └──────── docker-compose: relay (+ statik web) + caddy (TLS) ────────┘
```

### Klasör yapısı (`devtools-web/`, git dışı)

```
devtools-web/
  PLAN.md                   # bu dosya
  ROADMAP.md                # todo listesi
  docker-compose.yml        # relay + caddy; lokal & sunucu aynı
  Caddyfile                 # prod: otomatik TLS (wss://), lokal: düz http
  .env.example              # PUBLIC_URL, PORT, SESSION_TTL_HOURS, PAIR_TOKEN_TTL_SEC ...
  shared/protocol.ts        # mesaj tipleri (relay + web ortak)
  relay/                    # Node + TypeScript + ws; build edilmiş web'i statik sunar
  web/                      # Vite + React + TypeScript
```

Mobile-app'teki `RemoteProtocol.ts`, `shared/protocol.ts` dosyasının kopyasıdır (web commit'lenmediği için ortak paket yok). Protokolde `v` alanı ile versiyonlanır.

### Relay

- Durumsuz, kalıcı veritabanı yok; oturumlar bellekte.
- Ortamdan (prod/staging) bağımsız; telefon kendi aktif API endpoint'ini `hello` ile bildirir.
- Görevleri: oturum oluşturma, eşleştirme, web ↔ telefon mesaj yönlendirme, heartbeat, oturum çöp toplama.
- `maxPayload` sınırı (ör. 5 MB) — büyük response'lar için ayarlanabilir.

---

## 2. Eşleşme & oturum akışı

1. Web açılır → `localStorage`'da oturum yoksa relay'den yeni oturum ister → `sessionId` + `webSecret` alır ve saklar.
2. Web QR gösterir: `{ v: 1, url: "wss://…", sessionId, pairToken }`.
   - `pairToken` **tek kullanımlık**, **2 dk** geçerli; süresi dolunca QR otomatik yenilenir.
3. Telefon: Dev Menu → **🔗 Remote** → kamera → QR okunur → `pair` mesajı → relay `deviceSecret` döner.
4. Telefon bağlantı bilgisini (`url`, `sessionId`, `deviceSecret`) persisted store'a yazar →
   arka plandan dönüşte **ve uygulama yeniden açıldığında** otomatik yeniden bağlanır (cold start istekleri de görünür).
5. Oturuma **tek cihaz** bağlanabilir. Yeni cihaz için web'de (veya telefonda) **Bağlantıyı Kes** → relay cihaz eşleşmesini kaldırır (`deviceSecret` geçersiz olur) → telefona `unpaired` gider, telefon kayıtlı bilgiyi temizler → web oturumu korunur ve yeni bir QR gösterilir.
6. Aynı tarayıcıdaki ikinci sekme `localStorage` üzerinden aynı oturumu kullanır; incognito ayrı `localStorage` → ayrı oturum.
7. Heartbeat: relay ↔ her iki taraf 15 sn ping/pong.
8. Hiçbir web sekmesinin bağlı olmadığı oturumlar `SESSION_TTL_HOURS` (varsayılan 24) sonra silinir; bağlı/geri dönen cihaza `unpaired (sessionExpired)` gider.
9. Kimlik doğrulamayan soketler `AUTH_TIMEOUT_SEC` (10) sonra kapatılır. WS yolları: web `/ws/web`, cihaz `/ws/device`.

---

## 3. Mesaj protokolü (v1)

Zarf: `{ v, type, id, ts, payload }`

| Yön | `type` | İçerik |
|---|---|---|
| web → relay | `createSession` / `resumeSession` | — / `{ sessionId, webSecret }` |
| relay → web | `session` | `{ sessionId, webSecret, pairToken, pairTokenExpiresAt }` |
| telefon → relay | `pair` / `resume` | `{ sessionId, pairToken }` / `{ sessionId, deviceSecret }` |
| relay → telefon | `paired` / `unpaired` | `{ deviceSecret }` / — |
| telefon → web | `hello` | platform, OS, app versiyonu + build, `user_id`, aktif API endpoint, desteklenen komut id'leri |
| telefon → web | `lifecycle` | `active` \| `background` \| `inactive` |
| relay → web | `deviceStatus` | `connected` \| `disconnected` (soket koptu: kapandı / ağ gitti) |
| telefon → web | `request` | `uuid`, method, url, baseURL, headers, params, body, `startedAt` |
| telefon → web | `response` | `uuid`, status, headers, body, `durationMs`, `result` (success/error) |
| web → telefon | `sync` | — |
| telefon → web | `syncResult` | `useDeveloperStore` içeriği; web `uuid` ile tekilleştirir |
| web → telefon | `invoke` | `{ commandId, args? }` |
| telefon → web | `invokeResult` | `{ commandId, ok, error? }` |
| telefon → web | `log` | `{ level, message, data? }` — **altyapı hazır**, ileride `console.log` köprüsü |
| web → relay | `unpair` | Bağlantıyı kes |

Başarı/hata sınıflaması mevcut `StoreDeveloper.addResponse` mantığıyla aynı: `result_code === 1` → success, diğer her şey error.

---

## 4. Mobile-app değişiklikleri

### Yeni dosyalar — `helpers/developer/remote/`

- `RemoteProtocol.ts` — mesaj tipleri.
- `RemoteClient.ts` — WebSocket, exponential backoff ile reconnect, `AppState` dinleme, kopukken küçük gönderim kuyruğu.
- `RemoteCommands.ts` — `commandId → mevcut helper` eşlemesi. **Mevcut `Dev*` bileşenlerine dokunulmaz.**
- `RemoteSerializers.ts` — axios config/response'u güvenli JSON'a çevirir (fonksiyon / döngüsel referans temizliği).

### Yeni store

- `store/developerStore/StoreRemoteDevtools.ts` — persisted bağlantı bilgisi + volatile bağlantı durumu.

### Yeni UI

- `components/ui/developer/components/DeveloperRemotePanel.tsx` — QR tarama, bağlantı durumu, "Bağlantıyı kes", simülatör için QR içeriğini elle yapıştırma alanı.

### Küçük dokunuşlar (mevcut davranış değişmez)

- `components/ui/developer/components/DeveloperPanel.tsx` — `TAB_LIST`'e `🔗 Remote`.
- `helpers/developer/DeveloperFunctions.ts` — `DeveloperAddToReduxRequests/Responses` içinde store'a yazmanın yanında `RemoteClient.emit(...)`; süre ölçümü için request zamanı.
- `app/_layout.tsx` — açılışta kayıtlı bağlantı varsa **ve `showDevMenu` açıksa** client başlatılır. `showDevMenu` kapalıyken remote hiç çalışmaz → son kullanıcıya sıfır etki.
- `components/ui/developer/DeveloperButton.tsx` — bağlıyken küçük yeşil nokta.

### Komut eşlemesi (v1)

| commandId | Çağrılan helper | Kaynak bileşen |
|---|---|---|
| `checkPaymentPixels` | `CheckPaymentPixels()` | DevCheckPaymentPixels |
| `clearDeviceInfo` | `AsyncStorage.removeItem('deviceInfo-zustandStorage')` (web'de onay) | DevClearDeviceInfo |
| `rateUs.showDecision` | `devShowRateUsDecision()` | DevRateUs |
| `rateUs.reset` | `devResetRateUsData()` | DevRateUs |
| `rateUs.setDecision` | `devSetRateUsDecision(ShowSocialLiftActionSheet)` (sheet telefonda açılır) | DevRateUs |
| `rateUs.setLastTime` | `devSetLastRateUsTime(ShowSocialLiftActionSheet)` (sheet telefonda açılır) | DevRateUs |
| `rateUs.showPopup` | `devShowManualRateUs()` | DevRateUs |
| `tryBoost` | `ShowGlobalModalTryBoost(true)` | DevTryBoost |
| `trySuperLike` | `ShowGlobalModalTrySuperLike(true)` | DevTrySuperLike |
| `pushPermission` | `ShowRequestPushNotificationPermission()` | DevTryShowRequestPushNotificationPermission |
| `giftModal.gold` / `giftModal.platinum` | `ShowGiftGoldOrPlatinumModal(false/true)` | DevShowGiftGoldOrPlatinumModal |
| `kopukluAd` | `ShowKopukluAdvertisementModalV2()` | DevShowKopukluAdvertisementModalV1 |
| `successStoriesIntro` | (menü açıksa kapat) + `ShowGlobalModalSuccessStoriesIntro({useFallbackOnEmpty:true})` | DevSuccessStoriesIntro |
| `adaptyPaywallSeen` | `SendAdaptyPaywallSeenLog(EPurchaseType.GOLD)` | DeveloperFunctionsPanel |
| `errorOsman` | Kasıtlı JS hatası (BugSnag testi) | DeveloperFunctionsPanel |
| `closeDevMenu` | `SetPersistedStore({showDevMenu:false})` + bağlantıyı kes | DeveloperFunctionsPanel |

### Yeni bağımlılık

- `expo-camera` (yerleşik barcode scanner). `NSCameraUsageDescription` zaten tanımlı.

---

## 5. devtools-web (v1)

### Üst bar
Bağlı cihaz kartı (platform, versiyon, kullanıcı, endpoint, durum rozeti) · **Sync** · **Bağlantıyı Kes**

### Tablar
1. **📜 Logs** (ilk tab, web'e özel)
   - connected / disconnected / background / foreground / komut çalıştı / komut hata
   - Seviye filtresi, zaman damgası, metin arama
   - İleride `log` mesajları (console.log köprüsü)
2. **🛎️ Service Requests**
   - URL arama, method & success/error filtresi
   - Split view: liste + detay
   - JSON ağaç görünümü (request & response)
   - Süre, status, boyut kolonları
   - Kopyala: **cURL**, request JSON, response JSON
   - Toplu export (JSON / HAR)
   - Duraklat, temizle, otomatik kaydırma
3. **🧩 Functions**
   - Elle kodlanmış komut listesi (bkz. §4 eşleme tablosu)
   - Telefon `hello` ile bildirmediği komutları **pasif** gösterir → versiyon uyumsuzluğunda kırılma yok
   - Sonuç toast + Logs'a kayıt

### Kalıcılık
Yakalanan istekler ve loglar IndexedDB'de tutulur (sayfa yenilemede kaybolmaz).

---

## 6. Ağ / TLS notları

- **Prod:** Caddy otomatik TLS → `wss://`. ATS / cleartext sorunu yok.
- **Lokal:** `ws://<LAN-IP>` iOS ATS / Android cleartext kurallarına takılabilir. Uygulamanın network güvenlik ayarlarına dokunulmayacak; lokal testte Caddy local CA veya ngrok / cloudflared tüneli kullanılacak.

---

## 7. Kapsam dışı / ileride

- Web sitesine login (SSO veya backend dev kullanıcıları) + relay'de yetki kontrolü (pair sırasında kullanıcı token'ı ile `CheckDevStatus` benzeri doğrulama).
- `console.log` köprüsü (`log` mesajı).
- Diğer tablar: Headers, Settings, Saved Users, Endpoints.
- Mevcut güvenlik notları (bu işte ele alınmıyor):
  - `components/ui/developer/components/DeveloperCheckButton.tsx` — `CheckDevStatus` cevabının içeriği kontrol edilmiyor; HTTP 200 yeterli.
  - `helpers/developer/DeveloperPayloadHelpers.ts` — `pembepanjur://devpayload` `openDevMenu` aksiyonu backend kontrolü olmadan menüyü açıyor. Remote kontrol ile birlikte etkisi büyür.

---

## 8. Git

- `devtools-web/` → `.git/info/exclude` (yerel, commit'lenmiyor).
- Mobile-app değişiklikleri için branch: `hks/remote-devtools`.
