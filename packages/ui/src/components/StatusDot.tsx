import type {DeviceSnapshot} from '@himmetkaan/remote-devtools-protocol';
import {type DeviceStatus, getDeviceStatus} from '../store/useDevtoolsStore.ts';

export const STATUS_LABEL: Record<DeviceStatus, string> = {
    online: 'Connected',
    background: 'In background',
    offline: 'Offline',
};

export function StatusDot({device}: {device: DeviceSnapshot}) {
    const status = getDeviceStatus(device);
    return <span className={`status-dot is-${status}`} title={STATUS_LABEL[status]} aria-label={STATUS_LABEL[status]}/>;
}
