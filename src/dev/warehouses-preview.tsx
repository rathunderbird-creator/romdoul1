// Dev-only preview: open http://localhost:5173/dev/warehouses.html while
// `npm run dev` runs (add ?missing=1 for a store without
// migrations/add_stock_transfers.sql).
//
// Mounts the real Warehouses page with an in-memory store: the default
// warehouse star and Move Stock work against local state with the same rules
// as transfer_warehouse_stock, so nothing reaches a database.
/* eslint-disable react-refresh/only-export-components -- dev entry point, never hot-reloaded as a module */
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../index.css';
import { StoreContext } from '../context/StoreContext';
import { HeaderProvider, useHeader } from '../context/HeaderContext';
import { ToastProvider } from '../context/ToastContext';
import { LanguageProvider } from '../context/LanguageContext';
import { tNow } from '../i18n/translate';
import WarehousesPage from '../pages/inventory/WarehousesPage';
import type { WarehouseStock, WarehouseTransferInput } from '../types';

const missing = new URLSearchParams(location.search).get('missing') === '1';

const products = [
    { id: 'p1', name: 'Speaker JBL Go 4', sku: 'GO4', price: 45, stock: 40, isActive: true },
    { id: 'p2', name: 'Speaker JBL Flip 6', sku: 'FLIP6', price: 99, stock: 12, isActive: true },
    { id: 'p3', name: 'Earbuds Tune 230', sku: 'T230', price: 59, stock: 25, isActive: true },
];
const warehouses = [
    { id: 'w1', name: 'Main Warehouse', address: 'Phnom Penh', createdAt: '2026-01-05' },
    { id: 'w2', name: 'Siem Reap Branch', address: 'Siem Reap', createdAt: '2026-03-10' },
];
// p1: 30 in Main, 4 in Siem Reap, 6 unassigned. p2: 12 unassigned. p3: 25 in Main.
const initialStock: WarehouseStock[] = [
    { id: 's1', warehouseId: 'w1', productId: 'p1', quantity: 30 },
    { id: 's2', warehouseId: 'w2', productId: 'p1', quantity: 4 },
    { id: 's3', warehouseId: 'w1', productId: 'p3', quantity: 25 },
];

const Store = ({ children }: { children: React.ReactNode }) => {
    const [warehouseStock, setWarehouseStock] = useState(initialStock);
    const [defaultWarehouseId, setDefaultWarehouseId] = useState('');

    const transferWarehouseStock = async (input: WarehouseTransferInput) => {
        await new Promise(r => setTimeout(r, 400));
        if (missing) throw new Error(tNow('ui.inventory.wh.move.needsUpdate'));
        setWarehouseStock(prev => {
            let next = prev.map(r => ({ ...r }));
            for (const l of input.lines) {
                if (input.fromWarehouseId) {
                    const src = next.find(r => r.warehouseId === input.fromWarehouseId && r.productId === l.productId);
                    if (!src || src.quantity < l.quantity) throw new Error('Not enough stock to move.');
                    src.quantity -= l.quantity;
                }
                const dst = next.find(r => r.warehouseId === input.toWarehouseId && r.productId === l.productId);
                if (dst) dst.quantity += l.quantity;
                else next = [...next, { id: `s${Date.now()}${l.productId}`, warehouseId: input.toWarehouseId, productId: l.productId, quantity: l.quantity }];
            }
            return next;
        });
    };

    const value = useMemo(() => {
        const base: Record<string, unknown> = {
            currentUser: { id: 'dev', name: 'Dev', roleId: 'admin' },
            products, warehouses, warehouseStock, defaultWarehouseId,
            hasPermission: () => true,
            setDefaultWarehouse: async (id: string) => setDefaultWarehouseId(id),
            transferWarehouseStock,
            addWarehouse: async () => undefined,
            updateWarehouse: async () => undefined,
            deleteWarehouse: async () => undefined,
        };
        return new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) });
    }, [warehouseStock, defaultWarehouseId]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <StoreContext.Provider value={value as any}>{children}</StoreContext.Provider>;
};

const HeaderSlot = () => {
    const { headerContent } = useHeader();
    return <div style={{ padding: '12px 12px 0' }}>{headerContent?.title}</div>;
};

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <LanguageProvider>
            <ToastProvider>
                <HeaderProvider>
                    <MemoryRouter>
                        <Store>
                            <HeaderSlot />
                            <WarehousesPage />
                        </Store>
                    </MemoryRouter>
                </HeaderProvider>
            </ToastProvider>
        </LanguageProvider>
    </StrictMode>
);
