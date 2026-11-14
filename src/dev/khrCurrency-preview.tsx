// Dev-only preview: open http://localhost:5173/dev/khrCurrency.html while
// `npm run dev` is running. ?chart= picks the chart of accounts the forms see
// (r1: 1001 Petty Cash + 1010 Bank Account (ABA); r2: 1000 Cash only; the
// *khr variants add 1002 Cash on Hand (KHR) + 1011 Bank Account ABA (KHR)),
// ?form= the form (delivery, deposit, settle, receipt, finalize, wholesale,
// supplier, settings, money).
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
import type { Sale } from '../types';

const params = new URLSearchParams(location.search);
const chart = params.get('chart') || 'r2khr';
const form = params.get('form') || 'delivery';

const acct = (id: string, code: string, name: string, type = 'Asset') =>
    ({ id, account_code: code, account_name: name, account_type: type, is_active: true, description: null, sub_type: null, created_at: '' });
const R1 = [acct('00000000-0000-0000-0000-000000001001', '1001', 'Petty Cash'), acct('00000000-0000-0000-0000-000000001010', '1010', 'Bank Account (ABA)')];
const R2 = [acct('00000000-0000-0000-0000-000000001000', '1000', 'Cash')];
const KHR = [acct('00000000-0000-0000-0000-000000001002', '1002', 'Cash on Hand (KHR)'), acct('00000000-0000-0000-0000-000000001011', '1011', 'Bank Account ABA (KHR)')];
const OTHER = [acct('00000000-0000-0000-0000-000000001200', '1200', 'Accounts Receivable'), acct('00000000-0000-0000-0000-000000004000', '4000', 'Sales Revenue', 'Revenue')];
const chartRows = [...(chart.startsWith('r1') ? R1 : R2), ...(chart.endsWith('khr') ? KHR : []), ...OTHER]
    .sort((a, b) => a.account_code.localeCompare(b.account_code));

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
    timezone: 'Asia/Phnom_Penh', taxRate: 0, currency: 'USD ($)',
    wholesaleSettings: { defaultPaymentAccountId: params.get('def') || '' },
    purchaseSettings: { defaultPaymentAccountId: params.get('def') || '' },
    hasPermission: () => true,
    updateStoreProfile: logWrite('updateStoreProfile'),
};
const mockStore = new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) });

const order = {
    id: 'dev-order', total: 20, depositAmount: 0, amountReceived: 0, paymentStatus: params.get('pdfee') ? 'PdFee' : 'Unpaid',
    items: [], date: new Date().toISOString(), customer: { name: 'Dev Customer', phone: '012345678' },
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

const Forms = () => {
    const [open, setOpen] = useState(true);
    const close = () => { setOpen(false); setTimeout(() => setOpen(true), 400); };
    switch (form) {
        case 'deposit': return <DepositModal order={open ? order : null} onClose={close} showDepositAccount onConfirm={d => show('deposit', d)} />;
        case 'settle': return open ? <SettlePaymentModal isOpen onClose={close} amountDue={20} khrExpected={order.customKhrAmount} onConfirm={d => show('settle', d)} /> : null;
        case 'receipt': return open ? <RecordReceiptModal isOpen onClose={close} order={order} onConfirm={d => show('receipt', d)} /> : null;
        case 'finalize': return open ? <RecordReceiptModal isOpen finalizeMode onClose={close} order={order}
            finalizeRow={{ amount: 20, currency: 'KHR', original_amount: 82000, exchange_rate: 4100 }} depositAccountHint="Cash" onConfirm={d => show('finalize', d)} /> : null;
        case 'wholesale': return open ? <RecordCustomerPaymentModal isOpen onClose={close} remainingBalance={120} customerName="Dev Wholesale" onConfirm={d => show('wholesale', d)} /> : null;
        case 'supplier': return open ? <RecordSupplierPaymentModal isOpen onClose={close} remainingBalance={250} supplierName="Dev Supplier" onConfirm={d => show('supplier', d)} /> : null;
        case 'settings': return <GeneralSettings />;
        case 'money': return <FreeMoney />;
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
