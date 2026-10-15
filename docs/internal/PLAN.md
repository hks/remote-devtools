# Remote DevTools v2 — Generic platform planı

Amaç: Pembe Panjur'a bağlı bu aracı, herhangi bir developer'ın kendi uygulamasına SDK ile bağlayabildiği
açık kaynak bir platforma dönüştürmek.

İlgili dokümanlar: [protocol.md](../reference/protocol.md) (protokol v2) · [macos-release.md](../maintainers/macos-release.md) (imzalı .dmg yayını)
v1 dokümanları: [v1/PLAN.md](./v1/PLAN.md) · [v1/ROADMAP.md](./v1/ROADMAP.md)

Durum: `[ ]` yapılacak · `[~]` devam ediyor · `[x]` tamamlandı

---

## 0. Kararlar (Soru–Cevap özeti)

| # | Konu | Karar |
|---|---|---|
| G1 | Ürün | **Remote DevTools**, açık kaynak (**MIT**). Arayüz **sadece İngilizce**. |
| G2 | Dağıtım | Self-hosted (docker, tarayıcıdan erişim) **ve** Electron desktop app (macOS Apple Silicon). Desktop app relay'i kendi içinde çalıştırır. |
| G3 | Repo | **pnpm workspaces** monorepo. |
| G4 | SDK | Çoklu platform hedefi. İlk faz **JS/TS SDK** (RN/Expo + web). Swift / Kotlin / Flutter sonraki fazlarda. |
| G5 | Zorunlu çekirdek | Bağlantı/eşleşme ekranı + **Logs**. Bunlar dışındaki her şey app'in bildirdiği yeteneklere bağlıdır. |
| G6 | Hazır modüller | **Network**, **Functions**, **Storage**, **State**, **Flags/Config**. Sadece app `hello` mesajında bildirirse görünür. |
| G7 | Özel paneller | App şemayla tanımlar. Yapı taşları: **tablo, key-value, JSON, aksiyon butonu, form**. |
| G8 | Functions | Tamamen app'ten gelir (başlık, grup, açıklama, onay, tehlikeli, argümanlar). UI'da hiç hardcoded komut kalmaz. |
| G9 | Şema | Argümanlar ve form alanları için platformlar arası taşınabilir, basit bir **field DSL** kullanılır (bkz. PROTOCOL §6). |
| G10 | Eşleşme | QR · 6 haneli kod · simülatörde localhost'a otomatik bağlanma · LAN otomatik keşif (mDNS, **opsiyonel**, bkz. G20). Sunucudaki relay için sadece QR ve kod kullanılabilir. |
| G11 | Cihaz sayısı | Bir oturumda **birden çok cihaz**. UI'da cihaz seçici olur, her cihazın verisi ayrı tutulur. |
| G12 | Network yakalama | fetch/XHR **otomatik** yakalanır (`network.autoCapture: false` ile kapatılır). Ayrıca axios adapter'ı ve manuel `network.record()` API'si. |
| G13 | Production | SDK **varsayılan kapalı**. Açmak için `enabled: true` gerekir. Kapalıyken tüm API'ler no-op. |
| G14 | Kalıcılık (UI) | UI hiçbir veriyi saklamaz, her şey bellektedir. v1'deki IndexedDB kalıcılığı kalkar. |
| G15 | Kalıcılık (app) | Kontrol developer'dadır. `history` seçeneği açılırsa SDK bağlantı öncesindeki log/istekleri bellekte tamponlar ve bağlanınca gönderir. Varsayılan kapalı. v1'deki elle tetiklenen Sync butonu kalkar. |
| G16 | Otomatik bağlanma | `isDevelopment: true` olan app ağdaki relay'i (mDNS/localhost) bulur ve **bağlantı isteği** gönderir. Desktop'ta Onayla/Reddet çıkar. Onaylanan cihazlar hatırlanır. |
| G17 | Bağlantıyı hatırlama | QR veya kodla eşleşen app (production dahil) bağlantı bilgisini saklar. Uygulama öldürülüp açılsa da kaldığı yerden devam eder. Eşleşme **kullanıldıkça uzayan** bir süreyle tutulur: bağlıyken düşmez, kullanım bırakılınca **1 saat** sonra unutulur. Relay'de ayarlanır. |
| G18 | Pembe Panjur | Protokol v2'ye **kırıcı geçiş** yapılır. Pembe Panjur yeni JS SDK'nın ilk kullanıcısı olur, kendine özel komutlarını app tarafında tanımlar. v1 desteği kaldırılır. |
| G21 | Paket adları | npm organizasyonu `@himmetkaan`. SDK: `@himmetkaan/remote-devtools`; diğerleri `@himmetkaan/remote-devtools-<ad>` (`-protocol`, `-relay`, `-ui`, `-mdns`, `-react-native-ui`). |
| G20 | mDNS opsiyonel | mDNS keşfi çekirdeğe dahil değildir. SDK'da ayrı bir paketle (`@himmetkaan/remote-devtools-mdns`) gelir ve `discovery.mdns` ile açılır, **varsayılan kapalıdır**. Desktop'ta mDNS yayını ayarlardan kapatılabilir. mDNS olmadan da her yol (QR, kod, localhost) çalışır. |
| G19 | macOS dağıtımı | App Store'a gönderilmez. **Developer ID ile imzalı ve notarize edilmiş .dmg**, GitHub Releases'ta yayınlanır ve otomatik güncellenir. |

---

## 1. Mimari

```
┌──────────────────────────┐                ┌─────────────────────────────────┐
│ App (developer'ın)       │   ws / wss     │ Relay                           │
│  └─ @himmetkaan/remote-  │◄──────────────►│  oturum · çoklu cihaz · onay    │
│     devtools (+ modüller)│  /ws/device    │  modül mesajlarını içine        │
└──────────────────────────┘                │  bakmadan iletir                │
        ▲  mDNS keşfi (dev)                 └──────────────┬──────────────────┘
        └──────────────────────────────────────────────────┤ /ws/ui
                                       ┌───────────────────┴───────────────────┐
                                       │ UI (React) — yetenek odaklı tab'lar   │
                                       │  ├─ Desktop (Electron + gömülü relay  │
                                       │  │   + mDNS yayını)                   │
                                       │  └─ Tarayıcı (docker: relay + statik) │
                                       └───────────────────────────────────────┘
```

### Monorepo yapısı

```
packages/
  protocol/        # @himmetkaan/remote-devtools-protocol — tipler, zarf, field DSL, sürüm sabitleri (bağımlılıksız)
  relay/           # @himmetkaan/remote-devtools-relay   — Node + ws; kütüphane + CLI (docker ve Electron aynı kodu kullanır)
  ui/              # @himmetkaan/remote-devtools-ui      — React UI; modül kayıt defteri, cihaz seçici
  sdk-js/          # @himmetkaan/remote-devtools — çekirdek + modüller + adapter'lar (axios, AsyncStorage, MMKV, Redux, Zustand…)
apps/
  desktop/         # Electron: gömülü relay + UI + mDNS yayını + onaylı cihaz listesi
  server/          # docker imajı: relay + build edilmiş UI (mevcut Dockerfile/compose/Caddy buraya)
examples/
  expo/  web/      # örnek entegrasyonlar; uçtan uca testlerde de kullanılır
docs/
```

Swift, Kotlin ve Flutter SDK'ları ileride `sdks/` altına girer ve protokol sözleşmesine bağlı kalır.

### Temel prensipler

1. **Relay modülleri tanımaz.** Çekirdek mesajları (eşleşme, oturum, durum) relay işler. `module.*` ad alanındaki
   her şeyi içeriğine bakmadan doğru cihaza veya UI'a iletir. Yeni bir modül relay'de değişiklik gerektirmez.
2. **UI yeteneklere göre çizilir.** `hello.capabilities` içindeki her anahtar bir UI modülünü açar.
   Bildirilmeyen modülün tab'ı görünmez.
3. **SDK ince bir çekirdek ve takılabilir modüllerden oluşur.** Modüller tree-shake edilebilir.
   Native bağımlılıklar (mDNS, kamera) opsiyonel peer dependency'dir.
4. **Protokol tek kaynaktan gelir.** `packages/protocol` hem TS tiplerini hem de diğer dil SDK'ları için
   dokümanı ve JSON örneklerini üretir. Uyumluluk test fikstürleri ortaktır.

---

## 2. Bağlantı ve oturum modeli

- **Oturum (workspace):** UI tarafının oturumudur. Desktop app'te varsayılan olarak tek ve kalıcı bir oturum açılır.
  Bir oturuma birden çok cihaz bağlanabilir.
- **Cihaz kimliği:** SDK kurulum başına sabit bir `deviceId` üretip saklar. Relay mesajları `deviceId` ile yönlendirir.
- **Eşleşme yolları:**

| Yol | Ne zaman | Güvenlik |
|---|---|---|
| QR | Fiziksel cihaz, her ortam | Tek kullanımlık `pairToken` (2 dk) |
| 6 haneli kod | Kamera yok veya web app | Tek kullanımlık, kısa TTL, deneme sınırı |
| mDNS keşfi (opsiyonel) | `isDevelopment: true` + `discovery.mdns` açık + `sdk-mdns` kurulu, aynı LAN | `connectRequest` → UI'da onay |
| localhost | Simülatör/emülatör (`isDevelopment: true`) | `connectRequest` → UI'da onay |

- **Hatırlama (G17):** Eşleşme sonrası SDK `{relayUrl, sessionId, deviceSecret, expiresAt}` bilgisini saklar
  (RN'de AsyncStorage veya SecureStore adapter'ı, web'de localStorage). Açılışta `resume` dener. TTL dolmuşsa
  veya relay reddederse bilgiyi siler. Relay tarafında hareketsizlik süresi `DEVICE_IDLE_TTL_MIN` (varsayılan 60) ile ayarlanır.
  Cihaz bağlıyken eşleşme düşmez; her mesaj ve bağlantının kopması süreyi yeniden başlatır.
- **Onaylı cihazlar (G16):** Desktop app onaylanan `deviceId` + app kimliğini hatırlar. Bu cihazlardan gelen
  sonraki isteklerde tekrar onay sorulmaz. Liste ayarlardan silinebilir.
- **Relay yeniden başlatılınca:** Desktop app sadece **bağlantı metadata'sını** (oturum sırrı, eşleşmeler,
  onaylı cihazlar) diskte saklar; veri saklamaz. Böylece app kapanıp açılınca cihazlar `resume` ile geri döner.
  Sunucudaki relay varsayılan olarak bellek kullanır; isteğe bağlı bir dosya deposu (`STATE_FILE`) eklenebilir.

---

## 3. SDK (JS) API

Çekirdek Faz 2'de, `functionsModule` ve `networkModule` Faz 4'te, `storageModule`, `stateModule` ve `flagsModule` Faz 7'de
yazıldı; `panelsModule` Faz 8'de (`packages/sdk-js`).

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {AppState, Platform} from 'react-native';
import {functionsModule, networkModule, RemoteDevTools, reactNativeLifecycle} from '@himmetkaan/remote-devtools';

const functions = functionsModule();
const network = networkModule();               // RN'de XHR (fetch ve axios dahil) otomatik yakalanır

const devtools = RemoteDevTools.init({
    enabled: showDevMenu,                      // G13: zorunlu; false iken her şey no-op
    isDevelopment: __DEV__,                    // G16: yerel relay'i bulup bağlantı isteği gönderir
    app: {id: 'com.pembepanjur.app', name: 'Pembe Panjur', version, build},
    device: {platform: Platform.OS, os: String(Platform.Version), name: deviceName},
    meta: {userId: String(user.id), apiEndpoint},  // UI'da cihaz kartında gösterilir
    storage: AsyncStorage,                     // eşleşme bilgisi + cihaz kimliği (arayüz doğrudan uyar)
    lifecycle: reactNativeLifecycle(AppState), // SDK react-native'i import etmez
    history: {enabled: true, maxEntries: 500}, // G15
    discovery: {localhost: {port: 8080}, providers: [/* mdnsDiscovery() — G20, opsiyonel paket */]},
    captureConsole: ['warn', 'error'],
    modules: [functions, network],
});

devtools.log.info('Logged in', {userId});
devtools.updateMeta({userId: String(newUser.id)});

functions.register({                           // modül referansı üzerinden; bağlıyken eklenirse UI hemen güncellenir
    id: 'rateUs.setDecision',
    title: 'Set Rate Us decision',
    group: 'Rate Us',
    args: {decision: {type: 'select', options: ['notShown', 'yes_yes', 'yes_no', 'no_yes', 'no_no']}},
    handler: async ({decision}) => { /* ... */ },
});

// Bağlantı ekranı developer'ın elinde: SDK durum + aksiyon verir, ekranı app çizer
await devtools.connection.pairWithQr(qrString);            // veya pairWithCode('123456', 'https://devtools.example.com')
devtools.connection.subscribe((state) => {/* idle | discovering | connecting | pending-approval | connected | reconnecting */});
devtools.connection.disconnect();   // eşleşmeyi saklar; connect() ile devam
devtools.connection.unpair();       // eşleşmeyi siler
```

Notlar:
- SDK `react-native`, AsyncStorage veya kamera paketlerini import etmez; hepsi seçeneklerle verilir. Aynı paket RN, tarayıcı ve Node'da çalışır.
- Kendi modülünü yazmak için `defineModule({name, capabilities, setup(ctx)})`: `ctx.emit`, `ctx.handle` (cevaplı istek),
  `ctx.on`, `ctx.updateCapabilities`, `ctx.storage` (modüle özel önekli kalıcı depo). Bir modül sadece `module.<name>.*` tiplerini kullanabilir.

```ts
// Faz 7: Storage, State, Flags
const storage = storageModule({adapters: [
    asyncStorageAdapter(AsyncStorage),                    // clear: sadece listelenen anahtarlar
    mmkvAdapter(mmkv),                                    // v3/v4; değişiklikleri UI'a bildirir
    secureStoreAdapter(SecureStore, {keys: ['auth.token']}),  // salt okunur + maskeli (SecureStore listeleyemez)
]});                                                      // web: webStorageAdapter(localStorage | sessionStorage)
const state = stateModule({stores: [zustandAdapter(useCartStore, {id: 'cart', title: 'Cart'}), reduxAdapter(store)]});
const flags = flagsModule();
const checkout = flags.define({key: 'checkout.v2', title: 'New checkout', group: 'Checkout', field: {type: 'boolean'}});
checkout.get(); checkout.subscribe((on) => …);            // override > app değeri (flags.setValue) > field.default
await flags.ready();                                      // async storage'daki override'lar yüklendi (senkron depolarda gerekmez)

// Faz 8: özel paneller (her panel ayrı tab)
const panels = panelsModule();
const queue = panels.define({id: 'queue', title: 'Job queue', icon: '📬', blocks: [
    {id: 'note', type: 'text', tone: 'info', text: 'Jobs retry three times.'},
    {id: 'stats', type: 'stats', items: [{label: 'Pending', value: 0}]},
    {id: 'jobs', type: 'table', columns: [{key: 'id', title: 'ID'}, {key: 'state', title: 'State'}], rows: [],
     rowActions: [{id: 'retry', label: 'Retry', handler: (row) => jobs.retry(row.id)}]},
    {id: 'tools', type: 'actions', actions: [{id: 'flush', label: 'Flush', danger: true, confirm: 'Flush all?', handler: () => jobs.flush()}]},
    {id: 'add', type: 'form', fields: {name: {type: 'text', required: true}}, submit: {label: 'Enqueue', handler: ({name}) => jobs.add(name)}},
]});
queue.update('stats', {items: [{label: 'Pending', value: jobs.size}]});   // değişen alanlar UI'a gider
```
- Komut, flag ve panel tanımları bağlantıdan önce de yapılabilir. Bağlanınca `hello` ile, sonradan değişirse
  `capabilities.update` ile gönderilir.
- RN için QR okutma ekranı opsiyonel bir paket olur (`@himmetkaan/remote-devtools-react-native-ui`). Çekirdek kamera bağımlılığı taşımaz.

---

## 4. Geçiş planı (fazlar)

Her faz kendi PR'ı ile `feat/generic-platform` dalına birleşir. `main` dalı, Pembe Panjur geçişi (Faz 5)
tamamlanana kadar v1 olarak çalışmaya devam eder.

### Faz 0 — Monorepo iskeleti (davranış değişikliği yok)
- [x] pnpm workspaces, kök `package.json`, ortak `tsconfig.base.json`, `.editorconfig`
- [ ] Lint/format (ESLint + Prettier): mevcut kodun stiline göre ayarlanıp ayrı bir PR'da eklenecek, toplu yeniden biçimlendirme diff'ini bu fazdan ayırmak için
- [x] `shared/` → `packages/protocol`, `relay/` → `packages/relay`, `web/` → `packages/ui`
- [x] Docker dosyaları → `apps/server` (build context repo kökü; çalışma imajında node_modules yok)
- [x] Relay için build adımı (esbuild → `dist/main.js`, bağımlılıklar dahil); Electron'da type stripping'e güvenilmez
- [x] Mevcut 23 relay testi, typecheck, build ve paketlenmiş relay'e karşı smoke testi yeşil
- [x] CI: GitHub Actions (install, typecheck, test, build + docker build)

### Faz 1 — Protokol v2 + relay
- [x] `packages/protocol`: v2 zarfı, çekirdek mesajlar, `module.*` yönlendirme, field DSL ve panel tipleri ([PROTOCOL.md](../reference/protocol.md))
- [x] v1 tipleri geçici olarak `@himmetkaan/remote-devtools-protocol/v1` altında; UI Faz 3'te v2'ye geçince silinecek
- [x] Relay: çoklu cihazlı oturum, `deviceId` ile yönlendirme, cihaz mesajlarına `deviceId` damgası
- [x] Relay: `module.*` mesajlarını içeriğine bakmadan iletme, boyut sınırı, cihaz başına hız sınırı
- [x] Relay: 6 haneli kod ile eşleşme; QR ve kod tek kullanımlık, IP başına başarısız deneme sınırı
- [x] Relay: `connect` → UI onayı → `paired` / `connect.rejected`; `CONNECT_REQUESTS=off|local|any`; onaylı cihaz listesi
- [x] Relay: kayan eşleşme süresi (`DEVICE_IDLE_TTL_MIN`, varsayılan 60 dk; bağlıyken düşmez), süresi dolunca `unpaired{reason:'expired'}`
- [x] Relay: `GET /discovery` (CORS açık)
- [x] Relay: kütüphane olarak dışa açılması (`createRelay({...})`) + CLI (`main.ts`)
- [x] Relay: bağlantı metadata'sının `STATE_FILE`'a yazılması (atomik, `0600`); desktop app bunu kullanacak
- [x] Testler v2'ye taşındı: 70 test (çoklu cihaz, kod, onay, onaylı cihaz, TTL, hız sınırı, kalıcılık, IP sınıflandırma)
- [x] `fake-device.ts` (qr / code / connect modları, örnek fonksiyonlar) ve `smoke.ts` v2'ye taşındı

### Faz 2 — JS SDK çekirdeği
- [x] `RemoteDevTools.init`, `enabled` kapısı (kapalıyken soket açılmaz, modül kurulmaz, global yama yapılmaz)
- [x] Bağlantı durum makinesi: pair (QR/kod) · resume · yeniden bağlanma (üstel backoff + jitter) · ön plana dönünce hemen deneme
- [x] Yaşam döngüsü kaynakları: `reactNativeLifecycle(AppState)`, `browserLifecycle()`, `staticLifecycle()`
- [x] Eşleşme bilgisinin saklanması (`storage`: AsyncStorage / localStorage / bellek); kayan süre cihazda da izlenir, süresi geçmiş eşleşme relay'e gitmeden unutulur
- [x] `isDevelopment` keşfi: localhost (`localhost`, Android emülatörü `10.0.2.2`, ek host'lar); UI yoksa tekrar dener, reddedilince durur
- [x] Keşif eklenti arayüzü (`DiscoveryProvider`)
- [x] `log` API'si (güvenli serileştirme: Error, döngü, BigInt…), `captureConsole`, `history` tamponu (sıralı, parçalı gönderim)
- [x] Modül arayüzü (`defineModule`, `ctx.emit/handle/on/updateCapabilities`, `ModuleError`) ve `capabilities.update`
- [x] `fake-device.ts` SDK üzerine yeniden yazıldı (`packages/sdk-js/scripts`, qr / code / dev modları)
- [x] 22 SDK testi gerçek relay'e karşı (eşleşme, resume, relay yeniden başlatma, keşif, onay/ret, history, modüller, konsol)
- Taşınanlar: `@himmetkaan/remote-devtools-mdns` paketi Faz 6'ya (desktop'taki mDNS yayınıyla birlikte test edilebilsin diye);
  `examples/web` Faz 3'e (UI v2'ye geçince uçtan uca görülebilsin diye)

### Faz 3 — UI çekirdeği
- [x] Tüm metinler İngilizce; UI v2 protokolünü konuşuyor, v1 tipleri silindi
- [x] Modül kayıt defteri (`modules/registry.ts`): `capabilities` → tab listesi; tanınmayan modüller cihaz kartında listelenir
- [x] Cihaz seçici (sol panel): durum, app, platform; cihaz başına ayrı log / istek / komut durumu; kart `meta` alanlarını gösterir
- [x] Eşleşme ekranı: QR + 6 haneli kod + relay adresi; bekleyen bağlantı istekleri her görünümde üstte (Approve / Reject / Always allow); onaylı cihaz listesi
- [x] Logs (çekirdek): cihaz bazlı, seviye / kaynak / tag filtresi, arama, oturum olaylarını gösterme seçeneği; `history` kayıtları zaman sırasına yerleşir
- [x] IndexedDB kalıcılığı ve Sync kaldırıldı (G14)
- [x] Kısayollar: `1–9` tab'lar (cihazın modül sırasıyla), `[` / `]` cihazlar arası
- [x] `examples/web`: SDK'yı kullanan web sayfası (kod/QR ile eşleşme, dev modu, loglar, field DSL'li örnek fonksiyonlar)
- [x] Tarayıcıda uçtan uca doğrulandı: dev bağlantı isteği + onay, kodla ikinci cihaz, fonksiyon çağrısı + form doğrulama, history, eşleşme kaldırma, dar ekran
- Öne alınanlar (Faz 4'ten): Network ve Functions tab'larının UI tarafı v2'ye taşındı; field DSL form çizici yazıldı

### Faz 4 — Network + Functions modülleri (SDK tarafı)
- [x] `networkModule()`: fetch ve XHR'ı otomatik yakalar (RN'de varsayılan sadece XHR, çünkü RN fetch'i XHR üzerinde çalışır); `axios(instance)` interceptor'ları; `record()` ile elle kayıt; `ignoreUrls`; gövde sınırı + `bodyTruncated`; HTTP ≥ 400 ve ağ hataları `error`; SDK'nın kendi keşif istekleri yakalanmaz; destroy'da yamalar geri alınır
- [x] `functionsModule()`: `register({id, title, group, args, handler})` (tipli argümanlar), `unregister`, bağlıyken değişiklik `capabilities.update` ile gider; argümanlar handler'dan önce `validateArgs` ile doğrulanır
- [x] `validateArgs` protokol paketinde (field DSL doğrulaması; varsayılanlar, bilinmeyen anahtarlar atılır); select seçenekleri `as const` kabul eder
- [x] `examples/web` ve `fake-device` yerleşik modüllere geçti; örnekte ağ butonları ve çalışma anında fonksiyon ekleme/silme
- [x] Yayınlanabilir build (protocol + SDK): `scripts/build-lib.ts` → ESM + CJS (ES2020, Hermes uyumlu) + `.d.ts`; `publishConfig` yayında `dist`'i gösterir. `pnpm pack` çıktısı boş bir projede ESM, CJS ve TypeScript ile doğrulandı
- [x] 36 SDK testi (modüller: fetch, XHR, axios, manuel kayıt, kısaltma, history, keşfin yakalanmaması, fonksiyon doğrulama/hata/dinamik kayıt)
- Not: paketler Faz 9'a kadar `private: true`; Pembe Panjur (Faz 5) `pnpm pack` tarball'larıyla kurulabilir

### Faz 5 — Pembe Panjur geçişi (referans entegrasyon)
- [x] Dağıtım: npm'e yayın yerine `pnpm pack:sdk <klasör>` ile tarball; mobile-app'te `vendor/remote-devtools/` + yarn `file:`
      bağımlılığı ve protokol paketi için `resolutions`. Yarn tarball'ı içerik özetiyle önbelleğe aldığı için her paketlemede sürüm artırılır
- [x] mobile-app (`hks/remote-devtools-v2` dalı): SDK yalnızca Dev Menu açıkken çalışır (`startRemoteDevtools` / `stopRemoteDevtools`)
- [x] 17 komut `functionsModule` ile app tarafında tanımlandı (başlık, grup, onay, select argümanları)
- [x] `userId` / `apiEndpoint` → `meta`; değişince `updateMeta`
- [x] Network: otomatik yakalama kapalı; mevcut axios kancaları `network.record()` ile bağlandı (yalnızca API trafiği, `result_code === 1` kuralı korunur)
- [x] v1 istemcisi, `RemoteProtocol.ts` kopyası ve serializer'lar kaldırıldı; Remote tab'ı SDK bağlantı API'sini kullanır (QR, 6 haneli kod, dev keşfi)
- [x] Doğrulama: tsc (yeni hata yok), eslint, jest, iOS Hermes bundle (`expo export`)
- [x] Uçtan uca deneme (iOS simülatörü + Android emülatörü, Dev Menu açık): dev keşfi ve onay (iOS `localhost`, Android `10.0.2.2`),
      bağlantı öncesi istekler (`history`), Network (gerçek API istekleri), Functions (modal açma, sonuç döndürme, select argümanları),
      uygulama öldürülüp açılınca onaysız resume, arka plan/ön plan, UI'dan unpair + "Always allow" ile onaysız yeniden bağlanma
- [x] relay-devtools: `feat/generic-platform` → `main` birleştirildi ve push'landı; v1 kodu kaldırıldı (v1 uygulama sürümleri kullanımda değil)
- [x] mobile-app: `hks/remote-devtools-v2` dalı push'landı (SDK `0.1.0-alpha.1`); PR henüz açılmadı

### Faz 6 — Desktop app (Electron, macOS arm64)
- [x] Electron iskeleti: main process'te gömülü relay (`createRelay`), pencerede `packages/ui` (v1 desktop uygulaması `apps/desktop`'a taşındı)
- [x] Sabit port (8787, `DEVTOOLS_PORT`), LAN IP tespiti ve arayüz seçimi (Network menüsü), QR'a doğru adres (`relay.setPublicUrl`)
- [x] `connectRequests: 'local'`; SDK yerel keşfi varsayılan olarak 8787 ve 8080'i dener
- [x] Bağlantı metadata'sının diskte saklanması (`relay-state.json`, `0600`) + kalıcı UI oturumu; veri saklanmaz
- [x] electron-builder (pnpm monorepo ile): ad-hoc imzalı `.dmg` + `.zip`, paketlenmiş uygulama doğrulandı
- [x] mDNS yayını (`_remotedevtools._tcp`, TXT `v=2`, `path`, `name`; `bonjour-service`): Network menüsünde "Advertise on Local
      Network (Bonjour)", varsayılan kapalı, tercih `userData/settings.json`'da; ağ değişince yeniden duyurulur.
      macOS'un kendi Bonjour'u (`dns-sd`) ile görüldüğü doğrulandı. Info.plist: NSLocalNetworkUsageDescription + NSBonjourServices
- [x] `@himmetkaan/remote-devtools-mdns` paketi: `mdnsDiscovery(browser)` (bulunan servisleri `/discovery` ile yoklar),
      `zeroconfBrowser` (react-native-zeroconf), `bonjourBrowser` (Node); Expo config plugin `/plugin` (CJS; iOS Bonjour +
      yerel ağ metni, Android multicast izni). 7 test (gerçek multicast testi CI'da atlanır). Pembe Panjur'a eklenmedi
- [ ] İsteğe bağlı: gömülü relay yerine uzak (self-hosted) bir relay'e bağlanma modu
- [x] Developer ID imzası (hardened runtime), notarization (App Store Connect API anahtarı), electron-updater (GitHub provider;
      açılışta ve 6 saatte bir kontrol, arka planda indirme, "Restart now / Later", menüde "Check for Updates…")
- [x] `Desktop release` workflow'u (`desktop-v*` tag'i, macOS runner): taslak release → imza + notarization → doğrulama → yayın.
      `pnpm dist:desktop` imzasız; imzalı yerel build `CSC_NAME` ister (Keychain'de başka şirketlerin sertifikaları var).
      npm workflow'u artık GitHub release açmıyor (güncelleyici repodaki "latest" release'e bakıyor). İlk imzalı sürüm: 0.2.0
- [x] `appId`: `com.himmetkaan.remote-devtools` (imzalama kişisel Apple Developer hesabıyla yapılacak)

### Faz 7 — Storage, State, Flags modülleri
Kararlar: üç modül tek seferde; State'te farkı SDK hesaplar (JSON Patch); flag override'ları cihazda kalıcı; State salt okunur;
Pembe Panjur entegrasyonu bu fazda yapılmadı (doğrulama `examples/web` + `fake-device` ile).
- [x] Storage: adapter arayüzü (`keys/get/getMany/set/remove/clear/subscribe`, `masked`); AsyncStorage, MMKV (v3/v4), Web Storage
      (localStorage/sessionStorage) adapter'ları, SecureStore (salt okunur, maskeli, anahtarlar elle verilir); UI'da tablo, filtre,
      JSON/ham görünüm, düzenleme, yeni anahtar, silme ve tümünü silme (onaylı); `module.storage.changed` ile canlı yenileme
- [x] State: adapter arayüzü (`getState/subscribe(action?)`); Redux (action adları için `dispatch` sarılır) ve Zustand adapter'ları;
      kiralık abonelik (60 sn, UI 20 sn'de bir yeniler), throttle'lı JSON Patch, büyük farkta tam state; UI'da JSON ağacı ve
      değişiklik zaman çizelgesi (yol, eski → yeni); yeniden abone olunca aradaki fark "Changes while not watching" olarak gösterilir
- [x] Flags: `flags.define` (tipli handle: `get/subscribe`), `get`, `setValue` (app değeri), `reset`, `ready`; UI'dan override
      (field DSL ile doğrulanır), tek tek / toplu sıfırlama; override'lar `ctx.storage` ile kalıcı, tanımla uyuşmayanlar atılır,
      SDK kapalıyken uygulanmaz. Değişiklikler `capabilities.update` ile gider (`module.flags.changed` kaldırıldı)
- [x] Protokol: `diffJson` / `applyPatch` / `getAtPointer` (SDK ve UI ortak), `STATE_SUBSCRIPTION_TTL_MS`, `module.storage.clear`
- [x] 13 yeni SDK testi (JSON patch, dört storage adapter'ı, Redux/Zustand akışı, flag doğrulama/kalıcılık/async depo); toplam 50
- [x] `examples/web`: localStorage + sessionStorage, Zustand todo store'u, banner/renk flag'leri; `fake-device`: bellek deposu, sayaç store'u, iki flag
- [x] Tarayıcıda uçtan uca doğrulandı: storage listeleme/düzenleme/silme, canlı state akışı ve yeniden bağlanınca fark,
      flag override → sayfa yeniden yüklenince korunması → toplu sıfırlama, dar ekran
- [x] Pembe Panjur (SDK `0.1.0-alpha.3`, `hks/remote-devtools-v2` dalı): Storage = AsyncStorage + MMKV `analytics-data` (ikisi de
      salt okunur, SecureStore kodda kullanılmıyor); State = 17 Zustand store'unun hepsi (StoreDeveloper diziyi yerinde değiştirdiği
      için sadece sayılar); Flags = 17 `temporaryAppSettings` anahtarı (app değeri GrowthBook/A-B'den, override store her değiştiğinde
      yeniden uygulanır, `GrowthbookHelpers`'a dokunulmadı) + 3 Dev Menu ayarı (override tutulmaz, ayara doğrudan yazılır).
      tsc (yeni hata yok), eslint, jest, iOS Hermes bundle; simülatörlerde kullanıcı tarafından denendi

### Faz 8 — Şemalı özel paneller
Kararlar: her panel ayrı tab; handler'lar blokta inline; veri app'ten itilir (`panel.update`), UI'ın çektiği `load()` yok;
planlanan 5 bloğa `text` ve `stats` eklendi. Pembe Panjur'da şimdilik kullanılmıyor.
- [x] Protokol: `PanelDef` + 7 blok (text, stats, keyValue, table, json, actions, form), `BlockData`; `module.panels.update`
      (blok alanları, kısmi) ve `module.panels.action` (`blockId` eklendi; `row` / `values`); tanım değişince `capabilities.update`
- [x] SDK: `panelsModule()`, `define` → `{update(blockId, data), setBlocks, remove}`; aksiyon, satır aksiyonu (`handler(row)`) ve
      form (`submit.handler(values)`, `fields`'a göre doğrulanır) handler'ları; handler'lar UI'a gitmez; blok id / tip denetimi
- [x] UI: panel başına tab (ikon + başlık, 1–9 kısayolları), blok renderer'ları (8+ satırlı tabloda filtre, 200 satırlık sayfalama),
      aksiyon sonucu blokta ve Logs'ta, onay ve tehlikeli aksiyonlar, form doğrulama, dar ekranda yatay kayan tablo
- [x] 2 yeni SDK testi (toplam 52); `examples/web`'de tüm blokları kullanan "Todo panel", `fake-device`'da sayaç paneli
- [x] Tarayıcıda uçtan uca doğrulandı: form ile ekleme, satır aksiyonu, onaylı aksiyon, canlı blok güncellemesi, sayfa
      yenilenince panelin geri gelmesi, boş form doğrulaması, dar ekran

### Faz 9 — Açık kaynak yayını
Kararlar: repo `hks/remote-devtools` olarak yeniden adlandırılır, geçmiş korunur; kod yorumları ve dışa açık dokümanlar
İngilizce, bu plan Türkçe kalır (`docs/internal`, siteye girmez); doküman sitesi VitePress (GitHub Pages); yayın altyapısı
hazırlanır, ilk yayını kullanıcı tetikler. npm'e sadece SDK ve protokol paketleri çıkar; relay ve UI Docker imajı ve
desktop app içinde dağıtılır.
- [x] Kod yorumları İngilizce (80 dosya, sadece yorumlar)
- [x] README (İngilizce) baştan yazıldı, Pembe Panjur referansları temizlendi; v1 PLAN/ROADMAP `docs/internal/v1`'e taşındı
- [x] Doküman sitesi (`docs/`, VitePress 1.6.4): giriş, web ve RN/Expo quick start, bağlantı, desktop, self-hosting, güvenlik,
      modül başına sayfa, SDK / field DSL / protokol referansı, "Writing an SDK", geliştirme ve yayın sayfaları
- [x] `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, issue formları, PR şablonu; paketlere npm README'leri ve metadata
- [x] changesets (2.31.1; SDK + protokol birlikte sürümlenir, `0.1.0` changeset'i hazır), `Release` (version PR + npm, provenance),
      `Docker image` (`v*` tag'lerinde GHCR, amd64 + arm64), `Docs` (Pages) workflow'ları; `version-packages` `SDK_VERSION`'ı eşitler
- [x] Temiz public repo: commit e-postası (iş adresi) geçmişte GitHub noreply adresine çevrildi ve yeni public
      `hks/remote-devtools` reposuna push'landı (27 commit, içerik aynı). Eski repo `hks/remote-devtools-private` olarak
      private yedek; eski PR #1 ve `desktop-v0.1.0` release'i orada kaldı. Yerelde `origin` = public, `private` = yedek
- [x] Pages (GitHub Actions) ve Actions'ın PR açma izni açıldı; CI, Release ve Docs yeşil; site yayında
      (https://hks.github.io/remote-devtools/); Release workflow'u "Version packages" PR'ını açtı (0.1.0)
- [ ] Kullanıcı: `NPM_TOKEN` secret'ı → version PR'ındaki CI'ı onaylayıp PR'ı birleştirmek (ilk npm yayını);
      ilk `v0.1.0` tag'i (GHCR imajı) ve imajın public yapılması

### Sonraki fazlar (kapsam dışı, sırası belirlenecek)
- Swift SDK (URLSession yakalama), Kotlin SDK (OkHttp interceptor), Flutter SDK (Dio)
- Desktop için Intel ve Windows/Linux build'leri
- Self-hosted relay için kimlik doğrulama/login

---

## 5. Açık noktalar

- GitHub repo adı (şu an `relay-devtools-sociallift`) açık kaynak yayından önce generic bir adla değiştirilmeli.
- mDNS için RN tarafında `react-native-zeroconf` gibi bir native bağımlılık ve Expo config plugin gerekir.
  Bu yüzden ayrı paket ve opsiyoneldir (G20). Expo Go'da çalışmaz; dev build şarttır. Kurulmayan projelerde
  çekirdek SDK hiçbir native bağımlılık taşımaz.
- `history` tamponu varsayılan olarak sadece bellekte tutulur. Uygulama öldürülünce kaybolur. Diskte tutma
  ihtiyacı çıkarsa ileride adapter ile eklenebilir.

---

## 6. Güncel durum (yeni oturum için)

Son güncelleme: 2026-10-14. Tamamlanan: Faz 0–5, Faz 7 (Pembe Panjur dahil), Faz 8 (Pembe Panjur'da kullanılmıyor),
Faz 9'un kod/doküman kısmı;
Faz 6'nın bir kısmı (bkz. §4 işaretleri).

**Repolar**
- remote-devtools (bu repo, public `hks/remote-devtools`; eski geçmiş private `hks/remote-devtools-private`'ta):
  `main` güncel ve push'lu; CI (typecheck, test, build, docker build) yeşil.
  Faz 7 `main`'e birleştirildi ve push'landı.
- mobile-app (Pembe Panjur): `~/WebstormProjects/experimental/iphone-duo`, dal `hks/remote-devtools-v2` (push'lu, PR yok).
  SDK npm'den (`@himmetkaan/remote-devtools@0.1.0`). Entegrasyon: `helpers/developer/remote/RemoteDevtools.ts` (SDK kurulumu), `RemoteFunctions.ts` (17 fonksiyon),
  `RemoteNetwork.ts` (axios kancaları → `network.record()`), `RemoteStorage.ts`, `RemoteState.ts`, `RemoteFlags.ts`,
  `components/ui/developer/components/DeveloperRemotePanel.tsx`.

**SDK'yı uygulamada güncellemek** (mobile-app 0.1.0'dan beri npm'den kurar):
1. Bu repoda değişiklikle birlikte `pnpm changeset` ekle; "Version packages" PR'ı birleşince npm'e yayınlanır
   (yeni sürümün npm'de okunabilir olması birkaç dakika sürebilir).
2. mobile-app `package.json`'da `@himmetkaan/remote-devtools` sürümünü güncelle, `yarn install`; çalışan Metro'yu `-c` ile yeniden başlat.
3. Yayınlamadan denemek için: `pnpm pack:sdk <klasör>` ile tarball üretip geçici olarak `file:` bağımlılığıyla kurulabilir.

**Geliştirme komutları:** `pnpm dev:relay` (8080, `CONNECT_REQUESTS=local`), `pnpm dev:ui` (5173), `pnpm dev:example` (5174),
`pnpm dev:desktop`, `pnpm dist:desktop`, `pnpm test`, `node packages/sdk-js/scripts/fake-device.ts dev 8080`.

**Açık işler / hatırlatmalar**
- mobile-app: PR açılması; çalışma ağacında kullanıcının commit'lenmemiş Expo yama güncellemeleri var (bilerek dahil edilmedi).
- mobile-app: `.yarnrc.yml` ve `.npmrc` içinde açık npm token'ı git'te takip ediliyor; iptal edilip ortam değişkenine taşınmalı.
- Bu makinede iOS build'i Xcode 27 (Swift 6.4) ile Expo 57'nin hazır framework'leri (Swift 6.3.1) uyuşmadığı için alınamıyor.
- Lint/format (Faz 0) hâlâ ekli değil.

- `yarn install` çalışan Metro'nun dosya haritasını bozabiliyor (paketler yeniden bağlanırken "module not found");
  SDK güncellemesinden sonra Metro `-c` ile yeniden başlatılmalı.

- Kullanıcı kararıyla bekletilenler: mobile-app PR'ı (açılmayacak), Faz 0 lint/format, Faz 6'nın kalanı.
  mobile-app'teki npm token konusu bu projenin kapsamı dışında.

**Sıradaki seçenekler:** Faz 9'un kullanıcıya kalan adımları (repo adı, secret'lar, ilk yayın) veya bekletilen işlerden biri. Faz 6'nın kalanında Developer ID
imzası + notarization + electron-updater için [macos-release.md](../maintainers/macos-release.md)'deki sertifika/secret adımları kullanıcıdan gerekir.

