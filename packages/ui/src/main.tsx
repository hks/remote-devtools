import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App.tsx';
import {relayClient} from './lib/relayClient.ts';
import {startNetworkIngest} from './modules/network/ingest.ts';
import {startPanelsIngest} from './modules/panels/ingest.ts';
import {startStateIngest} from './modules/state/ingest.ts';
import './styles.css';

startNetworkIngest();
startStateIngest();
startPanelsIngest();
relayClient.start();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
