import { supabase } from '../lib/supabase';

// Wholesale orders, customer and supplier payments, Add Stock and receiving a
// purchase order each run as ONE database function, in one transaction
// (migrations/add_wholesale_procurement_functions.sql): a failure changes
// nothing, and a second device or a stale screen waits for the first save and
// is then checked against what it did (a second cancel or receive is
// refused). Add Stock and payments, which may rightly be repeated, are
// retried with the id of the failed try (utils/retryKey.ts), so a save whose
// reply was lost is reported as already done rather than made twice.
// Until a store has run that file, PostgREST reports the function missing,
// and this says what to do instead of showing the raw error.
const MIGRATION = 'migrations/add_wholesale_procurement_functions.sql';

const FUNCTION_NAMES = /(create_wholesale_order|update_wholesale_order|set_wholesale_order_status|delete_wholesale_order|record_customer_payment|delete_customer_payment|record_supplier_payments|receive_purchase_order|add_product_stock|wp_[a-z_]+)/i;

export function dbFunctionMessage(error: unknown, area: string): string {
    const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : String(error || '');
    if (FUNCTION_NAMES.test(message) && /could not find the function|schema cache|does not exist/i.test(message)) {
        return `${area} needs a one-time database update: run ${MIGRATION} in this store's Supabase SQL editor.`;
    }
    return message || 'Unknown error';
}

export async function callDbFunction<T>(name: string, args: Record<string, unknown>, area: string): Promise<T> {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(dbFunctionMessage(error, area));
    return data as T;
}

// Notices a function returns for things that are fine but worth knowing
// (e.g. a Posted ledger entry it left alone).
export function noticesOf(result: unknown): string[] {
    const notices = result && typeof result === 'object' ? (result as { notices?: unknown }).notices : undefined;
    return Array.isArray(notices) ? notices.filter((n): n is string => typeof n === 'string' && n.length > 0) : [];
}
