import {randomBytes, timingSafeEqual} from 'node:crypto';

export function randomToken(bytes = 24): string {
    return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}
