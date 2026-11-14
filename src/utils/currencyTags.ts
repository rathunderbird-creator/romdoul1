// Writes the riel (KHR) fields — currency, original_amount, exchange_rate —
// next to a payment row (migrations/add_khr_currency.sql). Two kinds of
// write:
//   * rows the app inserts / updates itself carry the fields in the same
//     write (insertWithCurrency / updateWithCurrency);
//   * rows a DB function inserts (set_order_payment, create_retail_order,
//     record_customer_payment, record_supplier_payments) are tagged by the
//     client afterwards (tagRows, tagTransactionsAndEntries) — the same
//     pattern as CustomerPayment's syncTransactionMethod. A USD payment is
//     not tagged: NULL currency already means USD.
// A store that has not run the migration answers "column does not exist":
// the fields are then dropped silently (and not sent again this session),
// so a payment never fails over its riel details. Tagging never throws.
import { supabase } from '../lib/supabase';
import { CURRENCY_KEYS, isMissingCurrencyColumnError, stripCurrency, type Currency, type MoneyMeta } from './currency';
import { pickCashBankAccount } from './cashBankAccounts';

export type CurrencyTable = 'transactions' | 'customer_payments' | 'supplier_payments' | 'journal_entries';

const missing: Partial<Record<CurrencyTable, boolean>> = {};
export const currencyColumnsMissing = (table: CurrencyTable) => !!missing[table];

const withMeta = <T extends Record<string, unknown>>(table: CurrencyTable, row: T, meta?: MoneyMeta | null): T =>
    (meta && !missing[table] ? { ...row, ...meta } : stripCurrency(row));

type Result<R> = { data: R | null; error: { message?: string; code?: string } | null };

// Insert one row with its currency fields; retried without them on a store
// that lacks the columns. Returns the inserted row (select().single()).
export async function insertWithCurrency<R = Record<string, unknown>>(
    table: CurrencyTable, row: Record<string, unknown>, meta?: MoneyMeta | null
): Promise<Result<R>> {
    const first = await supabase.from(table).insert([withMeta(table, row, meta)]).select().single();
    if (first.error && isMissingCurrencyColumnError(first.error)) {
        missing[table] = true;
        const again = await supabase.from(table).insert([stripCurrency(row)]).select().single();
        return { data: (again.data as R) ?? null, error: again.error };
    }
    return { data: (first.data as R) ?? null, error: first.error };
}

// Update one row by id with its currency fields (or, with meta null and
// `clear`, back to untagged), retried without them when the columns are
// missing.
export async function updateWithCurrency<R = Record<string, unknown>>(
    table: CurrencyTable, id: string, patch: Record<string, unknown>, meta?: MoneyMeta | null
): Promise<Result<R>> {
    const first = await supabase.from(table).update(withMeta(table, patch, meta)).eq('id', id).select().single();
    if (first.error && isMissingCurrencyColumnError(first.error)) {
        missing[table] = true;
        const again = await supabase.from(table).update(stripCurrency(patch)).eq('id', id).select().single();
        return { data: (again.data as R) ?? null, error: again.error };
    }
    return { data: (first.data as R) ?? null, error: first.error };
}

export type TagResult = 'tagged' | 'skipped' | 'failed';

// Best-effort tag of rows a DB function wrote. `clear` writes NULLs (a
// correction from riel back to USD). Never throws.
export async function tagRows(
    table: CurrencyTable,
    filter: { ids?: string[]; referenceIds?: string[]; descLike?: string; category?: string },
    meta: MoneyMeta | null,
    opts?: { clear?: boolean }
): Promise<TagResult> {
    if (missing[table]) return 'skipped';
    if (!opts?.clear && (!meta || meta.currency !== 'KHR')) return 'skipped';
    const values = opts?.clear
        ? Object.fromEntries(CURRENCY_KEYS.map(k => [k, null]))
        : { currency: meta!.currency, original_amount: meta!.original_amount, exchange_rate: meta!.exchange_rate };
    try {
        let q = supabase.from(table).update(values);
        let scoped = false;
        if (filter.ids?.length) { q = q.in('id', filter.ids); scoped = true; }
        if (filter.referenceIds?.length) { q = q.in('reference_id', filter.referenceIds); scoped = true; }
        if (filter.descLike) { q = q.like('description', filter.descLike); scoped = true; }
        if (filter.category) q = q.eq('category', filter.category);
        if (!scoped) return 'skipped';
        const { error } = await q;
        if (!error) return 'tagged';
        if (isMissingCurrencyColumnError(error)) { missing[table] = true; return 'skipped'; }
        console.warn(`Riel details not recorded on ${table}:`, error);
        return 'failed';
    } catch (e) {
        console.warn(`Riel details not recorded on ${table}:`, e);
        return 'failed';
    }
}

// The income/expense rows a DB function wrote, plus the journal entries it
// posted for them (reference_id 'TX-<tx id>': RCP, DEP, DLV, WSP, SPP).
export async function tagTransactionsAndEntries(txIds: string[], meta: MoneyMeta | null, opts?: { clear?: boolean }): Promise<TagResult> {
    const ids = txIds.filter(Boolean);
    if (!ids.length) return 'skipped';
    const a = await tagRows('transactions', { ids }, meta, opts);
    const b = await tagRows('journal_entries', { referenceIds: ids.map(id => `TX-${id}`) }, meta, opts);
    return a === 'failed' || b === 'failed' ? 'failed' : (a === 'tagged' ? 'tagged' : b);
}

// The cash/bank account a payment with no picked account lands in, chosen
// here instead of by the database (wp_cash_bank_account) so it follows the
// payment's currency: a USD payment never lands on a riel account, even on a
// store whose server pick predates add_khr_currency.sql. Same rules as the
// database (pickCashBankAccount). undefined when nothing matches or the read
// fails — the database then picks as before.
export async function resolveCashBankAccount(
    hint: string | null | undefined,
    opts: { preferBank: boolean; currency?: Currency }
): Promise<{ id: string; account_name: string } | undefined> {
    try {
        const { data, error } = await supabase.from('chart_of_accounts')
            .select('id, account_code, account_name, account_type').eq('is_active', true);
        if (error || !data) return undefined;
        const a = pickCashBankAccount(data, hint, { preferBank: opts.preferBank, currency: opts.currency || 'USD' });
        return a ? { id: a.id, account_name: a.account_name } : undefined;
    } catch {
        return undefined;
    }
}

// The ids of the rows a DB function wrote that carry a description marker
// ('#WSP-<id8>', '#SPP-<id8>').
export async function findTransactionIdsByMarker(marker: string, category?: string): Promise<string[]> {
    try {
        let q = supabase.from('transactions').select('id').like('description', `%${marker}%`);
        if (category) q = q.eq('category', category);
        const { data, error } = await q;
        if (error) return [];
        return (data || []).map((r: { id: string }) => r.id);
    } catch {
        return [];
    }
}
