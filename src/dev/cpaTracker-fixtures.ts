// DEV-ONLY fixture data for src/dev/cpaTracker-preview.tsx. Two weeks of
// deterministic orders (Sep 18 – Oct 1, 2026) for three pages × four
// products, ad spend + chats for the advertised combinations, and unit-
// economics settings mirroring the original workbook ($2 courier, $0.50
// packaging, 90% expected delivery). Not imported by the production app.
import type { Sale, Product } from '../types';
import type { DailyEntryRow, ProductSettingRow } from '../pages/cpaTracker/metrics';
import { DEFAULT_SETTINGS_KEY } from '../pages/cpaTracker/metrics';
import { addDays, type DateRange } from '../utils/dateRange';

export const cpaFixtureNow = new Date(2026, 9, 1, 16, 0);              // Oct 1, 16:00 local
export const cpaFixtureRange: DateRange = { from: '2026-09-18', to: '2026-10-01' };
export const cpaFixturePages = ['ពិភព ស្ពិកឃ័រ', 'VT Speaker', 'CH Sound', 'Unused Page'];

export const cpaFixtureProducts: Product[] = [
    { id: 'p-nr3026', name: 'NR-3026', model: '', price: 17, purchaseCost: 9, stock: 40, image: '', category: 'Speaker', isActive: true },
    { id: 'p-nr6012', name: 'NR-6012', model: '', price: 20, purchaseCost: 10.7, stock: 25, image: '', category: 'Speaker', isActive: true },
    { id: 'p-h51', name: 'KOLEER H51', model: 'H51', price: 17, purchaseCost: 7.5, stock: 30, image: '', category: 'Speaker', isActive: true },
    { id: 'p-h52', name: 'KOOLER H52', model: 'H52', price: 15, purchaseCost: 7, stock: 18, image: '', category: 'Speaker', isActive: true },
    { id: 'p-old', name: 'W.VIP-02 (discontinued)', model: '', price: 17, purchaseCost: 8, stock: 0, image: '', category: 'Speaker', isActive: false },
];

// Small deterministic PRNG so every reload shows the same numbers.
const rng = (() => { let s = 20260918; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();

// (page, product, average orders per day, ad spend per day)
const CAMPAIGNS: [string, string, number, number][] = [
    ['ពិភព ស្ពិកឃ័រ', 'p-nr3026', 7, 52],
    ['VT Speaker', 'p-nr6012', 6, 41],
    ['VT Speaker', 'p-h52', 4, 22],
    ['CH Sound', 'p-h51', 5, 38],
];

const productById = new Map(cpaFixtureProducts.map(p => [p.id, p]));
const sales: Sale[] = [];
const entries: DailyEntryRow[] = [];
let seq = 0;
for (let d = 0; d < 14; d++) {
    const day = addDays(cpaFixtureRange.from, d);
    const age = 13 - d;   // days before "now"
    for (const [page, pid, avg, spend] of CAMPAIGNS) {
        const n = Math.max(0, Math.round(avg + (rng() - 0.5) * 4));
        const product = productById.get(pid)!;
        for (let i = 0; i < n; i++) {
            const roll = rng();
            // Older orders are settled; the newest days are still in transit.
            const status = roll < 0.06 ? 'Cancelled'
                : roll < 0.1 ? 'Returned'
                    : age >= 3 ? 'Delivered'
                        : age === 2 ? (roll < 0.6 ? 'Delivered' : 'Shipped')
                            : age === 1 ? (roll < 0.25 ? 'Delivered' : 'Shipped')
                                : (roll < 0.5 ? 'Pending' : 'Drafted');
            const qty = rng() < 0.08 ? 2 : 1;
            const discount = rng() < 0.1 ? 1 : 0;
            const hour = 8 + Math.floor(rng() * 12);
            sales.push({
                id: `fx-${++seq}`,
                items: [{ ...product, quantity: qty }],
                total: product.price * qty - discount,
                discount,
                date: new Date(2026, 8, 18 + d, hour, 15).toISOString(),
                paymentMethod: 'Cash',
                type: 'Online' as Sale['type'],
                pageSource: page,
                shipping: { company: 'J&T', trackingNumber: '', status: status as NonNullable<Sale['shipping']>['status'], cost: 0, staffName: '' },
            } as Sale);
        }
        const spendToday = Math.round((spend + (rng() - 0.5) * 14) * 100) / 100;
        entries.push({ date: day, page, productId: pid, adSpend: spendToday, inboundChats: Math.round(spendToday * (1 + rng() * 0.4)), closedOverride: null, deliveredOverride: null });
    }
    // An organic (no-ad) sale now and then, and one dead campaign day.
    if (d % 3 === 0) {
        const p = productById.get('p-old')!;
        sales.push({ id: `fx-${++seq}`, items: [{ ...p, quantity: 1 }], total: 17, discount: 0, date: new Date(2026, 8, 18 + d, 11, 0).toISOString(), paymentMethod: 'Cash', type: 'Online' as Sale['type'], pageSource: 'CH Sound', shipping: { company: 'VET', trackingNumber: '', status: 'Delivered', cost: 0, staffName: '' } } as Sale);
    }
}
entries.push({ date: '2026-09-25', page: 'CH Sound', productId: 'p-nr6012', adSpend: 18.5, inboundChats: 9, closedOverride: null, deliveredOverride: null });

export const cpaFixtureSales: Sale[] = sales;
export const cpaFixtureEntries: DailyEntryRow[] = entries;

export const cpaFixtureSettings: ProductSettingRow[] = [
    { productId: DEFAULT_SETTINGS_KEY, courierFee: 2, packaging: 0.5, desiredProfit: 2.5, expectedDeliveryRate: 0.9 },
    { productId: 'p-nr3026', courierFee: null, packaging: null, desiredProfit: 3, expectedDeliveryRate: null },
    { productId: 'p-nr6012', courierFee: null, packaging: null, desiredProfit: 4, expectedDeliveryRate: null },
];
