import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {loadConfig} from '../src/config.ts';
import {FailureLimiter, isLocalAddress} from '../src/net.ts';
import {randomCode} from '../src/secrets.ts';

describe('isLocalAddress', () => {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.5', '169.254.0.1', 'fd12::1', 'fe80::1'];
    const remote = ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '2001:db8::1', '::ffff:8.8.8.8', ''];
    for (const ip of local) it(`treats ${ip} as local`, () => assert.equal(isLocalAddress(ip), true));
    for (const ip of remote) it(`treats ${ip || '(empty)'} as remote`, () => assert.equal(isLocalAddress(ip), false));
});

describe('FailureLimiter', () => {
    it('blocks after the limit and forgets after the window', () => {
        let now = 0;
        const limiter = new FailureLimiter(2, 1000, () => now);
        limiter.record('a');
        assert.equal(limiter.blocked('a'), false);
        limiter.record('a');
        assert.equal(limiter.blocked('a'), true);
        assert.equal(limiter.blocked('b'), false);
        now = 1001;
        assert.equal(limiter.blocked('a'), false);
    });
});

describe('randomCode', () => {
    it('always returns six digits', () => {
        for (let i = 0; i < 1000; i++) assert.match(randomCode(), /^\d{6}$/);
    });
});

describe('loadConfig', () => {
    it('reads env vars with units', () => {
        const config = loadConfig({
            PORT: '9000',
            DEVICE_PAIRING_TTL_HOURS: '2',
            CONNECT_REQUESTS: 'local',
            TRUST_PROXY: 'true',
            PUBLIC_URL: 'https://x.example.com/',
        });
        assert.equal(config.port, 9000);
        assert.equal(config.devicePairingTtlMs, 2 * 60 * 60 * 1000);
        assert.equal(config.connectRequests, 'local');
        assert.equal(config.trustProxy, true);
        assert.equal(config.publicUrl, 'https://x.example.com');
    });

    it('rejects invalid values', () => {
        assert.throws(() => loadConfig({CONNECT_REQUESTS: 'maybe'}));
        assert.throws(() => loadConfig({TRUST_PROXY: 'sure'}));
        assert.throws(() => loadConfig({PORT: '-1'}));
    });
});
