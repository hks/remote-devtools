/**
 * Relay'i tek bir JS dosyasına paketler (`dist/main.js`).
 *
 * Geliştirmede `.ts` dosyaları type stripping ile doğrudan çalışır; ancak Electron'un gömülü Node'u ve docker imajı
 * için derlenmiş, bağımlılıkları içine alınmış bir çıktı gerekir.
 */
import {build} from 'esbuild';

await build({
    entryPoints: ['src/main.ts'],
    outfile: 'dist/main.js',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    sourcemap: true,
    // `ws` CommonJS; ESM çıktısında Node yerleşik modüllerini `require` edebilmesi için.
    banner: {js: "import {createRequire as __createRequire} from 'node:module'; const require = __createRequire(import.meta.url);"},
    // `ws`'nin opsiyonel native hızlandırıcıları; yoksa `ws` kendi JS uygulamasına düşer.
    external: ['bufferutil', 'utf-8-validate'],
    logLevel: 'info',
});
