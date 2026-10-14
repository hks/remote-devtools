import {platformLabel} from '../lib/format.ts';
import {deviceName, sortDevices, useDevtoolsStore} from '../store/useDevtoolsStore.ts';
import {RelayBadge} from './RelayBadge.tsx';
import {StatusDot} from './StatusDot.tsx';

export function Sidebar() {
    const devices = useDevtoolsStore((s) => s.devices);
    const selectedId = useDevtoolsStore((s) => s.selectedDeviceId);
    const showPairing = useDevtoolsStore((s) => s.showPairing);
    const pendingCount = useDevtoolsStore((s) => s.pendingRequests.length);
    const relay = useDevtoolsStore((s) => s.relay);
    const {selectDevice, setShowPairing} = useDevtoolsStore.getState();

    return (
        <aside className="sidebar">
            <header className="sidebar-head">
                <span className="brand">🛠️ Remote DevTools</span>
                <RelayBadge state={relay}/>
            </header>
            <nav className="device-list" aria-label="Devices">
                {sortDevices(Object.values(devices)).map((device) => {
                    const hello = device.hello;
                    const active = !showPairing && device.deviceId === selectedId;
                    return (
                        <button
                            key={device.deviceId}
                            className={`device-item${active ? ' is-active' : ''}`}
                            aria-current={active ? 'true' : undefined}
                            onClick={() => selectDevice(device.deviceId)}
                        >
                            <StatusDot device={device}/>
                            <span className="device-item-text">
                                <span className="device-item-name">{deviceName(device)}</span>
                                <span className="device-item-sub">
                                    {hello ? `${hello.app.name} ${hello.app.version} · ${platformLabel(hello.device.platform)}` : 'Waiting for device info…'}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </nav>
            <button className={`btn add-device${showPairing ? ' is-active-nav' : ''}`} onClick={() => setShowPairing(true)}>
                ＋ Add device
                {pendingCount > 0 && <span className="count-pill">{pendingCount}</span>}
            </button>
        </aside>
    );
}
