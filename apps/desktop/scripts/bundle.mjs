// Electron main sürecini (relay dahil) tek CJS dosyasına paketler.
// Relay'in .ts kaynakları ve `ws` bağımlılığı bundle'a girer; paketlenmiş uygulamada node_modules gerekmez.
import {build} from 'esbuild';

await build({
    entryPoints: ['src/main.ts'],
    outfile: 'dist/main.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // `ws`'in isteğe bağlı native hızlandırıcıları; yoksa `ws` kendi JS uygulamasına düşer.
    external: ['electron', 'bufferutil', 'utf-8-validate'],
    sourcemap: 'linked',
    logLevel: 'info',
});
