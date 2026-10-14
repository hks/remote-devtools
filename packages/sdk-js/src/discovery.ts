import {DISCOVERY_PATH, PROTOCOL_VERSION, WS_PATH_DEVICE} from '@himmetkaan/remote-devtools-protocol';
import {ORIGINAL_FETCH} from './modules/network.ts';

/** Network modülü fetch'i yamaladıysa orijinali: SDK'nın kendi istekleri Network tab'ına düşmesin. */
function rawFetch(): typeof fetch {
    const current = globalThis.fetch as typeof fetch & {[ORIGINAL_FETCH]?: typeof fetch};
    return current[ORIGINAL_FETCH] ?? current;
}

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
    /** Denenecek relay port(ları). Varsayılan: 8787 (desktop app) ve 8080 (`pnpm dev:relay`, Docker). */
    port?: number | number[];
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
    const ports = options.port === undefined ? [8787, 8080] : [options.port].flat();
    const hosts = options.hosts ?? ['localhost', '10.0.2.2'];
    const timeoutMs = options.timeoutMs ?? 1500;

    async function probe(host: string, port: number, signal: AbortSignal): Promise<string | null> {
        // AbortSignal.any / .timeout Hermes'te (React Native) olmayabilir.
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
