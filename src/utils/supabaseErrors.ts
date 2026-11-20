// PostgREST's answers for a table that isn't in its schema cache — i.e. a
// migration that hasn't been run yet on one of the hand-migrated instances
// (see migrations/db_instances.json).
export const isMissingTableError = (e: unknown): boolean => {
    const err = e as { code?: string; message?: string } | null;
    return !!err && (
        err.code === '42P01' || err.code === 'PGRST204' || err.code === 'PGRST205' ||
        /schema cache|does not exist/i.test(err.message || '')
    );
};

// PostgREST's answers for a column a migration hasn't added yet — on a select
// (42703 "column … does not exist") or a write (PGRST204 "could not find the
// '…' column"). Only true when the message names that column.
export const isMissingColumnError = (e: unknown, column: string): boolean => {
    const err = e as { code?: string; message?: string } | null;
    if (!err) return false;
    const code = String(err.code || '');
    const msg = String(err.message || '');
    return (code === '42703' || code === 'PGRST204' || /does not exist|could not find/i.test(msg)) && msg.includes(column);
};

export const errMessage =(e: unknown): string => (e as { message?: string })?.message || String(e);

// A FIFO read RPC (order_cogs, fifo_peek, …) the store cannot answer yet: the
// function is missing (PGRST202 / 42883, as isRpcMissingError in StoreContext),
// or its guarded wrapper (add_session_guards.sql) answers "FIFO costing is not
// set up" because add_fifo_costing.sql or the FIFO packs are not on the store.
// The caller keeps its pre-FIFO calculation. Anything else is a real failure.
export const isFifoReadMissingError = (e: unknown): boolean => {
    const err = e as { code?: string; message?: string } | null;
    if (!err) return false;
    const code = String(err.code || '');
    const msg = String(err.message || '');
    return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(msg)
        || /FIFO costing is not set up/i.test(msg);
};
