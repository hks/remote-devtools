import {app, BrowserWindow, clipboard, dialog, Menu, shell, type MenuItemConstructorOptions} from 'electron';
import {join} from 'node:path';
import {createRelay, loadConfig, type RunningServer} from '@himmetkaan/remote-devtools-relay';
import {listLanAddresses, type LanAddress} from './network.ts';

// Sabit port: UI'ın oturum bilgisi (localStorage) origin'e (127.0.0.1:port) bağlı.
const PORT = Number(process.env.DEVTOOLS_PORT) || 8787;
const LOCAL_URL = `http://127.0.0.1:${PORT}`;
const NETWORK_POLL_MS = 5_000;
// Kalıcı bölüm: UI yalnızca oturum kimliğini saklar (veri saklamaz, G14); relay'in STATE_FILE'ıyla birlikte
// uygulama kapanıp açılınca cihazlar kayıtlı eşleşmeleriyle aynı oturuma geri döner.
const PARTITION = 'persist:remote-devtools';

let running: RunningServer | null = null;
let win: BrowserWindow | null = null;
/** Kullanıcının seçtiği arayüz; `null` = otomatik. */
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

/** LAN adresi değiştiyse relay'e bildirir ve sayfayı yeniler (QR yeni adresle çizilsin). */
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

    // Pencere başlığı telefonun bağlanacağı adresi gösterir; sayfanın <title>'ı onu ezmesin.
    win.on('page-title-updated', (event) => event.preventDefault());
    win.once('ready-to-show', () => win?.show());
    win.on('closed', () => {
        win = null;
    });

    // Dış bağlantılar sistem tarayıcısında açılır; pencere relay dışına gitmez.
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
            // Cihazlar LAN üzerinden bağlanır; tüm arayüzlerde dinlenir.
            host: '0.0.0.0',
            port: PORT,
            publicUrl: phoneUrl(current),
            webDistDir: webDistDir(),
            // Aynı ağdaki geliştirme build'leri QR'sız bağlanmak isteyebilir; UI'da onaylanır (G16).
            connectRequests: 'local',
            // Yalnızca bağlantı bilgisi (oturum, eşleşmeler, onaylı cihazlar) saklanır; istek/log saklanmaz.
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

    // Paketlenmiş uygulamada ikon bundle'dan gelir; geliştirmede Dock'ta Electron ikonu yerine bu görünsün.
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
