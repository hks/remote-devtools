import type {IncomingMessage} from 'node:http';
import {isIPv4} from 'node:net';

/** İsteğin geldiği istemci adresi. `trustProxy` ise `X-Forwarded-For`'un ilk girdisi kullanılır. */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
    if (trustProxy) {
        const header = req.headers['x-forwarded-for'];
        const first = (Array.isArray(header) ? header[0] : header)?.split(',')[0]?.trim();
        if (first) return first;
    }
    return req.socket.remoteAddress ?? '';
}

/** Loopback, özel ağ (RFC 1918), link-local ve IPv6 ULA adresleri. */
export function isLocalAddress(address: string): boolean {
    const ip = address.replace(/^::ffff:/i, '').toLowerCase();
    if (isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number) as [number, number];
        return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
    }
    return ip === '::1' || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}

/** Pencere içindeki başarısız denemeleri anahtar (IP) bazında sayar. */
export class FailureLimiter {
    readonly #hits = new Map<string, number[]>();
    readonly #limit: number;
    readonly #windowMs: number;
    readonly #now: () => number;

    constructor(limit: number, windowMs: number, now: () => number = Date.now) {
        this.#limit = limit;
        this.#windowMs = windowMs;
        this.#now = now;
    }

    #recent(key: string): number[] {
        const cutoff = this.#now() - this.#windowMs;
        const hits = (this.#hits.get(key) ?? []).filter((t) => t > cutoff);
        if (hits.length) this.#hits.set(key, hits);
        else this.#hits.delete(key);
        return hits;
    }

    blocked(key: string): boolean {
        return this.#recent(key).length >= this.#limit;
    }

    record(key: string): void {
        const hits = this.#recent(key);
        hits.push(this.#now());
        this.#hits.set(key, hits);
    }

    /** Süresi geçmiş kayıtları temizler. */
    prune(): void {
        for (const key of [...this.#hits.keys()]) this.#recent(key);
    }
}
