import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// In development the relay runs in a separate process (`pnpm dev:relay`); WS and /health are proxied to it.
const relayTarget = process.env.RELAY_URL ?? 'http://127.0.0.1:8080';

export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 5173,
        proxy: {
            '/ws': {target: relayTarget, ws: true},
            '/health': {target: relayTarget},
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
});
