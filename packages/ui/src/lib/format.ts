import type {Hello} from '@himmetkaan/remote-devtools-protocol';

export function platformLabel(platform: string): string {
    const known: Record<string, string> = {ios: 'iOS', android: 'Android', web: 'Web', macos: 'macOS', windows: 'Windows', linux: 'Linux'};
    return known[platform] ?? platform;
}

export function describeDevice(hello: Hello): string {
    const app = `${hello.app.name} ${hello.app.version}${hello.app.build ? ` (${hello.app.build})` : ''}`;
    return `${platformLabel(hello.device.platform)} ${hello.device.os} · ${app}`;
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** `HH:mm:ss.SSS` */
export function formatClock(ts: number): string {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatRelative(ts: number, now = Date.now()): string {
    const sec = Math.max(0, Math.round((now - ts) / 1000));
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hour = Math.round(min / 60);
    if (hour < 24) return `${hour}h ago`;
    return new Date(ts).toLocaleString();
}

export function formatCountdown(ms: number): string {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    return sec >= 60 ? `${Math.floor(sec / 60)}:${pad(sec % 60)}` : `${sec}s`;
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
