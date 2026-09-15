// Month + selected page live in the query string so a drill-down survives a
// refresh, the browser Back button returns to the overview, and a view can be
// shared. Pure encode/decode — no router dependency.
//
//   ?month=2026-09            overview for September 2026
//   ?month=2026-09&page=CH%20Sound   that page's daily ledger
//   ?month=2026-09&page=      the "(unassigned)" bucket (key '')
import { isMonthKey, monthKeyOf } from './metrics';
import type { PageIncomeUrlState } from './types';

export const paramsToState = (params: URLSearchParams, now: Date): PageIncomeUrlState => {
    const raw = params.get('month') || '';
    return {
        // A malformed month (hand-edited URL, Firefox's free-text month input)
        // falls back to the current month rather than an empty screen.
        month: isMonthKey(raw) ? raw : monthKeyOf(now),
        page: params.has('page') ? (params.get('page') || '') : null,
    };
};

export const stateToParams = (state: PageIncomeUrlState): URLSearchParams => {
    const p = new URLSearchParams();
    p.set('month', state.month);
    if (state.page !== null) p.set('page', state.page);
    return p;
};
