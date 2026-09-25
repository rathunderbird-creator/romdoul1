// Date range + selected staff member live in the query string — same shape as
// ../pageIncomePrediction/urlState.ts and ../productIncomePrediction/
// urlState.ts: a drill-down survives a refresh, the browser Back button
// returns to the overview, and a view can be shared.
//
//   ?month=2026-09                  overview for the whole of September 2026
//   ?from=2026-09-05&to=2026-09-15  overview for an arbitrary inclusive range
//   ?month=2026-09&staff=Sokheng    that salesperson's daily ledger
//   ?month=2026-09&staff=           the "unassigned" bucket (no salesman set)
//
// A whole calendar month is written as `month=YYYY-MM` (short URLs, and links
// from before ranges existed keep working); any other range as `from`/`to`.
// A missing or unparseable range is the current month.
import { readRangeParams, writeRangeParams } from '../../utils/dateRange';
import type { StaffIncomeUrlState } from './types';

// Range parsing/serialising (legacy ?month=, from/to, sanitising, and treating an
// empty from=/to= as absent) lives in src/utils/dateRange.ts, shared by all three
// routed Income Prediction screens.
export const paramsToState = (params: URLSearchParams, now: Date): StaffIncomeUrlState => ({
    range: readRangeParams(params, now),
    staff: params.has('staff') ? (params.get('staff') || '') : null,
});

export const stateToParams = (state: StaffIncomeUrlState): URLSearchParams => {
    const p = new URLSearchParams();
    writeRangeParams(p, state.range);
    if (state.staff !== null) p.set('staff', state.staff);
    return p;
};
