// Expo config plugin: `plugins: ['@himmetkaan/remote-devtools-mdns/plugin']`.
// iOS needs the Bonjour service type and a local network usage text to browse; Android needs the multicast permission.
// CommonJS because Expo loads config plugins with require().
const SERVICE = '_remotedevtools._tcp';
const DEFAULT_USAGE = 'Finds Remote DevTools on your local network during development.';
const MULTICAST_PERMISSION = 'android.permission.CHANGE_WIFI_MULTICAST_STATE';

function applyInfoPlist(infoPlist, options = {}) {
    const services = new Set(infoPlist.NSBonjourServices ?? []);
    services.add(SERVICE);
    infoPlist.NSBonjourServices = [...services];
    if (options.localNetworkUsage || !infoPlist.NSLocalNetworkUsageDescription) {
        infoPlist.NSLocalNetworkUsageDescription = options.localNetworkUsage ?? DEFAULT_USAGE;
    }
    return infoPlist;
}

function applyAndroidManifest(manifest) {
    const root = manifest.manifest;
    root['uses-permission'] = root['uses-permission'] ?? [];
    if (!root['uses-permission'].some((p) => p.$?.['android:name'] === MULTICAST_PERMISSION)) {
        root['uses-permission'].push({$: {'android:name': MULTICAST_PERMISSION}});
    }
    return manifest;
}

/** @param {object} config @param {{localNetworkUsage?: string}} [options] */
function withRemoteDevtoolsMdns(config, options = {}) {
    const {withAndroidManifest, withInfoPlist} = require('expo/config-plugins');
    config = withInfoPlist(config, (mod) => {
        applyInfoPlist(mod.modResults, options);
        return mod;
    });
    return withAndroidManifest(config, (mod) => {
        applyAndroidManifest(mod.modResults);
        return mod;
    });
}

module.exports = withRemoteDevtoolsMdns;
module.exports.applyInfoPlist = applyInfoPlist;
module.exports.applyAndroidManifest = applyAndroidManifest;
