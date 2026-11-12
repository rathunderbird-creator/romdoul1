// Pure helpers for Backup/Restore (audit APP-3) — kept free of Supabase and
// React so tests/backup-restore.test.mjs can run them against PGlite.
//
// The hard part of restore is chart_of_accounts: every database seeds it with
// gen_random_uuid() ids (migrations/full_schema.sql), so the SOURCE store's
// account UUIDs never exist in the target. journal_entry_lines.account_id
// references chart_of_accounts(id), which means journal lines can only be
// restored after remapping each account_id to the TARGET's row with the same
// account_code (and inserting any custom accounts the target does not have).

// The tables Backup exports and Restore writes back, parents before
// children (sales before sale_items, warehouses before warehouse_stock,
// journal_entries before their lines) so restore inserts in this order
// without FK failures. inventory_items (the FIFO layers, after products and
// sales, which it references) comes with the stock it costs: stock without
// its layers would leave the pool short of products.stock.
export const BACKUP_TABLES = [
    'products', 'customers', 'users', 'warehouses', 'warehouse_stock',
    'sales', 'sale_items', 'inventory_items', 'restocks', 'transactions',
    'chart_of_accounts', 'journal_entries', 'journal_entry_lines',
    'telegram_notifications'
] as const;

export interface BackupAccountRow {
    id: string;
    account_code: string;
    [k: string]: unknown;
}

// Maps the backup's account ids onto the target store's. Accounts the target
// already has (same account_code — the seeded nine always match) are remapped
// onto the target's row; accounts it lacks (custom ones) are returned in
// `toInsert` keeping their original ids, which then map onto themselves.
export function buildAccountIdMap(
    backupAccounts: BackupAccountRow[],
    targetAccounts: Array<{ id: string; account_code: string }>
): { idMap: Record<string, string>; toInsert: BackupAccountRow[] } {
    const targetByCode = new Map(targetAccounts.map(a => [a.account_code, a.id]));
    const idMap: Record<string, string> = {};
    const toInsert: BackupAccountRow[] = [];
    for (const acc of backupAccounts) {
        if (!acc || typeof acc !== 'object' || !acc.id) continue;
        const targetId = targetByCode.get(acc.account_code);
        if (targetId !== undefined) {
            idMap[acc.id] = targetId;
        } else {
            idMap[acc.id] = acc.id;
            toInsert.push(acc);
        }
    }
    return { idMap, toInsert };
}

// journal_entry_lines rows with account_id rewritten through the map. An id
// the map does not know is left as-is (the insert will then fail loudly
// instead of silently pointing a line at the wrong account).
export function remapAccountIds<T extends { account_id?: unknown }>(
    rows: T[],
    idMap: Record<string, string>
): T[] {
    return rows.map(row => {
        const id = row?.account_id;
        if (typeof id === 'string' && idMap[id] !== undefined && idMap[id] !== id) {
            return { ...row, account_id: idMap[id] };
        }
        return row;
    });
}

// The column name an insert error complains about, or null when the error is
// about something else. Backups carry rows exactly as PostgREST served them,
// so a backup from a store that ran an extra column migration (e.g.
// add_journal_entry_line_description.sql) restored into a store that did not
// fails with one of:
//   PostgREST:  "Could not find the 'description' column of '...' in the schema cache"
//   PostgreSQL: column "description" of relation "..." does not exist
export function missingColumnFromError(message: string | undefined | null): string | null {
    if (!message) return null;
    let m = /Could not find the '([^']+)' column/i.exec(message);
    if (m) return m[1];
    m = /column "([^"]+)" of relation "[^"]+" does not exist/i.exec(message);
    if (m) return m[1];
    return null;
}

// All rows with one column removed (for the strip-and-retry insert loop).
export function stripColumn<T extends Record<string, unknown>>(rows: T[], column: string): T[] {
    return rows.map(row => {
        if (row && typeof row === 'object' && column in row) {
            const { [column]: _dropped, ...rest } = row;
            void _dropped;
            return rest as unknown as T;
        }
        return row;
    });
}
