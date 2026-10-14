// macOS: Info.plist değiştiği için Electron'un hazır imzası bozulur. Apple Silicon geçerli imza ister;
// sertifikasız ad-hoc imza (`-`) yeterli. Diğer platformlarda bir şey yapmaz.
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

export default async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return;
    const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], {stdio: 'inherit'});
}
