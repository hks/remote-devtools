import {Header} from './components/Header.tsx';
import {RelayBadge} from './components/RelayBadge.tsx';
import {PairingScreen} from './components/PairingScreen.tsx';
import {TabBar} from './components/TabBar.tsx';
import {useDevtoolsStore} from './store/useDevtoolsStore.ts';
import {FunctionsTab} from './tabs/FunctionsTab.tsx';
import {LogsTab} from './tabs/LogsTab.tsx';
import {ServiceRequestsTab} from './tabs/ServiceRequestsTab.tsx';

export function App() {
    const device = useDevtoolsStore((s) => s.device);
    const activeTab = useDevtoolsStore((s) => s.activeTab);
    const pairing = useDevtoolsStore((s) => s.pairing);
    const relay = useDevtoolsStore((s) => s.relay);

    // Oturum henüz doğrulanmadı: QR'ı göstermek, eşleşmiş cihaz varken anlık bir QR ekranı "flaşı" yaratır.
    if (!pairing) {
        return (
            <div className="boot">
                <RelayBadge state={relay}/>
            </div>
        );
    }

    // Eşleşmiş cihaz yoksa (ilk açılış veya Bağlantıyı Kes sonrası) QR ekranı.
    if (!device) return <PairingScreen/>;

    return (
        <div className="workspace">
            <Header device={device}/>
            <TabBar/>
            <main className="tab-content">
                {activeTab === 'logs' && <LogsTab/>}
                {activeTab === 'serviceRequests' && <ServiceRequestsTab/>}
                {activeTab === 'functions' && <FunctionsTab/>}
            </main>
        </div>
    );
}
