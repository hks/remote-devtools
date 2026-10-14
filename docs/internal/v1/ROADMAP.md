# Remote DevTools — Roadmap

Detaylar için bkz. [PLAN.md](./PLAN.md).
Durum: `[ ]` yapılacak · `[~]` devam ediyor · `[x]` tamamlandı

---

## Faz 1 — Relay & altyapı

- [x] `devtools-web/` iskeleti (`relay/`, `shared/`; `web/` Faz 2'de)
- [x] `.git/info/exclude` ile git dışı bırakma
- [x] `PLAN.md` ve `ROADMAP.md`
- [x] `shared/protocol.ts` — mesaj zarfı + v1 tipleri
- [x] Relay: Node + TypeScript + `ws` kurulumu
- [x] Relay: `createSession` / `resumeSession` (web)
- [x] Relay: `pairToken` üretimi (tek kullanımlık, 2 dk TTL) ve yenileme
- [x] Relay: `pair` / `resume` (telefon), `deviceSecret` üretimi
- [x] Relay: tek cihaz kuralı (oturum başına bir telefon)
- [x] Relay: web ↔ telefon mesaj yönlendirme
- [x] Relay: `deviceStatus` (connected / disconnected) yayını
- [x] Relay: `unpair` (web veya telefondan) → eşleşmeyi kaldır, telefona `unpaired`, web'e yeni QR
- [x] Relay: 15 sn heartbeat (ping/pong)
- [x] Relay: oturum çöp toplama (`SESSION_TTL_HOURS`)
- [x] Relay: `maxPayload` sınırı
- [x] Relay: build edilmiş web'i statik sunma (`WEB_DIST_DIR`)
- [x] `Dockerfile` (relay) — web build stage'i Faz 2'de eklenecek
- [x] `docker-compose.yml` (relay + caddy)
- [x] `Caddyfile` (prod TLS / lokal http)
- [x] `.env.example`
- [x] Uçtan uca test: `npm test` (23 senaryo) + `npm run smoke` (çalışan relay/Caddy'ye karşı)

## Faz 2 — Web: oturum & Logs

- [x] `Dockerfile`'a web build stage'i + `WEB_DIST_DIR`
- [x] Vite + React + TS kurulumu
- [x] WebSocket client + otomatik yeniden bağlanma
- [x] Oturumun `localStorage`'da tutulması (aynı tarayıcı = tek oturum, incognito = ayrı)
- [x] QR ekranı (cihaz bağlı değilken) + süre dolunca otomatik yenileme
- [x] Üst bar: cihaz kartı (platform, versiyon, kullanıcı, endpoint, durum rozeti)
- [x] Üst bar: **Bağlantıyı Kes** butonu
- [x] **📜 Logs** tabı (ilk tab)
  - [x] connected / disconnected / background / foreground olayları
  - [x] Seviye filtresi, zaman damgası, metin arama
  - [x] `log` mesaj tipini gösterme (ileriki console.log köprüsü için hazır)
- [x] `relay/scripts/fake-device.ts` — telefon olmadan test için sahte cihaz (stdin komutları: bg, fg, log, drop, resume, unpair)
- [x] Tarayıcıda doğrulandı: eşleşme, lifecycle, kopma/yeniden bağlanma, yenilemede oturuma dönüş, iki sekme aynı oturum, Bağlantıyı Kes, relay restart sonrası yeni oturum, QR otomatik yenileme, mobil genişlik

## Faz 3 — Mobile: Remote tab & bağlantı

- [x] Branch: `hks/remote-devtools`
- [x] `expo-camera` ekle
- [x] `helpers/developer/remote/RemoteProtocol.ts`
- [x] `store/developerStore/StoreRemoteDevtools.ts` (persisted bağlantı + volatile durum)
- [x] `helpers/developer/remote/RemoteClient.ts`
  - [x] connect / pair / resume
  - [x] exponential backoff reconnect
  - [x] `AppState` → `lifecycle` mesajları; ön plana dönünce reconnect
  - [x] Kopukken gönderim kuyruğu
  - [x] `unpaired` gelince kayıtlı bilgiyi temizle
  - [x] `hello` (cihaz bilgisi + desteklenen komutlar)
- [x] `DeveloperRemotePanel.tsx` — QR tarama, durum, Bağlantıyı Kes, elle yapıştırma alanı
- [x] `DeveloperPanel.tsx` — `🔗 Remote` tabı
- [x] `components/listeners/RemoteDevtoolsListener.tsx` (+ `_layout.tsx`'e mount) — `showDevMenu` açıksa otomatik bağlanma
- [x] `DeveloperButton.tsx` — bağlıyken yeşil nokta
- [x] Web'de `@shared` alias'ı yerine göreli import (app'in `tsconfig` `**/*.ts` ile `devtools-web`'i de tarıyor; alias çözülemiyordu)
- [x] App typecheck + lint temiz
- [x] Gerçek cihazda test (HKS iPhone): QR eşleşme, arka plan/ön plan, kapatıp açınca otomatik bağlanma, telefondan Bağlantıyı Kes
- [x] `app.config.ts`: iOS usage description'lar `ios.infoPlist` altına taşındı (önceden yok sayılıyordu → NSCameraUsageDescription eksikti)
- [x] Web: üst bar sabit grid (cihaz adı/durum değişince kayma yok), Logs araç çubuğu tek satır, mobilde saat kolonu

## Faz 4 — Service Requests & Sync

- [x] `helpers/developer/remote/RemoteSerializers.ts` (axios config/response → güvenli JSON, 1 MB üstü gövdeleri kısaltma)
- [x] `helpers/developer/remote/RemoteNetwork.ts` — interceptor köprüsü (hiç exception fırlatmaz)
- [x] `DeveloperFunctions.ts` — `request` / `response` emit + süre ölçümü
- [x] Protokol: `syncResult` parçalı (`total`, `final`) — relay 5 MB sınırına takılmasın
- [x] Telefon: `sync` → `syncResult` (`useDeveloperStore` içeriği, ~1 MB'lık parçalar)
- [x] Web: **Sync** butonu (ilerleme göstergesi, 30 sn zaman aşımı) + `uuid` ile tekilleştirme
- [x] Web: **🛎️ Service Requests** tabı
  - [x] Liste + detay split view (dar ekranda detay tam genişlik)
  - [x] JSON ağaç görünümü (katlanabilir, büyük dizilerde sayfalama)
  - [x] Süre / status / boyut kolonları
  - [x] URL arama, method & başarılı/hata/bekleyen filtresi
  - [x] Duraklat (olaylar biriktirilir, devamda uygulanır), temizle, otomatik kaydırma
  - [x] Klavye: ↑/↓ seçim, Esc kapat, Cmd/Ctrl+F arama
  - [x] Request/response gövdesi "JSON kopyala"
- [x] Gerçek cihazda doğrulandı: Sync (21 kayıt), tekrar Sync'te tekrar yok, canlı istekler

## Faz 5 — Functions

- [x] `helpers/developer/remote/RemoteCommands.ts` — 17 komut, mevcut helper'ları çağırır (Dev* bileşenlerine dokunulmadı)
- [x] Komutlar listener tarafından kaydedilir (`registerCommands`) — RemoteClient UI'a bağımlı değil, döngüsel import yok
- [x] Telefon: `invoke` → çalıştır → `invokeResult` (protokole `result` alanı eklendi)
- [x] Rate Us seçimleri: web'den seçilen seçenekle "sahte action sheet" → telefonda dokunmadan çalışır
- [x] `RemoteAfterReply`: errorOsman / closeDevMenu sonucu web'e ulaştıktan sonra çalışır
- [x] Web: **🧩 Functions** tabı (gruplar, arama, seçenekli komutlar, son sonuç + süre)
- [x] Web: telefonun bildirmediği komutları pasif göster; telefonda olup web'de olmayanları uyar
- [x] Web: tehlikeli komutlar için onay (rateUs.reset, clearDeviceInfo, errorOsman, closeDevMenu)
- [x] Web: sonuç kart üzerinde + Logs kaydı, 15 sn zaman aşımı
- [x] Fix: relay "replaced" (4000) ile kapatınca istemci yeniden bağlanmıyor (hot reload sonrası iki örneğin birbirini düşürme döngüsü); modül yeniden yüklenince eski örnek dispose ediliyor
- [x] Gerçek cihazda doğrulandı: rateUs.showDecision (sonuç web'de), tryBoost, rateUs.setDecision (web'den seçenek)

## Faz 6 — Web ekstraları

- [x] Copy as **cURL** (detay başlığında; params URL'e eklenir, tırnaklar shell-escape edilir — `bash -n` ile doğrulandı)
- [x] Tek kaydı (istek + yanıt) JSON olarak kopyala
- [x] Toplu export: JSON (görünen/filtrelenmiş istekler)
- [x] Toplu export: HAR 1.2 (Chrome DevTools, Charles, Proxyman)
- [x] IndexedDB ile kalıcılık (istekler + loglar), artımlı yazım
  - [x] Aynı tarayıcıda birden çok sekme: yalnızca bir sekme yazar (Web Locks), kapanınca devralınır
- [x] Klavye kısayolları: 1/2/3 tab, `/` arama, `s` Sync, `p` duraklat, ↑/↓, Esc, `?` yardım penceresi
- [x] Doğrulandı: yenileme sonrası 27 istek + loglar geri geldi, HAR 28 kayıt, cURL biçimi

## Faz 7 — Teslim

- [x] Mobile-app typecheck (0 hata) + lint (yeni dosyalar temiz; değişen dosyalara yeni hata eklenmedi)
- [x] `devtools-web/README.md` (kullanım, lokal & sunucu kurulum, env, bağlantı sorunları, güvenlik, protokol, yeni komut ekleme)
- [x] `hks/remote-devtools` push'landı (5 commit) — PR açılmadı (istek üzerine)
- [ ] Mobile-app PR (`hks/remote-devtools` → `master`)

## Backlog (ileride)

- [ ] ATT (NSUserTrackingUsageDescription) metni hâlâ bir plugin'in varsayılan İngilizce metniyle eziliyor — marka metni Info.plist'e ulaşmıyor
- [ ] Production build'de (Bitrise) kamera/galeri/mikrofon usage description'larının eksik olup olmadığını doğrula (7160c07 öncesi)
- [ ] Web sitesine login (SSO / backend dev kullanıcıları) — o zamana kadar sunucuda erişimi kısıtla (VPN / IP allowlist / basicauth)
- [ ] Relay'de yetki kontrolü (pair sırasında kullanıcı token'ı ile `CheckDevStatus` benzeri doğrulama)
- [ ] `console.log` köprüsü → Logs tabı
- [ ] Headers tabı
- [ ] Settings tabı
- [ ] Saved Users tabı
- [ ] Endpoints tabı
- [ ] Güvenlik: `DeveloperCheckButton` — `CheckDevStatus` cevap içeriğini doğrula
- [ ] Güvenlik: `devpayload` `openDevMenu` deep link'ine backend kontrolü
