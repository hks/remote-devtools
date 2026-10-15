import {formatRelative} from '../lib/format.ts';
import {relayClient} from '../lib/relayClient.ts';
import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';

export function TrustedDevices() {
    const trusted = useDevtoolsStore((s) => s.trusted);
    if (trusted.length === 0) return null;
    return (
        <section className="pairing-card trusted">
            <h3>Always allowed</h3>
            <p className="muted small">These development devices connect without asking.</p>
            <ul>
                {trusted.map((t) => (
                    <li key={t.deviceId}>
                        <span>
                            <strong>{t.name}</strong>{' '}
                            <span className="muted small">
                                {t.appId} · added {formatRelative(t.trustedAt)}
                            </span>
                        </span>
                        <button className="btn btn-small" onClick={() => relayClient.send('trusted.remove', {deviceId: t.deviceId})}>
                            Remove
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
