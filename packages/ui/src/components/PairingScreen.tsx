import {useEffect, useMemo, useRef, useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {PROTOCOL_VERSION, type QrPayload} from '@himmetkaan/remote-devtools-protocol/v1';
import {relayClient, resolveDeviceWsUrl} from '../lib/relayClient.ts';
import {copyText} from '../lib/format.ts';
import {useNow} from '../lib/useNow.ts';
import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';
import {RelayBadge} from './RelayBadge.tsx';

/** Süre dolmadan bu kadar önce yeni token istenir — telefonun okuttuğu QR'ın geçersiz olma ihtimalini azaltır. */
const REFRESH_BEFORE_MS = 5_000;

function isUnreachableHost(url: string): boolean {
    try {
        const host = new URL(url).hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
    } catch {
        return false;
    }
}

export function PairingScreen() {
    const pairing = useDevtoolsStore((s) => s.pairing);
    const relay = useDevtoolsStore((s) => s.relay);
    const now = useNow(250);
    const refreshRequestedFor = useRef<string | null>(null);
    const [copied, setCopied] = useState(false);

    const token = pairing?.pairToken ?? null;
    const expiresAt = pairing?.pairTokenExpiresAt ?? null;
    const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : 0;
    const totalMs = useRef<number>(0);

    useEffect(() => {
        if (expiresAt) totalMs.current = Math.max(1, expiresAt - Date.now());
    }, [expiresAt]);

    useEffect(() => {
        if (relay !== 'open' || !token) return;
        if (remainingMs > REFRESH_BEFORE_MS) return;
        if (refreshRequestedFor.current === token) return;
        refreshRequestedFor.current = token;
        relayClient.send('refreshPairToken', {});
    }, [relay, token, remainingMs]);

    const qrValue = useMemo(() => {
        if (!pairing || !token) return null;
        const payload: QrPayload = {
            v: PROTOCOL_VERSION,
            url: resolveDeviceWsUrl(pairing.deviceWsUrl),
            sessionId: pairing.sessionId,
            pairToken: token,
        };
        return JSON.stringify(payload);
    }, [pairing, token]);

    const deviceUrl = pairing ? resolveDeviceWsUrl(pairing.deviceWsUrl) : null;
    const isExpiring = remainingMs <= REFRESH_BEFORE_MS;
    const progress = totalMs.current ? Math.min(1, remainingMs / totalMs.current) : 0;

    return (
        <div className="pairing">
            <div className="pairing-card">
                <header className="pairing-head">
                    <h1>🛠️ Remote DevTools</h1>
                    <RelayBadge state={relay}/>
                </header>

                <div className={`qr-frame${isExpiring || relay !== 'open' ? ' is-dim' : ''}`}>
                    {qrValue ? (
                        <QRCodeSVG value={qrValue} size={248} level="M" marginSize={0} bgColor="#ffffff" fgColor="#111111"/>
                    ) : (
                        <div className="qr-placeholder">QR hazırlanıyor…</div>
                    )}
                </div>

                <div className="qr-timer" aria-label="QR geçerlilik süresi">
                    <div className="qr-timer-bar" style={{transform: `scaleX(${progress})`}}/>
                </div>
                <p className="qr-timer-text">
                    {qrValue
                        ? isExpiring ? 'Yeni QR üretiliyor…' : `${Math.ceil(remainingMs / 1000)} sn geçerli · tek kullanımlık`
                        : relay === 'open' ? 'Oturum açılıyor…' : "Relay'e bağlanılıyor…"}
                </p>

                <ol className="pairing-steps">
                    <li>Uygulamada <b>Developer Menu</b>'yü aç</li>
                    <li><b>🔗 Remote</b> tabına geç</li>
                    <li>Bu QR'ı okut</li>
                </ol>

                {deviceUrl && isUnreachableHost(deviceUrl) && (
                    <p className="callout callout-warn">
                        QR'daki adres (<code>{deviceUrl}</code>) telefondan erişilemez. Relay'de <code>PUBLIC_URL</code>'i
                        LAN IP'si veya tünel adresiyle ayarla ya da bu sayfayı LAN IP üzerinden aç.
                    </p>
                )}

                {qrValue && (
                    <details className="pairing-details">
                        <summary>QR içeriği (simülatör için)</summary>
                        <pre>{qrValue}</pre>
                        <button
                            className="btn btn-small"
                            onClick={async () => {
                                setCopied(await copyText(qrValue));
                                setTimeout(() => setCopied(false), 1500);
                            }}
                        >
                            {copied ? 'Kopyalandı ✓' : 'Kopyala'}
                        </button>
                    </details>
                )}
            </div>
        </div>
    );
}
