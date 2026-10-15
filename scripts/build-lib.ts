/**
 * Builds the published library packages (protocol, SDK). Run from the package directory:
 *
 *   node ../../scripts/build-lib.ts
 *
 * Output: dist/index.js (ESM), dist/index.cjs (CommonJS), dist/*.d.ts.
 * Inside the workspace packages export their `.ts` sources; when published, `publishConfig` points to these outputs.
 */
import {execFileSync} from 'node:child_process';
import {readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
    name: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
};
const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];
const outdir = join(cwd, 'dist');

rmSync(outdir, {recursive: true, force: true});

// ES2020 for React Native (Hermes) and older browsers: syntax like private fields and `??=` is downleveled.
const common = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    external,
    target: 'es2020',
    platform: 'neutral',
    sourcemap: true,
    logLevel: 'warning',
} as const;
await build({...common, format: 'esm', outfile: join(outdir, 'index.js')});
await build({...common, format: 'cjs', outfile: join(outdir, 'index.cjs')});

execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], {cwd, stdio: 'inherit'});

// `./x.ts` imports in `.d.ts` files must be `./x.js` when published.
for (const file of walk(outdir).filter((f) => f.endsWith('.d.ts'))) {
    const text = readFileSync(file, 'utf8').replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2');
    writeFileSync(file, text);
}

console.log(`built ${pkg.name} → dist/`);

function walk(dir: string): string[] {
    return readdirSync(dir, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
