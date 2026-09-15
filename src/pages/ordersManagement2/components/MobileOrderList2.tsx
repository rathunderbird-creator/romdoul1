// Orders Management 2 — mobile card list (spec §9). A plain vertical list of
// order cards (no virtualization — order volumes here are small enough for a
// max-height scroll if the page ever needs one). Money totals are NOT
// computed here: SummaryStrip already derives them from the shared
// ../../utils/orderMoney selector, so this file only ever displays a given
// order's own fields.
import React, { useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import { D2, tabular, fmtMoney } from '../../dashboard2/theme';
import { MutedPill, AlertPill, ORDER_STATUS_TONE, PAY_STATUS_TONE } from '../ui2';
import { orderStatusOf, payStatusOf, orderBalance, trackingStateOf, type Order } from '../metrics';
import { DEFAULT_FILTERS, activeFilterCount, type OM2Filters } from '../urlFilters';
import { MobileSearchBar, MobileFilterDrawer, MobileChipGroup } from '../../../components/MobileFilterKit';
import { getOperatorForPhone } from '../../../utils/telecom';

const ORDER_STATUSES = ['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'ReStock'];
const PAY_STATUSES = ['Unpaid', 'Deposit', 'Paid', 'Get File', 'Cancel'];
const SEARCH_DEBOUNCE_MS = 250;

interface MobileOrderList2Props {
    orders: Order[];
    totalCount: number;
    filters: OM2Filters;
    onFiltersChange: (next: OM2Filters | ((prev: OM2Filters) => OM2Filters)) => void;
    onOpenOrder: (order: Order) => void;
    salesmen: string[];
    shippingCompanies: string[];
}

// A `string[]` filter field used here as a single-select chip group: clicking
// the already-active chip clears it, clicking another replaces it.
const toggleSingle = (current: string[], value: string): string[] =>
    current.length === 1 && current[0] === value ? [] : [value];

// Tracking cell (spec §4.4 rules, reused for the card's own line of pills):
// a saturated "no tracking" alert when missing, muted "own driver" text for
// the in-house courier, else a small courier + tracking number line.
const TrackingIndicator: React.FC<{ order: Order }> = ({ order }) => {
    const state = trackingStateOf(order);
    if (state === 'missing') {
        return <AlertPill icon={<Flag size={11} />} title="No tracking number added">No tracking</AlertPill>;
    }
    if (state === 'own-driver') {
        return <span style={{ fontSize: 11, fontWeight: 600, color: D2.muted }}>Own driver</span>;
    }
    const company = order.shipping?.company || '';
    const tracking = order.shipping?.trackingNumber || '';
    const text = company && tracking ? `${company} · ${tracking}` : (company || tracking || '—');
    return (
        <span
            className="om2-khmer"
            title={text}
            style={{ fontSize: 11, color: D2.muted, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle' }}
        >
            {text}
        </span>
    );
};

const OrderCard: React.FC<{ order: Order; onOpen: () => void }> = ({ order, onOpen }) => {
    const status = orderStatusOf(order);
    const pay = payStatusOf(order);
    const balance = orderBalance(order);
    const items = order.items;
    const firstItem = items[0];
    const extraCount = items.length - 1;
    const customerName = order.customer?.name || 'Unknown';
    const operator = getOperatorForPhone(order.customer?.phone);
    const productSummary = firstItem
        ? `${firstItem.name} x${firstItem.quantity}${extraCount > 0 ? ` +${extraCount} more` : ''}`
        : 'No items';

    return (
        <button
            type="button"
            onClick={onOpen}
            className="om2-tap-target om2-order-card-btn"
            style={{ all: 'unset', display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', boxSizing: 'border-box', background: D2.card, border: `1px solid ${D2.border}`, borderRadius: 11, padding: 12, marginBottom: 8 }}
        >
            {/* Row 1: customer name + total */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span
                    className="om2-khmer"
                    title={customerName}
                    style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: D2.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                    {customerName}
                </span>
                <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 700, color: D2.ink, ...tabular }}>{fmtMoney(order.total)}</span>
            </div>

            {/* Row 2: phone + owed */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: D2.muted, overflow: 'hidden' }}>
                    {operator?.logo && <img src={operator.logo} alt={operator.name} title={operator.name} style={{ width: 13, height: 13, objectFit: 'contain', borderRadius: 2, flexShrink: 0 }} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.customer?.phone || '—'}</span>
                </span>
                {balance > 0 ? (
                    <MutedPill tone="amber" style={{ flexShrink: 0, fontWeight: 700 }}>{fmtMoney(balance)}</MutedPill>
                ) : (
                    <span style={{ flexShrink: 0, fontSize: 12, color: D2.muted }}>—</span>
                )}
            </div>

            {/* Row 3: product summary */}
            <div className="om2-khmer" style={{ marginTop: 4, fontSize: 12, color: D2.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {productSummary}
            </div>

            {/* Row 4: pills, on their own line — never touching the name text */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                <MutedPill tone={ORDER_STATUS_TONE[status] || 'neutral'}>{status}</MutedPill>
                <MutedPill tone={PAY_STATUS_TONE[pay] || 'neutral'}>{pay === 'Get File' ? 'File' : pay}</MutedPill>
                <TrackingIndicator order={order} />
            </div>
        </button>
    );
};

const MobileOrderList2: React.FC<MobileOrderList2Props> = ({ orders, totalCount, filters, onFiltersChange, onOpenOrder, salesmen, shippingCompanies }) => {
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [searchInput, setSearchInput] = useState(filters.search);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Keep the local box in sync when the search is cleared from elsewhere
    // (e.g. removing the "Search: …" chip on the parent view).
    useEffect(() => { setSearchInput(filters.search); }, [filters.search]);
    useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

    const handleSearchChange = (value: string) => {
        setSearchInput(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            onFiltersChange(prev => ({ ...prev, search: value, page: 1 }));
        }, SEARCH_DEBOUNCE_MS);
    };

    // Clear resets everything the drawer controls back to defaults, but
    // leaves search/date/pageSize alone (those aren't drawer fields).
    const clearDrawerFilters = () => {
        onFiltersChange(prev => ({
            ...prev,
            statuses: DEFAULT_FILTERS.statuses,
            payStatuses: DEFAULT_FILTERS.payStatuses,
            shippingCos: DEFAULT_FILTERS.shippingCos,
            pages: DEFAULT_FILTERS.pages,
            salesman: DEFAULT_FILTERS.salesman,
            noTrackingOnly: DEFAULT_FILTERS.noTrackingOnly,
            sort: DEFAULT_FILTERS.sort,
            page: DEFAULT_FILTERS.page,
        }));
    };

    const remaining = totalCount - orders.length;

    return (
        <div>
            {/* A scoped focus ring for the card buttons — `all: unset` below
                clears the default outline, so this restores keyboard focus
                visibility without touching the shared stylesheet. */}
            <style>{'.om2-order-card-btn:focus-visible{outline:2px solid #2563eb;outline-offset:-2px;}'}</style>

            <MobileSearchBar
                searchValue={searchInput}
                onSearchChange={handleSearchChange}
                placeholder="Search customer, phone, product..."
                activeCount={activeFilterCount(filters)}
                onOpenFilter={() => setIsFilterOpen(true)}
            />

            <MobileFilterDrawer
                isOpen={isFilterOpen}
                onClose={() => setIsFilterOpen(false)}
                onClear={clearDrawerFilters}
                searchValue={searchInput}
                onSearchChange={handleSearchChange}
                searchPlaceholder="Search customer, phone, product..."
            >
                <MobileChipGroup
                    title="Status"
                    options={ORDER_STATUSES.map(s => ({ value: s }))}
                    selected={filters.statuses.length === 1 ? filters.statuses[0] : ''}
                    onSelect={(v) => onFiltersChange(prev => ({ ...prev, statuses: toggleSingle(prev.statuses, v), page: 1 }))}
                />
                <MobileChipGroup
                    title="Payment status"
                    options={PAY_STATUSES.map(s => ({ value: s }))}
                    selected={filters.payStatuses.length === 1 ? filters.payStatuses[0] : ''}
                    onSelect={(v) => onFiltersChange(prev => ({ ...prev, payStatuses: toggleSingle(prev.payStatuses, v), page: 1 }))}
                />
                {shippingCompanies.length > 0 && (
                    <MobileChipGroup
                        title="Shipping company"
                        options={shippingCompanies.map(s => ({ value: s }))}
                        selected={filters.shippingCos.length === 1 ? filters.shippingCos[0] : ''}
                        onSelect={(v) => onFiltersChange(prev => ({ ...prev, shippingCos: toggleSingle(prev.shippingCos, v), page: 1 }))}
                    />
                )}

                <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: D2.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                        Salesman
                    </div>
                    <select
                        className="om2-tap-target"
                        value={filters.salesman}
                        onChange={(e) => onFiltersChange(prev => ({ ...prev, salesman: e.target.value, page: 1 }))}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${D2.border}`, fontSize: 14, background: '#fff', color: D2.ink }}
                    >
                        <option value="">All</option>
                        {salesmen.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>

                <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: D2.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                        Tracking
                    </div>
                    <button
                        type="button"
                        className="om2-tap-target"
                        aria-pressed={filters.noTrackingOnly}
                        onClick={() => onFiltersChange(prev => ({ ...prev, noTrackingOnly: !prev.noTrackingOnly, page: 1 }))}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 16,
                            fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            border: `1px solid ${filters.noTrackingOnly ? D2.redLine : D2.border}`,
                            background: filters.noTrackingOnly ? D2.redBg : '#fff',
                            color: filters.noTrackingOnly ? D2.red : D2.ink,
                        }}
                    >
                        <Flag size={13} /> No tracking only
                    </button>
                </div>
            </MobileFilterDrawer>

            {orders.length === 0 ? (
                // Guard against the page-size/filter edge case where this
                // page is empty even though totalCount > 0 — the parent view
                // only renders EmptyState when totalCount itself is 0.
                <div style={{ textAlign: 'center', padding: '40px 16px', color: D2.muted, fontSize: 13 }}>
                    No orders on this page. Try loading more or adjusting filters.
                </div>
            ) : (
                <>
                    {orders.map(order => (
                        <OrderCard key={order.id} order={order} onOpen={() => onOpenOrder(order)} />
                    ))}
                    {remaining > 0 && (
                        <button
                            type="button"
                            className="om2-tap-target"
                            // page:1 too — growing pageSize only widens the fetch window
                            // from row 0 correctly when page is already 1; otherwise it
                            // would page from a stale, no-longer-page-1 offset.
                            onClick={() => onFiltersChange(prev => ({ ...prev, pageSize: prev.pageSize + 25, page: 1 }))}
                            style={{ width: '100%', padding: 12, borderRadius: 11, border: `1px solid ${D2.border}`, background: D2.card, color: D2.ink, fontWeight: 700, fontSize: 13, textAlign: 'center', cursor: 'pointer' }}
                        >
                            Load more ({remaining} remaining)
                        </button>
                    )}
                </>
            )}
        </div>
    );
};

export default MobileOrderList2;
