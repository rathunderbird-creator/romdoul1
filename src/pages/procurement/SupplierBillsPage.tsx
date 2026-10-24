// Supplier Bills — "what we owe", one row per billed delivery.
//
// There is no separate Bill entity: a bill IS a Received Purchase Order that
// has been given a reference (invoice_number) and due date. Receiving a PO
// already auto-posts a Draft journal entry (Dr Inventory / Cr Accounts
// Payable, reference_id 'PO-'+id) — "posting" a bill here only flips that
// SAME entry from Draft to Posted, exactly like Journal Entries' own
// Draft→Posted. No new ledger entries are created by this page.
//
// Status is derived, never stored:
//   no receipt entry found  -> 'Draft' (Post then explains the problem)
//   receipt entry is Draft  -> 'Draft'
//   receipt entry Posted, payment_status 'Paid'      -> 'Paid'
//   receipt entry Posted, amount_paid > 0             -> 'Partially Paid'
//   receipt entry Posted, nothing paid yet             -> 'Posted'
import { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Eye, Printer, CheckCircle2, Pencil, Trash2, DollarSign, Download, RefreshCw, FileText } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useProcurement } from '../../hooks/useProcurement';
import { useAccounting } from '../../hooks/useAccounting';
import { useMobile } from '../../hooks/useMobile';
import { supabase } from '../../lib/supabase';
import { SwipeRow } from '../../components/MobileFilterKit';
import Modal from '../../components/Modal';
import { RecordSupplierPaymentModal } from '../../components';
import { dayKeyFromDate } from '../../utils/dateRange';
import { nextBillNumber } from '../../utils/billNumber';
import type { PurchaseOrder, SupplierPayment } from '../../types';

const fmtUsd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const fmtDate = (d?: string | null) => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB') : '—';
const escapeHtml = (s: string): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const poShortId = (po: Pick<PurchaseOrder, 'id'>) => `PO-${po.id.slice(0, 8).toUpperCase()}`;

type BillStatus = 'Draft' | 'Posted' | 'Partially Paid' | 'Paid';
const STATUSES: BillStatus[] = ['Draft', 'Posted', 'Partially Paid', 'Paid'];
// Draft/Posted: Journal Entries' own palette — this status IS that entry's
// status. Partially Paid/Paid: Purchase Orders' existing payment palette.
const STATUS_CFG: Record<BillStatus, { color: string; bg: string }> = {
    Draft: { color: '#92400e', bg: '#fef3c7' },
    Posted: { color: '#4c5fd0', bg: 'rgba(84, 105, 212, 0.12)' },
    'Partially Paid': { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)' },
    Paid: { color: '#10b981', bg: 'rgba(16, 185, 129, 0.08)' },
};
const statusChip = (status: BillStatus) => {
    const cfg = STATUS_CFG[status];
    return (
        <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap', background: cfg.bg, color: cfg.color }}>
            {status}
        </span>
    );
};

const PRINT_CSS = `
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #111; margin: 32px; font-size: 13px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .muted { color: #666; }
  .meta { margin: 14px 0 18px; display: grid; grid-template-columns: 110px 1fr; row-gap: 5px; }
  .meta b { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #ccc; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { font-weight: 700; background: #fafafa; }
  .foot { margin-top: 22px; font-size: 11px; color: #888; }
`;

const labelStyle: React.CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' };
const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
    background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
};

interface BillModalState { poId: string; reference: string; dueDate: string; locked: boolean }

const SupplierBillsPage = () => {
    const { setHeaderContent } = useHeader();
    const { currentUser, purchaseSettings } = useStore();
    const { showToast } = useToast();
    const isMobile = useMobile();
    const {
        purchaseOrders, suppliers, isLoading,
        fetchPurchaseOrders, fetchSuppliers,
        saveBillReference, clearBillReference,
        recordSupplierPayment,
    } = useProcurement();
    const { journalEntries, fetchJournalEntries } = useAccounting();

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Supplier Bills</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>What we owe — posting a bill turns a delivery into a payable.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchPurchaseOrders();
        fetchSuppliers();
        fetchJournalEntries();
    }, [fetchPurchaseOrders, fetchSuppliers, fetchJournalEntries]);

    const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);

    // This PO's receipt journal entry, by reference_id 'PO-'+id.
    const jeByPoId = useMemo(() => {
        const m = new Map<string, { id: string; status?: string }>();
        for (const je of journalEntries) {
            if (je.reference_id?.startsWith('PO-')) m.set(je.reference_id.slice(3), je);
        }
        return m;
    }, [journalEntries]);

    // Payment reality always wins over the receipt entry's own Draft/Posted
    // flag: a payment can be recorded from the (untouched) Purchase Orders
    // page without ever clicking Post here, and a bill that already carries
    // real money must never read back as Draft — Draft/Edit/Un-bill are only
    // for a bill nothing has been paid against yet.
    const billStatusOf = (po: PurchaseOrder): BillStatus => {
        if (po.payment_status === 'Paid') return 'Paid';
        if ((Number(po.amount_paid) || 0) > 0) return 'Partially Paid';
        const je = jeByPoId.get(po.id);
        if (!je || (je.status || 'Posted') === 'Draft') return 'Draft';
        return 'Posted';
    };
    // Independent of the status label above: a payment can land (via the
    // untouched Purchase Orders page) before anyone clicks Post here, so a
    // Partially Paid/Paid row can still have a Draft receipt entry underneath
    // that needs posting. Decoupled so Post never disappears in that case.
    const needsPosting = (po: PurchaseOrder): boolean => {
        const je = jeByPoId.get(po.id);
        return !je || (je.status || 'Posted') === 'Draft';
    };

    // A "bill" = a Received delivery that's been given a reference.
    const bills = useMemo(() => purchaseOrders.filter(po => po.status === 'Received' && !!po.invoice_number), [purchaseOrders]);
    // Received deliveries still waiting to be billed — the New Bill picker's pool.
    const billableDeliveries = useMemo(() => purchaseOrders.filter(po => po.status === 'Received' && !po.invoice_number), [purchaseOrders]);

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'All' | BillStatus>('All');
    const [supplierFilter, setSupplierFilter] = useState<string>('All');

    // Only suppliers that actually have a bill — same data-derived approach
    // as the "Bill a delivery…" picker, so the dropdown never offers a
    // supplier with nothing to show.
    const billSuppliers = useMemo(() => {
        const ids = new Set(bills.map(po => po.supplier_id));
        return Array.from(ids)
            .map(id => ({ id, name: supplierById.get(id)?.name || bills.find(po => po.supplier_id === id)?.supplier?.name || '(Deleted supplier)' }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [bills, supplierById]);

    const filteredBills = useMemo(() => {
        const q = search.trim().toLowerCase();
        return bills
            .filter(po => statusFilter === 'All' || billStatusOf(po) === statusFilter)
            .filter(po => supplierFilter === 'All' || po.supplier_id === supplierFilter)
            .filter(po => {
                if (!q) return true;
                const supplierName = po.supplier?.name || supplierById.get(po.supplier_id)?.name || '';
                return (po.invoice_number || '').toLowerCase().includes(q) || supplierName.toLowerCase().includes(q);
            })
            .sort((a, b) => (b.payment_due_date || b.order_date || '').localeCompare(a.payment_due_date || a.order_date || ''));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bills, search, statusFilter, supplierFilter, jeByPoId, supplierById]);

    const hasActiveFilters = search !== '' || statusFilter !== 'All' || supplierFilter !== 'All';

    // ── New / Edit Bill modal ──
    const [billModal, setBillModal] = useState<BillModalState | null>(null);
    const [isSavingBill, setIsSavingBill] = useState(false);

    const openNewBill = async (preselectedPoId?: string) => {
        const today = dayKeyFromDate(new Date());
        const reference = await nextBillNumber(today, purchaseSettings.numbering?.bills || 'BIL');
        const termsDays = Number(purchaseSettings.paymentTermsDays) || 0;
        let dueDate = '';
        if (termsDays > 0) {
            const due = new Date();
            due.setDate(due.getDate() + Math.round(termsDays));
            dueDate = dayKeyFromDate(due);
        }
        setBillModal({ poId: preselectedPoId || '', reference: reference || '', dueDate, locked: !!preselectedPoId });
    };
    const openEditBill = (po: PurchaseOrder) => {
        setBillModal({ poId: po.id, reference: po.invoice_number || '', dueDate: (po.payment_due_date || '').slice(0, 10), locked: true });
    };
    const submitBillModal = async () => {
        if (!billModal || !billModal.poId || !billModal.reference.trim()) {
            showToast('Pick a delivery and enter a reference', 'error');
            return;
        }
        setIsSavingBill(true);
        try {
            await saveBillReference(billModal.poId, billModal.reference.trim(), billModal.dueDate || null);
            setBillModal(null);
        } catch {
            // toast handled in hook
        } finally {
            setIsSavingBill(false);
        }
    };

    // ── Post (Draft -> flips the existing receipt entry to Posted) ──
    const [postingId, setPostingId] = useState<string | null>(null);
    const postBill = async (po: PurchaseOrder) => {
        const je = jeByPoId.get(po.id);
        if (!je) {
            showToast('No ledger entry found for this delivery — resave it on the Purchase Orders page, then try again.', 'error');
            return;
        }
        setPostingId(po.id);
        try {
            const { error } = await supabase.from('journal_entries').update({ status: 'Posted' }).eq('id', je.id);
            if (error) throw error;
            showToast('Bill posted', 'success');
            await fetchJournalEntries();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed to post bill: ' + msg, 'error');
        } finally {
            setPostingId(null);
        }
    };

    // ── Un-bill (Draft only) — clears the reference, never touches the PO itself ──
    const handleUnbill = async (po: PurchaseOrder) => {
        if (!confirm('Remove this bill? The delivery stays received — you can bill it again later.')) return;
        try {
            await clearBillReference(po.id);
            if (viewPOId === po.id) setViewPOId(null);
        } catch {
            // toast handled in hook
        }
    };

    // ── View modal (line items + payment history + Record Payment) ──
    // Derived from purchaseOrders by id (not a snapshot) so a payment
    // recorded here — or anywhere else — is reflected the moment the
    // hook's own refetch lands, no manual re-sync needed.
    const [viewPOId, setViewPOId] = useState<string | null>(null);
    const viewPO = useMemo(() => purchaseOrders.find(p => p.id === viewPOId) || null, [purchaseOrders, viewPOId]);
    const [viewPayments, setViewPayments] = useState<SupplierPayment[]>([]);
    const [viewPaymentsLoading, setViewPaymentsLoading] = useState(false);
    const loadViewPayments = async (poId: string) => {
        setViewPaymentsLoading(true);
        try {
            const { data } = await supabase.from('supplier_payments').select('*').eq('purchase_order_id', poId).order('payment_date', { ascending: false });
            setViewPayments((data || []) as SupplierPayment[]);
        } finally {
            setViewPaymentsLoading(false);
        }
    };
    const openView = (po: PurchaseOrder) => {
        setViewPOId(po.id);
        setViewPayments([]);
        loadViewPayments(po.id);
    };

    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const openPaymentModal = () => setIsPaymentModalOpen(true);
    const handleConfirmPayment = async (data: { amount: number; paymentDate: string; paymentMethod: string; paidFromAccountId?: string; paidFromAccountName?: string; notes?: string }) => {
        if (!viewPO) return;
        try {
            await recordSupplierPayment(viewPO.id, viewPO.supplier_id, data.amount, data.paymentMethod, data.notes || '', data.paymentDate, currentUser?.name, data.paidFromAccountId, data.paidFromAccountName);
            setIsPaymentModalOpen(false);
            await loadViewPayments(viewPO.id);
        } catch {
            // toast handled in hook
        }
    };

    // ── Print / CSV ──
    const openPrintWindow = (title: string, bodyHtml: string) => {
        const w = window.open('', '_blank', 'width=860,height=900');
        if (!w) { showToast('Allow popups to print', 'error'); return; }
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 300);
    };
    const printBill = (po: PurchaseOrder) => {
        const outstanding = (po.total_amount || 0) - (po.amount_paid || 0);
        const itemsHtml = (po.items || []).map(it => `
            <tr>
                <td>${escapeHtml(it.product?.name || '—')}</td>
                <td class="num">${it.quantity}</td>
                <td class="num">${fmtUsd(it.unit_price)}</td>
                <td class="num">${fmtUsd(it.quantity * it.unit_price)}</td>
            </tr>`).join('');
        openPrintWindow(`Bill ${po.invoice_number || poShortId(po)}`, `
  <h1>Romdoul ERP System Solution — Supplier Bill</h1>
  <div class="muted">${escapeHtml(po.invoice_number || poShortId(po))}</div>
  <div class="meta">
    <b>Supplier</b><span>${escapeHtml(po.supplier?.name || supplierById.get(po.supplier_id)?.name || '—')}</span>
    <b>Due</b><span>${escapeHtml(fmtDate(po.payment_due_date))}</span>
    <b>Status</b><span>${escapeHtml(billStatusOf(po))}</span>
  </div>
  <table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
    <tfoot>
      <tr><td colspan="3">Total</td><td class="num">${fmtUsd(po.total_amount)}</td></tr>
      <tr><td colspan="3">Outstanding</td><td class="num">${fmtUsd(outstanding)}</td></tr>
    </tfoot>
  </table>
  <div class="foot">Printed ${new Date().toLocaleString()}</div>`);
    };
    const printList = () => {
        const rowsHtml = filteredBills.map(po => `
            <tr>
                <td>${escapeHtml(po.invoice_number || poShortId(po))}</td>
                <td>${escapeHtml(po.supplier?.name || supplierById.get(po.supplier_id)?.name || '—')}</td>
                <td>${escapeHtml(fmtDate(po.payment_due_date))}</td>
                <td class="num">${fmtUsd(po.total_amount)}</td>
                <td class="num">${fmtUsd((po.total_amount || 0) - (po.amount_paid || 0))}</td>
                <td>${escapeHtml(billStatusOf(po))}</td>
            </tr>`).join('');
        const totalAmt = filteredBills.reduce((s, po) => s + (po.total_amount || 0), 0);
        const totalOut = filteredBills.reduce((s, po) => s + ((po.total_amount || 0) - (po.amount_paid || 0)), 0);
        openPrintWindow('Supplier Bills', `
  <h1>Romdoul ERP System Solution — Supplier Bills</h1>
  <div class="muted">${filteredBills.length} ${filteredBills.length === 1 ? 'bill' : 'bills'} · Printed ${new Date().toLocaleString()}</div>
  <table>
    <thead><tr><th>Reference</th><th>Supplier</th><th>Due</th><th class="num">Total</th><th class="num">Outstanding</th><th>Status</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td class="num">${fmtUsd(totalAmt)}</td><td class="num">${fmtUsd(totalOut)}</td><td></td></tr></tfoot>
  </table>`);
    };
    const exportCsv = () => {
        const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const head = ['Reference', 'Supplier', 'Due', 'Total', 'Outstanding', 'Status'];
        const body = filteredBills.map(po => [
            po.invoice_number || poShortId(po),
            po.supplier?.name || supplierById.get(po.supplier_id)?.name || '',
            String(po.payment_due_date || '').slice(0, 10),
            (po.total_amount || 0).toFixed(2),
            ((po.total_amount || 0) - (po.amount_paid || 0)).toFixed(2),
            billStatusOf(po),
        ].map(cell).join(','));
        const blob = new Blob(['﻿' + [head.map(cell).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `supplier-bills-${dayKeyFromDate(new Date())}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const viewStatus = viewPO ? billStatusOf(viewPO) : null;
    const viewOutstanding = viewPO ? (viewPO.total_amount || 0) - (viewPO.amount_paid || 0) : 0;

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                <button
                    className="primary-button"
                    onClick={() => openNewBill()}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '10px', fontWeight: 600, whiteSpace: 'nowrap' }}
                >
                    <Plus size={18} /> New Bill
                </button>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '340px' }}>
                    <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                        type="text"
                        placeholder="Search reference, invoice no. or supplier…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ ...inputStyle, paddingLeft: '34px' }}
                    />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'All' | BillStatus)} style={{ ...inputStyle, width: 'auto', minWidth: '140px', cursor: 'pointer' }}>
                    <option value="All">All statuses</option>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} style={{ ...inputStyle, width: 'auto', minWidth: '160px', cursor: 'pointer' }}>
                    <option value="All">All suppliers</option>
                    {billSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select
                    value=""
                    onChange={e => { if (e.target.value) openNewBill(e.target.value); }}
                    disabled={billableDeliveries.length === 0}
                    title={billableDeliveries.length === 0 ? 'No received deliveries waiting to be billed' : 'Pick a delivery to bill'}
                    style={{ ...inputStyle, width: 'auto', minWidth: '160px', cursor: billableDeliveries.length === 0 ? 'not-allowed' : 'pointer', opacity: billableDeliveries.length === 0 ? 0.6 : 1 }}
                >
                    <option value="">Bill a delivery…</option>
                    {billableDeliveries.map(po => (
                        <option key={po.id} value={po.id}>
                            {poShortId(po)} · {po.supplier?.name || supplierById.get(po.supplier_id)?.name || '—'} · {fmtUsd(po.total_amount)}
                        </option>
                    ))}
                </select>
                <button onClick={() => { fetchPurchaseOrders(); fetchJournalEntries(); }} title="Refresh" style={{ ...inputStyle, width: 'auto', padding: '10px', cursor: 'pointer', display: 'flex' }}>
                    <RefreshCw size={15} />
                </button>
                {hasActiveFilters && (
                    <button onClick={() => { setSearch(''); setStatusFilter('All'); setSupplierFilter('All'); }} style={{ padding: '8px 12px', borderRadius: '8px', fontSize: '13px', color: '#ef4444', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 500 }}>
                        Clear
                    </button>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button onClick={printList} disabled={isLoading || filteredBills.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (isLoading || filteredBills.length === 0) ? 0.5 : 1 }}>
                        <Printer size={13} /> Print list
                    </button>
                    <button onClick={exportCsv} disabled={isLoading || filteredBills.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (isLoading || filteredBills.length === 0) ? 0.5 : 1 }}>
                        <Download size={13} /> Export CSV
                    </button>
                </div>
            </div>

            {/* List */}
            {isLoading ? (
                <div style={{ textAlign: 'center', padding: '60px', color: 'var(--color-text-secondary)' }}>Loading bills…</div>
            ) : filteredBills.length === 0 ? (
                <div className="glass-panel" style={{ textAlign: 'center', padding: '60px', borderRadius: '16px' }}>
                    <FileText size={40} color="var(--color-text-muted)" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '8px' }}>No bills found</h3>
                    <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                        {hasActiveFilters ? 'Try adjusting your filters.' : 'Bill a received delivery to get started.'}
                    </p>
                </div>
            ) : isMobile ? (
                <div className="glass-panel" style={{ borderRadius: '16px', padding: 0, overflow: 'hidden' }}>
                    {filteredBills.map(po => {
                        const status = billStatusOf(po);
                        const outstanding = (po.total_amount || 0) - (po.amount_paid || 0);
                        const actions = [
                            { icon: Eye, label: 'View', color: '#6366F1', onClick: () => openView(po) },
                            ...(needsPosting(po) ? [{ icon: CheckCircle2, label: 'Post', color: '#4C5FD0', onClick: () => postBill(po) }] : []),
                            ...(status === 'Draft' ? [
                                { icon: Pencil, label: 'Edit', color: '#2563EB', onClick: () => openEditBill(po) },
                                { icon: Trash2, label: 'Delete', color: '#EF4444', onClick: () => handleUnbill(po) },
                            ] : []),
                        ];
                        return (
                            <SwipeRow key={po.id} onClick={() => openView(po)} style={{ borderBottom: '1px solid var(--color-border)' }} actions={actions}>
                                <div style={{ padding: '10px 12px 10px 14px', borderLeft: `4px solid ${STATUS_CFG[status].color}` }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '13px', color: 'var(--color-text-main)' }}>{po.invoice_number || poShortId(po)}</span>
                                        <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(po.total_amount)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                                        <span className="d2-khmer" style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {po.supplier?.name || supplierById.get(po.supplier_id)?.name || '—'} · Due {fmtDate(po.payment_due_date)}
                                        </span>
                                        {outstanding > 0.005 && <span style={{ fontSize: '12px', fontWeight: 700, color: '#ef4444', flexShrink: 0 }}>{fmtUsd(outstanding)}</span>}
                                    </div>
                                    <div style={{ marginTop: '6px' }}>{statusChip(status)}</div>
                                </div>
                            </SwipeRow>
                        );
                    })}
                </div>
            ) : (
                <div className="glass-panel" style={{ borderRadius: '16px', padding: '0', overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13.5px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Reference</th>
                                    <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Supplier</th>
                                    <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Due</th>
                                    <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', textAlign: 'right' }}>Total</th>
                                    <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', textAlign: 'right' }}>Outstanding</th>
                                    <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Status</th>
                                    <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredBills.map(po => {
                                    const status = billStatusOf(po);
                                    const outstanding = (po.total_amount || 0) - (po.amount_paid || 0);
                                    return (
                                        <tr key={po.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '12px 20px', fontFamily: 'monospace', fontSize: '12.5px', color: 'var(--color-text-main)', whiteSpace: 'nowrap' }}>{po.invoice_number || poShortId(po)}</td>
                                            <td className="d2-khmer" style={{ padding: '12px 20px', color: 'var(--color-text-main)' }}>{po.supplier?.name || supplierById.get(po.supplier_id)?.name || '—'}</td>
                                            <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(po.payment_due_date)}</td>
                                            <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{fmtUsd(po.total_amount)}</td>
                                            <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: outstanding > 0.005 ? '#ef4444' : 'var(--color-text-main)' }}>{fmtUsd(outstanding)}</td>
                                            <td style={{ padding: '12px 20px' }}>{statusChip(status)}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                    <button onClick={() => openView(po)} title="View" style={{ background: 'rgba(99,102,241,0.08)', border: 'none', cursor: 'pointer', color: '#6366f1', padding: '6px', borderRadius: '6px' }}><Eye size={15} /></button>
                                                    <button onClick={() => printBill(po)} title="Print" style={{ background: 'rgba(37,99,235,0.08)', border: 'none', cursor: 'pointer', color: '#2563eb', padding: '6px', borderRadius: '6px' }}><Printer size={15} /></button>
                                                    {needsPosting(po) && (
                                                        <button onClick={() => postBill(po)} disabled={postingId === po.id} title="Post" style={{ background: 'rgba(76,95,208,0.1)', border: 'none', cursor: postingId === po.id ? 'not-allowed' : 'pointer', color: '#4c5fd0', padding: '6px', borderRadius: '6px', opacity: postingId === po.id ? 0.6 : 1 }}>
                                                            {postingId === po.id ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={15} />}
                                                        </button>
                                                    )}
                                                    {status === 'Draft' && (
                                                        <>
                                                            <button onClick={() => openEditBill(po)} title="Edit" style={{ background: 'rgba(59,130,246,0.08)', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: '6px', borderRadius: '6px' }}><Pencil size={15} /></button>
                                                            <button onClick={() => handleUnbill(po)} title="Delete" style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px' }}><Trash2 size={15} /></button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* New / Edit Bill modal */}
            <Modal isOpen={!!billModal} onClose={() => setBillModal(null)} title={billModal?.locked && bills.some(b => b.id === billModal.poId) ? 'Edit Bill' : 'New Bill'}>
                {billModal && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                            <label style={labelStyle}>Delivery {!billModal.locked && <span style={{ color: 'red' }}>*</span>}</label>
                            {billModal.locked ? (
                                <div style={{ ...inputStyle, background: 'var(--color-bg)' }}>
                                    {(() => {
                                        const po = purchaseOrders.find(p => p.id === billModal.poId);
                                        return po ? `${poShortId(po)} · ${po.supplier?.name || supplierById.get(po.supplier_id)?.name || '—'} · ${fmtUsd(po.total_amount)}` : '—';
                                    })()}
                                </div>
                            ) : (
                                <select value={billModal.poId} onChange={e => setBillModal({ ...billModal, poId: e.target.value })} style={{ ...inputStyle, cursor: 'pointer' }}>
                                    <option value="">Bill a delivery…</option>
                                    {billableDeliveries.map(po => (
                                        <option key={po.id} value={po.id}>{poShortId(po)} · {po.supplier?.name || supplierById.get(po.supplier_id)?.name || '—'} · {fmtUsd(po.total_amount)}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <div>
                            <label style={labelStyle}>Reference <span style={{ color: 'red' }}>*</span></label>
                            <input type="text" value={billModal.reference} onChange={e => setBillModal({ ...billModal, reference: e.target.value })} placeholder="e.g. BIL-20261022-001" style={inputStyle} />
                        </div>
                        <div>
                            <label style={labelStyle}>Due date</label>
                            <input type="date" value={billModal.dueDate} onChange={e => setBillModal({ ...billModal, dueDate: e.target.value })} style={inputStyle} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                            <button onClick={() => setBillModal(null)} style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}>Cancel</button>
                            <button
                                onClick={submitBillModal}
                                disabled={isSavingBill || !billModal.poId || !billModal.reference.trim()}
                                style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: (!billModal.poId || !billModal.reference.trim()) ? 'var(--color-border)' : 'var(--color-primary)', color: (!billModal.poId || !billModal.reference.trim()) ? 'var(--color-text-muted)' : 'white', cursor: isSavingBill ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 600 }}
                            >
                                {isSavingBill ? 'Saving…' : 'Save Bill'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* View Bill modal */}
            <Modal isOpen={!!viewPOId} onClose={() => setViewPOId(null)} title="Supplier Bill" width="640px">
                {viewPO && viewStatus && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: '6px', fontSize: '13px' }}>
                            <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Reference</span>
                            <span style={{ color: 'var(--color-text-main)', fontFamily: 'monospace' }}>{viewPO.invoice_number || poShortId(viewPO)}</span>
                            <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Supplier</span>
                            <span className="d2-khmer" style={{ color: 'var(--color-text-main)' }}>{viewPO.supplier?.name || supplierById.get(viewPO.supplier_id)?.name || '—'}</span>
                            <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Due</span>
                            <span style={{ color: 'var(--color-text-main)' }}>{fmtDate(viewPO.payment_due_date)}</span>
                            <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Status</span>
                            <span>{statusChip(viewStatus)}</span>
                        </div>
                        <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ background: 'var(--color-bg)' }}>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Item</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Qty</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '11px', color: 'var(--color-text-secondary)' }}>Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(viewPO.items || []).map((it, i) => (
                                        <tr key={it.id || i} style={{ borderTop: '1px solid var(--color-border)' }}>
                                            <td className="d2-khmer" style={{ padding: '8px 12px', color: 'var(--color-text-main)' }}>{it.product?.name || '—'}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{it.quantity}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{fmtUsd(it.quantity * it.unit_price)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                        <td colSpan={2} style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--color-text-main)' }}>Total</td>
                                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--color-text-main)' }}>{fmtUsd(viewPO.total_amount)}</td>
                                    </tr>
                                    <tr style={{ background: 'var(--color-bg)' }}>
                                        <td colSpan={2} style={{ padding: '8px 12px', fontWeight: 700, color: viewOutstanding > 0.005 ? '#ef4444' : 'var(--color-text-main)' }}>Outstanding</td>
                                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: viewOutstanding > 0.005 ? '#ef4444' : 'var(--color-text-main)' }}>{fmtUsd(viewOutstanding)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        <div>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>
                                Payments {viewPayments.length > 0 && <span style={{ background: '#10b981', color: 'white', padding: '1px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, marginLeft: '4px' }}>{viewPayments.length}</span>}
                            </div>
                            {viewPaymentsLoading ? (
                                <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Loading…</div>
                            ) : viewPayments.length === 0 ? (
                                <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>No payments recorded yet.</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {viewPayments.map(p => (
                                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '8px 10px', borderRadius: '8px', background: 'var(--color-bg)' }}>
                                            <span style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(p.payment_date)} · {p.payment_method || '—'}</span>
                                            <span style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>{fmtUsd(p.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
                            <button onClick={() => printBill(viewPO)} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                                <Printer size={13} /> Print
                            </button>
                            {needsPosting(viewPO) && (
                                <button onClick={() => postBill(viewPO)} disabled={postingId === viewPO.id} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: 'none', background: '#4c5fd0', color: 'white', fontSize: '13px', fontWeight: 600, cursor: postingId === viewPO.id ? 'not-allowed' : 'pointer', opacity: postingId === viewPO.id ? 0.6 : 1 }}>
                                    <CheckCircle2 size={13} /> {postingId === viewPO.id ? 'Posting…' : 'Post'}
                                </button>
                            )}
                            {(viewStatus === 'Posted' || viewStatus === 'Partially Paid') && (
                                <button onClick={openPaymentModal} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: 'none', background: '#10b981', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                                    <DollarSign size={13} /> Record Payment
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </Modal>

            {viewPO && (
                <RecordSupplierPaymentModal
                    isOpen={isPaymentModalOpen}
                    onClose={() => setIsPaymentModalOpen(false)}
                    onConfirm={handleConfirmPayment}
                    remainingBalance={viewOutstanding}
                    supplierName={viewPO.supplier?.name || supplierById.get(viewPO.supplier_id)?.name}
                />
            )}
        </div>
    );
};

export default SupplierBillsPage;
