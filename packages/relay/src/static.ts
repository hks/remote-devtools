import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {extname, join, normalize, resolve, sep} from 'node:path';

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
};

async function fileExists(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

/**
 * Build edilmiş SPA'yı sunar. Dosya bulunamazsa `index.html`'e düşer.
 * `true` dönerse istek karşılanmıştır.
 */
export function createStaticHandler(rootDir: string) {
    const root = resolve(rootDir);

    return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return false;

        const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
        const candidate = normalize(join(root, urlPath));
        if (candidate !== root && !candidate.startsWith(root + sep)) {
            res.writeHead(403).end();
            return true;
        }

        let filePath = candidate;
        if (!(await fileExists(filePath))) {
            filePath = join(root, 'index.html');
            if (!(await fileExists(filePath))) return false;
        }

        const isAsset = filePath.includes(`${sep}assets${sep}`);
        res.writeHead(200, {
            'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
            // Vite asset'leri hash'li; index.html her zaman taze olmalı.
            'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
        if (req.method === 'HEAD') {
            res.end();
            return true;
        }
        createReadStream(filePath).pipe(res);
        return true;
    };
}
