<script setup lang="ts">
import {withBase} from 'vitepress';
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';

type Step = {
    shot: string;
    kicker: string;
    title: string;
    text: string;
    code?: string;
    /** Spotlight in percent of the screenshot: left, top, width, height. */
    focus: [number, number, number, number];
    zoom: number;
};

const steps: Step[] = [
    {
        shot: 'pairing',
        kicker: 'Pair',
        title: 'Scan, type six digits, or just ask.',
        text: 'Every session shows a single-use QR code and pairing code. Simulators and development builds find the relay on their own.',
        code: 'devtools.connection.pairWithQr(scanned)',
        focus: [28.9, 8.1, 42.2, 54.6],
        zoom: 1.2,
    },
    {
        shot: 'connect-request',
        kicker: 'Approve',
        title: 'Nothing joins without a yes.',
        text: 'A development build on your network asks to connect. Approve it once, or always for that device and app.',
        code: 'isDevelopment: __DEV__',
        focus: [18.3, 1.3, 80.6, 6.7],
        zoom: 1.08,
    },
    {
        shot: 'logs',
        kicker: 'Logs',
        title: 'Every log, from the moment the app starts.',
        text: 'Levels, tags and structured data, captured console output, and the events from before the device connected.',
        code: "devtools.log.error('Payment failed', error, {tag: 'checkout'})",
        focus: [17.3, 29.4, 82.7, 35.2],
        zoom: 1.12,
    },
    {
        shot: 'network',
        kicker: 'Network',
        title: 'See the request that broke checkout.',
        text: 'fetch, XMLHttpRequest and axios are captured automatically. Inspect headers and bodies, copy as cURL, export HAR.',
        code: 'networkModule()',
        focus: [62, 21.4, 38, 65],
        zoom: 1.3,
    },
    {
        shot: 'functions',
        kicker: 'Functions',
        title: 'Your dev menu, with buttons that run on the phone.',
        text: 'Register functions in the app; the UI turns their arguments into forms and shows the result.',
        code: "functions.register({id: 'cart.seed', title: 'Add sample items', handler})",
        focus: [18.3, 23, 40, 49],
        zoom: 1.3,
    },
    {
        shot: 'state',
        kicker: 'State',
        title: 'Watch the store change, action by action.',
        text: 'Redux and Zustand state as a live tree, with every change as old → new — sent as small JSON patches.',
        code: 'stateModule({stores: [zustandAdapter(useCart)]})',
        focus: [67, 22.4, 32.3, 61.2],
        zoom: 1.3,
    },
    {
        shot: 'storage',
        kicker: 'Storage',
        title: 'Open AsyncStorage like a folder.',
        text: 'Browse, edit and delete keys in AsyncStorage, MMKV and localStorage. SecureStore stays read-only and masked.',
        code: 'storageModule({adapters: [asyncStorageAdapter(AsyncStorage)]})',
        focus: [62, 21.4, 38, 26.6],
        zoom: 1.4,
    },
    {
        shot: 'flags',
        kicker: 'Flags',
        title: 'Flip a feature without a new build.',
        text: 'Typed flags with editors for their type. Overrides persist on the device until you reset them.',
        code: "flags.define({key: 'checkout.v2', field: {type: 'boolean'}})",
        focus: [18.3, 30.2, 19.7, 17.6],
        zoom: 1.6,
    },
    {
        shot: 'panel',
        kicker: 'Custom panels',
        title: 'Build your own tab in a few lines.',
        text: 'Describe stats, tables, forms and buttons; the UI draws them and your handlers run in the app.',
        code: "panels.define({id: 'orders', title: 'Orders', blocks})",
        focus: [18.3, 23.7, 80.6, 44.9],
        zoom: 1.12,
    },
];

const img = (name: string) => withBase(`/landing/${name}.webp`);
const docs = (path: string) => withBase(path);
const github = 'https://github.com/hks/remote-devtools';
const download = `${github}/releases/latest`;

const active = ref(0);
const progress = ref(0);
const storyEl = ref<HTMLElement | null>(null);
const stepEls = ref<HTMLElement[]>([]);
const reduceMotion = ref(false);

const current = computed(() => steps[active.value]!);
/**
 * Zooms towards the spotlight: the whole focus area stays visible (with a margin), its centre moves as close to the
 * middle of the window as possible, and the screenshot always covers the window (no empty edges).
 */
const zoomStyle = computed(() => {
    const [x, y, w, h] = current.value.focus;
    const scale = reduceMotion.value ? 1 : Math.max(1, Math.min(current.value.zoom, 92 / w, 90 / h));
    const offset = (start: number, size: number) => Math.min(0, Math.max(100 - 100 * scale, 50 - scale * (start + size / 2)));
    return {transform: `translate(${offset(x, w)}%, ${offset(y, h)}%) scale(${scale})`};
});
const spotStyle = computed(() => {
    const [x, y, w, h] = current.value.focus;
    return {left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`};
});

let observer: IntersectionObserver | null = null;
const onScroll = () => {
    const el = storyEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    progress.value = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
};

onMounted(() => {
    reduceMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) active.value = Number((entry.target as HTMLElement).dataset.index);
            }
        },
        {rootMargin: '-45% 0px -45% 0px'},
    );
    for (const el of stepEls.value) observer.observe(el);
    window.addEventListener('scroll', onScroll, {passive: true});
    onScroll();
});

onBeforeUnmount(() => {
    observer?.disconnect();
    window.removeEventListener('scroll', onScroll);
});
</script>

<template>
    <div class="lp">
        <header class="lp-nav">
            <a class="lp-brand" :href="docs('/')">
                <img :src="img('logo')" alt="" width="32" height="32" />
                <span>Remote DevTools</span>
            </a>
            <nav class="lp-links">
                <a :href="docs('/guide/introduction')">Docs</a>
                <a :href="docs('/modules/logs')">Modules</a>
                <a :href="github" target="_blank" rel="noreferrer">GitHub</a>
                <a class="lp-btn lp-btn-small" :href="download" target="_blank" rel="noreferrer">Download</a>
            </nav>
        </header>

        <section class="lp-hero">
            <img class="lp-logo" :src="img('logo')" alt="Remote DevTools logo" width="112" height="112" />
            <p class="lp-eyebrow">Open source · React Native · Expo · Web</p>
            <h1>Your app's dev menu,<br /><span class="lp-grad">on your computer.</span></h1>
            <p class="lp-lead">
                Add a small SDK, pair with a QR code, and inspect logs, network traffic, state, storage and feature flags of a running app —
                on a simulator, a test phone, or a build in someone else's hands.
            </p>
            <div class="lp-ctas">
                <a class="lp-btn lp-btn-primary" :href="docs('/guide/quick-start-react-native')">Get started</a>
                <a class="lp-btn" :href="download" target="_blank" rel="noreferrer">Download for macOS</a>
            </div>
            <div class="lp-install"><span>$</span> npm install @himmetkaan/remote-devtools</div>

            <figure class="lp-hero-shot">
                <div class="lp-window">
                    <div class="lp-titlebar"><i /><i /><i /><span>Remote DevTools — 192.168.1.24:8787</span></div>
                    <img :src="img('network')" alt="The Network tab showing an app's API requests and the details of one request" width="1440" height="900" />
                </div>
            </figure>
        </section>

        <section ref="storyEl" class="lp-story" aria-label="How it works">
            <div class="lp-stage">
                <div class="lp-window lp-window-stage">
                    <div class="lp-titlebar">
                        <i /><i /><i /><span>{{ current.kicker }}</span>
                    </div>
                    <div class="lp-screen">
                        <div class="lp-zoom" :style="zoomStyle">
                            <img
                                v-for="(step, i) in steps"
                                :key="step.shot"
                                :src="img(step.shot)"
                                :alt="i === active ? step.title : ''"
                                :class="{'is-active': i === active}"
                                width="1440"
                                height="900"
                                :loading="i < 2 ? 'eager' : 'lazy'"
                            />
                            <div class="lp-spot" :style="spotStyle" aria-hidden="true" />
                        </div>
                    </div>
                </div>
                <ol class="lp-dots" aria-hidden="true">
                    <li v-for="(step, i) in steps" :key="step.shot" :class="{'is-active': i === active, 'is-done': i < active}" />
                </ol>
            </div>

            <div class="lp-steps">
                <div class="lp-progress" aria-hidden="true"><span :style="{transform: `scaleY(${progress})`}" /></div>
                <article
                    v-for="(step, i) in steps"
                    :key="step.shot"
                    ref="stepEls"
                    class="lp-step"
                    :class="{'is-active': i === active}"
                    :data-index="i"
                >
                    <p class="lp-kicker"><span>{{ String(i + 1).padStart(2, '0') }}</span>{{ step.kicker }}</p>
                    <h2>{{ step.title }}</h2>
                    <p>{{ step.text }}</p>
                    <code v-if="step.code">{{ step.code }}</code>
                    <img class="lp-step-shot" :src="img(step.shot)" :alt="step.title" width="1440" height="900" loading="lazy" />
                </article>
            </div>
        </section>

        <section class="lp-run">
            <h2>Runs where you need it</h2>
            <div class="lp-cards">
                <a class="lp-card" :href="docs('/guide/desktop-app')">
                    <span class="lp-card-icon">🖥️</span>
                    <h3>Desktop app</h3>
                    <p>Relay and UI in one signed, notarized macOS app. Updates itself, and can announce itself over Bonjour.</p>
                </a>
                <a class="lp-card" :href="docs('/guide/self-hosting')">
                    <span class="lp-card-icon">🐳</span>
                    <h3>Self-hosted</h3>
                    <p>One Docker image with the relay and the web UI. Put it behind TLS and pair devices from anywhere.</p>
                </a>
                <a class="lp-card" :href="docs('/reference/protocol')">
                    <span class="lp-card-icon">🧩</span>
                    <h3>Open protocol</h3>
                    <p>A documented WebSocket protocol and field DSL, so SDKs for Swift, Kotlin or Flutter plug into the same UI.</p>
                </a>
            </div>
        </section>

        <section class="lp-start">
            <h2>A few lines to your first log</h2>
            <pre><code><span class="k">import</span> {RemoteDevTools, networkModule} <span class="k">from</span> <span class="s">'@himmetkaan/remote-devtools'</span>;

<span class="k">const</span> devtools = RemoteDevTools.init({
    enabled: __DEV__,
    app: {id: <span class="s">'com.example.app'</span>, name: <span class="s">'Example'</span>, version: <span class="s">'1.0.0'</span>},
    modules: [networkModule()],
});
devtools.log.info(<span class="s">'Hello from the app'</span>);</code></pre>
            <div class="lp-ctas">
                <a class="lp-btn lp-btn-primary" :href="docs('/guide/quick-start-react-native')">React Native quick start</a>
                <a class="lp-btn" :href="docs('/guide/quick-start-web')">Web quick start</a>
            </div>
        </section>

        <footer class="lp-footer">
            <span>MIT licensed · Off by default in production · Nothing stored in the UI</span>
            <span><a :href="github" target="_blank" rel="noreferrer">GitHub</a> · <a :href="docs('/guide/introduction')">Documentation</a></span>
        </footer>
    </div>
</template>

<style scoped>
.lp {
    --bg: #040823;
    --ink: #eef1ff;
    --muted: #a3abd0;
    --line: rgb(255 255 255 / 0.09);
    --cyan: #3fd6ff;
    --indigo: #6366f1;
    --pink: #f06595;
    min-height: 100vh;
    color: var(--ink);
    background:
        radial-gradient(1200px 700px at 85% -10%, rgb(67 56 202 / 0.45), transparent 60%),
        radial-gradient(900px 600px at -10% 30%, rgb(14 116 144 / 0.35), transparent 60%),
        var(--bg);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    overflow-x: clip;
}
.lp a { color: inherit; text-decoration: none; }

/* Nav */
.lp-nav {
    position: sticky; top: 0; z-index: 20;
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px clamp(16px, 4vw, 48px);
    background: rgb(4 8 35 / 0.7); backdrop-filter: blur(14px); border-bottom: 1px solid var(--line);
}
.lp-brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -0.01em; }
.lp-brand img { border-radius: 8px; }
.lp-links { display: flex; align-items: center; gap: clamp(12px, 2.5vw, 28px); font-size: 14px; color: var(--muted); }
.lp-links a:hover { color: var(--ink); }

/* Buttons */
.lp-btn {
    display: inline-flex; align-items: center; justify-content: center; height: 46px; padding: 0 22px;
    border-radius: 999px; border: 1px solid var(--line); background: rgb(255 255 255 / 0.04);
    font-weight: 600; font-size: 15px; transition: background 0.2s, transform 0.2s;
}
.lp-btn:hover { background: rgb(255 255 255 / 0.1); }
.lp-btn-primary { border-color: transparent; background: linear-gradient(135deg, var(--pink), #c2255c); color: #fff !important; box-shadow: 0 10px 30px rgb(240 101 149 / 0.3); }
.lp-btn-primary:hover { background: linear-gradient(135deg, #f783ac, var(--pink)); transform: translateY(-1px); }
.lp-btn-small { height: 34px; padding: 0 14px; font-size: 13px; color: var(--ink) !important; }

/* Hero */
.lp-hero { padding: clamp(48px, 9vh, 110px) clamp(16px, 4vw, 48px) 0; text-align: center; }
.lp-logo { width: 112px; height: 112px; border-radius: 26px; margin: 0 auto 28px; display: block; box-shadow: 0 0 0 1px var(--line), 0 20px 60px rgb(63 214 255 / 0.25); }
.lp-eyebrow { margin: 0 0 14px; font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cyan); font-weight: 600; }
.lp-hero h1 { margin: 0 auto; max-width: 900px; font-size: clamp(40px, 7vw, 84px); line-height: 1.02; letter-spacing: -0.035em; font-weight: 800; border: 0; }
.lp-grad { background: linear-gradient(90deg, var(--cyan), #8b8bff 50%, var(--pink)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lp-lead { margin: 26px auto 0; max-width: 680px; font-size: clamp(17px, 2vw, 20px); line-height: 1.6; color: var(--muted); }
.lp-ctas { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 34px; }
.lp-install {
    display: inline-flex; gap: 10px; margin-top: 22px; padding: 10px 16px; border-radius: 10px;
    border: 1px solid var(--line); background: rgb(0 0 0 / 0.25); font: 14px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink);
}
.lp-install span { color: var(--cyan); }
.lp-hero-shot { margin: clamp(48px, 8vh, 80px) auto 0; max-width: 1180px; perspective: 1800px; }

/* Window chrome */
.lp-window { border-radius: 14px; overflow: hidden; border: 1px solid rgb(255 255 255 / 0.12); background: #0d1117; box-shadow: 0 40px 120px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(0 0 0 / 0.4); }
.lp-window img { display: block; width: 100%; height: auto; }
.lp-titlebar { position: relative; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px; background: #161b22; border-bottom: 1px solid rgb(255 255 255 / 0.06); }
.lp-titlebar i { width: 12px; height: 12px; border-radius: 50%; background: #ff5f57; }
.lp-titlebar i:nth-child(2) { background: #febc2e; }
.lp-titlebar i:nth-child(3) { background: #28c840; }
.lp-titlebar span { position: absolute; left: 0; right: 0; text-align: center; font-size: 12px; color: #8b949e; pointer-events: none; }

@supports (animation-timeline: view()) {
    .lp-hero-shot .lp-window {
        animation: lp-unfold linear both;
        animation-timeline: view();
        animation-range: entry 0% cover 40%;
    }
    @keyframes lp-unfold {
        from { transform: rotateX(22deg) scale(0.9); opacity: 0.4; }
        to { transform: rotateX(0) scale(1); opacity: 1; }
    }
}

/* Story */
.lp-story {
    position: relative; display: grid; grid-template-columns: minmax(300px, 0.8fr) minmax(0, 1.4fr);
    gap: clamp(24px, 4vw, 64px); max-width: 1400px; margin: clamp(80px, 14vh, 160px) auto 0; padding: 0 clamp(16px, 4vw, 48px);
}
.lp-stage { grid-column: 2; grid-row: 1; position: sticky; top: max(84px, calc(50vh - min(21vw, 300px))); align-self: start; }
.lp-window-stage .lp-titlebar span { color: var(--ink); font-weight: 600; }
.lp-screen { position: relative; aspect-ratio: 16 / 10; overflow: hidden; background: #0d1117; }
.lp-zoom { position: absolute; inset: 0; transform-origin: 0 0; transition: transform 0.9s cubic-bezier(0.22, 1, 0.36, 1); }
.lp-zoom img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.6s ease; }
.lp-zoom img.is-active { opacity: 1; }
.lp-spot {
    position: absolute; border-radius: 10px; pointer-events: none;
    box-shadow: 0 0 0 2px rgb(63 214 255 / 0.9), 0 0 30px rgb(63 214 255 / 0.35), 0 0 0 200vmax rgb(3 6 30 / 0.5);
    transition: left 0.9s cubic-bezier(0.22, 1, 0.36, 1), top 0.9s cubic-bezier(0.22, 1, 0.36, 1), width 0.9s cubic-bezier(0.22, 1, 0.36, 1), height 0.9s cubic-bezier(0.22, 1, 0.36, 1);
}
.lp-dots { display: flex; justify-content: center; gap: 8px; margin: 18px 0 0; padding: 0; list-style: none; }
.lp-dots li { width: 8px; height: 8px; border-radius: 999px; background: rgb(255 255 255 / 0.18); transition: width 0.3s, background 0.3s; }
.lp-dots li.is-done { background: rgb(63 214 255 / 0.5); }
.lp-dots li.is-active { width: 28px; background: var(--cyan); }

.lp-steps { grid-column: 1; grid-row: 1; position: relative; padding-left: 28px; }
.lp-progress { position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--line); border-radius: 2px; }
.lp-progress span { display: block; height: 100%; background: linear-gradient(var(--cyan), var(--pink)); transform-origin: top; border-radius: 2px; }
.lp-step { min-height: 78vh; display: flex; flex-direction: column; justify-content: center; opacity: 0.35; transition: opacity 0.5s; }
.lp-step:first-child { min-height: 60vh; }
.lp-step:last-child { min-height: 90vh; }
.lp-step.is-active { opacity: 1; }
.lp-kicker { display: flex; align-items: center; gap: 12px; margin: 0 0 14px; font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cyan); }
.lp-kicker span { font-family: ui-monospace, Menlo, monospace; color: var(--muted); letter-spacing: 0; }
.lp-step h2 { margin: 0; font-size: clamp(26px, 3vw, 38px); line-height: 1.12; letter-spacing: -0.02em; font-weight: 750; border: 0; padding: 0; }
.lp-step p { margin: 16px 0 0; font-size: 17px; line-height: 1.65; color: var(--muted); }
.lp-step code {
    align-self: flex-start; margin-top: 22px; padding: 8px 12px; border-radius: 8px; max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere;
    background: rgb(0 0 0 / 0.3); border: 1px solid var(--line); color: #c9d1ff; font-size: 13px;
}
.lp-step-shot { display: none; }

/* Run anywhere */
.lp-run, .lp-start { max-width: 1100px; margin: clamp(80px, 14vh, 140px) auto 0; padding: 0 clamp(16px, 4vw, 48px); text-align: center; }
.lp-run h2, .lp-start h2 { margin: 0 0 36px; font-size: clamp(30px, 4vw, 48px); letter-spacing: -0.03em; font-weight: 800; border: 0; padding: 0; }
.lp-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; text-align: left; }
.lp-card { padding: 28px; border-radius: 18px; border: 1px solid var(--line); background: linear-gradient(180deg, rgb(255 255 255 / 0.05), rgb(255 255 255 / 0.01)); transition: transform 0.25s, border-color 0.25s; }
.lp-card:hover { transform: translateY(-4px); border-color: rgb(63 214 255 / 0.4); }
.lp-card-icon { font-size: 28px; }
.lp-card h3 { margin: 14px 0 8px; font-size: 20px; }
.lp-card p { margin: 0; color: var(--muted); line-height: 1.6; }

/* Get started */
.lp-start pre {
    margin: 0 auto; max-width: 720px; padding: 24px 28px; border-radius: 16px; text-align: left; overflow-x: auto;
    background: #0b1028; border: 1px solid var(--line); font: 14px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d8dcff;
}
.lp-start pre .k { color: #c792ea; }
.lp-start pre .s { color: #a5e3a1; }

.lp-footer {
    display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-top: clamp(80px, 14vh, 140px);
    padding: 28px clamp(16px, 4vw, 48px); border-top: 1px solid var(--line); font-size: 13px; color: var(--muted);
}
.lp-footer a:hover { color: var(--ink); }

@media (max-width: 900px) {
    .lp-links a:not(.lp-btn) { display: none; }
    .lp-story { display: block; }
    .lp-stage { display: none; }
    .lp-steps { padding-left: 0; }
    .lp-progress { display: none; }
    .lp-step, .lp-step:first-child, .lp-step:last-child { min-height: 0; opacity: 1; margin-bottom: 72px; }
    .lp-step-shot { display: block; width: 100%; height: auto; margin-top: 24px; border-radius: 12px; border: 1px solid rgb(255 255 255 / 0.12); }
    .lp-cards { grid-template-columns: minmax(0, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
    .lp-zoom, .lp-zoom img, .lp-spot, .lp-step, .lp-dots li { transition: none; }
    .lp-hero-shot .lp-window { animation: none; }
}
</style>
