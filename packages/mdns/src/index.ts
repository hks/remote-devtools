import {type DiscoveryProvider, localhostDiscovery} from '@himmetkaan/remote-devtools';

/** Service type advertised by relays (the desktop app): `_remotedevtools._tcp`. */
export const SERVICE_TYPE = 'remotedevtools';
export const SERVICE_PROTOCOL = 'tcp';

/** A resolved mDNS service, as reported by the platform's browser. */
export type MdnsService = {
    name: string;
    host?: string;
    port: number;
    addresses?: string[];
    txt?: Record<string, unknown>;
};

/**
 * Platform glue: starts browsing for `_<type>._<protocol>` services and reports each resolved one.
 * Returns a function that stops browsing. Ready-made: `zeroconfBrowser` (React Native), `bonjourBrowser` (Node).
 */
export type MdnsBrowser = {
    browse(type: string, protocol: string, onService: (service: MdnsService) => void): () => void;
};

export type MdnsDiscoveryOptions = {
    /** How long to listen for announcements on each discovery round (ms). Default 2500. */
    browseMs?: number;
    /** Timeout of the `/discovery` probe sent to every service found (ms). Default 1500. */
    probeTimeoutMs?: number;
};

const isIpv4 = (address: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(address);

/** Addresses to try for a service: IPv4 first (works everywhere), then the host name. */
function candidateHosts(service: MdnsService): string[] {
    const addresses = service.addresses ?? [];
    const hosts = [...addresses.filter(isIpv4)];
    if (service.host) hosts.push(service.host.replace(/\.$/, ''));
    return [...new Set(hosts)];
}

/** Only services that speak the current protocol (TXT `v`, when present). */
function isCompatible(service: MdnsService): boolean {
    const version = service.txt?.v;
    return version === undefined || String(version) === '2';
}

/**
 * Finds relays that advertise themselves on the local network (the desktop app, when "Advertise on local network" is
 * on). Every service found is probed with `GET /discovery`, exactly like localhost discovery, so only relays that accept
 * connect requests are returned. Needs `isDevelopment: true` like any discovery.
 *
 *     RemoteDevTools.init({
 *         isDevelopment: __DEV__,
 *         discovery: {providers: [mdnsDiscovery(zeroconfBrowser(new Zeroconf()))]},
 *     });
 */
export function mdnsDiscovery(browser: MdnsBrowser, options: MdnsDiscoveryOptions = {}): DiscoveryProvider {
    const browseMs = options.browseMs ?? 2500;
    const probeTimeoutMs = options.probeTimeoutMs ?? 1500;

    return {
        name: 'mdns',
        async find(signal) {
            const services = new Map<string, MdnsService>();
            await new Promise<void>((resolve) => {
                let stop: () => void = () => {};
                const finish = () => {
                    clearTimeout(timer);
                    signal.removeEventListener('abort', finish);
                    try {
                        stop();
                    } catch {
                        // the platform browser may already be stopped
                    }
                    resolve();
                };
                const timer = setTimeout(finish, browseMs);
                signal.addEventListener('abort', finish);
                try {
                    stop = browser.browse(SERVICE_TYPE, SERVICE_PROTOCOL, (service) => {
                        if (isCompatible(service) && service.port > 0) services.set(`${service.name}:${service.port}`, service);
                    });
                } catch {
                    finish();
                }
            });
            if (signal.aborted || services.size === 0) return [];

            const urls = await Promise.all(
                [...services.values()].map(async (service) => {
                    // The first address that answers /discovery wins.
                    for (const host of candidateHosts(service)) {
                        const [url] = await localhostDiscovery({hosts: [host], port: service.port, timeoutMs: probeTimeoutMs}).find(signal);
                        if (url) return url;
                    }
                    return null;
                }),
            );
            return [...new Set(urls.filter((url): url is string => url !== null))];
        },
    };
}

// ─── React Native: react-native-zeroconf ─────────────────────────────────────

/** The part of a `react-native-zeroconf` instance that is used (the SDK does not import it). */
type ZeroconfLike = {
    scan(type?: string, protocol?: string, domain?: string): void;
    stop(): void;
    on(event: 'resolved', listener: (service: MdnsService) => void): unknown;
    removeListener(event: 'resolved', listener: (service: MdnsService) => void): unknown;
};

/**
 * Browser backed by react-native-zeroconf (Bonjour on iOS, NSD on Android). Needs a development build and the
 * config plugin (`plugins: ['@himmetkaan/remote-devtools-mdns']`) for the iOS local network entries.
 */
export function zeroconfBrowser(zeroconf: ZeroconfLike): MdnsBrowser {
    return {
        browse(type, protocol, onService) {
            const listener = (service: MdnsService) => onService(service);
            zeroconf.on('resolved', listener);
            zeroconf.scan(type, protocol, 'local.');
            return () => {
                zeroconf.removeListener('resolved', listener);
                zeroconf.stop();
            };
        },
    };
}

// ─── Node: bonjour-service ───────────────────────────────────────────────────

/** The part of a `bonjour-service` instance that is used. */
type BonjourLike = {
    find(options: {type: string; protocol?: 'tcp' | 'udp'}, onUp?: (service: MdnsService) => void): {stop(): void};
};

/** Browser backed by bonjour-service (Node, Electron, tests). */
export function bonjourBrowser(bonjour: BonjourLike): MdnsBrowser {
    return {
        browse(type, protocol, onService) {
            const found = bonjour.find({type, protocol: protocol as 'tcp' | 'udp'}, (service) => onService(service));
            return () => found.stop();
        },
    };
}
