// DEV-ONLY fixture data for src/dev/staffIncomePrediction-preview.tsx.
//
// Reuses the same extended fixtureSales as productIncomePrediction-fixtures
// (dashboard2-fixtures' orders + the one discount-bearing order — see
// pageIncomePrediction-fixtures.ts's own comment for why) so all three
// derived "Income Prediction" dev previews stay consistent with each other.
import type { Product, User } from '../types';
import { rangeOfMonth } from '../utils/dateRange';
import { fixtureProducts, fixtureNow } from './dashboard2-fixtures';
import { fixtureSales } from './pageIncomePrediction-fixtures';

export const fixtureMonth = '2026-09';
// The screens work on an inclusive date range; the fixture's default is the
// whole of fixtureMonth (what the month-only screens used to show).
export const fixtureRange = rangeOfMonth(fixtureMonth);
export { fixtureNow, fixtureSales };

export const fixtureProductsWithCost: Product[] = fixtureProducts.map(p => ({ ...p, purchaseCost: Math.round(p.price * 55) / 100 }));

const uniqueSalesmen = Array.from(new Set(fixtureSales.map(o => o.salesman).filter((s): s is string => !!s)));

// Settings → Salesmen roster: every real salesman except one (dropped to
// exercise the zero-sales "nothing sold" row) plus one name NOT in the
// fixture sales at all — mirrors Prediction by Page's fixture conventions.
export const fixtureConfigSalesmen: string[] = [...uniqueSalesmen.slice(0, -1), 'ចាន់ សុភា (គ្មានការលក់)'];

// One salesman present in sales but missing from configSalesmen above → the
// "not in Settings" badge, exactly like the analogous Page/Product fixtures.
const droppedFromConfig = uniqueSalesmen[uniqueSalesmen.length - 1];

// Targets: two of the three real salesmen have a monthly target set (one
// comfortably ahead, one behind); the third and the config-only name have
// none, to exercise the "no target set" cell state. (monthlyTarget is a
// MONTHLY figure — the screen pro-rates it to whatever range is selected.)
export const fixtureUsers: User[] = uniqueSalesmen.map((name, i) => ({
    id: `fixture-user-${i}`,
    name,
    email: `${i}@example.com`,
    roleId: 'salesman',
    monthlyTarget: name === droppedFromConfig ? undefined : (i === 0 ? 500 : i === 1 ? 2000 : undefined),
}));
