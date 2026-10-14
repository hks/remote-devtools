import {app, BrowserWindow, clipboard, dialog, Menu, shell, type MenuItemConstructorOptions} from 'electron';
import {join} from 'node:path';
import {createRelay, loadConfig, type RunningServer} from '@himmetkaan/remote-devtools-relay';
import {listLanAddresses, type LanAddress} from './network.ts';

// Fixed port: the UI's session info (localStorage) is tied to the origin (127.0.0.1:port).
const PORT = Number(process.env.DEVTOOLS_PORT) || 8787;
const LOCAL_URL = `http://127.0.0.1:${PORT}`;
const NETWORK_POLL_MS = 5_000;
// Persistent partition: the UI only stores the session ID (no data, G14); together with the relay's STATE_FILE,
// devices return to the same session with their saved pairings when the app is restarted.
const PARTITION = 'persist:remote-devtools';

let running: RunningServer | null = null;
let win: BrowserWindow | null = null;
/** Interface chosen by the user; `null` = automatic. */
let pinnedIface: string | null = null;
let current: LanAddress | null = null;

function webDistDir(): string {
    return app.isPackaged ? join(process.resourcesPath, 'ui') : join(__dirname, '../../../packages/ui/dist');
}

function pickAddress(): LanAddress | null {
    const all = listLanAddresses();
    return (pinnedIface && all.find((a) => a.iface === pinnedIface)) || all[0] || null;
}

function phoneUrl(address: LanAddress | null): string | null {
    return address ? `http://${address.address}:${PORT}` : null;
}

function updateTitle() {
    if (!win) return;
    const url = phoneUrl(current);
    win.setTitle(url ? `Remote DevTools — ${url}` : 'Remote DevTools — no local network found');
}

function buildMenu() {
    const addresses = listLanAddresses();
    const networkMenu: MenuItemConstructorOptions[] = [
        {
            label: 'Automatic',
            type: 'radio',
            checked: pinnedIface === null,
            click: () => selectIface(null),
        },
        ...addresses.map<MenuItemConstructorOptions>((a) => ({
            label: `${a.iface} — ${a.address}`,
            type: 'radio',
            checked: pinnedIface === a.iface,
            click: () => selectIface(a.iface),
        })),
        {type: 'separator'},
        {
            label: 'Copy device address',
            enabled: current !== null,
            click: () => {
                const url = phoneUrl(current);
                if (url) clipboard.writeText(url);
            },
        },
        {label: 'Refresh interfaces', click: () => refreshNetwork(true)},
    ];

    const template: MenuItemConstructorOptions[] = [
        ...(process.platform === 'darwin' ? [{role: 'appMenu' as const}] : [{role: 'fileMenu' as const}]),
        {role: 'editMenu'},
        {role: 'viewMenu'},
        {label: 'Network', submenu: networkMenu},
        {role: 'windowMenu'},
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function selectIface(iface: string | null) {
    pinnedIface = iface;
    refreshNetwork(true);
}

/** If the LAN address changed, notifies the relay and reloads the page (so the QR is drawn with the new address). */
function refreshNetwork(force = false) {
    const next = pickAddress();
    const changed = next?.address !== current?.address;
    current = next;
    if (changed || force) {
        running?.relay.setPublicUrl(phoneUrl(current));
        buildMenu();
        updateTitle();
        if (changed) win?.webContents.reload();
    }
}

function createWindow() {
    win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        show: false,
        webPreferences: {
            partition: PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    // The window title shows the address the phone connects to; don't let the page's <title> override it.
    win.on('page-title-updated', (event) => event.preventDefault());
    win.once('ready-to-show', () => win?.show());
    win.on('closed', () => {
        win = null;
    });

    // External links open in the system browser; the window never navigates away from the relay.
    win.webContents.setWindowOpenHandler(({url}) => {
        if (/^https?:/.test(url)) void shell.openExternal(url);
        return {action: 'deny'};
    });
    win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(LOCAL_URL)) {
            event.preventDefault();
            if (/^https?:/.test(url)) void shell.openExternal(url);
        }
    });

    updateTitle();
    void win.loadURL(LOCAL_URL);
}

async function start() {
    current = pickAddress();
    try {
        running = await createRelay({
            ...loadConfig(),
            // Devices connect over the LAN; listen on all interfaces.
            host: '0.0.0.0',
            port: PORT,
            publicUrl: phoneUrl(current),
            webDistDir: webDistDir(),
            // Development builds on the same network may ask to connect without a QR; approved in the UI (G16).
            connectRequests: 'local',
            // Only connection info (session, pairings, trusted devices) is stored; requests/logs are not.
            stateFile: join(app.getPath('userData'), 'relay-state.json'),
        });
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        dialog.showErrorBox(
            'Remote DevTools could not start',
            code === 'EADDRINUSE'
                ? `Port ${PORT} is used by another application. Close it or start Remote DevTools with a different port via the DEVTOOLS_PORT environment variable.`
                : String(error),
        );
        app.exit(1);
        return;
    }

    // In the packaged app the icon comes from the bundle; in development show this in the Dock instead of the Electron icon.
    if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../build/icon.png'));

    buildMenu();
    createWindow();
    setInterval(() => refreshNetwork(), NETWORK_POLL_MS).unref();
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();
    });

    app.on('window-all-closed', () => app.quit());

    let closing = false;
    app.on('before-quit', (event) => {
        if (closing || !running) return;
        closing = true;
        event.preventDefault();
        void running.close().finally(() => app.quit());
    });

    void app.whenReady().then(start);
}
