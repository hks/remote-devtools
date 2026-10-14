import {ConnectRequests} from './components/ConnectRequests.tsx';
import {DeviceHeader} from './components/DeviceHeader.tsx';
import {PairingPanel} from './components/PairingPanel.tsx';
import {RelayBadge} from './components/RelayBadge.tsx';
import {Sidebar} from './components/Sidebar.tsx';
import {TabBar} from './components/TabBar.tsx';
import {modulesFor} from './modules/registry.ts';
import {useDevtoolsStore, useSelectedDevice} from './store/useDevtoolsStore.ts';

export function App() {
    const session = useDevtoolsStore((s) => s.session);
    const relay = useDevtoolsStore((s) => s.relay);
    const hasDevices = useDevtoolsStore((s) => Object.keys(s.devices).length > 0);
    const showPairing = useDevtoolsStore((s) => s.showPairing);
    const activeTab = useDevtoolsStore((s) => s.activeTab);
    const device = useSelectedDevice();

    // Oturum henüz doğrulanmadı: eşleşme ekranını göstermek, cihazlar varken anlık bir "flaş" yaratır.
    if (!session) {
        return (
            <div className="boot">
                <RelayBadge state={relay}/>
            </div>
        );
    }

    if (!hasDevices) {
        return (
            <div className="solo">
                <header className="solo-head">
                    <span className="brand">🛠️ Remote DevTools</span>
                    <RelayBadge state={relay}/>
                </header>
                <PairingPanel/>
            </div>
        );
    }

    const modules = modulesFor(device);
    // Seçili tab bu cihazda yoksa (ör. modülü bildirmiyor) Logs'a düş.
    const active = modules.find((m) => m.id === activeTab) ?? modules[0]!;

    return (
        <div className="workspace">
            <Sidebar/>
            <main className="main">
                {showPairing || !device ? (
                    <div className="main-scroll">
                        <PairingPanel/>
                    </div>
                ) : (
                    <>
                        <ConnectRequests/>
                        <DeviceHeader device={device}/>
                        <TabBar modules={modules} active={active.id}/>
                        <div className="tab-content">
                            <active.Component key={device.deviceId} deviceId={device.deviceId}/>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
