import { createContext, useContext, useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { mapSaleEntity } from '../utils/mapper';
import { dispatchActivity } from '../utils/activityLogger';
import { nextJournalEntryNumber, entryDescription } from '../utils/journalEntryNumber';
import { pickCashBankAccount } from '../utils/cashBankAccounts';
import { insertJournalLines } from '../utils/journalEntryLines';
import { callDbFunction, noticesOf } from '../utils/dbFunctions';
import { createRetryKeys } from '../utils/retryKey';
import { fetchAll } from '../utils/fetchAll';
import { ALL_PERMISSIONS } from '../types';
import type {
    Product,
    CartItem,
    Sale,
    StoreContextType,
    Customer,
    User,
    Role,
    Permission,
    Restock,
    Transaction,
    TelegramConfig,
    BlockedCustomer,
    Warehouse,
    WarehouseStock,
    PurchaseSettings,
    WholesaleSettings,
    CustomDistrict,
    CustomCommune
} from '../types';

interface ConfigState {
    shippingCompanies: string[];
    salesmen: string[];
    categories: string[];
    pages: string[];
    customerCare: string[];
    paymentMethods: string[];
    cities: string[];
    customDistricts?: CustomDistrict[];
    customCommunes?: CustomCommune[];
    removedDistrictCodes?: string[];
    removedCommuneCodes?: string[];
    pinnedProducts?: string[];
    pinnedOrderColumns?: string[]; // Added pinned order columns
    salesOrder?: string[]; // Added sales custom order
    productOrder?: string[]; // Custom order for the All Stock inventory table
    shippingRates?: Record<string, number>; // Cost per item for each shipping company
    trackingUrlTemplates?: Record<string, string>; // Company -> tracking page URL with {tracking}
    users?: User[];
    roles?: Role[];
    storeAddress?: string;
    storeName?: string;
    email?: string;
    phone?: string;
    timezone?: string;
    taxRate?: number;
    currency?: string;
    khrExchangeRate?: number;
    logo?: string;
    telegramBotToken?: string;
    telegramChatId?: string;
    telegramConfigs?: TelegramConfig[];
    blockedCustomers?: BlockedCustomer[];
    purchaseSettings?: PurchaseSettings;
    wholesaleSettings?: WholesaleSettings;
}
// Add Stock retries reuse the restock id of a failed identical add (see addStock).
const addStockKeys = createRetryKeys();

// A failed order create keeps its id, so the retry finds the order already
// saved (create_retail_order reports it as created) instead of making a
// second one. Same idea as utils/retryKey.ts, with the Date.now()-style ids
// orders use. Payment saves reuse utils/retryKey.ts for their income row id.
const ORDER_RETRY_WINDOW_MS = 10 * 60 * 1000;
const pendingOrderIds = new Map<string, { id: string; at: number }>();
const paymentTxKeys = createRetryKeys();

const generateUUID = () => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }
    // Fallback using Math.random for insecure environments (like local HTTP)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// Shared account resolution for the retail-receipt ledger postings below: the
// Sales Revenue account, plus the cash/bank account for a given (optional)
// `depositAccountId`. When no id is given, falls back to an active Asset-type
// account whose name matches /cash|bank/i.
async function resolveRetailLedgerAccounts(depositAccountId?: string, payBy?: string | null): Promise<{
    revenueAcc: { id: string; account_code: string; account_name: string; account_type: string } | undefined;
    cashAccId: string | undefined;
    pool: { id: string; account_code: string; account_name: string; account_type: string }[];
}> {
    const { data: coa } = await supabase.from('chart_of_accounts')
        .select('id, account_code, account_name, account_type').eq('is_active', true);
    const pool = coa || [];
    const revenueAcc = pool.find(a => a.account_code === '4000')
        || pool.find(a => a.account_type === 'Revenue' && /sales revenue/i.test(a.account_name))
        || pool.find(a => a.account_type === 'Revenue');
    // Revenue flow: an explicitly picked account wins, otherwise all revenue
    // lands in the bank account by default (see pickCashBankAccount).
    const cashAccId = depositAccountId || pickCashBankAccount(pool, payBy, { preferBank: true })?.id;
    return { revenueAcc, cashAccId, pool };
}

// Standard-accounting COGS lines for a retail settlement: Dr Cost of Goods
// Sold, Cr Inventory at the items' purchase cost (each product's current
// "Cost of Purchase", same basis as the Purchase Cost report — sale_items
// carry no cost snapshot). Returns null when the cost is zero or the chart
// is missing either account, so the caller just posts the revenue side alone.
async function retailCogsLines(
    orderId: string,
    pool: { id: string; account_code: string; account_name: string; account_type: string }[]
): Promise<{ account_id: string; debit: number; credit: number; description?: string }[] | null> {
    try {
        const cogsAcc = pool.find(a => a.account_code === '5000')
            || pool.find(a => a.account_type === 'Expense' && /cost of goods|cogs/i.test(a.account_name));
        const inventoryAcc = pool.find(a => a.account_code === '1300')
            || pool.find(a => a.account_type === 'Asset' && /inventor|stock/i.test(a.account_name));
        if (!cogsAcc || !inventoryAcc) return null;
        const { data: items, error: itemsErr } = await supabase
            .from('sale_items').select('product_id, quantity').eq('sale_id', orderId);
        if (itemsErr || !items || items.length === 0) return null;
        const productIds = Array.from(new Set(items.map(i => i.product_id).filter((id): id is string => !!id)));
        if (productIds.length === 0) return null;
        const { data: products, error: prodErr } = await supabase
            .from('products').select('id, purchase_cost').in('id', productIds);
        if (prodErr) return null;
        const costOf = new Map((products || []).map(p => [p.id, Number(p.purchase_cost) || 0]));
        const cost = Math.round(items.reduce((s, i) => s + (costOf.get(i.product_id) || 0) * (Number(i.quantity) || 0), 0) * 100) / 100;
        if (cost <= 0) return null;
        return [
            { account_id: cogsAcc.id, debit: cost, credit: 0, description: 'Cost of goods sold' },
            { account_id: inventoryAcc.id, debit: 0, credit: cost, description: 'Inventory at cost' },
        ];
    } catch (e) {
        console.error('Failed to compute COGS lines for order', orderId, e);
        return null;
    }
}

// Serializes this tab's ledger posts: nextJournalEntryNumber is a non-atomic
// count-then-insert, so concurrent posts (a bulk settle fans out one per
// order) would all read the same counts and mint the same entry_number. The
// chain makes each post's insert land before the next one counts. Posts from
// other tabs/users keep the util's documented rare-race tradeoff.
let ledgerPostChain: Promise<unknown> = Promise.resolve();
function enqueueLedgerPost<T>(run: () => Promise<T>): Promise<T> {
    const result = ledgerPostChain.then(run, run);
    ledgerPostChain = result.catch(() => undefined);
    return result;
}

// COGS entry for an order with NO receipt entry to carry it: when the deposit
// covered the whole total, the Paid transition books no RCP row (nothing left
// to collect), so the cost side gets its own 2-line entry — Dr Cost of Goods
// Sold / Cr Inventory. Reference 'ORD-<id>-COGS' so a revert/re-pay (or a
// later Post Now on the deposit row) can never book it twice. Non-fatal.
async function postRetailCogsOnlyEntry(orderId: string, date: string, description: string, status: 'Draft' | 'Posted' = 'Draft'): Promise<void> {
    return enqueueLedgerPost(async () => {
    try {
        const reference = `ORD-${orderId}-COGS`;
        // select('*') so status is read where that column exists without failing where it doesn't.
        const { data: existing, error: exErr } = await supabase.from('journal_entries')
            .select('*').eq('reference_id', reference).limit(1).maybeSingle();
        if (exErr) return;
        if (existing) {
            // A companion an admin unposted (Draft) must follow a 'Posted'
            // request back to Posted — Post Now after Unpost — and moves to the
            // corrected date with it. An already-Posted companion stays untouched.
            if (status === 'Posted' && (existing as { status?: string }).status === 'Draft') {
                const { error: upErr } = await supabase.from('journal_entries')
                    .update({ status: 'Posted', date }).eq('id', (existing as { id: string }).id);
                if (upErr) console.error('Failed to re-post the COGS entry for order', orderId, upErr);
            }
            return;
        }
        const { pool } = await resolveRetailLedgerAccounts();
        const cogs = await retailCogsLines(orderId, pool);
        if (!cogs) return;
        const entryNumber = await nextJournalEntryNumber('RCP', date);
        const entryPayload: Record<string, unknown> = {
            date,
            description: entryDescription(entryNumber, description) || description,
            reference_id: reference,
            status
        };
        if (entryNumber) entryPayload.entry_number = entryNumber;
        let entry: { id: string } | null | undefined;
        let jeErr: { message?: string } | null | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
            ({ data: entry, error: jeErr } = await supabase.from('journal_entries').insert([entryPayload]).select().single());
            if (!jeErr) break;
            if (/entry_number/i.test(jeErr.message || '') && 'entry_number' in entryPayload) { delete entryPayload.entry_number; continue; }
            break;
        }
        if (jeErr && /status/i.test(jeErr.message || '')) {
            console.warn('Skipped the COGS entry — this instance needs migrations/add_entry_status.sql');
            return;
        }
        if (jeErr || !entry) {
            console.error('Failed to create the COGS entry for order', orderId, jeErr);
            return;
        }
        const { error: lErr } = await insertJournalLines(cogs.map(l => ({ journal_entry_id: entry.id, ...l })));
        if (lErr) {
            console.error('Failed to create the COGS entry lines for order', orderId, lErr);
            await supabase.from('journal_entries').delete().eq('id', entry.id);
        }
    } catch (e) {
        console.error('Failed to post the COGS entry for order', orderId, e);
    }
    });
}

// Posts a journal entry (Draft by default) straight to the ledger for a
// retail receipt (Dr the resolved cash/bank account, Cr Sales Revenue) —
// shared by the Paid-branch settlement and the Deposit-branch receipt in
// updateOrder(), and (with `status: 'Posted'`) by postOrFinalizeTransactionReceipt
// below when no entry exists yet for a transaction. Both updateOrder call
// sites gate the call on `postToLedger === true` themselves and only call it
// for a positive amount; this only adds the ledger side, independent of (and
// not a replacement for) the existing Income & Expense `transactions` row.
// Silently no-ops if the chart of accounts can't resolve both sides, and
// rolls back the header if the lines insert fails. Returns whether the
// posting succeeded — ignored by the two updateOrder call sites (which fire
// this without awaiting, same as before), read by postOrFinalizeTransactionReceipt
// so it can surface a failure to its caller.
// eslint-disable-next-line react-refresh/only-export-components -- plain data helper, not a component; same pattern already accepted for normalizePhone/isRpcMissingError below.
export async function postRetailSaleToLedger({
    txId,
    amount,
    date,
    description,
    depositAccountId,
    type,
    status = 'Draft',
    reference,
    notes,
    orderId,
    payBy
}: {
    txId: string;
    amount: number;
    date: string;
    description: string;
    depositAccountId?: string;
    // RCP = Paid-transition receipt, DEP = Deposit receipt — see the two
    // callers below and src/utils/journalEntryNumber.ts.
    type: 'RCP' | 'DEP';
    status?: 'Draft' | 'Posted';
    reference?: string;
    notes?: string;
    // The settled order, when the caller can resolve it: an RCP entry then
    // also books COGS (Dr Cost of Goods Sold, Cr Inventory) for its items.
    orderId?: string;
    // The payment's method/account hint ('Bank', 'Cash', an account name, …)
    // — steers the cash/bank account when no depositAccountId was picked.
    payBy?: string | null;
}): Promise<boolean> {
    return enqueueLedgerPost(async () => {
    try {
        const { revenueAcc, cashAccId, pool } = await resolveRetailLedgerAccounts(depositAccountId, payBy);
        if (revenueAcc && cashAccId) {
            const entryNumber = await nextJournalEntryNumber(type, date);
            const entryPayload: Record<string, unknown> = {
                date,
                description: entryDescription(entryNumber, description) || description,
                reference_id: 'TX-' + txId,
                status
            };
            if (entryNumber) entryPayload.entry_number = entryNumber;
            if (reference !== undefined) entryPayload.reference = reference;
            if (notes !== undefined) entryPayload.notes = notes;
            // entry_number and reference/notes each arrive with their own
            // migration — an instance may be missing one, both, or neither.
            // Strip only the column(s) the error actually names and retry, so
            // a missing entry_number never also drops a valid reference/notes
            // (and vice versa).
            let entry: { id: string } | null | undefined;
            let jeErr: { message?: string } | null | undefined;
            for (let attempt = 0; attempt < 3; attempt++) {
                ({ data: entry, error: jeErr } = await supabase.from('journal_entries')
                    .insert([entryPayload])
                    .select().single());
                if (!jeErr) break;
                const msg = jeErr.message || '';
                let stripped = false;
                if (/entry_number/i.test(msg) && 'entry_number' in entryPayload) { delete entryPayload.entry_number; stripped = true; }
                if (/reference|notes/i.test(msg) && ('reference' in entryPayload || 'notes' in entryPayload)) { delete entryPayload.reference; delete entryPayload.notes; stripped = true; }
                if (!stripped) break;
            }
            if (jeErr && /status/i.test(jeErr.message || '')) {
                console.warn('Posted the payment, but this instance needs migrations/add_entry_status.sql to also post it as a journal entry');
                return false;
            } else if (jeErr || !entry) {
                console.error('Failed to create journal entry for payment:', jeErr);
                return false;
            } else {
                // Deposits aren't a completed sale yet — COGS books once, on the
                // Paid-transition (RCP) entry.
                const cogs = type === 'RCP' && orderId ? await retailCogsLines(orderId, pool) : null;
                const { error: lErr } = await insertJournalLines([
                    { journal_entry_id: entry.id, account_id: cashAccId, debit: amount, credit: 0, description: `${type === 'DEP' ? 'Deposit' : 'Receipt'} — ${description}` },
                    { journal_entry_id: entry.id, account_id: revenueAcc.id, debit: 0, credit: amount, description: `Sales — ${description}` },
                    ...(cogs || []).map(l => ({ journal_entry_id: entry.id, ...l })),
                ]);
                if (lErr) {
                    console.error('Failed to create journal entry lines for payment:', lErr);
                    await supabase.from('journal_entries').delete().eq('id', entry.id);
                    return false;
                }
                return true;
            }
        }
        return false;
    } catch (jeCatchErr) {
        console.error('Failed to post journal entry for retail payment:', jeCatchErr);
        return false;
    }
    });
}

// Finalizes a specific transaction's journal entry as Posted — used by the
// Customer Payment page's "Post Now" action. Unlike postRetailSaleToLedger
// (always called from updateOrder, always a brand-new entry), this first
// checks whether a journal entry already exists for the transaction
// (reference_id === 'TX-' + txId):
//   - If a Draft one exists, its lines are replaced and its date/description/status
//     (and reference/notes, where those columns exist) are updated to
//     'Posted' — its entry_number is left untouched.
//   - If none exists, a fresh already-Posted entry is created via
//     postRetailSaleToLedger (status: 'Posted'), same as a brand-new receipt.
// This only touches journal_entries/journal_entry_lines — it never calls
// updateOrder and never inserts into `transactions`. Throws on failure (the
// caller — CustomerPayment.tsx — is expected to catch it and show a toast;
// unlike postRetailSaleToLedger, this is a user-initiated action with a
// visible result, so a silent console-only failure would leave the UI
// looking like nothing happened).
// eslint-disable-next-line react-refresh/only-export-components -- plain data helper, not a component; same pattern already accepted for normalizePhone/isRpcMissingError below.
export async function postOrFinalizeTransactionReceipt({
    txId,
    amount,
    date,
    description,
    depositAccountId,
    type,
    reference,
    notes,
    orderId,
    payBy
}: {
    txId: string;
    amount: number;
    date: string;
    description: string;
    depositAccountId?: string;
    type: 'RCP' | 'DEP';
    reference?: string;
    notes?: string;
    // The settled order, when known — an RCP posting then also books COGS.
    orderId?: string;
    // Method/account hint for the cash/bank side when no explicit account was picked.
    payBy?: string | null;
}): Promise<void> {
    // select('*') so status is read where that column exists without failing where it doesn't.
    const { data: existing, error: findErr } = await supabase
        .from('journal_entries')
        .select('*')
        .eq('reference_id', 'TX-' + txId)
        .limit(1)
        .maybeSingle();
    if (findErr) throw findErr;
    // Never rewrite a finalized entry; a missing status counts as Posted, same as the page.
    if (existing && (existing as { status?: string }).status !== 'Draft') {
        throw new Error('This payment is already posted to the ledger.');
    }

    if (existing) {
        // Resolve the accounts (and COGS) BEFORE touching any existing lines —
        // if this fails, the entry's current (valid) lines must be left
        // untouched rather than deleted with nothing to replace them.
        const { revenueAcc, cashAccId, pool } = await resolveRetailLedgerAccounts(depositAccountId, payBy);
        if (!revenueAcc || !cashAccId) {
            throw new Error('Could not resolve a Sales Revenue account and a cash/bank account in the Chart of Accounts.');
        }
        // select('*') so each line's description rides along where that column
        // exists, without failing where it doesn't.
        const { data: oldLines, error: oldErr } = await supabase.from('journal_entry_lines')
            .select('*').eq('journal_entry_id', existing.id);
        if (oldErr) throw oldErr;
        const cogs = type === 'RCP' && orderId ? await retailCogsLines(orderId, pool) : null;
        // When COGS can't be recomputed (the page couldn't resolve the order),
        // the rebuild must not silently drop the COGS pair the auto-posted
        // draft already carried: keep every old line that isn't the cash debit
        // or the revenue credit being replaced.
        const accById = new Map(pool.map(a => [a.id, a]));
        const preserved = cogs ? [] : (oldLines || []).filter(l => {
            const a = accById.get(l.account_id);
            if (!a) return false;
            if (a.account_type === 'Revenue') return false;
            if (a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)) return false;
            return true;
        });

        const { error: delErr } = await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', existing.id);
        if (delErr) throw delErr;

        const { error: lErr } = await insertJournalLines([
            { journal_entry_id: existing.id, account_id: cashAccId, debit: amount, credit: 0, description: `${type === 'DEP' ? 'Deposit' : 'Receipt'} — ${description}` },
            { journal_entry_id: existing.id, account_id: revenueAcc.id, debit: 0, credit: amount, description: `Sales — ${description}` },
            ...(cogs || preserved).map(l => ({ journal_entry_id: existing.id, account_id: l.account_id, debit: l.debit, credit: l.credit, description: (l as { description?: string }).description || undefined })),
        ]);
        if (lErr) throw lErr;

        // reference/notes and status each need their own migration and may be
        // missing independently — strip only the column(s) the error actually
        // names and retry, so one missing column never also drops another,
        // still-valid one.
        const attemptPayload: Record<string, unknown> = {
            date,
            // Keep the entry's existing number in the rebuilt description —
            // the caller only hands over the counterparty name.
            description: entryDescription((existing as { entry_number?: string }).entry_number, description) || description,
            status: 'Posted'
        };
        if (reference !== undefined) attemptPayload.reference = reference;
        if (notes !== undefined) attemptPayload.notes = notes;
        let updErr: { message?: string } | null | undefined;
        let statusDropped = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            ({ error: updErr } = await supabase.from('journal_entries').update(attemptPayload).eq('id', existing.id));
            if (!updErr) break;
            const msg = updErr.message || '';
            let stripped = false;
            if (/reference|notes/i.test(msg) && ('reference' in attemptPayload || 'notes' in attemptPayload)) { delete attemptPayload.reference; delete attemptPayload.notes; stripped = true; }
            if (/status/i.test(msg) && 'status' in attemptPayload) { delete attemptPayload.status; statusDropped = true; stripped = true; }
            if (!stripped) break;
        }
        if (updErr) throw updErr;
        if (statusDropped) console.warn('Finalized the receipt, but this instance needs migrations/add_entry_status.sql to mark it Posted');
    } else {
        const ok = await postRetailSaleToLedger({ txId, amount, date, description, depositAccountId, type, status: 'Posted', reference, notes, orderId, payBy });
        if (!ok) {
            throw new Error('Could not create a Posted journal entry — check that the Chart of Accounts has an active Sales Revenue account and a cash/bank account.');
        }
    }

    // A deposit that covered the whole order never gets an RCP row to carry
    // COGS — posting that deposit IS the sale's finalization, so book the cost
    // side alongside it (deduped per order by its ORD-…-COGS reference).
    if (type === 'DEP' && orderId) {
        try {
            const { data: sale } = await supabase.from('sales')
                .select('payment_status, total, deposit_amount').eq('id', orderId).maybeSingle();
            if (sale && sale.payment_status === 'Paid' && Number(sale.total) > 0 && Number(sale.deposit_amount) >= Number(sale.total)) {
                await postRetailCogsOnlyEntry(orderId, date, `${description} · cost of goods sold`, 'Posted');
            }
        } catch (e) {
            console.error('Could not check whether the deposit covered the order:', e);
        }
    }
}

const getLocalYYYYMMDD = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

// Digits-only phone comparison: blocklist entries and order snapshots carry
// mixed formats ('012 345 678', '+855 12…', Excel imports without the leading
// zero), so an exact-string match let blocked customers slip through.
export const normalizePhone = (v: any): string => String(v ?? '').replace(/\D/g, '');

// True only for "the function does not exist" (migration not applied yet) —
// network blips and server errors must NOT be treated as a missing migration.
export const isRpcMissingError = (err: any): boolean => {
    const code = String(err?.code || '');
    const msg = String(err?.message || '');
    return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(msg);
};

// Statuses where the stock is already gone: moving Shipped -> Delivered stays
// "consumed", so nothing is restored. The stock rules for each status change
// (what deducts, what restores, which stock-out records are written) live in
// the database: set_order_shipping_status in migrations/add_order_status_function.sql.
const isStockConsumed = (status: string) => ['Shipped', 'Delivered'].includes(status);

// Statuses where this order's goods are counted out of stock: shipped, delivered,
// or on their way back (Returned keeps them out until Restock brings them in).
// Same rule as order_status_holds_stock in the migration.
const holdsOrderStock = (status: string) => isStockConsumed(status) || status === 'Returned';

const ORDER_FUNCTIONS_MISSING_MESSAGE = 'Orders need a one-time database update before an order\'s shipping status can change, a returned order can be restocked, or the items of a shipped order can be edited: run migrations/add_order_status_function.sql in this store\'s Supabase SQL editor. Nothing was saved.';

const ORDER_PAYMENT_FUNCTIONS_MISSING_MESSAGE = 'Orders need a one-time database update before an order can be created, its payment saved, orders deleted or a restock\'s payment cancelled: run migrations/add_order_payment_functions.sql in this store\'s Supabase SQL editor. Nothing was saved.';

// Statuses that only make sense once the goods have physically left: you cannot deliver
// or receive a return for something that was never shipped.
//
// Both also drive stock accounting on delete — deleteOrders restocks Shipped/Delivered/
// Returned orders — so an order reaching 'Returned' straight from 'Pending' would credit
// stock on deletion that was never deducted in the first place.
const POST_DISPATCH_STATUSES = ['Delivered', 'Returned'];

// 'Shipped' is the valid predecessor for both. 'Returned' and 'Delivered' may also be
// entered from each other — a customer can return goods after receiving them, and each
// is the correction path when the other was picked by mistake. Stock stays consistent
// either way: both states have stock counted out (a restocked order sits at 'ReStock',
// not 'Returned'), and restocking only happens through the Restock flow
// (bulkRestockOrders, which every Returned -> ReStock change runs).
const canEnterPostDispatch = (currentStatus: string, targetStatus?: string) =>
    currentStatus === 'Shipped' ||
    (targetStatus === 'Returned' && currentStatus === 'Delivered') ||
    (targetStatus === 'Delivered' && currentStatus === 'Returned');

const POST_DISPATCH_BLOCKED_MESSAGE = (currentStatus: string, targetStatus: string) =>
    `This order is "${currentStatus}" and cannot be marked ${targetStatus} directly.\n\n` +
    `Stock is counted out when an order is Shipped, so skipping that step would leave ` +
    `inventory unchanged — and deleting the order later would add stock back that was ` +
    `never taken.\n\n` +
    `Set the order back to Drafted, then move it through Confirmed → Shipped.`;

// Admins may force a transition the rule above rejects — but with eyes open: the
// confirm spells out that a forced jump is a status-only change, so any stock the
// skipped Shipped step would have counted out stays untouched.
const ADMIN_FORCE_STATUS_MESSAGE = (currentStatus: string, targetStatus: string) =>
    `Admin override — this order is "${currentStatus}", which normally cannot be marked ` +
    `${targetStatus} directly (stock is counted out at the Shipped step).\n\n` +
    `Stock follows the new status: if the goods are still in stock, they are counted ` +
    `out now, as if the order had shipped.\n\n` +
    `Change it to ${targetStatus} anyway?`;

// Exported (not just the hook) so a dev-only preview harness can supply a
// mock value directly via <StoreContext.Provider> without pulling in the
// real provider's Supabase wiring — see src/dev/*-preview.tsx.
export const StoreContext = createContext<StoreContextType | undefined>(undefined);

// Initial Dummy Data


// ─── Boot snapshot (stale-while-revalidate) ────────────────────────────────
// The last successful load's slow-changing tables, kept in localStorage so a
// reopen on a slow connection paints a working UI (login user list, sidebar,
// config, catalogue) immediately instead of a full-screen "Loading..." while
// ~10 queries crawl. refreshData still runs on boot and overwrites all of it;
// fast-changing tables (sales, transactions, restocks, customers) are NOT
// snapshotted — pages fetch those themselves and show their own loaders.
const BOOT_SNAPSHOT_KEY = 'pos_boot_snapshot_v1';
// Proof of login minted by login_with_pin (add_auth_guards.sql). Its own key —
// not a field on the currentUser blob — so the refresh revalidation's
// localStorage rewrites of currentUser can never drop it.
const SESSION_TOKEN_KEY = 'pos_session_token_v1';

interface BootSnapshot {
    url: string;               // Supabase instance the data came from
    savedAt: string;
    products: Product[];
    users: User[];
    warehouses: Warehouse[];
    warehouseStock: WarehouseStock[];
    config: ConfigState;
}

const loadBootSnapshot = (): BootSnapshot | null => {
    try {
        const raw = localStorage.getItem(BOOT_SNAPSHOT_KEY);
        if (!raw) return null;
        const snap = JSON.parse(raw) as BootSnapshot;
        // A snapshot from another instance (dev .env switch) must not leak in.
        if (!snap || snap.url !== import.meta.env.VITE_SUPABASE_URL) return null;
        if (!Array.isArray(snap.products) || !Array.isArray(snap.users) || typeof snap.config !== 'object' || !snap.config) return null;
        return snap;
    } catch {
        try { localStorage.removeItem(BOOT_SNAPSHOT_KEY); } catch { /* ignore */ }
        return null;
    }
};

const bootSnapshot = loadBootSnapshot();

export const StoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [products, setProducts] = useState<Product[]>(bootSnapshot?.products ?? []);
    const [sales, setSales] = useState<Sale[]>([]);
    const [restocks, setRestocks] = useState<Restock[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [users, setUsers] = useState<User[]>(bootSnapshot?.users ?? []); // Added users state
    const [warehouses, setWarehouses] = useState<Warehouse[]>(bootSnapshot?.warehouses ?? []);
    const [warehouseStock, setWarehouseStock] = useState<WarehouseStock[]>(bootSnapshot?.warehouseStock ?? []);
    // With a snapshot the app renders immediately (stale data, refreshing in
    // the background); without one the original full-screen gate applies.
    const [isLoading, setIsLoading] = useState(!bootSnapshot);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMoreOrders, setHasMoreOrders] = useState(true);
    const [productsUpdatedAt, setProductsUpdatedAt] = useState<number>(Date.now());
    const [salesUpdatedAt, setSalesUpdatedAt] = useState<number>(Date.now());
    const [pinnedOrderColumns, setPinnedOrderColumns] = useState<string[]>([]);
    const [config, setConfig] = useState<ConfigState>(() => {
        const defaults: ConfigState = {
        shippingCompanies: ['J&T', 'VET', 'JS Express', 'D2D'],
        salesmen: ['Sokheng', 'Thida'],
        categories: ['Portable', 'PartyBox'],
        pages: ['Chantha Sound'],
        customerCare: ['Chantha'],
        paymentMethods: ['Cash', 'QR'],
        cities: [
            'រាជធានីភ្នំពេញ',
            'ខេត្តបន្ទាយមានជ័យ',
            'ខេត្តបាត់ដំបង',
            'ខេត្តកំពង់ចាម',
            'ខេត្តកំពង់ឆ្នាំង',
            'ខេត្តកំពង់ស្ពឺ',
            'ខេត្តកំពង់ធំ',
            'ខេត្តកំពត',
            'ខេត្តកណ្តាល',
            'ខេត្តកោះកុង',
            'ខេត្តក្រចេះ',
            'ខេត្តមណ្ឌលគិរី',
            'ខេត្តព្រះវិហារ',
            'ខេត្តព្រៃវែង',
            'ខេត្តពោធិ៍សាត់',
            'ខេត្តរតនគិរី',
            'ខេត្តសៀមរាប',
            'ខេត្តព្រះសីហនុ',
            'ខេត្តស្ទឹងត្រែង',
            'ខេត្តស្វាយរៀង',
            'ខេត្តតាកែវ',
            'ខេត្តឧត្តរមានជ័យ',
            'ខេត្តកែប',
            'ខេត្តប៉ៃលិន',
            'ខេត្តត្បូងឃ្មុំ'
        ],
        pinnedProducts: [],
        pinnedOrderColumns: [],
        users: [],
        roles: [],
        storeAddress: '123 Speaker Ave, Audio City',
        storeName: 'Romdoul Store Main',
        email: 'contact@romdoulstore.com',
        phone: '+1 (555) 123-4567',
        timezone: 'Asia/Phnom_Penh',
        taxRate: 0,
        currency: 'USD ($)',
        khrExchangeRate: 4100,
        logo: '',
        telegramBotToken: '',
        telegramChatId: '',
        telegramConfigs: []
        };
        // Snapshot spread over the defaults, so fields added to ConfigState
        // after a snapshot was saved still get their default values.
        return bootSnapshot?.config ? { ...defaults, ...bootSnapshot.config } : defaults;
    });



    // Authentication
    const [currentUser, setCurrentUser] = useState<User | null>(() => {
        // Guarded: a corrupt localStorage value must not crash-loop the whole
        // app at the very first render (the error boundary's only offer is
        // Reload, which would just re-parse the same bad value forever).
        try {
            const saved = localStorage.getItem('currentUser');
            return saved ? JSON.parse(saved) : null;
        } catch {
            localStorage.removeItem('currentUser');
            return null;
        }
    });
    // Live view of the session for async completions: a refresh that was
    // in flight across a logout/user switch must not act on the old session.
    const currentUserRef = useRef(currentUser);
    currentUserRef.current = currentUser;

    const login = async (pin: string, userId?: string): Promise<boolean> => {
        const safePin = String(pin).trim();
        if (!safePin) return false;

        let user: User | undefined;
        // Minted by login_with_pin (add_auth_guards.sql): proof this terminal
        // really logged in, re-checked via verify_session on every refresh. A
        // store that hasn't run that migration yet keeps today's behaviour.
        let sessionToken: string | null = null;

        // Preferred path: login_with_pin verifies the PIN server-side AND
        // returns a session token (SEC-2 — a forged localStorage blob can't
        // produce one, so the next refresh logs the forger out).
        const { data: minted, error: mintError } = await supabase.rpc('login_with_pin', {
            p_pin: safePin,
            p_user_id: userId || null
        });
        if (!mintError) {
            const row = Array.isArray(minted) ? minted[0] : minted;
            if (row) {
                const known = users.find(u => u.id === row.id);
                user = {
                    ...(known || {}),
                    id: row.id,
                    name: row.name,
                    email: row.email,
                    roleId: row.role_id
                } as User;
                sessionToken = row.session_token || null;
            }
            if (user) return finishLogin(user, sessionToken);
            return false;
        }
        if (!isRpcMissingError(mintError)) {
            // Real failure (network blip, server error) — see the matching
            // branch below. Never reported as a wrong password.
            console.error('login_with_pin failed:', mintError);
            throw new Error('Could not verify password — check the connection and try again');
        }

        // add_auth_guards.sql not applied yet: fall back to check_pin (no
        // session token — refreshes behave exactly as before the migration).
        const { data: matched, error: rpcError } = await supabase.rpc('check_pin', {
            p_pin: safePin,
            p_user_id: userId || null
        });
        if (!rpcError) {
            const row = Array.isArray(matched) ? matched[0] : matched;
            if (row) {
                const known = users.find(u => u.id === row.id);
                user = {
                    ...(known || {}),
                    id: row.id,
                    name: row.name,
                    email: row.email,
                    roleId: row.role_id
                } as User;
            }
        } else if (isRpcMissingError(rpcError)) {
            // secure_pin_check.sql not applied yet: fall back to the legacy
            // client-side comparison via a one-off read. This path dies the
            // moment the migration runs (the pin column read is then rejected
            // and the RPC exists).
            console.warn('check_pin RPC unavailable, using legacy login:', rpcError.message);
            const { data: legacyUsers } = await supabase.from('users').select('id, name, email, role_id, pin');
            const hit = (legacyUsers || []).find((u: any) =>
                String(u.pin || '').trim() === safePin && (!userId || u.id === userId)
            );
            if (hit) {
                user = { id: hit.id, name: hit.name, email: hit.email, roleId: hit.role_id } as User;
            }
        } else {
            // A real failure (network blip, server error) — never report it as a
            // wrong password. The Login page's catch shows its own message.
            console.error('check_pin failed:', rpcError);
            throw new Error('Could not verify password — check the connection and try again');
        }

        if (user) return finishLogin(user, sessionToken);
        return false;
    };

    // Shared tail of both login paths. Note: the stored snapshot never
    // contains the PIN; the session token lives under its own key so the
    // refresh revalidation's currentUser rewrites can never drop it.
    const finishLogin = (user: User, sessionToken: string | null): true => {
        setCurrentUser(user);
        localStorage.setItem('currentUser', JSON.stringify(user));
        try {
            if (sessionToken) localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
            else localStorage.removeItem(SESSION_TOKEN_KEY); // legacy path: no stale token from a previous user
        } catch { /* storage full/blocked — login still works, next refresh re-verifies */ }
        dispatchActivity({ action: 'user_login', description: `${user.name} logged in`, userId: user.id, userName: user.name });
        return true;
    };

    const logout = () => {
        setCurrentUser(null);
        localStorage.removeItem('currentUser');
        try { localStorage.removeItem(SESSION_TOKEN_KEY); } catch { /* ignore */ }
    };

    // SEC-2: re-verify the persisted session against the server-minted token.
    // Only ever logs out on a definitive "no" from verify_session:
    //   * RPC missing (migration not applied) → keep today's behaviour;
    //   * network/server error → never log out on a blip;
    //   * FALSE → the token is wrong or missing (forged/stale localStorage,
    //     or a login that predates add_auth_guards.sql) → this terminal is out.
    const verifyStoredSession = async (userId: string) => {
        let token = '';
        try { token = localStorage.getItem(SESSION_TOKEN_KEY) || ''; } catch { /* treated as missing */ }
        try {
            const { data, error } = await supabase.rpc('verify_session', {
                p_user_id: userId,
                p_token: token
            });
            if (error) {
                if (!isRpcMissingError(error)) console.error('verify_session failed:', error);
                return;
            }
            const valid = Array.isArray(data) ? data[0] : data;
            // Only act when THIS user is still the live session (the refresh
            // may have spanned a logout or user switch).
            if (valid === false && currentUserRef.current?.id === userId) {
                setCurrentUser(null);
                localStorage.removeItem('currentUser');
                try { localStorage.removeItem(SESSION_TOKEN_KEY); } catch { /* ignore */ }
            }
        } catch (e) {
            console.error('verify_session failed:', e);
        }
    };

    const hasPermission = (permission: Permission): boolean => {
        if (!currentUser) {
            // console.warn(`hasPermission check failed for ${permission}: No currentUser`);
            return false;
        }
        // Optimization: Admin always has full permissions, check roleId directly first
        if (currentUser.roleId === 'admin') return true;

        const userRole = (config.roles || []).find(r => r.id === currentUser.roleId);
        if (!userRole) {
            // console.warn(`hasPermission check failed for ${permission}: Role ${currentUser.roleId} not found in config`);
            return false;
        }

        // Redundant safely check inside role (though optimization above catches it)
        if (userRole.id === 'admin') return true;
        
        const hasPerm = userRole.permissions.includes(permission);
        if (!hasPerm && (permission === 'create_orders' || permission === 'manage_orders' || permission === 'process_sales')) {
            console.warn(`hasPermission check failed for ${permission}: Role ${userRole.name} does not have it. Current permissions:`, userRole.permissions);
        }
        return hasPerm;
    };

    const loadMoreOrders = async () => {
        if (isLoadingMore || !hasMoreOrders) return;
        setIsLoadingMore(true);
        try {
            const currentCount = sales.length;
            const { data, error } = await supabase
                .from('sales')
                .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                .order('date', { ascending: false })
                .range(currentCount, currentCount + 49);

            if (error) throw error;
            if (data && data.length > 0) {
                const mappedSales = data.map(mapSaleEntity);
                setSales(prev => {
                    // Prevent duplicates just in case
                    const existingIds = new Set(prev.map(s => s.id));
                    const newUniqueSales = mappedSales.filter(s => !existingIds.has(s.id));
                    return [...prev, ...newUniqueSales];
                });
                if (data.length < 50) {
                    setHasMoreOrders(false);
                }
            } else {
                setHasMoreOrders(false);
            }
        } catch (e) {
            console.error('Failed to load more orders:', e);
        } finally {
            setIsLoadingMore(false);
        }
    };

    // Initial Fetch
    const refreshData = async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const fetchAllSales = async () => {
                const { data, error } = await supabase
                    .from('sales')
                    .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                    .order('date', { ascending: false })
                    .limit(50);

                return { data: data || [], error };
            };

            // Products and warehouse_stock are summed and looked up everywhere
            // (stock totals, per-warehouse availability), so both are paged past
            // PostgREST's ~1000-row cap — soft-deleted products are still in the
            // query and eat into any single page, and warehouse_stock grows as
            // products x warehouses. Wrapped to the { data, error } result shape
            // the blocks below expect.
            const fetchAllProductsRows = async () => {
                try {
                    const data = await fetchAll((from, to) => supabase
                        .from('products')
                        .select('id, name, model, sku, price, purchase_cost, stock, category, low_stock_threshold, image, invoice_number, supplier, created_at, is_active')
                        // created_at ties are possible — the unique id breaks them.
                        .order('created_at', { ascending: false })
                        .order('id', { ascending: true })
                        .range(from, to), 1000, { label: 'StoreContext.refreshData products' });
                    return { data, error: null };
                } catch (error) { return { data: null, error }; }
            };
            const fetchAllCustomers = async () => {
                try {
                    // Paged: customers grow with every new retail buyer, and the
                    // POS customer picker and checkout's existing-customer lookup
                    // read this list — past the ~1000-row cap an unpaged read
                    // would silently drop older customers (live counts were 0 at
                    // the time of this change; paged anyway so growth can't
                    // reintroduce the bug).
                    const data = await fetchAll((from, to) => supabase
                        .from('customers')
                        // All customer detail fields, not just id/name/phone: the checkout
                        // form saves email/address/city/platform/page, and a narrower select
                        // would silently drop them from the in-memory store on every reload.
                        .select('id, name, phone, email, address, city, platform, page')
                        .order('id', { ascending: true })
                        .range(from, to), 1000, { label: 'StoreContext.refreshData customers' });
                    return { data, error: null };
                } catch (error) { return { data: null, error }; }
            };
            const fetchAllWarehouseStock = async () => {
                try {
                    const data = await fetchAll((from, to) => supabase
                        .from('warehouse_stock')
                        .select('*')
                        .order('id', { ascending: true })
                        .range(from, to), 1000, { label: 'StoreContext.refreshData warehouse_stock' });
                    return { data, error: null };
                } catch (error) { return { data: null, error }; }
            };

            // Fetch core data.
            const [productsResult, customersResult, salesResult, configResult, usersResult, restocksResult, transactionsResult, telegramConfigsResult, warehousesResult, warehouseStockResult] = await Promise.all([
                fetchAllProductsRows(),
                fetchAllCustomers(),
                fetchAllSales(),
                supabase.from('app_config').select('data').eq('id', 1).single(),
                // Explicit columns — never the pin. PINs are verified server-side
                // (check_pin RPC) and must not be downloaded to the browser.
                supabase.from('users').select('id, name, email, role_id, created_at, base_salary, daily_target, weekly_target, monthly_target'),
                supabase.from('restocks').select('*').order('date', { ascending: false }).limit(50),
                supabase.from('transactions').select('*').order('date', { ascending: false }).limit(50),
                supabase.from('telegram_notifications').select('*'),
                supabase.from('warehouses').select('*').order('created_at', { ascending: true }),
                fetchAllWarehouseStock()
            ]);

            // Surface fetch failures. PostgREST reports these on `.error` instead of
            // throwing, so they never reach the catch below — and because each block
            // below is guarded by `if (result.data)`, a failed query silently leaves
            // its list empty. A single unknown column drops the whole table this way.
            const fetchResults: Array<[string, { error: unknown }]> = [
                ['products', productsResult],
                ['customers', customersResult],
                ['sales', salesResult],
                ['app_config', configResult],
                ['users', usersResult],
                ['restocks', restocksResult],
                ['transactions', transactionsResult],
                ['telegram_notifications', telegramConfigsResult],
                ['warehouses', warehousesResult],
                ['warehouse_stock', warehouseStockResult],
            ];
            for (const [table, result] of fetchResults) {
                if (result.error) {
                    const message = (result.error as { message?: string }).message ?? result.error;
                    console.error(`Failed to fetch "${table}":`, message);
                }
            }

            // Products
            if (productsResult.data) {
                setProducts(productsResult.data
                    .filter((p: any) => p.is_active !== false)
                    .map((p: any) => ({
                    ...p,
                    isActive: p.is_active ?? true,
                    lowStockThreshold: p.low_stock_threshold || p.lowStockThreshold || 5,
                    stock: Number(p.stock),
                    price: Number(p.price),
                    purchaseCost: Number(p.purchase_cost || 0),
                    sku: p.sku || '',
                    invoiceNumber: p.invoice_number,
                    supplier: p.supplier,
                    createdAt: p.created_at
                })));
            }

            // Warehouses
            if (warehousesResult.data) {
                setWarehouses(warehousesResult.data.map((w: any) => ({
                    ...w,
                    createdAt: w.created_at,
                    updatedAt: w.updated_at
                })));
            }

            if (warehouseStockResult.data) {
                setWarehouseStock(warehouseStockResult.data.map((ws: any) => ({
                    ...ws,
                    warehouseId: ws.warehouse_id,
                    productId: ws.product_id,
                    createdAt: ws.created_at,
                    updatedAt: ws.updated_at
                })));
            }

            // Customers
            if (customersResult.data) setCustomers(customersResult.data);

            // Sales
            if (salesResult.data) {
                // Map DB structure to App structure
                const mappedSales: Sale[] = salesResult.data.map(mapSaleEntity);
                setSales(mappedSales);

                // Apply sort if config is ready (But config is fetched in parallel, so we might need useEffect or dependency)
                // Actually, we can just sort here if accessing configResult directly
                if (configResult.data?.data?.salesOrder) {
                    const orderMap = new Map(configResult.data.data.salesOrder.map((id: string, index: number) => [id, index]));
                    mappedSales.sort((a, b) => {
                        const indexA = orderMap.has(a.id) ? orderMap.get(a.id)! : -1;
                        const indexB = orderMap.has(b.id) ? orderMap.get(b.id)! : -1;

                        // If both have index, sort by index
                        if (indexA !== -1 && indexB !== -1) return (indexA as number) - (indexB as number);

                        // If one has index (it's manually ordered), it goes ? 
                        // Actually, un-ordered items (new ones?) should probably go to top or bottom.
                        // Let's say -1 (not found) means "new" -> Top.

                        if (indexA === -1 && indexB !== -1) return -1; // A is new, A comes first
                        if (indexA !== -1 && indexB === -1) return 1; // B is new, B comes first

                        // If neither has index, sort by date desc (default)
                        return ((new Date(b.date).getTime() || 0) as any) - ((new Date(a.date).getTime() || 0) as any);
                    });
                    setSales(mappedSales);
                }
                setHasMoreOrders(mappedSales.length >= 50);
            }

            // Restocks
            if (restocksResult.data) {
                setRestocks(restocksResult.data.map((r: any) => ({
                    id: r.id,
                    productId: r.product_id,
                    quantity: Number(r.quantity),
                    cost: Number(r.cost),
                    date: r.date,
                    addedBy: r.added_by,
                    note: r.note
                })));
            }

            // Transactions
            if (transactionsResult && transactionsResult.data) {
                setTransactions(transactionsResult.data);
            }

            // Users (PINs deliberately never leave the database — see login()).
            if (usersResult.data) {
                setUsers(usersResult.data.map((u: any) => ({
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    roleId: u.role_id, // Map snake_case to camelCase
                    baseSalary: Number(u.base_salary) || 0,
                    dailyTarget: Number(u.daily_target) || 0,
                    weeklyTarget: Number(u.weekly_target) || 0,
                    monthlyTarget: Number(u.monthly_target) || 0
                })));

                // Revalidate the persisted session against the fresh users table:
                // a deleted account is logged out; a renamed or demoted/promoted
                // one gets its fresh role immediately instead of keeping the old
                // localStorage snapshot's access forever. Only runs when the
                // users fetch succeeded, so a network blip can't log anyone out.
                // Reads the LIVE session (ref, not this closure) so a refresh
                // spanning a logout or user switch acts on the current user.
                const liveUser = currentUserRef.current;
                if (liveUser) {
                    // SEC-2: prove this terminal really logged in (a forged
                    // localStorage session has no valid token). Fire-and-forget:
                    // the rest of the refresh never waits on it.
                    void verifyStoredSession(liveUser.id);
                    const freshSelf = usersResult.data.find((u: any) => u.id === liveUser.id);
                    if (!freshSelf) {
                        setCurrentUser(null);
                        localStorage.removeItem('currentUser');
                    } else if (
                        freshSelf.role_id !== liveUser.roleId ||
                        freshSelf.name !== liveUser.name ||
                        (freshSelf.email || '') !== (liveUser.email || '')
                    ) {
                        const updatedSelf = { ...liveUser, roleId: freshSelf.role_id, name: freshSelf.name, email: freshSelf.email };
                        setCurrentUser(updatedSelf);
                        localStorage.setItem('currentUser', JSON.stringify(updatedSelf));
                    }
                }
            }

            // Config
            if (configResult.error) {
                console.error('Config fetch error:', configResult.error);
                if (configResult.error.code === 'PGRST116') {
                    // Initial if no config found in DB
                    const defaultConfig = {
                        shippingCompanies: ['J&T', 'VET', 'JS Express', 'D2D'],
                        salesmen: ['Sokheng', 'Thida'],
                        categories: ['Portable', 'PartyBox'],
                        pages: ['Chantha Sound'],
                        customerCare: ['Chantha'],
                        paymentMethods: ['Cash', 'QR'],
                        cities: [
                            'រាជធានីភ្នំពេញ',
                            'ខេត្តបន្ទាយមានជ័យ',
                            'ខេត្តបាត់ដំបង',
                            'ខេត្តកំពង់ចាម',
                            'ខេត្តកំពង់ឆ្នាំង',
                            'ខេត្តកំពង់ស្ពឺ',
                            'ខេត្តកំពង់ធំ',
                            'ខេត្តកំពត',
                            'ខេត្តកណ្តាល',
                            'ខេត្តកោះកុង',
                            'ខេត្តក្រចេះ',
                            'ខេត្តមណ្ឌលគិរី',
                            'ខេត្តព្រះវិហារ',
                            'ខេត្តព្រៃវែង',
                            'ខេត្តពោធិ៍សាត់',
                            'ខេត្តរតនគិរី',
                            'ខេត្តសៀមរាប',
                            'ខេត្តព្រះសីហនុ',
                            'ខេត្តស្ទឹងត្រែង',
                            'ខេត្តស្វាយរៀង',
                            'ខេត្តតាកែវ',
                            'ខេត្តឧត្តរមានជ័យ',
                            'ខេត្តកែប',
                            'ខេត្តប៉ៃលិន',
                            'ខេត្តត្បូងឃ្មុំ'
                        ],
                        pinnedProducts: [],
                        pinnedOrderColumns: [],
                        salesOrder: [],
                        users: [
                            { id: '1', name: 'Admin', email: 'admin@pos.com', roleId: 'admin', pin: '1234' }
                        ],
                        roles: [
                            {
                                id: 'admin',
                                name: 'Administrator',
                                description: 'Full system access',
                                permissions: ['view_dashboard', 'manage_inventory', 'process_sales', 'view_reports', 'manage_settings', 'manage_users', 'manage_orders', 'create_orders', 'view_orders', 'view_inventory_stock', 'manage_income_expense', 'manage_attendance'] as any[]
                            },
                            {
                                id: 'accountant',
                                name: 'Accountant',
                                description: 'Manage finances and records',
                                permissions: ['view_dashboard', 'view_reports', 'manage_income_expense', 'view_orders'] as any[]
                            },
                            {
                                id: 'store_manager',
                                name: 'Store Manager',
                                description: 'Manage store operations',
                                // SEC-3/SEC-4: manage_users is no longer a Store Manager
                                // default (the live stores had already removed it) — an
                                // admin can still grant it per store.
                                permissions: ['view_dashboard', 'process_sales', 'view_reports', 'manage_orders', 'create_orders', 'view_orders', 'manage_attendance'] as any[]
                            },
                            {
                                id: 'cashier',
                                name: 'Cashier',
                                description: 'Process sales and payments',
                                permissions: ['process_sales', 'view_dashboard', 'create_orders', 'view_orders'] as any[]
                            },
                            {
                                id: 'customer_care',
                                name: 'Customer Care',
                                description: 'Manage support and orders',
                                permissions: ['view_dashboard', 'manage_orders', 'view_orders', 'manage_settings', 'create_orders', 'process_sales'] as any[]
                            },
                            {
                                id: 'salesman',
                                name: 'Salesman',
                                description: 'Sales and order viewing',
                                permissions: ['process_sales', 'view_dashboard', 'manage_orders', 'view_orders', 'create_orders'] as any[]
                            }
                        ],
                        storeAddress: '123 Speaker Ave, Audio City',
                        storeName: 'Romdoul Store Main',
                        email: 'contact@romdoulstore.com',
                        phone: '+1 (555) 123-4567',
                        timezone: 'Asia/Phnom_Penh',
                        taxRate: 0,
                        currency: 'USD ($)',
                        telegramBotToken: '',
                        telegramChatId: '',
                        telegramConfigs: []
                    };
                    setConfig(defaultConfig);
                    await supabase.from('app_config').insert({ id: 1, data: defaultConfig });
                }
                // If it's another error (e.g. network), do nothing to DB, retain current state fallback
            } else if (configResult.data) {
                const loadedConfig = configResult.data.data;

                // A config row written by hand (or by an older build) can miss
                // whole keys. Every list the UI maps over must exist, or pages
                // crash — e.g. Checkout's "Manage Shipping Companies" hits
                // .includes()/.map() of undefined.
                for (const k of ['shippingCompanies', 'salesmen', 'categories', 'pages', 'customerCare', 'paymentMethods', 'cities', 'customDistricts', 'customCommunes', 'removedDistrictCodes', 'removedCommuneCodes']) {
                    if (!Array.isArray(loadedConfig[k])) loadedConfig[k] = [];
                }

                // Inject telegram configs from their own table
                if (telegramConfigsResult?.data) {
                    loadedConfig.telegramConfigs = telegramConfigsResult.data.map((tc: any) => ({
                        id: tc.id,
                        name: tc.name,
                        botToken: tc.bot_token,
                        chatId: tc.chat_id,
                        triggerStatuses: tc.trigger_statuses || [],
                        messageTemplate: tc.message_template || '',
                        note: tc.note || ''
                    }));
                }

                const needsMigration = !loadedConfig.cities ||
                    loadedConfig.cities.length === 0 ||
                    loadedConfig.cities.includes('Phnom Penh') ||
                    !loadedConfig.cities.includes('រាជធានីភ្នំពេញ') ||
                    !loadedConfig.pinnedProducts ||
                    !loadedConfig.roles ||
                    !(loadedConfig.roles.find((r: Role) => r.id === 'admin')?.permissions?.includes('view_orders')) ||
                    !(loadedConfig.roles.find((r: Role) => r.id === 'admin')?.permissions?.includes('view_inventory_stock')) ||
                    !(loadedConfig.roles.find((r: Role) => r.id === 'admin')?.permissions?.includes('manage_attendance')) ||
                    !loadedConfig.shippingCompanies?.includes('D2D');

                if (needsMigration) {
                    // Re-inject missing cities, but PRESERVE all existing custom roles or custom permissions
                    // Only update the Admin role to ensure it never loses access
                    const updatedRoles = (loadedConfig.roles || []).map((r: Role) => {
                        if (r.id === 'admin') {
                            return {
                                ...r,
                                permissions: Array.from(new Set([
                                    ...r.permissions, 
                                    'view_dashboard', 'manage_inventory', 'process_sales', 'view_reports', 'manage_settings', 'manage_users', 'manage_orders', 'create_orders', 'view_orders', 'view_inventory_stock', 'manage_income_expense', 'manage_attendance', 'manage_payroll'
                                ]))
                            };
                        }
                        return r;
                    });

                    // Add base roles only if they completely don't exist yet
                    const baseRoles = [
                        { id: 'admin', name: 'Administrator', description: 'Full system access', permissions: ['view_dashboard', 'manage_inventory', 'process_sales', 'view_reports', 'manage_settings', 'manage_users', 'manage_orders', 'create_orders', 'view_orders', 'view_inventory_stock', 'manage_income_expense', 'manage_attendance', 'manage_payroll'] },
                        { id: 'accountant', name: 'Accountant', description: 'Manage finances and records', permissions: ['view_dashboard', 'view_reports', 'manage_income_expense', 'view_orders'] },
                        // SEC-3/SEC-4: no manage_users by default (see the seed above).
                        { id: 'store_manager', name: 'Store Manager', description: 'Manage store operations', permissions: ['view_dashboard', 'process_sales', 'view_reports', 'manage_orders', 'create_orders', 'view_orders', 'manage_attendance'] },
                        { id: 'salesman', name: 'Salesman', description: 'Sales and order viewing', permissions: ['process_sales', 'view_dashboard', 'manage_orders', 'view_orders', 'create_orders'] },
                        { id: 'cashier', name: 'Cashier', description: 'Process sales and payments', permissions: ['process_sales', 'view_dashboard', 'create_orders', 'view_orders'] },
                        { id: 'customer_care', name: 'Customer Care', description: 'Manage support and orders', permissions: ['view_dashboard', 'manage_orders', 'view_orders', 'manage_settings', 'create_orders', 'process_sales'] }
                    ];

                    baseRoles.forEach(br => {
                        if (!updatedRoles.find((ur: Role) => ur.id === br.id)) {
                            updatedRoles.push(br as any);
                        }
                    });

                    const updatedConfig = {
                        ...loadedConfig,
                        cities: loadedConfig.cities && loadedConfig.cities.includes('រាជធានីភ្នំពេញ') ? loadedConfig.cities : [
                            'រាជធានីភ្នំពេញ',
                            'ខេត្តបន្ទាយមានជ័យ',
                            'ខេត្តបាត់ដំបង',
                            'ខេត្តកំពង់ចាម',
                            'ខេត្តកំពង់ឆ្នាំង',
                            'ខេត្តកំពង់ស្ពឺ',
                            'ខេត្តកំពង់ធំ',
                            'ខេត្តកំពត',
                            'ខេត្តកណ្តាល',
                            'ខេត្តកោះកុង',
                            'ខេត្តក្រចេះ',
                            'ខេត្តមណ្ឌលគិរី',
                            'ខេត្តព្រះវិហារ',
                            'ខេត្តព្រៃវែង',
                            'ខេត្តពោធិ៍សាត់',
                            'ខេត្តរតនគិរី',
                            'ខេត្តសៀមរាប',
                            'ខេត្តព្រះសីហនុ',
                            'ខេត្តស្ទឹងត្រែង',
                            'ខេត្តស្វាយរៀង',
                            'ខេត្តតាកែវ',
                            'ខេត្តឧត្តរមានជ័យ',
                            'ខេត្តកែប',
                            'ខេត្តប៉ៃលិន',
                            'ខេត្តត្បូងឃ្មុំ'
                        ],
                        pinnedProducts: loadedConfig.pinnedProducts || [],
                        pinnedOrderColumns: loadedConfig.pinnedOrderColumns || [],
                        salesOrder: loadedConfig.salesOrder || [],
                        productOrder: loadedConfig.productOrder || [],
                        shippingCompanies: loadedConfig.shippingCompanies?.includes('D2D') 
                            ? loadedConfig.shippingCompanies 
                            : [...(loadedConfig.shippingCompanies || []), 'D2D'],
                        roles: updatedRoles
                    };
                    setConfig(updatedConfig);
                    await supabase.from('app_config').upsert({ id: 1, data: updatedConfig });
                } else {
                    setConfig(loadedConfig);
                }
            }
        } catch (error) {
            console.error("Error fetching data:", error);
        } finally {
            if (!silent) setIsLoading(false);
        }
    };

    useEffect(() => {
        // Hydrated from a snapshot → refresh silently in the background
        // (a non-silent refresh would re-raise the full-screen loading gate).
        // Mount-only on purpose: same pattern (and same disable) as the
        // refreshData effect in UserManagement.tsx.
        refreshData(!!bootSnapshot);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Persist the boot snapshot whenever its slow-changing pieces settle, so
    // the NEXT launch paints instantly (see loadBootSnapshot above). Debounced
    // — these states all change together right after refreshData. Guarded by
    // users.length so a failed boot's empty state never overwrites a good
    // snapshot (a store always has at least one user).
    useEffect(() => {
        if (users.length === 0) return;
        const id = setTimeout(() => {
            try {
                const snap: BootSnapshot = {
                    url: import.meta.env.VITE_SUPABASE_URL,
                    savedAt: new Date().toISOString(),
                    // Legacy products can carry multi-MB base64 images; snapshot
                    // them without the blob (the grid shows its placeholder until
                    // the background refresh restores the real image) so the
                    // snapshot stays small. Storage URLs pass through untouched.
                    products: products.map(p => (p.image && p.image.startsWith('data:') ? { ...p, image: '' } : p)),
                    users,
                    warehouses,
                    warehouseStock,
                    config,
                };
                const json = JSON.stringify(snap);
                // localStorage quota is ~5 MB for the whole origin; a snapshot
                // that somehow still ends up huge is not worth evicting other
                // keys for. Normal size is well under 300 KB.
                if (json.length <= 2_000_000) localStorage.setItem(BOOT_SNAPSHOT_KEY, json);
            } catch { /* quota/private mode — the snapshot is only an optimisation */ }
        }, 800);
        return () => clearTimeout(id);
    }, [products, users, warehouses, warehouseStock, config]);

    const customerCare = useMemo(() => {
        const userNames = users
            .filter(u => u.roleId === 'customer_care' || u.roleId === 'admin')
            .map(u => u.name);
        return Array.from(new Set([...userNames, ...(config.customerCare || [])])).filter(Boolean);
    }, [users, config.customerCare]);

    // Sync Config to DB. Optimistic: the UI updates at once; if the save
    // fails the change is ROLLED BACK and the error rethrown, so callers can
    // show it — otherwise a failed write (e.g. RLS on app_config of a
    // misconfigured instance) silently vanished on the next reload.
    const updateConfig = async (newConfig: ConfigState) => {
        const previous = config;
        setConfig(newConfig);
        const { error } = await supabase.from('app_config').upsert({ id: 1, data: newConfig });
        if (error) {
            console.error('Failed to update config in Supabase:', error);
            setConfig(previous);
            throw new Error('Failed to update configuration: ' + error.message);
        }
    };

    // Prepend a new order id to config.salesOrder WITHOUT clobbering the rest
    // of the config. Order creation used to upsert the entire in-memory blob,
    // so a terminal holding a stale config (roles, blocklist, settings edited
    // on another machine) silently reverted those edits with every new order.
    // Read-merge-write scopes the change to salesOrder alone.
    const prependToSalesOrder = async (saleId: string) => {
        setConfig(prev => ({ ...prev, salesOrder: [saleId, ...(prev.salesOrder || [])] }));
        try {
            const { data: cfgRow, error: readErr } = await supabase.from('app_config').select('data').eq('id', 1).single();
            // NEVER write after a failed/empty read: merging into {} would
            // replace the whole config blob with just salesOrder, destroying
            // roles, the scammer blocklist, shipping settings, everything.
            // The manual row position for one order is not worth that risk.
            if (readErr || !cfgRow?.data || typeof cfgRow.data !== 'object') {
                console.error('Skipped persisting sales order position (config read failed):', readErr?.message || 'no config data');
                return;
            }
            const freshData = cfgRow.data as any;
            const merged = { ...freshData, salesOrder: [saleId, ...(freshData.salesOrder || [])] };
            const { error } = await supabase.from('app_config').upsert({ id: 1, data: merged });
            if (error) console.error('Failed to persist sales order position:', error);
        } catch (e) {
            console.error('Failed to persist sales order position:', e);
        }
    };

    // The add/remove helpers RETURN updateConfig's promise so the UI (e.g.
    // ConfigModal) can await and surface a failed save; the lists are read
    // defensively for the same reason as the load-time normalisation above.
    const addShippingCompany = (name: string) => {
        const list = config.shippingCompanies || [];
        if (list.includes(name)) return Promise.resolve();
        return updateConfig({ ...config, shippingCompanies: [...list, name] });
    };

    const removeShippingCompany = (name: string) => {
        return updateConfig({ ...config, shippingCompanies: (config.shippingCompanies || []).filter(c => c !== name) });
    };

    const updateShippingRate = (company: string, rate: number) => {
        return updateConfig({ ...config, shippingRates: { ...(config.shippingRates || {}), [company]: rate } });
    };

    // Tracking page URL per shipping company ({tracking} = waybill number).
    // An empty template removes the override (a recognised carrier such as
    // J&T then falls back to its built-in template).
    const updateTrackingUrlTemplate = (company: string, template: string) => {
        const next = { ...(config.trackingUrlTemplates || {}) };
        const t = template.trim();
        if (t) next[company] = t; else delete next[company];
        return updateConfig({ ...config, trackingUrlTemplates: next });
    };

    const addSalesman = (name: string) => {
        const list = config.salesmen || [];
        if (list.includes(name)) return Promise.resolve();
        return updateConfig({ ...config, salesmen: [...list, name] });
    };

    const removeSalesman = (name: string) => {
        return updateConfig({ ...config, salesmen: (config.salesmen || []).filter(s => s !== name) });
    };

    const addCategory = (name: string) => {
        const list = config.categories || [];
        if (list.includes(name)) return Promise.resolve();
        return updateConfig({ ...config, categories: [...list, name] });
    };

    const removeCategory = (name: string) => {
        return updateConfig({ ...config, categories: (config.categories || []).filter(c => c !== name) });
    };

    const addPage = (name: string) => {
        const list = config.pages || [];
        if (list.includes(name)) return Promise.resolve();
        return updateConfig({ ...config, pages: [...list, name] });
    };

    const removePage = (name: string) => {
        return updateConfig({ ...config, pages: (config.pages || []).filter(p => p !== name) });
    };

    // Districts/communes layered on top of the official src/data/cambodia.json
    // hierarchy (Sales Setup's Provinces browser). A custom entry is ours to
    // delete outright; an official one is only ever hidden via its code going
    // onto the removed list, since the underlying JSON itself is read-only.
    const addCustomDistrict = (provinceCode: string, name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return Promise.resolve();
        const entry = { code: `custom-${generateUUID()}`, provinceCode, khmer: trimmed, latin: trimmed };
        return updateConfig({ ...config, customDistricts: [...(config.customDistricts || []), entry] });
    };

    const removeDistrictEntry = (code: string, isCustom: boolean) => {
        if (isCustom) {
            return updateConfig({ ...config, customDistricts: (config.customDistricts || []).filter(d => d.code !== code) });
        }
        if ((config.removedDistrictCodes || []).includes(code)) return Promise.resolve();
        return updateConfig({ ...config, removedDistrictCodes: [...(config.removedDistrictCodes || []), code] });
    };

    const addCustomCommune = (districtCode: string, name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return Promise.resolve();
        const entry = { code: `custom-${generateUUID()}`, districtCode, khmer: trimmed, latin: trimmed };
        return updateConfig({ ...config, customCommunes: [...(config.customCommunes || []), entry] });
    };

    const removeCommuneEntry = (code: string, isCustom: boolean) => {
        if (isCustom) {
            return updateConfig({ ...config, customCommunes: (config.customCommunes || []).filter(c => c.code !== code) });
        }
        if ((config.removedCommuneCodes || []).includes(code)) return Promise.resolve();
        return updateConfig({ ...config, removedCommuneCodes: [...(config.removedCommuneCodes || []), code] });
    };

    const addCustomerCare = (name: string) => {
        const list = config.customerCare || [];
        if (list.includes(name)) return Promise.resolve();
        return updateConfig({ ...config, customerCare: [...list, name] });
    };

    const removeCustomerCare = (name: string) => {
        return updateConfig({ ...config, customerCare: (config.customerCare || []).filter(c => c !== name) });
    };

    const addPaymentMethod = (name: string) => {
        const list = config.paymentMethods || [];
        if (list.includes(name)) return Promise.resolve();
        return updateConfig({ ...config, paymentMethods: [...list, name] });
    };

    const removePaymentMethod = (name: string) => {
        return updateConfig({ ...config, paymentMethods: (config.paymentMethods || []).filter(p => p !== name) });
    };

    const addCity = (name: string) => {
        const list = config.cities || [];
        if (list.includes(name)) return Promise.resolve();
        return updateConfig({ ...config, cities: [...list, name] });
    };

    const removeCity = (name: string) => {
        return updateConfig({ ...config, cities: (config.cities || []).filter(c => c !== name) });
    };

    // All blocklist matching is by normalized (digits-only) phone — entries and
    // order snapshots carry mixed formats, and exact-string comparison let
    // blocked customers slip through.
    const addBlockedCustomer = async (customer: BlockedCustomer) => {
        const existing = config.blockedCustomers || [];
        if (existing.some(c => normalizePhone(c.phone) === normalizePhone(customer.phone))) return; // already blocked
        try {
            await updateConfig({ ...config, blockedCustomers: [...existing, customer] });
        } catch (error: any) {
            alert("Failed to mark scammer: " + error.message);
        }
    };

    const addBlockedCustomers = async (customers: BlockedCustomer[]) => {
        const existing = config.blockedCustomers || [];
        const seen = new Set(existing.map(e => normalizePhone(e.phone)));
        const newCustomers: BlockedCustomer[] = [];
        for (const c of customers) {
            const key = normalizePhone(c.phone);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            newCustomers.push(c);
        }
        if (newCustomers.length === 0) return;
        try {
            await updateConfig({ ...config, blockedCustomers: [...existing, ...newCustomers] });
        } catch (error: any) {
            alert("Failed to mark scammers: " + error.message);
        }
    };

    const removeBlockedCustomer = (phone: string) => {
        const key = normalizePhone(phone);
        const existing = config.blockedCustomers || [];
        updateConfig({ ...config, blockedCustomers: existing.filter(c => normalizePhone(c.phone) !== key) });
    };

    // Batched unblock in ONE config write: looping removeBlockedCustomer built
    // every removal from the same stale array, so only the last call survived.
    const removeBlockedCustomers = (phones: string[]) => {
        const keys = new Set(phones.map(normalizePhone));
        const existing = config.blockedCustomers || [];
        updateConfig({ ...config, blockedCustomers: existing.filter(c => !keys.has(normalizePhone(c.phone))) });
    };

    const updateBlockedCustomer = (phone: string, updates: Partial<BlockedCustomer>) => {
        const key = normalizePhone(phone);
        const existing = config.blockedCustomers || [];
        updateConfig({
            ...config,
            blockedCustomers: existing.map(c => normalizePhone(c.phone) === key ? { ...c, ...updates } : c)
        });
    };

    const toggleProductPin = (productId: string) => {
        const pinned = config.pinnedProducts || [];
        if (pinned.includes(productId)) {
            updateConfig({ ...config, pinnedProducts: pinned.filter(id => id !== productId) });
        } else {
            updateConfig({ ...config, pinnedProducts: [...pinned, productId] });
        }
    };

    // Load pinned columns from localStorage on user change
    useEffect(() => {
        if (currentUser) {
            const key = `pinnedOrderColumns_${currentUser.id || currentUser.name}`;
            const stored = localStorage.getItem(key);
            setPinnedOrderColumns(stored ? JSON.parse(stored) : []);
        } else {
            setPinnedOrderColumns([]);
        }
    }, [currentUser]);

    const toggleOrderColumnPin = (columnId: string) => {
        setPinnedOrderColumns(prev => {
            const updated = prev.includes(columnId)
                ? prev.filter(id => id !== columnId)
                : [...prev, columnId];
            if (currentUser) {
                const key = `pinnedOrderColumns_${currentUser.id || currentUser.name}`;
                localStorage.setItem(key, JSON.stringify(updated));
            }
            return updated;
        });
    };

    const updateProductOrder = (order: string[]) => {
        updateConfig({ ...config, productOrder: order });
    };

    const [cart, setCart] = useState<CartItem[]>([]);
    const [editingOrder, setEditingOrder] = useState<Sale | null>(null);

    // Persistence - REMOVED (Migrated to Supabase)
    // LocalStorage syncing caused QuotaExceededError and is no longer needed.


    // Cart Actions
    const addToCart = (product: Product) => {
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) {
                // Check stock limit
                if (existing.quantity >= product.stock) return prev;
                return prev.map(item =>
                    item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
                );
            }
            return [...prev, { ...product, quantity: 1 }];
        });
    };

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.id !== productId));
    };

    const updateCartQuantity = (productId: string, quantity: number) => {
        if (quantity <= 0) {
            removeFromCart(productId);
            return;
        }

        const product = products.find(p => p.id === productId);
        if (!product || quantity > product.stock) return;

        setCart(prev => prev.map(item =>
            item.id === productId ? { ...item, quantity } : item
        ));
    };

    const clearCart = () => setCart([]);
    const updateCart = (items: CartItem[]) => setCart(items);

    // Customer Actions
    const addCustomer = async (customerData: Omit<Customer, 'id'>) => {
        const newCustomer: Customer = {
            ...customerData,
            id: Date.now().toString()
        };
        setCustomers(prev => [...prev, newCustomer]);
        await supabase.from('customers').insert(newCustomer);
    };

    const updateCustomer = async (id: string, updates: Partial<Customer>) => {
        setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
        await supabase.from('customers').update(updates).eq('id', id);
    };

    const deleteCustomer = async (id: string) => {
        setCustomers(prev => prev.filter(c => c.id !== id));
        await supabase.from('customers').delete().eq('id', id);
    };

    // Transaction Actions
    const addTransaction = async (transaction: Omit<Transaction, 'id' | 'created_at'>) => {
        try {
            const newTransaction = {
                ...transaction,
                id: generateUUID()
            };
            const { data, error } = await supabase.from('transactions').insert([newTransaction]).select().single();
            if (error) throw error;
            if (data) setTransactions(prev => [data, ...prev]);
        } catch (error) {
            console.error('Error adding transaction:', error);
            throw error;
        }
    };

    const updateTransaction = async (id: string, updates: Partial<Transaction>) => {
        try {
            const { data, error } = await supabase.from('transactions').update(updates).eq('id', id).select().single();
            if (error) throw error;
            if (data) setTransactions(prev => prev.map(t => t.id === id ? data : t));
        } catch (error) {
            console.error('Error updating transaction:', error);
            throw error;
        }
    };

    const deleteTransaction = async (id: string) => {
        try {
            const { error } = await supabase.from('transactions').delete().eq('id', id);
            if (error) throw error;
            setTransactions(prev => prev.filter(t => t.id !== id));
        } catch (error) {
            console.error('Error deleting transaction:', error);
            throw error;
        }
    };

    const deleteTransactions = async (ids: string[]) => {
        try {
            const { error } = await supabase.from('transactions').delete().in('id', ids);
            if (error) throw error;
            setTransactions(prev => prev.filter(t => !ids.includes(t.id)));
        } catch (error) {
            console.error('Error deleting transactions:', error);
            throw error;
        }
    };

    // Sales Actions
    const processSale = async (paymentMethod: Sale['paymentMethod'], discount: number = 0, customer?: Sale['customer']): Promise<Sale | undefined> => {
        if (cart.length === 0) return;

        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const total = Math.max(0, subtotal - discount);

        const newSale: Sale = {
            id: generateUUID(),
            items: [...cart],
            total,
            discount,
            date: new Date().toISOString(),
            paymentMethod,
            type: 'POS',
            customer: customer || {
                name: 'General Customer',
                phone: '',
            },
            amountReceived: paymentMethod === 'COD' ? 0 : total, // Initial logic for receipt
            paymentStatus: paymentMethod === 'COD' ? 'Unpaid' : 'Paid', // Assuming instant pay if not COD
            salesman: 'Sokheng', // Default or fetch from auth
            customerCare: 'Chantha'
        };

        // If paying instantly (not COD), record the income transaction
        if (newSale.paymentStatus === 'Paid') {
            const transactionId = generateUUID();
            const newTransaction = {
                id: transactionId,
                date: new Date().toISOString(),
                type: 'Income' as const,
                category: 'លក់រាយ',
                amount: newSale.amountReceived || newSale.total,
                description: newSale.customer?.name || 'Customer',
                addedBy: currentUser?.name || 'System',
                order_id: newSale.id,
                customer_phone: newSale.customer?.phone || null
            };

            // Optimistic update
            setTransactions(prev => [newTransaction, ...prev]);

            // Async insert — order_id/customer_phone need migrations/add_transaction_order_link.sql.
            // Strip only the column(s) an older instance's error actually names and retry, so one
            // missing column never also drops another, still-valid one.
            const insertPayload: Record<string, unknown> = {
                id: newTransaction.id,
                date: newTransaction.date,
                type: newTransaction.type,
                category: newTransaction.category,
                amount: newTransaction.amount,
                description: newTransaction.description,
                added_by: newTransaction.addedBy,
                order_id: newTransaction.order_id,
                customer_phone: newTransaction.customer_phone
            };
            (async () => {
                let error: { message?: string } | null | undefined;
                for (let attempt = 0; attempt < 3; attempt++) {
                    ({ error } = await supabase.from('transactions').insert([insertPayload]));
                    if (!error) break;
                    const msg = error.message || '';
                    let stripped = false;
                    if (/order_id/i.test(msg) && 'order_id' in insertPayload) { delete insertPayload.order_id; stripped = true; }
                    if (/customer_phone/i.test(msg) && 'customer_phone' in insertPayload) { delete insertPayload.customer_phone; stripped = true; }
                    if (!stripped) break;
                }
                if (error) console.error('Failed to create transaction for POS sale:', error);
            })();
        }

        // Update Sales Local
        setSales(prev => [newSale, ...prev]);

        // Clear Cart Local
        clearCart();

        // Async Updates
        // 1. Insert Sale
        const { error: saleError } = await supabase.from('sales').insert({
            id: newSale.id,
            total,
            discount,
            date: newSale.date,
            payment_method: paymentMethod,
            type: 'POS',
            salesman: newSale.salesman,
            customer_care: newSale.customerCare,
            amount_received: newSale.amountReceived,
            payment_status: newSale.paymentStatus,
            customer_snapshot: newSale.customer,
            order_status: 'Closed', // POS sales usually closed? Or Open?
            page_source: newSale.customer?.page || null
        });

        if (saleError) console.error('Sale insert error', saleError);

        // 2. Insert Items
        const itemsPayload = newSale.items.map(item => ({
            id: generateUUID(),
            sale_id: newSale.id,
            product_id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity
            // image: item.image - Removed to save DB space
        }));
        const { error: itemsError } = await supabase.from('sale_items').insert(itemsPayload);
        if (itemsError) {
            console.error('Failed to insert items:', itemsError);
            throw new Error('Failed to insert items: ' + itemsError.message);
        }

        // 3. Update Stock - REMOVED (As requested by user, skip POS auto deduct)
        /*
        newSale.items.forEach(async (item) => {
            // Local update
            setProducts(prev => prev.map(p => {
                if (p.id === item.id) return { ...p, stock: p.stock - item.quantity };
                return p;
            }));
            // DB update
            const { data: current } = await supabase.from('products').select('stock').eq('id', item.id).single();
            if (current) {
                await supabase.from('products').update({ stock: current.stock - item.quantity }).eq('id', item.id);
            }
        });
        */

        // Update salesOrder config (scoped write — see prependToSalesOrder)
        prependToSalesOrder(newSale.id);

        return newSale;
    };

    // Inventory Actions
    // Returns the created product (or null on failure), so callers like the
    // PO form's inline "create product" can select it right away.
    const addProduct = async (productData: Omit<Product, 'id'>): Promise<Product | null> => {
        const newProduct: Product = {
            ...productData,
            id: Date.now().toString(),
            createdAt: new Date().toISOString()
        };
        // Optimistic update
        setProducts(prev => [...prev, newProduct]);

        // Map to DB structure
        const dbProduct = {
            id: newProduct.id,
            name: newProduct.name,
            price: newProduct.price,
            purchase_cost: newProduct.purchaseCost || 0,
            stock: newProduct.stock,
            low_stock_threshold: newProduct.lowStockThreshold,
            image: newProduct.image,
            category: newProduct.category,
            model: newProduct.model,
            sku: newProduct.sku,
            invoice_number: newProduct.invoiceNumber,
            supplier: newProduct.supplier
        };

        const { error } = await supabase.from('products').insert(dbProduct);
        if (error) {
            console.error('Error adding product:', error);
            alert(`Failed to add product: ${error.message}\nPlease check database permissions (RLS) or connection.`);
            // Rollback local state
            setProducts(prev => prev.filter(p => p.id !== newProduct.id));
            return null;
        }
        if (newProduct.stock > 0) {
            const inventoryItems = Array.from({ length: newProduct.stock }).map(() => ({
                product_id: newProduct.id,
                cost_of_purchase: newProduct.purchaseCost || 0,
                status: 'in_stock'
            }));
            await supabase.from('inventory_items').insert(inventoryItems);
        }
        setProductsUpdatedAt(Date.now());
        dispatchActivity({ action: 'product_added', description: `Product "${newProduct.name}" added`, userId: currentUser?.id, userName: currentUser?.name, metadata: { productId: newProduct.id } });
        return newProduct;
    };

    const updateProduct = async (id: string, updates: Partial<Product>) => {
        if (updates.stock !== undefined) {
            updates.stock = Math.max(0, updates.stock);
        }
        setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));

        // Map updates to DB structure
        const dbUpdates: any = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.price !== undefined) dbUpdates.price = updates.price;
        if (updates.purchaseCost !== undefined) dbUpdates.purchase_cost = updates.purchaseCost;
        if (updates.stock !== undefined) dbUpdates.stock = Math.max(0, updates.stock);
        if (updates.lowStockThreshold !== undefined) dbUpdates.low_stock_threshold = updates.lowStockThreshold;
        if (updates.image !== undefined) dbUpdates.image = updates.image;
        if (updates.category !== undefined) dbUpdates.category = updates.category;
        if (updates.model !== undefined) dbUpdates.model = updates.model;
        if (updates.sku !== undefined) dbUpdates.sku = updates.sku;
        if (updates.invoiceNumber !== undefined) dbUpdates.invoice_number = updates.invoiceNumber;
        if (updates.supplier !== undefined) dbUpdates.supplier = updates.supplier;

        await supabase.from('products').update(dbUpdates).eq('id', id);
        setProductsUpdatedAt(Date.now());
    };

    const deleteProduct = async (id: string) => {
        // Soft delete the product to preserve foreign key constraints in sale_items
        const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id);
        if (error) {
            console.error('Error soft-deleting product:', error);
            alert(`Failed to delete product: ${error.message}`);
            // Re-fetch to sync state?
            const { data } = await supabase.from('products').select('*').eq('id', id).single();
            if (data) setProducts(prev => [...prev, data]);
        } else {
            setProducts(prev => prev.filter(p => p.id !== id));
            setProductsUpdatedAt(Date.now());
            dispatchActivity({ action: 'product_deleted', description: `Product deleted`, userId: currentUser?.id, userName: currentUser?.name, metadata: { productId: id } });
        }
    };

    const deleteProducts = async (ids: string[]) => {
        // Soft delete the products to preserve foreign key constraints
        const { error } = await supabase.from('products').update({ is_active: false }).in('id', ids);
        if (error) {
            console.error('Error soft-deleting products:', error);
            alert(`Failed to delete products: ${error.message}`);
        } else {
            setProducts(prev => prev.filter(p => !ids.includes(p.id)));
            setProductsUpdatedAt(Date.now());
        }
    };

    // `supplier` feeds the "Supplier / Customer" column in Stock Movements. Without it
    // every stock-in row rendered as "-", since that column falls back to customer_name
    // which is only set for sales-side movements.
    // NOTE: like adjustStock below, this deliberately does NOT toggle the
    // global isLoading — App swaps the whole page for a full-screen loader on
    // that flag, so the PO-receive loop (one addStock per line item) was
    // remounting the page once per item: the screen "loaded" repeatedly and
    // the freshly mounted list fetched BEFORE the status update landed,
    // leaving the Receive button visible. Callers show their own feedback.
    const addStock = async (productId: string, quantity: number, cost?: number, note?: string, supplier?: string) => {
        // The restock's id is picked here and kept when the call fails: if the
        // network dropped after the database added the stock, the retry (same
        // product, quantity and cost) sends the same id and the database adds
        // nothing a second time.
        const signature = JSON.stringify([productId, quantity, cost || 0, note || '', supplier || '']);
        const [restockId] = addStockKeys.take(signature);
        try {
            // One database function (add_product_stock) writes the inventory_items
            // (one per unit, at this cost or the product's purchase cost),
            // products.stock, the restocks row and the stock movement in one
            // transaction: a failure adds nothing.
            const newStock = await callDbFunction<number>('add_product_stock', {
                p_product_id: productId,
                p_quantity: quantity,
                p_cost: cost || 0,
                p_note: note || '',
                p_supplier: supplier || '',
                p_added_by: currentUser?.name || 'Unknown',
                p_created_by: currentUser?.id || null,
                p_today: getLocalYYYYMMDD(),
                p_restock_id: restockId,
            }, 'Adding stock');
            addStockKeys.release(signature);

            // Update local state (functional form — loops must compose)
            setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: Number(newStock) || 0 } : p));
            setProductsUpdatedAt(Date.now());
        } catch (error: any) {
            // Rethrow so callers can react.
            console.error("Error adding stock:", error);
            throw error;
        }
    };

    // Receives a purchase order into stock — the ONE receive used by the PO
    // list, Receiving and the PO form. One database function
    // (receive_purchase_order) adds what hasn't arrived yet for this PO (from
    // the restocks carrying its 'Received from PO-xxxxxxxx' note), marks it
    // Received and books its Draft purchase entry (Dr Inventory / Cr Accounts
    // Payable, GRN), all in one transaction: a failure changes nothing, and a
    // second click or retry of a received PO is refused. Returns notices worth
    // showing (e.g. a Posted purchase entry it left alone).
    // reopenCancelled: the PO form saving a cancelled order as Received
    // receives it (the list and Receiving never offer a cancelled PO).
    const receivePurchaseOrder = async (poId: string, opts?: { reopenCancelled?: boolean }): Promise<string[]> => {
        const result = await callDbFunction<{ stock?: Record<string, number> }>('receive_purchase_order', {
            p_po_id: poId,
            p_added_by: currentUser?.name || 'Unknown',
            p_created_by: currentUser?.id || null,
            p_today: getLocalYYYYMMDD(),
            p_reopen_cancelled: !!opts?.reopenCancelled,
        }, 'Receiving purchase orders');
        const stock = result?.stock || {};
        if (Object.keys(stock).length > 0) {
            setProducts(prev => prev.map(p => p.id in stock ? { ...p, stock: Number(stock[p.id]) || 0 } : p));
            setProductsUpdatedAt(Date.now());
        }
        return noticesOf(result);
    };

    // NOTE: deliberately does NOT toggle the global isLoading — App renders a
    // full-screen loader on that flag, and this runs from inline cell edits and
    // bulk loops where blanking the app (and losing page state) is wrong.
    const adjustStock = async (productId: string, newStock: number, reason: string) => {
        try {
            const product = products.find(p => p.id === productId);
            if (!product) throw new Error("Product not found");

            // Read the current stock from the DB, not the render closure — in a
            // bulk loop or right after another edit the closure value is stale
            // and would produce a wrong ledger delta.
            const { data: dbProduct, error: readError } = await supabase.from('products').select('stock').eq('id', productId).single();
            if (readError) throw readError;
            const currentStock = dbProduct ? Number(dbProduct.stock) : product.stock;
            const difference = newStock - currentStock;

            if (difference === 0) return; // No change

            // 1. Update product stock in DB
            const { error: productError } = await supabase.from('products').update({ stock: newStock }).eq('id', productId);
            if (productError) throw productError;

            // 2. Log to stock_movements
            const type = difference > 0 ? 'in' : 'out';
            const { error: movementError } = await supabase.from('stock_movements').insert({
                product_id: productId,
                product_name: product.name,
                type: type,
                quantity: Math.abs(difference),
                unit_price: product.purchaseCost || 0,
                source: 'Manual Adjustment',
                reason: 'Stock Count / Adjustment',
                note: reason || `Adjusted from ${currentStock} to ${newStock}`,
                movement_date: getLocalYYYYMMDD(),
                created_by: currentUser?.id
            });
            
            if (movementError) console.error('Failed to log stock adjustment movement:', movementError);

            // 3. (Optional) If positive adjustment, we could add to inventory_items, 
            // but for a generic adjustment, we'll just adjust the total stock for now.

            // 4. Update local state — functional form, so concurrent/looped
            // adjustments and a preceding updateProduct compose instead of the
            // last call clobbering the others with a stale array.
            setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: newStock } : p));
            setProductsUpdatedAt(Date.now());
        } catch (error: any) {
            console.error("Error adjusting stock:", error);
            alert(`Failed to adjust stock: ${error.message}`);
        }
    };

    // Creates an online/retail order: the sales row, its items and — for an
    // order born Paid/Settled or with a Deposit — the income row(s), all in
    // ONE database transaction (create_retail_order). A failure creates
    // nothing: no orphan income, no half order. The order keeps its
    // client-generated id; a retry after a lost reply re-sends the same id
    // and is reported as already created instead of creating a second order.
    const addOnlineOrder = async (order: Omit<Sale, 'id'>): Promise<Sale> => {
        const signature = JSON.stringify({
            total: order.total,
            status: order.paymentStatus || '',
            customer: order.customer?.name || '',
            phone: order.customer?.phone || '',
            items: (order.items || []).map(i => [i.id, i.quantity, i.price]),
        });
        const nowMs = Date.now();
        for (const [k, v] of pendingOrderIds) if (nowMs - v.at > ORDER_RETRY_WINDOW_MS) pendingOrderIds.delete(k);
        const held = pendingOrderIds.get(signature);
        const newSale: Sale = {
            ...order,
            id: held ? held.id : nowMs.toString(),
            date: order.date || new Date().toISOString()
        };
        pendingOrderIds.set(signature, { id: newSale.id, at: nowMs });
        const [txId, depTxId] = paymentTxKeys.take('create:' + newSale.id, 2);

        const { data, error } = await supabase.rpc('create_retail_order', {
            p_order: {
                id: newSale.id,
                total: newSale.total,
                discount: newSale.discount,
                date: newSale.date,
                payment_method: newSale.paymentMethod,
                salesman: newSale.salesman,
                customer_care: newSale.customerCare,
                amount_received: newSale.amountReceived,
                payment_status: newSale.paymentStatus,
                deposit_amount: newSale.depositAmount || 0,
                deposit_date: newSale.depositDate || null,
                deposit_method: newSale.depositMethod || null,
                customer_snapshot: newSale.customer,
                page_source: newSale.customer?.page || null,
                shipping_company: newSale.shipping?.company,
                tracking_number: newSale.shipping?.trackingNumber,
                shipping_status: newSale.shipping?.status,
                remark: newSale.remark,
                settle_date: newSale.settleDate || null
            },
            p_items: newSale.items.map(item => ({ id: item.id, name: item.name, price: item.price, quantity: item.quantity })),
            p_fields: { added_by: currentUser?.name || 'System', tx_id: txId, dep_tx_id: depTxId },
        });
        if (error) {
            // A genuinely different order colliding on the same millisecond id:
            // let the next try mint a fresh id instead of re-sending this one.
            if (/already exists|duplicate key/i.test(error.message || '')) pendingOrderIds.delete(signature);
            console.error('Error creating online order:', error);
            throw new Error('Failed to create order: ' + orderPaymentRpcMessage(error));
        }
        pendingOrderIds.delete(signature);
        paymentTxKeys.release('create:' + newSale.id);

        const res = (data || {}) as { already_created?: boolean; transactions?: Transaction[] };
        const resTxs = res.transactions || [];
        if (resTxs.length > 0) {
            const ids = resTxs.map(t => t.id);
            setTransactions(prev => [...resTxs, ...prev.filter(t => !ids.includes(t.id))]);
        }
        setSales(prev => [newSale, ...prev.filter(sale => sale.id !== newSale.id)]);

        // Update salesOrder config (scoped write — see prependToSalesOrder)
        if (!res.already_created) {
            prependToSalesOrder(newSale.id);
            dispatchActivity({ action: 'order_created', description: `New order #${newSale.id.slice(0, 8)} created — $${newSale.total}`, userId: currentUser?.id, userName: currentUser?.name, metadata: { orderId: newSale.id, total: newSale.total } });
        }
        setSalesUpdatedAt(Date.now());
        return newSale;
    };

    // The status-change, restock and item-edit functions arrive with
    // migrations/add_order_status_function.sql; until it is run, PostgREST
    // reports them as missing. Plain messages for the other failures too.
    const orderRpcMessage = (error: unknown): string => {
        const e = error as { code?: string; message?: string } | null;
        const message = String(e?.message || error || '');
        if (isRpcMissingError(e) || (/set_order_shipping_status|restock_returned_orders|edit_order_items/i.test(message) && /schema cache|does not exist/i.test(message))) {
            return ORDER_FUNCTIONS_MISSING_MESSAGE;
        }
        if (/sale_items_product_id_fkey/i.test(message)) {
            return 'A product on this order no longer exists. Remove it from the order and save again.';
        }
        return message || 'Unknown error';
    };

    // Same, for the order-payment functions, which arrive with
    // migrations/add_order_payment_functions.sql.
    const orderPaymentRpcMessage = (error: unknown): string => {
        const e = error as { code?: string; message?: string } | null;
        const message = String(e?.message || error || '');
        if (isRpcMissingError(e) || (/create_retail_order|set_order_payment|delete_retail_orders|apply_restock_payment_side|order_payment_functions_ready/i.test(message) && /schema cache|does not exist/i.test(message))) {
            return ORDER_PAYMENT_FUNCTIONS_MISSING_MESSAGE;
        }
        if (/sale_items_product_id_fkey/i.test(message)) {
            return 'A product on this order no longer exists. Remove it from the order and save again.';
        }
        return message || 'Unknown error';
    };

    // Whether this store has run migrations/add_order_status_function.sql, asked
    // with the smallest function it adds (it only reads its argument). Asked
    // before an edit writes anything it would then need those functions for, so
    // a store that hasn't run it refuses the edit up front instead of half-saving
    // it. Remembered once found; a network error is not taken as "missing" (the
    // real call then reports it).
    const orderFunctionsReadyRef = useRef(false);
    const orderFunctionsReady = async (): Promise<boolean> => {
        if (orderFunctionsReadyRef.current) return true;
        const { error } = await supabase.rpc('order_status_holds_stock', { p_status: 'Pending' });
        if (error && isRpcMissingError(error)) return false;
        if (!error) orderFunctionsReadyRef.current = true;
        return true;
    };

    // Whether this store has run migrations/add_order_payment_functions.sql
    // (creating orders, payment saves, deletes and the restock payment side).
    // Same contract as orderFunctionsReady above.
    const paymentFunctionsReadyRef = useRef(false);
    const paymentFunctionsReady = async (): Promise<boolean> => {
        if (paymentFunctionsReadyRef.current) return true;
        const { error } = await supabase.rpc('order_payment_functions_ready');
        if (error && isRpcMissingError(error)) return false;
        if (!error) paymentFunctionsReadyRef.current = true;
        return true;
    };

    // Stock values a database function returned, applied to the cached products.
    const applyStockMap = (stock: Record<string, number> | null | undefined) => {
        if (!stock || Object.keys(stock).length === 0) return;
        setProducts(prev => prev.map(p => stock[p.id] !== undefined ? { ...p, stock: Number(stock[p.id]) } : p));
        setProductsUpdatedAt(Date.now());
    };

    // Who and when, for the database functions: the edit stamp, the stock
    // records' author and the local day they are dated.
    const orderStockFields = (now: string): Record<string, unknown> => ({
        now,
        movement_date: getLocalYYYYMMDD(),
        created_by: currentUser?.id || 'unknown',
        added_by: currentUser?.name || 'System',
        ...(currentUser ? { last_edited_at: now, last_edited_by: currentUser.name } : {}),
    });

    type RestockRow = { id: string; product_id: string; quantity: number; cost: number; date: string; added_by: string; note: string };

    // The payment side of a restock, for orders the database has just restocked
    // (it does the stock, the return records and the ReStock status in one go):
    // a previously-Paid order's income and its draft journal entry are removed,
    // and the payment goes to Cancel (a PdFee order keeps PdFee — the delivery
    // fee was collected and stays booked).
    const applyRestockPaymentSide = async (orderIds: string[], now: string) => {
        // One database transaction (apply_restock_payment_side): a
        // previously-Paid order's income row is removed by its ORDER LINK only
        // (never the old customer-name + amount match, which could delete a
        // sibling order's income), its Draft journal entry goes with it (a
        // Posted one stays, with a notice), Received and settle date are
        // reset, and the payment goes to Cancel (a PdFee order keeps PdFee —
        // the delivery fee was collected and stays booked).
        const { data, error } = await supabase.rpc('apply_restock_payment_side', { p_ids: orderIds, p_fields: {} });
        if (error) throw new Error('The goods were restocked, but the payment could not be set to Cancel: ' + orderPaymentRpcMessage(error));
        const res = (data || {}) as { cancelled?: string[]; paid_reset?: string[]; transactions_removed?: string[]; notices?: string[] };

        const removedTxnIds = res.transactions_removed || [];
        if (removedTxnIds.length > 0) {
            setTransactions(prev => prev.filter(t => !removedTxnIds.includes(t.id)));
        }

        const cancelledIds = new Set(res.cancelled || []);
        const paidOrderIds = res.paid_reset || [];

        // Local State Update
        setSales(prev => prev.map(sale =>
            orderIds.includes(sale.id)
            ? {
                ...sale,
                paymentStatus: cancelledIds.has(sale.id) ? 'Cancel' : sale.paymentStatus,
                ...(paidOrderIds.includes(sale.id) ? { amountReceived: 0, settleDate: undefined } : {}),
                lastEditedAt: currentUser ? now : sale.lastEditedAt,
                lastEditedBy: currentUser ? currentUser.name : sale.lastEditedBy,
                shipping: { ...(sale.shipping || { company: '', trackingNumber: '', cost: 0 }), status: 'ReStock' as any }
            }
            : sale
        ));

        if (res.notices && res.notices.length > 0) {
            alert(res.notices.join('\n'));
        }

        dispatchActivity({
            action: 'stock_restock',
            description: `Restocked ${orderIds.length} order${orderIds.length === 1 ? '' : 's'}: ${orderIds.map(id => '#' + id.slice(0, 8)).join(', ')}`,
            userId: currentUser?.id,
            userName: currentUser?.name,
            metadata: { orderIds }
        });
    };

    // The restock records the database wrote, added to the cached history.
    const addRestockRows = (rows: RestockRow[] | null | undefined) => {
        if (!rows || rows.length === 0) return;
        setRestocks(prev => [...rows.map(r => ({
            id: r.id,
            productId: r.product_id,
            quantity: Number(r.quantity),
            cost: Number(r.cost),
            date: r.date,
            addedBy: r.added_by,
            note: r.note
        })), ...prev]);
    };

    // Resolves true when the order is now at the status (or was already there
    // and the tracking/courier were saved), false when the change was refused
    // or failed — the user has been told why (opts.onRefused: handed the reason
    // instead of an alert, for bulk runs that report a count), and nothing of it was written.
    //
    // opts.skipDispatchGuard: for updateOrder, which has already run the same
    // post-dispatch check (or forces Delivered for Get File) before delegating here.
    // opts.shownStatus: the status the caller's screen showed. When the caller sends
    // that same status back (a tracking-only save) but the order has moved on since,
    // the real status is kept instead of being reverted.
    // opts.expectedStatus: the status the caller decided from (updateOrder's own
    // fresh read); refused if the order has moved on since.
    // opts.customer: the customer as saved in the same edit, for the stock records.
    const updateOrderStatus = async (id: string, requestedStatus: NonNullable<Sale['shipping']>['status'], trackingNumber?: string, shippingCompany?: string, opts?: { skipDispatchGuard?: boolean; shownStatus?: string; expectedStatus?: string; onRefused?: (message: string) => void; customer?: { name?: string; phone?: string } }): Promise<boolean> => {
        const refuse = (message: string) => {
            if (opts?.onRefused) opts.onRefused(message);
            else alert(message);
            return false;
        };
        // Every decision below keys off the status BEFORE this change, and this
        // tab's copy can be out of date (no realtime sync). Read it from the
        // database; the database function then refuses if it moves again before
        // the change lands (a double click, a retry, another device).
        const { data: freshOrderRow, error: freshOrderErr } = await supabase
            .from('sales')
            .select('shipping_status, tracking_number')
            .eq('id', id)
            .single();
        if (freshOrderErr || !freshOrderRow) {
            console.error('Could not read current status before changing it:', freshOrderErr?.message);
            return refuse('Could not verify this order’s current status. Please refresh and try again.');
        }
        const freshStatus: string = freshOrderRow.shipping_status || 'Pending';
        const status = (opts?.shownStatus !== undefined && requestedStatus === opts.shownStatus && freshStatus !== requestedStatus
            ? freshStatus
            : requestedStatus) as NonNullable<Sale['shipping']>['status'];
        // The status the change was decided from: what the caller says it expects,
        // else the status its screen showed when it asked for a different one,
        // else (a caller that doesn't say) the status just read.
        const expectedStatus = opts?.expectedStatus !== undefined
            ? (opts.expectedStatus || 'Pending')
            : (opts?.shownStatus !== undefined && requestedStatus !== opts.shownStatus ? (opts.shownStatus || 'Pending') : freshStatus);
        // A real change asked for from a screen that is out of date (the order has
        // moved on since it was shown) is refused, not applied on top of the
        // status someone else set. Same message as the database's own check.
        if (status !== freshStatus && expectedStatus !== freshStatus) {
            setSalesUpdatedAt(Date.now());
            return refuse(`This order is now "${freshStatus}": it was changed somewhere else, so your change was not saved. Refresh and check it before trying again.`);
        }

        // Already at the target status: no transition and no alert (bulk selections
        // routinely mix rows already there). Carry on so a tracking number or courier
        // passed with it is still saved.
        if (POST_DISPATCH_STATUSES.includes(status) && !opts?.skipDispatchGuard && freshStatus !== status) {
            const currentStatus = freshStatus;
            if (!canEnterPostDispatch(currentStatus, status)) {
                if (currentUser?.roleId !== 'admin') return refuse(POST_DISPATCH_BLOCKED_MESSAGE(currentStatus, status));
                if (!confirm(ADMIN_FORCE_STATUS_MESSAGE(currentStatus, status))) return false;
            }
        }

        // Returned -> ReStock means the goods are back on the shelf: the Restock
        // flow (stock, return records, payment Cancel and income cleanup). It
        // needs the Restock permission, and only a Returned order can be restocked.
        const restocking = status === 'ReStock' && freshStatus !== 'ReStock';
        if (restocking && freshStatus !== 'Returned') {
            return refuse(`Only a Returned order can be restocked. This order is "${freshStatus}".`);
        }
        if (restocking && !hasPermission('restock_orders')) {
            return refuse('You do not have permission to restock orders.');
        }
        // The payment side of a restock (income cleanup, payment Cancel) needs
        // the payment functions; refuse before any stock moves.
        if (restocking && !(await paymentFunctionsReady())) {
            return refuse(ORDER_PAYMENT_FUNCTIONS_MISSING_MESSAGE);
        }

        const now = new Date().toISOString();
        const editorName = currentUser?.name;
        const cachedOrder = sales.find(s => s.id === id);
        const fields: Record<string, unknown> = {
            ...orderStockFields(now),
            customer_name: opts?.customer?.name || undefined,
            customer_phone: opts?.customer?.phone || undefined,
            fallback_customer_name: cachedOrder?.customer?.name || undefined,
            fallback_customer_phone: cachedOrder?.customer?.phone || undefined,
        };
        // A defined check, not truthy: '' is a legitimate value now that
        // Orders Management 2's drawer lets staff deliberately clear a
        // tracking number.
        if (trackingNumber !== undefined) fields.tracking_number = trackingNumber;
        if (shippingCompany) fields.shipping_company = shippingCompany;

        let res: { stock?: Record<string, number>; restocked?: string[]; restocks?: RestockRow[] } = {};
        if (status === freshStatus) {
            // No transition (a tracking/courier save, or a status already there):
            // nothing moves stock, so a plain write of those fields, which also
            // works on a store that hasn't run the migration yet. The status itself
            // is not written, so a change made since the read above is kept.
            const plain: Record<string, unknown> = {};
            if (trackingNumber !== undefined) plain.tracking_number = trackingNumber;
            if (shippingCompany) plain.shipping_company = shippingCompany;
            if (currentUser) {
                plain.last_edited_at = now;
                plain.last_edited_by = currentUser.name;
            }
            if (Object.keys(plain).length > 0) {
                const { error: plainErr } = await supabase.from('sales').update(plain).eq('id', id);
                if (plainErr) {
                    console.error('Failed to save the shipping details:', plainErr);
                    setSalesUpdatedAt(Date.now());
                    return refuse(`Failed to save the shipping details: ${plainErr.message}`);
                }
            }
        } else {
            // Status, stock, inventory items, stock-out records (and for a restock the
            // return records) in one database transaction: all of it or none of it.
            const { data: result, error: rpcError } = await supabase.rpc('set_order_shipping_status', {
                p_order_id: id,
                p_expected_status: expectedStatus,
                p_new_status: status,
                p_fields: fields,
            });
            if (rpcError) {
                console.error('Failed to update order status:', rpcError);
                setSalesUpdatedAt(Date.now());
                return refuse(orderRpcMessage(rpcError));
            }
            res = (result || {}) as typeof res;
            applyStockMap(res.stock);
        }

        setSales(prev => prev.map(sale => {
            if (sale.id === id) {
                return {
                    ...sale,
                    lastEditedAt: editorName ? now : sale.lastEditedAt,
                    lastEditedBy: editorName ? editorName : sale.lastEditedBy,
                    shipping: {
                        ...(sale.shipping || {
                            company: '',
                            trackingNumber: '',
                            cost: 0,
                            staffId: '',
                            staffName: '',
                            status: 'Pending'
                        }),
                        status,
                        trackingNumber: trackingNumber ?? (sale.shipping?.trackingNumber || ''),
                        company: shippingCompany || (sale.shipping?.company || '')
                    }
                };
            }
            return sale;
        }));

        if (restocking) {
            addRestockRows(res.restocks);
            try {
                await applyRestockPaymentSide([id], now);
            } catch (e) {
                // The restock itself is done; only the payment step is left.
                console.error('Restock payment step failed:', e);
                alert(e instanceof Error ? e.message : String(e));
            }
            setProductsUpdatedAt(Date.now());
            setSalesUpdatedAt(Date.now());
            return true;
        }

        const oldTracking = freshOrderRow.tracking_number || '';
        if (trackingNumber !== undefined && trackingNumber !== oldTracking) {
            dispatchActivity({
                action: 'order_updated',
                description: `Tracking ID updated for Order #${id.slice(0, 8)}`,
                userId: currentUser?.id,
                userName: currentUser?.name,
                metadata: {
                    orderId: id,
                    oldTracking,
                    newTracking: trackingNumber
                }
            });
        }

        setSalesUpdatedAt(Date.now());
        if (freshStatus !== status) {
            dispatchActivity({ action: 'order_status', description: `Order #${id.slice(0, 8)} status → ${status}`, userId: currentUser?.id, userName: currentUser?.name, metadata: { orderId: id, status } });
        }
        return true;
    };

    // Replaces an order's items. When its goods are already out of stock, the
    // database moves stock by the difference per product and changes the newest
    // stock-out generation (the shipment being edited) to match, in the same
    // transaction as the item replace, so un-shipping, deleting or restocking
    // later reverses exactly what left — and a failure keeps the old items.
    //
    // statusNow: the order's shipping status at this point of the save. On a store
    // that hasn't run the migration, an order whose goods are still on hand gets
    // its items replaced the way it always was (delete, then insert): no stock
    // moves for it, so it needs no database function.
    const replaceOrderItems = async (orderId: string, items: Sale['items'], statusNow: string) => {
        const { data, error } = await supabase.rpc('edit_order_items', {
            p_order_id: orderId,
            p_items: items.map(item => ({ id: item.id || null, name: item.name, price: item.price, quantity: item.quantity, image: item.image ?? null })),
            p_fields: { created_by: currentUser?.id || 'unknown' },
        });
        if (error && isRpcMissingError(error) && !holdsOrderStock(statusNow)) {
            const { error: deleteError } = await supabase.from('sale_items').delete().eq('sale_id', orderId);
            if (deleteError) throw deleteError;
            const { error: insertError } = await supabase.from('sale_items').insert(items.map(item => ({
                id: generateUUID(),
                sale_id: orderId,
                product_id: item.id,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                image: item.image
            })));
            if (insertError) throw insertError;
            return;
        }
        if (error) throw new Error(orderRpcMessage(error));
        const res = (data || {}) as { stock?: Record<string, number>; missing?: string[] };
        applyStockMap(res.stock);
        if (res.missing && res.missing.length > 0) {
            alert(`The order was saved, but stock could not be updated for: ${res.missing.join(', ')}. Check these products' stock in Inventory.`);
        }
    };

    // Resolves false when not everything was saved (the user has been told why):
    // a refusal (a stale screen, a payment or status changed elsewhere, a store
    // without the migration, a shipping status change the database refused) saves
    // nothing; a write that fails part-way leaves what was written before it.
    const updateOrder = async (id: string, updates: Partial<Sale>): Promise<boolean> => {
        // Find existing order BEFORE local update for checking status change
        let existingOrder = sales.find(s => s.id === id);

        if (!existingOrder) {
            const { data } = await supabase.from('sales').select('*').eq('id', id).single();
            if (data) {
                existingOrder = mapSaleEntity(data) as any;
            }
        }

        // The stock-movement block at the end keys off the status BEFORE this update.
        // The local cache can be stale: the status badges run updateOrderStatus (which
        // owns stock + ledger) and then this function for payment side-effects with
        // the same target status — by then the cache still shows the pre-transition
        // status, and replaying the transition here would delete a second movement
        // generation. Read the DB so an already-applied transition reads as a no-op.
        //
        // Also read when the items change (stock follows them on a shipped order)
        // and for the payment statuses that move shipping (Cancel/PdFee -> Pending,
        // Get File -> Delivered): those decisions need the real status too.
        let shippingStatusBeforeUpdate = existingOrder?.shipping?.status;
        const movesShipping = updates.paymentStatus === 'Cancel' || updates.paymentStatus === 'PdFee' || updates.paymentStatus === 'Get File';
        if (updates.shipping?.status || (updates.items && updates.items.length > 0) || movesShipping) {
            const { data: freshStatusRow, error: freshStatusErr } = await supabase.from('sales').select('shipping_status').eq('id', id).single();
            if (freshStatusErr || !freshStatusRow) {
                alert("Couldn't confirm this order's current status, so nothing was saved. Check your connection and try again.");
                return false;
            }
            shippingStatusBeforeUpdate = freshStatusRow.shipping_status || 'Pending';
        }

        // Same rule as updateOrderStatus — this is a second way in (including the bulk
        // edit path, which calls through here per order), so it needs the same guard.
        //
        // Only an actual *change* is rejected here. Saving an edit to a delivered order
        // re-sends its current status unchanged, and treating that as a transition would
        // make every delivered order impossible to edit. Compared against the FRESH
        // status read above, not the cached one — the badges run updateOrderStatus
        // first and then this function with the same target, and the stale cache made
        // that second call read as a brand-new transition (re-prompting an admin who
        // had just confirmed a forced change).
        if (updates.shipping?.status && POST_DISPATCH_STATUSES.includes(updates.shipping.status)) {
            const currentStatus = shippingStatusBeforeUpdate || 'Pending';
            const isRealChange = currentStatus !== updates.shipping.status;
            if (isRealChange && !canEnterPostDispatch(currentStatus, updates.shipping.status)) {
                if (currentUser?.roleId !== 'admin') {
                    alert(POST_DISPATCH_BLOCKED_MESSAGE(currentStatus, updates.shipping.status));
                    return false;
                }
                if (!confirm(ADMIN_FORCE_STATUS_MESSAGE(currentStatus, updates.shipping.status))) return false;
            }
        }

        // Every income and ledger decision below keys off the order's payment state,
        // and this tab's copy can be out of date (no realtime sync) — deciding from
        // it booked sales twice. Use the real state, then claim the change with a
        // compare-and-set so of two racing saves only one can book.
        const PAID_STATUSES = ['Paid', 'Settled', 'Paid/Settled'];
        let freshPayment: Partial<Sale> | null = null;
        const expectedPaymentStatus = updates.expectedPaymentStatus;
        delete updates.expectedPaymentStatus;
        const expectedShippingStatus = updates.expectedShippingStatus;
        delete updates.expectedShippingStatus;
        type PaymentRow = { payment_status: string | null; deposit_amount: number | null; amount_received: number | null; settle_date: string | null; payment_method: string | null };
        const paymentColumns = 'payment_status, deposit_amount, amount_received, settle_date, payment_method';
        const toLocal = (row: PaymentRow): Partial<Sale> => ({
            paymentStatus: row.payment_status as Sale['paymentStatus'],
            depositAmount: Number(row.deposit_amount) || 0,
            amountReceived: Number(row.amount_received) || 0,
            settleDate: row.settle_date || undefined,
            paymentMethod: row.payment_method as Sale['paymentMethod'],
        });
        // The payment row as read below, and whether this save's payment change
        // still has to be claimed (done after the shipping plan is checked).
        let paymentRow: PaymentRow | null = null;
        if (updates.paymentStatus !== undefined) {
            const { data: freshRow, error: freshErr } = await supabase.from('sales').select(paymentColumns).eq('id', id).single();
            if (freshErr || !freshRow) {
                alert("Couldn't confirm this order's current payment status, so nothing was saved. Check your connection and try again.");
                return false;
            }
            paymentRow = freshRow as PaymentRow;
            freshPayment = toLocal(freshRow);
            if (existingOrder) existingOrder = { ...existingOrder, ...freshPayment };

            const shownStatus = expectedPaymentStatus === undefined ? undefined : (expectedPaymentStatus || 'Unpaid');
            const currentStatus = freshRow.payment_status || 'Unpaid';

            // Leaving Paid removes the booked income and journal entry, so it needs
            // someone who could see the order was Paid.
            if (shownStatus !== undefined && updates.paymentStatus !== shownStatus && !PAID_STATUSES.includes(shownStatus) && PAID_STATUSES.includes(currentStatus) && !PAID_STATUSES.includes(updates.paymentStatus)) {
                setSales(prev => prev.map(s => s.id === id ? { ...s, ...freshPayment } : s));
                setSalesUpdatedAt(Date.now());
                alert(`This order was just marked ${currentStatus} by someone else, so your change wasn't saved. The list has been refreshed. Please check the order and try again.`);
                return false;
            }

            // An edit form opened before someone else recorded a payment, saved
            // with the status left alone: that must not undo the payment.
            if (shownStatus !== undefined && (updates.paymentStatus || 'Unpaid') === shownStatus && currentStatus !== shownStatus) {
                delete updates.paymentStatus;
                delete updates.amountReceived;
                delete updates.settleDate;
                delete updates.paymentMethod;
                delete updates.depositAmount;
                delete updates.depositDate;
                delete updates.depositMethod;
            }

        }

        // What this save does to the shipping status. Only a real payment change
        // moves shipping. A form re-saving an order that is already Cancel or Get
        // File (to fix a phone number, say) sends that status back unchanged, and
        // must not re-apply the shipping move: that re-deducted stock or reverted a
        // status someone had since corrected.
        //
        // Cancel / PdFee (Paid for Delivery Fee, treated the same — the order itself
        // isn't fulfilled, only the delivery fee was paid): when the caller ALSO sets
        // a shipping status (the Returned / Cancelled / ReStock transitions cancel
        // payment as a side effect and pass their own status), that status is kept.
        // Otherwise only an order whose goods are still here goes back to Pending. A
        // Shipped or Delivered order goes to Returned instead: the goods are with the
        // courier or the customer and stay counted out until they are restocked
        // (Returns & Restocks lists it). Resetting it to Pending put them back "in
        // stock" on paper only.
        //
        // Get File: Delivered. If the order never shipped, the stock-out is recorded
        // now (entering Delivered from an on-hand status is the goods leaving). Not
        // for a restocked or cancelled order: its goods are on the shelf, and
        // flipping it to Delivered would take them out again.
        //
        // A form echoes the status it was showing (expectedShippingStatus). When the
        // database has moved on since (someone shipped it meanwhile), sending that
        // same status back is not a request to move it back: the real status is
        // kept. Callers that don't say what they showed are taken at their word.
        const planShipping = (paymentChanging: boolean) => {
            let shipping = updates.shipping;
            let forced = false;
            if (!paymentChanging) {
                // nothing to move
            } else if (updates.paymentStatus === 'Cancel' || updates.paymentStatus === 'PdFee') {
                if (!updates.shipping?.status) {
                    const currentShippingStatus = shippingStatusBeforeUpdate || 'Pending';
                    if (isStockConsumed(currentShippingStatus)) {
                        shipping = { ...(existingOrder?.shipping || {}), status: 'Returned' } as Sale['shipping'];
                        forced = true;
                    } else if (!['Returned', 'Cancelled', 'ReStock'].includes(currentShippingStatus)) {
                        shipping = { ...(existingOrder?.shipping || {}), status: 'Pending' } as Sale['shipping'];
                        forced = true;
                    }
                }
            } else if (updates.paymentStatus === 'Get File' && !['ReStock', 'Cancelled'].includes(shippingStatusBeforeUpdate || '')) {
                shipping = { ...(existingOrder?.shipping || {}), ...(updates.shipping || {}), status: 'Delivered' } as Sale['shipping'];
                forced = true;
            }
            if (shipping?.status && shippingStatusBeforeUpdate !== undefined && !forced && expectedShippingStatus !== undefined) {
                const shownShippingStatus = expectedShippingStatus || 'Pending';
                if (shipping.status === shownShippingStatus && shipping.status !== shippingStatusBeforeUpdate) {
                    shipping = { ...shipping, status: shippingStatusBeforeUpdate as NonNullable<Sale['shipping']>['status'] };
                }
            }
            const to = shipping?.status && shippingStatusBeforeUpdate !== undefined && shipping.status !== shippingStatusBeforeUpdate
                ? shipping.status
                : null;
            return { shipping, forced, to };
        };
        const paymentChangingNow = () => updates.paymentStatus !== undefined && freshPayment !== null
            && updates.paymentStatus !== (freshPayment.paymentStatus || 'Unpaid');
        let shippingPlan = planShipping(paymentChangingNow());

        // Everything that can refuse this save is checked before anything is
        // written, so a refusal saves nothing. A status change asked for from a
        // screen that is out of date (the order moved on since it was shown) is
        // refused rather than applied on top of the status someone else set.
        if (shippingPlan.to && !shippingPlan.forced && expectedShippingStatus !== undefined && (expectedShippingStatus || 'Pending') !== shippingStatusBeforeUpdate) {
            setSalesUpdatedAt(Date.now());
            alert(`This order is now "${shippingStatusBeforeUpdate}": it was changed somewhere else, so your change was not saved. Refresh and check it before trying again.`);
            return false;
        }
        // A status change, or an item edit on an order whose goods are out of
        // stock, needs the database functions; a store that hasn't run the
        // migration refuses the whole save here.
        const holdsStockForItems = holdsOrderStock(shippingPlan.to || shippingStatusBeforeUpdate || 'Pending');
        if ((shippingPlan.to || (updates.items && updates.items.length > 0 && holdsStockForItems)) && !(await orderFunctionsReady())) {
            alert(ORDER_FUNCTIONS_MISSING_MESSAGE);
            return false;
        }

        // Whether this save touches the payment side at all — computed after
        // the screen checks above, which may have dropped the payment fields.
        // Every payment save runs as ONE database transaction
        // (set_order_payment, below); a store that hasn't run the migration
        // refuses the whole save here, before anything is written.
        const hasPaymentFields = () => updates.paymentStatus !== undefined || updates.amountReceived !== undefined
            || updates.settleDate !== undefined || updates.paymentMethod !== undefined
            || updates.depositAmount !== undefined || updates.depositDate !== undefined
            || updates.depositMethod !== undefined || updates.depositAccountId !== undefined
            || updates.depositAccountName !== undefined || updates.postToLedger !== undefined;
        if (hasPaymentFields() && !(await paymentFunctionsReady())) {
            alert(ORDER_PAYMENT_FUNCTIONS_MISSING_MESSAGE);
            return false;
        }

        // 2b. A real shipping status change goes through updateOrderStatus, which
        // owns stock: the database moves products.stock, inventory items and the
        // stock-out records together with the status, in one transaction, and
        // only if the order is still at the status read above. Runs before the
        // payment side (income, journal entries) and the sales row below, and
        // before the items are rewritten, so it reverses the items that left. If
        // it is refused, nothing has been written yet and nothing else is
        // written: payment and shipping never end up out of step.
        if (shippingPlan.to) {
            const moved = await updateOrderStatus(id, shippingPlan.to, undefined, shippingPlan.shipping?.company || undefined, {
                skipDispatchGuard: true,
                expectedStatus: shippingStatusBeforeUpdate,
                // The customer from this same save, so the stock records name them
                // (the sales row is written after this).
                customer: updates.customer ? { name: updates.customer.name, phone: updates.customer.phone } : undefined,
            });
            if (!moved) {
                setSalesUpdatedAt(Date.now());
                return false;
            }
        }
        if (shippingPlan.shipping !== undefined) updates.shipping = shippingPlan.shipping;

        // The payment side — status, money columns, income rows and journal
        // entries — is saved by the database in ONE transaction
        // (set_order_payment): a failure or refusal saves none of it, and the
        // income row this save may create carries a retry id, so a save whose
        // reply was lost is reported as already booked instead of booked
        // twice. Runs AFTER the shipping change above: a refused shipping
        // change saves nothing at all, and a refused payment leaves a
        // completed, consistent shipping change (never a claimed payment
        // without its stock move).
        if (hasPaymentFields()) {
            const pUpdates: Record<string, unknown> = {};
            if (updates.paymentStatus !== undefined) pUpdates.payment_status = updates.paymentStatus;
            if (updates.amountReceived !== undefined) pUpdates.amount_received = updates.amountReceived;
            if (updates.settleDate !== undefined) pUpdates.settle_date = updates.settleDate || '';
            if (updates.paymentMethod !== undefined) pUpdates.payment_method = updates.paymentMethod;
            if (updates.depositAmount !== undefined) pUpdates.deposit_amount = updates.depositAmount;
            if (updates.depositDate !== undefined) pUpdates.deposit_date = updates.depositDate || '';
            if (updates.depositMethod !== undefined) pUpdates.deposit_method = updates.depositMethod || '';
            if (updates.depositAccountId !== undefined) pUpdates.deposit_account_id = updates.depositAccountId || '';
            if (updates.depositAccountName) pUpdates.deposit_account_name = updates.depositAccountName;
            if (updates.postToLedger === true) pUpdates.post_to_ledger = true;
            if (updates.receiptReference !== undefined) pUpdates.reference = updates.receiptReference || '';
            if (updates.receiptNotes !== undefined) pUpdates.notes = updates.receiptNotes || '';
            if (updates.customer?.name) pUpdates.customer_name = updates.customer.name;
            if (updates.customer?.phone) pUpdates.customer_phone = updates.customer.phone;
            if (updates.shipping?.company) pUpdates.shipping_company = updates.shipping.company;
            // The deposit this save decided from (the fresh read above): the
            // database refuses when the stored deposit has moved since, so a
            // second stale screen can't quietly lower the deposit under the
            // amounts already booked.
            if (updates.depositAmount !== undefined && paymentRow) pUpdates.expected_deposit_amount = Number(paymentRow.deposit_amount) || 0;
            const paySignature = 'pay:' + id + ':' + JSON.stringify(pUpdates);
            const [payTxId] = paymentTxKeys.take(paySignature);
            pUpdates.tx_id = payTxId;
            const { data: payData, error: payErr } = await supabase.rpc('set_order_payment', {
                p_order_id: id,
                // The status this save decided from (the fresh read above): the
                // database refuses if the order has moved on since — the same
                // job the client-side compare-and-set claim used to do.
                p_expected_status: updates.paymentStatus !== undefined && paymentRow ? (paymentRow.payment_status || 'Unpaid') : null,
                p_updates: pUpdates,
                p_fields: {
                    added_by: currentUser?.name || 'System',
                    today: getLocalYYYYMMDD(),
                    // Minutes east of UTC, so settle-day comparisons run on the
                    // user's LOCAL days (localDayOf's job, now in the database).
                    tz_offset_min: -new Date().getTimezoneOffset(),
                    ...(currentUser ? { last_edited_by: currentUser.name, now: new Date().toISOString() } : {}),
                },
            });
            if (payErr) {
                console.error('Failed to save the payment:', payErr);
                alert(orderPaymentRpcMessage(payErr));
                setSalesUpdatedAt(Date.now());
                return false;
            }
            paymentTxKeys.release(paySignature);
            const payRes = (payData || {}) as {
                skipped?: boolean; already_applied?: boolean;
                payment?: { payment_status?: string | null; amount_received?: number; settle_date?: string | null; payment_method?: string | null; deposit_amount?: number; deposit_date?: string | null; deposit_method?: string | null };
                transactions_added?: Transaction[]; transactions_removed?: string[]; notices?: string[];
            };
            if (payRes.payment) {
                freshPayment = {
                    paymentStatus: (payRes.payment.payment_status || 'Unpaid') as Sale['paymentStatus'],
                    amountReceived: Number(payRes.payment.amount_received) || 0,
                    settleDate: payRes.payment.settle_date || undefined,
                    paymentMethod: (payRes.payment.payment_method || undefined) as Sale['paymentMethod'],
                    depositAmount: Number(payRes.payment.deposit_amount) || 0,
                    depositDate: payRes.payment.deposit_date || undefined,
                    depositMethod: payRes.payment.deposit_method || undefined,
                };
                if (existingOrder) existingOrder = { ...existingOrder, ...freshPayment };
            }
            const addedTxs = payRes.transactions_added || [];
            if (addedTxs.length > 0) {
                const addedIds = addedTxs.map(t => t.id);
                setTransactions(prev => [...addedTxs, ...prev.filter(t => !addedIds.includes(t.id))]);
            }
            const removedTxs = payRes.transactions_removed || [];
            if (removedTxs.length > 0) {
                setTransactions(prev => prev.filter(t => !removedTxs.includes(t.id)));
            }
            if (payRes.notices && payRes.notices.length > 0) {
                alert(payRes.notices.join('\n'));
            }
            // The columns the function saved are not re-sent below; the local
            // cache takes them from the values it returned.
            delete updates.paymentStatus;
            delete updates.amountReceived;
            delete updates.settleDate;
            delete updates.paymentMethod;
            delete updates.depositAmount;
            delete updates.depositDate;
            delete updates.depositMethod;
            delete updates.depositAccountId;
            delete updates.depositAccountName;
            delete updates.postToLedger;
            delete updates.receiptReference;
            delete updates.receiptNotes;
        }

        // A paid order's customer rename must follow through to its income row:
        // every later lookup (settle-date sync, leaving-Paid cleanup) matches by
        // description, so a row left under the old name would be missed — and the
        // settle-date heal branch would then insert a duplicate income row.
        if (
            updates.customer?.name && existingOrder?.customer?.name &&
            updates.customer.name !== existingOrder.customer.name &&
            PAID_STATUSES.includes(existingOrder.paymentStatus || '') &&
            (updates.paymentStatus === undefined || PAID_STATUSES.includes(updates.paymentStatus || ''))
        ) {
            const oldName = existingOrder.customer.name;
            const newName = updates.customer.name;
            const renameDep = existingOrder.depositAmount || 0;
            const renameMatches = [existingOrder.amountReceived || 0, existingOrder.total];
            if (renameDep > 0) renameMatches.push(Math.max(0, (existingOrder.amountReceived || 0) - renameDep), Math.max(0, existingOrder.total - renameDep));
            // Zero amounts excluded — see the leaving-Paid cleanup above.
            const positiveRenameMatches = renameMatches.filter(a => a > 0);
            if (positiveRenameMatches.length > 0) try {
                const { data: rowToRename } = await supabase.from('transactions')
                    .select('id')
                    .eq('type', 'Income')
                    .in('category', ['លក់រាយ', 'លក់ឥវ៉ាន់'])
                    .eq('description', oldName)
                    .or(positiveRenameMatches.map(a => `amount.eq.${a}`).join(','))
                    .limit(1);
                if (rowToRename && rowToRename.length > 0) {
                    await supabase.from('transactions').update({ description: newName }).eq('id', rowToRename[0].id);
                    setTransactions(prev => prev.map(t => t.id === rowToRename[0].id ? { ...t, description: newName } : t));
                }
            } catch (e) {
                console.error('Failed to rename income row with customer:', e);
            }
        }

        // 1. Optimistic Local Update
        setSales(prev => prev.map(sale =>
            sale.id === id ? { ...sale, ...(freshPayment || {}), ...updates } : sale
        ));

        // Income, ledger entries and payment columns were saved above by
        // set_order_payment, in the same transaction.

        // 2. Prepare DB Updates for 'sales' table
        const dbUpdates: any = {};
        if (updates.total !== undefined) dbUpdates.total = updates.total;
        if (updates.discount !== undefined) dbUpdates.discount = updates.discount;
        if (updates.date !== undefined) dbUpdates.date = updates.date;
        if (updates.salesman !== undefined) dbUpdates.salesman = updates.salesman;
        if (updates.customerCare !== undefined) dbUpdates.customer_care = updates.customerCare;
        if (updates.remark !== undefined) dbUpdates.remark = updates.remark;
        if (updates.customKhrAmount !== undefined) dbUpdates.custom_khr_amount = updates.customKhrAmount;
        // The payment columns (payment_status, amounts, dates, methods) are
        // written by set_order_payment above, never here: an unconditional
        // write could overwrite a payment recorded elsewhere since.
        if (updates.orderStatus !== undefined) dbUpdates.order_status = updates.orderStatus;
        if (updates.customer !== undefined) {
            dbUpdates.customer_snapshot = updates.customer;
            if (updates.customer.page !== undefined) {
                dbUpdates.page_source = updates.customer.page;
            }
        }
        // Shipping updates. shipping_status is never written here: a real change
        // goes through updateOrderStatus (step 2b), which moves the stock with it
        // in one database transaction, and re-sending the current status would
        // only risk overwriting a change made since the read above.
        if (updates.shipping !== undefined) {
            dbUpdates.shipping_company = updates.shipping.company;
            dbUpdates.tracking_number = updates.shipping.trackingNumber;
            dbUpdates.shipping_cost = updates.shipping.cost;
        }

        // Add Last Edit Info
        const now = new Date().toISOString();
        if (currentUser) {
            dbUpdates.last_edited_at = now;
            dbUpdates.last_edited_by = currentUser.name;
        }

        try {
            // 3. Items: replaced in one database transaction. When the order's goods
            // are out of stock (by its status at that moment), stock moves by what
            // the edit added or removed and the stock-out record is kept in step, so
            // a later cancel, delete or restock reverses what actually left. A
            // failure keeps the old items. Before the sales row below, so a failure
            // here doesn't leave the new total saved over the old items.
            if (updates.items && updates.items.length > 0) {
                await replaceOrderItems(id, updates.items, shippingPlan.to || shippingStatusBeforeUpdate || 'Pending');
            }

            // 4. Update 'sales' table
            if (Object.keys(dbUpdates).length > 0) {
                let { error } = await supabase.from('sales').update(dbUpdates).eq('id', id);
                // Degrade-and-retry for the KH(៛) override, needs migrations/add_sales_custom_khr.sql.
                if (error && /custom_khr_amount/i.test(error.message || '')) {
                    const dbUpdatesWithoutKhr = { ...dbUpdates };
                    delete dbUpdatesWithoutKhr.custom_khr_amount;
                    ({ error } = await supabase.from('sales').update(dbUpdatesWithoutKhr).eq('id', id));
                    if (!error) console.info('Saved without the custom KH(៛) override — run migrations/add_sales_custom_khr.sql to store it');
                }
                if (error) throw error;
            }

            let loggedSpecific = false;

            if (updates.remark !== undefined && existingOrder && updates.remark !== (existingOrder.remark || '')) {
                dispatchActivity({ 
                    action: 'order_updated', 
                    description: `Remark updated for Order #${id.slice(0, 8)}`, 
                    userId: currentUser?.id, 
                    userName: currentUser?.name, 
                    metadata: { 
                        orderId: id, 
                        oldRemark: existingOrder.remark || '',
                        newRemark: updates.remark 
                    } 
                });
                loggedSpecific = true;
            }

            if (updates.shipping?.trackingNumber !== undefined && existingOrder && updates.shipping.trackingNumber !== (existingOrder.shipping?.trackingNumber || '')) {
                dispatchActivity({ 
                    action: 'order_updated', 
                    description: `Tracking ID updated for Order #${id.slice(0, 8)}`, 
                    userId: currentUser?.id, 
                    userName: currentUser?.name, 
                    metadata: { 
                        orderId: id, 
                        oldTracking: existingOrder.shipping?.trackingNumber || '',
                        newTracking: updates.shipping.trackingNumber 
                    } 
                });
                loggedSpecific = true;
            }

            setSalesUpdatedAt(Date.now());
            if (!loggedSpecific) {
                dispatchActivity({ action: 'order_status', description: `Order #${id.slice(0, 8)} updated`, userId: currentUser?.id, userName: currentUser?.name, metadata: { orderId: id } });
            }

            // Stock-out records follow the shipping status in updateOrderStatus (step 2b).
            return true;
        } catch (error: any) {
            console.error('Error updating order:', error);
            alert(`Failed to update order: ${error.message}`);
            setSalesUpdatedAt(Date.now());
            return false;
        }
    };

    const updateOrders = async (ids: string[], updates: Partial<Sale>): Promise<void> => {
        try {
            // Fetch missing orders from DB for accurate transaction logging
            const missingIds = ids.filter(id => !sales.find(s => s.id === id));
            if (missingIds.length > 0) {
                const { data: dbOrders } = await supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)').in('id', missingIds);
                if (dbOrders && dbOrders.length > 0) {
                    const mappedOrders = dbOrders.map(mapSaleEntity);
                    setSales(prev => [...prev, ...mappedOrders] as any);
                    
                    // Small delay to let React state update locally? 
                    // No, setSales is async. Let's just pass the fetched DB order context to updateOrder.
                    // Actually, updateOrder pulls from `sales` from the closure.
                    // This is a common React ref issue. `sales` is stale.
                }
            }

            const promises = ids.map(async id => {
                let currentOrder = sales.find(s => s.id === id);
                
                // fallback to fetch it individually if not in stale cache
                if (!currentOrder) {
                    const { data } = await supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)').eq('id', id).single();
                    if (data) {
                        currentOrder = mapSaleEntity(data);
                        // Temp inject into sales array reference for `updateOrder` closure trick
                        sales.push(currentOrder as any);
                    }
                }

                if (!currentOrder) return Promise.resolve();

                const mergedUpdates = { ...updates };
                // Handle deep merge for shipping if needed
                if (updates.shipping && currentOrder && currentOrder.shipping) {
                    mergedUpdates.shipping = { ...currentOrder.shipping, ...updates.shipping };
                }
                return updateOrder(id, mergedUpdates);
            });
            await Promise.all(promises);
            setSalesUpdatedAt(Date.now());
        } catch (error) {
            console.error('Error batch updating orders:', error);
            throw error;
        }
    };

    // Deletes orders in ONE database transaction per batch
    // (delete_retail_orders): each order is archived to deleted_orders /
    // deleted_sale_items, a Shipped/Delivered/Returned order's stock comes
    // back (with its FIFO items and the newest stock-out generation), and the
    // order's income rows — the sales income AND its deposits — are removed
    // with their Draft journal entries (a Posted entry stays, with a notice),
    // so deleting a paid order no longer leaves revenue on the books.
    const deleteOrders = async (ids: string[]): Promise<void> => {
        try {
            // Batched to keep each call's payload reasonable.
            const BATCH_SIZE = 200;
            const notices: string[] = [];
            for (let i = 0; i < ids.length; i += BATCH_SIZE) {
                const batch = ids.slice(i, i + BATCH_SIZE);
                const { data, error } = await supabase.rpc('delete_retail_orders', { p_ids: batch, p_fields: {} });
                if (error) throw new Error(orderPaymentRpcMessage(error));
                const res = (data || {}) as { deleted?: string[]; stock?: Record<string, number>; transactions_removed?: string[]; notices?: string[] };
                applyStockMap(res.stock);
                const removed = res.transactions_removed || [];
                if (removed.length > 0) {
                    setTransactions(prev => prev.filter(t => !removed.includes(t.id)));
                }
                notices.push(...(res.notices || []));
            }
            if (notices.length > 0) {
                alert(Array.from(new Set(notices)).join('\n'));
            }

            // Trigger UI Updates
            setProductsUpdatedAt(Date.now());
            setSalesUpdatedAt(Date.now());
            dispatchActivity({ action: 'order_deleted', description: `${ids.length} order(s) deleted`, userId: currentUser?.id, userName: currentUser?.name, metadata: { count: ids.length } });
        } catch (error) {
            console.error('Error deleting orders:', error);
            throw error;
        }
    };

    const restoreOrders = async (ids: string[]): Promise<void> => {
        try {
            // Read in chunks of 200 ids (a bigger .in() list blows request-URL
            // length limits) and page each chunk (fetchAll) so a large restore
            // can't silently lose orders or items past the ~1000-row cap —
            // these rows drive both the re-insert and the stock adjustments.
            const CHUNK = 200;
            const orderChunks = [];
            const itemChunks = [];
            for (let i = 0; i < ids.length; i += CHUNK) {
                const idChunk = ids.slice(i, i + CHUNK);
                orderChunks.push(await fetchAll((from, to) => supabase
                    .from('deleted_orders').select('*').in('id', idChunk)
                    .order('id', { ascending: true })
                    .range(from, to), 1000, { label: 'StoreContext.restoreOrders orders' }));
                itemChunks.push(await fetchAll((from, to) => supabase
                    .from('deleted_sale_items').select('*').in('sale_id', idChunk)
                    .order('id', { ascending: true })
                    .range(from, to), 1000, { label: 'StoreContext.restoreOrders items' }));
            }
            const ordersToRestore = orderChunks.flat();
            const allItemsToRestore = itemChunks.flat();

            // Remove deleted_at before inserting back to sales
            const salesToInsert = ordersToRestore.map(({ deleted_at, ...rest }) => rest);

            if (salesToInsert.length > 0) {
                const { error: insOrdErr } = await supabase.from('sales').insert(salesToInsert);
                if (insOrdErr) throw insOrdErr;
            }

            if (allItemsToRestore.length > 0) {
                const { error: insItemErr } = await supabase.from('sale_items').insert(allItemsToRestore);
                if (insItemErr) throw insItemErr;
            }

            // Deduct stock if it was previously restocked upon deletion — and
            // rebuild what the deletion removed from the ledger/FIFO pool, so
            // stock, stock_movements, and inventory_items stay in step.
            for (const order of ordersToRestore) {
                const status = order.shipping_status || 'Pending';
                if (['Shipped', 'Delivered', 'Returned'].includes(status)) {
                    const orderItems = allItemsToRestore.filter(item => item.sale_id === order.id);
                    for (const item of orderItems) {
                        const { data: originProduct } = await supabase.from('products').select('stock').eq('id', item.product_id).single();
                        if (originProduct) {
                            await supabase.from('products').update({ stock: Math.max(0, originProduct.stock - item.quantity) }).eq('id', item.product_id);
                        }

                        // Re-mark FIFO items as sold for this order (deletion
                        // returned them to the pool).
                        const { data: invItems } = await supabase.from('inventory_items')
                            .select('id')
                            .eq('product_id', item.product_id)
                            .eq('status', 'in_stock')
                            .order('created_at', { ascending: true })
                            .limit(item.quantity);
                        if (invItems && invItems.length > 0) {
                            await supabase.from('inventory_items')
                                .update({ status: 'sold', sale_id: order.id })
                                .in('id', invItems.map((i: any) => i.id));
                        }
                    }

                    // Re-log the out movements the deletion removed (dated today
                    // — the original ship date left with the deleted rows).
                    const customerName = order.customer_snapshot?.name || '';
                    const customerPhone = order.customer_snapshot?.phone || '';
                    const restoredMovements = orderItems
                        .filter(item => item.product_id)
                        .map(item => ({
                            product_id: item.product_id,
                            product_name: item.name || 'Unknown',
                            type: 'out',
                            quantity: item.quantity,
                            unit_price: item.price || 0,
                            reason: 'Shipped',
                            reference_id: order.id,
                            source: 'Order Shipped',
                            shipping_co: order.shipping_company || '',
                            note: `Order #${String(order.id).slice(0, 8)} — restored from deleted`,
                            movement_date: getLocalYYYYMMDD(),
                            created_by: currentUser?.id || 'unknown',
                            customer_name: customerName,
                            customer_phone: customerPhone
                        }));
                    if (restoredMovements.length > 0) {
                        const { error: moveErr } = await supabase.from('stock_movements').insert(restoredMovements);
                        if (moveErr) console.error('Failed to re-log movements for restored order:', moveErr);
                    }
                }
            }

            // Delete from deleted tables
            const BATCH_SIZE = 500;
            for (let i = 0; i < ids.length; i += BATCH_SIZE) {
                const batch = ids.slice(i, i + BATCH_SIZE);
                await supabase.from('deleted_sale_items').delete().in('sale_id', batch);
                await supabase.from('deleted_orders').delete().in('id', batch);
            }

            setProductsUpdatedAt(Date.now());
            setSalesUpdatedAt(Date.now());
            dispatchActivity({ action: 'order_restored', description: `${ids.length} order(s) restored`, userId: currentUser?.id, userName: currentUser?.name, metadata: { count: ids.length } });
        } catch (error) {
            console.error('Error restoring orders:', error);
            throw error;
        }
    };

    const reorderRows = (activeIds: string[], overId: string, leadId: string) => {
        setSales((prev) => {
            const moveSet = new Set(activeIds);

            // If target is part of selection, do nothing
            if (moveSet.has(overId)) return prev;

            const itemsToMove: Sale[] = [];
            const remainingItems: Sale[] = [];

            // Get indices from original list to determine direction
            const oldIndex = prev.findIndex(s => s.id === leadId);
            const newIndex = prev.findIndex(s => s.id === overId);

            // Separate items (maintaining relative order)
            prev.forEach(item => {
                if (moveSet.has(item.id)) {
                    itemsToMove.push(item);
                } else {
                    remainingItems.push(item);
                }
            });

            // Find insert position
            let insertIndex = remainingItems.findIndex(s => s.id === overId);

            if (insertIndex === -1) return prev;

            // If dragging down, insert after the target
            if (oldIndex !== -1 && newIndex !== -1 && oldIndex < newIndex) {
                insertIndex++;
            }

            // Insert items
            remainingItems.splice(insertIndex, 0, ...itemsToMove);

            // Update Config
            const newOrderIds = remainingItems.map(s => s.id);
            updateConfig({ ...config, salesOrder: newOrderIds });

            return remainingItems;
        });
    };

    const importProducts = async (newProducts: Omit<Product, 'id'>[]) => {
        // 1. Insert into Supabase
        const { data, error } = await supabase.from('products').insert(newProducts).select();

        if (error) {
            console.error('Error importing products:', error);
            throw new Error('Failed to import products: ' + error.message);
        }

        if (data) {
            // 2. Update Local State
            setProducts(prev => [...prev, ...data]);
            setProductsUpdatedAt(Date.now());
        }
    };

    const convertExcelDate = (serial: any) => {
        if (!serial) return null;
        try {
            // If it's a number (Excel serial date), convert it
            if (typeof serial === 'number') {
                const utc_days = Math.floor(serial - 25569);
                const utc_value = utc_days * 86400;
                const date_info = new Date(utc_value * 1000);
                return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate()).toISOString();
            }
            // If it's already a string, try to use it
            const parsed = new Date(serial);
            if (isNaN(parsed.getTime())) return null; // Invalid date
            return parsed.toISOString();
        } catch (e) {
            console.warn("Date parse error for value:", serial, e);
            return null;
        }
    };

    const parseProductsString = (productsStr: string): any[] => {
        if (!productsStr) return [];
        // Split by comma
        return productsStr.split(',').map(itemStr => {
            const trimmed = itemStr.trim();
            // Try to match "Item Name xQuantity" or "Item Name (xQuantity)"
            // Regex explanations:
            // (.*?) - Capture name (lazy)
            // [\s\(]* - Optional space or opening parenthesis
            // [xX*] - The multiplier char
            // (\d+) - Capture quantity digits
            // [\)]* - Optional closing parenthesis
            // $ - End of string
            const match = trimmed.match(/^(.*?)[\s\(]*[xX*](\d+)[\)]*$/);

            if (match) {
                return {
                    name: match[1].trim(),
                    quantity: parseInt(match[2], 10),
                    price: 0 // Price is unknown from simple string import
                };
            } else {
                return {
                    name: trimmed,
                    quantity: 1,
                    price: 0
                };
            }
        }).filter(item => item.name);
    };

    const parseNumber = (value: any): number => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            // Remove currency symbols, commas, spaces
            const cleaned = value.replace(/[^0-9.-]/g, '');
            const parsed = parseFloat(cleaned);
            return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
    };

    const importOrders = async (importedOrders: any[]) => {
        // Prepare arrays for bulk insert
        const salesToInsert: any[] = [];
        const saleItemsToInsert: any[] = [];
        const localSalesMap: Record<string, any[]> = {}; // Map saleId -> items
        const processedSaleIds = new Set<string>(); // Keep track of processed IDs

        importedOrders.forEach(order => {
            // Skip header row if it somehow got included (check if 'Total' is 'Total' string)
            if (order['Total'] === 'Total' || order['Received'] === 'Received') return;

            const id = order['Order ID'] || Date.now().toString() + Math.random().toString(36).substring(2);
            const productsStr = order['Products'] || order['Items'] || '';
            const items = parseProductsString(productsStr);

            const total = parseNumber(order['Total'] || order['Total Amount']);
            // Determine amount received
            let amountReceived = 0;
            if (order['Received'] !== undefined) {
                amountReceived = parseNumber(order['Received']);
            } else if (order['Pay Status'] === 'Paid' || order['Pay Status'] === 'Settled' || order['Payment Status'] === 'Paid') {
                amountReceived = total;
            }

            // Prepare Sale Record (only once per ID in this batch)
            if (!processedSaleIds.has(id)) {
                processedSaleIds.add(id);

                salesToInsert.push({
                    id: id,
                    date: convertExcelDate(order['Date']) || new Date().toISOString(),
                    customer_snapshot: {
                        name: order['Customer'] || 'Unknown',
                        phone: order['Phone'] || '',
                        address: order['Address'] || '',
                        city: order['City / Province'] || '',
                        page: order['Page Name'] || '',
                        platform: order['Platform'] || 'Facebook'
                    },
                    total: total,
                    payment_method: order['Pay By'] || order['Payment Method'] || 'Cash',
                    payment_status: order['Pay Status'] || order['Payment Status'] || 'Unpaid',
                    order_status: 'Closed',
                    salesman: order['Salesman'] || '',
                    customer_care: order['Customer Care'] || '',
                    amount_received: amountReceived,
                    settle_date: convertExcelDate(order['Settled/Paid Date']) || ((order['Pay Status'] === 'Paid' || order['Pay Status'] === 'Settled') ? new Date().toISOString() : null),
                    remark: order['Remark'] || order['Remarks'] || (items.length === 0 ? 'Imported Order' : ''),
                    type: 'POS',
                    shipping_company: order['Shipping Co'] || order['Shipping Company'] || '',
                    tracking_number: order['Tracking ID'] || order['Tracking Number'] || '',
                    shipping_status: order['Ship Status'] || order['Shipping Status'] || 'Pending',
                });
            }

            // Prepare Sale Items Records
            items.forEach(item => {
                const itemId = Date.now().toString() + Math.random().toString(36).substring(2);
                saleItemsToInsert.push({
                    id: itemId,
                    sale_id: id,
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    // Product ID is unknown, maybe link if name matches? For now leave null or dummy
                    product_id: null
                });

                // For local state
                if (!localSalesMap[id]) localSalesMap[id] = [];
                localSalesMap[id].push({ ...item, id: itemId });
            });
        });

        // 1. Upsert Sales
        const { data: insertedSales, error: salesError } = await supabase.from('sales').upsert(salesToInsert).select();

        if (salesError) {
            console.error('Error importing orders:', salesError);
            throw new Error('Failed to import orders: ' + salesError.message);
        }

        // 2. Insert Sale Items (if any)
        if (saleItemsToInsert.length > 0) {
            // Clear existing items for these sales to prevent duplicates on re-import
            const saleIdsToClear = salesToInsert.map(s => s.id);
            await supabase.from('sale_items').delete().in('sale_id', saleIdsToClear);

            const { error: itemsError } = await supabase.from('sale_items').insert(saleItemsToInsert);
            if (itemsError) {
                console.error('Error importing sale items:', itemsError);
                // Note: Sales were already upserted.
                throw new Error('Failed to import order items: ' + itemsError.message);
            }
        }

        // 3. Update Local State
        if (insertedSales) {
            const newSales: Sale[] = insertedSales.map(s => ({
                id: s.id,
                total: Number(s.total),
                discount: 0,
                date: s.date,
                paymentMethod: s.payment_method as any,
                type: s.type as any,
                salesman: s.salesman,
                customerCare: s.customer_care,
                remark: s.remark,
                amountReceived: Number(s.amount_received),
                settleDate: s.settle_date,
                paymentStatus: s.payment_status as any,
                orderStatus: s.order_status as any,
                customer: s.customer_snapshot,
                items: localSalesMap[s.id] || [],
                shipping: {
                    company: s.shipping_company || '',
                    trackingNumber: s.tracking_number || '',
                    status: s.shipping_status as any || 'Pending',
                    cost: s.shipping_cost || 0
                }
            }));
            setSales(prev => [...newSales, ...prev]);
            setSalesUpdatedAt(Date.now());
        }
    };
    const restockOrder = async (orderId: string): Promise<void> => {
        try {
            const localOrder = sales.find(s => s.id === orderId);
            // Items from the database: the cached copy can predate an item edit
            // made elsewhere, and restocking must return what actually left.
            let orderItems: Sale['items'] | undefined;
            let customerName = localOrder?.customer?.name || '';
            let customerPhone = localOrder?.customer?.phone || '';

            {
                const { data, error: itemsErr } = await supabase.from('sale_items').select('*').eq('sale_id', orderId);
                if (itemsErr) throw itemsErr;
                if (data) {
                    orderItems = data.map(dbItem => ({
                        id: dbItem.product_id,
                        name: dbItem.name,
                        price: dbItem.price,
                        quantity: dbItem.quantity
                    })) as any;
                }
            }

            // Fetch customer info from DB if not available locally
            if (!customerName) {
                const { data: orderData } = await supabase.from('sales').select('customer_snapshot').eq('id', orderId).single();
                if (orderData?.customer_snapshot) {
                    customerName = orderData.customer_snapshot.name || '';
                    customerPhone = orderData.customer_snapshot.phone || '';
                }
            }

            if (!orderItems || orderItems.length === 0) {
                console.error("No items found for order", orderId);
                return;
            }

            const now = new Date().toISOString();
            const restockRecords = [];

            for (const item of orderItems) {
                if (!item.id) {
                    console.warn(`Skipping stock update for item '${item.name}' because product ID is missing (likely imported).`);
                    continue;
                }

                const qty = Number(item.quantity);
                if (isNaN(qty) || qty <= 0) continue;

                // DB Update (Increment Stock)
                const { data: originProduct, error: productErr } = await supabase.from('products').select('stock').eq('id', item.id).single();

                if (productErr) {
                    console.error(`Failed to find product ${item.id} for restock:`, productErr);
                    continue;
                }

                if (originProduct) {
                    const newStock = Number(originProduct.stock) + qty;
                    await supabase.from('products').update({ stock: newStock }).eq('id', item.id);
                    // Local State Update
                    setProducts(prev => prev.map(p => p.id === item.id ? { ...p, stock: newStock } : p));
                }

                // Prepare restock record
                const restockId = generateUUID();
                // Build note with customer info
                const customerInfo = [customerName, customerPhone].filter(Boolean).join(' | ');
                const noteText = `Restocked from order #${orderId.slice(0, 8)}${customerInfo ? ' — ' + customerInfo : ''}`;

                restockRecords.push({
                    id: restockId,
                    product_id: item.id,
                    quantity: qty,
                    cost: 0,
                    date: now,
                    added_by: currentUser?.name || 'System',
                    note: noteText
                });

                // Local restock history update
                setRestocks(prev => [{
                    id: restockId,
                    productId: item.id,
                    quantity: qty,
                    cost: 0,
                    date: now,
                    addedBy: currentUser?.name || 'System',
                    note: noteText
                }, ...prev]);
            }

            // Return the shipment's FIFO items to the pool — shipping marked them
            // status 'sold' with this sale_id, and without this flip every
            // return/restock cycle permanently drains in_stock rows while
            // products.stock recovers. The status guard keeps re-runs idempotent.
            await supabase.from('inventory_items')
                .update({ status: 'in_stock', sale_id: null })
                .eq('sale_id', orderId)
                .eq('status', 'sold');

            if (restockRecords.length > 0) {
                const { error: insertErr } = await supabase.from('restocks').insert(restockRecords);
                if (insertErr) {
                    console.error("Failed to insert restock records:", insertErr);
                    throw insertErr;
                }

                // Also log to stock_movements for Stock-In tracking
                const stockMovements = restockRecords.map(r => ({
                    product_id: r.product_id,
                    product_name: orderItems?.find(i => i.id === r.product_id)?.name || 'Unknown',
                    type: 'in',
                    quantity: r.quantity,
                    unit_price: 0,
                    source: 'Customer Return',
                    shipping_co: localOrder?.shipping?.company || '',
                    note: r.note,
                    movement_date: getLocalYYYYMMDD(),
                    created_by: currentUser?.id || 'unknown',
                    customer_name: customerName,
                    customer_phone: customerPhone
                }));
                await supabase.from('stock_movements').insert(stockMovements).then(({ error }) => {
                    if (error) console.error('Failed to log stock movements for restock:', error);
                });
            }

            setProductsUpdatedAt(Date.now());
        } catch (error) {
            console.error('Error restocking order:', error);
            throw error;
        }
    };

    const bulkRestockOrders = async (requestedIds: string[]): Promise<number> => {
        try {
            // Only orders that are Returned right now: their goods are counted out
            // and are coming back. Anything else (a list or selection that is out of
            // date, an order already restocked, one never shipped) would add stock
            // that never left. The database checks that under a lock and does the
            // stock, inventory items, return records, stock-in movements and the
            // ReStock status in one transaction, so a double click or a second
            // device restocks an order once, and a failure restocks nothing.
            const now = new Date().toISOString();
            // The payment side below needs the payment functions; refuse
            // before any stock moves.
            if (!(await paymentFunctionsReady())) {
                throw new Error(ORDER_PAYMENT_FUNCTIONS_MISSING_MESSAGE);
            }
            const { data, error } = await supabase.rpc('restock_returned_orders', {
                p_ids: requestedIds,
                p_fields: orderStockFields(now),
            });
            if (error) throw new Error(orderRpcMessage(error));
            const res = (data || {}) as { restocked?: string[]; restocks?: RestockRow[]; stock?: Record<string, number> };
            const orderIds = res.restocked || [];
            if (orderIds.length === 0) return 0;

            addRestockRows(res.restocks);
            applyStockMap(res.stock);

            // The payment side (income cleanup, payment Cancel / PdFee kept).
            await applyRestockPaymentSide(orderIds, now);

            // Trigger single refresh event for UI listeners
            setProductsUpdatedAt(Date.now());
            setSalesUpdatedAt(Date.now());
            return orderIds.length;
        } catch (error) {
            console.error('Error bulk restocking orders:', error);
            setSalesUpdatedAt(Date.now());
            throw error;
        }
    };

    const backupData = async () => {
        const data = {
            timestamp: new Date().toISOString(),
            products,
            sales,
            customers,
            users: config.users || [],
            roles: config.roles || [],
            config: {
                shippingCompanies: config.shippingCompanies,
                salesmen: config.salesmen,
                categories: config.categories,
                pages: config.pages,
                customerCare: config.customerCare,
                paymentMethods: config.paymentMethods,
                cities: config.cities,
                storeName: config.storeName,
                storeAddress: config.storeAddress,
                email: config.email,
                phone: config.phone,
                khrExchangeRate: config.khrExchangeRate || 4100
            }
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup-${new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const restoreData = async (jsonData: any) => {
        setIsLoading(true);
        try {
            // 1. Validate (Simple check)
            if (!jsonData.products || !jsonData.sales || !jsonData.customers) {
                throw new Error("Invalid backup file format");
            }

            // 2. Restore Products
            if (jsonData.products.length > 0) {
                const { error } = await supabase.from('products').upsert(jsonData.products);
                if (error) throw new Error("Failed to restore products: " + error.message);
                setProductsUpdatedAt(Date.now());
            }

            // 3. Restore Customers
            if (jsonData.customers.length > 0) {
                const { error } = await supabase.from('customers').upsert(jsonData.customers);
                if (error) throw new Error("Failed to restore customers: " + error.message);
            }

            // 4. Restore Sales
            if (jsonData.sales.length > 0) {
                // We need to map back to DB structure for sales
                const dbSales = jsonData.sales.map((s: Sale) => ({
                    id: s.id,
                    total: s.total,
                    discount: s.discount,
                    date: s.date,
                    payment_method: s.paymentMethod,
                    type: s.type,
                    salesman: s.salesman,
                    customer_care: s.customerCare,
                    remark: s.remark,
                    amount_received: s.amountReceived,
                    settle_date: s.settleDate,
                    payment_status: s.paymentStatus,
                    order_status: s.orderStatus,
                    shipping_company: s.shipping?.company,
                    tracking_number: s.shipping?.trackingNumber,
                    shipping_status: s.shipping?.status,
                    shipping_cost: s.shipping?.cost,
                    customer_snapshot: s.customer
                }));
                const { error: salesError } = await supabase.from('sales').upsert(dbSales);
                if (salesError) throw new Error("Failed to restore sales: " + salesError.message);

                // Restore Sale Items
                // We need to flatten all items from all sales
                const allItems: any[] = [];
                jsonData.sales.forEach((s: Sale) => {
                    if (s.items) {
                        s.items.forEach(item => {
                            allItems.push({
                                id: Date.now().toString() + Math.random().toString(36).substring(2), // Generate new ID
                                sale_id: s.id,
                                product_id: item.id, // This is product ID
                                name: item.name,
                                price: item.price,
                                quantity: item.quantity,
                                image: item.image
                            });
                        });
                    }
                });

                if (allItems.length > 0) {
                    // Delete existing items for these sales to avoid duplicates?
                    // Actually upsert might be tricky without ID.
                    // For safety, let's delete items for these sales first
                    const saleIds = jsonData.sales.map((s: Sale) => s.id);
                    await supabase.from('sale_items').delete().in('sale_id', saleIds);

                    const { error: itemsError } = await supabase.from('sale_items').insert(allItems);
                    if (itemsError) throw new Error("Failed to restore sale items: " + itemsError.message);
                }
            }

            // 5. Restore Config
            if (jsonData.config) {
                // Upsert config to ID 1
                const { error } = await supabase.from('app_config').upsert({
                    id: 1,
                    data: {
                        shippingCompanies: jsonData.config.shippingCompanies,
                        salesmen: jsonData.config.salesmen,
                        categories: jsonData.config.categories,
                        pages: jsonData.config.pages,
                        customerCare: jsonData.config.customerCare,
                        paymentMethods: jsonData.config.paymentMethods,
                        cities: jsonData.config.cities,
                        users: jsonData.users,
                        roles: jsonData.roles,
                        storeName: jsonData.config.storeName,
                        storeAddress: jsonData.config.storeAddress,
                        email: jsonData.config.email,
                        phone: jsonData.config.phone,
                        khrExchangeRate: jsonData.config.khrExchangeRate || 4100
                    }
                });
                if (error) throw new Error("Failed to restore config: " + error.message);
            }

            alert("Restore completed successfully! Page will reload.");
            window.location.reload();

        } catch (e: any) {
            console.error("Restore failed:", e);
            alert("Restore failed: " + e.message);
        } finally {
            setIsLoading(false);
        }
    };

    // User & Role Management
    //
    // SEC-3 guards: having "Manage Users" is not the same as being an admin.
    // Without these, anyone with manage_users (historically the Store Manager
    // default) could set their own role to Administrator, or reset the real
    // admin's password and log in as them. Client-side defence-in-depth only —
    // honest server-side enforcement needs per-caller identity, i.e. Supabase
    // Auth + RLS (the separate SEC-1 project): the app writes the users table
    // directly with the shared anon key, so a SQL guard function could not
    // know who is asking.
    const assertCanTouchUser = (targetId: string | null, updates: Partial<User>) => {
        if (currentUser?.roleId === 'admin') return;
        const target = targetId ? users.find(u => u.id === targetId) : null;
        if (target?.roleId === 'admin') {
            throw new Error('Only an administrator can edit or delete an admin account.');
        }
        if (updates.roleId === 'admin') {
            throw new Error('Only an administrator can assign the Administrator role.');
        }
    };

    const addUser = async (userData: Omit<User, 'id'>) => {
        assertCanTouchUser(null, userData);
        const newUser: User = { ...userData, id: Date.now().toString() + Math.random().toString(36).substring(2) };

        // No .select() on the insert: it would request RETURNING * — and once
        // secure_pin_check.sql revokes read access on the pin column, the whole
        // INSERT would be rejected. Nothing needs the returned row anyway.
        const { error } = await supabase.from('users').insert({
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            role_id: newUser.roleId,
            pin: newUser.pin,
            base_salary: newUser.baseSalary || 0,
            daily_target: newUser.dailyTarget || 0,
            weekly_target: newUser.weeklyTarget || 0,
            monthly_target: newUser.monthlyTarget || 0
        });

        if (error) {
            console.error('Failed to add user to database:', error);
            throw new Error('Failed to add user: ' + error.message);
        }

        setUsers(prev => [...prev, { ...newUser, pin: undefined }]);
    };

    const updateUser = async (id: string, updates: Partial<User>) => {
        assertCanTouchUser(id, updates);
        // Nobody — admin included — changes their own role: promoting yourself
        // is the SEC-3 attack, and an admin demoting themselves could leave
        // the store with no admin at all. Another admin does it instead.
        const targetNow = users.find(u => u.id === id);
        if (id === currentUser?.id && updates.roleId && updates.roleId !== (targetNow?.roleId ?? currentUser.roleId)) {
            throw new Error('You cannot change your own role. Ask another administrator to do it.');
        }
        const dbUpdates: any = {};
        if (updates.name) dbUpdates.name = updates.name;
        if (updates.email) dbUpdates.email = updates.email;
        if (updates.roleId) dbUpdates.role_id = updates.roleId;
        if (updates.pin !== undefined) dbUpdates.pin = updates.pin; // allow empty pin
        if (updates.baseSalary !== undefined) dbUpdates.base_salary = updates.baseSalary;
        if (updates.dailyTarget !== undefined) dbUpdates.daily_target = updates.dailyTarget;
        if (updates.weeklyTarget !== undefined) dbUpdates.weekly_target = updates.weeklyTarget;
        if (updates.monthlyTarget !== undefined) dbUpdates.monthly_target = updates.monthlyTarget;

        const { error } = await supabase.from('users').update(dbUpdates).eq('id', id);
        if (error) {
            console.error('Failed to update user:', error);
            throw new Error('Failed to update user: ' + error.message);
        }

        setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
    };

    const deleteUser = async (id: string) => {
        assertCanTouchUser(id, {});
        const { error } = await supabase.from('users').delete().eq('id', id);
        if (error) {
            console.error('Failed to delete user:', error);
            throw new Error('Failed to delete user: ' + error.message);
        }

        setUsers(prev => prev.filter(u => u.id !== id));
    };

    // Purchasing module defaults — one object inside the shared config blob.
    const purchaseSettings = config.purchaseSettings || {};
    const updatePurchaseSettings = async (settings: PurchaseSettings) => {
        await updateConfig({ ...config, purchaseSettings: settings });
    };

    // Wholesale module defaults — same pattern.
    const wholesaleSettings = config.wholesaleSettings || {};
    const updateWholesaleSettings = async (settings: WholesaleSettings) => {
        await updateConfig({ ...config, wholesaleSettings: settings });
    };

    const addRole = async (roleData: Omit<Role, 'id'>) => {
        const newRole: Role = { ...roleData, id: Date.now().toString() };
        const newRoles = [...(config.roles || []), newRole];
        await updateConfig({ ...config, roles: newRoles });
        // Hand the caller the new role so the UI can select it right away.
        return newRole;
    };

    const updateRole = async (id: string, updates: Partial<Role>) => {
        // The built-in Admin role is always full-access (hasPermission hardcodes it), so
        // its permission list is display-only. Keep it truthful rather than let someone
        // save a half-checked Admin role that still behaves as full access.
        if (id === 'admin' && updates.permissions) {
            updates = { ...updates, permissions: ALL_PERMISSIONS };
        }
        // Self-lockout guard: removing "Manage Users" from your own role would take away
        // access to this very page, with no way back short of editing the database.
        if (
            updates.permissions &&
            currentUser?.roleId === id &&
            currentUser?.roleId !== 'admin' &&
            !updates.permissions.includes('manage_users')
        ) {
            throw new Error('You cannot remove "Manage Users" from your own role — you would lock yourself out of this page.');
        }
        // SEC-3: a non-admin may not escalate through the role editor —
        // neither by widening their OWN role, nor by granting any role a
        // permission their own role does not hold (grant it to a spare role,
        // switch to it, and the lack of a self-role-change guard elsewhere
        // would not even be needed). Removing permissions stays allowed.
        if (updates.permissions && currentUser && currentUser.roleId !== 'admin') {
            const targetRole = (config.roles || []).find(r => r.id === id);
            const added = updates.permissions.filter(p => !(targetRole?.permissions || []).includes(p));
            if (added.length > 0) {
                if (id === currentUser.roleId) {
                    throw new Error('You cannot add permissions to your own role. Ask an administrator.');
                }
                const ownPerms = (config.roles || []).find(r => r.id === currentUser.roleId)?.permissions || [];
                const beyondOwn = added.filter(p => !ownPerms.includes(p));
                if (beyondOwn.length > 0) {
                    throw new Error(`You cannot grant permissions your own role does not have: ${beyondOwn.join(', ')}. Ask an administrator.`);
                }
            }
        }
        const newRoles = (config.roles || []).map(r => r.id === id ? { ...r, ...updates } : r);
        await updateConfig({ ...config, roles: newRoles });
    };

    const deleteRole = async (id: string) => {
        if (id === 'admin') {
            throw new Error('The Admin role is protected and cannot be deleted.');
        }
        if (users.some(u => u.roleId === id)) {
            throw new Error('This role is still assigned to one or more users. Reassign them before deleting it.');
        }
        if (currentUser?.roleId === id) {
            throw new Error('You cannot delete the role you are currently signed in with.');
        }
        const newRoles = (config.roles || []).filter(r => r.id !== id);
        await updateConfig({ ...config, roles: newRoles });
    };

    const updateStoreAddress = async (address: string) => {
        updateConfig({ ...config, storeAddress: address });
    };

    const updateKhrExchangeRate = async (rate: number) => {
        updateConfig({ ...config, khrExchangeRate: rate });
    };

    const updateStoreProfile = async (data: { storeName?: string; email?: string; phone?: string; storeAddress?: string; timezone?: string; taxRate?: number; currency?: string; khrExchangeRate?: number; logo?: string; telegramBotToken?: string; telegramChatId?: string; telegramConfigs?: TelegramConfig[] }) => {
        const { telegramConfigs, ...restData } = data;
        let newConfig = { ...config, ...restData };
        
        if (telegramConfigs !== undefined) {
            // First, find what's deleted
            const currentIds = config.telegramConfigs?.map(c => c.id) || [];
            const newIds = telegramConfigs.map(c => c.id);
            const deletedIds = currentIds.filter(id => !newIds.includes(id));
            
            if (deletedIds.length > 0) {
                await supabase.from('telegram_notifications').delete().in('id', deletedIds);
            }
            
            // Upsert remaining
            if (telegramConfigs.length > 0) {
                const upsertData = telegramConfigs.map(tc => ({
                    id: tc.id,
                    name: tc.name,
                    bot_token: tc.botToken,
                    chat_id: tc.chatId,
                    trigger_statuses: tc.triggerStatuses,
                    message_template: tc.messageTemplate,
                    note: tc.note
                }));
                const { error } = await supabase.from('telegram_notifications').upsert(upsertData);
                if (error) {
                    console.error("Error upserting telegram configs:", error);
                    throw new Error("Database error saving telegram config: " + error.message);
                }
            }
            
            newConfig.telegramConfigs = telegramConfigs;
        }

        updateConfig(newConfig);
    };

    // Timezone
    const updateTimezone = async (timezone: string) => {
        updateConfig({ ...config, timezone });
    };

    const updateTaxRate = async (taxRate: number) => {
        updateConfig({ ...config, taxRate });
    };

    const updateCurrency = async (currency: string) => {
        updateConfig({ ...config, currency });
    };

    // Authentication logic moved to top

    // Warehouse Operations
    const addWarehouse = async (warehouse: Omit<Warehouse, 'id' | 'createdAt' | 'updatedAt'>) => {
        const { data, error } = await supabase.from('warehouses').insert([warehouse]).select().single();
        if (error) throw error;
        setWarehouses(prev => [...prev, { ...data, createdAt: data.created_at, updatedAt: data.updated_at }]);
    };

    const updateWarehouse = async (id: string, updates: Partial<Warehouse>) => {
        const { error } = await supabase.from('warehouses').update(updates).eq('id', id);
        if (error) throw error;
        setWarehouses(prev => prev.map(w => w.id === id ? { ...w, ...updates } : w));
    };

    const deleteWarehouse = async (id: string) => {
        const { error } = await supabase.from('warehouses').delete().eq('id', id);
        if (error) throw error;
        setWarehouses(prev => prev.filter(w => w.id !== id));
    };

    return (
        <StoreContext.Provider value={{
            products,
            cart,
            sales,
            restocks, // Added restocks to context
            customers,
            productsUpdatedAt,
            salesUpdatedAt,
            hasMoreOrders,
            isLoadingMore,
            loadMoreOrders,
            users: users,
            roles: config.roles || [],
            addUser,
            updateUser,
            deleteUser,
            addRole,
            updateRole,
            deleteRole,
            purchaseSettings,
            updatePurchaseSettings,
            wholesaleSettings,
            updateWholesaleSettings,
            warehouses,
            warehouseStock,
            addWarehouse,
            updateWarehouse,
            deleteWarehouse,
            addToCart,
            removeFromCart,
            updateCartQuantity,
            clearCart,
            processSale,
            addProduct,
            updateProduct,
            deleteProduct,
            deleteProducts,
            addStock, // Added addStock to context
            receivePurchaseOrder,
            adjustStock, // Added adjustStock to context
            transactions,
            addTransaction,
            updateTransaction,
            deleteTransaction,
            deleteTransactions,
            addOnlineOrder,
            updateOrderStatus,
            updateOrder,
            updateOrders,
            deleteOrders,
            restoreOrders,
            reorderRows,
            addCustomer,
            updateCustomer,
            deleteCustomer,
            shippingCompanies: config.shippingCompanies || [],
            shippingRates: config.shippingRates || {},
            updateShippingRate,
            trackingUrlTemplates: config.trackingUrlTemplates || {},
            updateTrackingUrlTemplate,
            salesmen: config.salesmen || [],
            categories: config.categories || [],
            addShippingCompany,
            removeShippingCompany,
            addSalesman,
            removeSalesman,
            addCategory,
            removeCategory,
            addPage,
            removePage,
            pages: config.pages || [],
            customDistricts: config.customDistricts || [],
            customCommunes: config.customCommunes || [],
            removedDistrictCodes: config.removedDistrictCodes || [],
            removedCommuneCodes: config.removedCommuneCodes || [],
            addCustomDistrict,
            removeDistrictEntry,
            addCustomCommune,
            removeCommuneEntry,
            customerCare,
            addCustomerCare,
            removeCustomerCare,
            cities: config.cities || [],
            addCity,
            removeCity,
            paymentMethods: config.paymentMethods || [],
            addPaymentMethod,
            removePaymentMethod,
            editingOrder,
            setEditingOrder,
            pinnedProductIds: config.pinnedProducts || [],
            toggleProductPin,
            pinnedOrderColumns,
            toggleOrderColumnPin,
            productOrder: config.productOrder || [],
            updateProductOrder,
            updateCart,
            importProducts,
            importOrders,
            restockOrder,
            bulkRestockOrders,
            backupData,
            restoreData,
            // Authentication
            currentUser,
            login,
            logout,
            hasPermission,
            isLoading,
            storeAddress: config.storeAddress || '',
            storeName: config.storeName || '',
            logo: config.logo || '',
            email: config.email || '',
            phone: config.phone || '',
            telegramBotToken: config.telegramBotToken || '',
            telegramChatId: config.telegramChatId || '',
            telegramConfigs: config.telegramConfigs || [],
            updateStoreAddress,
            updateStoreProfile,
            timezone: config.timezone || 'Asia/Phnom_Penh',
            updateTimezone,
            taxRate: config.taxRate || 0,
            updateTaxRate,
            currency: config.currency || 'USD ($)',
            updateCurrency,
            khrExchangeRate: config.khrExchangeRate || 4100,
            updateKhrExchangeRate,
            blockedCustomers: config.blockedCustomers || [],
            addBlockedCustomer,
            addBlockedCustomers,
            removeBlockedCustomer,
            removeBlockedCustomers,
            updateBlockedCustomer,
            refreshData
        }}>
            {children}
        </StoreContext.Provider>
    );
};

export const useStore = () => {
    const context = useContext(StoreContext);
    if (context === undefined) {
        throw new Error('useStore must be used within a StoreProvider');
    }
    return context;
};
