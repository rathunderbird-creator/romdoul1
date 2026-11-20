// Sales Setup › Rejection Reasons: why a retail order ended Returned,
// Cancelled or ReStock (app_config rejectionReasons; the order keeps its
// pick in sales.return_reason, see migrations/add_sales_return_reason.sql).
// Pure helpers so the list rules are unit-tested (tests/rejection-reasons.test.mjs).
import type { ConfigOp } from './configOps';

// Offered until a store edits its own list (the key is then saved whole).
export const DEFAULT_REJECTION_REASONS = [
    'Customer refused',
    'Phone off / unreachable',
    'Wrong address',
    'Changed mind',
    'Damaged on delivery',
    'Duplicate order',
];

// The statuses an order can carry a reason for.
export const REASON_STATUSES = ['Returned', 'Cancelled', 'ReStock'];
export const reasonApplies = (status?: string | null) => REASON_STATUSES.includes(status || '');

// The list the app offers: the saved one, or the defaults while none is saved.
export const rejectionReasonList = (saved: unknown): string[] =>
    Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : DEFAULT_REJECTION_REASONS;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The config op for an add or a remove, or null when nothing changes (empty
// name, a duplicate add, removing a name that isn't listed). While no list is
// saved the defaults are on screen, so the first edit saves the whole list
// ('set') — an append/removeItems on the missing key would drop the defaults.
export const rejectionReasonOp = (saved: unknown, action: 'add' | 'remove', name: string): ConfigOp | null => {
    const clean = name.trim();
    if (!clean) return null;
    const list = rejectionReasonList(saved);
    if (action === 'add') {
        if (list.some(r => same(r, clean))) return null;
        return Array.isArray(saved) ? { op: 'append', items: [clean] } : { op: 'set', value: [...list, clean] };
    }
    const matches = list.filter(r => same(r, clean));
    if (matches.length === 0) return null;
    return Array.isArray(saved) ? { op: 'removeItems', values: matches } : { op: 'set', value: list.filter(r => !same(r, clean)) };
};

// The options a reason picker shows: the list, plus the order's current
// reason when it is no longer listed (removed later, or typed as Other).
export const reasonOptions = (list: string[], current?: string | null): string[] => {
    const c = (current || '').trim();
    return c && !list.some(r => same(r, c)) ? [...list, c] : list;
};
