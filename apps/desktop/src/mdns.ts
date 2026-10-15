import {hostname} from 'node:os';
import {MDNS_SERVICE_TYPE, PROTOCOL_VERSION, WS_PATH_DEVICE} from '@himmetkaan/remote-devtools-protocol';
import {Bonjour} from 'bonjour-service';

// `_remotedevtools._tcp` → bonjour-service takes the bare type and protocol.
const [, TYPE = 'remotedevtools', PROTOCOL = 'tcp'] = /^_([^.]+)\._(tcp|udp)$/.exec(MDNS_SERVICE_TYPE) ?? [];

/**
 * Announces the relay on the local network so development builds with `@himmetkaan/remote-devtools-mdns` find it
 * without knowing the computer's address. Off by default; toggled from the Network menu.
 */
export class Advertiser {
    #bonjour: Bonjour | null = null;
    #port: number | null = null;

    get active(): boolean {
        return this.#bonjour !== null;
    }

    start(port: number): void {
        this.stop();
        const name = `Remote DevTools (${hostname().replace(/\.local$/, '')})`;
        this.#bonjour = new Bonjour({}, (error: unknown) => console.error('[mdns]', error));
        this.#bonjour.publish({
            name,
            type: TYPE,
            protocol: PROTOCOL as 'tcp',
            port,
            txt: {v: String(PROTOCOL_VERSION), path: WS_PATH_DEVICE, name},
        });
        this.#port = port;
    }

    /** Re-announces after the network changed (new interface or address). */
    restart(): void {
        if (this.#bonjour && this.#port !== null) this.start(this.#port);
    }

    stop(): void {
        const bonjour = this.#bonjour;
        if (!bonjour) return;
        this.#bonjour = null;
        bonjour.unpublishAll(() => bonjour.destroy());
    }
}
