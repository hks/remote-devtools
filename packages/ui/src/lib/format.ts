import type {DeviceInfo} from '@himmetkaan/remote-devtools-protocol/v1';

export function platformLabel(platform: string): string {
    if (platform === 'ios') return 'iOS';
    if (platform === 'android') return 'Android';
    return platform;
}

export function describeDevice(info: DeviceInfo): string {
    return `${platformLabel(info.platform)} ${info.osVersion} · v${info.appVersion} (${info.buildNumber})`;
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** `HH:mm:ss.SSS` */
export function formatClock(ts: number): string {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatRelative(ts: number, now = Date.now()): string {
    const sec = Math.max(0, Math.round((now - ts) / 1000));
    if (sec < 5) return 'şimdi';
    if (sec < 60) return `${sec} sn önce`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} dk önce`;
    const hour = Math.round(min / 60);
    if (hour < 24) return `${hour} sa önce`;
    return new Date(ts).toLocaleString('tr-TR');
}

export function stringifyData(data: unknown): string {
    if (typeof data === 'string') return data;
    try {
        return JSON.stringify(data, null, 2);
    } catch {
        return String(data);
    }
}

export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}
