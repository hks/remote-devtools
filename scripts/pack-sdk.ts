/**
 * SDK'yı ve protokol paketini build edip `.tgz` olarak paketler (npm'e yayınlamadan kullanmak için).
 *
 *   pnpm pack:sdk <hedef klasör>
 *
 * Uygulama tarafında (yarn / npm) tarball'lar `file:` ile kurulur; SDK'nın protokol bağımlılığı da npm'de olmadığından
 * `resolutions` (yarn) veya `overrides` (npm) ile aynı klasördeki tarball'a yönlendirilmelidir.
 * Paket yöneticileri tarball'ı içerik özetiyle önbelleğe aldığı için her yeni paketlemede sürüm artırılmalıdır.
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
// Eski sürümlerin tarball'ları kalmasın (package.json yeni dosya adını gösterecek).
for (const file of readdirSync(out)) if (/^himmetkaan-remote-devtools.*\.tgz$/.test(file)) rmSync(resolve(out, file));

const root = resolve(import.meta.dirname, '..');
for (const pkg of ['packages/protocol', 'packages/sdk-js']) {
    const cwd = resolve(root, pkg);
    execFileSync('pnpm', ['run', 'build'], {cwd, stdio: 'inherit'});
    execFileSync('pnpm', ['pack', '--pack-destination', out], {cwd, stdio: 'inherit'});
}
console.log(`\nTarballs in ${out}:\n${readdirSync(out).filter((f) => f.endsWith('.tgz')).join('\n')}`);
