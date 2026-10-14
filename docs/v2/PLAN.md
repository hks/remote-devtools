# Remote DevTools v2 — Generic platform planı

Amaç: Pembe Panjur'a bağlı bu aracı, herhangi bir developer'ın kendi uygulamasına SDK ile bağlayabildiği
açık kaynak bir platforma dönüştürmek.

İlgili dokümanlar: [PROTOCOL.md](./PROTOCOL.md) (protokol v2 taslağı) · [MACOS_RELEASE.md](./MACOS_RELEASE.md) (imzalı .dmg yayını)
v1 dokümanları: [../../PLAN.md](../../PLAN.md) · [../../ROADMAP.md](../../ROADMAP.md)

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
| G17 | Bağlantıyı hatırlama | QR veya kodla eşleşen app (production dahil) bağlantı bilgisini saklar. Uygulama öldürülüp açılsa da kaldığı yerden devam eder. Eşleşme **TTL** sonunda düşer (varsayılan 24 saat). Hem SDK'da hem relay'de ayarlanabilir. |
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
  veya relay reddederse bilgiyi siler. Relay tarafında eşleşme TTL'i `DEVICE_PAIRING_TTL_HOURS` ile ayarlanır.
  SDK'daki `pairingTtl` bu değeri sadece kısaltabilir.
- **Onaylı cihazlar (G16):** Desktop app onaylanan `deviceId` + app kimliğini hatırlar. Bu cihazlardan gelen
  sonraki isteklerde tekrar onay sorulmaz. Liste ayarlardan silinebilir.
- **Relay yeniden başlatılınca:** Desktop app sadece **bağlantı metadata'sını** (oturum sırrı, eşleşmeler,
  onaylı cihazlar) diskte saklar; veri saklamaz. Böylece app kapanıp açılınca cihazlar `resume` ile geri döner.
  Sunucudaki relay varsayılan olarak bellek kullanır; isteğe bağlı bir dosya deposu (`STATE_FILE`) eklenebilir.

---

## 3. SDK (JS) API taslağı

```ts
import {RemoteDevTools} from '@himmetkaan/remote-devtools';
import {networkModule, functionsModule, storageModule, stateModule, flagsModule} from '@himmetkaan/remote-devtools/modules';
import {asyncStorageAdapter} from '@himmetkaan/remote-devtools/adapters/async-storage';
import {zustandAdapter} from '@himmetkaan/remote-devtools/adapters/zustand';

const devtools = RemoteDevTools.init({
    enabled: showDevMenu,            // G13: zorunlu; false iken her şey no-op
    isDevelopment: __DEV__,          // G16: mDNS/localhost otomatik keşif
    app: {id: 'com.pembepanjur.app', name: 'Pembe Panjur', version, build},
    meta: {userId: String(user.id), apiEndpoint},  // UI'da cihaz kartında gösterilir
    history: {enabled: true, maxEntries: 500},     // G15
    discovery: {localhost: true, mdns: false},     // G20: mdns için @himmetkaan/remote-devtools-mdns kurulmalı
    persistence: asyncStorageAdapter(AsyncStorage), // eşleşme bilgisi için
    modules: [
        networkModule({autoCapture: true}),
        functionsModule(),
        storageModule({adapters: [asyncStorageAdapter(AsyncStorage)]}),
        stateModule({stores: [zustandAdapter('deviceInfo', useDeviceInfoStore)]}),
        flagsModule(),
    ],
});

devtools.log.info('Logged in', {userId});

devtools.functions.register({
    id: 'rateUs.setDecision',
    title: 'Set Rate Us decision',
    group: 'Rate Us',
    args: {decision: {type: 'select', options: ['notShown', 'yes_yes', 'yes_no', 'no_yes', 'no_no']}},
    handler: async ({decision}) => { /* ... */ return {ok: true}; },
});

devtools.flags.define({key: 'newPaywall', type: 'boolean', default: false});
devtools.panels.define({id: 'session', title: 'Session', blocks: [/* PROTOCOL §7 */]});

// Bağlantı UI'ı developer'ın elinde: SDK durum + aksiyon verir, ekranı app çizer
devtools.connection.pairWithQr(qrString);   // veya pairWithCode('123456', relayUrl)
devtools.connection.subscribe((state) => {/* idle | discovering | pending-approval | connected | ... */});
```

Notlar:
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
- [x] `packages/protocol`: v2 zarfı, çekirdek mesajlar, `module.*` yönlendirme, field DSL ve panel tipleri ([PROTOCOL.md](./PROTOCOL.md))
- [x] v1 tipleri geçici olarak `@himmetkaan/remote-devtools-protocol/v1` altında; UI Faz 3'te v2'ye geçince silinecek
- [x] Relay: çoklu cihazlı oturum, `deviceId` ile yönlendirme, cihaz mesajlarına `deviceId` damgası
- [x] Relay: `module.*` mesajlarını içeriğine bakmadan iletme, boyut sınırı, cihaz başına hız sınırı
- [x] Relay: 6 haneli kod ile eşleşme; QR ve kod tek kullanımlık, IP başına başarısız deneme sınırı
- [x] Relay: `connect` → UI onayı → `paired` / `connect.rejected`; `CONNECT_REQUESTS=off|local|any`; onaylı cihaz listesi
- [x] Relay: eşleşme TTL'i (`DEVICE_PAIRING_TTL_HOURS`, kesin süre), süresi dolunca `unpaired{reason:'expired'}`
- [x] Relay: `GET /discovery` (CORS açık)
- [x] Relay: kütüphane olarak dışa açılması (`createRelay({...})`) + CLI (`main.ts`)
- [x] Relay: bağlantı metadata'sının `STATE_FILE`'a yazılması (atomik, `0600`); desktop app bunu kullanacak
- [x] Testler v2'ye taşındı: 69 test (çoklu cihaz, kod, onay, onaylı cihaz, TTL, hız sınırı, kalıcılık, IP sınıflandırma)
- [x] `fake-device.ts` (qr / code / connect modları, örnek fonksiyonlar) ve `smoke.ts` v2'ye taşındı

### Faz 2 — JS SDK çekirdeği
- [ ] `RemoteDevTools.init`, `enabled` kapısı (kapalıyken no-op ve sıfır yan etki)
- [ ] Bağlantı durum makinesi: pair (QR/kod) · resume · yeniden bağlanma (backoff) · lifecycle (AppState / visibilitychange)
- [ ] Eşleşme bilgisinin saklanması + TTL (persistence adapter: AsyncStorage, SecureStore, localStorage)
- [ ] `isDevelopment` keşfi: localhost (iOS sim `localhost`, Android emu `10.0.2.2`)
- [ ] Keşif eklenti arayüzü (`DiscoveryProvider`); mDNS bu arayüzü uygulayan ayrı bir paket olarak gelir
- [ ] `@himmetkaan/remote-devtools-mdns` paketi (RN: zeroconf + Expo config plugin); `discovery.mdns` varsayılan kapalı
- [ ] `log` API'si + `history` tamponu (halka tampon, `maxEntries`)
- [ ] Modül arayüzü (`defineModule`) ve `capabilities.update`
- [ ] `relay/scripts/fake-device.ts` SDK üzerine yeniden yazılır (Node ortamında SDK)
- [ ] `examples/web` ile uçtan uca test

### Faz 3 — UI çekirdeği
- [ ] Tüm metinler İngilizce
- [ ] Modül kayıt defteri: `capabilities` → tab listesi; bilinmeyen modül için "unsupported" bilgisi
- [ ] Cihaz seçici (sol panel): durum, platform, app, `meta` alanları, cihaz başına ayrı store
- [ ] Eşleşme ekranı: QR + 6 haneli kod + bekleyen bağlantı istekleri (Onayla/Reddet) + onaylı cihazlar
- [ ] Logs (çekirdek): cihaz bazlı, filtre ve arama
- [ ] IndexedDB kalıcılığının kaldırılması (G14) ve Sync butonunun kaldırılması
- [ ] Kısayolların yeni tab yapısına uyarlanması

### Faz 4 — Network + Functions modülleri
- [ ] SDK: fetch/XHR otomatik yakalama (RN ve tarayıcı), axios adapter'ı, `network.record()`, body boyut sınırı
- [ ] SDK: `functions.register`, argüman doğrulama, `invoke` → handler → `invokeResult`
- [ ] UI: Network tab'ının generic hale getirilmesi (mevcut filtre, JSON ağacı, cURL, HAR export korunur)
- [ ] UI: field DSL form renderer'ı (Functions ve paneller ortak kullanır)
- [ ] UI: Functions tab'ı tamamen `capabilities.functions` üzerinden çizilir; `web/src/lib/commands.ts` silinir

### Faz 5 — Pembe Panjur geçişi (referans entegrasyon)
- [ ] mobile-app'e `@himmetkaan/remote-devtools` eklenmesi (`enabled: showDevMenu`)
- [ ] `commands.ts` içindeki tüm komutların app tarafında `functions.register` ile tanımlanması
- [ ] `userId` / `apiEndpoint` → `meta`
- [ ] `helpers/developer/remote/` ve `RemoteProtocol.ts` kopyasının kaldırılması; Remote tab'ın SDK bağlantı API'sini kullanması
- [ ] v1 ile özellik eşdeğerliği kontrol listesi (QR, resume, network, functions, lifecycle, logs)
- [ ] Bu noktada `main` dalına birleştirme ve v1'in kaldırılması

### Faz 6 — Desktop app (Electron, macOS arm64)
- [ ] Electron iskeleti: main process'te gömülü relay (`createRelay`), renderer'da `packages/ui`
- [ ] Port seçimi, LAN IP tespiti, QR'a doğru adresin yazılması
- [ ] mDNS yayını (`_remotedevtools._tcp`), ayarlardan açılıp kapatılabilir; macOS Yerel Ağ izni metinleri
- [ ] Bağlantı metadata'sının diskte saklanması (oturum, eşleşmeler, onaylı cihazlar). Veri saklanmaz
- [ ] İsteğe bağlı: gömülü relay yerine uzak (self-hosted) bir relay'e bağlanma modu
- [ ] electron-builder: imzalama, notarization, `.dmg` + `.zip`, electron-updater (GitHub provider)
- [ ] GitHub Actions release iş akışı ([MACOS_RELEASE.md](./MACOS_RELEASE.md))

### Faz 7 — Storage, State, Flags modülleri
- [ ] Storage: adapter arayüzü (`keys/get/set/remove/clear`); AsyncStorage, MMKV, localStorage adapter'ları; UI'da tablo, düzenleme ve silme (onaylı)
- [ ] State: adapter arayüzü (`getSnapshot/subscribe`); Redux ve Zustand adapter'ları; UI'da JSON ağacı ve canlı değişiklik akışı (diff)
- [ ] Flags: `flags.define`, `flags.get`, uzaktan override, override'ları sıfırlama; UI'da tip bazlı düzenleyici (field DSL)

### Faz 8 — Şemalı özel paneller
- [ ] Protokol: `PanelDef` + blok tipleri (table, keyValue, json, actions, form) + `panel.update` (tam ve kısmi)
- [ ] SDK: `panels.define`, `panels.update(id, blockId, data)`, aksiyon ve form handler'ları
- [ ] UI: panel renderer'ı, her panel ayrı bir tab olarak

### Faz 9 — Açık kaynak yayını
- [ ] README (İngilizce) baştan yazılır, Pembe Panjur referansları temizlenir; v1 PLAN/ROADMAP arşive taşınır
- [ ] Dokümantasyon: Quick start (Expo, web), protokol spesifikasyonu, "kendi SDK'nı yaz" rehberi, modül referansı
- [ ] `LICENSE` (MIT), `CONTRIBUTING.md`, issue şablonları
- [ ] npm yayını (`@himmetkaan` organizasyonu altında), changesets ile sürümleme
- [ ] Docker imajının GHCR'a yayınlanması

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
