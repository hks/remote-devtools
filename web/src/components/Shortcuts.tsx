import {useEffect, useState} from 'react';
import {requestSync} from '../lib/network.ts';
import {type TabId, useDevtoolsStore} from '../store/useDevtoolsStore.ts';
import {useNetworkStore} from '../store/useNetworkStore.ts';

const TAB_KEYS: Record<string, TabId> = {'1': 'logs', '2': 'serviceRequests', '3': 'functions'};

const SHORTCUTS: [string, string][] = [
    ['1 / 2 / 3', 'Logs / Service Requests / Functions'],
    ['/', 'Aktif tabda aramaya odaklan'],
    ['⌘F / Ctrl+F', 'Aktif tabda aramaya odaklan'],
    ['s', 'Sync (geçmiş istekleri getir)'],
    ['↑ / ↓', 'Service Requests: önceki / sonraki istek'],
    ['Esc', 'Detayı / bu pencereyi kapat'],
    ['p', 'Service Requests: duraklat / devam'],
    ['?', 'Kısayollar'],
];

function isTyping(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** Tab'lar arası geçerli kısayollar + `?` ile açılan yardım. */
export function Shortcuts() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
            if (e.key === '?') {
                setOpen((v) => !v);
                return;
            }
            if (e.key === 'Escape') {
                setOpen(false);
                return;
            }
            const tab = TAB_KEYS[e.key];
            if (tab) {
                useDevtoolsStore.getState().setActiveTab(tab);
                return;
            }
            if (e.key === '/') {
                e.preventDefault();
                document.querySelector<HTMLInputElement>('.tab-content input[type="search"]')?.focus();
                return;
            }
            if (e.key === 's') {
                const {relay, device} = useDevtoolsStore.getState();
                if (relay === 'open' && device?.connected && useNetworkStore.getState().sync.status === 'idle') requestSync();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return (
        <>
            <button className="icon-btn shortcuts-btn" onClick={() => setOpen(true)} title="Klavye kısayolları (?)" aria-label="Klavye kısayolları">
                ⌨︎
            </button>
            {open && (
                <div className="overlay" onClick={() => setOpen(false)}>
                    <div className="dialog" role="dialog" aria-label="Klavye kısayolları" onClick={(e) => e.stopPropagation()}>
                        <header>
                            <h2>Klavye kısayolları</h2>
                            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Kapat">✕</button>
                        </header>
                        <table className="kv">
                            <tbody>
                                {SHORTCUTS.map(([keys, desc]) => (
                                    <tr key={keys}>
                                        <th><kbd>{keys}</kbd></th>
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
