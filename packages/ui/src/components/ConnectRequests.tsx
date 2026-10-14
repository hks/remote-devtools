import {useState} from 'react';
import type {ConnectRequest} from '@himmetkaan/remote-devtools-protocol';
import {formatCountdown, platformLabel} from '../lib/format.ts';
import {relayClient} from '../lib/relayClient.ts';
import {useNow} from '../lib/useNow.ts';
import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';

function RequestCard({request}: {request: ConnectRequest}) {
    const now = useNow(1000);
    const [trust, setTrust] = useState(false);
    const {hello} = request;
    const respond = (approve: boolean) => relayClient.send('connect.respond', {requestId: request.requestId, approve, trust: approve && trust});

    return (
        <article className="request-card" aria-label="Connect request">
            <div className="request-text">
                <span>
                    <strong>{hello.device.name || hello.device.model || hello.app.name}</strong> wants to connect
                </span>
                <span className="muted small">
                    {hello.app.name} {hello.app.version} · {platformLabel(hello.device.platform)} {hello.device.os} · {request.via === 'local' ? 'local network' : 'remote address'}
                    {' · '}expires in {formatCountdown(request.expiresAt - now)}
                </span>
            </div>
            <label className="toggle" title="Next time this device (same app) connects without asking">
                <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)}/>
                Always allow
            </label>
            <button className="btn btn-small" onClick={() => respond(false)}>Reject</button>
            <button className="btn btn-small btn-primary" onClick={() => respond(true)}>Approve</button>
        </article>
    );
}

/** Development connect requests awaiting approval. Shown at the top of every view. */
export function ConnectRequests() {
    const requests = useDevtoolsStore((s) => s.pendingRequests);
    if (requests.length === 0) return null;
    return (
        <div className="requests" role="region" aria-label="Connect requests">
            {requests.map((request) => (
                <RequestCard key={request.requestId} request={request}/>
            ))}
        </div>
    );
}
