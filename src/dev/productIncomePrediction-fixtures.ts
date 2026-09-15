// DEV-ONLY fixture data for src/dev/productIncomePrediction-preview.tsx.
//
// Reuses dashboard2-fixtures' orders (Sep 1-7, 2026, real product ids) —
// same choice made for pageIncomePrediction-fixtures.ts and for the same
// reason: a multi-day month with real product ids is needed for a
// meaningful monthly ledger and run-rate projection, which the
// single-day/no-cost ordersManagement2 fixtures can't provide.
import type { Product } from '../types';
import { fixtureProducts, fixtureNow } from './dashboard2-fixtures';
// The one extra discounted order lives in pageIncomePrediction-fixtures.ts
// (see its own comment) rather than being duplicated here — it's what makes
// bucketByProductAndDay's discount-allocation scaling (revenueScale) visibly
// exercise a non-1 value in this preview too, instead of only on real data.
import { fixtureSales } from './pageIncomePrediction-fixtures';

export const fixtureMonth = '2026-09';
export { fixtureNow, fixtureSales };

// Purchase cost ≈ 55% of the sale price, matching pageIncomePrediction's fixtures.
export const fixtureProductsWithCost: Product[] = fixtureProducts.map(p => ({ ...p, purchaseCost: Math.round(p.price * 55) / 100 }));
