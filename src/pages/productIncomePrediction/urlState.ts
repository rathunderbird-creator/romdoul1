// Month + selected product live in the query string — same rationale and
// shape as ../pageIncomePrediction/urlState.ts: a drill-down survives a
// refresh, the browser Back button returns to the overview, and a view can
// be shared. Pure encode/decode — no router dependency.
//
//   ?month=2026-09                     overview for September 2026
//   ?month=2026-09&product=1771290...  that product's daily ledger
//   ?month=2026-09&product=            the "unknown product" bucket
import { isMonthKey, monthKeyOf } from './metrics';
import type { ProductIncomeUrlState } from './types';

export const paramsToState = (params: URLSearchParams, now: Date): ProductIncomeUrlState => {
    const raw = params.get('month') || '';
    return {
        month: isMonthKey(raw) ? raw : monthKeyOf(now),
        productId: params.has('product') ? (params.get('product') || '') : null,
    };
};

export const stateToParams = (state: ProductIncomeUrlState): URLSearchParams => {
    const p = new URLSearchParams();
    p.set('month', state.month);
    if (state.productId !== null) p.set('product', state.productId);
    return p;
};
