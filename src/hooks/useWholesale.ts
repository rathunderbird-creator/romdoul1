import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { WholesaleOrder, WholesaleOrderItem, WholesaleCustomer, CustomerPayment } from '../types';
import { useToast } from '../context/ToastContext';
import { nextJournalEntryNumber, entryDescription } from '../utils/journalEntryNumber';
import { pickCashBankAccount } from '../utils/cashBankAccounts';
import { insertJournalLines } from '../utils/journalEntryLines';
import { dayKeyFromDate } from '../utils/dateRange';

const generateUUID = () => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// Standard accounting for a wholesale credit sale: the goods leave the company
// when the order is CREATED (stock is deducted right there), so that's when
// inventory is relieved — one Draft entry of Dr Cost of Goods Sold /
// Cr Inventory at the items' purchase cost, reference 'WSO-<id>-COGS' so a
// retry never double-books and cancel/delete can take it back off the books.
// Revenue stays on the per-payment WSP entries. Non-fatal: the order exists.
const postWholesaleCogsEntry = async (
    orderId: string,
    label: string,
    items: { product_id?: string | null; quantity?: number | null }[],
    showToast: (msg: string, kind: 'success' | 'error' | 'info') => void
) => {
    try {
        const reference = `WSO-${orderId}-COGS`;
        const { data: existing, error: exErr } = await supabase.from('journal_entries')
            .select('id').eq('reference_id', reference).limit(1).maybeSingle();
        if (exErr || existing) return;
        const productIds = Array.from(new Set(items.map(i => i.product_id).filter((id): id is string => !!id)));
        if (productIds.length === 0) return;
        const { data: products, error: prodErr } = await supabase
            .from('products').select('id, purchase_cost').in('id', productIds);
        if (prodErr) return;
        const costOf = new Map((products || []).map(p => [p.id, Number(p.purchase_cost) || 0]));
        const cost = Math.round(items.reduce((s, i) => s + (costOf.get(i.product_id || '') || 0) * (Number(i.quantity) || 0), 0) * 100) / 100;
        if (cost <= 0) return;
        const { data: coa } = await supabase.from('chart_of_accounts')
            .select('id, account_code, account_name, account_type').eq('is_active', true);
        const pool = coa || [];
        const cogsAcc = pool.find(a => a.account_code === '5000')
            || pool.find(a => a.account_type === 'Expense' && /cost of goods|cogs/i.test(a.account_name));
        const inventoryAcc = pool.find(a => a.account_code === '1300')
            || pool.find(a => a.account_type === 'Asset' && /inventor|stock/i.test(a.account_name));
        if (!cogsAcc || !inventoryAcc) return;
        const date = dayKeyFromDate(new Date());
        const entryNumber = await nextJournalEntryNumber('WSP', date);
        const entryPayload: Record<string, unknown> = {
            date,
            description: entryDescription(entryNumber, `${label} · COGS`)
                || `${label} · cost of goods sold`,
            reference_id: reference,
            status: 'Draft',
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
        // Never create an instantly-posted entry on an instance without the
        // status column — same refusal as every other auto-posting flow.
        if (jeErr && /status/i.test(jeErr.message || '')) {
            showToast('Order saved — run migrations/add_entry_status.sql on this instance to also post its COGS entry as a draft.', 'info');
            return;
        }
        if (jeErr || !entry) {
            console.error('Failed to post the wholesale COGS entry:', jeErr);
            return;
        }
        const { error: lErr } = await insertJournalLines([
            { journal_entry_id: entry.id, account_id: cogsAcc.id, debit: cost, credit: 0, description: 'Cost of goods sold' },
            { journal_entry_id: entry.id, account_id: inventoryAcc.id, debit: 0, credit: cost, description: 'Inventory at cost' },
        ]);
        if (lErr) {
            console.error('Failed to post the wholesale COGS entry lines:', lErr);
            await supabase.from('journal_entries').delete().eq('id', entry.id);
        }
    } catch (e) {
        console.error('Failed to post the wholesale COGS entry:', e);
    }
};

// The revenue side of the credit sale, booked at the same moment as the COGS
// entry (the goods leave when the order is created): one Draft entry of
// Dr Accounts Receivable / Cr Sales Revenue at the order total, reference
// 'WSO-<id>-INV' so a retry never double-books. The receivable is then
// settled by the per-payment WSP entries (Dr cash / Cr A/R below in
// recordCustomerPayment). Non-fatal: the order exists either way.
const postWholesaleInvoiceEntry = async (
    orderId: string,
    label: string,
    customerName: string,
    total: number,
    date: string,
    showToast: (msg: string, kind: 'success' | 'error' | 'info') => void
) => {
    try {
        const reference = `WSO-${orderId}-INV`;
        const { data: existing, error: exErr } = await supabase.from('journal_entries')
            .select('id').eq('reference_id', reference).limit(1).maybeSingle();
        if (exErr || existing) return;
        const amount = Math.round(total * 100) / 100;
        if (amount <= 0) return;
        const { data: coa } = await supabase.from('chart_of_accounts')
            .select('id, account_code, account_name, account_type').eq('is_active', true);
        const pool = coa || [];
        const arAcc = pool.find(a => a.account_code === '1200')
            || pool.find(a => a.account_type === 'Asset' && /receivable/i.test(a.account_name));
        const revenueAcc = pool.find(a => a.account_code === '4000')
            || pool.find(a => a.account_type === 'Revenue' && /sales revenue/i.test(a.account_name))
            || pool.find(a => a.account_type === 'Revenue');
        if (!arAcc || !revenueAcc) return;
        const entryNumber = await nextJournalEntryNumber('WSP', date);
        const entryPayload: Record<string, unknown> = {
            date,
            description: entryDescription(entryNumber, `${label} · Invoice`)
                || `${label} · invoice`,
            reference_id: reference,
            status: 'Draft',
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
        // Never create an instantly-posted entry on an instance without the
        // status column — same refusal as every other auto-posting flow.
        if (jeErr && /status/i.test(jeErr.message || '')) {
            showToast('Order saved — run migrations/add_entry_status.sql on this instance to also book its invoice entry as a draft.', 'info');
            return;
        }
        if (jeErr || !entry) {
            console.error('Failed to post the wholesale invoice entry:', jeErr);
            return;
        }
        const { error: lErr } = await insertJournalLines([
            { journal_entry_id: entry.id, account_id: arAcc.id, debit: amount, credit: 0, description: `Invoice — ${customerName}` },
            { journal_entry_id: entry.id, account_id: revenueAcc.id, debit: 0, credit: amount, description: `Sales — ${customerName}` },
        ]);
        if (lErr) {
            console.error('Failed to post the wholesale invoice entry lines:', lErr);
            await supabase.from('journal_entries').delete().eq('id', entry.id);
        }
    } catch (e) {
        console.error('Failed to post the wholesale invoice entry:', e);
    }
};

// Re-book an existing Draft invoice entry at an edited total IN PLACE: the
// header is updated and the two lines replaced, but the reference row itself
// is never deleted. Used when the order already has payments — their receipt
// entries credit A/R against this entry, and a delete-then-recreate that
// failed halfway would leave those credits dangling AND make the order read
// as legacy (no INV + paid) on every later edit, unable to self-heal. A
// failed line replace here keeps the reference row, so re-saving the edit
// heals it. Throws on failure so the caller's toast reports it.
const rebookWholesaleInvoiceInPlace = async (
    entryId: string,
    entryNumber: string,
    label: string,
    customerName: string,
    total: number,
    date: string
): Promise<void> => {
    const amount = Math.round(total * 100) / 100;
    if (amount <= 0) throw new Error('The invoice entry needs a total above zero');
    const { data: coa, error: coaErr } = await supabase.from('chart_of_accounts')
        .select('id, account_code, account_name, account_type').eq('is_active', true);
    if (coaErr) throw coaErr;
    const pool = coa || [];
    const arAcc = pool.find(a => a.account_code === '1200')
        || pool.find(a => a.account_type === 'Asset' && /receivable/i.test(a.account_name));
    const revenueAcc = pool.find(a => a.account_code === '4000')
        || pool.find(a => a.account_type === 'Revenue' && /sales revenue/i.test(a.account_name))
        || pool.find(a => a.account_type === 'Revenue');
    if (!arAcc || !revenueAcc) throw new Error('No active Accounts Receivable / Sales Revenue account found');
    const { error: hErr } = await supabase.from('journal_entries').update({
        date,
        description: entryDescription(entryNumber, `${label} · Invoice`) || `${label} · invoice`,
    }).eq('id', entryId).eq('status', 'Draft');
    if (hErr) throw hErr;
    const { data: oldLines, error: oldErr } = await supabase.from('journal_entry_lines')
        .select('account_id, debit, credit, description').eq('journal_entry_id', entryId);
    if (oldErr) throw oldErr;
    const { error: delErr } = await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', entryId);
    if (delErr) throw delErr;
    const { error: insErr } = await insertJournalLines([
        { journal_entry_id: entryId, account_id: arAcc.id, debit: amount, credit: 0, description: `Invoice — ${customerName}` },
        { journal_entry_id: entryId, account_id: revenueAcc.id, debit: 0, credit: amount, description: `Sales — ${customerName}` },
    ]);
    if (insErr) {
        // Best-effort restore so the entry isn't left empty; the reference
        // row survives either way, so a retry of the edit still heals it.
        if (oldLines && oldLines.length) {
            await supabase.from('journal_entry_lines').insert(oldLines.map(l => ({ ...l, journal_entry_id: entryId })));
        }
        throw insErr;
    }
};

// Cancelling or deleting a wholesale order puts the stock back, so its COGS
// and invoice entries come back off the books too: a still-Draft entry is
// deleted; a Posted one is final, so the user is told to reverse it manually.
const removeWholesaleOrderEntry = async (
    orderId: string,
    suffix: 'COGS' | 'INV',
    showToast: (msg: string, kind: 'success' | 'error' | 'info') => void
) => {
    try {
        const { data: existing, error: exErr } = await supabase.from('journal_entries')
            .select('*').eq('reference_id', `WSO-${orderId}-${suffix}`).limit(1).maybeSingle();
        if (exErr || !existing) return;
        if (((existing as { status?: string }).status || 'Posted') !== 'Draft') {
            showToast(`This order has a POSTED ${suffix === 'COGS' ? 'cost-of-goods' : 'invoice'} entry — record a reversing entry manually.`, 'info');
            return;
        }
        await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', existing.id);
        await supabase.from('journal_entries').delete().eq('id', existing.id);
    } catch (e) {
        console.error(`Failed to remove the wholesale ${suffix} entry:`, e);
    }
};
const removeWholesaleCogsEntry = (orderId: string, showToast: (msg: string, kind: 'success' | 'error' | 'info') => void) =>
    removeWholesaleOrderEntry(orderId, 'COGS', showToast);
const removeWholesaleInvoiceEntry = (orderId: string, showToast: (msg: string, kind: 'success' | 'error' | 'info') => void) =>
    removeWholesaleOrderEntry(orderId, 'INV', showToast);

// Mirror of useProcurement, but for customer credit sales (Accounts Receivable).
export const useWholesale = () => {
    const { showToast } = useToast();
    const [wholesaleOrders, setWholesaleOrders] = useState<WholesaleOrder[]>([]);
    const [customers, setCustomers] = useState<WholesaleCustomer[]>([]);
    const [customerPayments, setCustomerPayments] = useState<CustomerPayment[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [tableMissing, setTableMissing] = useState(false);

    // Flat feed of every payment, independent of which order it settled —
    // mirror of fetchSupplierPayments in useProcurement. wholesale_orders has
    // no direct customer FK (customer_name is denormalized onto the order
    // itself), so the join is through the order rather than a customer row.
    const fetchCustomerPayments = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('customer_payments')
                .select('*, wholesale_order:wholesale_orders(*)')
                .order('payment_date', { ascending: false })
                .order('created_at', { ascending: false });
            if (error) throw error;
            setCustomerPayments((data || []) as CustomerPayment[]);
        } catch (error: any) {
            console.error('Failed to fetch customer payments:', error);
            showToast('Failed to fetch customer payments: ' + error.message, 'error');
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [showToast]);

    const fetchWholesaleOrders = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('wholesale_orders')
                .select('*, items:wholesale_order_items(*), payments:customer_payments(*)')
                // order_date is a plain date, so same-day orders tie — break the tie
                // with created_at so the newest transaction is always on top.
                .order('order_date', { ascending: false })
                .order('created_at', { ascending: false });
            if (error) {
                // Most likely the migration hasn't been run yet.
                setTableMissing(true);
                setWholesaleOrders([]);
            } else {
                setTableMissing(false);
                setWholesaleOrders((data || []) as WholesaleOrder[]);
            }
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, []);

    // Move stock out of a warehouse (delta negative to deduct, positive to restore).
    // Only touches products TRACKED in the warehouse (row exists): a missing row
    // means the deduction was skipped at creation, so a later cancel/delete
    // restore must not insert a phantom row from nothing.
    const adjustWarehouseStock = async (warehouseId: string, productId: string, delta: number) => {
        if (!warehouseId || !productId) return;
        const { data } = await supabase.from('warehouse_stock')
            .select('id, quantity').eq('warehouse_id', warehouseId).eq('product_id', productId).maybeSingle();
        if (data) {
            await supabase.from('warehouse_stock').update({ quantity: Math.max(0, (data.quantity || 0) + delta) }).eq('id', data.id);
        }
    };

    const adjustProductStock = async (productId: string, delta: number) => {
        if (!productId) return;
        const { data } = await supabase.from('products').select('stock').eq('id', productId).single();
        if (data) {
            await supabase.from('products').update({ stock: Math.max(0, (data.stock || 0) + delta) }).eq('id', productId);
        }
    };

    // Create a wholesale credit sale: stock leaves the company now, money comes later.
    const createWholesaleOrder = useCallback(async (
        order: Partial<WholesaleOrder>,
        items: Partial<WholesaleOrderItem>[],
        createdBy?: string
    ) => {
        try {
            // Availability check BEFORE anything is written: the deduction below
            // clamps at 0 (stock 4 - order 10 = 0), but cancel/delete restores the
            // FULL ordered quantity — an oversell would mint phantom stock. Sum
            // quantities per product so multiple lines are checked together.
            const neededByProduct = new Map<string, { qty: number; name: string }>();
            for (const i of items) {
                if (!i.product_id || !i.quantity) continue;
                const cur = neededByProduct.get(i.product_id) || { qty: 0, name: i.product_name || 'product' };
                cur.qty += i.quantity;
                neededByProduct.set(i.product_id, cur);
            }
            for (const [productId, need] of neededByProduct) {
                const { data: prod } = await supabase.from('products').select('stock, name').eq('id', productId).single();
                const available = prod?.stock || 0;
                if (need.qty > available) {
                    throw new Error(`Insufficient stock for ${prod?.name || need.name}: have ${available}, need ${need.qty}`);
                }
                if (order.warehouse_id) {
                    const { data: ws } = await supabase.from('warehouse_stock')
                        .select('quantity').eq('warehouse_id', order.warehouse_id).eq('product_id', productId).maybeSingle();
                    // Only products actually TRACKED in this warehouse (row exists)
                    // are constrained by it — warehouse_stock is sparsely populated
                    // (rows appear only via past wholesale/transfers), so a missing
                    // row means "not tracked here", not "zero stock". The
                    // company-wide check above still guards against overselling.
                    if (ws && need.qty > (ws.quantity || 0)) {
                        throw new Error(`Insufficient warehouse stock for ${prod?.name || need.name}: have ${ws.quantity || 0}, need ${need.qty}`);
                    }
                }
            }

            const total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
            const { data: inserted, error: oErr } = await supabase.from('wholesale_orders').insert([{
                invoice_number: order.invoice_number || null,
                customer_name: order.customer_name,
                customer_phone: order.customer_phone || null,
                warehouse_id: order.warehouse_id || null,
                order_date: order.order_date,
                due_date: order.due_date || null,
                status: order.status || 'Open',
                total_amount: total,
                amount_paid: 0,
                payment_status: 'Unpaid',
                notes: order.notes || null,
                created_by: createdBy || 'System'
            }]).select().single();
            if (oErr) throw oErr;

            const orderId = inserted.id;
            const itemsPayload = items.map(i => ({
                wholesale_order_id: orderId,
                product_id: i.product_id,
                product_name: i.product_name || '',
                quantity: i.quantity || 0,
                unit_price: i.unit_price || 0
            }));
            const { error: iErr } = await supabase.from('wholesale_order_items').insert(itemsPayload);
            if (iErr) {
                // Don't leave an orphan order with no items (savePurchaseOrder
                // does the same); a retry would otherwise duplicate the order.
                await supabase.from('wholesale_orders').delete().eq('id', orderId);
                throw iErr;
            }

            // Deduct stock (leaves the company).
            for (const i of items) {
                if (!i.product_id || !i.quantity) continue;
                await adjustProductStock(i.product_id, -(i.quantity));
                if (order.warehouse_id) await adjustWarehouseStock(order.warehouse_id, i.product_id, -(i.quantity));
            }

            // Log a stock-out movement per line so the sale shows in Stock Movements.
            const localDate = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
            const baseMovements = items
                .filter(i => i.product_id && i.quantity)
                .map(i => ({
                    product_id: i.product_id,
                    product_name: i.product_name || '',
                    type: 'out',
                    quantity: i.quantity,
                    unit_price: i.unit_price || 0,
                    source: 'Wholesale Order',
                    reason: 'Wholesale Sale',
                    reference_id: orderId,
                    customer_name: order.customer_name || '',
                    customer_phone: order.customer_phone || '',
                    note: `Wholesale ${order.invoice_number || 'WO-' + orderId.slice(0, 8)}`,
                    movement_date: localDate,
                    created_by: createdBy || 'System'
                }));
            if (baseMovements.length > 0) {
                // Try with warehouse_id first; the column only exists after the
                // add_warehouse_to_stock_movements migration. If the insert is
                // rejected (e.g. column missing), retry without it so the
                // movement is still logged.
                const withWarehouse = baseMovements.map(m => ({ ...m, warehouse_id: order.warehouse_id || null }));
                let { error: mErr } = await supabase.from('stock_movements').insert(withWarehouse);
                if (mErr) {
                    ({ error: mErr } = await supabase.from('stock_movements').insert(baseMovements));
                }
                if (mErr) {
                    console.error('Failed to log wholesale stock-out movements:', mErr);
                    showToast('Order saved, but logging to Stock Movements failed: ' + mErr.message, 'error');
                }
            }

            // The goods just left the company — relieve ledger inventory at cost
            // and book the sale itself: Dr A/R / Cr Sales at the order total,
            // settled later by the per-payment entries.
            const entryLabel = `${order.customer_name || 'Wholesale'} · ${order.invoice_number || 'WO-' + String(orderId).slice(0, 8).toUpperCase()}`;
            await postWholesaleCogsEntry(orderId, entryLabel, items, showToast);
            await postWholesaleInvoiceEntry(
                orderId, entryLabel, order.customer_name || 'Wholesale', total,
                order.order_date || localDate, showToast
            );

            showToast('Wholesale order created', 'success');
            await fetchWholesaleOrders(true);
            return orderId as string;
        } catch (error: any) {
            console.error('Failed to create wholesale order:', error);
            showToast('Failed to create wholesale order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    // Edit an existing order (Admin only, enforced in the UI): fully reverses
    // the stock/ledger effect this order currently holds — same restore the
    // Cancel/Delete paths use — then re-applies it for the edited fields and
    // items, exactly as creation does. This keeps the math simple (no per-line
    // delta reconciliation) at the cost of re-dating the stock movements and
    // COGS entry to the edit time rather than the original order time, which
    // already matches how Cancel/Delete rewrite history today.
    const updateWholesaleOrder = useCallback(async (
        order: WholesaleOrder,
        updates: { customer_name: string; customer_phone?: string; warehouse_id?: string; order_date: string; due_date?: string; status?: WholesaleOrder['status']; invoice_number?: string; notes?: string },
        items: Partial<WholesaleOrderItem>[],
        editedBy?: string
    ) => {
        try {
            if (order.status === 'Cancelled') throw new Error('Cannot edit a cancelled order');

            const total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);

            // Invoice-entry handling decided up front, BEFORE anything is written:
            //  - Draft invoice entry → taken off and re-booked at the edited total.
            //  - Posted invoice entry + changed total → abort the whole edit: the
            //    books are final at the old total, and silently keeping the stale
            //    amount (or re-booking next to a posted entry) would misstate
            //    revenue and A/R. Unposting it in Journal Entries unblocks the edit.
            //  - No invoice entry + payments already recorded → a legacy cash-basis
            //    order whose receipts credited Sales directly; booking an invoice
            //    now would double its revenue, so it stays legacy.
            //  - No invoice entry + nothing paid → safe to upgrade: book one.
            // select('*'), never 'id, status': the status column is optional
            // (add_entry_status.sql), and naming it on an instance without it
            // would make every edit fail. Such instances never hold INV
            // entries anyway (postWholesaleInvoiceEntry refuses without the
            // column), so this lookup just comes back empty there.
            const { data: invExisting, error: invExErr } = await supabase.from('journal_entries')
                .select('*').eq('reference_id', `WSO-${order.id}-INV`).limit(1).maybeSingle();
            if (invExErr) throw new Error("Could not check the order's invoice entry — try again");
            const invPosted = !!invExisting && ((invExisting as { status?: string }).status || 'Posted') !== 'Draft';
            if (invPosted && Math.abs(total - (Number(order.total_amount) || 0)) > 0.005) {
                throw new Error("This order's invoice entry is already POSTED at the old total — unpost it in Journal Entries, then edit the order.");
            }
            const paidSoFar = Number(order.amount_paid) || 0;
            // An accrual order edited below what's already paid would leave
            // receipts crediting more A/R than the invoice debits.
            if (invExisting && paidSoFar > 0.005 && total < paidSoFar - 0.005) {
                throw new Error(`The edited total (${total.toFixed(2)}) is below what this order has already been paid (${paidSoFar.toFixed(2)}) — delete its payments first.`);
            }
            const invDraft = !!invExisting && !invPosted;
            // Delete-then-recreate only while nothing is paid: it self-heals (a
            // lost Draft just re-books on the next edit, since paid is 0). A
            // PAID accrual order instead re-books IN PLACE further below —
            // deleting its reference row and failing to recreate it would
            // strand the payments' A/R credits with no invoice debit, and the
            // no-INV+paid rule would then treat the order as legacy forever.
            const rebookInvoice = (invDraft || !invExisting) && paidSoFar <= 0.005;
            const rebookInPlaceId = invDraft && paidSoFar > 0.005 ? (invExisting as { id: string }).id : null;
            const invEntryNumber = invExisting ? String((invExisting as { entry_number?: string }).entry_number || '') : '';

            // Availability check BEFORE anything is written, same approach as
            // createWholesaleOrder — except stock this order ALREADY holds
            // counts as available again (it's about to be restored below).
            const neededByProduct = new Map<string, { qty: number; name: string }>();
            for (const i of items) {
                if (!i.product_id || !i.quantity) continue;
                const cur = neededByProduct.get(i.product_id) || { qty: 0, name: i.product_name || 'product' };
                cur.qty += i.quantity;
                neededByProduct.set(i.product_id, cur);
            }
            const oldQtyByProduct = new Map<string, number>();
            for (const i of order.items || []) {
                if (!i.product_id || !i.quantity) continue;
                oldQtyByProduct.set(i.product_id, (oldQtyByProduct.get(i.product_id) || 0) + i.quantity);
            }
            const warehouseUnchanged = (order.warehouse_id || null) === (updates.warehouse_id || null);
            for (const [productId, need] of neededByProduct) {
                const { data: prod } = await supabase.from('products').select('stock, name').eq('id', productId).single();
                const reserved = oldQtyByProduct.get(productId) || 0;
                const available = (prod?.stock || 0) + reserved;
                if (need.qty > available) {
                    throw new Error(`Insufficient stock for ${prod?.name || need.name}: have ${available}, need ${need.qty}`);
                }
                if (updates.warehouse_id) {
                    const { data: ws } = await supabase.from('warehouse_stock')
                        .select('quantity').eq('warehouse_id', updates.warehouse_id).eq('product_id', productId).maybeSingle();
                    if (ws) {
                        const wsAvailable = (ws.quantity || 0) + (warehouseUnchanged ? reserved : 0);
                        if (need.qty > wsAvailable) {
                            throw new Error(`Insufficient warehouse stock for ${prod?.name || need.name}: have ${wsAvailable}, need ${need.qty}`);
                        }
                    }
                }
            }

            // Reverse what this order currently holds (mirror of delete/cancel).
            for (const i of order.items || []) {
                if (!i.product_id || !i.quantity) continue;
                await adjustProductStock(i.product_id, i.quantity);
                if (order.warehouse_id) await adjustWarehouseStock(order.warehouse_id, i.product_id, i.quantity);
            }
            await supabase.from('stock_movements').delete().eq('reference_id', order.id).eq('type', 'out');
            // Stock is (about to be) back, so the old cost-of-goods entry comes
            // off the books too — same bail-if-Posted guard as Cancel. The
            // invoice entry only when it's being re-booked (decided above):
            // a Posted one with an unchanged total stays untouched, and a
            // legacy order never had one.
            await removeWholesaleCogsEntry(order.id, showToast);
            if (rebookInvoice) await removeWholesaleInvoiceEntry(order.id, showToast);

            const paid = order.amount_paid || 0;
            const paymentStatus = paid <= 0.005 ? 'Unpaid' : (paid >= total - 0.005 ? 'Paid' : 'Partial');

            const { error: uErr } = await supabase.from('wholesale_orders').update({
                customer_name: updates.customer_name,
                customer_phone: updates.customer_phone || null,
                warehouse_id: updates.warehouse_id || null,
                order_date: updates.order_date,
                due_date: updates.due_date || null,
                status: updates.status || order.status,
                invoice_number: updates.invoice_number || null,
                notes: updates.notes || null,
                total_amount: total,
                payment_status: paymentStatus
            }).eq('id', order.id);
            if (uErr) throw uErr;

            // Replace the line items wholesale.
            const { error: delErr } = await supabase.from('wholesale_order_items').delete().eq('wholesale_order_id', order.id);
            if (delErr) throw delErr;
            const itemsPayload = items.filter(i => i.product_id && i.quantity).map(i => ({
                wholesale_order_id: order.id,
                product_id: i.product_id,
                product_name: i.product_name || '',
                quantity: i.quantity || 0,
                unit_price: i.unit_price || 0
            }));
            if (itemsPayload.length > 0) {
                const { error: iErr } = await supabase.from('wholesale_order_items').insert(itemsPayload);
                if (iErr) throw iErr;
            }

            // Re-apply the (edited) stock effect.
            for (const i of items) {
                if (!i.product_id || !i.quantity) continue;
                await adjustProductStock(i.product_id, -(i.quantity));
                if (updates.warehouse_id) await adjustWarehouseStock(updates.warehouse_id, i.product_id, -(i.quantity));
            }

            const localDate = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
            const baseMovements = items
                .filter(i => i.product_id && i.quantity)
                .map(i => ({
                    product_id: i.product_id,
                    product_name: i.product_name || '',
                    type: 'out',
                    quantity: i.quantity,
                    unit_price: i.unit_price || 0,
                    source: 'Wholesale Order',
                    reason: 'Wholesale Sale',
                    reference_id: order.id,
                    customer_name: updates.customer_name || '',
                    customer_phone: updates.customer_phone || '',
                    note: `Wholesale ${updates.invoice_number || 'WO-' + order.id.slice(0, 8)}`,
                    movement_date: localDate,
                    created_by: editedBy || 'System'
                }));
            if (baseMovements.length > 0) {
                const withWarehouse = baseMovements.map(m => ({ ...m, warehouse_id: updates.warehouse_id || null }));
                let { error: mErr } = await supabase.from('stock_movements').insert(withWarehouse);
                if (mErr) {
                    ({ error: mErr } = await supabase.from('stock_movements').insert(baseMovements));
                }
                if (mErr) {
                    console.error('Failed to log wholesale stock-out movements:', mErr);
                    showToast('Order saved, but logging to Stock Movements failed: ' + mErr.message, 'error');
                }
            }

            const editedLabel = `${updates.customer_name || 'Wholesale'} · ${updates.invoice_number || 'WO-' + String(order.id).slice(0, 8).toUpperCase()}`;
            await postWholesaleCogsEntry(order.id, editedLabel, items, showToast);
            if (rebookInvoice) {
                await postWholesaleInvoiceEntry(
                    order.id, editedLabel, updates.customer_name || 'Wholesale', total,
                    updates.order_date || localDate, showToast
                );
            } else if (rebookInPlaceId) {
                await rebookWholesaleInvoiceInPlace(
                    rebookInPlaceId, invEntryNumber, editedLabel,
                    updates.customer_name || 'Wholesale', total, updates.order_date || localDate
                );
            }

            showToast('Wholesale order updated', 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            console.error('Failed to update wholesale order:', error);
            showToast('Failed to update wholesale order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    const deleteWholesaleOrder = useCallback(async (order: WholesaleOrder) => {
        try {
            // Restore stock that was deducted at creation (only for non-cancelled orders).
            if (order.status !== 'Cancelled') {
                for (const i of order.items || []) {
                    if (!i.product_id || !i.quantity) continue;
                    await adjustProductStock(i.product_id, i.quantity);
                    if (order.warehouse_id) await adjustWarehouseStock(order.warehouse_id, i.product_id, i.quantity);
                }
                // Remove the stock-out movements logged at creation.
                await supabase.from('stock_movements').delete().eq('reference_id', order.id).eq('type', 'out');
            }
            // Payments cascade away with the order — capture their ids FIRST
            // (a failed read aborts the delete), remove the order, then clean
            // their linked Income rows. This ordering means a partial failure
            // at worst leaves an orphaned ledger row (recoverable clutter),
            // never a live order whose books already vanished.
            const { data: cascadingPays, error: paysErr } = await supabase.from('customer_payments').select('id').eq('wholesale_order_id', order.id);
            if (paysErr) throw paysErr;
            const { error } = await supabase.from('wholesale_orders').delete().eq('id', order.id);
            if (error) throw error;
            for (const p of cascadingPays || []) {
                const marker = `%#WSP-${String(p.id).slice(0, 8)}%`;
                // Remove the payments' ledger entries along with their income rows,
                // or they'd be unfindable once the transactions rows are gone.
                const { data: txs } = await supabase.from('transactions').select('id').like('description', marker);
                const refIds = (txs || []).map(t => 'TX-' + t.id);
                if (refIds.length) {
                    const { data: payEntries } = await supabase.from('journal_entries').select('id').in('reference_id', refIds);
                    const payEntryIds = (payEntries || []).map(e => e.id);
                    if (payEntryIds.length) {
                        await supabase.from('journal_entry_lines').delete().in('journal_entry_id', payEntryIds);
                        await supabase.from('journal_entries').delete().in('id', payEntryIds);
                    }
                }
                const { error: txErr } = await supabase.from('transactions').delete().like('description', marker);
                if (txErr) console.error('Failed to remove income row for deleted wholesale payment:', txErr);
            }
            // And the order's own cost-of-goods and invoice entries (no-ops if
            // already gone).
            await removeWholesaleCogsEntry(order.id, showToast);
            await removeWholesaleInvoiceEntry(order.id, showToast);
            showToast('Wholesale order deleted', 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            console.error('Failed to delete wholesale order:', error);
            showToast('Failed to delete wholesale order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    // Record a customer payment against an order (mirror of recordSupplierPayment).
    // Also logs each receipt to Income & Expense so wholesale money shows up as Income.
    const recordCustomerPayment = useCallback(async (orderId: string, amount: number, paymentMethod: string, notes: string, paymentDate?: string, receivedBy?: string, receivedInAccountId?: string, receivedInAccountName?: string) => {
        try {
            const payDate = paymentDate || dayKeyFromDate(new Date());
            // "Received into" needs migrations/add_customer_payment_account.sql;
            // until an instance has run it, save the receipt without the account.
            const payload: Record<string, unknown> = {
                wholesale_order_id: orderId,
                amount,
                payment_date: payDate,
                payment_method: paymentMethod,
                notes: notes || null,
                received_in_account_id: receivedInAccountId || null
            };
            let { data: inserted, error: pErr } = await supabase.from('customer_payments').insert([payload]).select().single();
            if (pErr && /received_in_account_id/i.test(pErr.message || '')) {
                const withoutAccount = { ...payload };
                delete withoutAccount.received_in_account_id;
                ({ data: inserted, error: pErr } = await supabase.from('customer_payments').insert([withoutAccount]).select().single());
                if (!pErr) showToast('Saved without the Received-into account — run migrations/add_customer_payment_account.sql to store it', 'info');
            }
            if (pErr) throw pErr;

            const { data: order, error: fErr } = await supabase
                .from('wholesale_orders').select('amount_paid, total_amount, customer_name, invoice_number').eq('id', orderId).single();
            if (fErr || !order) throw fErr || new Error('Order not found');

            const newPaid = (Number(order.amount_paid) || 0) + Number(amount);
            const status = newPaid >= order.total_amount ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Unpaid');
            const { error: uErr } = await supabase.from('wholesale_orders')
                .update({ amount_paid: newPaid, payment_status: status }).eq('id', orderId);
            if (uErr) throw uErr;

            // Log an Income transaction, tagged with the payment id so deleting the
            // payment can remove it again. Non-fatal: the payment itself succeeded.
            const marker = `#WSP-${String(inserted?.id || '').slice(0, 8)}`;
            const description = `${order.customer_name || 'Wholesale'} · ${order.invoice_number || 'WO-' + orderId.slice(0, 8).toUpperCase()} ${marker}`;
            const txId = generateUUID();
            const { error: tErr } = await supabase.from('transactions').insert([{
                id: txId,
                date: new Date(payDate).toISOString(),
                type: 'Income',
                category: 'លក់ដុំ',
                amount: Number(amount),
                description,
                // The account name (when picked) beats the generic method: Income &
                // Expense shows where the money landed, and the ledger import maps it.
                pay_by: receivedInAccountName || paymentMethod || null,
                added_by: receivedBy || 'Wholesale'
            }]);
            if (tErr) {
                console.error('Failed to log wholesale income transaction:', tErr);
                showToast('Payment saved, but logging to Income failed: ' + tErr.message, 'error');
            } else {
                // Also post a matching Draft entry straight to the ledger: Accounting
                // › Revenue reads journal entries, not the transactions log above, so
                // without this the receipt would only show there after someone runs
                // Import to Ledger. Same 'TX-<id>' reference as that import uses, so
                // running it later never double-books this receipt.
                try {
                    const { data: coa } = await supabase.from('chart_of_accounts')
                        .select('id, account_code, account_name, account_type').eq('is_active', true);
                    const pool = coa || [];
                    // Accrual orders booked their revenue up front (the WSO-…-INV
                    // entry, Dr A/R / Cr Sales), so this receipt settles the
                    // receivable: Dr cash / Cr A/R. Orders from before that
                    // existed have no invoice entry, so their receipts keep the
                    // old direct Cr Sales — revenue is still booked exactly once
                    // either way.
                    const { data: invEntry, error: invErr } = await supabase.from('journal_entries')
                        .select('id').eq('reference_id', `WSO-${orderId}-INV`).limit(1).maybeSingle();
                    if (invErr) {
                        // A failed lookup is indistinguishable from "legacy order",
                        // and crediting Sales on an accrual order would double its
                        // revenue — so book NO entry at all. The TX- reference lets
                        // Import to Ledger (Income & Expense) book it later.
                        console.error("Could not check the order's invoice entry — ledger entry skipped:", invErr);
                        showToast('Payment and Income logged, but the ledger entry was skipped (connection problem) — book it later with Import to Ledger.', 'info');
                    }
                    const arAcc = invEntry
                        ? (pool.find(a => a.account_code === '1200')
                            || pool.find(a => a.account_type === 'Asset' && /receivable/i.test(a.account_name)))
                        : null;
                    const revenueAcc = pool.find(a => a.account_code === '4000')
                        || pool.find(a => a.account_type === 'Revenue' && /sales revenue/i.test(a.account_name))
                        || pool.find(a => a.account_type === 'Revenue');
                    // An accrual order's receipt may ONLY credit A/R — falling
                    // back to Sales next to its standing invoice entry would
                    // double the revenue. So with an invoice entry but no
                    // active A/R account, book nothing and say so.
                    const creditAcc = invEntry ? arAcc : revenueAcc;
                    const cashAccId = receivedInAccountId || pickCashBankAccount(pool, receivedInAccountName || paymentMethod, { preferBank: true })?.id;
                    if (!invErr && invEntry && !arAcc) {
                        showToast('Payment and Income logged, but no active Accounts Receivable account exists — the ledger entry was skipped. Re-activate account 1200 in the Chart of Accounts.', 'info');
                    }
                    if (!invErr && creditAcc && cashAccId) {
                        const entryNumber = await nextJournalEntryNumber('WSP', payDate);
                        const entryPayload: Record<string, unknown> = {
                            date: payDate,
                            // The Income & Expense row keeps the fuller
                            // 'Customer · INV #WSP-…' text; the ledger entry
                            // uses the unified area format.
                            description: entryDescription(entryNumber, order.customer_name || 'Wholesale') || description,
                            reference_id: 'TX-' + txId,
                            status: 'Draft'
                        };
                        if (entryNumber) entryPayload.entry_number = entryNumber;
                        let { data: entry, error: jeErr } = await supabase.from('journal_entries')
                            .insert([entryPayload])
                            .select().single();
                        // entry_number arrives with migrations/add_journal_entry_number.sql;
                        // until an instance has run it, post the entry without it.
                        if (jeErr && /entry_number/i.test(jeErr.message || '')) {
                            const withoutEntryNumber = { ...entryPayload };
                            delete withoutEntryNumber.entry_number;
                            ({ data: entry, error: jeErr } = await supabase.from('journal_entries')
                                .insert([withoutEntryNumber])
                                .select().single());
                        }
                        if (jeErr && /status/i.test(jeErr.message || '')) {
                            showToast('Payment and Income logged — run migrations/add_entry_status.sql on this instance to also post it as a journal entry', 'info');
                        } else if (jeErr || !entry) {
                            console.error('Failed to create journal entry for payment:', jeErr);
                        } else {
                            const { error: lErr } = await insertJournalLines([
                                { journal_entry_id: entry.id, account_id: cashAccId, debit: Number(amount), credit: 0, description: `Receipt — ${order.customer_name || 'Wholesale'}` },
                                { journal_entry_id: entry.id, account_id: creditAcc.id, debit: 0, credit: Number(amount), description: `${arAcc ? 'Settle receivable' : 'Sales'} — ${order.customer_name || 'Wholesale'}` },
                            ]);
                            if (lErr) {
                                console.error('Failed to create journal entry lines for payment:', lErr);
                                await supabase.from('journal_entries').delete().eq('id', entry.id);
                            }
                        }
                    }
                } catch (jeCatchErr) {
                    console.error('Failed to post journal entry for wholesale payment:', jeCatchErr);
                }
            }

            showToast('Payment recorded', 'success');
            await fetchWholesaleOrders(true);
            await fetchCustomerPayments(true);
        } catch (error: any) {
            console.error('Failed to record payment:', error);
            showToast('Failed to record payment: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders, fetchCustomerPayments]);

    // Change an order's status. Cancelling returns the stock to inventory and
    // removes the logged stock-out movements (mirror of how deleting does it);
    // Open -> Delivered is a plain status update. Re-opening a cancelled order
    // is not supported, since its stock has already been returned.
    const updateWholesaleOrderStatus = useCallback(async (order: WholesaleOrder, status: WholesaleOrder['status']) => {
        try {
            if (status === 'Cancelled' && order.status !== 'Cancelled') {
                // An accrual order's receipts credited A/R against its invoice
                // entry; cancelling deletes that entry, which would leave the
                // credits dangling (negative A/R). So its payments must be
                // deleted first. Legacy orders (no invoice entry, receipts
                // credited Sales) keep their old self-consistent cancel.
                if ((Number(order.amount_paid) || 0) > 0.005) {
                    const { data: inv, error: invErr } = await supabase.from('journal_entries')
                        .select('id').eq('reference_id', `WSO-${order.id}-INV`).limit(1).maybeSingle();
                    if (invErr) throw new Error("Could not check the order's invoice entry — try again");
                    if (inv) throw new Error('This order has recorded payments — delete its payments first, then cancel (or delete the whole order).');
                }
                for (const i of order.items || []) {
                    if (!i.product_id || !i.quantity) continue;
                    await adjustProductStock(i.product_id, i.quantity);
                    if (order.warehouse_id) await adjustWarehouseStock(order.warehouse_id, i.product_id, i.quantity);
                }
                await supabase.from('stock_movements').delete().eq('reference_id', order.id).eq('type', 'out');
                // Stock is back, so the cost-of-goods and invoice entries come
                // off the books too.
                await removeWholesaleCogsEntry(order.id, showToast);
                await removeWholesaleInvoiceEntry(order.id, showToast);
            }
            const { error } = await supabase.from('wholesale_orders').update({ status }).eq('id', order.id);
            if (error) throw error;
            showToast(status === 'Cancelled' ? 'Order cancelled — stock returned' : `Order marked ${status}`, 'success');
            await fetchWholesaleOrders(true);
        } catch (error: any) {
            showToast('Failed to update order status: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders]);

    // Delete a customer payment and revert the order's paid amount (mirror of deleteSupplierPayment).
    const deleteCustomerPayment = useCallback(async (paymentId: string) => {
        try {
            const { data: payment, error: fErr } = await supabase.from('customer_payments').select('*').eq('id', paymentId).single();
            if (fErr) throw fErr;
            if (payment && payment.wholesale_order_id) {
                const { data: o } = await supabase.from('wholesale_orders').select('amount_paid, total_amount').eq('id', payment.wholesale_order_id).single();
                if (o) {
                    const newPaid = Math.max(0, (Number(o.amount_paid) || 0) - Number(payment.amount));
                    const status = newPaid === 0 ? 'Unpaid' : (newPaid >= o.total_amount ? 'Paid' : 'Partial');
                    await supabase.from('wholesale_orders').update({ amount_paid: newPaid, payment_status: status }).eq('id', payment.wholesale_order_id);
                }
            }
            const { error } = await supabase.from('customer_payments').delete().eq('id', paymentId);
            if (error) throw error;
            // Remove the Income transaction that was logged with this payment,
            // and the matching ledger entry (Draft or already Posted) it created.
            const marker = `%#WSP-${paymentId.slice(0, 8)}%`;
            const { data: txs } = await supabase.from('transactions').select('id').like('description', marker);
            const refIds = (txs || []).map(t => 'TX-' + t.id);
            if (refIds.length) {
                const { data: entries } = await supabase.from('journal_entries').select('id').in('reference_id', refIds);
                const entryIds = (entries || []).map(e => e.id);
                if (entryIds.length) {
                    await supabase.from('journal_entry_lines').delete().in('journal_entry_id', entryIds);
                    await supabase.from('journal_entries').delete().in('id', entryIds);
                }
            }
            await supabase.from('transactions').delete().like('description', marker);
            showToast('Payment deleted', 'success');
            await fetchWholesaleOrders(true);
            await fetchCustomerPayments(true);
        } catch (error: any) {
            showToast('Failed to delete payment: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchWholesaleOrders, fetchCustomerPayments]);

    // --- Customer directory (mirror of suppliers) ---
    const fetchCustomers = useCallback(async () => {
        const { data, error } = await supabase.from('wholesale_customers').select('*').order('name', { ascending: true });
        if (!error) setCustomers((data || []) as WholesaleCustomer[]);
    }, []);

    const saveCustomer = useCallback(async (customer: Partial<WholesaleCustomer>) => {
        try {
            const payload = {
                name: customer.name,
                contact_name: customer.contact_name || null,
                email: customer.email || null,
                phone: customer.phone || null,
                address: customer.address || null,
                note: customer.note || null,
                is_active: customer.is_active ?? true
            };
            if (customer.id) {
                const { error } = await supabase.from('wholesale_customers').update(payload).eq('id', customer.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('wholesale_customers').insert([payload]);
                if (error) throw error;
            }
            showToast(customer.id ? 'Customer updated' : 'Customer added', 'success');
            await fetchCustomers();
        } catch (error: any) {
            showToast('Failed to save customer: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchCustomers]);

    const deleteCustomer = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('wholesale_customers').delete().eq('id', id);
            if (error) throw error;
            showToast('Customer deleted', 'success');
            await fetchCustomers();
        } catch (error: any) {
            showToast('Failed to delete customer: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchCustomers]);

    // Next sequential invoice number (WO-0001, WO-0002, …): highest numeric
    // suffix among existing invoices with this prefix, plus one. The prefix
    // comes from Wholesale Setup (default WO); manually typed invoices in
    // other formats are ignored by the pattern and never disturbed.
    const nextInvoiceNumber = useCallback(async (prefix: string = 'WO'): Promise<string> => {
        const p = (prefix || 'WO').trim().replace(/-+$/, '') || 'WO';
        try {
            const { data, error } = await supabase.from('wholesale_orders')
                .select('invoice_number')
                .like('invoice_number', `${p}-%`);
            if (error) throw error;
            const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`^${escaped}-(\\d+)$`, 'i');
            let max = 0;
            for (const r of data || []) {
                const m = String(r.invoice_number || '').match(pattern);
                if (m) max = Math.max(max, parseInt(m[1], 10));
            }
            return `${p}-${String(max + 1).padStart(4, '0')}`;
        } catch (e) {
            console.error('Failed to compute next invoice number:', e);
            // Timestamp fallback still yields a unique, recognizable number.
            return `${p}-${Date.now().toString().slice(-6)}`;
        }
    }, []);

    return {
        wholesaleOrders,
        customers,
        customerPayments,
        isLoading,
        tableMissing,
        fetchWholesaleOrders,
        fetchCustomerPayments,
        nextInvoiceNumber,
        createWholesaleOrder,
        updateWholesaleOrder,
        deleteWholesaleOrder,
        updateWholesaleOrderStatus,
        recordCustomerPayment,
        deleteCustomerPayment,
        fetchCustomers,
        saveCustomer,
        deleteCustomer
    };
};
