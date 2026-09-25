// Pure calendar-range helpers shared by the four Income Prediction screens
// (classic, by Page, by Product, by Staff). No React, no Supabase, no
// Date.now(): `now` is always passed in so previews stay deterministic.
//
// A DateRange is an INCLUSIVE span of browser-local calendar days, both ends
// 'YYYY-MM-DD' (the business runs in UTC+7, same convention as the screens'
// month bounds). The screens used to be month-only; a whole calendar month is
// just the range [YYYY-MM-01, YYYY-MM-<last>], and every helper here is written
// so that case reproduces the old month behaviour EXACTLY (see completedWindow
// and monthEquivalents).

export interface DateRange {
    from: string;   // YYYY-MM-DD, inclusive
    to: string;     // YYYY-MM-DD, inclusive
}

// Longest range the screens will load. Sales are fetched with their line items
// (~0.9 s per 1,000 orders), so an unbounded "lifetime" range would stall the
// page; a year is the practical ceiling.
export const MAX_RANGE_DAYS = 366;

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const dayKeyFromDate = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const monthKeyFromDate = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

/** Local midnight of a YYYY-MM-DD key. */
export const parseDay = (key: string): Date => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
};

/** True for a real calendar day in YYYY-MM-DD form (rejects 2026-02-30). */
// Deliberately a plain boolean, not a type predicate: '' (the picker's open end)
// is a string that is NOT a day key, and a predicate would mistype it as null.
export const isDayKey = (s: string | null | undefined): boolean => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    return dayKeyFromDate(parseDay(s)) === s;
};

export const isMonthKey = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export const addDays = (key: string, n: number): string => {
    const [y, m, d] = key.split('-').map(Number);
    return dayKeyFromDate(new Date(y, m - 1, d + n));
};

/** Whole days from `a` to `b` (b − a). Uses UTC arithmetic so DST can't skew it. */
export const daysBetween = (a: string, b: string): number => {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

export const rangeLength = (r: DateRange): number => daysBetween(r.from, r.to) + 1;

export const dayKeysOfRange = (r: DateRange): string[] =>
    Array.from({ length: rangeLength(r) }, (_, i) => addDays(r.from, i));

/** Lexical compare is correct for zero-padded YYYY-MM-DD. */
export const inRange = (day: string, r: DateRange): boolean => day >= r.from && day <= r.to;

export const daysInMonthOf = (month: string): number => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
};

export const rangeOfMonth = (month: string): DateRange => ({
    from: `${month}-01`,
    to: `${month}-${pad2(daysInMonthOf(month))}`,
});

/** 'YYYY-MM' if the range is exactly one whole calendar month, else null. */
export const wholeMonthOf = (r: DateRange): string | null => {
    const month = r.from.slice(0, 7);
    if (!isMonthKey(month)) return null;
    const whole = rangeOfMonth(month);
    return whole.from === r.from && whole.to === r.to ? month : null;
};

/** Every calendar month the range touches, oldest first. */
export const rangeMonths = (r: DateRange): string[] => {
    const out: string[] = [];
    let cursor = r.from.slice(0, 7);
    const last = r.to.slice(0, 7);
    while (cursor <= last) {
        out.push(cursor);
        const [y, m] = cursor.split('-').map(Number);
        cursor = monthKeyFromDate(new Date(y, m, 1));
    }
    return out;
};

export const defaultRange = (now: Date): DateRange => rangeOfMonth(monthKeyFromDate(now));

// ─── Query bounds ─────────────────────────────────────────────────────────

export interface RangeBounds {
    startIso: string;   // local midnight of `from`, as an instant
    endIso: string;     // local midnight of the day AFTER `to` (exclusive)
    from: string;       // for DATE-typed columns: .gte('date', from)
    to: string;         //                         .lte('date', to)
    days: number;
}

export const rangeBounds = (r: DateRange): RangeBounds => ({
    startIso: parseDay(r.from).toISOString(),
    endIso: parseDay(addDays(r.to, 1)).toISOString(),
    from: r.from,
    to: r.to,
    days: rangeLength(r),
});

/** The range cut into per-calendar-month windows (used for parallel fetching). */
export const monthWindowsOf = (r: DateRange): DateRange[] =>
    rangeMonths(r).map(month => {
        const whole = rangeOfMonth(month);
        return { from: whole.from < r.from ? r.from : whole.from, to: whole.to > r.to ? r.to : whole.to };
    });

// ─── Where "now" sits ─────────────────────────────────────────────────────

export type RangeState = 'past' | 'current' | 'future';

export const rangeStateOf = (r: DateRange, now: Date): RangeState => {
    const today = dayKeyFromDate(now);
    return r.to < today ? 'past' : r.from > today ? 'future' : 'current';
};

/**
 * The days a run-rate projection may use — every day of the range that is
 * strictly before today (today is still in progress). For a whole current
 * month this is exactly `now.getDate() - 1` days, i.e. the old behaviour.
 */
export interface CompletedWindow {
    total: number;                 // days in the range
    completed: number;             // full days already behind us
    lastCompleted: string | null;  // last such day; null when none
}

export const completedWindow = (r: DateRange, now: Date): CompletedWindow => {
    const total = rangeLength(r);
    const state = rangeStateOf(r, now);
    if (state === 'past') return { total, completed: total, lastCompleted: r.to };
    if (state === 'future') return { total, completed: 0, lastCompleted: null };
    const today = dayKeyFromDate(now);
    const completed = daysBetween(r.from, today);   // days from `from` up to (not incl.) today
    return { total, completed, lastCompleted: completed > 0 ? addDays(today, -1) : null };
};

/** 1-based position of today inside the range; null unless the range contains today. */
export const dayNumberOf = (r: DateRange, now: Date): number | null =>
    rangeStateOf(r, now) === 'current' ? daysBetween(r.from, dayKeyFromDate(now)) + 1 : null;

// ─── Month equivalents (for pro-rating a monthly figure to a range) ───────

/**
 * How many "months" the range is worth: each month contributes
 * (days of it inside the range) / (days in that month). A whole calendar
 * month is exactly 1, Sep 1–15 is 0.5, Aug 20–Sep 10 is 12/31 + 10/30.
 * Used to pro-rate Staff's monthly target to an arbitrary range.
 */
export const monthEquivalents = (r: DateRange): number =>
    monthWindowsOf(r).reduce((sum, w) => sum + rangeLength(w) / daysInMonthOf(w.from.slice(0, 7)), 0);

// ─── Navigation & validation ──────────────────────────────────────────────

/**
 * Previous/next period. A whole calendar month steps by month (so the default
 * view keeps behaving like the old month arrows); anything else steps by its
 * own length, so Sep 1–10 → Sep 11–20.
 */
export const shiftRange = (r: DateRange, dir: 1 | -1): DateRange => {
    const month = wholeMonthOf(r);
    if (month) {
        const [y, m] = month.split('-').map(Number);
        return rangeOfMonth(monthKeyFromDate(new Date(y, m - 1 + dir, 1)));
    }
    const len = rangeLength(r);
    return dir === 1
        ? { from: addDays(r.to, 1), to: addDays(r.to, len) }
        : { from: addDays(r.from, -len), to: addDays(r.from, -1) };
};

export interface SanitizedRange {
    range: DateRange;
    clamped: boolean;   // true when the request was trimmed: longer than MAX_RANGE_DAYS, "Lifetime", or an end date with no start
}

/**
 * Turn whatever a picker / URL produced into a range the screens can load.
 *  - unparseable or missing → the current month (nothing was asked for);
 *  - reversed → swapped;
 *  - open-ended ("Lifetime" gives two empty strings) or longer than
 *    MAX_RANGE_DAYS → the most recent MAX_RANGE_DAYS days, `clamped: true`;
 *  - a start with no end → that day through today (a future start → that day
 *    alone), `clamped: false` — nothing was limited.
 */
export const sanitizeRange = (from: string | null | undefined, to: string | null | undefined, now: Date): SanitizedRange => {
    const today = dayKeyFromDate(now);
    const hasFrom = isDayKey(from);
    const hasTo = isDayKey(to);

    if (!hasFrom && !hasTo) {
        // Both empty is the picker's "Lifetime": honour the intent as far as we
        // can (the latest year); anything else unparseable falls back to the month.
        return (from === '' && to === '') ? clampTo({ from: addDays(today, -(MAX_RANGE_DAYS - 1)), to: today }, true) : { range: defaultRange(now), clamped: false };
    }
    let a = hasFrom ? (from as string) : addDays(to as string, -(MAX_RANGE_DAYS - 1));
    let b = hasTo ? (to as string) : (a > today ? a : today);
    if (a > b) [a, b] = [b, a];
    // Only a MISSING start counts as trimmed (its 366-day span was invented). A
    // start-only pick — the picker's mobile two-tap flow sends {start, end:''} —
    // is simply "from that day to today": nothing was limited, so no note; clampTo
    // still flags it if that span itself is over-long.
    return clampTo({ from: a, to: b }, !hasFrom);
};

// ─── URL query string (shared by the three routed screens) ────────────────

/**
 * The range a screen's query string asks for. A valid legacy `?month=YYYY-MM`
 * wins (old links keep working); otherwise `?from=&to=` go through
 * sanitizeRange. Absent, malformed or EMPTY values fall back to the current
 * month — an empty `from=`/`to=` is deliberately treated as absent, because
 * passing '' straight through would hit sanitizeRange's "Lifetime" branch and
 * a hand-edited URL must not silently load a year of data.
 */
export const readRangeParams = (params: URLSearchParams, now: Date): DateRange => {
    const month = params.get('month') || '';
    if (isMonthKey(month)) return rangeOfMonth(month);
    return sanitizeRange(params.get('from') || null, params.get('to') || null, now).range;
};

/** Write a range: a whole calendar month as the short `month=YYYY-MM`, anything else as `from`/`to`. */
export const writeRangeParams = (params: URLSearchParams, range: DateRange): void => {
    const month = wholeMonthOf(range);
    if (month) {
        params.set('month', month);
    } else {
        params.set('from', range.from);
        params.set('to', range.to);
    }
};

const clampTo = (r: DateRange, alreadyClamped: boolean): SanitizedRange => {
    if (rangeLength(r) <= MAX_RANGE_DAYS) return { range: r, clamped: alreadyClamped };
    return { range: { from: addDays(r.to, -(MAX_RANGE_DAYS - 1)), to: r.to }, clamped: true };
};
