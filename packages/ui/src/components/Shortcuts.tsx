import {useEffect, useState} from 'react';
import {modulesFor} from '../modules/registry.ts';
import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';

const SHORTCUTS: [string, string][] = [
    ['1 – 9', 'Switch tab (in order)'],
    ['[ / ]', 'Previous / next device'],
    ['/', 'Focus search in the current tab'],
    ['⌘F / Ctrl+F', 'Focus search in the current tab'],
    ['↑ / ↓', 'Network: previous / next request'],
    ['p', 'Network: pause / resume'],
    ['Esc', 'Close details / this dialog'],
    ['?', 'Keyboard shortcuts'],
];

function isTyping(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function moveDevice(step: number) {
    const {devices, selectedDeviceId, selectDevice} = useDevtoolsStore.getState();
    const ids = Object.values(devices)
        .sort((a, b) => a.pairedAt - b.pairedAt)
        .map((d) => d.deviceId);
    if (ids.length === 0) return;
    const idx = selectedDeviceId ? ids.indexOf(selectedDeviceId) : -1;
    selectDevice(ids[(idx + step + ids.length) % ids.length]!);
}

/** Shortcuts that work across tabs + help opened with `?`. */
export function Shortcuts() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
            if (e.key === '?') return setOpen((v) => !v);
            if (e.key === 'Escape') return setOpen(false);
            if (e.key === '[') return moveDevice(-1);
            if (e.key === ']') return moveDevice(1);
            if (/^[1-9]$/.test(e.key)) {
                const {devices, selectedDeviceId, setActiveTab} = useDevtoolsStore.getState();
                const module = modulesFor(selectedDeviceId ? (devices[selectedDeviceId] ?? null) : null)[Number(e.key) - 1];
                if (module) setActiveTab(module.id);
                return;
            }
            if (e.key === '/') {
                e.preventDefault();
                document.querySelector<HTMLInputElement>('.tab-content input[type="search"]')?.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return (
        <>
            <button
                type="button"
                className="icon-btn shortcuts-btn"
                onClick={() => setOpen(true)}
                title="Keyboard shortcuts (?)"
                aria-label="Keyboard shortcuts"
            >
                ⌨︎
            </button>
            {open && (
                // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click closes the dialog; Escape is handled globally.
                // biome-ignore lint/a11y/noStaticElementInteractions: see above.
                <div className="overlay" onClick={() => setOpen(false)}>
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: only stops the backdrop click from closing the dialog. */}
                    <div className="dialog" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
                        <header>
                            <h2>Keyboard shortcuts</h2>
                            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                                ✕
                            </button>
                        </header>
                        <table className="kv">
                            <tbody>
                                {SHORTCUTS.map(([keys, desc]) => (
                                    <tr key={keys}>
                                        <th>
                                            <kbd>{keys}</kbd>
                                        </th>
                                        <td>{desc}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </>
    );
}
