import type {NetworkRequest, NetworkResponse} from '@himmetkaan/remote-devtools-protocol';
import {relayClient} from '../../lib/relayClient.ts';
import {useDevtoolsStore} from '../../store/useDevtoolsStore.ts';
import {useNetworkStore} from '../../store/useNetworkStore.ts';

export function startNetworkIngest() {
    relayClient.subscribe((msg) => {
        const network = useNetworkStore.getState();
        const origin = msg.historic ? 'history' : 'live';
        if (msg.type === 'module.network.request') network.addRequest(msg.deviceId, msg.payload as NetworkRequest, origin);
        else if (msg.type === 'module.network.response') network.addResponse(msg.deviceId, msg.payload as NetworkResponse, origin);
    });
    // Eşleşmesi kaldırılan cihazın istekleri bellekte kalmasın.
    useDevtoolsStore.subscribe((s, prev) => {
        if (s.devices === prev.devices) return;
        for (const deviceId of Object.keys(prev.devices)) if (!s.devices[deviceId]) useNetworkStore.getState().removeDevice(deviceId);
    });
}
