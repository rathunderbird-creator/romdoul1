import { fetchAll } from './fetchAll';
import { monthWindowsOf, rangeBounds, type DateRange } from './dateRange';

// Fetch a (possibly multi-month) date range of a big table — `sales` with its
// line items — as one parallel fetchAll per calendar-month window instead of one
// long sequential crawl. Measured ~0.9 s per 1,000 orders, so a year on the
// busiest instance is ~20 s sequential but a few seconds this way.
//
// `buildQuery(startIso, endIso)` must return a `(from, to) => query` builder
// exactly as fetchAll expects (fresh query per call, a deterministic `.order(...)`
// before `.range(from, to)`), bounded to [startIso, endIso). The windows are
// disjoint and each covers whole local days, so no row is fetched twice.
// Rows come back window by window (oldest month first); callers bucket by day,
// so overall order doesn't matter.
export async function fetchInMonthWindows<T = any>(
    range: DateRange,
    buildQuery: (startIso: string, endIso: string) => (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
    concurrency = 4
): Promise<T[]> {
    const windows = monthWindowsOf(range).map(w => rangeBounds(w));
    const results: T[][] = new Array(windows.length);
    let next = 0;
    const worker = async () => {
        while (true) {
            const i = next++;
            if (i >= windows.length) return;
            results[i] = await fetchAll<T>(buildQuery(windows[i].startIso, windows[i].endIso));
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, windows.length) }, worker));
    return results.flat();
}
