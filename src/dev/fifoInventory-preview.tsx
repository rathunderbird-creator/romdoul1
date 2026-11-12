// Dev-only preview: open http://localhost:5173/dev/fifoInventory.html?page=reports
// (or dashboard | inventory | adjust | settings; add &fifo=missing to see a
// store without migrations/add_fifo_costing.sql) while `npm run dev` runs.
//
// Mounts the real FIFO-costed inventory pages with a mock store. The Supabase
// client is replaced in memory before anything renders, so nothing here
// reaches a database: every rpc and table read answers from the fixtures.
/* eslint-disable react-refresh/only-export-components -- dev entry point, never hot-reloaded as a module */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../index.css';
import { supabase } from '../lib/supabase';
import { StoreContext } from '../context/StoreContext';
import { HeaderProvider, useHeader } from '../context/HeaderContext';
import { ToastProvider } from '../context/ToastContext';
import { LanguageProvider } from '../context/LanguageContext';
import InventoryReportsPage from '../pages/inventory/InventoryReportsPage';
import InventoryDashboardPage from '../pages/inventory/InventoryDashboardPage';
import InventorySettingsPage from '../pages/inventory/InventorySettingsPage';
import AdjustStockPage from '../pages/inventory/AdjustStockPage';
import Inventory from '../pages/Inventory';

const params = new URLSearchParams(location.search);
const page = params.get('page') || 'reports';
const fifoMissing = params.get('fifo') === 'missing';

const today = new Date();
const ymd = (daysAgo: number) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const products = [
    { id: 'p1', name: 'Router NR-3026', sku: 'NR-3026', model: 'NR-3026', category: 'Network', price: 15, stock: 40, purchaseCost: 9.3, isActive: true, reorderLevel: 10, lowStockThreshold: 5 },
    { id: 'p2', name: 'Switch NR-6012', sku: 'NR-6012', model: 'NR-6012', category: 'Network', price: 18, stock: 12, purchaseCost: 10.7, isActive: true, reorderLevel: 15, lowStockThreshold: 5 },
    { id: 'p3', name: 'Charger AI 65W', sku: 'CH-AI65', model: 'AI65', category: 'Power', price: 9, stock: 25, purchaseCost: 4.2, isActive: true, reorderLevel: 5, lowStockThreshold: 5 },
    { id: 'p4', name: 'Cable Koller H51', sku: 'KL-H51', model: 'H51', category: 'Cables', price: 3, stock: 0, purchaseCost: 1.1, isActive: true, reorderLevel: 20, lowStockThreshold: 5 },
    { id: 'p5', name: 'Antenna NR-8801', sku: 'NR-8801', model: 'NR-8801', category: 'Network', price: 22, stock: 6, purchaseCost: 12.5, isActive: true, reorderLevel: 2, lowStockThreshold: 5 },
];

// Layers: p1 matches stock, p2 holds 2 fewer than stock, p3 has none.
const valuation = [
    { product_id: 'p1', product_name: 'Router NR-3026', is_active: true, stock: 40, qty: 40, value: 366.0, avg_cost: 9.15, next_cost: 9.0, last_cost: 9.3 },
    { product_id: 'p2', product_name: 'Switch NR-6012', is_active: true, stock: 12, qty: 10, value: 110.0, avg_cost: 11.0, next_cost: 11.0, last_cost: 11.0 },
    { product_id: 'p3', product_name: 'Charger AI 65W', is_active: true, stock: 25, qty: 0, value: 0, avg_cost: null, next_cost: null, last_cost: 4.4 },
    { product_id: 'p4', product_name: 'Cable Koller H51', is_active: true, stock: 0, qty: 0, value: 0, avg_cost: null, next_cost: null, last_cost: 1.1 },
    { product_id: 'p5', product_name: 'Antenna NR-8801', is_active: true, stock: 6, qty: 6, value: 75.0, avg_cost: 12.5, next_cost: 12.5, last_cost: 12.5 },
];

const check = {
    pool_units: 56, pool_value: 551.0, ledger_1300: 628.2, ledger_1300_posted: 540.0, inventory_account_found: true,
    retail_out_unbooked: 82.4, retail_booked_not_out: 15.2, retail_booked_out_diff: 0,
    expected_1300: 618.2, variance: 10, product_mismatches: 2,
    products: [
        { product_id: 'p3', name: 'Charger AI 65W', stock: 25, pool_qty: 0 },
        { product_id: 'p2', name: 'Switch NR-6012', stock: 12, pool_qty: 10 },
    ],
    shortfall: { retail_lines: 1, retail_qty: 2, wholesale_lines: 1, wholesale_qty: 5 },
};

const movements = [
    { id: 'm1', product_id: 'p1', type: 'in', quantity: 30, unit_price: 9.0, unit_cost: null, movement_date: ymd(200), source: 'Purchase Order', reference_id: '' },
    { id: 'm2', product_id: 'p1', type: 'out', quantity: 4, unit_price: 15, unit_cost: null, movement_date: ymd(120), source: 'Order', reference_id: 'ORD-1001' },
    { id: 'm3', product_id: 'p1', type: 'in', quantity: 20, unit_price: 9.3, unit_cost: 9.3, movement_date: ymd(40), source: 'Purchase Order', reference_id: '' },
    { id: 'm4', product_id: 'p1', type: 'out', quantity: 6, unit_price: 15, unit_cost: 9.0, movement_date: ymd(10), source: 'Order', reference_id: 'ORD-1102' },
    { id: 'm5', product_id: 'p2', type: 'out', quantity: 3, unit_price: 18, unit_cost: 11.0, movement_date: ymd(5), source: 'Wholesale', reference_id: 'WSO-7' },
    { id: 'm6', product_id: 'p3', type: 'out', quantity: 5, unit_price: 9, unit_cost: null, movement_date: ymd(60), source: 'Order', reference_id: 'ORD-990' },
];

const missingFifo = { data: null, error: { code: 'P0001', message: 'FIFO costing is not set up on this store yet — run migrations/add_fifo_costing.sql.' } };

function rpc(name: string, args: Record<string, unknown>) {
    if (name.startsWith('fifo_') && fifoMissing) return Promise.resolve(missingFifo);
    if (name === 'fifo_inventory_valuation') return Promise.resolve({ data: valuation, error: null });
    if (name === 'fifo_inventory_check') return Promise.resolve({ data: check, error: null });
    if (name === 'fifo_peek') {
        const qty = Number(args.p_qty) || 0;
        const v = valuation.find(r => r.product_id === args.p_product_id);
        const available = v?.qty || 0;
        const taken = Math.min(qty, available);
        const unitLayer = v && v.qty > 0 ? v.next_cost || 0 : 0;
        const fallback = v?.last_cost || 0;
        const cost = taken * unitLayer + (qty - taken) * fallback;
        return Promise.resolve({ data: { product_id: args.p_product_id, qty, cost, unit_cost: qty > 0 ? cost / qty : null, available, short_qty: Math.max(qty - available, 0), fallback_cost: fallback }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
}

function tableData(table: string, columns: string): unknown[] {
    if (table === 'stock_movements') {
        if (fifoMissing && columns.includes('unit_cost')) return [{ __error: true }];
        return movements;
    }
    if (table === 'sale_items') return [{ id: 'si-1', sale_id: 'ORD-1102', product_id: 'p2', name: 'Switch NR-6012', quantity: 3, cogs_short_qty: 2, cogs_cost: 33 }];
    if (table === 'wholesale_order_items') return [{ id: 'wi-1', wholesale_order_id: '6f1c2a90-0000-4000-8000-000000000007', product_id: 'p3', product_name: 'Charger AI 65W', quantity: 5, cogs_short_qty: 5, cogs_cost: 22 }];
    return [];
}

// A chainable stand-in for the PostgREST query builder.
function from(table: string) {
    let columns = '';
    let productFilter: string | null = null;
    const result = () => {
        const rows = tableData(table, columns);
        if (rows.length === 1 && (rows[0] as { __error?: boolean }).__error) {
            return { data: null, error: { code: '42703', message: 'column stock_movements.unit_cost does not exist' } };
        }
        const filtered = productFilter ? rows.filter(r => (r as { product_id?: string }).product_id === productFilter) : rows;
        return { data: filtered, error: null };
    };
    const builder: Record<string, unknown> = new Proxy({}, {
        get(_t, key: string) {
            if (key === 'then') return (resolve: (v: unknown) => void) => resolve(result());
            if (key === 'select') return (c: string) => { columns = c || ''; return builder; };
            if (key === 'eq') return (col: string, val: string) => { if (col === 'product_id') productFilter = val; return builder; };
            if (key === 'single' || key === 'maybeSingle') return () => Promise.resolve({ data: null, error: null });
            return () => builder;
        },
    });
    return builder;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = supabase as any;
client.rpc = rpc;
client.from = from;
client.channel = () => ({ on() { return this; }, subscribe() { return this; } });
client.removeChannel = () => undefined;

const base: Record<string, unknown> = {
    currentUser: { id: 'dev', name: 'Dev', role: 'Admin', permissions: [] },
    products,
    categories: ['Network', 'Power', 'Cables'],
    warehouses: [{ id: 'w1', name: 'Main' }],
    warehouseStock: [],
    productOrder: [],
    sales: [],
    users: [],
    isLoading: false,
    purchaseSettings: {},
    hasPermission: () => true,
    refreshData: () => Promise.resolve(),
};
const mockStore = new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) });

const HeaderSlot = () => {
    const { headerContent } = useHeader();
    return <div style={{ padding: '12px 12px 0' }}>{headerContent?.title}</div>;
};

const Page = () => {
    switch (page) {
        case 'dashboard': return <InventoryDashboardPage />;
        case 'inventory': return <Inventory />;
        case 'adjust': return <AdjustStockPage />;
        case 'settings': return <InventorySettingsPage />;
        default: return <InventoryReportsPage />;
    }
};

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <LanguageProvider>
            <ToastProvider>
                <HeaderProvider>
                    <MemoryRouter>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        <StoreContext.Provider value={mockStore as any}>
                            <HeaderSlot />
                            <main style={{ padding: '12px' }}>
                                <Page />
                            </main>
                        </StoreContext.Provider>
                    </MemoryRouter>
                </HeaderProvider>
            </ToastProvider>
        </LanguageProvider>
    </StrictMode>
);
