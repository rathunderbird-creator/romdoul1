// Filter state lives in the URL query string (spec §6.4) so a filtered view
// can be shared and survives a refresh. Pure encode/decode — no router
// dependency, so it's easy to unit-test and reuse from the page container.
import { SORT_KEYS } from './metrics';
import type { SortState, SortKey } from './metrics';

export interface OM2Filters {
    search: string;
    dateStart: string;   // YYYY-MM-DD, '' = open
    dateEnd: string;
    statuses: string[];
    payStatuses: string[];
    shippingCos: string[];
    pages: string[];
    salesman: string;    // '' = All
    noTrackingOnly: boolean; // the summary strip's "No tracking" segment
    sort: SortState | null;
    pageSize: number;
    page: number;
}

// Today's local day (YYYY-MM-DD), evaluated once at module load. An
// unbounded default range meant a fresh page load fetched every order the
// business has ever taken (chunked, but still a full-table scan) just to
// populate the summary strip — this is what made the page slow to load.
// Scoping the default to today matches Dashboard 2's own default and keeps
// the common case (checking today's orders) fast; the date picker still
// reaches any range the user actually wants.
const todayKey = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const DEFAULT_FILTERS: OM2Filters = {
    search: '',
    dateStart: todayKey(),
    dateEnd: todayKey(),
    statuses: [],
    payStatuses: [],
    shippingCos: [],
    pages: [],
    salesman: '',
    noTrackingOnly: false,
    sort: null,
    pageSize: 25,
    page: 1,
};

const csv = (v: string[]): string => v.join(',');
const parseCsv = (v: string | null): string[] => (v ? v.split(',').filter(Boolean) : []);

export const filtersToParams = (f: OM2Filters): URLSearchParams => {
    const p = new URLSearchParams();
    if (f.search) p.set('q', f.search);
    // An explicitly cleared date range must survive the URL round-trip as
    // its own state ("dates=all") — if it were just omitted, decoding would
    // fall back to the today default and the user could never reach an
    // unbounded range.
    if (f.dateStart) p.set('from', f.dateStart);
    if (f.dateEnd) p.set('to', f.dateEnd);
    if (!f.dateStart && !f.dateEnd) p.set('dates', 'all');
    if (f.statuses.length) p.set('status', csv(f.statuses));
    if (f.payStatuses.length) p.set('pay', csv(f.payStatuses));
    if (f.shippingCos.length) p.set('courier', csv(f.shippingCos));
    if (f.pages.length) p.set('page_source', csv(f.pages));
    if (f.salesman) p.set('salesman', f.salesman);
    if (f.noTrackingOnly) p.set('no_tracking', '1');
    if (f.sort) p.set('sort', `${f.sort.key}:${f.sort.direction}`);
    if (f.pageSize !== DEFAULT_FILTERS.pageSize) p.set('size', String(f.pageSize));
    if (f.page !== 1) p.set('page', String(f.page));
    return p;
};

export const paramsToFilters = (params: URLSearchParams): OM2Filters => {
    const sortRaw = params.get('sort');
    let sort: SortState | null = null;
    if (sortRaw) {
        const [key, direction] = sortRaw.split(':');
        if (SORT_KEYS.includes(key as SortKey) && (direction === 'asc' || direction === 'desc')) {
            sort = { key: key as SortKey, direction };
        }
    }
    const size = Number(params.get('size'));
    const page = Number(params.get('page'));
    // Date decoding has three states: explicit from/to → use them;
    // "dates=all" → deliberately unbounded; nothing at all (fresh visit,
    // shared link without dates) → default to today, so a first load never
    // fetches the entire order history just for the summary strip.
    const explicitlyUnbounded = params.get('dates') === 'all';
    const hasAnyDate = params.has('from') || params.has('to');
    const dateStart = explicitlyUnbounded ? '' : (hasAnyDate ? (params.get('from') || '') : DEFAULT_FILTERS.dateStart);
    const dateEnd = explicitlyUnbounded ? '' : (hasAnyDate ? (params.get('to') || '') : DEFAULT_FILTERS.dateEnd);
    return {
        search: params.get('q') || '',
        dateStart,
        dateEnd,
        statuses: parseCsv(params.get('status')),
        payStatuses: parseCsv(params.get('pay')),
        shippingCos: parseCsv(params.get('courier')),
        pages: parseCsv(params.get('page_source')),
        salesman: params.get('salesman') || '',
        noTrackingOnly: params.get('no_tracking') === '1',
        sort,
        pageSize: Number.isFinite(size) && size > 0 ? size : DEFAULT_FILTERS.pageSize,
        page: Number.isFinite(page) && page > 0 ? page : 1,
    };
};

export const activeFilterCount = (f: OM2Filters): number =>
    (f.search ? 1 : 0) + (f.dateStart || f.dateEnd ? 1 : 0) + f.statuses.length + f.payStatuses.length +
    f.shippingCos.length + f.pages.length + (f.salesman ? 1 : 0) + (f.noTrackingOnly ? 1 : 0);

// Removable chip list for the bar under the command row (spec §4.1).
export interface FilterChip { key: string; label: string; onRemove: (f: OM2Filters) => OM2Filters }

export const filterChips = (f: OM2Filters): FilterChip[] => {
    const chips: FilterChip[] = [];
    if (f.search) chips.push({ key: 'search', label: `Search: ${f.search}`, onRemove: prev => ({ ...prev, search: '', page: 1 }) });
    if (f.dateStart || f.dateEnd) {
        const label = f.dateStart && f.dateEnd && f.dateStart !== f.dateEnd ? `${f.dateStart} – ${f.dateEnd}` : (f.dateStart || f.dateEnd);
        chips.push({ key: 'date', label: `Date: ${label}`, onRemove: prev => ({ ...prev, dateStart: '', dateEnd: '', page: 1 }) });
    }
    if (f.salesman) chips.push({ key: 'salesman', label: `Salesman: ${f.salesman}`, onRemove: prev => ({ ...prev, salesman: '', page: 1 }) });
    if (f.noTrackingOnly) chips.push({ key: 'no_tracking', label: 'No tracking', onRemove: prev => ({ ...prev, noTrackingOnly: false, page: 1 }) });
    f.statuses.forEach(s => chips.push({ key: `status:${s}`, label: `Status: ${s}`, onRemove: prev => ({ ...prev, statuses: prev.statuses.filter(x => x !== s), page: 1 }) }));
    f.payStatuses.forEach(s => chips.push({ key: `pay:${s}`, label: `Payment: ${s}`, onRemove: prev => ({ ...prev, payStatuses: prev.payStatuses.filter(x => x !== s), page: 1 }) }));
    f.shippingCos.forEach(s => chips.push({ key: `courier:${s}`, label: `Courier: ${s}`, onRemove: prev => ({ ...prev, shippingCos: prev.shippingCos.filter(x => x !== s), page: 1 }) }));
    f.pages.forEach(s => chips.push({ key: `page:${s}`, label: `Page: ${s}`, onRemove: prev => ({ ...prev, pages: prev.pages.filter(x => x !== s), page: 1 }) }));
    return chips;
};
