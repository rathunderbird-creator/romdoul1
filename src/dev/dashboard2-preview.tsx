// Dev-only preview: open http://localhost:5173/dev/dashboard2.html while `npm run dev` is running.
//
// Mounts the pure Dashboard2View with fixture data (./dashboard2-fixtures) so
// the page can be checked in a browser without logging in — no auth, no
// store, no Supabase. A slim grey bar on top switches scenarios / language /
// mobile layout and echoes the last `actions.*` call the view made.
// Not part of the production build (Vite only builds index.html).
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import ErrorBoundary from '../components/ErrorBoundary';
import { LanguageProvider, useLanguage } from '../context/LanguageContext';
import Dashboard2View from '../pages/dashboard2/Dashboard2View';
import { localDayOf, previousRange } from '../pages/dashboard2/metrics';
import type { DateRange, Order } from '../pages/dashboard2/metrics';
import type { Dashboard2Actions, Dashboard2Data, SectionError } from '../pages/dashboard2/types';
import {
    fixtureRange, fixturePreviousRange, fixtureProducts, fixtureOrders, fixturePreviousOrders, fixtureNow,
} from './dashboard2-fixtures';

// ─── Scenarios ────────────────────────────────────────────────────────────

type Scenario = 'normal' | 'loading' | 'empty' | 'salesError' | 'inventoryError' | 'today-only';

const SCENARIOS: Scenario[] = ['normal', 'loading', 'empty', 'salesError', 'inventoryError', 'today-only'];

// Range the view starts with for each scenario; the in-view picker can change it afterwards.
const defaultRange = (s: Scenario): DateRange => {
    if (s === 'today-only') return { start: '2026-09-07', end: '2026-09-07' };
    if (s === 'empty') return { start: '2026-09-10', end: '2026-09-10' };
    return fixtureRange;
};

const sameRange = (a: DateRange, b: DateRange): boolean => a.start === b.start && a.end === b.end;

// Orders whose local calendar day falls inside `range` ('' bounds are open).
const inRange = (orders: Order[], range: DateRange): Order[] =>
    orders.filter(o => {
        const day = localDayOf(o.date);
        if (!day) return false;
        return (!range.start || day >= range.start) && (!range.end || day <= range.end);
    });

// Every fixture order, deduplicated by id, so any picked range can be served.
const ALL_ORDERS: Order[] = Array.from(
    new Map([...fixtureOrders, ...fixturePreviousOrders].map(o => [o.id, o])).values(),
);

// The all-time Get File pipeline, exactly as the app computes it: every
// fixture order awaiting settlement, whatever range is on screen.
const FIXTURE_GET_FILE = (() => {
    const rows = ALL_ORDERS.filter(o => o.paymentStatus === 'Get File');
    return { count: rows.length, total: rows.reduce((s, o) => s + (Number(o.total) || 0), 0) };
})();

// ─── Preview ──────────────────────────────────────────────────────────────

const devBarStyle = {
    display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 10,
    padding: '6px 12px', background: '#e5e7eb', color: '#374151',
    fontSize: 12, fontFamily: 'system-ui, sans-serif', borderBottom: '1px solid #d1d5db',
};

const controlStyle = { fontSize: 12, padding: '2px 6px', borderRadius: 6, border: '1px solid #9ca3af', background: '#fff' };

const Preview = () => {
    const { t, language, setLanguage } = useLanguage();
    const [scenario, setScenario] = useState<Scenario>('normal');
    const [range, setRange] = useState<DateRange>(fixtureRange);
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    const [lastAction, setLastAction] = useState('—');

    // Follow the viewport like the app's useMobile does; the checkbox can still override it.
    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const selectScenario = (s: Scenario) => {
        setScenario(s);
        setRange(defaultRange(s));
    };

    const data = useMemo<Dashboard2Data>(() => {
        const base = { range, products: fixtureProducts, getFile: FIXTURE_GET_FILE, stockIn: 40, stockOut: 61, now: fixtureNow };
        if (scenario === 'empty') return { ...base, previous: null, orders: [], previousOrders: [] };
        // The untouched fixture range uses the hand-built previous period; any
        // range picked in the view recomputes it from the full fixture pool.
        const untouched = sameRange(range, fixtureRange);
        const previous = untouched ? fixturePreviousRange : previousRange(range);
        return {
            ...base,
            previous,
            orders: inRange(fixtureOrders, range),
            previousOrders: untouched ? fixturePreviousOrders : (previous ? inRange(ALL_ORDERS, previous) : []),
        };
    }, [scenario, range]);

    const actions = useMemo<Dashboard2Actions>(() => {
        const log = (name: string, payload?: unknown) =>
            setLastAction(payload === undefined ? name : `${name} ${JSON.stringify(payload)}`);
        return {
            onRangeChange: r => { setRange(r); log('rangeChange', r); },
            onRefresh: () => log('refresh'),
            onOpenOrders: filters => log('orders', filters),
            onNewOrder: () => log('newOrder'),
            onOpenInventory: () => log('inventory'),
        };
    }, []);

    const error: SectionError = { message: 'network timeout', retry: () => selectScenario('normal') };

    return (
        <>
            <div style={devBarStyle}>
                <strong>Dashboard 2 preview</strong>
                <label>
                    scenario{' '}
                    <select value={scenario} onChange={e => selectScenario(e.target.value as Scenario)} style={controlStyle}>
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
                <span style={{ color: '#6b7280' }}>{t('dashboard2.dateRange')}: {data.range.start || '…'} → {data.range.end || '…'}</span>
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
            <div style={{ padding: 12, background: '#f4f6fa', minHeight: '100vh' }}>
                <Dashboard2View
                    data={data}
                    loading={scenario === 'loading'}
                    refreshing={false}
                    salesError={scenario === 'salesError' ? error : null}
                    inventoryError={scenario === 'inventoryError' ? error : null}
                    actions={actions}
                    t={t}
                    language={language}
                    isMobile={isMobile}
                />
            </div>
        </>
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
