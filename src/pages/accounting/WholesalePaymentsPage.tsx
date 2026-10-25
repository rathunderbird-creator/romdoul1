// Wholesale Payments — "money collected, and which order it settled": a flat,
// read-only ledger of every customer_payments row, independent of which
// wholesale order each one happened to settle. Recording a payment here still
// requires picking which outstanding order it's for, via a small picker step
// before the shared RecordCustomerPaymentModal opens (mirror of Supplier
// Payments on the purchasing side).
import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Eye, Printer, XCircle, Download, RefreshCw, Receipt } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useWholesale } from '../../hooks/useWholesale';
import { useAccounting } from '../../hooks/useAccounting';
import { supabase } from '../../lib/supabase';
import { RecordCustomerPaymentModal } from '../../components';
import Modal from '../../components/Modal';
import type { CustomerPayment } from '../../types';

const fmtUsd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const fmtDate = (d?: string | null) => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB') : '—';
const escapeHtml = (s: string): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const woShortId = (id: string) => `WO-${id.slice(0, 8).toUpperCase()}`;

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

const WholesalePaymentsPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const {
        wholesaleOrders, customerPayments, isLoading,
        fetchWholesaleOrders, fetchCustomerPayments,
        recordCustomerPayment, deleteCustomerPayment,
    } = useWholesale();
    const { journalEntries, fetchJournalEntries } = useAccounting();

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Wholesale Payment</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Money collected, and which order it settled</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchWholesaleOrders();
        fetchCustomerPayments();
        fetchJournalEntries();
    }, [fetchWholesaleOrders, fetchCustomerPayments, fetchJournalEntries]);

    const orderById = useMemo(() => new Map(wholesaleOrders.map(o => [o.id, o])), [wholesaleOrders]);

    // Every payment's own posting status: recordCustomerPayment tags its
    // transaction with a "#WSP-<payment id's first 8 chars>" marker in the
    // description, and the journal entry it posts carries reference_id
    // 'TX-'+that transaction's id — no direct FK links a payment to its
    // entry, so the marker is the only way back to it (same trick
    // deleteCustomerPayment already uses to find what to clean up).
    const [paymentStatus, setPaymentStatus] = useState<Map<string, PayStatus>>(new Map());
    useEffect(() => {
        let alive = true;
        (async () => {
            if (customerPayments.length === 0) { setPaymentStatus(new Map()); return; }
            const { data: txs } = await supabase.from('transactions').select('id, description').like('description', '%#WSP-%');
            if (!alive) return;
            const entryByRef = new Map(journalEntries.map(e => [e.reference_id, e]));
            const next = new Map<string, PayStatus>();
            for (const p of customerPayments) {
                const marker = `#WSP-${p.id.slice(0, 8)}`;
                const tx = (txs || []).find(t => (t.description || '').includes(marker));
                const entry = tx ? entryByRef.get('TX-' + tx.id) : undefined;
                next.set(p.id, entry ? ((entry.status || 'Posted') === 'Draft' ? 'Draft' : 'Posted') : 'Draft');
            }
            setPaymentStatus(next);
        })();
        return () => { alive = false; };
    }, [customerPayments, journalEntries]);

    // "WPY-YYYYMMDD-NNN", computed for display only — customer_payments has
    // no reference column of its own, so this is derived fresh each render:
    // group by payment_date, number in creation order within that day.
    // Purely cosmetic, same accepted tradeoff as nextBillNumber/referenceOf
    // on Supplier Payments.
    const referenceOf = useMemo(() => {
        const byDate = new Map<string, CustomerPayment[]>();
        for (const p of customerPayments) {
            const day = String(p.payment_date || '').slice(0, 10);
            const arr = byDate.get(day);
            if (arr) arr.push(p); else byDate.set(day, [p]);
        }
        const refs = new Map<string, string>();
        for (const [day, list] of byDate) {
            const ordered = [...list].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
            ordered.forEach((p, i) => refs.set(p.id, `WPY-${day.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`));
        }
        return refs;
    }, [customerPayments]);

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'All' | PayStatus>('All');

    const filteredPayments = useMemo(() => {
        const q = search.trim().toLowerCase();
        return customerPayments
            .filter(p => {
                if (statusFilter === 'All') return true;
                return (paymentStatus.get(p.id) || 'Draft') === statusFilter;
            })
            .filter(p => {
                if (!q) return true;
                const ref = (referenceOf.get(p.id) || '').toLowerCase();
                const customerName = (p.wholesale_order?.customer_name || '').toLowerCase();
                return ref.includes(q) || customerName.includes(q);
            })
            .sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || '') || (b.created_at || '').localeCompare(a.created_at || ''));
    }, [customerPayments, search, statusFilter, paymentStatus, referenceOf]);

    const hasActiveFilters = search !== '' || statusFilter !== 'All';

    // ── Record Payment: pick an outstanding order, then the shared modal ──
    const payableOrders = useMemo(
        () => wholesaleOrders
            .filter(o => o.status !== 'Cancelled' && ((o.total_amount || 0) - (o.amount_paid || 0)) > 0.005)
            .sort((a, b) => (b.due_date || b.order_date || '').localeCompare(a.due_date || a.order_date || '')),
        [wholesaleOrders]
    );
    const [payTargetId, setPayTargetId] = useState('');
    const [isPicking, setIsPicking] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const payTarget = payTargetId ? orderById.get(payTargetId) : undefined;
    const payTargetOutstanding = payTarget ? (payTarget.total_amount || 0) - (payTarget.amount_paid || 0) : 0;
    const closePayFlow = () => { setIsPicking(false); setIsPaymentModalOpen(false); setPayTargetId(''); };

    const handleConfirmPayment = async (data: { amount: number; paymentDate: string; paymentMethod: string; receivedInAccountId?: string; receivedInAccountName?: string; notes?: string }) => {
        if (!payTarget) return;
        try {
            await recordCustomerPayment(payTarget.id, data.amount, data.paymentMethod, data.notes || '', data.paymentDate, undefined, data.receivedInAccountId, data.receivedInAccountName);
            closePayFlow();
        } catch {
            // toast handled in hook
        }
    };

    // ── View / Delete ──
    const [viewPayment, setViewPayment] = useState<CustomerPayment | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const handleDelete = async (p: CustomerPayment) => {
        if (!confirm(`Delete ${referenceOf.get(p.id) || 'this payment'}? The order it settled goes back to its previous balance.`)) return;
        setDeletingId(p.id);
        try {
            await deleteCustomerPayment(p.id);
            if (viewPayment?.id === p.id) setViewPayment(null);
        } finally {
            setDeletingId(null);
        }
    };

    // ── Export / print: one flat table, shared by CSV and Print ──
    const activeTable = () => {
        const money = (n: number) => fmtUsd(n);
        return {
            name: 'Wholesale Payments',
            columns: ['Reference', 'Date', 'Customer', 'Order', 'Amount', 'Unapplied', 'Status'],
            rows: filteredPayments.map(p => [
                referenceOf.get(p.id) || '—',
                fmtDate(p.payment_date),
                p.wholesale_order?.customer_name || '—',
                p.wholesale_order?.invoice_number || woShortId(p.wholesale_order_id),
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
        a.download = `wholesale-payments-${new Date().toISOString().slice(0, 10)}.csv`;
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
                    onClick={() => { setPayTargetId(payableOrders[0]?.id || ''); setIsPicking(true); }}
                    disabled={payableOrders.length === 0}
                    title={payableOrders.length === 0 ? 'No outstanding orders to collect on' : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '8px', border: 'none', background: payableOrders.length === 0 ? 'var(--color-border)' : '#4c5fd0', color: 'white', fontSize: '14px', fontWeight: 600, cursor: payableOrders.length === 0 ? 'not-allowed' : 'pointer' }}
                >
                    <Plus size={16} /> Record Payment
                </button>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '340px' }}>
                    <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input type="text" placeholder="Search reference or customer…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: '34px' }} />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'All' | PayStatus)} style={{ ...inputStyle, width: 'auto', minWidth: '140px', cursor: 'pointer' }}>
                    <option value="All">All statuses</option>
                    <option value="Posted">Posted</option>
                    <option value="Draft">Draft</option>
                </select>
                <button onClick={() => { fetchCustomerPayments(); fetchJournalEntries(); }} title="Refresh" style={{ ...inputStyle, width: 'auto', padding: '10px', cursor: 'pointer', display: 'flex' }}>
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
                            {hasActiveFilters ? 'Try adjusting your filters.' : 'Record a payment against an outstanding order to get started.'}
                        </p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '720px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                    {['Reference', 'Date', 'Customer', 'Amount', 'Unapplied', 'Status', ''].map((h, i) => (
                                        <th key={h || 'actions'} style={{ padding: '12px 20px', textAlign: i === 3 || i === 4 ? 'right' : 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPayments.map(p => (
                                    <tr key={p.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '12px 20px', fontSize: '12px', color: 'var(--color-text-main)', fontWeight: 600 }}>{referenceOf.get(p.id) || '—'}</td>
                                        <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(p.payment_date)}</td>
                                        <td className="d2-khmer" style={{ padding: '12px 20px', color: 'var(--color-text-main)' }}>{p.wholesale_order?.customer_name || '—'}</td>
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

            {/* Record Payment, step 1: pick which outstanding order it's for */}
            {isPicking && (
                <div onClick={closePayFlow} style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div onClick={e => e.stopPropagation()} className="glass-panel" style={{ background: 'var(--color-surface)', borderRadius: '16px', width: '100%', maxWidth: '420px', padding: '24px' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 14px', color: 'var(--color-text-main)' }}>Which order is this payment for?</h3>
                        <label style={labelStyle}>Order</label>
                        <select value={payTargetId} onChange={e => setPayTargetId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            {payableOrders.map(o => (
                                <option key={o.id} value={o.id}>
                                    {o.invoice_number || woShortId(o.id)} · {o.customer_name || '—'} · {fmtUsd((o.total_amount || 0) - (o.amount_paid || 0))} outstanding
                                </option>
                            ))}
                        </select>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                            <button onClick={closePayFlow} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                                Cancel
                            </button>
                            <button
                                onClick={() => { setIsPicking(false); setIsPaymentModalOpen(true); }}
                                disabled={!payTargetId}
                                style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#4c5fd0', color: 'white', fontSize: '13px', fontWeight: 600, cursor: payTargetId ? 'pointer' : 'not-allowed', opacity: payTargetId ? 1 : 0.6 }}
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Record Payment, step 2: the shared amount/date/method form */}
            {isPaymentModalOpen && payTarget && (
                <RecordCustomerPaymentModal
                    isOpen={isPaymentModalOpen}
                    onClose={closePayFlow}
                    onConfirm={handleConfirmPayment}
                    remainingBalance={payTargetOutstanding}
                    customerName={payTarget.customer_name}
                />
            )}

            {viewPayment && (
                <Modal isOpen={!!viewPayment} onClose={() => setViewPayment(null)} title="Wholesale Payment" width="420px">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: '8px' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Reference</span>
                            <span style={{ fontWeight: 600 }}>{referenceOf.get(viewPayment.id) || '—'}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Date</span>
                            <span>{fmtDate(viewPayment.payment_date)}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Customer</span>
                            <span className="d2-khmer">{viewPayment.wholesale_order?.customer_name || '—'}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Order</span>
                            <span>{viewPayment.wholesale_order?.invoice_number || woShortId(viewPayment.wholesale_order_id)}</span>
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

export default WholesalePaymentsPage;
