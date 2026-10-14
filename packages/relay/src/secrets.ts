import {randomBytes, randomInt, timingSafeEqual} from 'node:crypto';

export function randomToken(bytes = 24): string {
    return randomBytes(bytes).toString('base64url');
}

/** 6-digit pairing code (leading zeros preserved). */
export function randomCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}
