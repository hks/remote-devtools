import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';

/** Cihaza istek gönderilemiyorsa nedeni (buton ipucu olarak gösterilir), gönderilebiliyorsa `null`. */
export function useUnavailable(deviceId: string): string | null {
    const relayOpen = useDevtoolsStore((s) => s.relay === 'open');
    const connected = useDevtoolsStore((s) => Boolean(s.devices[deviceId]?.connected));
    return !relayOpen ? 'Not connected to the relay' : !connected ? 'Device is offline' : null;
}
