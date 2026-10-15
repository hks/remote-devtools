import {networkInterfaces} from 'node:os';

export type LanAddress = {iface: string; address: string};

// Virtual / tunnel interfaces: the phone cannot reach these.
const VIRTUAL_IFACE =
    /^(lo|utun|awdl|llw|bridge|docker|veth|br-|vmnet|vboxnet|virbr|tun|tap|zt|tailscale|wg|anpi|ap\d)|vEthernet|VirtualBox|VMware|Hyper-V|Loopback/i;
// Preference order: macOS Wi-Fi/Ethernet, Linux, Windows names.
const PREFERRED_IFACE = [/^en0$/, /^en\d+$/, /^(eth|enp|eno|ens|wlan|wlp)/, /^(Wi-?Fi|WLAN|Ethernet)/i];

function isPrivateIPv4(address: string): boolean {
    return /^10\./.test(address) || /^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

/** IPv4 addresses the phone can reach, most likely first. */
export function listLanAddresses(): LanAddress[] {
    const result: LanAddress[] = [];
    for (const [iface, infos] of Object.entries(networkInterfaces())) {
        for (const info of infos ?? []) {
            if (info.family !== 'IPv4' || info.internal) continue;
            if (info.address.startsWith('169.254.')) continue;
            result.push({iface, address: info.address});
        }
    }

    const score = ({iface, address}: LanAddress) => {
        let s = 0;
        if (VIRTUAL_IFACE.test(iface)) s += 100;
        if (!isPrivateIPv4(address)) s += 10;
        const pref = PREFERRED_IFACE.findIndex((re) => re.test(iface));
        s += pref === -1 ? PREFERRED_IFACE.length : pref;
        return s;
    };
    return result.sort((a, b) => score(a) - score(b) || a.iface.localeCompare(b.iface));
}
