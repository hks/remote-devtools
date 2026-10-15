import type {UiModule} from '../modules/registry.ts';
import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';

export function TabBar({modules, active}: {modules: UiModule[]; active: string}) {
    const setActiveTab = useDevtoolsStore((s) => s.setActiveTab);

    return (
        <div className="tabbar" role="tablist">
            {modules.map((module, i) => (
                <button
                    type="button"
                    key={module.id}
                    role="tab"
                    aria-selected={active === module.id}
                    className={`tab${active === module.id ? ' is-active' : ''}`}
                    title={i < 9 ? `${module.title} (${i + 1})` : module.title}
                    onClick={() => setActiveTab(module.id)}
                >
                    {module.icon} {module.title}
                </button>
            ))}
        </div>
    );
}
