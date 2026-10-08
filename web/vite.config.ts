import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// Geliştirmede relay ayrı süreçte çalışır (`relay/` → `npm run dev`); WS ve /health ona yönlendirilir.
const relayTarget = process.env.RELAY_URL ?? 'http://127.0.0.1:8080';

export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 5173,
        fs: {allow: ['..']},
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
