import { supabase } from '../lib/supabase';
import { getSessionArg, isSessionExpiredError, notifySessionExpired } from './session';

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

// SEC-1 session guards (migrations/add_session_guards.sql): every guarded
// function takes an extra p_session argument, verified server-side. A store
// that has run the pack but NOT the guards migration only knows the old
// signature, and PostgREST then reports the p_session call as a missing
// function — so on that exact error the call is retried once without
// p_session, and the answer is remembered per function so each call pays
// the probe at most once per app load (same idea as configRpcReadyRef).
// Session args are stable across a retryKey replay: the token only changes
// on a fresh login, which replaces the whole screen anyway.
const guardedSignatureKnown = new Map<string, boolean>();

// Forget every cached probe verdict. StoreContext calls this on each login:
// a terminal that probed "unguarded" BEFORE the store ran the guards
// migration would otherwise keep calling session-less for the whole app
// load, and once enforcement flips on, land in a logout loop that only a
// full page reload fixes (re-login must re-probe, not replay the stale map).
export const resetGuardedSignatureCache = (): void => {
    guardedSignatureKnown.clear();
};

const isMissingFunctionError = (error: unknown): boolean => {
    const code = String((error as { code?: unknown })?.code || '');
    const msg = String((error as { message?: unknown })?.message || '');
    return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(msg);
};

// supabase.rpc with p_session attached (and the un-guarded retry above).
// Returns the same {data, error} shape so existing error handling at each
// call site keeps working. A 'session has expired' refusal also notifies
// the registered handler (StoreContext forces a logout).
export async function rpcWithSession(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }> {
    if (guardedSignatureKnown.get(name) !== false) {
        const res = await supabase.rpc(name, { ...args, p_session: getSessionArg() });
        if (!res.error) {
            guardedSignatureKnown.set(name, true);
            return res;
        }
        if (!isMissingFunctionError(res.error)) {
            if (isSessionExpiredError(res.error.message)) notifySessionExpired(res.error.message);
            return res;
        }
        // Old signature only (guards migration not run) — or the pack itself
        // is missing; the plain call below tells those two apart.
        guardedSignatureKnown.set(name, false);
    }
    const res = await supabase.rpc(name, args);
    if (!res.error) return res;
    if (isMissingFunctionError(res.error)) {
        // The pack itself is missing: forget the cached "unguarded" verdict
        // so a store migrated later (guards included) is probed afresh.
        guardedSignatureKnown.delete(name);
    } else if (isSessionExpiredError(res.error.message)) {
        // A session-less call refused as expired is proof the guards NOW
        // exist with enforcement on (the store migrated mid-session): the
        // cached "unguarded" verdict is stale, and the user must log in
        // again — same forced logout as on the guarded path above.
        guardedSignatureKnown.delete(name);
        notifySessionExpired(res.error.message);
    }
    return res;
}

export async function callDbFunction<T>(name: string, args: Record<string, unknown>, area: string): Promise<T> {
    const { data, error } = await rpcWithSession(name, args);
    if (error) throw new Error(dbFunctionMessage(error, area));
    return data as T;
}

// Notices a function returns for things that are fine but worth knowing
// (e.g. a Posted ledger entry it left alone).
export function noticesOf(result: unknown): string[] {
    const notices = result && typeof result === 'object' ? (result as { notices?: unknown }).notices : undefined;
    return Array.isArray(notices) ? notices.filter((n): n is string => typeof n === 'string' && n.length > 0) : [];
}
