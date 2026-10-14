import {DISCOVERY_PATH, PROTOCOL_VERSION, WS_PATH_DEVICE} from '@himmetkaan/remote-devtools-protocol';

/**
 * `isDevelopment` modunda bağlantı isteği gönderilebilecek relay'leri bulur.
 * Dönen değerler cihaz WebSocket adresleridir (ör. `ws://localhost:8080/ws/device`).
 * mDNS gibi ek yöntemler bu arayüzü uygulayan ayrı paketlerle gelir.
 */
export type DiscoveryProvider = {
    name: string;
    find(signal: AbortSignal): Promise<string[]>;
};

export type LocalhostDiscoveryOptions = {
    /** Relay portu. */
    port?: number;
    /**
     * Denenecek host'lar. iOS simülatörü ve tarayıcı için `localhost`, Android emülatörü için `10.0.2.2`.
     * Expo'da fiziksel cihaz için Metro'nun host'u eklenebilir (ör. `Constants.expoConfig?.hostUri?.split(':')[0]`).
     */
    hosts?: string[];
    timeoutMs?: number;
};

type DiscoveryInfo = { name?: string; protocol?: number; connectRequests?: string };

/** Yerel relay'leri `GET /discovery` ile yoklar; bağlantı isteği kabul edenleri döner. */
export function localhostDiscovery(options: LocalhostDiscoveryOptions = {}): DiscoveryProvider {
    const port = options.port ?? 8080;
    const hosts = options.hosts ?? ['localhost', '10.0.2.2'];
    const timeoutMs = options.timeoutMs ?? 1500;

    async function probe(host: string, signal: AbortSignal): Promise<string | null> {
        // AbortSignal.any / .timeout Hermes'te (React Native) olmayabilir.
        const controller = new AbortController();
        const abort = () => controller.abort();
        const timer = setTimeout(abort, timeoutMs);
        signal.addEventListener('abort', abort);
        try {
            const res = await fetch(`http://${host}:${port}${DISCOVERY_PATH}`, {signal: controller.signal});
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
            const results = await Promise.all(hosts.map((host) => probe(host, signal)));
            return results.filter((url): url is string => url !== null);
        },
    };
}
