// Dev-only preview: open http://localhost:5173/dev/khrCurrency.html while
// `npm run dev` is running. ?chart= picks the chart of accounts the forms see
// (r1: 1001 Petty Cash + 1010 Bank Account ABA (USD); r2: 1000 Cash only; the
// *khr variants add 1002 Cash on Hand (KHR) + 1011 Bank Account ABA (KHR)),
// ?form= the form (delivery, deposit, settle, receipt, finalize, wholesale,
// supplier, settings, money, setup = Sales Setup, shipping = Select Shipping Company popup,
// checkout = the order Checkout form, payreq = Copy payment request on an order owing and a Paid one, ?edit=neg|khr reopening a saved one;
// ?dep= sets that order's existing deposit).
//
// The chart is answered locally (never read from the live store), every
// store write is a no-op that logs, and blockDbWrites refuses every non-GET
// request to the database. What a form would save is shown under it.
/* eslint-disable react-refresh/only-export-components -- dev entry point, never hot-reloaded as a module */
import './blockDbWrites';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../index.css';
import { StoreContext } from '../context/StoreContext';
import { HeaderProvider } from '../context/HeaderContext';
import { ToastProvider } from '../context/ToastContext';
import CopyPaymentRequestButton from '../components/CopyPaymentRequestButton';
import MobileOrderCard from '../components/MobileOrderCard';
import { LanguageProvider } from '../context/LanguageContext';
import DeliveryFeeModal from '../components/DeliveryFeeModal';
import DepositModal from '../components/DepositModal';
import SettlePaymentModal from '../components/SettlePaymentModal';
import RecordReceiptModal from '../components/RecordReceiptModal';
import RecordCustomerPaymentModal from '../components/RecordCustomerPaymentModal';
import RecordSupplierPaymentModal from '../components/RecordSupplierPaymentModal';
import MoneyInput from '../components/MoneyInput';
import GeneralSettings from '../pages/settings/GeneralSettings';
import { useMoneyField } from '../hooks/useMoneyField';
import { ShippingModalComponent } from '../pages/Orders';
import CheckoutForm from '../components/CheckoutForm';
import CodRemittancesPage from '../pages/accounting/CodRemittancesPage';
import FxRevaluationPage from '../pages/accounting/FxRevaluationPage';
import SalesSetupPage from '../pages/SalesSetupPage';
import type { CartItem, Sale } from '../types';

const params = new URLSearchParams(location.search);
const chart = params.get('chart') || 'r2khr';
const form = params.get('form') || 'delivery';

const acct = (id: string, code: string, name: string, type = 'Asset') =>
    ({ id, account_code: code, account_name: name, account_type: type, is_active: true, description: null, sub_type: null, created_at: '' });
const R1 = [acct('00000000-0000-0000-0000-000000001001', '1001', 'Petty Cash'), acct('00000000-0000-0000-0000-000000001010', '1010', 'Bank Account ABA (USD)')];
const R2 = [acct('00000000-0000-0000-0000-000000001000', '1000', 'Cash')];
const KHR = [acct('00000000-0000-0000-0000-000000001002', '1002', 'Cash on Hand (KHR)'), acct('00000000-0000-0000-0000-000000001011', '1011', 'Bank Account ABA (KHR)')];
const OTHER = [acct('00000000-0000-0000-0000-000000001200', '1200', 'Accounts Receivable'), acct('00000000-0000-0000-0000-000000001210', '1210', 'COD receivable (courier)'), acct('00000000-0000-0000-0000-000000004000', '4000', 'Sales Revenue', 'Revenue')];
// ?fx=1: the chart already has the two exchange gain/loss accounts (else the
// Riel Revaluation page offers to add them).
const FX = params.get('fx') ? [
    { ...acct('00000000-0000-0000-0000-000000004910', '4910', 'Foreign Exchange Gain', 'Revenue'), sub_type: 'Other Revenue' },
    { ...acct('00000000-0000-0000-0000-000000006910', '6910', 'Foreign Exchange Loss', 'Expense'), sub_type: 'Other Expense' },
] : [];
const chartRows = [...(chart.startsWith('r1') ? R1 : R2), ...(chart.endsWith('khr') ? KHR : []), ...OTHER, ...FX]
    .sort((a, b) => a.account_code.localeCompare(b.account_code));

// ?form=fx: the riel accounts' journal lines (each with its entry, as the
// page selects them). ABA riel: ៛82,000 @ 4,100 = $20 and ៛41,000 @ 4,000 =
// $10.25 in, ៛20,500 @ 4,100 = $5 out, plus a Draft receipt; riel cash: an
// untagged $3 manual journal. At 4,100 ABA riel (៛102,500, $25.25) is worth
// $25.00: a $0.25 loss.
const fxEntry = (id: string, date: string, cur: string | null, riel: number | null, rate: number | null, status = 'Posted', ref = `TX-${id}`) =>
    ({ id, date, status, reference_id: ref, currency: cur, original_amount: riel, exchange_rate: rate });
const ABA_R = '00000000-0000-0000-0000-000000001011', CASH_R = '00000000-0000-0000-0000-000000001002';
const fxLines = [
    { id: 'l1', journal_entry_id: 'e1', account_id: ABA_R, debit: 20, credit: 0, entry: fxEntry('e1', '2026-11-01', 'KHR', 82000, 4100) },
    { id: 'l2', journal_entry_id: 'e2', account_id: ABA_R, debit: 10.25, credit: 0, entry: fxEntry('e2', '2026-11-02', 'KHR', 41000, 4000) },
    { id: 'l3', journal_entry_id: 'e3', account_id: ABA_R, debit: 0, credit: 5, entry: fxEntry('e3', '2026-11-03', 'KHR', 20500, 4100) },
    { id: 'l4', journal_entry_id: 'e4', account_id: ABA_R, debit: 1, credit: 0, entry: fxEntry('e4', '2026-11-04', 'KHR', 4100, 4100, 'Draft') },
    { id: 'l5', journal_entry_id: 'e5', account_id: CASH_R, debit: 3, credit: 0, entry: fxEntry('e5', '2026-11-05', null, null, null, 'Posted', 'MAN-1') },
];

// The chart of accounts is answered here, so the preview never depends on
// (or reads) the live store's chart.
const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const innerFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    // Writes go on to blockDbWrites, which refuses them (403).
    if (method !== 'GET') return innerFetch(input, init);
    if (url.includes('/rest/v1/chart_of_accounts')) {
        return Promise.resolve(new Response(JSON.stringify(chartRows), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (form === 'fx' && url.includes('/rest/v1/journal_entry_lines')) {
        return Promise.resolve(new Response(JSON.stringify(fxLines), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (supabaseUrl && url.startsWith(supabaseUrl)) {
        // Anything else is answered empty: the forms here need nothing more.
        return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return innerFetch(input, init);
};

const log: string[] = [];
const show = (name: string, data: unknown) => {
    log.unshift(`${name}: ${JSON.stringify(data)}`);
    const el = document.getElementById('preview-log');
    if (el) el.textContent = log.join('\n');
    console.info('[preview]', name, data);
};
const logWrite = (name: string) => (...args: unknown[]) => { show(name, args); return Promise.resolve(); };

const base: Record<string, unknown> = {
    currentUser: { id: 'dev', name: 'Dev', role: 'Admin', roleId: 'admin', permissions: [] },
    paymentMethods: ['Cash', 'QR', 'Bank'],
    khrExchangeRate: Number(params.get('rate') || 4100),
    khrExchangeRateUpdatedAt: null,
    timezone: 'Asia/Phnom_Penh', taxRate: 0, currency: 'USD ($)', storeName: 'Dev Store',
    wholesaleSettings: { defaultPaymentAccountId: params.get('def') || '' },
    purchaseSettings: { defaultPaymentAccountId: params.get('def') || '' },
    hasPermission: () => true,
    updateStoreProfile: logWrite('updateStoreProfile'),
    shippingCompanies: ['J&T', 'VET'], products: [],
    // Sales Setup (?form=setup): J&T ticked for Get File books COD.
    codGetFileCompanies: ['J&T'], setCodGetFileCompany: logWrite('setCodGetFileCompany'),
    salesSettings: {}, updateSalesSetting: logWrite('updateSalesSetting'),
    salesmen: ['Dev Salesman'], addSalesman: logWrite('addSalesman'), removeSalesman: logWrite('removeSalesman'),
    customerCare: ['Dev Admin', 'Dev Care'], addCustomerCare: logWrite('addCustomerCare'), removeCustomerCare: logWrite('removeCustomerCare'),
    discountPresets: [{ name: 'VIP', type: 'pct', value: 10 }, { name: 'Repeat buyer', type: 'usd', value: 2 }], addDiscountPreset: logWrite('addDiscountPreset'), removeDiscountPreset: logWrite('removeDiscountPreset'),
    deliveryTypes: ['Phnom Penh delivery', 'Province courier', 'Grab / Express', 'Customer pickup'], courierDeliveryTypes: { 'J&T': 'Province courier' },
    addDeliveryType: logWrite('addDeliveryType'), removeDeliveryType: logWrite('removeDeliveryType'), setCourierDeliveryType: logWrite('setCourierDeliveryType'),
    customerGroups: ['VIP', 'Reseller'], customerGroupMembers: { '012345678': { group: 'VIP', name: 'Dev Customer' }, '098765432': { group: 'Reseller' } },
    addCustomerGroup: logWrite('addCustomerGroup'), removeCustomerGroup: logWrite('removeCustomerGroup'), setCustomerGroup: logWrite('setCustomerGroup'),
    priceLevels: [{ name: 'Dealer', pct: 10, groups: ['VIP'] }], addPriceLevel: logWrite('addPriceLevel'), removePriceLevel: logWrite('removePriceLevel'), setPriceLevelGroup: logWrite('setPriceLevelGroup'),
    rejectionReasons: ['Customer refused', 'Wrong address'], addRejectionReason: logWrite('addRejectionReason'), removeRejectionReason: logWrite('removeRejectionReason'),
    shippingRates: { 'J&T': 1.25 }, updateShippingRate: logWrite('updateShippingRate'), trackingUrlTemplates: {}, updateTrackingUrlTemplate: logWrite('updateTrackingUrlTemplate'),
    addPaymentMethod: logWrite('addPaymentMethod'), removePaymentMethod: logWrite('removePaymentMethod'),
    addPage: logWrite('addPage'), removePage: logWrite('removePage'), addShippingCompany: logWrite('addShippingCompany'), removeShippingCompany: logWrite('removeShippingCompany'),
    updateOrder: (...args: unknown[]) => { show('updateOrder', args); return Promise.resolve(true); },
    updateOrderStatus: (...args: unknown[]) => { show('updateOrderStatus', args); return Promise.resolve(true); },
    // Checkout (?form=checkout): lists it maps over, and the create it calls.
    users: [{ id: 'u1', name: 'Dev Seller', roleId: 'salesman' }, { id: 'u2', name: 'Dev Admin', roleId: 'admin' }], sales: [], pages: ['Dev Page'], cities: [], blockedCustomers: [], telegramConfigs: [],
    addOnlineOrder: (o: Sale, opts?: unknown) => { show('addOnlineOrder', { total: o.total, discount: o.discount, customKhrAmount: o.customKhrAmount, amountReceived: o.amountReceived, paymentStatus: o.paymentStatus, opts }); return Promise.resolve({ ...o, id: 'dev-new' }); },
};
const mockStore = new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) });

const order = {
    id: 'dev-order', total: 20, depositAmount: Number(params.get('dep') || 0), amountReceived: 0, paymentStatus: params.get('pdfee') ? 'PdFee' : 'Unpaid',
    items: [{ id: 'p1', name: 'Speaker', price: 20, quantity: 1 }], date: new Date().toISOString(), customer: { name: 'Dev Customer', phone: '012345678' },
    customKhrAmount: params.get('khr') ? Number(params.get('khr')) : undefined,
} as unknown as Sale;

const FreeMoney = () => {
    const field = useMoneyField({ shopRate: 4100, maxPlausibleUsd: 15 });
    return (
        <div style={{ maxWidth: 360, padding: 16, background: 'var(--color-surface)', borderRadius: 12 }}>
            <MoneyInput field={field} label="Delivery fee" allowKhr />
            <button className="primary-button" style={{ marginTop: 12 }}
                onClick={() => { if (field.confirmIfSuspicious()) show('save', { usd: field.usd, meta: field.meta }); }}>Save</button>
        </div>
    );
};

// Checkout with two $20 items; ?edit=neg reopens an order sold at $45
// (discount -5), ?edit=khr one sold at ៛150,000 ($36.59, discount 3.41).
const checkoutItems = [
    { id: 'p1', name: 'Speaker', price: 20, quantity: 1 },
    { id: 'p2', name: 'Cable', price: 20, quantity: 1 },
] as unknown as CartItem[];
const editBase = {
    ...order, id: 'dev-edit', items: checkoutItems, paymentStatus: 'Unpaid', salesman: 'Dev Seller',
    customer: { name: 'Dev Customer', phone: '012345678', city: 'ភ្នំពេញ', page: 'Dev Page' }, shipping: { company: 'J&T', status: 'Pending' },
};
const checkoutEdit = params.get('edit') === 'neg'
    ? { ...editBase, total: 45, discount: -5 }
    : params.get('edit') === 'khr'
        ? { ...editBase, total: 36.59, discount: 3.41, customKhrAmount: 150000 }
        : null;
const Checkout = () => {
    const [items, setItems] = useState<CartItem[]>(checkoutItems);
    return <CheckoutForm cartItems={items} orderToEdit={checkoutEdit as unknown as Sale | null} onUpdateCart={setItems}
        onCancel={() => show('cancel', {})} onSuccess={() => show('success', {})} />;
};

const Forms = () => {
    const [open, setOpen] = useState(true);
    const close = () => { setOpen(false); setTimeout(() => setOpen(true), 400); };
    switch (form) {
        case 'deposit': return <DepositModal order={open ? order : null} onClose={close} showDepositAccount onConfirm={d => show('deposit', d)} />;
        case 'settle': return open ? <SettlePaymentModal isOpen onClose={close} amountDue={20} khrExpected={order.customKhrAmount} orderTotal={20} onConfirm={d => show('settle', d)} /> : null;
        case 'receipt': return open ? <RecordReceiptModal isOpen onClose={close} order={order} onConfirm={d => show('receipt', d)} /> : null;
        case 'finalize': return open ? <RecordReceiptModal isOpen finalizeMode onClose={close} order={order}
            finalizeRow={{ amount: 20, currency: 'KHR', original_amount: 82000, exchange_rate: 4100 }} depositAccountHint="Cash" onConfirm={d => show('finalize', d)} /> : null;
        case 'wholesale': return open ? <RecordCustomerPaymentModal isOpen onClose={close} remainingBalance={120} customerName="Dev Wholesale" onConfirm={d => show('wholesale', d)} /> : null;
        case 'supplier': return open ? <RecordSupplierPaymentModal isOpen onClose={close} remainingBalance={250} supplierName="Dev Supplier" onConfirm={d => show('supplier', d)} /> : null;
        case 'settings': return <GeneralSettings />;
        case 'money': return <FreeMoney />;
        case 'checkout': return <Checkout />;
        case 'cod': return <CodRemittancesPage />;
        case 'fx': return <FxRevaluationPage />;
        case 'setup': return <SalesSetupPage />;
        case 'payreq': return (
            <div>
            <div style={{ display: 'flex', gap: 12 }}>
                <CopyPaymentRequestButton order={{ ...editBase, total: 40 } as unknown as Sale} sales={[]} />
                <CopyPaymentRequestButton order={{ ...editBase, total: 40, paymentStatus: 'Paid' } as unknown as Sale} sales={[]} />
                <CopyPaymentRequestButton order={{ ...editBase, total: 40 } as unknown as Sale} sales={[]} short />
                <span>(only the first order owes: one button, then the short label)</span>
            </div>
            <div style={{ width: 360, marginTop: 16, border: '1px dashed #ccc' }}>
                <MobileOrderCard order={{ ...editBase, total: 40 } as unknown as Sale} isSelected={false} onToggleSelect={() => {}}
                    isExpanded onToggleExpand={() => {}} onEdit={() => {}} onView={() => {}} onPrint={() => {}} onCopy={() => {}}
                    onCopyPaymentRequest={() => console.info('[preview] copy payment request')} customerGroup="VIP"
                    onUpdateStatus={() => {}} onUpdatePaymentStatus={() => {}} canEdit />
            </div>
            </div>
        );
        case 'shipping': return <ShippingModalComponent isOpen={open} onClose={close} order={order} />;
        default: return <DeliveryFeeModal order={open ? order : null} onClose={close} onConfirm={d => show('deliveryFee', d)} />;
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
                            <main style={{ padding: '12px' }}>
                                <div style={{ fontSize: 12, marginBottom: 8 }}>chart <b>{chart}</b> · form <b>{form}</b></div>
                                <Forms />
                                <pre id="preview-log" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxHeight: '30vh', overflow: 'auto', margin: 0, padding: 8, fontSize: 11, background: '#111', color: '#9f9', zIndex: 20000, whiteSpace: 'pre-wrap' }} />
                            </main>
                        </StoreContext.Provider>
                    </MemoryRouter>
                </HeaderProvider>
            </ToastProvider>
        </LanguageProvider>
    </StrictMode>
);
