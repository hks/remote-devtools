import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App.tsx';
import {startInvokeIngest} from './lib/invoke.ts';
import {startNetworkIngest} from './lib/network.ts';
import {startPersistence} from './lib/persistence.ts';
import {relayClient} from './lib/relayClient.ts';
import './styles.css';

// Kayıtlar yüklenmeden canlı veri gelirse sıralama karışır; önce geri yükle.
await startPersistence();
startNetworkIngest();
startInvokeIngest();
relayClient.start();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App/>
    </StrictMode>,
);
