// Dev-only preview: open http://localhost:5173/dev/ordersManagement2.html
// while `npm run dev` is running.
//
// Mounts the pure OM2View (../pages/ordersManagement2/OrdersManagement2View)
// with fixture data (./ordersManagement2-fixtures) so the page can be
// checked in a browser without logging in — no auth, no store, no Supabase.
// A slim grey bar on top switches scenarios / language / mobile layout and
// echoes the last `actions.*` call the view made. Not part of the
// production build (Vite only builds index.html).
//
// OM2View reads filters from a `filters` prop rather than the URL — only the
// real page container's useUrlFilters hook (../pages/ordersManagement2/ui2)
// touches the URL — so this harness keeps its own filters state and applies
// them client-side over the fixtures, mirroring (loosely — this doesn't need
// to be exhaustive) the server-side filtering in
// ../pages/ordersManagement2/useOrdersM2Data.ts.
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../index.css';
import ErrorBoundary from '../components/ErrorBoundary';
import { LanguageProvider, useLanguage } from '../context/LanguageContext';
import { StoreContext } from '../context/StoreContext';
import OM2View from '../pages/ordersManagement2/OrdersManagement2View';
import { DEFAULT_FILTERS, type OM2Filters } from '../pages/ordersManagement2/urlFilters';
import { sortOrders, orderStatusOf, payStatusOf, isMissingTracking, type Order } from '../pages/ordersManagement2/metrics';
import type { OM2Actions, OM2Data, OrderEdit, SectionError } from '../pages/ordersManagement2/types';
import { fixtureOrders } from './ordersManagement2-fixtures';

// ─── Columns (spec: re-declared locally rather than imported from the page
// container, so the preview stays decoupled from OrdersManagement2Page.tsx —
// copied verbatim from its DEFAULT_VISIBLE_COLUMNS / COLUMN_LABELS). ───────

const DEFAULT_VISIBLE_COLUMNS = ['customer', 'product', 'total', 'owed', 'status', 'payStatus', 'courier', 'time', 'actions'];
const COLUMN_LABELS: Record<string, string> = {
    customer: 'Customer', product: 'Product', total: 'Total', owed: 'Owed', status: 'Order status',
    payStatus: 'Payment', courier: 'Courier / tracking', time: 'Time', actions: 'Actions',
    address: 'Address', page: 'Page', customerCare: 'Customer care', payBy: 'Pay by',
    received: 'Received', settledDate: 'Settled date', lastEditBy: 'Last edited by', remark: 'Remark',
    salesman: 'Salesman',
};

// ─── Dropdown option lists (spec: "salesmen/shippingCompanies/pageSources
// from the fixtures file") — derived from fixtureOrders itself rather than
// depending on separate named exports from ordersManagement2-fixtures.ts
// (that file wasn't written yet when this preview was authored — see the
// note in the final summary). Deriving from the orders that actually exist
// keeps this preview self-contained regardless of what that file ends up
// exporting. ─────────────────────────────────────────────────────────────

const uniqueSorted = (values: Array<string | undefined>): string[] =>
    Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== ''))).sort();

const FIXTURE_SALESMEN = uniqueSorted(fixtureOrders.map(o => o.salesman));
const FIXTURE_SHIPPING_COMPANIES = uniqueSorted(fixtureOrders.map(o => o.shipping?.company));
const FIXTURE_PAGE_SOURCES = uniqueSorted(fixtureOrders.map(o => o.pageSource));
const FIXTURE_CUSTOMER_CARE = uniqueSorted(fixtureOrders.map(o => o.customerCare));
const FIXTURE_PAYMENT_METHODS = uniqueSorted(fixtureOrders.map(o => o.paymentMethod));

// ─── Client-side filtering (loosely mirrors useOrdersM2Data.ts's applyFilters) ─

const localDay = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const matchesSearch = (o: Order, term: string): boolean => {
    const q = term.trim().toLowerCase();
    if (!q) return true;
    const haystacks = [
        o.customer?.name, o.customer?.phone, o.shipping?.trackingNumber, o.remark, o.salesman,
        ...o.items.map(it => it.name),
    ];
    return haystacks.some(h => (h || '').toLowerCase().includes(q));
};

const applyFiltersLocal = (orders: Order[], f: OM2Filters): Order[] =>
    orders.filter(o => {
        if (f.dateStart && localDay(o.date) < f.dateStart) return false;
        if (f.dateEnd && localDay(o.date) > f.dateEnd) return false;
        if (f.statuses.length && !f.statuses.includes(orderStatusOf(o))) return false;
        if (f.payStatuses.length && !f.payStatuses.includes(payStatusOf(o))) return false;
        if (f.shippingCos.length && !f.shippingCos.includes(o.shipping?.company || '')) return false;
        if (f.pages.length && !f.pages.includes(o.pageSource || '')) return false;
        if (f.salesman && o.salesman !== f.salesman) return false;
        if (f.noTrackingOnly && !isMissingTracking(o)) return false;
        if (!matchesSearch(o, f.search)) return false;
        return true;
    });

// ─── Scenarios ────────────────────────────────────────────────────────────

type Scenario = 'normal' | 'loading' | 'empty' | 'error';
const SCENARIOS: Scenario[] = ['normal', 'loading', 'empty', 'error'];

// ─── Preview ──────────────────────────────────────────────────────────────

// BulkEditModal (rendered by OM2View when its own bulk-edit action is open)
// calls useStore() unconditionally, unlike everything else this preview
// touches — so unlike the rest of this harness, that one modal needs a
// minimal store value to render at all. Everything else in OM2View still
// only reads its own props, not this context.
const mockStore = { paymentMethods: ['Cash', 'Card', 'QR', 'Bank Transfer', 'COD'] } as any;

const devBarStyle = {
    display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 10,
    padding: '6px 12px', background: '#e5e7eb', color: '#374151',
    fontSize: 12, fontFamily: 'system-ui, sans-serif', borderBottom: '1px solid #d1d5db',
};

const controlStyle = { fontSize: 12, padding: '2px 6px', borderRadius: 6, border: '1px solid #9ca3af', background: '#fff' };

const Preview = () => {
    const { t, language, setLanguage } = useLanguage();
    const [scenario, setScenario] = useState<Scenario>('normal');
    const [filters, setFilters] = useState<OM2Filters>(DEFAULT_FILTERS);
    const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    const [lastAction, setLastAction] = useState('—');

    // Follow the viewport like the app's useMobile does; the checkbox can still override it.
    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const rangeOrders = useMemo<Order[]>(() => {
        if (scenario === 'empty') return [];
        return sortOrders(applyFiltersLocal(fixtureOrders, filters), filters.sort);
    }, [scenario, filters]);

    const orders = useMemo<Order[]>(() => {
        const start = (filters.page - 1) * filters.pageSize;
        return rangeOrders.slice(start, start + filters.pageSize);
    }, [rangeOrders, filters.page, filters.pageSize]);

    const data = useMemo<OM2Data>(() => ({
        orders,
        totalCount: rangeOrders.length,
        rangeOrders,
        products: [],
        now: new Date('2026-09-08T18:00:00+07:00'),
    }), [orders, rangeOrders]);

    const actions = useMemo<OM2Actions>(() => {
        const log = (name: string, payload?: unknown) =>
            setLastAction(payload === undefined ? name : `${name} ${JSON.stringify(payload)}`);
        return {
            onFiltersChange: setFilters,
            onRefresh: () => log('refresh'),
            onNewOrder: () => log('newOrder'),
            onExport: () => log('export'),
            onSaveEdit: (edit: OrderEdit) => { log('saveEdit', edit); return Promise.resolve(); },
            onUndoEdit: (edit: OrderEdit, previous: OrderEdit) => { log('undoEdit', { edit, previous }); return Promise.resolve(); },
            onBulkAddTracking: (updates) => { log('bulkAddTracking', updates); return Promise.resolve(); },
            onBulkMarkShipped: (orderIds) => { log('bulkMarkShipped', orderIds); return Promise.resolve(); },
            onBulkPrint: (orderIds) => log('bulkPrint', orderIds),
            onBulkExport: (orderIds) => log('bulkExport', orderIds),
            onBulkEdit: (orderIds, field, value, settleDate, payBy) => { log('bulkEdit', { orderIds, field, value, settleDate, payBy }); return Promise.resolve(); },
        };
    }, []);

    const error: SectionError = { message: 'network timeout', retry: () => setScenario('normal') };

    return (
        <MemoryRouter>
          <StoreContext.Provider value={mockStore}>
            <div style={devBarStyle}>
                <strong>Orders Management 2 preview</strong>
                <label>
                    scenario{' '}
                    <select value={scenario} onChange={e => setScenario(e.target.value as Scenario)} style={controlStyle}>
                        {SCENARIOS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </label>
                <button
                    type="button"
                    onClick={() => setLanguage(language === 'en' ? 'km' : 'en')}
                    title="Switch language"
                    style={{ ...controlStyle, cursor: 'pointer' }}
                >
                    {language === 'en' ? 'ខ្មែរ' : 'EN'}
                </button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={isMobile} onChange={e => setIsMobile(e.target.checked)} />
                    isMobile
                </label>
                <span style={{ color: '#6b7280' }}>{rangeOrders.length} of {fixtureOrders.length} fixture orders match</span>
                <span style={{ marginLeft: 'auto', minWidth: 0, maxWidth: '60%', display: 'inline-flex', gap: 4 }}>
                    <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>last action:</span>
                    <code
                        title={lastAction}
                        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}
                    >
                        {lastAction}
                    </code>
                </span>
            </div>
            <div style={{ background: '#f4f6fa', minHeight: '100vh' }}>
                <OM2View
                    filters={filters}
                    data={data}
                    loading={scenario === 'loading'}
                    refreshing={false}
                    salesError={scenario === 'error' ? error : null}
                    actions={actions}
                    t={t}
                    isMobile={isMobile}
                    salesmen={FIXTURE_SALESMEN}
                    shippingCompanies={FIXTURE_SHIPPING_COMPANIES}
                    pageSources={FIXTURE_PAGE_SOURCES}
                    customerCare={FIXTURE_CUSTOMER_CARE}
                    paymentMethods={FIXTURE_PAYMENT_METHODS}
                    columnLabels={COLUMN_LABELS}
                    visibleColumns={visibleColumns}
                    onVisibleColumnsChange={setVisibleColumns}
                />
            </div>
          </StoreContext.Provider>
        </MemoryRouter>
    );
};

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ErrorBoundary>
            <LanguageProvider>
                <Preview />
            </LanguageProvider>
        </ErrorBoundary>
    </StrictMode>,
);
