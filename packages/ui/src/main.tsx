import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App.tsx';
import {relayClient} from './lib/relayClient.ts';
import {startNetworkIngest} from './modules/network/ingest.ts';
import './styles.css';

startNetworkIngest();
relayClient.start();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App/>
    </StrictMode>,
);
