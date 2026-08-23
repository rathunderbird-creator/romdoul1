import React from 'react';
import { Search, Filter, X, RefreshCw, Plus } from 'lucide-react';

/**
 * Shared mobile building blocks (the pattern used by Orders Management and
 * Income & Expense): a compact stat card for 4-up rows, a slim sticky
 * search + filter (+ add) bar, a right-side filter drawer, and a chip group.
 */

// Compact stacked stat card — four of these fit on one phone row.
export const MiniStatCard: React.FC<{
    icon: React.ComponentType<{ size?: number }>;
    gradient: string;
    label: string;
    value: string;
    valueColor?: string;
}> = ({ icon: Icon, gradient, label, value, valueColor }) => (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px', minWidth: 0, borderRadius: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
            <div style={{ width: '20px', height: '20px', borderRadius: '6px', background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}><Icon size={11} /></div>
            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        </div>
        <div style={{ fontSize: '12px', fontWeight: 800, color: valueColor || 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
);

// Slim sticky bar: search + filter button (badge) + optional add button.
export const MobileSearchBar: React.FC<{
    searchValue: string;
    onSearchChange: (v: string) => void;
    placeholder?: string;
    activeCount: number;
    onOpenFilter: () => void;
    onAdd?: () => void;
    addDisabled?: boolean;
    extra?: React.ReactNode;
}> = ({ searchValue, onSearchChange, placeholder = 'Search...', activeCount, onOpenFilter, onAdd, addDisabled, extra }) => (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', position: 'sticky', top: 0, zIndex: 60, background: 'var(--color-bg)', padding: '4px 0' }}>
        <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input
                type="text"
                placeholder={placeholder}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: '12px', border: '1px solid var(--color-border)', fontSize: '14px', background: 'var(--color-surface)', color: 'var(--color-text-main)' }}
            />
        </div>
        <button
            onClick={onOpenFilter}
            style={{ position: 'relative', width: '42px', height: '42px', borderRadius: '12px', border: '1px solid var(--color-border)', background: activeCount > 0 ? 'var(--color-primary)' : 'var(--color-surface)', color: activeCount > 0 ? 'white' : 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
        >
            <Filter size={19} />
            {activeCount > 0 && (
                <span style={{ position: 'absolute', top: '-5px', right: '-5px', minWidth: '18px', height: '18px', borderRadius: '9px', background: '#EF4444', color: 'white', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{activeCount}</span>
            )}
        </button>
        {extra}
        {onAdd && (
            <button onClick={onAdd} disabled={addDisabled} className="primary-button" title="Add" style={{ width: '42px', height: '42px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, opacity: addDisabled ? 0.5 : 1 }}>
                <Plus size={22} />
            </button>
        )}
    </div>
);

// Right-side slide-in filter drawer with search + optional refresh on top,
// the children (chip groups / tools) in the middle, and Clear / Filter footer.
export const MobileFilterDrawer: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onClear: () => void;
    searchValue: string;
    onSearchChange: (v: string) => void;
    searchPlaceholder?: string;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    children: React.ReactNode;
}> = ({ isOpen, onClose, onClear, searchValue, onSearchChange, searchPlaceholder = 'Search...', onRefresh, isRefreshing, children }) => (
    <>
        {isOpen && (
            <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1199 }} />
        )}
        <div className="glass-panel" style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: '85%', maxWidth: '340px', zIndex: 1200,
            display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px',
            overflowY: 'auto', borderRadius: '16px 0 0 16px',
            background: 'var(--color-surface)',
            transform: isOpen ? 'translateX(0)' : 'translateX(105%)',
            transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: '-8px 0 30px rgba(0,0,0,0.18)'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Filter</h3>
                <button onClick={onClose} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={18} />
                </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                    <input
                        type="text"
                        placeholder={searchPlaceholder}
                        value={searchValue}
                        onChange={(e) => onSearchChange(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '14px', background: 'var(--color-bg)', color: 'var(--color-text-main)' }}
                    />
                </div>
                {onRefresh && (
                    <button onClick={onRefresh} title="Refresh" style={{ width: '40px', height: '40px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                        <RefreshCw size={17} style={isRefreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
                    </button>
                )}
            </div>

            {children}

            <div style={{ marginTop: 'auto', position: 'sticky', bottom: 0, background: 'var(--color-surface)', paddingTop: '12px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '10px' }}>
                <button onClick={onClear} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                    Clear
                </button>
                <button onClick={onClose} className="primary-button" style={{ flex: 1, padding: '12px', borderRadius: '12px', fontWeight: 600, fontSize: '14px' }}>
                    Filter
                </button>
            </div>
        </div>
    </>
);

// Single-select chip group (always expanded); options may carry a count.
export const MobileChipGroup: React.FC<{
    title: string;
    options: Array<{ value: string; label?: string; count?: number }>;
    selected: string;
    onSelect: (v: string) => void;
}> = ({ title, options, selected, onSelect }) => (
    <div>
        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>{title}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {options.map(opt => {
                const active = selected === opt.value;
                return (
                    <button
                        key={opt.value}
                        onClick={() => onSelect(opt.value)}
                        style={{ padding: '6px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, background: active ? 'var(--color-primary)' : 'var(--color-surface)', color: active ? 'white' : 'var(--color-text-main)', cursor: 'pointer', transition: 'all 0.15s', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                    >
                        {opt.label ?? opt.value}
                        {opt.count !== undefined && (
                            <span style={{ background: active ? 'rgba(255,255,255,0.25)' : 'var(--color-bg)', padding: '0 6px', borderRadius: '10px', fontSize: '10px', fontWeight: 700 }}>{opt.count}</span>
                        )}
                    </button>
                );
            })}
        </div>
    </div>
);
