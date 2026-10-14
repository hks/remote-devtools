import type {Hello} from '@himmetkaan/remote-devtools-protocol';

export type DeviceInfo = Hello['device'];

/**
 * Ortamdan tahmin edilen cihaz bilgisi. React Native'de güvenilir bilgi için `device` seçeneği verilmelidir
 * (ör. `{platform: Platform.OS, os: String(Platform.Version), model, name}`).
 */
export function detectDevice(): DeviceInfo {
    const nav = (globalThis as {navigator?: Navigator & {product?: string; userAgentData?: {platform?: string}}}).navigator;
    if (nav?.product === 'ReactNative') return {platform: 'react-native', os: 'unknown'};
    if (nav?.userAgent) {
        return {platform: 'web', os: nav.userAgentData?.platform || nav.platform || 'unknown', name: browserName(nav.userAgent)};
    }
    const proc = (globalThis as {process?: {platform?: string; version?: string}}).process;
    if (proc?.platform) return {platform: proc.platform, os: proc.version ?? 'unknown', name: 'Node.js'};
    return {platform: 'unknown', os: 'unknown'};
}

function browserName(ua: string): string {
    if (/Edg\//.test(ua)) return 'Edge';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'Browser';
}
