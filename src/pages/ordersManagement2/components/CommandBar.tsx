// Orders Management 2 — the single sticky command row (spec §4.1): title,
// search, date range, Filters/Columns popovers, refresh/export/new-order.
// Pure and stateless w.r.t. filters — every change flows out through
// onFiltersChange so the URL (via useUrlFilters in ui2.tsx) stays the single
// source of truth.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Filter, Columns3, RefreshCw, Download, Plus } from 'lucide-react';
import { DateRangePicker } from '../../../components';
import { D2, cardStyle, tabular } from '../../dashboard2/theme';
import type { OM2Filters } from '../urlFilters';
import type { Translate } from '../types';

interface CommandBarProps {
    filters: OM2Filters;
    onFiltersChange: (next: OM2Filters | ((prev: OM2Filters) => OM2Filters)) => void;
    onRefresh: () => void;
    onNewOrder: () => void;
    onExport: () => void;
    refreshing: boolean;
    salesmen: string[];
    shippingCompanies: string[];
    pageSources: string[];
    columnLabels: Record<string, string>;
    visibleColumns: string[];
    onVisibleColumnsChange: (cols: string[]) => void;
    t: Translate;
    isMobile: boolean;
}

const ORDER_STATUS_OPTIONS = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Drafted', 'Cancelled', 'Returned'];
const PAY_STATUS_OPTIONS = ['Unpaid', 'Deposit', 'Paid', 'Cancel', 'Get File'];
type ArrayFilterKey = 'statuses' | 'payStatuses' | 'shippingCos' | 'pages';

// `t()` falls back to the raw key when a translation is missing (see
// LanguageContext), so a caller-supplied `fallback` keeps the bar readable
// for keys this page hasn't had strings added for yet.
const tr = (t: Translate, key: string, fallback: string): string => {
    const v = t(key);
    return v && v !== key ? v : fallback;
};

// A click/Escape outside `refs` closes the popover. `refs` and `onClose` are
// read from the closure at the moment `open` flips true, which is fine since
// both are stable across renders (state setters, and ref objects themselves
// never change identity) — only the wrapping array literal is recreated, so
// it's deliberately left out of the dependency list.
const useOutsideClose = (open: boolean, refs: Array<{ current: HTMLElement | null }>, onClose: () => void): void => {
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (refs.some(r => r.current?.contains(target))) return;
            onClose();
        };
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
};

const popoverStyle: React.CSSProperties = {
    ...cardStyle,
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    width: 'min(320px, 92vw)',
    padding: 14,
    zIndex: 100,
};

const groupLabelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: D2.muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
};

const FilterGroup: React.FC<{ label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; scroll?: boolean }> = ({ label, options, selected, onToggle, scroll }) => (
    <div style={{ marginBottom: 12 }}>
        <div style={groupLabelStyle}>{label}</div>
        {options.length === 0 ? (
            <div style={{ fontSize: 12, color: D2.muted }}>—</div>
        ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...(scroll ? { maxHeight: 160, overflowY: 'auto' as const } : {}) }}>
                {options.map(opt => (
                    <label key={opt} className="om2-khmer" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: D2.ink, cursor: 'pointer', minWidth: 0 }}>
                        <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={opt}>{opt}</span>
                    </label>
                ))}
            </div>
        )}
    </div>
);

interface BarButtonProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    iconOnly: boolean;
    badge?: number;
    primary?: boolean;
    hasPopup?: boolean;
    expanded?: boolean;
    innerRef?: React.RefObject<HTMLButtonElement | null>;
}

const BarButton: React.FC<BarButtonProps> = ({ icon, label, onClick, iconOnly, badge, primary, hasPopup, expanded, innerRef }) => (
    <button
        ref={innerRef}
        type="button"
        onClick={onClick}
        title={label}
        aria-label={iconOnly ? label : undefined}
        aria-haspopup={hasPopup ? 'true' : undefined}
        aria-expanded={hasPopup ? expanded : undefined}
        className={`${primary ? 'primary-button ' : ''}d2-clickable om2-tap-target`}
        style={{
            position: 'relative',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            height: 38,
            padding: iconOnly ? 0 : '0 12px',
            width: iconOnly ? 38 : undefined,
            borderRadius: 10,
            border: primary ? 'none' : `1px solid ${D2.border}`,
            background: primary ? undefined : D2.card,
            color: primary ? undefined : D2.ink,
            fontSize: 13, fontWeight: primary ? 700 : 600,
            cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
        }}
    >
        {icon}
        {!iconOnly && label}
        {!!badge && (
            <span
                aria-hidden
                style={{
                    ...tabular,
                    position: iconOnly ? 'absolute' : 'static',
                    top: iconOnly ? -4 : undefined, right: iconOnly ? -4 : undefined,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
                    background: D2.blue, color: '#fff', fontSize: 10, fontWeight: 700,
                }}
            >
                {badge}
            </span>
        )}
    </button>
);

const CommandBar: React.FC<CommandBarProps> = ({
    filters, onFiltersChange, onRefresh, onNewOrder, onExport, refreshing,
    salesmen, shippingCompanies, pageSources, columnLabels, visibleColumns, onVisibleColumnsChange, t, isMobile,
}) => {
    const [searchValue, setSearchValue] = useState(filters.search);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [filtersOpen, setFiltersOpen] = useState(false);
    const [columnsOpen, setColumnsOpen] = useState(false);
    const filtersButtonRef = useRef<HTMLButtonElement>(null);
    const filtersPopoverRef = useRef<HTMLDivElement>(null);
    const columnsButtonRef = useRef<HTMLButtonElement>(null);
    const columnsPopoverRef = useRef<HTMLDivElement>(null);

    // The URL (or a "Clear all" chip / status-segment click) can change
    // filters.search out from under us — keep the input in sync either way.
    useEffect(() => { setSearchValue(filters.search); }, [filters.search]);

    useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

    const closeFilters = useCallback(() => setFiltersOpen(false), []);
    const closeColumns = useCallback(() => setColumnsOpen(false), []);
    useOutsideClose(filtersOpen, [filtersButtonRef, filtersPopoverRef], closeFilters);
    useOutsideClose(columnsOpen, [columnsButtonRef, columnsPopoverRef], closeColumns);

    const toggleFiltersOpen = useCallback(() => { setFiltersOpen(o => !o); setColumnsOpen(false); }, []);
    const toggleColumnsOpen = useCallback(() => { setColumnsOpen(o => !o); setFiltersOpen(false); }, []);

    // '/' focuses search unless the user is already typing somewhere else.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
            const active = document.activeElement as HTMLElement | null;
            const tag = active?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return;
            e.preventDefault();
            searchInputRef.current?.focus();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setSearchValue(v);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            onFiltersChange(prev => ({ ...prev, search: v, page: 1 }));
        }, 250);
    };

    const handleDateChange = useCallback((range: { start: string; end: string }) => {
        onFiltersChange(prev => ({ ...prev, dateStart: range.start, dateEnd: range.end, page: 1 }));
    }, [onFiltersChange]);

    const toggleArrayFilter = useCallback((key: ArrayFilterKey, value: string) => {
        onFiltersChange(prev => ({
            ...prev,
            [key]: prev[key].includes(value) ? prev[key].filter(v => v !== value) : [...prev[key], value],
            page: 1,
        }));
    }, [onFiltersChange]);

    const handleSalesmanChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        onFiltersChange(prev => ({ ...prev, salesman: e.target.value, page: 1 }));
    };

    const clearFilters = useCallback(() => {
        onFiltersChange(prev => ({
            ...prev, statuses: [], payStatuses: [], shippingCos: [], pages: [], salesman: '', noTrackingOnly: false, page: 1,
        }));
    }, [onFiltersChange]);

    const toggleColumn = (key: string) => {
        if (key === 'actions') return; // actions column always stays visible
        const next = visibleColumns.includes(key) ? visibleColumns.filter(c => c !== key) : [...visibleColumns, key];
        onVisibleColumnsChange(next);
    };

    const extraFilterCount = filters.statuses.length + filters.payStatuses.length + filters.shippingCos.length
        + filters.pages.length + (filters.salesman ? 1 : 0) + (filters.noTrackingOnly ? 1 : 0);

    const titleText = tr(t, 'dashboard2.orders', 'Orders');
    const searchPlaceholder = tr(t, 'ordersManagement2.commandBar.searchPlaceholder', 'Search customer, phone, product, tracking ID, remark...');
    const dateRangeLabel = tr(t, 'dashboard2.dateRange', 'Date range');
    const filtersLabel = tr(t, 'ordersManagement2.commandBar.filters', 'Filters');
    const columnsLabel = tr(t, 'ordersManagement2.commandBar.columns', 'Columns');
    const refreshLabel = tr(t, 'dashboard2.refresh', 'Refresh');
    const exportLabel = tr(t, 'common.export', 'Export');
    const newOrderLabel = tr(t, 'dashboard2.newOrder', 'New Order');
    const clearFiltersLabel = tr(t, 'ordersManagement2.commandBar.clearFilters', 'Clear filters');
    const allLabel = tr(t, 'common.all', 'All');

    const refreshButton = (
        <button
            type="button"
            onClick={onRefresh}
            title={refreshLabel}
            aria-label={refreshLabel}
            aria-busy={refreshing}
            className="d2-clickable om2-tap-target"
            style={{ width: 38, height: 38, borderRadius: 10, border: `1px solid ${D2.border}`, background: D2.card, color: D2.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
            <RefreshCw size={16} className={refreshing ? 'd2-spin' : undefined} aria-hidden />
        </button>
    );

    const filtersButton = (
        <BarButton
            innerRef={filtersButtonRef}
            icon={<Filter size={14} aria-hidden />}
            label={filtersLabel}
            onClick={toggleFiltersOpen}
            iconOnly={isMobile}
            badge={extraFilterCount}
            hasPopup
            expanded={filtersOpen}
        />
    );

    const columnsButton = (
        <BarButton
            innerRef={columnsButtonRef}
            icon={<Columns3 size={14} aria-hidden />}
            label={columnsLabel}
            onClick={toggleColumnsOpen}
            iconOnly={isMobile}
            hasPopup
            expanded={columnsOpen}
        />
    );

    const exportButton = <BarButton icon={<Download size={14} aria-hidden />} label={exportLabel} onClick={onExport} iconOnly={isMobile} />;
    const newOrderButton = <BarButton icon={<Plus size={16} aria-hidden />} label={newOrderLabel} onClick={onNewOrder} iconOnly={isMobile} primary />;

    return (
        <div
            style={{
                ...cardStyle,
                borderRadius: 11,
                padding: '10px 12px',
                position: 'sticky',
                top: 0,
                zIndex: 60,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: isMobile ? 'wrap' : 'nowrap',
            }}
        >
            {!isMobile && (
                <span style={{ fontSize: 14, fontWeight: 700, color: D2.ink, whiteSpace: 'nowrap', flexShrink: 0 }}>{titleText}</span>
            )}

            {/* On mobile, MobileOrderList2 renders its own search bar (reusing
                the shared MobileSearchBar component) bound to the same
                filters.search — this input would just be a second, redundant
                one stacked above it. */}
            {!isMobile && (
                <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
                    <Search size={14} aria-hidden style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: D2.muted, pointerEvents: 'none' }} />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchValue}
                        onChange={handleSearchChange}
                        placeholder={searchPlaceholder}
                        aria-label={searchPlaceholder}
                        style={{ width: '100%', height: 36, paddingLeft: 32, paddingRight: 10, borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, background: '#fff', color: D2.ink }}
                    />
                </div>
            )}

            {!isMobile && (
                <>
                    <div style={{ width: 220, flexShrink: 0 }} title={dateRangeLabel}>
                        <DateRangePicker value={{ start: filters.dateStart, end: filters.dateEnd }} onChange={handleDateChange} />
                    </div>
                    {filtersButton}
                    {columnsButton}
                    {refreshButton}
                    {exportButton}
                    {newOrderButton}
                </>
            )}

            {isMobile && (
                <div style={{ display: 'flex', gap: 8, flex: '1 1 100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
                    <div style={{ width: 44, flexShrink: 0 }} title={dateRangeLabel}>
                        <DateRangePicker value={{ start: filters.dateStart, end: filters.dateEnd }} onChange={handleDateChange} compact className="om2-tap-target" />
                    </div>
                    {filtersButton}
                    {columnsButton}
                    {refreshButton}
                    {exportButton}
                    {newOrderButton}
                </div>
            )}

            {filtersOpen && (
                <div ref={filtersPopoverRef} role="dialog" aria-label={filtersLabel} style={popoverStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: D2.ink }}>{filtersLabel}</span>
                        <button type="button" onClick={clearFilters} style={{ background: 'none', border: 'none', color: D2.blue, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '2px 4px' }}>
                            {clearFiltersLabel}
                        </button>
                    </div>
                    <FilterGroup label="Order status" options={ORDER_STATUS_OPTIONS} selected={filters.statuses} onToggle={v => toggleArrayFilter('statuses', v)} />
                    <FilterGroup label="Payment status" options={PAY_STATUS_OPTIONS} selected={filters.payStatuses} onToggle={v => toggleArrayFilter('payStatuses', v)} />
                    <FilterGroup label="Shipping company" options={shippingCompanies} selected={filters.shippingCos} onToggle={v => toggleArrayFilter('shippingCos', v)} scroll />
                    <FilterGroup label="Pages" options={pageSources} selected={filters.pages} onToggle={v => toggleArrayFilter('pages', v)} scroll />
                    <div>
                        <div style={groupLabelStyle}>Salesman</div>
                        <select
                            value={filters.salesman}
                            onChange={handleSalesmanChange}
                            style={{ width: '100%', height: 32, borderRadius: 8, border: `1px solid ${D2.border}`, fontSize: 13, color: D2.ink, background: '#fff', padding: '0 8px' }}
                        >
                            <option value="">{allLabel}</option>
                            {salesmen.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                </div>
            )}

            {columnsOpen && (
                <div ref={columnsPopoverRef} role="dialog" aria-label={columnsLabel} style={popoverStyle}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: D2.ink, marginBottom: 10 }}>{columnsLabel}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                        {Object.keys(columnLabels).map(key => {
                            const isActions = key === 'actions';
                            const checked = isActions || visibleColumns.includes(key);
                            return (
                                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: isActions ? D2.muted : D2.ink, cursor: isActions ? 'default' : 'pointer' }}>
                                    <input type="checkbox" checked={checked} disabled={isActions} onChange={() => toggleColumn(key)} />
                                    <span>{columnLabels[key]}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CommandBar;
