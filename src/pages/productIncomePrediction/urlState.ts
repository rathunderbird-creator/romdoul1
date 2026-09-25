// Date range + selected product live in the query string — same rationale and
// shape as ../pageIncomePrediction/urlState.ts: a drill-down survives a
// refresh, the browser Back button returns to the overview, and a view can
// be shared. Pure encode/decode — no router dependency.
//
//   ?month=2026-09                     overview for September 2026 (a whole month)
//   ?from=2026-09-05&to=2026-09-15     overview for any other inclusive range
//   ?month=2026-09&product=1771290...  that product's daily ledger
//   ?month=2026-09&product=            the "unknown product" bucket
//
// A whole calendar month is always written as `month=YYYY-MM` (short URLs, and
// every link made before date ranges existed keeps working); any other range
// is written as `from`/`to`.
import { readRangeParams, writeRangeParams } from '../../utils/dateRange';
import type { ProductIncomeUrlState } from './types';

// Range parsing/serialising (legacy ?month=, from/to, sanitising, and treating an
// empty from=/to= as absent) lives in src/utils/dateRange.ts, shared by all three
// routed Income Prediction screens.
export const paramsToState = (params: URLSearchParams, now: Date): ProductIncomeUrlState => ({
    range: readRangeParams(params, now),
    productId: params.has('product') ? (params.get('product') || '') : null,
});

export const stateToParams = (state: ProductIncomeUrlState): URLSearchParams => {
    const p = new URLSearchParams();
    writeRangeParams(p, state.range);
    if (state.productId !== null) p.set('product', state.productId);
    return p;
};
