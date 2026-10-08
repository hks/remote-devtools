import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {RelayConfig} from './config.ts';
import {attachRelay, type Relay} from './relay.ts';
import {createStaticHandler} from './static.ts';

export type RunningServer = {
    server: Server;
    relay: Relay;
    port: number;
    close(): Promise<void>;
};

export async function startServer(config: RelayConfig): Promise<RunningServer> {
    const serveStatic = config.webDistDir ? createStaticHandler(config.webDistDir) : null;
    const startedAt = Date.now();

    const server = createServer(async (req, res) => {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;

        if (path === '/health') {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({ok: true, sessions: relay.store.size, uptimeSec: Math.round((Date.now() - startedAt) / 1000)}));
            return;
        }

        try {
            if (serveStatic && (await serveStatic(req, res))) return;
        } catch {
            if (!res.headersSent) res.writeHead(500);
            res.end();
            return;
        }

        res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
        res.end('Remote DevTools relay — web arayüzü build edilmemiş.\n');
    });

    const relay = attachRelay(server, config);

    await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
    const port = (server.address() as AddressInfo).port;

    return {
        server,
        relay,
        port,
        close: async () => {
            await relay.close();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}
