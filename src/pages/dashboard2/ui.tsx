// Dashboard2 UI primitives — shared by every section component so the page
// reads as one system (spec §5 tiers, §6 interaction rules, §8 states).
import React, { useState, useCallback } from 'react';
import { ArrowUp, ArrowDown, ChevronsUpDown, ChevronDown, ChevronRight, TrendingUp, TrendingDown, AlertCircle, RefreshCw } from 'lucide-react';
import { D2, cardStyle, tabular, fmtPct, PASSIVE_OPACITY } from './theme';

// ─── Persistence helpers ──────────────────────────────────────────────────

const safeGet = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const safeSet = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

// Per-user (per-browser) remembered UI state: collapsed sections, active tab…
export function useLocalStorageState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
    const [value, setValue] = useState<T>(() => {
        const raw = safeGet(key);
        if (raw === null) return initial;
        try { return JSON.parse(raw) as T; } catch { return initial; }
    });
    const set = useCallback((v: T | ((prev: T) => T)) => {
        setValue(prev => {
            const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
            safeSet(key, JSON.stringify(next));
            return next;
        });
    }, [key]);
    return [value, set];
}

// ─── Cards ────────────────────────────────────────────────────────────────

export interface CardProps {
    children: React.ReactNode;
    style?: React.CSSProperties;
    // Tier-1 treatment: tinted background + 4px left accent (spec §5).
    accent?: { bg: string; line: string };
    // Renders as a <button> with hover lift + focus ring when given.
    onClick?: () => void;
    ariaLabel?: string;
    title?: string;
    className?: string;
    passive?: boolean; // tier 3: muted, opacity .42
}

export const Card: React.FC<CardProps> = ({ children, style, accent, onClick, ariaLabel, title, className, passive }) => {
    const base: React.CSSProperties = {
        ...cardStyle,
        padding: '14px 16px',
        display: 'block',
        width: '100%',
        minWidth: 0,
        ...(accent ? { background: accent.bg, borderLeft: `4px solid ${accent.line}` } : {}),
        ...(passive ? { opacity: PASSIVE_OPACITY } : {}),
        ...style,
    };
    if (onClick) {
        return (
            <button type="button" onClick={onClick} aria-label={ariaLabel} title={title} className={`d2-clickable ${className || ''}`} style={base}>
                {children}
            </button>
        );
    }
    return <div className={className} style={base} title={title}>{children}</div>;
};

// ─── Section header (collapsible, state remembered per user) ──────────────

export interface SectionHeaderProps {
    title: string;
    icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
    count?: number;
    extra?: React.ReactNode;    // right-side controls
    collapsed?: boolean;
    onToggle?: () => void;
    id?: string;                // aria-controls target
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, icon: Icon, count, extra, collapsed, onToggle, id }) => {
    const Chevron = collapsed ? ChevronRight : ChevronDown;
    const heading = (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {Icon && <Icon size={16} style={{ color: D2.muted }} />}
            <span style={{ fontSize: 14, fontWeight: 700, color: D2.ink }}>{title}</span>
            {count !== undefined && (
                <span style={{ ...tabular, fontSize: 11, fontWeight: 700, color: D2.muted, background: '#f1f3f6', borderRadius: 10, padding: '1px 8px' }}>{count}</span>
            )}
        </span>
    );
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, minHeight: 32 }}>
            {onToggle ? (
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={!collapsed}
                    aria-controls={id}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '4px 6px 4px 0', cursor: 'pointer', color: D2.ink }}
                >
                    <Chevron size={16} style={{ color: D2.muted }} />
                    {heading}
                </button>
            ) : heading}
            {extra && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{extra}</div>}
        </div>
    );
};

// ─── Small pieces ─────────────────────────────────────────────────────────

export const Chip: React.FC<{ children: React.ReactNode; color?: string; bg?: string; title?: string; style?: React.CSSProperties; dot?: string }> = ({ children, color = D2.muted, bg = '#f1f3f6', title, style, dot }) => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color, background: bg, whiteSpace: 'nowrap', lineHeight: 1.6, ...tabular, ...style }}>
        {dot && <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
        {children}
    </span>
);

// "▼ 44.8%" — null renders "—" (no previous figure). `suffix` carries the
// comparison label, e.g. "vs Sep 7 ($678.00)".
export const DeltaBadge: React.FC<{ value: number | null; suffix?: string; invert?: boolean }> = ({ value, suffix, invert }) => {
    if (value === null || !Number.isFinite(value)) {
        return <span style={{ fontSize: 11, color: D2.muted }} title="No previous figure to compare">— {suffix}</span>;
    }
    const up = value > 0;
    const flat = Math.abs(value) < 0.0005;
    // For metrics where up is bad (outstanding), invert the colouring.
    const good = flat ? null : (invert ? !up : up);
    const color = flat ? D2.muted : good ? D2.green : D2.red;
    const bg = flat ? '#f1f3f6' : good ? D2.greenBg : D2.redBg;
    const Icon = up ? TrendingUp : TrendingDown;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: D2.muted, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999, fontWeight: 700, color, background: bg, ...tabular }}>
                {!flat && <Icon size={12} aria-hidden />}
                <span aria-hidden>{flat ? '' : up ? '▲' : '▼'}</span> {fmtPct(Math.abs(value))}
            </span>
            {suffix && <span>{suffix}</span>}
        </span>
    );
};

export const Skeleton: React.FC<{ height?: number | string; width?: number | string; style?: React.CSSProperties }> = ({ height = 14, width = '100%', style }) => (
    <div className="d2-skeleton" aria-hidden style={{ height, width, ...style }} />
);

export const ErrorInline: React.FC<{ message: string; onRetry: () => void; retryLabel: string }> = ({ message, onRetry, retryLabel }) => (
    <div role="alert" style={{ ...cardStyle, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, background: D2.redBg, borderColor: '#fecaca', color: D2.red, fontSize: 13 }}>
        <AlertCircle size={16} aria-hidden />
        <span style={{ flex: 1 }}>{message}</span>
        <button type="button" onClick={onRetry} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: D2.red, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
            <RefreshCw size={13} aria-hidden /> {retryLabel}
        </button>
    </div>
);

export const EmptyState: React.FC<{ title: string; hint?: string; actionLabel?: string; onAction?: () => void; icon?: React.ReactNode }> = ({ title, hint, actionLabel, onAction, icon }) => (
    <div style={{ ...cardStyle, padding: '48px 24px', textAlign: 'center', color: D2.muted }}>
        {icon && <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', opacity: 0.5 }}>{icon}</div>}
        <div style={{ fontSize: 16, fontWeight: 700, color: D2.ink, marginBottom: 6 }}>{title}</div>
        {hint && <div style={{ fontSize: 13, marginBottom: 16 }}>{hint}</div>}
        {actionLabel && onAction && (
            <button type="button" onClick={onAction} className="primary-button" style={{ padding: '10px 18px', borderRadius: 10, fontWeight: 600 }}>{actionLabel}</button>
        )}
    </div>
);

// ─── Sortable table ───────────────────────────────────────────────────────

export interface Column<T> {
    key: string;
    header: React.ReactNode;
    align?: 'left' | 'right' | 'center';
    width?: number | string;
    sortValue?: (row: T) => number | string | null;  // omit → not sortable
    render: (row: T) => React.ReactNode;
    khmer?: boolean;   // cell may contain Khmer text → taller line-height
    minWidth?: number;
}

export interface SortState { key: string; direction: 'asc' | 'desc' }

export interface SortableTableProps<T> {
    columns: Column<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    sort: SortState | null;
    onSort: (next: SortState | null) => void;
    onRowClick?: (row: T) => void;
    rowLabel?: (row: T) => string;   // aria-label for clickable rows
    emptyText: string;
    caption?: string;                // visually hidden table caption
    maxHeight?: number;
}

const srOnly: React.CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 };

export function sortRows<T>(rows: T[], columns: Column<T>[], sort: SortState | null): T[] {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col || !col.sortValue) return rows;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const va = col.sortValue!(a), vb = col.sortValue!(b);
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
    });
}

export function SortableTable<T>({ columns, rows, rowKey, sort, onSort, onRowClick, rowLabel, emptyText, caption, maxHeight }: SortableTableProps<T>) {
    const sorted = sortRows(rows, columns, sort);
    const toggle = (key: string) => {
        if (!sort || sort.key !== key) onSort({ key, direction: 'desc' });
        else if (sort.direction === 'desc') onSort({ key, direction: 'asc' });
        else onSort(null);
    };
    return (
        <div className="d2-table-wrap" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
            <table className="d2-table">
                {caption && <caption style={srOnly}>{caption}</caption>}
                <thead>
                    <tr>
                        {columns.map(col => {
                            const active = sort?.key === col.key;
                            const ariaSort = active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none';
                            return (
                                <th key={col.key} scope="col" aria-sort={col.sortValue ? ariaSort : undefined} style={{ textAlign: col.align || 'left', width: col.width, minWidth: col.minWidth }}>
                                    {col.sortValue ? (
                                        <button type="button" onClick={() => toggle(col.key)} title="Sort" style={{ color: active ? D2.blue : undefined, justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start', width: '100%' }}>
                                            {col.header}
                                            {active ? (sort!.direction === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />) : <ChevronsUpDown size={12} aria-hidden style={{ opacity: 0.35 }} />}
                                        </button>
                                    ) : col.header}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {sorted.length === 0 ? (
                        <tr><td colSpan={columns.length} style={{ textAlign: 'center', color: D2.muted, padding: '20px 10px' }}>{emptyText}</td></tr>
                    ) : sorted.map(row => {
                        const clickable = !!onRowClick;
                        // Plain <tr>, not role="button": a button role demotes the <td>s
                        // out of the accessibility tree's row/cell structure, and an
                        // aria-label on the row would replace every cell's announced
                        // value with just that label. Keyboard/mouse activation still
                        // works via tabIndex + click/Enter/Space; the row's title carries
                        // the same context as a hover tooltip.
                        return (
                            <tr
                                key={rowKey(row)}
                                className={clickable ? 'd2-row-clickable' : undefined}
                                tabIndex={clickable ? 0 : undefined}
                                title={clickable && rowLabel ? rowLabel(row) : undefined}
                                onClick={clickable ? () => onRowClick!(row) : undefined}
                                onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick!(row); } } : undefined}
                            >
                                {columns.map(col => (
                                    <td key={col.key} className={col.khmer ? 'd2-khmer' : undefined} style={{ textAlign: col.align || 'left', ...tabular }}>
                                        {col.render(row)}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// Status chips row ("Shipped 18 · Delivered 3"), always its own line (spec §5).
// `label` localises a status name; without it the raw key is shown.
export const StatusChips: React.FC<{ counts: Record<string, number>; colors: Record<string, string>; order?: string[]; label?: (key: string) => string }> = ({ counts, colors, order, label }) => {
    const keys = order ? order.filter(k => counts[k]) .concat(Object.keys(counts).filter(k => !order.includes(k))) : Object.keys(counts);
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {keys.filter(k => counts[k] > 0).map(k => (
                <Chip key={k} dot={colors[k] || D2.muted} title={label ? label(k) : k}>
                    <span className="d2-khmer">{label ? label(k) : k}</span> {counts[k]}
                </Chip>
            ))}
        </div>
    );
};
