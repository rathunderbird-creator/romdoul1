// PostgREST silently truncates any select at the API max-rows cap (~1000 rows,
// HTTP 200, no error), so an unbounded query quietly undercounts once a table
// or date range grows past it. This pages through in sub-cap chunks instead.
//
// `buildQuery` must build a FRESH query for the given window each call (query
// builders are single-use thenables) and MUST include a deterministic order —
// add `.order('id', { ascending: true })` (or another unique column) before
// `.range(from, to)`, otherwise rows can shift between chunk requests and be
// skipped or double-counted.
export async function fetchAll<T = any>(
    buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
    chunk = 1000
): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; from < 1000000; from += chunk) {
        const { data, error } = await buildQuery(from, from + chunk - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < chunk) break;
    }
    return rows;
}
