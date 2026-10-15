import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {describe, it} from 'node:test';
import {Bonjour} from 'bonjour-service';
import {createClient, openUi, waitForStatus, withRelay} from '../../sdk-js/test/helpers.ts';
import {bonjourBrowser, type MdnsBrowser, type MdnsService, mdnsDiscovery, zeroconfBrowser} from '../src/index.ts';

/** Browser that "finds" the given services right away. */
function fakeBrowser(services: MdnsService[], seen: string[] = []): MdnsBrowser {
    return {
        browse(type, protocol, onService) {
            seen.push(`${type}.${protocol}`);
            const timer = setTimeout(() => services.forEach(onService), 10);
            return () => clearTimeout(timer);
        },
    };
}

const find = (browser: MdnsBrowser) => mdnsDiscovery(browser, {browseMs: 100, probeTimeoutMs: 500}).find(new AbortController().signal);

describe('mdnsDiscovery', () => {
    it('returns relays that accept connect requests, probing IPv4 addresses first', async () => {
        await withRelay({connectRequests: 'local'}, async ({port}) => {
            const seen: string[] = [];
            const urls = await find(
                fakeBrowser(
                    [
                        {
                            name: 'Remote DevTools (mac)',
                            host: 'no-such-host.invalid.',
                            port,
                            addresses: ['fe80::1', '127.0.0.1'],
                            txt: {v: '2', path: '/ws/device'},
                        },
                        {name: 'Duplicate announcement', host: 'no-such-host.invalid.', port, addresses: ['127.0.0.1']},
                    ],
                    seen,
                ),
            );
            assert.deepEqual(seen, ['remotedevtools.tcp']);
            assert.deepEqual(urls, [`ws://127.0.0.1:${port}/ws/device`]);
        });
    });

    it('skips relays without connect requests, other protocol versions and dead addresses', async () => {
        await withRelay({connectRequests: 'off'}, async ({port}) => {
            assert.deepEqual(await find(fakeBrowser([{name: 'off', port, addresses: ['127.0.0.1']}])), []);
        });
        await withRelay({connectRequests: 'local'}, async ({port}) => {
            assert.deepEqual(await find(fakeBrowser([{name: 'future', port, addresses: ['127.0.0.1'], txt: {v: '3'}}])), []);
            assert.deepEqual(await find(fakeBrowser([{name: 'gone', port: 1, addresses: ['127.0.0.1']}])), []);
        });
        assert.deepEqual(await find(fakeBrowser([])), []);
    });

    it('stops browsing when aborted', async () => {
        let stopped = false;
        const browser: MdnsBrowser = {browse: () => () => (stopped = true)};
        const controller = new AbortController();
        const pending = mdnsDiscovery(browser, {browseMs: 10_000}).find(controller.signal);
        controller.abort();
        assert.deepEqual(await pending, []);
        assert.equal(stopped, true);
    });
});

describe('zeroconfBrowser', () => {
    it('scans for the service type and stops cleanly', () => {
        const calls: unknown[][] = [];
        const zeroconf = Object.assign(new EventEmitter(), {
            scan: (...args: unknown[]) => calls.push(['scan', ...args]),
            stop: () => calls.push(['stop']),
        });
        const found: MdnsService[] = [];
        const stop = zeroconfBrowser(zeroconf).browse('remotedevtools', 'tcp', (s) => found.push(s));
        zeroconf.emit('resolved', {name: 'a', host: 'mac.local.', port: 8787, addresses: ['192.168.1.10']});
        stop();
        zeroconf.emit('resolved', {name: 'b', port: 1});
        assert.deepEqual(calls, [['scan', 'remotedevtools', 'tcp', 'local.'], ['stop']]);
        assert.deepEqual(
            found.map((s) => s.name),
            ['a'],
        );
    });
});

describe('Expo config plugin', () => {
    const plugin = createRequire(import.meta.url)('../plugin.cjs');

    it('adds the Bonjour service and a local network text without dropping existing values', () => {
        const plist = plugin.applyInfoPlist({NSBonjourServices: ['_http._tcp'], NSLocalNetworkUsageDescription: 'Ours'});
        assert.deepEqual(plist.NSBonjourServices, ['_http._tcp', '_remotedevtools._tcp']);
        assert.equal(plist.NSLocalNetworkUsageDescription, 'Ours');
        assert.match(plugin.applyInfoPlist({}).NSLocalNetworkUsageDescription, /Remote DevTools/);
        assert.equal(plugin.applyInfoPlist({}, {localNetworkUsage: 'Custom'}).NSLocalNetworkUsageDescription, 'Custom');
    });

    it('adds the multicast permission once', () => {
        const manifest = {manifest: {'uses-permission': [{$: {'android:name': 'android.permission.INTERNET'}}]}};
        plugin.applyAndroidManifest(manifest);
        plugin.applyAndroidManifest(manifest);
        assert.deepEqual(
            manifest.manifest['uses-permission'].map((p: {$: Record<string, string>}) => p.$['android:name']),
            ['android.permission.INTERNET', 'android.permission.CHANGE_WIFI_MULTICAST_STATE'],
        );
    });
});

// Real multicast: skipped on CI runners, where multicast on the loopback interface is not guaranteed.
describe('bonjour-service end to end', {skip: process.env.CI ? 'multicast is not available on CI' : false}, () => {
    it('finds an advertised relay and sends a connect request to it', async () => {
        await withRelay({connectRequests: 'local'}, async ({port}) => {
            const bonjour = new Bonjour();
            const name = `Remote DevTools test ${process.pid}`;
            bonjour.publish({name, type: 'remotedevtools', port, txt: {v: '2', path: '/ws/device'}});
            const ui = await openUi(port);
            const client = createClient({
                isDevelopment: true,
                discovery: {localhost: false, providers: [mdnsDiscovery(bonjourBrowser(bonjour), {browseMs: 1500})], intervalMs: 500},
            });
            try {
                await waitForStatus(client, 'pending-approval', 8000);
                const request = (await ui.next('connect.request')).payload;
                ui.send('connect.respond', {requestId: request.requestId, approve: true, trust: false});
                await waitForStatus(client, 'connected');
            } finally {
                client.destroy();
                ui.close();
                await new Promise<void>((resolve) => bonjour.unpublishAll(() => resolve()));
                bonjour.destroy();
            }
        });
    });
});
