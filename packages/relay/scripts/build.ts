/**
 * Bundles the relay into a single JS file (`dist/main.js`).
 *
 * In development the `.ts` files run directly via type stripping, but Electron's embedded Node and the docker image
 * need a compiled output with dependencies bundled in.
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
    // `ws` is CommonJS; this lets it `require` Node built-in modules from the ESM output.
    banner: {js: "import {createRequire as __createRequire} from 'node:module'; const require = __createRequire(import.meta.url);"},
    // Optional native accelerators for `ws`; if missing, `ws` falls back to its own JS implementation.
    external: ['bufferutil', 'utf-8-validate'],
    logLevel: 'info',
});
