# Desktop app (macOS)

The desktop app runs the relay and the UI in one window, so nothing needs to be hosted. Devices connect to your
computer over the local network; the phone and the computer must be on the same network.

Currently built for macOS on Apple Silicon. Download the `.dmg` from the
[latest release](https://github.com/hks/remote-devtools/releases/latest). Releases are signed with a Developer ID and
notarized by Apple.

The app keeps itself up to date: it checks for a new version on launch and every six hours, downloads it in the
background and asks you to restart (or installs it when you quit). Use **Remote DevTools → Check for Updates…** to check
now.

## How it behaves

- The relay listens on `0.0.0.0:8787`. If the port is taken the app tells you; set `DEVTOOLS_PORT` to use another.
- The address written into the QR code is your computer's LAN IP, picked automatically and shown in the window title.
  If the wrong interface was chosen (VPN, Docker…), pick the right one in the **Network** menu. The address updates
  when your IP changes.
- Connect requests from the local network are allowed (`CONNECT_REQUESTS=local`), so development builds and
  simulators find the app by themselves; the SDK tries port `8787` first.
- **Network → Advertise on Local Network (Bonjour)** announces the app on the Wi-Fi so physical development builds with
  the [mDNS package](./connecting#mdns-discovery) find it without its address. Off by default; the choice is remembered.
- Only connection metadata is stored (`~/Library/Application Support/Remote DevTools/relay-state.json`: the session,
  pairings and trusted devices). Devices come back with their stored pairing after the app restarts. Logs, requests
  and other data are never written to disk.
- On first launch macOS may ask for **Local Network** and firewall permission. Without them devices cannot connect.

## Building it yourself

```bash
pnpm install
pnpm dev:desktop      # build the UI and main process and open Electron
pnpm dist:desktop     # unsigned .dmg and .zip in apps/desktop/release/ (Apple Silicon)
```

Packages you build yourself are not signed, so macOS blocks the first launch: right-click the app and choose **Open**.
If macOS says the app is damaged, run `xattr -cr "/Applications/Remote DevTools.app"`. Signed builds are described in
[macOS signing](../maintainers/macos-release).
