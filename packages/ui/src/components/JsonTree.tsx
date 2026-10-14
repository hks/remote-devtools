import {memo, useState} from 'react';

/** Items beyond this count are revealed via "show more" (avoids bloating the DOM for large lists). */
const PAGE_SIZE = 100;
/** Strings longer than this are truncated. */
const MAX_STRING = 300;

type NodeProps = {
    name: string | number | null;
    value: unknown;
    depth: number;
    defaultExpandDepth: number;
    isLast: boolean;
};

function Primitive({value}: {value: unknown}) {
    const [expanded, setExpanded] = useState(false);

    if (value === null) return <span className="jt-null">null</span>;
    if (value === undefined) return <span className="jt-null">undefined</span>;
    if (typeof value === 'number') return <span className="jt-number">{value}</span>;
    if (typeof value === 'boolean') return <span className="jt-bool">{String(value)}</span>;

    const text = String(value);
    if (text.length <= MAX_STRING || expanded) {
        return <span className="jt-string">"{text}"</span>;
    }
    return (
        <span className="jt-string">
            "{text.slice(0, MAX_STRING)}
            <button className="jt-more" onClick={() => setExpanded(true)}>
                … +{text.length - MAX_STRING} chars
            </button>
            "
        </span>
    );
}

const JsonNode = memo(function JsonNode({name, value, depth, defaultExpandDepth, isLast}: NodeProps) {
    const isArray = Array.isArray(value);
    const isObject = value !== null && typeof value === 'object';
    const [open, setOpen] = useState(depth < defaultExpandDepth);
    const [visible, setVisible] = useState(PAGE_SIZE);

    const label = name === null ? null : (
        <>
            <span className={typeof name === 'number' ? 'jt-index' : 'jt-key'}>{typeof name === 'number' ? name : `"${name}"`}</span>
            <span className="jt-punct">: </span>
        </>
    );
    const comma = isLast ? null : <span className="jt-punct">,</span>;

    if (!isObject) {
        return (
            <div className="jt-row">
                {label}
                <Primitive value={value}/>
                {comma}
            </div>
        );
    }

    const entries: [string | number, unknown][] = isArray
        ? (value as unknown[]).map((v, i) => [i, v])
        : Object.entries(value as Record<string, unknown>);
    const [openBracket, closeBracket] = isArray ? ['[', ']'] : ['{', '}'];

    if (entries.length === 0) {
        return (
            <div className="jt-row">
                {label}
                <span className="jt-punct">{openBracket}{closeBracket}</span>
                {comma}
            </div>
        );
    }

    return (
        <div className="jt-node">
            <button className="jt-row jt-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                <span className="jt-caret">{open ? '▾' : '▸'}</span>
                {label}
                <span className="jt-punct">{openBracket}</span>
                {!open && (
                    <>
                        <span className="jt-summary">{isArray ? `${entries.length} items` : `${entries.length} keys`}</span>
                        <span className="jt-punct">{closeBracket}</span>
                        {comma}
                    </>
                )}
            </button>
            {open && (
                <>
                    <div className="jt-children">
                        {entries.slice(0, visible).map(([key, child], i) => (
                            <JsonNode
                                key={String(key)}
                                name={key}
                                value={child}
                                depth={depth + 1}
                                defaultExpandDepth={defaultExpandDepth}
                                isLast={i === entries.length - 1}
                            />
                        ))}
                        {entries.length > visible && (
                            <button className="jt-more" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                                … show {entries.length - visible} more
                            </button>
                        )}
                    </div>
                    <div className="jt-row">
                        <span className="jt-punct">{closeBracket}</span>
                        {comma}
                    </div>
                </>
            )}
        </div>
    );
});

export function JsonTree({value, defaultExpandDepth = 2}: {value: unknown; defaultExpandDepth?: number}) {
    return (
        <div className="json-tree">
            <JsonNode name={null} value={value} depth={0} defaultExpandDepth={defaultExpandDepth} isLast/>
        </div>
    );
}
