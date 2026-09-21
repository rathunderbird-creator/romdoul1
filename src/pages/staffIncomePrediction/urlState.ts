// Month + selected staff member live in the query string — same shape as
// ../pageIncomePrediction/urlState.ts and ../productIncomePrediction/
// urlState.ts: a drill-down survives a refresh, the browser Back button
// returns to the overview, and a view can be shared.
//
//   ?month=2026-09                  overview for September 2026
//   ?month=2026-09&staff=Sokheng    that salesperson's daily ledger
//   ?month=2026-09&staff=           the "unassigned" bucket (no salesman set)
import { isMonthKey, monthKeyOf } from './metrics';
import type { StaffIncomeUrlState } from './types';

export const paramsToState = (params: URLSearchParams, now: Date): StaffIncomeUrlState => {
    const raw = params.get('month') || '';
    return {
        month: isMonthKey(raw) ? raw : monthKeyOf(now),
        staff: params.has('staff') ? (params.get('staff') || '') : null,
    };
};

export const stateToParams = (state: StaffIncomeUrlState): URLSearchParams => {
    const p = new URLSearchParams();
    p.set('month', state.month);
    if (state.staff !== null) p.set('staff', state.staff);
    return p;
};
