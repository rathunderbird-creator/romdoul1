// Sales Setup › Rejection Reasons: why a retail order ended Returned,
// Cancelled or ReStock (app_config rejectionReasons; the order keeps its
// pick in sales.return_reason, see migrations/add_sales_return_reason.sql).
// Pure helpers so the list rules are unit-tested (tests/rejection-reasons.test.mjs);
// the defaults-until-saved list rules are shared (defaultedList.ts).
import type { ConfigOp } from './configOps';
import { defaultedList, defaultedListOp } from './defaultedList';

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
export const rejectionReasonList = (saved: unknown): string[] => defaultedList(saved, DEFAULT_REJECTION_REASONS);

// The config op for an add or a remove, or null when nothing changes; the
// first edit of a store with no saved list saves the whole list (defaultedListOp).
export const rejectionReasonOp = (saved: unknown, action: 'add' | 'remove', name: string): ConfigOp | null =>
    defaultedListOp(saved, DEFAULT_REJECTION_REASONS, action, name);

// The options a reason picker shows: the list, plus the order's current
// reason when it isn't listed exactly (removed later, typed as Other, or a
// different spelling) — a <select> only shows a value it has an option for.
export const reasonOptions = (list: string[], current?: string | null): string[] => {
    const c = current || '';
    return c.trim() && !list.includes(c) ? [...list, c] : list;
};
