import type {Lifecycle} from '@himmetkaan/remote-devtools-protocol';

/** Uygulamanın ön plan / arka plan durumunu bildiren kaynak. `subscribe` aboneliği kaldıran bir fonksiyon döner. */
export type LifecycleSource = {
    current(): Lifecycle;
    subscribe(listener: (state: Lifecycle) => void): () => void;
};

/** Tarayıcı: `document.visibilityState`. Belge yoksa her zaman `active`. */
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

/** React Native'in `AppState` nesnesinin ihtiyaç duyduğumuz kısmı (SDK `react-native`'i import etmez). */
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

/** Yaşam döngüsü olmayan ortamlar (Node, testler). */
export function staticLifecycle(): LifecycleSource {
    return {current: () => 'active', subscribe: () => () => {}};
}
