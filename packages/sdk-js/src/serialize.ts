/**
 * Log verisi ve modül payload'ları için JSON güvenli kopya: döngüler, Error'lar, fonksiyonlar, BigInt, Map/Set ve aşırı derin
 * yapılar `JSON.stringify`'ı patlatmasın diye dönüştürülür.
 */
export function toSerializable(value: unknown, maxDepth = 8): unknown {
    const seen = new WeakSet<object>();

    function walk(v: unknown, depth: number): unknown {
        if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
        if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
        if (typeof v === 'undefined') return undefined;
        if (typeof v === 'bigint') return `${v}n`;
        if (typeof v === 'symbol') return v.toString();
        if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
        if (v instanceof Error) return {name: v.name, message: v.message, stack: v.stack};
        if (v instanceof Date) return v.toISOString();
        if (seen.has(v)) return '[Circular]';
        if (depth >= maxDepth) return Array.isArray(v) ? '[Array]' : '[Object]';
        seen.add(v);
        try {
            if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1) ?? null);
            if (v instanceof Map) return Object.fromEntries([...v].map(([k, val]) => [String(k), walk(val, depth + 1)]));
            if (v instanceof Set) return [...v].map((item) => walk(item, depth + 1));
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(v)) out[key] = walk((v as Record<string, unknown>)[key], depth + 1);
            return out;
        } finally {
            seen.delete(v);
        }
    }

    return walk(value, 0);
}
