// Dev-only preview: open http://localhost:5173/dev/provinces.html?page=setup
// (or ?page=checkout | sp) while `npm run dev` is running.
//
// Mounts Sales Setup's Provinces section, the checkout form and the Shipping
// Point selector with a mock store whose config carries a sample custom
// district + commune and a hidden official district + commune, so the shared
// address tree can be checked without logging in. Shipping points are READ
// from the real DB through the anon key. Every store write here is a no-op
// that only logs; do not press Save in the point editors (those write
// custom_locations directly).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../index.css';
import { StoreContext } from '../context/StoreContext';
import { HeaderProvider } from '../context/HeaderContext';
import { ToastProvider } from '../context/ToastContext';
import { LanguageProvider } from '../context/LanguageContext';
import ProvincesSection from '../pages/salesSetup/ProvincesSection';
import CheckoutForm from '../components/CheckoutForm';
import ShippingPointSelector from '../components/ShippingPointSelector';
import type { Sale } from '../types';

const logWrite = (name: string) => (...args: unknown[]) => {
    console.info('[preview] store write skipped:', name, ...args);
    return Promise.resolve();
};

const base: Record<string, unknown> = {
    currentUser: { id: 'dev', name: 'Dev', role: 'Admin', roleId: 'admin', permissions: [] },
    products: [], sales: [], users: [], customers: [], blockedCustomers: [], telegramConfigs: [],
    pages: ['Dev Page'], shippingCompanies: ['J&T', 'VET', 'Dev Courier'], paymentMethods: ['Cash'], cities: [],
    salesmen: [], categories: [], customerCare: [], khrExchangeRate: 4100,
    hasPermission: () => true,
    // Phnom Penh (12) gets a custom district with a custom commune; Chamkar
    // Mon (1201) is hidden, and so is one commune of Doun Penh (120201).
    customDistricts: [{ code: 'custom-dev-district', provinceCode: '12', khmer: 'ខណ្ឌសាកល្បង', latin: 'Dev Test District' }],
    customCommunes: [
        { code: 'custom-dev-commune', districtCode: 'custom-dev-district', khmer: 'សង្កាត់សាកល្បង', latin: 'Dev Test Commune' },
        { code: 'custom-dev-commune-2', districtCode: '1202', khmer: 'សង្កាត់បន្ថែម', latin: 'Dev Extra Commune' },
    ],
    removedDistrictCodes: ['1201'],
    removedCommuneCodes: ['120201'],
    addCustomDistrict: logWrite('addCustomDistrict'),
    removeDistrictEntry: logWrite('removeDistrictEntry'),
    addCustomCommune: logWrite('addCustomCommune'),
    removeCommuneEntry: logWrite('removeCommuneEntry'),
    restoreDistrictEntry: logWrite('restoreDistrictEntry'),
    restoreCommuneEntry: logWrite('restoreCommuneEntry'),
    addOnlineOrder: logWrite('addOnlineOrder'),
    updateOrder: logWrite('updateOrder'),
};
// Anything else a component reads becomes a no-op function.
const mockStore = new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) });

const params = new URLSearchParams(location.search);
const page = params.get('page') || 'setup';

// ?edit=hidden opens the checkout as an edit of an order whose district is
// the hidden Chamkar Mon — it must still show and stay editable.
const editOrder = params.get('edit') === 'hidden' ? ({
    id: 'dev-order', items: [], total: 0, date: new Date().toISOString(),
    customer: { name: 'Dev', phone: '012345678', city: 'រាជធានីភ្នំពេញ', district: 'ចំការមន', commune: 'ទន្លេបាសាក់', address: '' },
} as unknown as Sale) : null;

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <LanguageProvider>
            <ToastProvider>
                <HeaderProvider>
                    <MemoryRouter>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        <StoreContext.Provider value={mockStore as any}>
                            <main style={{ padding: '12px', display: 'flex' }}>
                                {page === 'checkout' ? (
                                    <div style={{ flex: 1 }}>
                                        <CheckoutForm cartItems={[]} orderToEdit={editOrder} onCancel={() => undefined} onSuccess={() => undefined} onUpdateCart={() => undefined} />
                                    </div>
                                ) : page === 'sp' ? (
                                    // Always open; reload the page to reopen after Close / a pick.
                                    <ShippingPointSelector isOpen onClose={() => console.info('[preview] selector closed')} onSelect={d => console.info('[preview] selected', d)} />
                                ) : <ProvincesSection />}
                            </main>
                        </StoreContext.Provider>
                    </MemoryRouter>
                </HeaderProvider>
            </ToastProvider>
        </LanguageProvider>
    </StrictMode>
);
