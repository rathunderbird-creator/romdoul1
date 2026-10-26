import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Supplier, PurchaseOrder, PurchaseOrderItem, SupplierPayment } from '../types';
import { useToast } from '../context/ToastContext';
import { nextJournalEntryNumber } from '../utils/journalEntryNumber';
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

type ToastFn = (msg: string, kind: 'success' | 'error' | 'info') => void;

// Standard accounting for goods received from a supplier: until they're sold
// they are an asset, not an expense — receiving a PO posts a Draft entry of
// Dr Inventory / Cr Accounts Payable for the PO total (COGS is booked later,
// when the goods sell — see retailCogsLines in StoreContext). Reference
// 'PO-<id>' so re-receiving never double-books and deleting the PO can remove
// it again. Called on EVERY save of a Received PO (not just the transition),
// so a post that failed once self-heals on the next save, and a still-Draft
// entry follows an edited PO total. Non-fatal: the receive itself succeeded.
export const postPurchaseReceiptEntry = async (
    poId: string,
    totalAmount: number,
    supplierId: string | undefined,
    showToast: ToastFn
) => {
    try {
        const amount = Math.round((Number(totalAmount) || 0) * 100) / 100;
        const { data: existing, error: exErr } = await supabase.from('journal_entries')
            .select('*').eq('reference_id', 'PO-' + poId).limit(1).maybeSingle();
        // Fail closed: posting blind on a failed dedupe read could double-book.
        if (exErr) { console.error('Could not check for an existing PO entry:', exErr); return; }

        const { data: coa } = await supabase.from('chart_of_accounts')
            .select('id, account_code, account_name, account_type').eq('is_active', true);
        const pool = coa || [];
        const inventoryAcc = pool.find(a => a.account_code === '1300')
            || pool.find(a => a.account_type === 'Asset' && /inventor|stock/i.test(a.account_name));
        const apAcc = pool.find(a => a.account_code === '2000')
            || pool.find(a => a.account_type === 'Liability' && /payable/i.test(a.account_name));

        if (existing) {
            // Keep a still-Draft entry in step with an edited PO total; a Posted
            // entry is final and only gets a heads-up.
            const { data: oldLines, error: lnErr } = await supabase.from('journal_entry_lines')
                .select('id, account_id, debit, credit').eq('journal_entry_id', existing.id);
            if (lnErr) return;
            const current = Math.round((oldLines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0) * 100) / 100;
            if (current === amount || amount <= 0) return;
            if (((existing as { status?: string }).status || 'Posted') !== 'Draft') {
                showToast(`This PO's posted inventory entry is $${current.toFixed(2)} but the PO total is now $${amount.toFixed(2)} — adjust the ledger manually.`, 'info');
                return;
            }
            if (!inventoryAcc || !apAcc) return;
            const { error: delErr } = await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', existing.id);
            if (delErr) return;
            const { error: insErr } = await supabase.from('journal_entry_lines').insert([
                { journal_entry_id: existing.id, account_id: inventoryAcc.id, debit: amount, credit: 0 },
                { journal_entry_id: existing.id, account_id: apAcc.id, debit: 0, credit: amount },
            ]);
            if (insErr) {
                // Put the previous lines back rather than leaving the entry empty.
                await supabase.from('journal_entry_lines').insert((oldLines || []).map(l => ({
                    journal_entry_id: existing.id, account_id: l.account_id, debit: l.debit, credit: l.credit,
                })));
                showToast('PO saved, but its inventory ledger entry could not be updated — re-save the PO to retry.', 'error');
            }
            return;
        }

        if (amount <= 0) return;
        if (!inventoryAcc || !apAcc) {
            showToast('PO received, but no Inventory or Accounts Payable account exists in the Chart of Accounts — no ledger entry was posted.', 'info');
            return;
        }
        let supplierName = 'Supplier';
        if (supplierId) {
            const { data: supplier } = await supabase.from('suppliers').select('name').eq('id', supplierId).single();
            if (supplier?.name) supplierName = supplier.name;
        }
        const date = dayKeyFromDate(new Date());
        const entryNumber = await nextJournalEntryNumber('PUR', date);
        const entryPayload: Record<string, unknown> = {
            date,
            description: `${supplierName} · PO-${poId.slice(0, 8).toUpperCase()} received`,
            reference_id: 'PO-' + poId,
            status: 'Draft',
        };
        if (entryNumber) entryPayload.entry_number = entryNumber;
        let entry: { id: string } | null | undefined;
        let jeErr: { message?: string } | null | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
            ({ data: entry, error: jeErr } = await supabase.from('journal_entries').insert([entryPayload]).select().single());
            if (!jeErr) break;
            const msg = jeErr.message || '';
            if (/entry_number/i.test(msg) && 'entry_number' in entryPayload) { delete entryPayload.entry_number; continue; }
            break;
        }
        // Never create an instantly-posted entry on an instance without the
        // status column — same refusal as every other auto-posting flow.
        if (jeErr && /status/i.test(jeErr.message || '')) {
            showToast('PO received — run migrations/add_entry_status.sql on this instance to also post the inventory entry as a draft.', 'info');
            return;
        }
        if (jeErr || !entry) {
            console.error('Failed to post the inventory entry for the received PO:', jeErr);
            showToast('PO received, but the inventory ledger entry failed to post — re-save the PO to retry.', 'error');
            return;
        }
        const { error: lErr } = await supabase.from('journal_entry_lines').insert([
            { journal_entry_id: entry.id, account_id: inventoryAcc.id, debit: amount, credit: 0 },
            { journal_entry_id: entry.id, account_id: apAcc.id, debit: 0, credit: amount },
        ]);
        if (lErr) {
            console.error('Failed to post the inventory entry lines for the received PO:', lErr);
            await supabase.from('journal_entries').delete().eq('id', entry.id);
            showToast('PO received, but the inventory ledger entry failed to post — re-save the PO to retry.', 'error');
        }
    } catch (e) {
        console.error('Failed to post the inventory entry for the received PO:', e);
    }
};

// Loading an AP opening balance (Purchase Setup → AP Opening Balances): the
// invoice itself is a real Received purchase_orders row (so it shows up in
// Supplier Bills / Accounts Payable / Purchase Dashboard like any other
// bill), but unlike a normal receive this does NOT touch Inventory — it's
// not real goods arriving, just a payable carried over from a previous
// system. Posts Dr [offset account, e.g. Opening Balance Equity] /
// Cr Accounts Payable, Draft like every other auto-posted entry in this app,
// reference 'PO-<id>' so it reads the same as any other bill's entry
// (PurchaseDashboardPage's billStatusOf() looks it up this same way).
export const postOpeningBalanceEntry = async (
    poId: string,
    totalAmount: number,
    offsetAccountId: string,
    supplierName: string,
    showToast: ToastFn
): Promise<boolean> => {
    try {
        const amount = Math.round((Number(totalAmount) || 0) * 100) / 100;
        if (amount <= 0) return false;

        const { data: existing, error: exErr } = await supabase.from('journal_entries')
            .select('id').eq('reference_id', 'PO-' + poId).limit(1).maybeSingle();
        if (exErr) { console.error('Could not check for an existing opening-balance entry:', exErr); return false; }
        if (existing) return true; // Already posted for this PO.

        const { data: coa } = await supabase.from('chart_of_accounts')
            .select('id, account_code, account_name, account_type').eq('is_active', true);
        const pool = coa || [];
        const offsetAcc = pool.find(a => a.id === offsetAccountId);
        const apAcc = pool.find(a => a.account_code === '2000')
            || pool.find(a => a.account_type === 'Liability' && /payable/i.test(a.account_name));
        if (!offsetAcc || !apAcc) {
            showToast('Opening balance saved, but no Accounts Payable account exists in the Chart of Accounts — no ledger entry was posted.', 'info');
            return false;
        }

        const date = dayKeyFromDate(new Date());
        const entryNumber = await nextJournalEntryNumber('OPA', date);
        const entryPayload: Record<string, unknown> = {
            date,
            description: `${supplierName} · opening balance`,
            reference_id: 'PO-' + poId,
            status: 'Draft',
        };
        if (entryNumber) entryPayload.entry_number = entryNumber;

        let entry: { id: string } | null | undefined;
        let jeErr: { message?: string } | null | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
            ({ data: entry, error: jeErr } = await supabase.from('journal_entries').insert([entryPayload]).select().single());
            if (!jeErr) break;
            const msg = jeErr.message || '';
            if (/entry_number/i.test(msg) && 'entry_number' in entryPayload) { delete entryPayload.entry_number; continue; }
            break;
        }
        if (jeErr && /status/i.test(jeErr.message || '')) {
            showToast('Opening balance saved — run migrations/add_entry_status.sql on this instance to also post the ledger entry as a draft.', 'info');
            return false;
        }
        if (jeErr || !entry) {
            console.error('Failed to post the opening-balance ledger entry:', jeErr);
            showToast('Opening balance saved, but the ledger entry failed to post.', 'error');
            return false;
        }
        const { error: lErr } = await supabase.from('journal_entry_lines').insert([
            { journal_entry_id: entry.id, account_id: offsetAcc.id, debit: amount, credit: 0 },
            { journal_entry_id: entry.id, account_id: apAcc.id, debit: 0, credit: amount },
        ]);
        if (lErr) {
            console.error('Failed to post the opening-balance ledger entry lines:', lErr);
            await supabase.from('journal_entries').delete().eq('id', entry.id);
            showToast('Opening balance saved, but the ledger entry failed to post.', 'error');
            return false;
        }
        return true;
    } catch (e) {
        console.error('Failed to post the opening-balance ledger entry:', e);
        return false;
    }
};

// Reversing a loaded opening balance: deletes its PO and journal entry
// outright (never offered once a real payment has been recorded against it —
// same "can't silently reverse something money has already touched"
// philosophy as Stock Adjustments refusing to delete a Posted adjustment).
export const reverseOpeningBalance = async (poId: string): Promise<void> => {
    const { data: je } = await supabase.from('journal_entries').select('id').eq('reference_id', 'PO-' + poId).maybeSingle();
    if (je) {
        await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', je.id);
        await supabase.from('journal_entries').delete().eq('id', je.id);
    }
    await supabase.from('purchase_order_items').delete().eq('purchase_order_id', poId);
    await supabase.from('purchase_orders').delete().eq('id', poId);
};

// Cancelling a received PO takes the goods (and the debt) back off the books:
// a still-Draft receive entry is deleted outright; a Posted one is final, so
// the user is told to reverse it manually.
const cancelPurchaseReceiptEntry = async (poId: string, showToast: ToastFn) => {
    try {
        const { data: existing, error: exErr } = await supabase.from('journal_entries')
            .select('*').eq('reference_id', 'PO-' + poId).limit(1).maybeSingle();
        if (exErr || !existing) return;
        if (((existing as { status?: string }).status || 'Posted') !== 'Draft') {
            showToast('This cancelled PO has a POSTED inventory entry — record a reversing entry manually.', 'info');
            return;
        }
        await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', existing.id);
        await supabase.from('journal_entries').delete().eq('id', existing.id);
    } catch (e) {
        console.error('Failed to remove the inventory entry for the cancelled PO:', e);
    }
};

export const useProcurement = () => {
    const { showToast } = useToast();
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchSuppliers = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('suppliers')
                .select('*')
                .order('name', { ascending: true });
                
            if (error) throw error;
            setSuppliers(data || []);
        } catch (error: any) {
            console.error('Failed to fetch suppliers:', error);
            showToast('Failed to fetch suppliers: ' + error.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    // Returns the saved supplier row, so a caller (e.g. the PO form's inline
    // "Add Supplier") can select the new supplier right away.
    const saveSupplier = useCallback(async (supplier: Partial<Supplier>): Promise<Supplier | null> => {
        try {
            let saved: Supplier | null = null;
            if (supplier.id) {
                const { error } = await supabase
                    .from('suppliers')
                    .update({
                        name: supplier.name,
                        contact_name: supplier.contact_name,
                        email: supplier.email,
                        phone: supplier.phone,
                        address: supplier.address,
                        tax_id: supplier.tax_id,
                        is_active: supplier.is_active
                    })
                    .eq('id', supplier.id);
                if (error) throw error;
                saved = supplier as Supplier;
                showToast('Supplier updated successfully', 'success');
            } else {
                const { data, error } = await supabase
                    .from('suppliers')
                    .insert([{
                        name: supplier.name,
                        contact_name: supplier.contact_name,
                        email: supplier.email,
                        phone: supplier.phone,
                        address: supplier.address,
                        tax_id: supplier.tax_id,
                        is_active: supplier.is_active ?? true
                    }])
                    .select()
                    .single();
                if (error) throw error;
                saved = data as Supplier;
                showToast('Supplier created successfully', 'success');
            }
            await fetchSuppliers();
            return saved;
        } catch (error: any) {
            console.error('Failed to save supplier:', error);
            showToast('Failed to save supplier: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchSuppliers]);

    const deleteSupplier = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('suppliers').delete().eq('id', id);
            if (error) throw error;
            showToast('Supplier deleted successfully', 'success');
            await fetchSuppliers();
        } catch (error: any) {
            console.error('Failed to delete supplier:', error);
            showToast('Failed to delete supplier: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchSuppliers]);

    const fetchPurchaseOrders = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('purchase_orders')
                .select('*, supplier:suppliers(*), items:purchase_order_items(*, product:products(*)), payments:supplier_payments(payment_date)')
                // order_date is a plain date, so same-day POs tie — break the tie
                // with created_at so the newest transaction is always on top.
                .order('order_date', { ascending: false })
                .order('created_at', { ascending: false });
                
            if (error) throw error;
            setPurchaseOrders(data || []);
        } catch (error: any) {
            console.error('Failed to fetch purchase orders:', error);
            showToast('Failed to fetch purchase orders: ' + error.message, 'error');
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [showToast]);

    const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);

    const fetchSupplierPayments = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('supplier_payments')
                .select('*, supplier:suppliers(*)')
                // payment_date is a plain date — same tie-break as Purchase Orders.
                .order('payment_date', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) throw error;
            setSupplierPayments(data || []);
        } catch (error: any) {
            console.error('Failed to fetch supplier payments:', error);
            showToast('Failed to fetch supplier payments: ' + error.message, 'error');
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [showToast]);

    const savePurchaseOrder = useCallback(async (po: Partial<PurchaseOrder>, items: Partial<PurchaseOrderItem>[]) => {
        try {
            let currentPoId = po.id;
            let wasReceived = false;

            if (currentPoId) {
                // The old status decides whether a Cancelled save needs to take a
                // received PO's inventory entry back off the books (see below).
                const { data: oldPo } = await supabase.from('purchase_orders').select('status').eq('id', currentPoId).single();
                wasReceived = oldPo?.status === 'Received';
                // Update. payment_status/amount_paid are owned by the payment
                // flow (recordSupplierPayment) — only write them when the caller
                // explicitly passes them, otherwise an ordinary edit (fixing a
                // note) would reset a part-paid PO to Unpaid/$0 and invite a
                // double payment. invoice_number/payment_due_date are now ALSO
                // independently owned by Supplier Bills (saveBillReference/
                // clearBillReference) for the same reason: an edit form opened
                // before a delivery was billed (or before it was un-billed)
                // snapshots the old value, and saving it afterwards must not
                // silently clobber what Supplier Bills set in the meantime.
                const updatePayload: any = {
                    supplier_id: po.supplier_id,
                    order_date: po.order_date,
                    expected_delivery_date: po.expected_delivery_date,
                    status: po.status,
                    total_amount: po.total_amount,
                    notes: po.notes
                };
                if (po.payment_status !== undefined) updatePayload.payment_status = po.payment_status;
                if (po.amount_paid !== undefined) updatePayload.amount_paid = po.amount_paid;
                if (po.payment_due_date !== undefined) updatePayload.payment_due_date = po.payment_due_date || null;
                if (po.invoice_number !== undefined) updatePayload.invoice_number = po.invoice_number || null;
                // When only the total changed, recompute the status from the
                // stored amount_paid so a paid PO whose total was raised shows
                // Partial (with its real balance) instead of a stale 'Paid'.
                if (po.payment_status === undefined && po.total_amount !== undefined) {
                    const { data: cur } = await supabase.from('purchase_orders').select('amount_paid').eq('id', currentPoId).single();
                    const paid = Number(cur?.amount_paid) || 0;
                    const total = Number(po.total_amount) || 0;
                    updatePayload.payment_status = total > 0 && paid >= total ? 'Paid' : (paid > 0 ? 'Partial' : 'Unpaid');
                }
                const { error: poError } = await supabase
                    .from('purchase_orders')
                    .update(updatePayload)
                    .eq('id', currentPoId);

                if (poError) throw poError;

                // Delete old items
                await supabase.from('purchase_order_items').delete().eq('purchase_order_id', currentPoId);

            } else {
                // Insert
                const { data: insertedPO, error: poError } = await supabase
                    .from('purchase_orders')
                    .insert([{
                        supplier_id: po.supplier_id,
                        order_date: po.order_date,
                        expected_delivery_date: po.expected_delivery_date || null,
                        status: po.status,
                        total_amount: po.total_amount,
                        payment_status: po.payment_status || 'Unpaid',
                        amount_paid: po.amount_paid || 0,
                        payment_due_date: po.payment_due_date || null,
                        invoice_number: po.invoice_number || null,
                        notes: po.notes || null
                    }])
                    .select()
                    .single();
                    
                if (poError) throw poError;
                currentPoId = insertedPO.id;
            }

            const itemsToInsert = items.map(item => ({
                purchase_order_id: currentPoId,
                product_id: item.product_id,
                quantity: item.quantity || 0,
                unit_price: item.unit_price || 0
            }));

            const { error: itemsError } = await supabase
                .from('purchase_order_items')
                .insert(itemsToInsert);

            if (itemsError) {
                if (!po.id) {
                    await supabase.from('purchase_orders').delete().eq('id', currentPoId);
                }
                throw itemsError;
            }

            if (po.status === 'Received' && currentPoId) {
                // Every save, not just the transition: the PO- dedupe makes it
                // idempotent, a previously failed post self-heals, and an edited
                // total updates a still-Draft entry.
                await postPurchaseReceiptEntry(currentPoId, Number(po.total_amount) || 0, po.supplier_id, showToast);
            } else if (po.status === 'Cancelled' && wasReceived && currentPoId) {
                await cancelPurchaseReceiptEntry(currentPoId, showToast);
            }

            showToast(po.id ? 'Purchase Order updated successfully' : 'Purchase Order created successfully', 'success');
            await fetchPurchaseOrders(true); // silent fetch
            return currentPoId;
        } catch (error: any) {
            console.error('Failed to save purchase order:', error);
            showToast('Failed to save purchase order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPurchaseOrders]);

    const deletePurchaseOrder = useCallback(async (id: string) => {
        try {
            // Payments cascade away with the PO — capture their ids FIRST (a
            // failed read aborts the delete), remove the PO, then clean their
            // linked Expense rows. A partial failure at worst leaves an
            // orphaned ledger row (recoverable), never a live PO whose books
            // already vanished.
            const { data: cascadingPays, error: paysErr } = await supabase.from('supplier_payments').select('id').eq('purchase_order_id', id);
            if (paysErr) throw paysErr;
            const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
            if (error) throw error;
            for (const p of cascadingPays || []) {
                const marker = `%#SPP-${String(p.id).slice(0, 8)}%`;
                // The payments' ledger entries now DEBIT Accounts Payable — remove
                // them along with the receive entry below, or deleting a paid PO
                // would leave a permanent negative A/P balance (and the entries
                // would be unfindable once their transactions rows are gone).
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
                if (txErr) console.error('Failed to remove expense row for deleted supplier payment:', txErr);
            }
            // The receive-time inventory entry (Dr Inventory / Cr A-P) belongs to
            // this PO — remove it too, or the ledger keeps a liability for a
            // purchase that no longer exists.
            const { data: poEntries } = await supabase.from('journal_entries').select('id').eq('reference_id', 'PO-' + id);
            const poEntryIds = (poEntries || []).map(e => e.id);
            if (poEntryIds.length) {
                await supabase.from('journal_entry_lines').delete().in('journal_entry_id', poEntryIds);
                await supabase.from('journal_entries').delete().in('id', poEntryIds);
            }
            showToast('Purchase Order deleted successfully', 'success');
            await fetchPurchaseOrders(true);
        } catch (error: any) {
            console.error('Failed to delete purchase order:', error);
            showToast('Failed to delete purchase order: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPurchaseOrders]);

    // Also logs each supplier payment to Income & Expense as an Expense.
    const recordSupplierPayment = useCallback(async (poId: string, supplierId: string, amount: number, paymentMethod: string, notes: string, paymentDate?: string, paidBy?: string, paidFromAccountId?: string, paidFromAccountName?: string) => {
        try {
            const payDate = paymentDate || dayKeyFromDate(new Date());
            // Log payment ("Paid from" needs migrations/add_supplier_payment_account.sql;
            // until an instance has run it, save the payment without the account).
            const payload: Record<string, unknown> = {
                purchase_order_id: poId,
                supplier_id: supplierId,
                amount,
                payment_date: payDate,
                payment_method: paymentMethod,
                notes,
                paid_from_account_id: paidFromAccountId || null
            };
            let { data: inserted, error: paymentError } = await supabase.from('supplier_payments').insert([payload]).select().single();
            if (paymentError && /paid_from_account_id/i.test(paymentError.message || '')) {
                const withoutAccount = { ...payload };
                delete withoutAccount.paid_from_account_id;
                ({ data: inserted, error: paymentError } = await supabase.from('supplier_payments').insert([withoutAccount]).select().single());
                if (!paymentError) showToast('Saved without the Paid-from account — run migrations/add_supplier_payment_account.sql to store it', 'info');
            }

            if (paymentError) throw paymentError;

            // Fetch current PO
            const { data: po, error: fetchError } = await supabase
                .from('purchase_orders')
                .select('amount_paid, total_amount')
                .eq('id', poId)
                .single();

            if (fetchError || !po) throw fetchError || new Error('PO not found');

            const newAmountPaid = (Number(po.amount_paid) || 0) + Number(amount);
            const newPaymentStatus = newAmountPaid >= po.total_amount ? 'Paid' : 'Partial';

            // Update PO
            const { error: poUpdateError } = await supabase
                .from('purchase_orders')
                .update({
                    amount_paid: newAmountPaid,
                    payment_status: newPaymentStatus
                })
                .eq('id', poId);

            if (poUpdateError) throw poUpdateError;

            // Log an Expense transaction, tagged with the payment id so deleting the
            // payment can remove it again. Non-fatal: the payment itself succeeded.
            const { data: supplier } = await supabase.from('suppliers').select('name').eq('id', supplierId).single();
            const marker = `#SPP-${String(inserted?.id || '').slice(0, 8)}`;
            const description = `${supplier?.name || 'Supplier'} · PO-${poId.slice(0, 8).toUpperCase()} ${marker}`;
            const txId = generateUUID();
            const { error: tErr } = await supabase.from('transactions').insert([{
                id: txId,
                date: new Date(payDate).toISOString(),
                type: 'Expense',
                category: 'ទិញឥវ៉ាន់',
                amount: Number(amount),
                description,
                // The account name (when picked) beats the generic method: Income &
                // Expense shows where the money left, and the ledger import maps it.
                pay_by: paidFromAccountName || paymentMethod || null,
                added_by: paidBy || 'Purchasing'
            }]);
            if (tErr) {
                console.error('Failed to log supplier expense transaction:', tErr);
                showToast('Payment saved, but logging to Expense failed: ' + tErr.message, 'error');
            } else {
                // Also post a matching Draft entry straight to the ledger: Accounting
                // › Expense reads journal entries, not the transactions log above, so
                // without this the payment would only show there after someone runs
                // Import to Ledger. Same 'TX-<id>' reference as that import uses, so
                // running it later never double-books this payment.
                try {
                    const { data: coa } = await supabase.from('chart_of_accounts')
                        .select('id, account_code, account_name, account_type').eq('is_active', true);
                    const pool = coa || [];
                    // Standard accounting: paying a supplier settles the liability the
                    // received PO created (Dr Accounts Payable, Cr Cash/Bank) — the
                    // purchase itself already sits in Inventory, and COGS is booked
                    // when the goods sell. Debit A/P only when this PO's receive
                    // entry actually exists in the ledger (prepayments on unreceived
                    // POs, and POs received before this treatment shipped, have no
                    // A/P credit to settle); otherwise keep the old direct-expense
                    // treatment so the books stay balanced either way.
                    const { data: receiveEntry } = await supabase.from('journal_entries')
                        .select('id').eq('reference_id', 'PO-' + poId).limit(1).maybeSingle();
                    const apAcc = receiveEntry
                        ? (pool.find(a => a.account_code === '2000')
                            || pool.find(a => a.account_type === 'Liability' && /payable/i.test(a.account_name)))
                        : undefined;
                    const debitAcc = apAcc
                        || pool.find(a => a.account_code === '5000')
                        || pool.find(a => a.account_type === 'Expense' && /cost of goods|cogs|purchas/i.test(a.account_name))
                        || pool.find(a => a.account_type === 'Expense');
                    const cashAccId = paidFromAccountId || pool.find(a => a.account_type === 'Asset' && /cash|bank/i.test(a.account_name))?.id;
                    if (debitAcc && cashAccId) {
                        const entryNumber = await nextJournalEntryNumber('SPP', payDate);
                        const entryPayload: Record<string, unknown> = { date: payDate, description, reference_id: 'TX-' + txId, status: 'Draft' };
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
                            showToast('Payment and Expense logged — run migrations/add_entry_status.sql on this instance to also post it as a journal entry', 'info');
                        } else if (jeErr || !entry) {
                            console.error('Failed to create journal entry for payment:', jeErr);
                        } else {
                            const { error: lErr } = await supabase.from('journal_entry_lines').insert([
                                { journal_entry_id: entry.id, account_id: debitAcc.id, debit: Number(amount), credit: 0 },
                                { journal_entry_id: entry.id, account_id: cashAccId, debit: 0, credit: Number(amount) },
                            ]);
                            if (lErr) {
                                console.error('Failed to create journal entry lines for payment:', lErr);
                                await supabase.from('journal_entries').delete().eq('id', entry.id);
                            }
                        }
                    }
                } catch (jeCatchErr) {
                    console.error('Failed to post journal entry for supplier payment:', jeCatchErr);
                }
            }

            showToast('Payment recorded successfully', 'success');
            await fetchPurchaseOrders(true);
            await fetchSupplierPayments(true);
        } catch (error: any) {
            console.error('Failed to record payment:', error);
            showToast('Failed to record payment: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPurchaseOrders, fetchSupplierPayments]);

    // Supplier Bills: billing a delivery means giving its already-Received PO
    // a reference/due date — never savePurchaseOrder(), whose update path
    // unconditionally deletes+re-inserts purchase_order_items with no
    // rollback on a failed re-insert. A narrow UPDATE of just these two
    // columns can't touch items, inventory, or the PO's receipt journal
    // entry either way.
    const saveBillReference = useCallback(async (poId: string, invoiceNumber: string, dueDate: string | null) => {
        try {
            const { error } = await supabase.from('purchase_orders')
                .update({ invoice_number: invoiceNumber || null, payment_due_date: dueDate || null })
                .eq('id', poId);
            if (error) throw error;
            showToast('Bill saved', 'success');
            await fetchPurchaseOrders(true);
        } catch (error: any) {
            console.error('Failed to save bill reference:', error);
            showToast('Failed to save bill: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPurchaseOrders]);

    // "Un-bills" a delivery: clears the reference/due date so it reappears in
    // the "Bill a delivery…" picker. The delivery itself (the PO, its items,
    // its inventory effect, its receipt journal entry) is untouched.
    const clearBillReference = useCallback(async (poId: string) => {
        try {
            const { error } = await supabase.from('purchase_orders')
                .update({ invoice_number: null, payment_due_date: null })
                .eq('id', poId);
            if (error) throw error;
            showToast('Bill removed — the delivery stays received', 'success');
            await fetchPurchaseOrders(true);
        } catch (error: any) {
            console.error('Failed to remove bill reference:', error);
            showToast('Failed to remove bill: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPurchaseOrders]);

    const deleteSupplierPayment = useCallback(async (paymentId: string) => {
        try {
            // Wait, we need to revert PO amount_paid too. 
            // Fetch payment to get PO id and amount
            const { data: payment, error: fetchErr } = await supabase.from('supplier_payments').select('*').eq('id', paymentId).single();
            if (fetchErr) throw fetchErr;

            if (payment && payment.purchase_order_id) {
                const { data: po } = await supabase.from('purchase_orders').select('amount_paid, total_amount').eq('id', payment.purchase_order_id).single();
                if (po) {
                    const newAmountPaid = Math.max(0, (Number(po.amount_paid) || 0) - Number(payment.amount));
                    const newPaymentStatus = newAmountPaid === 0 ? 'Unpaid' : (newAmountPaid >= po.total_amount ? 'Paid' : 'Partial');
                    await supabase.from('purchase_orders').update({
                        amount_paid: newAmountPaid,
                        payment_status: newPaymentStatus
                    }).eq('id', payment.purchase_order_id);
                }
            }

            const { error } = await supabase.from('supplier_payments').delete().eq('id', paymentId);
            if (error) throw error;
            // Remove the Expense transaction that was logged with this payment,
            // and the matching ledger entry (Draft or already Posted) it created.
            const marker = `%#SPP-${paymentId.slice(0, 8)}%`;
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
            showToast('Payment deleted successfully', 'success');
            await fetchPurchaseOrders(true);
            await fetchSupplierPayments(true);
        } catch (error: any) {
            console.error('Failed to delete payment:', error);
            showToast('Failed to delete payment: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPurchaseOrders, fetchSupplierPayments]);

    return {
        suppliers,
        purchaseOrders,
        isLoading,
        fetchSuppliers,
        saveSupplier,
        deleteSupplier,
        fetchPurchaseOrders,
        deletePurchaseOrder,
        savePurchaseOrder,
        saveBillReference,
        clearBillReference,
        recordSupplierPayment,
        deleteSupplierPayment,
        supplierPayments,
        fetchSupplierPayments
    };
};
