import type {RelayConnectionState} from '../store/useDevtoolsStore.ts';

const LABEL: Record<RelayConnectionState, string> = {
    connecting: 'Connecting to relay',
    open: 'Relay connected',
    reconnecting: 'Reconnecting to relay',
};

export function RelayBadge({state}: {state: RelayConnectionState}) {
    return (
        <span className={`badge badge-relay is-${state}`} title={LABEL[state]}>
            <span className="dot" />
            {LABEL[state]}
        </span>
    );
}
