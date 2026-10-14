import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';

/** Why requests can't be sent to the device (shown as a button tooltip), or `null` if they can. */
export function useUnavailable(deviceId: string): string | null {
    const relayOpen = useDevtoolsStore((s) => s.relay === 'open');
    const connected = useDevtoolsStore((s) => Boolean(s.devices[deviceId]?.connected));
    return !relayOpen ? 'Not connected to the relay' : !connected ? 'Device is offline' : null;
}
