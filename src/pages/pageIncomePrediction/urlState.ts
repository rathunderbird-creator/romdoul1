// Date range + selected page live in the query string so a drill-down survives
// a refresh, the browser Back button returns to the overview, and a view can be
// shared. Pure encode/decode — no router dependency.
//
//   ?month=2026-09            overview for September 2026 (a WHOLE calendar month
//                             keeps the short legacy form, so old links still work)
//   ?from=2026-09-05&to=2026-09-15   overview for any other inclusive range
//   ?month=2026-09&page=CH%20Sound   that page's daily ledger
//   ?month=2026-09&page=      the "(unassigned)" bucket (key '')
import { readRangeParams, writeRangeParams } from '../../utils/dateRange';
import type { PageIncomeUrlState } from './types';

// Range parsing/serialising (legacy ?month=, from/to, sanitising, and treating an
// empty from=/to= as absent) lives in src/utils/dateRange.ts, shared by all three
// routed Income Prediction screens.
export const paramsToState = (params: URLSearchParams, now: Date): PageIncomeUrlState => ({
    range: readRangeParams(params, now),
    page: params.has('page') ? (params.get('page') || '') : null,
});

export const stateToParams = (state: PageIncomeUrlState): URLSearchParams => {
    const p = new URLSearchParams();
    writeRangeParams(p, state.range);
    if (state.page !== null) p.set('page', state.page);
    return p;
};
