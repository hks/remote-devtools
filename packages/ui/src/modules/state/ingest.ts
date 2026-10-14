import type {StateChange} from '@himmetkaan/remote-devtools-protocol';
import {relayClient} from '../../lib/relayClient.ts';
import {useDevtoolsStore} from '../../store/useDevtoolsStore.ts';
import {stateKey, useStateStore} from '../../store/useStateStore.ts';

export function startStateIngest() {
    relayClient.subscribe((msg) => {
        if (msg.type !== 'module.state.change') return;
        const change = msg.payload as StateChange;
        useStateStore.getState().applyChange(stateKey(msg.deviceId, change.storeId), change);
    });
    // Eşleşmesi kaldırılan cihazın state'i bellekte kalmasın.
    useDevtoolsStore.subscribe((s, prev) => {
        if (s.devices === prev.devices) return;
        for (const deviceId of Object.keys(prev.devices)) if (!s.devices[deviceId]) useStateStore.getState().removeDevice(deviceId);
    });
}
