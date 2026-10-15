import {PROTOCOL_VERSION, type QrPayload} from '@himmetkaan/remote-devtools-protocol';
import {QRCodeSVG} from 'qrcode.react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {copyText} from '../lib/format.ts';
import {relayClient, resolveDeviceWsUrl, resolveRelayBaseUrl} from '../lib/relayClient.ts';
import {useNow} from '../lib/useNow.ts';
import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';
import {ConnectRequests} from './ConnectRequests.tsx';
import {TrustedDevices} from './TrustedDevices.tsx';

/** A new one is requested this long before expiry — reduces the chance of a scanned QR being invalid. */
const REFRESH_BEFORE_MS = 5_000;

function isUnreachableHost(url: string): boolean {
    try {
        const host = new URL(url).hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
    } catch {
        return false;
    }
}

function CopyButton({text, label}: {text: string; label: string}) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            className="btn btn-small"
            onClick={async () => {
                setCopied(await copyText(text));
                setTimeout(() => setCopied(false), 1500);
            }}
        >
            {copied ? 'Copied ✓' : label}
        </button>
    );
}

/** QR + 6-digit code; refreshed automatically before expiry (both are single-use). */
export function PairingPanel() {
    const session = useDevtoolsStore((s) => s.session);
    const relay = useDevtoolsStore((s) => s.relay);
    const now = useNow(250);
    const refreshRequestedFor = useRef<string | null>(null);
    const totalMs = useRef<number>(0);

    const pairing = session?.pairing ?? null;
    const remainingMs = pairing ? Math.max(0, pairing.expiresAt - now) : 0;

    useEffect(() => {
        if (pairing) totalMs.current = Math.max(1, pairing.expiresAt - Date.now());
    }, [pairing]);

    useEffect(() => {
        if (relay !== 'open' || !pairing) return;
        if (remainingMs > REFRESH_BEFORE_MS) return;
        if (refreshRequestedFor.current === pairing.qrToken) return;
        refreshRequestedFor.current = pairing.qrToken;
        relayClient.send('pairing.refresh', {});
    }, [relay, pairing, remainingMs]);

    const qrValue = useMemo(() => {
        if (!session || !pairing) return null;
        const payload: QrPayload = {
            v: PROTOCOL_VERSION,
            url: resolveDeviceWsUrl(session.deviceWsUrl),
            sessionId: session.sessionId,
            qrToken: pairing.qrToken,
        };
        return JSON.stringify(payload);
    }, [session, pairing]);

    const deviceUrl = session ? resolveDeviceWsUrl(session.deviceWsUrl) : null;
    const relayUrl = session ? resolveRelayBaseUrl(session.deviceWsUrl) : null;
    const isExpiring = remainingMs <= REFRESH_BEFORE_MS;
    const progress = totalMs.current ? Math.min(1, remainingMs / totalMs.current) : 0;
    const dim = isExpiring || relay !== 'open';

    return (
        <div className="pairing">
            <ConnectRequests />

            <section className="pairing-card">
                <header className="pairing-head">
                    <h2>Connect a device</h2>
                    <p className="muted">Scan the QR code or enter the code in your app's Remote DevTools connect screen.</p>
                </header>

                <div className="pairing-methods">
                    <div className={`qr-frame${dim ? ' is-dim' : ''}`}>
                        {qrValue ? (
                            <QRCodeSVG value={qrValue} size={216} level="M" marginSize={0} bgColor="#ffffff" fgColor="#111111" />
                        ) : (
                            <div className="qr-placeholder">Preparing…</div>
                        )}
                    </div>
                    <div className="pairing-code-box">
                        <span className="muted small">Pairing code</span>
                        <span className={`pairing-code${dim ? ' is-dim' : ''}`} aria-label="Pairing code">
                            {pairing ? `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}` : '––– –––'}
                        </span>
                        {relayUrl && (
                            <>
                                <span className="muted small">Relay address</span>
                                <code className="pairing-url" title={relayUrl}>
                                    {relayUrl}
                                </code>
                            </>
                        )}
                    </div>
                </div>

                <div className="qr-timer" aria-label="Time left">
                    <div className="qr-timer-bar" style={{transform: `scaleX(${progress})`}} />
                </div>
                <p className="qr-timer-text">
                    {pairing
                        ? isExpiring
                            ? 'Generating a new code…'
                            : `Valid for ${Math.ceil(remainingMs / 1000)}s · single use`
                        : relay === 'open'
                          ? 'Opening a session…'
                          : 'Connecting to the relay…'}
                </p>

                {deviceUrl && isUnreachableHost(deviceUrl) && (
                    <p className="callout callout-warn">
                        The device address (<code>{deviceUrl}</code>) is not reachable from a phone. Set <code>PUBLIC_URL</code> on the
                        relay to a LAN IP or tunnel address, or open this page through the LAN IP. Simulators on this machine can still
                        connect.
                    </p>
                )}

                <p className="muted small">
                    Development builds (<code>isDevelopment: true</code>) on this machine or network can also find the relay automatically
                    and ask to connect; you will be asked to approve them here.
                </p>

                {qrValue && (
                    <details className="pairing-details">
                        <summary>QR content (for simulators)</summary>
                        <pre>{qrValue}</pre>
                        <CopyButton text={qrValue} label="Copy" />
                    </details>
                )}
            </section>

            <TrustedDevices />
        </div>
    );
}
