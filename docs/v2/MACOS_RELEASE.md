# macOS yayını — imzalı ve notarize edilmiş .dmg (GitHub Releases)

App Store'a gönderilmez. Uygulama **Developer ID** ile imzalanır, Apple'a **notarize** ettirilir ve
GitHub Releases'tan indirilir. Böylece kullanıcı açarken Gatekeeper uyarısı görmez. Güncellemeler
`electron-updater` ile yine GitHub Releases üzerinden gelir.

---

## Senin yapman gerekenler (bir kerelik)

### 1. Developer ID Application sertifikası
1. developer.apple.com → Certificates, IDs & Profiles → Certificates → **+**
2. **Developer ID Application**'ı seç (bu "Apple Distribution" değil, App Store dışı dağıtım içindir).
3. Mac'te Keychain Access → Certificate Assistant → *Request a Certificate From a Certificate Authority* ile CSR oluştur ve yükle.
4. İndirdiğin sertifikayı çift tıklayarak Keychain'e ekle.
5. Keychain'de sertifikayı **özel anahtarıyla birlikte** seç → Export → `.p12` olarak kaydet ve güçlü bir parola ver.
6. Base64'e çevir (çıktıyı GitHub secret'ına yapıştıracaksın):
   ```bash
   base64 -i DeveloperID.p12 | pbcopy
   ```

### 2. Notarization için App Store Connect API anahtarı
1. appstoreconnect.apple.com → Users and Access → **Integrations** → App Store Connect API → **Team Keys** → **+**
2. Rol: **Developer**. İndirilen `AuthKey_XXXXXX.p8` dosyası sadece bir kez indirilebilir, güvenli sakla.
3. Sayfadaki **Key ID** ve **Issuer ID**'yi not al.

### 3. Team ID
developer.apple.com → Membership details → **Team ID** (10 karakter).

### 4. GitHub repo secret'ları
Repo → Settings → Secrets and variables → Actions:

| Secret | Değer |
|---|---|
| `CSC_LINK` | Adım 1'deki base64 `.p12` içeriği |
| `CSC_KEY_PASSWORD` | `.p12` parolası |
| `APPLE_API_KEY_BASE64` | `base64 -i AuthKey_XXXXXX.p8` çıktısı |
| `APPLE_API_KEY_ID` | Key ID |
| `APPLE_API_ISSUER` | Issuer ID |
| `APPLE_TEAM_ID` | Team ID |

Bunları eklediğini haber vermen yeterli. Gerisi Faz 6'da kod tarafında yapılacak.

> Lokal test için aynı değerleri `.env.release` dosyasına koyabilirsin (git'e girmez). Sertifika Keychain'de olduğu sürece
> lokal imzalama `CSC_LINK` olmadan da çalışır.

---

## Kod tarafında yapılacaklar (Faz 6, bende)

- **electron-builder** yapılandırması
  - `mac.target`: `dmg` + `zip` (zip, `electron-updater` için gerekli), `arch: arm64`
  - `hardenedRuntime: true`, `gatekeeperAssess: false`, `entitlements` (Electron için `allow-jit` ve `allow-unsigned-executable-memory`)
  - `notarize: true` (notarytool + API anahtarı)
  - `publish: { provider: 'github' }`
- **Info.plist** ekleri: `NSLocalNetworkUsageDescription` ve `NSBonjourServices: ["_remotedevtools._tcp"]`.
  macOS'un Yerel Ağ izni mDNS yayını ve LAN'dan gelen bağlantılar için bunlara bakar.
- **GitHub Actions** (`.github/workflows/release-desktop.yml`)
  - Tetikleyici: `desktop-v*` tag'i
  - Runner: `macos-14` (Apple Silicon)
  - Adımlar: pnpm install → build → `.p8`'i secret'tan dosyaya yaz → `electron-builder --mac --arm64 --publish always`
  - Çıktı: taslak bir GitHub Release (`.dmg`, `.zip`, `latest-mac.yml`). Kontrol edip yayınlarsın.
- **Otomatik güncelleme:** `electron-updater` açılışta ve periyodik olarak yeni sürümü kontrol eder ve kullanıcıya sorar.

## Doğrulama

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/Remote DevTools.app"
```

```bash
spctl -a -vvv -t install "/Applications/Remote DevTools.app"
```

```bash
xcrun stapler validate "Remote DevTools.dmg"
```

`spctl` çıktısında `source=Notarized Developer ID` görülmeli.
