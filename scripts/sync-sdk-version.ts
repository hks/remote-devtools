/**
 * Copies the SDK's package.json version into `SDK_VERSION` (sent in every `hello`).
 * Runs after `changeset version`; a test fails if the two ever differ.
 */
import {readFile, writeFile} from 'node:fs/promises';

const pkgUrl = new URL('../packages/sdk-js/package.json', import.meta.url);
const clientUrl = new URL('../packages/sdk-js/src/client.ts', import.meta.url);

const {version} = JSON.parse(await readFile(pkgUrl, 'utf8')) as {version: string};
const source = await readFile(clientUrl, 'utf8');
const next = source.replace(/export const SDK_VERSION = '[^']*';/, `export const SDK_VERSION = '${version}';`);
if (next === source && !source.includes(`SDK_VERSION = '${version}'`)) throw new Error('SDK_VERSION not found in client.ts');
await writeFile(clientUrl, next);
console.log(`SDK_VERSION = ${version}`);
