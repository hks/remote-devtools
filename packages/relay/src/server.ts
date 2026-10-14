import {createServer, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {hostname} from 'node:os';
import {DISCOVERY_PATH, PROTOCOL_VERSION} from '@himmetkaan/remote-devtools-protocol';
import pkg from '../package.json' with {type: 'json'};
import type {RelayConfig} from './config.ts';
import {attachRelay, type Relay} from './relay.ts';
import {createStaticHandler} from './static.ts';

export type RunningServer = {
    server: Server;
    relay: Relay;
    port: number;
    close(): Promise<void>;
};

/** Public JSON endpoints without secrets; CORS is open so in-browser SDKs can read them too. */
function sendJson(res: ServerResponse, body: unknown) {
    res.writeHead(200, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify(body));
}

export async function startServer(config: RelayConfig): Promise<RunningServer> {
    const serveStatic = config.webDistDir ? createStaticHandler(config.webDistDir) : null;
    const startedAt = Date.now();

    const server = createServer(async (req, res) => {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;

        if (path === '/health') {
            return sendJson(res, {ok: true, sessions: relay.store.size, uptimeSec: Math.round((Date.now() - startedAt) / 1000)});
        }

        // `isDevelopment` SDKs use this to detect whether a relay is running on localhost.
        if (path === DISCOVERY_PATH) {
            return sendJson(res, {
                name: 'remote-devtools',
                version: pkg.version,
                protocol: PROTOCOL_VERSION,
                host: hostname(),
                connectRequests: config.connectRequests,
            });
        }

        try {
            if (serveStatic && (await serveStatic(req, res))) return;
        } catch {
            if (!res.headersSent) res.writeHead(500);
            res.end();
            return;
        }

        res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
        res.end('Remote DevTools relay — UI is not built.\n');
    });

    const relay = attachRelay(server, config);

    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(config.port, config.host, () => {
                server.off('error', reject);
                resolve();
            });
        });
    } catch (error) {
        await relay.close();
        throw error;
    }
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
