import {DISCOVERY_PATH, PROTOCOL_VERSION, WS_PATH_DEVICE} from '@himmetkaan/remote-devtools-protocol';
import {ORIGINAL_FETCH} from './modules/network.ts';

/** The original fetch if the Network module patched it, so the SDK's own requests don't show up in the Network tab. */
function rawFetch(): typeof fetch {
    const current = globalThis.fetch as typeof fetch & {[ORIGINAL_FETCH]?: typeof fetch};
    return current[ORIGINAL_FETCH] ?? current;
}

/**
 * Finds relays that a connect request can be sent to in `isDevelopment` mode.
 * Returned values are device WebSocket URLs (e.g. `ws://localhost:8080/ws/device`).
 * Additional methods such as mDNS come as separate packages implementing this interface.
 */
export type DiscoveryProvider = {
    name: string;
    find(signal: AbortSignal): Promise<string[]>;
};

export type LocalhostDiscoveryOptions = {
    /** Relay port(s) to try. Default: 8787 (desktop app) and 8080 (`pnpm dev:relay`, Docker). */
    port?: number | number[];
    /**
     * Hosts to try. `localhost` for the iOS simulator and browsers, `10.0.2.2` for the Android emulator.
     * With Expo on a physical device, Metro's host can be added (e.g. `Constants.expoConfig?.hostUri?.split(':')[0]`).
     */
    hosts?: string[];
    timeoutMs?: number;
};

type DiscoveryInfo = {name?: string; protocol?: number; connectRequests?: string};

/** Probes local relays via `GET /discovery`; returns those that accept connect requests. */
export function localhostDiscovery(options: LocalhostDiscoveryOptions = {}): DiscoveryProvider {
    const ports = options.port === undefined ? [8787, 8080] : [options.port].flat();
    const hosts = options.hosts ?? ['localhost', '10.0.2.2'];
    const timeoutMs = options.timeoutMs ?? 1500;

    async function probe(host: string, port: number, signal: AbortSignal): Promise<string | null> {
        // AbortSignal.any / .timeout may be missing on Hermes (React Native).
        const controller = new AbortController();
        const abort = () => controller.abort();
        const timer = setTimeout(abort, timeoutMs);
        signal.addEventListener('abort', abort);
        try {
            const res = await rawFetch()(`http://${host}:${port}${DISCOVERY_PATH}`, {signal: controller.signal});
            if (!res.ok) return null;
            const info = (await res.json()) as DiscoveryInfo;
            if (info.name !== 'remote-devtools' || info.protocol !== PROTOCOL_VERSION || info.connectRequests === 'off') return null;
            return `ws://${host}:${port}${WS_PATH_DEVICE}`;
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
        }
    }

    return {
        name: 'localhost',
        async find(signal) {
            const results = await Promise.all(hosts.flatMap((host) => ports.map((port) => probe(host, port, signal))));
            return results.filter((url): url is string => url !== null);
        },
    };
}
