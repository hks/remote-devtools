import {loadConfig} from './config.ts';
import {log} from './log.ts';
import {startServer} from './server.ts';

const config = loadConfig();
const running = await startServer(config);

log.info('relay listening', {
    host: config.host,
    port: running.port,
    publicUrl: config.publicUrl,
    webDistDir: config.webDistDir,
});

let shuttingDown = false;
async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', {signal});
    await running.close();
    process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
