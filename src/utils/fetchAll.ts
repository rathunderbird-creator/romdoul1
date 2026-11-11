// PostgREST silently truncates any select at the API max-rows cap (~1000 rows,
// HTTP 200, no error), so an unbounded query quietly undercounts once a table
// or date range grows past it. This pages through in sub-cap chunks instead.
//
// `buildQuery` must build a FRESH query for the given window each call (query
// builders are single-use thenables) and MUST include a deterministic order —
// add `.order('id', { ascending: true })` (or another unique column) as the
// LAST order before `.range(from, to)`, otherwise rows can shift between chunk
// requests and be skipped or double-counted.
//
// Offset paging is still not a snapshot: a row inserted or deleted while the
// loop runs can shift later pages by one. To tolerate that, rows are merged by
// their unique id (`idKey`, default 'id', when the selected columns include
// it): a row seen twice across page boundaries is kept once, so concurrent
// writes can at worst drop a row that was moving anyway — never double-count.
export interface FetchAllOptions {
    /** Names the call site in the row-ceiling warning. */
    label?: string;
    /**
     * Unique column used to merge rows repeated across page boundaries.
     * Defaults to 'id'; rows without that key pass through unmerged.
     * Pass null to disable merging.
     */
    idKey?: string | null;
    /** Hard ceiling on fetched rows — a guard against runaway loops. */
    maxRows?: number;
}

export async function fetchAll<T = any>(
    buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
    chunk = 1000,
    opts: FetchAllOptions = {}
): Promise<T[]> {
    const maxRows = Math.max(chunk, opts.maxRows ?? 50000);
    const idKey = opts.idKey === undefined ? 'id' : opts.idKey;
    const rows: T[] = [];
    const seen = idKey ? new Set<unknown>() : null;
    for (let from = 0; ; from += chunk) {
        const { data, error } = await buildQuery(from, from + chunk - 1);
        if (error) throw error;
        const page = data ?? [];
        for (const row of page) {
            if (seen && row && typeof row === 'object') {
                const id = (row as Record<string, unknown>)[idKey as string];
                if (id !== undefined && id !== null) {
                    if (seen.has(id)) continue;
                    seen.add(id);
                }
            }
            rows.push(row);
        }
        if (page.length < chunk) return rows;
        if (from + chunk >= maxRows) {
            console.warn(`fetchAll${opts.label ? ` (${opts.label})` : ''}: stopped at the ${maxRows}-row ceiling — results may be incomplete`);
            return rows;
        }
    }
}
