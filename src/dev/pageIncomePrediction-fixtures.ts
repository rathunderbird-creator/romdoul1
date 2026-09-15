// DEV-ONLY fixture data for src/dev/pageIncomePrediction-preview.tsx.
//
// Composed from dashboard2-fixtures (45 orders over Sep 1–7, 2026, with real
// product ids) so the monthly ledger, the run-rate projection (6 completed
// days) and COGS all have something to show. Nothing here is imported by the
// production app.
import type { Sale, Product } from '../types';
import { fixtureOrders, fixtureProducts, fixtureNow } from './dashboard2-fixtures';
import { saleDayOf, isRevenueOrder, type PageInputRow, type SiblingRow } from '../pages/pageIncomePrediction/metrics';

export const fixtureMonth = '2026-09';
export { fixtureNow };                       // 2026-09-07T18:00+07:00 → day 7 of 30

// One extra order with a real discount — added here rather than to
// dashboard2-fixtures.ts's own CURRENT_SPECS, which is a known-good
// reference snapshot (its header comment records exact expected KPI totals
// that adding an order would silently invalidate). Without this, every
// fixture order has discount 0, so productIncomePrediction/metrics.ts's
// revenueScale (order.total / Σ item price×qty) is always exactly 1 in both
// dev previews — the discount-allocation logic a live-data check once found
// broken (and fixed) could regress again with no dev-preview signal.
// rawItemSum = 45.00 (NR-6012) + 18.50 (BoomBest LN-716) = 63.50; discount 5
// → total 58.50 → revenueScale ≈ 0.921.
export const fixtureDiscountOrder: Sale = {
    id: 'fixture-discount-order-1',
    items: [
        { ...fixtureProducts[3], quantity: 1 },  // NR-6012 Speaker, 45.00
        { ...fixtureProducts[0], quantity: 1 },  // BoomBest LN-716 Mic, 18.50
    ],
    total: 58.5,
    date: '2026-09-06T15:20:00+07:00',
    discount: 5,
    paymentMethod: 'COD',
    type: 'Online',
    salesman: 'ស៊ី លីហ្សា',
    pageSource: 'CH Sound',
    customer: { name: 'អ្នកភ្ញៀវសាកល្បង', phone: '012 000 000', platform: 'Facebook', page: 'CH Sound' },
    shipping: { company: 'J&T', trackingNumber: 'JT8801234999', status: 'Shipped', cost: 1.5, staffName: '' },
};

export const fixtureSales = [...fixtureOrders, fixtureDiscountOrder];

// Purchase cost ≈ 55 % of the sale price, so margins look realistic.
export const fixtureProductsWithCost: Product[] = fixtureProducts.map(p => ({ ...p, purchaseCost: Math.round(p.price * 55) / 100 }));

export const fixtureShippingRates: Record<string, number> = { 'J&T': 1.5, 'VET': 2, 'Toro Express': 2, 'អ្នកដឹក': 0.5 };

// Settings → Pages. 'Chantha Sound' has no sales this month (row of zeros);
// 'ពិភព ស្ពិកឃ័រ' appears only in sales (→ "not in Settings" marker).
export const fixturePages: string[] = ['រំដួល ស្ពិកឃ័រ', 'CH Sound', 'Chantha Sound'];

export const fixtureInputs: PageInputRow[] = [
    { date: '2026-09-02', page: 'រំដួល ស្ពិកឃ័រ', boostPage: 40, shipping: null },
    { date: '2026-09-05', page: 'រំដួល ស្ពិកឃ័រ', boostPage: 35, shipping: null },
    { date: '2026-09-03', page: 'CH Sound', boostPage: 25, shipping: 12 },   // shipping override
    { date: '2026-09-04', page: '', boostPage: 5, shipping: null },          // unassigned bucket
];

const liveRevenueOfDay = (day: string): number =>
    fixtureSales.filter(o => saleDayOf(o) === day && isRevenueOrder(o)).reduce((s, o) => s + o.total, 0);

// Two frozen days on the sibling Income Prediction page: Sep 1 ties with the
// live figure, Sep 2 differs (→ "≠" badge in the ledger). `shipping` feeds
// the footer's shipping-reconciliation line the same way boostPage feeds
// the existing boost one.
export const fixtureSibling: SiblingRow[] = [
    { date: '2026-09-01', shippedDelivered: liveRevenueOfDay('2026-09-01'), boostPage: 50, shipping: 18, staff: 30 },
    { date: '2026-09-02', shippedDelivered: liveRevenueOfDay('2026-09-02') - 45, boostPage: 40, shipping: 15, staff: 30 },
];
