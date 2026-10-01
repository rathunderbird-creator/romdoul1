// Range, tab and the daily filters live in the query string so a view
// survives a refresh and can be shared. Pure encode/decode.
//
//   ?month=2026-09                 daily tracker for September 2026
//   ?from=2026-09-05&to=2026-09-15&tab=summary
//   ?month=2026-09&page=CH%20Sound&product=1774860364463
import { readRangeParams, writeRangeParams } from '../../utils/dateRange';
import { CPA_TABS, type CpaTab, type CpaUrlState } from './types';

export const paramsToState = (params: URLSearchParams, now: Date): CpaUrlState => {
    const tab = params.get('tab') as CpaTab | null;
    return {
        range: readRangeParams(params, now),
        tab: tab && CPA_TABS.includes(tab) ? tab : 'daily',
        // '' is a real filter value for both: the no-page bucket / the
        // unknown-product bucket (line items whose product was deleted).
        page: params.has('page') ? (params.get('page') || '') : null,
        product: params.has('product') ? (params.get('product') || '') : null,
    };
};

export const stateToParams = (state: CpaUrlState): URLSearchParams => {
    const p = new URLSearchParams();
    writeRangeParams(p, state.range);
    if (state.tab !== 'daily') p.set('tab', state.tab);
    if (state.page !== null) p.set('page', state.page);
    if (state.product !== null) p.set('product', state.product);
    return p;
};
