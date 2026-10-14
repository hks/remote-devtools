// macOS: changing Info.plist breaks Electron's prebuilt signature. Apple Silicon requires a valid signature;
// a certificate-less ad-hoc signature (`-`) is enough. Does nothing on other platforms.
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

export default async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return;
    const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], {stdio: 'inherit'});
}
