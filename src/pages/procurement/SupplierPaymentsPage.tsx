// Supplier Payments — "money paid out, and which bills it settled": a flat,
// read-only ledger of every supplier_payments row, independent of which PO
// each one happened to settle. Recording a payment here is supplier-first:
// pick the supplier and an amount, and the payment is applied against that
// supplier's outstanding bills oldest-due-first (recordSupplierPayment still
// books one payment row per bill it settles, so the ledger stays per-bill).
import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Eye, Printer, XCircle, Download, RefreshCw, Receipt, Zap } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useProcurement } from '../../hooks/useProcurement';
import { useAccounting } from '../../hooks/useAccounting';
import { supabase } from '../../lib/supabase';
import Modal from '../../components/Modal';
import { dayKeyFromDate } from '../../utils/dateRange';
import type { SupplierPayment, PurchaseOrder } from '../../types';

const fmtUsd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const fmtDate = (d?: string | null) => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB') : '—';
const escapeHtml = (s: string): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const poShortId = (id: string) => `PO-${id.slice(0, 8).toUpperCase()}`;

type PayStatus = 'Posted' | 'Draft';
const STATUS_CFG: Record<PayStatus, { color: string; bg: string }> = {
    Draft: { color: '#92400e', bg: '#fef3c7' },
    Posted: { color: '#4c5fd0', bg: 'rgba(84, 105, 212, 0.12)' },
};
const statusChip = (status: PayStatus) => (
    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap', background: STATUS_CFG[status].bg, color: STATUS_CFG[status].color }}>
        {status}
    </span>
);

const labelStyle: React.CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' };
const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
    background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
};

const PRINT_CSS = `
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #111; margin: 32px; font-size: 13px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .muted { color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #ccc; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { font-weight: 700; background: #fafafa; }
  .foot { margin-top: 22px; font-size: 11px; color: #888; }
`;

const SupplierPaymentsPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { purchaseSettings } = useStore();
    const { showToast } = useToast();
    const {
        purchaseOrders, supplierPayments, isLoading,
        fetchPurchaseOrders, fetchSupplierPayments,
        recordSupplierPayment, deleteSupplierPayment,
    } = useProcurement();
    const { journalEntries, fetchJournalEntries, accounts, fetchAccounts } = useAccounting();

    useEffect(() => { fetchAccounts(); }, [fetchAccounts]);
    // Cash/bank ledger accounts for the "Paid from" select.
    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)),
        [accounts]
    );

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Supplier Payments</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Money paid out, and which bills it settled</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchPurchaseOrders();
        fetchSupplierPayments();
        fetchJournalEntries();
    }, [fetchPurchaseOrders, fetchSupplierPayments, fetchJournalEntries]);

    const poById = useMemo(() => new Map(purchaseOrders.map(po => [po.id, po])), [purchaseOrders]);

    // Every payment's own posting status: recordSupplierPayment tags its
    // transaction with a "#SPP-<payment id's first 8 chars>" marker in the
    // description, and the journal entry it posts carries reference_id
    // 'TX-'+that transaction's id — no direct FK links a payment to its
    // entry, so the marker is the only way back to it (same trick
    // deleteSupplierPayment already uses to find what to clean up).
    const [paymentStatus, setPaymentStatus] = useState<Map<string, PayStatus>>(new Map());
    useEffect(() => {
        let alive = true;
        (async () => {
            if (supplierPayments.length === 0) { setPaymentStatus(new Map()); return; }
            const { data: txs } = await supabase.from('transactions').select('id, description').like('description', '%#SPP-%');
            if (!alive) return;
            const entryByRef = new Map(journalEntries.map(e => [e.reference_id, e]));
            const next = new Map<string, PayStatus>();
            for (const p of supplierPayments) {
                const marker = `#SPP-${p.id.slice(0, 8)}`;
                const tx = (txs || []).find(t => (t.description || '').includes(marker));
                const entry = tx ? entryByRef.get('TX-' + tx.id) : undefined;
                next.set(p.id, entry ? ((entry.status || 'Posted') === 'Draft' ? 'Draft' : 'Posted') : 'Draft');
            }
            setPaymentStatus(next);
        })();
        return () => { alive = false; };
    }, [supplierPayments, journalEntries]);

    // "PAY-YYYYMMDD-NNN", computed for display only — supplier_payments has
    // no reference column of its own (unlike bills' invoice_number), so this
    // is derived fresh each render: group by payment_date, number in
    // creation order within that day. Purely cosmetic, same accepted
    // tradeoff as nextBillNumber/nextJournalEntryNumber.
    const referenceOf = useMemo(() => {
        const byDate = new Map<string, SupplierPayment[]>();
        for (const p of supplierPayments) {
            const day = String(p.payment_date || '').slice(0, 10);
            const arr = byDate.get(day);
            if (arr) arr.push(p); else byDate.set(day, [p]);
        }
        const refs = new Map<string, string>();
        for (const [day, list] of byDate) {
            const ordered = [...list].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
            ordered.forEach((p, i) => refs.set(p.id, `PAY-${day.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`));
        }
        return refs;
    }, [supplierPayments]);

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'All' | PayStatus>('All');

    const filteredPayments = useMemo(() => {
        const q = search.trim().toLowerCase();
        return supplierPayments
            .filter(p => {
                if (statusFilter === 'All') return true;
                return (paymentStatus.get(p.id) || 'Draft') === statusFilter;
            })
            .filter(p => {
                if (!q) return true;
                const ref = (referenceOf.get(p.id) || '').toLowerCase();
                const supplierName = (p.supplier?.name || '').toLowerCase();
                return ref.includes(q) || supplierName.includes(q);
            })
            .sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || '') || (b.created_at || '').localeCompare(a.created_at || ''));
    }, [supplierPayments, search, statusFilter, paymentStatus, referenceOf]);

    const hasActiveFilters = search !== '' || statusFilter !== 'All';

    // ── Record Payment: supplier-first form, applied oldest-bill-first ──
    const billableBills = useMemo(
        () => purchaseOrders
            .filter(po => po.status === 'Received' && !!po.invoice_number && ((po.total_amount || 0) - (po.amount_paid || 0)) > 0.005),
        [purchaseOrders]
    );
    const supplierOptions = useMemo(() => {
        const bySupplier = new Map<string, { name: string; bills: PurchaseOrder[]; outstanding: number }>();
        for (const po of billableBills) {
            const g = bySupplier.get(po.supplier_id) || { name: po.supplier?.name || 'Unknown supplier', bills: [], outstanding: 0 };
            g.bills.push(po);
            g.outstanding += (po.total_amount || 0) - (po.amount_paid || 0);
            bySupplier.set(po.supplier_id, g);
        }
        return [...bySupplier.entries()]
            .map(([id, g]) => ({ id, ...g }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [billableBills]);

    const [isPayOpen, setIsPayOpen] = useState(false);
    const [paySupplierId, setPaySupplierId] = useState('');
    const [payDate, setPayDate] = useState('');
    const [payAmount, setPayAmount] = useState('');
    const [payAccountId, setPayAccountId] = useState('');
    const [payMethod, setPayMethod] = useState('Bank transfer');
    const [payReference, setPayReference] = useState('');
    const [payCurrency, setPayCurrency] = useState<'USD' | 'KHR'>('USD');
    const [payRate, setPayRate] = useState('1');
    const [payNotes, setPayNotes] = useState('');
    const [paySaving, setPaySaving] = useState(false);
    // Per-bill application amounts (USD), keyed by purchase order id.
    const [allocations, setAllocations] = useState<Record<string, string>>({});
    const paySupplier = supplierOptions.find(s => s.id === paySupplierId);

    // The selected supplier's open bills, oldest due date first.
    const payBills = useMemo(() => {
        if (!paySupplier) return [] as (PurchaseOrder & { outstanding: number })[];
        return [...paySupplier.bills]
            .map(po => ({ ...po, outstanding: Math.round(((po.total_amount || 0) - (po.amount_paid || 0)) * 100) / 100 }))
            .sort((a, b) => (a.payment_due_date || a.order_date || '').localeCompare(b.payment_due_date || b.order_date || ''));
    }, [paySupplier]);

    // The books are kept in USD — a KHR amount converts at the given rate.
    const payUsdAmount = useMemo(() => {
        const entered = Number(payAmount) || 0;
        if (payCurrency !== 'KHR') return entered;
        const rate = Number(payRate);
        return rate > 0 ? Math.round((entered / rate) * 100) / 100 : 0;
    }, [payAmount, payCurrency, payRate]);

    const appliedTotal = useMemo(
        () => Math.round(payBills.reduce((s, po) => s + (Number(allocations[po.id]) || 0), 0) * 100) / 100,
        [payBills, allocations]
    );
    const onAccount = Math.round((payUsdAmount - appliedTotal) * 100) / 100;

    // Spread the entered amount across the bills, oldest due date first.
    const fillOldestFirst = () => {
        let remaining = payUsdAmount;
        const next: Record<string, string> = {};
        for (const po of payBills) {
            const slice = Math.round(Math.min(Math.max(remaining, 0), po.outstanding) * 100) / 100;
            next[po.id] = slice > 0 ? slice.toFixed(2) : '';
            remaining -= slice;
        }
        setAllocations(next);
    };

    const openPay = () => {
        setPaySupplierId('');
        setPayDate(dayKeyFromDate(new Date()));
        setPayAmount('');
        setPayMethod('Bank transfer');
        setPayReference('');
        setPayCurrency('USD');
        setPayRate('1');
        setPayNotes('');
        setAllocations({});
        const def = purchaseSettings.defaultPaymentAccountId;
        setPayAccountId(def && paymentAccounts.some(a => a.id === def) ? def : '');
        setIsPayOpen(true);
    };

    const submitPayment = async () => {
        if (!paySupplier) { showToast('Choose a supplier', 'error'); return; }
        const entered = Number(payAmount);
        if (!entered || entered <= 0) { showToast('Enter a valid amount', 'error'); return; }
        const rate = Number(payRate);
        if (payCurrency === 'KHR' && (!rate || rate <= 0)) { showToast('Enter the KHR exchange rate', 'error'); return; }
        const usd = payUsdAmount;
        for (const po of payBills) {
            if ((Number(allocations[po.id]) || 0) > po.outstanding + 0.005) {
                showToast(`${po.invoice_number || poShortId(po.id)}: applied amount exceeds its ${fmtUsd(po.outstanding)} outstanding`, 'error');
                return;
            }
        }
        if (appliedTotal <= 0) { showToast('Apply the payment to at least one bill — use "Oldest first" to fill it automatically', 'error'); return; }
        if (Math.abs(onAccount) > 0.005) {
            showToast(`Applied ${fmtUsd(appliedTotal)} doesn't match the ${fmtUsd(usd)} amount — on-account credit isn't supported, so apply the full amount to bills`, 'error');
            return;
        }
        if (paymentAccounts.length > 0 && !payAccountId) { showToast('Choose the account this payment is paid from', 'error'); return; }
        const acc = paymentAccounts.find(a => a.id === payAccountId);
        const note = [
            payReference.trim() ? `Ref: ${payReference.trim()}` : '',
            payCurrency === 'KHR' ? `KHR ${entered.toLocaleString()} @ ${rate}` : '',
            payNotes.trim(),
        ].filter(Boolean).join(' · ');
        setPaySaving(true);
        try {
            for (const po of payBills) {
                const slice = Math.round((Number(allocations[po.id]) || 0) * 100) / 100;
                if (slice <= 0) continue;
                await recordSupplierPayment(po.id, paySupplierId, slice, payMethod, note, payDate, undefined, payAccountId || undefined, acc?.account_name);
            }
            setIsPayOpen(false);
        } catch {
            // toast handled in hook
        } finally {
            setPaySaving(false);
        }
    };

    // ── View / Delete ──
    const [viewPayment, setViewPayment] = useState<SupplierPayment | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const handleDelete = async (p: SupplierPayment) => {
        if (!confirm(`Delete ${referenceOf.get(p.id) || 'this payment'}? The bill it settled goes back to its previous balance.`)) return;
        setDeletingId(p.id);
        try {
            await deleteSupplierPayment(p.id);
            if (viewPayment?.id === p.id) setViewPayment(null);
        } finally {
            setDeletingId(null);
        }
    };

    // ── Export / print: one flat table, shared by CSV and Print ──
    const activeTable = () => {
        const money = (n: number) => fmtUsd(n);
        return {
            name: 'Supplier Payments',
            columns: ['Reference', 'Date', 'Supplier', 'Bill', 'Amount', 'Unapplied', 'Status'],
            rows: filteredPayments.map(p => [
                referenceOf.get(p.id) || '—',
                fmtDate(p.payment_date),
                p.supplier?.name || '—',
                poById.get(p.purchase_order_id)?.invoice_number || poShortId(p.purchase_order_id),
                money(p.amount),
                money(0),
                paymentStatus.get(p.id) || 'Draft',
            ]),
        };
    };

    const exportCsv = () => {
        const t = activeTable();
        const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = [t.columns, ...t.rows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `supplier-payments-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const printList = () => {
        const t = activeTable();
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) return;
        const body = t.rows.map(r => `<tr>${r.map((c, i) => `<td class="${i >= 4 && i <= 5 ? 'num' : ''}">${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('');
        const total = filteredPayments.reduce((s, p) => s + (p.amount || 0), 0);
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${t.name}</title><style>${PRINT_CSS}</style></head><body>
        <h1>${t.name}</h1><p class="muted">${filteredPayments.length} ${filteredPayments.length === 1 ? 'payment' : 'payments'} · Printed ${new Date().toLocaleString()}</p>
        <table><thead><tr>${t.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody>
        <tfoot><tr><td colspan="4">Total</td><td class="num">${fmtUsd(total)}</td><td colspan="2"></td></tr></tfoot></table>
        <div class="foot">All figures are in USD.</div>
        </body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    onClick={openPay}
                    disabled={billableBills.length === 0}
                    title={billableBills.length === 0 ? 'No outstanding bills to pay' : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '8px', border: 'none', background: billableBills.length === 0 ? 'var(--color-border)' : '#4c5fd0', color: 'white', fontSize: '14px', fontWeight: 600, cursor: billableBills.length === 0 ? 'not-allowed' : 'pointer' }}
                >
                    <Plus size={16} /> Record Payment
                </button>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '340px' }}>
                    <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input type="text" placeholder="Search reference or supplier…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: '34px' }} />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'All' | PayStatus)} style={{ ...inputStyle, width: 'auto', minWidth: '140px', cursor: 'pointer' }}>
                    <option value="All">All statuses</option>
                    <option value="Posted">Posted</option>
                    <option value="Draft">Draft</option>
                </select>
                <button onClick={() => { fetchSupplierPayments(); fetchJournalEntries(); }} title="Refresh" style={{ ...inputStyle, width: 'auto', padding: '10px', cursor: 'pointer', display: 'flex' }}>
                    <RefreshCw size={15} />
                </button>
                {hasActiveFilters && (
                    <button onClick={() => { setSearch(''); setStatusFilter('All'); }} style={{ padding: '8px 12px', borderRadius: '8px', fontSize: '13px', color: '#ef4444', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 500 }}>
                        Clear
                    </button>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button onClick={printList} disabled={isLoading || filteredPayments.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (isLoading || filteredPayments.length === 0) ? 0.5 : 1 }}>
                        <Printer size={13} /> Print list
                    </button>
                    <button onClick={exportCsv} disabled={isLoading || filteredPayments.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (isLoading || filteredPayments.length === 0) ? 0.5 : 1 }}>
                        <Download size={13} /> Export CSV
                    </button>
                </div>
            </div>

            <div style={{ background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                {isLoading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading payments...</div>
                ) : filteredPayments.length === 0 ? (
                    <div className="glass-panel" style={{ textAlign: 'center', padding: '60px', border: 'none' }}>
                        <Receipt size={40} color="var(--color-text-muted)" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                        <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '8px' }}>No payments found</h3>
                        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            {hasActiveFilters ? 'Try adjusting your filters.' : 'Record a payment against an outstanding bill to get started.'}
                        </p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '720px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                    {['Reference', 'Date', 'Supplier', 'Amount', 'Unapplied', 'Status', ''].map((h, i) => (
                                        <th key={h || 'actions'} style={{ padding: '12px 20px', textAlign: i === 3 || i === 4 ? 'right' : 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPayments.map(p => (
                                    <tr key={p.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '12px 20px', fontSize: '12px', color: 'var(--color-text-main)', fontWeight: 600 }}>{referenceOf.get(p.id) || '—'}</td>
                                        <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(p.payment_date)}</td>
                                        <td className="d2-khmer" style={{ padding: '12px 20px', color: 'var(--color-text-main)' }}>{p.supplier?.name || '—'}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(p.amount)}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(0)}</td>
                                        <td style={{ padding: '12px 20px' }}>{statusChip(paymentStatus.get(p.id) || 'Draft')}</td>
                                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                <button onClick={() => setViewPayment(p)} title="View" style={{ background: 'rgba(99,102,241,0.08)', border: 'none', cursor: 'pointer', color: '#6366f1', padding: '6px', borderRadius: '6px' }}><Eye size={15} /></button>
                                                <button onClick={printList} title="Print" style={{ background: 'rgba(37,99,235,0.08)', border: 'none', cursor: 'pointer', color: '#2563eb', padding: '6px', borderRadius: '6px' }}><Printer size={15} /></button>
                                                <button onClick={() => handleDelete(p)} disabled={deletingId === p.id} title="Delete" style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: deletingId === p.id ? 'not-allowed' : 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px', opacity: deletingId === p.id ? 0.6 : 1 }}><XCircle size={15} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Record Payment — supplier-first form, applied oldest-bill-first */}
            <Modal isOpen={isPayOpen} onClose={() => !paySaving && setIsPayOpen(false)} title="Record Supplier Payment" width="640px">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label style={labelStyle}>Supplier <span style={{ color: '#ef4444' }}>*</span></label>
                        <select className="d2-khmer" value={paySupplierId} onChange={e => { setPaySupplierId(e.target.value); setAllocations({}); }} style={{ ...inputStyle, cursor: 'pointer' }}>
                            <option value="">Select supplier…</option>
                            {supplierOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                        <div>
                            <label style={labelStyle}>Payment date <span style={{ color: '#ef4444' }}>*</span></label>
                            <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                            <label style={labelStyle}>Amount <span style={{ color: '#ef4444' }}>*</span></label>
                            <input type="number" min="0.01" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} style={inputStyle} />
                        </div>
                    </div>
                    <div>
                        <label style={labelStyle}>Paid from <span style={{ color: '#ef4444' }}>*</span></label>
                        <select className="d2-khmer" value={payAccountId} onChange={e => setPayAccountId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            <option value="">Bank or cash account…</option>
                            {paymentAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}
                        </select>
                        {paymentAccounts.length === 0 && (
                            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                No cash or bank accounts in the Chart of Accounts yet — the payment saves without one.
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                        <div>
                            <label style={labelStyle}>Method</label>
                            <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="Bank transfer">Bank transfer</option>
                                <option value="Cash">Cash</option>
                                <option value="Cheque">Cheque</option>
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Reference</label>
                            <input type="text" placeholder="Cheque or transfer no." value={payReference} onChange={e => setPayReference(e.target.value)} style={inputStyle} />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                        <div>
                            <label style={labelStyle}>Currency</label>
                            <select value={payCurrency} onChange={e => { const c = e.target.value as 'USD' | 'KHR'; setPayCurrency(c); if (c === 'USD') setPayRate('1'); }} style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="USD">USD</option>
                                <option value="KHR">KHR</option>
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Exchange rate</label>
                            <input type="number" min="0" step="any" value={payRate} onChange={e => setPayRate(e.target.value)} style={inputStyle} />
                        </div>
                    </div>
                    {paySupplier && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <label style={{ ...labelStyle, marginBottom: 0 }}>Apply to bills</label>
                                <button
                                    type="button"
                                    onClick={fillOldestFirst}
                                    title="Spread the amount across the oldest bills first"
                                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 8px', borderRadius: '6px', border: 'none', background: 'transparent', color: '#4c5fd0', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    <Zap size={13} /> Oldest first
                                </button>
                            </div>
                            <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                                {payBills.map(po => (
                                    <div key={po.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '10px 14px', borderBottom: '1px solid var(--color-border)' }}>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}>{poShortId(po.id)}</div>
                                            <div className="d2-khmer" style={{ fontSize: '12px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {po.invoice_number || '—'} · due {String(po.payment_due_date || po.order_date || '').slice(0, 10) || '—'} · {po.outstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })} outstanding
                                            </div>
                                        </div>
                                        <input
                                            type="number" min="0" step="0.01" placeholder="0.00"
                                            value={allocations[po.id] ?? ''}
                                            onChange={e => setAllocations(prev => ({ ...prev, [po.id]: e.target.value }))}
                                            style={{ ...inputStyle, width: '120px', textAlign: 'right', flexShrink: 0 }}
                                        />
                                    </div>
                                ))}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--color-bg)', fontSize: '13px' }}>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>Applied <span style={{ fontWeight: 700, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{appliedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
                                    {/* On-account credit has no backing in the books — it must land on 0. */}
                                    <span style={{ color: Math.abs(onAccount) > 0.005 ? '#ef4444' : 'var(--color-text-secondary)' }}>
                                        On account <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{onAccount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div>
                        <label style={labelStyle}>Notes</label>
                        <textarea value={payNotes} onChange={e => setPayNotes(e.target.value)} style={{ ...inputStyle, minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '4px' }}>
                        <button onClick={() => setIsPayOpen(false)} disabled={paySaving} style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}>
                            Cancel
                        </button>
                        <button onClick={submitPayment} disabled={paySaving} style={{ padding: '10px 18px', borderRadius: '8px', border: 'none', background: '#4c5fd0', color: 'white', cursor: paySaving ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 600, opacity: paySaving ? 0.7 : 1 }}>
                            {paySaving ? 'Saving…' : 'Record payment'}
                        </button>
                    </div>
                </div>
            </Modal>

            {viewPayment && (
                <Modal isOpen={!!viewPayment} onClose={() => setViewPayment(null)} title="Supplier Payment" width="420px">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: '8px' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Reference</span>
                            <span style={{ fontWeight: 600 }}>{referenceOf.get(viewPayment.id) || '—'}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Date</span>
                            <span>{fmtDate(viewPayment.payment_date)}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Supplier</span>
                            <span className="d2-khmer">{viewPayment.supplier?.name || '—'}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Bill</span>
                            <span>{poById.get(viewPayment.purchase_order_id)?.invoice_number || poShortId(viewPayment.purchase_order_id)}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Method</span>
                            <span>{viewPayment.payment_method || '—'}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Status</span>
                            <span>{statusChip(paymentStatus.get(viewPayment.id) || 'Draft')}</span>
                            {viewPayment.notes && (
                                <>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>Notes</span>
                                    <span>{viewPayment.notes}</span>
                                </>
                            )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0', borderTop: '1px solid var(--color-border)' }}>
                            <span style={{ fontWeight: 700 }}>Amount</span>
                            <span style={{ fontWeight: 800, fontSize: '18px', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(viewPayment.amount)}</span>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default SupplierPaymentsPage;
