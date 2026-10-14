# macOS signing and notarization

The desktop app is not distributed through the App Store. It is signed with a **Developer ID**, **notarized** by Apple and
downloaded from GitHub Releases, so users do not see a Gatekeeper warning when they open it. Updates are delivered through
GitHub Releases as well, using `electron-updater`.

::: warning Status
Developer ID signing, notarization, `electron-updater` and the release workflow described below are **planned** and not
implemented yet. The one-time steps can be done ahead of time so the secrets are in place when the release setup lands.
:::

---

## One-time steps for the maintainer

### 1. Developer ID Application certificate
1. developer.apple.com → Certificates, IDs & Profiles → Certificates → **+**
2. Choose **Developer ID Application** (not "Apple Distribution"; this one is for distribution outside the App Store).
3. On a Mac, create a CSR with Keychain Access → Certificate Assistant → *Request a Certificate From a Certificate Authority* and upload it.
4. Double-click the downloaded certificate to add it to the Keychain.
5. In the Keychain, select the certificate **together with its private key** → Export → save as `.p12` and set a strong password.
6. Convert it to Base64 (you will paste the output into a GitHub secret):
   ```bash
   base64 -i DeveloperID.p12 | pbcopy
   ```

### 2. App Store Connect API key for notarization
1. appstoreconnect.apple.com → Users and Access → **Integrations** → App Store Connect API → **Team Keys** → **+**
2. Role: **Developer**. The downloaded `AuthKey_XXXXXX.p8` file can only be downloaded once; store it securely.
3. Note the **Key ID** and **Issuer ID** shown on the page.

### 3. Team ID
developer.apple.com → Membership details → **Team ID** (10 characters).

### 4. GitHub repository secrets
Repository → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `CSC_LINK` | Base64 `.p12` content from step 1 |
| `CSC_KEY_PASSWORD` | `.p12` password |
| `APPLE_API_KEY_BASE64` | Output of `base64 -i AuthKey_XXXXXX.p8` |
| `APPLE_API_KEY_ID` | Key ID |
| `APPLE_API_ISSUER` | Issuer ID |
| `APPLE_TEAM_ID` | Team ID |

::: tip Local signing
For local testing you can put the same values in a `.env.release` file (it is git-ignored). As long as the certificate is in
the Keychain, local signing also works without `CSC_LINK`.
:::

---

## What the release setup does

The following is the planned configuration.

- **electron-builder** configuration
  - `mac.target`: `dmg` + `zip` (the zip is required by `electron-updater`), `arch: arm64`
  - `hardenedRuntime: true`, `gatekeeperAssess: false`, `entitlements` (`allow-jit` and `allow-unsigned-executable-memory` for Electron)
  - `notarize: true` (notarytool + API key)
  - `publish: { provider: 'github' }`
- **Info.plist** additions: `NSLocalNetworkUsageDescription` and `NSBonjourServices: ["_remotedevtools._tcp"]`.
  macOS's Local Network permission relies on these for mDNS advertising and for incoming LAN connections.
- **GitHub Actions** (`.github/workflows/release-desktop.yml`)
  - Trigger: a `desktop-v*` tag
  - Runner: `macos-14` (Apple Silicon)
  - Steps: pnpm install → build → write the `.p8` from the secret to a file → `electron-builder --mac --arm64 --publish always`
  - Output: a draft GitHub Release (`.dmg`, `.zip`, `latest-mac.yml`). The maintainer reviews and publishes it.
- **Auto-update:** `electron-updater` checks for a new version on startup and periodically, and prompts the user.

## Verification

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/Remote DevTools.app"
```

```bash
spctl -a -vvv -t install "/Applications/Remote DevTools.app"
```

```bash
xcrun stapler validate "Remote DevTools.dmg"
```

The `spctl` output should show `source=Notarized Developer ID`.
