import {relayClient} from './relayClient.ts';
import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';
import {useNetworkStore} from '../store/useNetworkStore.ts';

/** Telefon bu sürede son parçayı göndermezse Sync iptal sayılır. */
const SYNC_TIMEOUT_MS = 30_000;

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncReceived = 0;
let syncAdded = 0;

function resetSyncTimer() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncTimer = null;
        if (useNetworkStore.getState().sync.status !== 'syncing') return;
        useNetworkStore.getState().finishSync();
        useDevtoolsStore.getState().addLog({level: 'warn', source: 'web', message: 'Sync zaman aşımına uğradı (telefon cevap vermedi)'});
    }, SYNC_TIMEOUT_MS);
}

/** Telefondaki geçmiş istekleri ister. Gönderilemezse `false`. */
export function requestSync(): boolean {
    const id = relayClient.send('sync', {});
    if (!id) return false;
    syncReceived = 0;
    syncAdded = 0;
    useNetworkStore.getState().startSync(id);
    resetSyncTimer();
    return true;
}

export function startNetworkIngest() {
    relayClient.subscribe((msg) => {
        const network = useNetworkStore.getState();

        switch (msg.type) {
            case 'request':
                network.addRequest(msg.payload);
                break;
            case 'response':
                network.addResponse(msg.payload);
                break;
            case 'syncResult': {
                const sync = network.sync;
                if (sync.status !== 'syncing' || sync.replyTo !== msg.payload.replyTo) break;
                syncReceived += msg.payload.entries.length;
                syncAdded += network.mergeSync(msg.payload.entries);
                network.updateSync({received: syncReceived, added: syncAdded, total: msg.payload.total});
                if (!msg.payload.final) {
                    resetSyncTimer();
                    break;
                }
                if (syncTimer) clearTimeout(syncTimer);
                syncTimer = null;
                network.finishSync();
                useDevtoolsStore.getState().addLog({
                    level: 'info',
                    source: 'device',
                    message: `Sync tamamlandı: telefonda ${msg.payload.total} kayıt, ${syncAdded} yeni eklendi`,
                });
                break;
            }
            case 'error':
                // Sync gönderilirken cihaz çevrimdışıysa relay DEVICE_OFFLINE döner.
                if (network.sync.status === 'syncing' && msg.payload.replyTo === network.sync.replyTo) {
                    if (syncTimer) clearTimeout(syncTimer);
                    network.finishSync();
                }
                break;
            default:
                break;
        }
    });
}
