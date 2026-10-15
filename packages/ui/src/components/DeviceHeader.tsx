import type {DeviceSnapshot} from '@himmetkaan/remote-devtools-protocol';
import {formatRelative, platformLabel} from '../lib/format.ts';
import {relayClient} from '../lib/relayClient.ts';
import {useNow} from '../lib/useNow.ts';
import {unknownCapabilities} from '../modules/registry.ts';
import {deviceName, getDeviceStatus, useDevtoolsStore} from '../store/useDevtoolsStore.ts';
import {Shortcuts} from './Shortcuts.tsx';
import {STATUS_LABEL} from './StatusDot.tsx';

/** Selected device card: device, app, SDK and the app's free-form `meta` fields. */
export function DeviceHeader({device}: {device: DeviceSnapshot}) {
    const relay = useDevtoolsStore((s) => s.relay);
    const now = useNow(5000);
    const status = getDeviceStatus(device);
    const hello = device.hello;
    const lastSeen = status === 'offline' && device.lastSeenAt ? formatRelative(device.lastSeenAt, now) : null;
    const unknown = unknownCapabilities(device);

    const items: [string, string][] = hello
        ? [
              ['Device', [platformLabel(hello.device.platform), hello.device.os, hello.device.model].filter(Boolean).join(' · ')],
              ['App', `${hello.app.name} ${hello.app.version}${hello.app.build ? ` (${hello.app.build})` : ''}`],
              ['App ID', hello.app.id],
              ...Object.entries(hello.meta),
              ['SDK', `${hello.sdk.name} ${hello.sdk.version}`],
          ]
        : [['Device ID', device.deviceId]];

    return (
        <header className="device-header">
            <div className="device-title">
                <h1>{deviceName(device)}</h1>
                <span className={`badge badge-status is-${status}`} title={lastSeen ? `Last seen ${lastSeen}` : undefined}>
                    <span className="dot" />
                    {STATUS_LABEL[status]}
                    {lastSeen && <span className="badge-sub"> · {lastSeen}</span>}
                </span>
                {hello?.isDevelopment && <span className="badge">dev</span>}
                <span className="toolbar-spacer" />
                <Shortcuts />
                <button
                    type="button"
                    className="btn btn-small btn-danger"
                    disabled={relay !== 'open'}
                    onClick={() => {
                        if (confirm(`Unpair ${deviceName(device)}? The app will forget this connection.`)) {
                            relayClient.send('device.unpair', {deviceId: device.deviceId});
                        }
                    }}
                >
                    Unpair
                </button>
            </div>
            <dl className="device-meta">
                {items.map(([label, value]) => (
                    <div key={label}>
                        <dt>{label}</dt>
                        <dd title={value}>{value}</dd>
                    </div>
                ))}
            </dl>
            {unknown.length > 0 && (
                <p className="muted small device-unknown">
                    The app also reports modules this UI does not support yet: <code>{unknown.join(', ')}</code>
                </p>
            )}
        </header>
    );
}
