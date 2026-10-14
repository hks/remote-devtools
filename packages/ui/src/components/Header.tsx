import type {DeviceSnapshot} from '@remote-devtools/protocol';
import {requestSync} from '../lib/network.ts';
import {relayClient} from '../lib/relayClient.ts';
import {useNetworkStore} from '../store/useNetworkStore.ts';
import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';
import {DeviceCard} from './DeviceCard.tsx';
import {RelayBadge} from './RelayBadge.tsx';
import {Shortcuts} from './Shortcuts.tsx';

export function Header({device}: {device: DeviceSnapshot}) {
    const relay = useDevtoolsStore((s) => s.relay);
    const sync = useNetworkStore((s) => s.sync);
    const canSync = relay === 'open' && device.connected && sync.status === 'idle';

    return (
        <header className="topbar">
            <div className="topbar-brand">
                <span className="brand">🛠️ Remote DevTools</span>
                <RelayBadge state={relay}/>
            </div>
            <DeviceCard device={device}/>
            <div className="topbar-actions">
                <Shortcuts/>
                <button
                    className="btn btn-sync"
                    disabled={!canSync}
                    onClick={() => requestSync()}
                    title={device.connected ? 'Telefonda biriken geçmiş istekleri getir (s)' : 'Cihaz bağlı değil'}
                >
                    <span className={sync.status === 'syncing' ? 'spin' : undefined}>⟳</span>
                    {sync.status === 'syncing'
                        ? sync.total !== null ? `${sync.received}/${sync.total}` : 'Sync…'
                        : 'Sync'}
                </button>
                <button
                    className="btn btn-danger"
                    disabled={relay !== 'open'}
                    onClick={() => {
                        if (confirm('Cihazın eşleşmesi kaldırılsın mı? Telefon kayıtlı bağlantıyı silecek ve yeni bir QR gösterilecek.')) {
                            relayClient.send('unpair', {});
                        }
                    }}
                >
                    Bağlantıyı Kes
                </button>
            </div>
        </header>
    );
}
