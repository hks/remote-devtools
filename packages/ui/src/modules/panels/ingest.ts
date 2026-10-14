import type {BlockData} from '@himmetkaan/remote-devtools-protocol';
import {relayClient} from '../../lib/relayClient.ts';
import {useDevtoolsStore} from '../../store/useDevtoolsStore.ts';

/** Panel blok güncellemeleri cihazın `hello.capabilities.panels` kopyasına işlenir (tab'lar oradan çizilir). */
export function startPanelsIngest() {
    relayClient.subscribe((msg) => {
        if (msg.type !== 'module.panels.update') return;
        const {panelId, blockId, data} = msg.payload as {panelId: string; blockId: string; data: BlockData};
        useDevtoolsStore.getState().updatePanelBlock(msg.deviceId, panelId, blockId, data);
    });
}
