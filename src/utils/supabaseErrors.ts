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

export const errMessage = (e: unknown): string => (e as { message?: string })?.message || String(e);
