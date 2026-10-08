import type {DeviceSnapshot} from '../../../shared/protocol.ts';
import {formatRelative, platformLabel} from '../lib/format.ts';
import {useNow} from '../lib/useNow.ts';
import {type DeviceStatus, getDeviceStatus} from '../store/useDevtoolsStore.ts';

const STATUS_LABEL: Record<DeviceStatus, string> = {
    online: 'Bağlı',
    background: 'Arka planda',
    offline: 'Bağlantı yok',
};

/**
 * Yerleşim sabittir: kolon sayısı ve genişlikleri içerikten bağımsız, metinler tek satırda kısaltılır.
 * Böylece cihaz adı / durum değiştiğinde üst bar yükseklik değiştirip sayfayı kaydırmaz.
 */
export function DeviceCard({device}: {device: DeviceSnapshot}) {
    const now = useNow(5000);
    const status = getDeviceStatus(device);
    const info = device.info;
    const lastSeen = status === 'offline' && device.lastSeenAt ? formatRelative(device.lastSeenAt, now) : null;

    const deviceText = info
        ? `${platformLabel(info.platform)} ${info.osVersion}${info.deviceName ? ` · ${info.deviceName}` : ''}`
        : '—';

    return (
        <div className="device-card">
            <span
                className={`badge badge-status is-${status}`}
                title={lastSeen ? `Son görülme: ${lastSeen}` : STATUS_LABEL[status]}
            >
                <span className="dot"/>
                <span className="badge-text">
                    {STATUS_LABEL[status]}
                    {lastSeen && <span className="badge-sub"> · {lastSeen}</span>}
                </span>
            </span>
            <dl className="device-meta">
                <MetaItem label="Cihaz" value={deviceText}/>
                <MetaItem label="Uygulama" value={info ? `v${info.appVersion} (${info.buildNumber})` : '—'}/>
                <MetaItem label="Kullanıcı" value={info ? String(info.userId ?? '—') : '—'}/>
                <MetaItem label="Endpoint" value={info?.apiEndpoint ?? '—'} mono/>
            </dl>
        </div>
    );
}

function MetaItem({label, value, mono}: {label: string; value: string; mono?: boolean}) {
    return (
        <div>
            <dt>{label}</dt>
            <dd className={mono ? 'mono' : undefined} title={value}>{value}</dd>
        </div>
    );
}
