// Bundles the Electron main process (including the relay) into a single CJS file.
// The relay's .ts sources and the `ws` dependency are bundled in; the packaged app needs no node_modules.
import {build} from 'esbuild';

await build({
    entryPoints: ['src/main.ts'],
    outfile: 'dist/main.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // Optional native accelerators for `ws`; without them `ws` falls back to its own JS implementation.
    external: ['electron', 'bufferutil', 'utf-8-validate'],
    sourcemap: 'linked',
    logLevel: 'info',
});
