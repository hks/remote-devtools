# macOS signing and notarization

The desktop app is not distributed through the App Store. Release builds are signed with a **Developer ID**,
**notarized** by Apple and published on GitHub Releases, so users do not see a Gatekeeper warning. The app updates
itself from the same releases with `electron-updater`.

## One-time setup

You need a paid Apple Developer Program membership.

### 1. Developer ID Application certificate

1. developer.apple.com → Certificates, IDs & Profiles → Certificates → **+**
2. Choose **Developer ID Application** (not "Apple Distribution", which is for the App Store).
3. Create a CSR with Keychain Access → Certificate Assistant → *Request a Certificate From a Certificate Authority*
   and upload it.
4. Double-click the downloaded certificate to add it to the Keychain.
5. In Keychain Access, select the certificate **together with its private key** → Export → save as `.p12` with a strong
   password.

### 2. App Store Connect API key (notarization)

1. appstoreconnect.apple.com → Users and Access → **Integrations** → App Store Connect API → **Team Keys** → **+**
2. Role: **Developer**. The `AuthKey_XXXXXXXXXX.p8` file can only be downloaded once; keep it safe.
3. Note the **Key ID** and the **Issuer ID** shown on the page.

### 3. Repository secrets

Repository → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `CSC_LINK` | Base64 of the `.p12`: `base64 -i DeveloperID.p12 \| pbcopy` |
| `CSC_KEY_PASSWORD` | The `.p12` password |
| `APPLE_API_KEY_BASE64` | Base64 of the `.p8`: `base64 -i AuthKey_XXXXXXXXXX.p8 \| pbcopy` |
| `APPLE_API_KEY_ID` | Key ID |
| `APPLE_API_ISSUER` | Issuer ID |

## Releasing a version

1. Bump `version` in `apps/desktop/package.json` and commit it to `main`.
2. Push a matching tag:

   ```bash
   git tag desktop-v0.2.0 && git push origin desktop-v0.2.0
   ```

The **Desktop release** workflow (macOS runner) checks that the tag matches the version, builds the app, signs it with
the certificate from `CSC_LINK`, notarizes and staples it, publishes `RemoteDevTools-<version>-mac-arm64.dmg`, the
`.zip` and `latest-mac.yml` as a GitHub release, and finally verifies the signature with `codesign`, `spctl` and
`stapler`.

Releases are published directly. Installed apps check for updates on launch and every six hours, download the update in
the background and offer **Restart now** or **Later** (the update then installs when the app quits). **Check for
Updates…** in the app menu checks on demand.

::: warning Only desktop releases on GitHub Releases
`electron-updater` reads the repository's **latest** release. Other workflows must not create GitHub releases (the npm
workflow sets `createGithubReleases: false`), otherwise installed apps cannot find their update.
:::

## Building locally

```bash
pnpm dist:desktop
```

builds an **unsigned** package (ad-hoc signature, which Apple Silicon requires) in `apps/desktop/release/`, whatever
certificates are in your keychain.

For a signed build on your Mac, name the certificate explicitly (your keychain may contain other teams' certificates) and,
to notarize, point to the API key:

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_KEY=~/keys/AuthKey_XXXXXXXXXX.p8 APPLE_API_KEY_ID=XXXXXXXXXX APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
pnpm dist:desktop:signed
```

Without the `APPLE_API_*` variables the build is signed but not notarized.

## Checking a build

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/Remote DevTools.app"
spctl -a -vvv -t execute "/Applications/Remote DevTools.app"
xcrun stapler validate "/Applications/Remote DevTools.app"
```

`spctl` should report `source=Notarized Developer ID`.
