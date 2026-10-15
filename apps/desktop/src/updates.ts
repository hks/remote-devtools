import {app, dialog} from 'electron';
import electronUpdater from 'electron-updater';

// Updates come from the GitHub releases configured in electron-builder.yml (`publish`). Only the packaged, signed app
// can update itself; in development the menu item explains that.
const {autoUpdater} = electronUpdater;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Set while the user asked from the menu, so "no update" and errors are reported instead of staying silent. */
let manualCheck = false;
/** The version the user already answered "Later" for; it installs on quit without asking again. */
let deferredVersion: string | null = null;

function check() {
    autoUpdater.checkForUpdates().catch((error: unknown) => {
        console.error('[updates] check failed', error);
    });
}

export function startAutoUpdates(): void {
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
        if (!manualCheck) return;
        manualCheck = false;
        void dialog.showMessageBox({
            type: 'info',
            message: `Remote DevTools ${info.version} is available`,
            detail: 'It is downloading in the background. You will be asked to restart when it is ready.',
        });
    });

    autoUpdater.on('update-not-available', () => {
        if (!manualCheck) return;
        manualCheck = false;
        void dialog.showMessageBox({type: 'info', message: 'Remote DevTools is up to date', detail: `Version ${app.getVersion()}`});
    });

    autoUpdater.on('error', (error) => {
        console.error('[updates]', error);
        if (!manualCheck) return;
        manualCheck = false;
        dialog.showErrorBox('Could not check for updates', error.message);
    });

    autoUpdater.on('update-downloaded', async (info) => {
        if (deferredVersion === info.version) return;
        const {response} = await dialog.showMessageBox({
            type: 'info',
            buttons: ['Restart now', 'Later'],
            defaultId: 0,
            cancelId: 1,
            message: `Remote DevTools ${info.version} is ready to install`,
            detail: 'Restart now to update, or it will be installed the next time you quit.',
        });
        if (response === 0) autoUpdater.quitAndInstall();
        else deferredVersion = info.version;
    });

    check();
    setInterval(check, CHECK_INTERVAL_MS).unref();
}

/** "Check for Updates…" menu item. */
export function checkForUpdatesFromMenu(): void {
    if (!app.isPackaged) {
        void dialog.showMessageBox({type: 'info', message: 'Updates are only available in the packaged app.'});
        return;
    }
    manualCheck = true;
    check();
}
