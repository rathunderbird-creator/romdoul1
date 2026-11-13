// Dev-only preview: open http://localhost:5173/dev/filterBars.html?page=je (or ?page=po|ret|pay)
// while `npm run dev` is running.
//
// Mounts the real Journal Entries / Purchase Orders pages with a mock store so
// their filter bars can be checked without logging in. The pages' own hooks
// still READ their lists through the anon key; nothing here writes.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../index.css';
import { StoreContext } from '../context/StoreContext';
import { HeaderProvider } from '../context/HeaderContext';
import { ToastProvider } from '../context/ToastContext';
import { LanguageProvider } from '../context/LanguageContext';
import JournalEntriesPage from '../pages/accounting/JournalEntriesPage';
import PurchaseOrdersPage from '../pages/procurement/PurchaseOrdersPage';
import ReturningItems from '../pages/ReturningItems';
import CustomerPayment from '../pages/CustomerPayment';

const base: Record<string, unknown> = {
    currentUser: { id: 'dev', name: 'Dev', role: 'Admin', permissions: [] },
    products: [],
    purchaseSettings: {},
    sales: [],
    users: [],
    hasPermission: () => true,
    trackingUrlTemplates: {},
    salesUpdatedAt: 0,
};
// Anything else a page reads becomes a no-op function.
const mockStore = new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) });

const page = new URLSearchParams(location.search).get('page') || 'je';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <LanguageProvider>
            <ToastProvider>
                <HeaderProvider>
                    <MemoryRouter>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        <StoreContext.Provider value={mockStore as any}>
                            <main style={{ padding: '12px' }}>
                                {page === 'po' ? <PurchaseOrdersPage /> : page === 'ret' ? <ReturningItems /> : page === 'pay' ? <CustomerPayment /> : <JournalEntriesPage />}
                            </main>
                        </StoreContext.Provider>
                    </MemoryRouter>
                </HeaderProvider>
            </ToastProvider>
        </LanguageProvider>
    </StrictMode>
);
