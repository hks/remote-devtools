/**
 * Builds the SDK and the protocol package and packs them as `.tgz` (to use them without publishing to npm).
 *
 *   pnpm pack:sdk <destination directory>
 *
 * In the app (yarn / npm) the tarballs are installed via `file:`; since the SDK's protocol dependency is not on npm either,
 * it must be pointed at the tarball in the same directory with `resolutions` (yarn) or `overrides` (npm).
 * Package managers cache tarballs by content hash, so bump the version for every new pack.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, readdirSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';

const dest = process.argv[2];
if (!dest) {
    console.error('Usage: pnpm pack:sdk <destination directory>');
    process.exit(1);
}
const out = resolve(process.cwd(), dest);
mkdirSync(out, {recursive: true});
// Remove tarballs of old versions (package.json will point to the new file name).
for (const file of readdirSync(out)) if (/^himmetkaan-remote-devtools.*\.tgz$/.test(file)) rmSync(resolve(out, file));

const root = resolve(import.meta.dirname, '..');
for (const pkg of ['packages/protocol', 'packages/sdk-js']) {
    const cwd = resolve(root, pkg);
    execFileSync('pnpm', ['run', 'build'], {cwd, stdio: 'inherit'});
    execFileSync('pnpm', ['pack', '--pack-destination', out], {cwd, stdio: 'inherit'});
}
console.log(
    `\nTarballs in ${out}:\n${readdirSync(out)
        .filter((f) => f.endsWith('.tgz'))
        .join('\n')}`,
);
