import {type TabId, useDevtoolsStore} from '../store/useDevtoolsStore.ts';

const TABS: {id: TabId; title: string; disabledHint?: string}[] = [
    {id: 'logs', title: '📜 Logs'},
    {id: 'serviceRequests', title: '🛎️ Service Requests'},
    {id: 'functions', title: '🧩 Functions'},
];

export function TabBar() {
    const activeTab = useDevtoolsStore((s) => s.activeTab);
    const setActiveTab = useDevtoolsStore((s) => s.setActiveTab);

    return (
        <nav className="tabbar" role="tablist">
            {TABS.map((tab) => (
                <button
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={`tab${activeTab === tab.id ? ' is-active' : ''}`}
                    disabled={Boolean(tab.disabledHint)}
                    title={tab.disabledHint ? `${tab.disabledHint}'te eklenecek` : undefined}
                    onClick={() => setActiveTab(tab.id)}
                >
                    {tab.title}
                    {tab.disabledHint && <span className="tab-hint">{tab.disabledHint}</span>}
                </button>
            ))}
        </nav>
    );
}
