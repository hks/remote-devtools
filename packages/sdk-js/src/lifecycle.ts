import type {Lifecycle} from '@himmetkaan/remote-devtools-protocol';

/** Source reporting the app's foreground / background state. `subscribe` returns a function that unsubscribes. */
export type LifecycleSource = {
    current(): Lifecycle;
    subscribe(listener: (state: Lifecycle) => void): () => void;
};

/** Browser: `document.visibilityState`. Always `active` when there is no document. */
export function browserLifecycle(): LifecycleSource {
    const doc = (globalThis as {document?: Document}).document;
    const read = (): Lifecycle => (doc?.visibilityState === 'hidden' ? 'background' : 'active');
    return {
        current: read,
        subscribe(listener) {
            if (!doc) return () => {};
            const onChange = () => listener(read());
            doc.addEventListener('visibilitychange', onChange);
            return () => doc.removeEventListener('visibilitychange', onChange);
        },
    };
}

/** The part of React Native's `AppState` object we need (the SDK doesn't import `react-native`). */
export type AppStateLike = {
    currentState: string | null;
    addEventListener(type: 'change', listener: (state: string) => void): {remove(): void};
};

function fromAppState(state: string | null): Lifecycle {
    return state === 'background' ? 'background' : state === 'inactive' ? 'inactive' : 'active';
}

/** `reactNativeLifecycle(AppState)` — `import {AppState} from 'react-native'`. */
export function reactNativeLifecycle(appState: AppStateLike): LifecycleSource {
    return {
        current: () => fromAppState(appState.currentState),
        subscribe(listener) {
            const subscription = appState.addEventListener('change', (state) => listener(fromAppState(state)));
            return () => subscription.remove();
        },
    };
}

/** Environments without a lifecycle (Node, tests). */
export function staticLifecycle(): LifecycleSource {
    return {current: () => 'active', subscribe: () => () => {}};
}
