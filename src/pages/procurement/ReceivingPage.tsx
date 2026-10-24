// Goods Receipts — "stock arriving from suppliers": a ledger of every
// delivery already received, plus the entry point ("+ New Receipt") for
// receiving a pending order. There's no dedicated goods_receipts table in
// this data model — a "receipt" IS a Received purchase order, same relation
// Supplier Bills has to Received+invoiced ones. Reference ("GRN-...") and
// the received date are both derived, never stored, same tradeoff as
// Supplier Bills' and Supplier Payments' own display-only references.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Printer, Tag, RotateCcw, XCircle, Download, RefreshCw, PackageCheck } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useProcurement } from '../../hooks/useProcurement';
import { useAccounting } from '../../hooks/useAccounting';
import { supabase } from '../../lib/supabase';
import Modal from '../../components/Modal';
import type { PurchaseOrder } from '../../types';

const fmtUsd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const fmtDate = (d?: string | null) => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB') : '—';
const escapeHtml = (s: string): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const poShortId = (id: string) => `PO-${id.slice(0, 8).toUpperCase()}`;

type ReceiptStatus = 'Posted' | 'Draft';
const STATUS_CFG: Record<ReceiptStatus, { color: string; bg: string }> = {
    Draft: { color: '#92400e', bg: '#fef3c7' },
    Posted: { color: '#4c5fd0', bg: 'rgba(84, 105, 212, 0.12)' },
};
const statusChip = (status: ReceiptStatus) => (
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
  .meta { margin: 14px 0 18px; display: grid; grid-template-columns: 110px 1fr; row-gap: 5px; }
  .meta b { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #ccc; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { font-weight: 700; background: #fafafa; }
  .foot { margin-top: 22px; font-size: 11px; color: #888; }
`;

const ReceivingPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const navigate = useNavigate();
    const { currentUser, addStock, warehouses } = useStore();
    const { showToast } = useToast();
    const { purchaseOrders, isLoading, fetchPurchaseOrders, savePurchaseOrder } = useProcurement();
    const { journalEntries, fetchJournalEntries } = useAccounting();
    const isAdmin = currentUser?.roleId === 'admin';

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Goods Receipts</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Stock arriving from suppliers</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchPurchaseOrders();
        fetchJournalEntries();
    }, [fetchPurchaseOrders, fetchJournalEntries]);

    // This PO's receipt journal entry, by reference_id 'PO-'+id — same lookup
    // Supplier Bills uses for a bill's own Draft/Posted status, and here also
    // doubles as the best available proxy for "the day this was received"
    // (the PO row itself has no received-at column).
    const jeByPoId = useMemo(() => {
        const m = new Map<string, { id: string; status?: string; date: string }>();
        for (const je of journalEntries) {
            if (je.reference_id?.startsWith('PO-')) m.set(je.reference_id.slice(3), je as { id: string; status?: string; date: string });
        }
        return m;
    }, [journalEntries]);

    const receiptStatusOf = (po: PurchaseOrder): ReceiptStatus => {
        const je = jeByPoId.get(po.id);
        return (!je || (je.status || 'Posted') === 'Draft') ? 'Draft' : 'Posted';
    };
    const receiptDateOf = (po: PurchaseOrder): string => jeByPoId.get(po.id)?.date || po.order_date;

    const receipts = useMemo(() => purchaseOrders.filter(po => po.status === 'Received'), [purchaseOrders]);
    const warehouseName = warehouses[0]?.name || '—';

    // "GRN-YYYYMMDD-NNN", computed for display only — purchase_orders has no
    // receipt-reference column of its own, so this is derived fresh each
    // render: group by received date, number in creation order within that
    // day. Purely cosmetic, same accepted tradeoff as the other derived
    // references (Supplier Payments' PAY-..., nextBillNumber, etc).
    const referenceOf = useMemo(() => {
        const byDate = new Map<string, PurchaseOrder[]>();
        for (const po of receipts) {
            const day = receiptDateOf(po);
            const arr = byDate.get(day);
            if (arr) arr.push(po); else byDate.set(day, [po]);
        }
        const refs = new Map<string, string>();
        for (const [day, list] of byDate) {
            const ordered = [...list].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
            ordered.forEach((po, i) => refs.set(po.id, `GRN-${day.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`));
        }
        return refs;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [receipts, jeByPoId]);

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'All' | ReceiptStatus>('All');

    const filteredReceipts = useMemo(() => {
        const q = search.trim().toLowerCase();
        return receipts
            .filter(po => statusFilter === 'All' || receiptStatusOf(po) === statusFilter)
            .filter(po => {
                if (!q) return true;
                const ref = (referenceOf.get(po.id) || '').toLowerCase();
                const supplierName = (po.supplier?.name || '').toLowerCase();
                return ref.includes(q) || supplierName.includes(q);
            })
            .sort((a, b) => receiptDateOf(b).localeCompare(receiptDateOf(a)) || (b.created_at || '').localeCompare(a.created_at || ''));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [receipts, search, statusFilter, referenceOf, jeByPoId]);

    const hasActiveFilters = search !== '' || statusFilter !== 'All';

    // ── New Receipt: receive a still-pending order ──
    const pendingPOs = useMemo(
        () => purchaseOrders.filter(po => po.status !== 'Received' && po.status !== 'Cancelled')
            .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || '')),
        [purchaseOrders]
    );
    const [receiveTargetId, setReceiveTargetId] = useState('');
    const [isPicking, setIsPicking] = useState(false);
    const [receivingId, setReceivingId] = useState<string | null>(null);
    const processingIds = useRef<Set<string>>(new Set());

    const handleReceive = async (po: PurchaseOrder) => {
        if (processingIds.current.has(po.id)) return;
        processingIds.current.add(po.id);
        setReceivingId(po.id);
        try {
            // Idempotent per item: addStock throws on failure (the PO then
            // stays pending), so a retry must skip items whose restock
            // record already landed — otherwise their stock would double.
            if (po.items && po.items.length > 0) {
                const marker = `Received from PO-${po.id.substring(0, 8)}`;
                for (const item of po.items) {
                    if (!item.product_id) continue;
                    const { data: already } = await supabase.from('restocks')
                        .select('id').eq('product_id', item.product_id).like('note', `%${marker}%`).limit(1);
                    if (already && already.length > 0) continue;
                    await addStock(item.product_id, item.quantity, item.unit_price, marker, po.supplier?.name || '');
                }
            }
            await savePurchaseOrder({ ...po, status: 'Received' }, po.items || []);
            showToast(`${poShortId(po.id)} received successfully`, 'success');
            setIsPicking(false);
            setReceiveTargetId('');
            await fetchPurchaseOrders(true);
            await fetchJournalEntries();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Error receiving: ' + msg, 'error');
        } finally {
            processingIds.current.delete(po.id);
            setReceivingId(null);
        }
    };

    // ── Unpost (admin-only): flip a Posted receipt entry back to Draft ──
    const [unpostingId, setUnpostingId] = useState<string | null>(null);
    const handleUnpost = async (po: PurchaseOrder) => {
        const je = jeByPoId.get(po.id);
        if (!je) return;
        setUnpostingId(po.id);
        try {
            const { error } = await supabase.from('journal_entries').update({ status: 'Draft' }).eq('id', je.id);
            if (error) throw error;
            showToast('Receipt unposted', 'success');
            await fetchJournalEntries();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed to unpost: ' + msg, 'error');
        } finally {
            setUnpostingId(null);
        }
    };

    // ── Cancel: savePurchaseOrder's own 'Cancelled' path already reverses a
    // still-Draft receipt entry (and warns instead of touching a Posted
    // one) — see cancelPurchaseReceiptEntry in useProcurement.ts. ──
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    const handleCancel = async (po: PurchaseOrder) => {
        if (!confirm(`Cancel ${referenceOf.get(po.id) || poShortId(po.id)}? The delivery's inventory stays on the books — reverse it manually if needed.`)) return;
        setCancellingId(po.id);
        try {
            await savePurchaseOrder({ ...po, status: 'Cancelled' }, po.items || []);
            await fetchJournalEntries();
        } finally {
            setCancellingId(null);
        }
    };

    // ── View / Print ──
    const [viewPO, setViewPO] = useState<PurchaseOrder | null>(null);
    const printReceipt = (po: PurchaseOrder) => {
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) return;
        const rows = (po.items || []).map(item =>
            `<tr><td>${escapeHtml(item.product?.name || item.product_id)}</td><td class="num">${item.quantity}</td><td class="num">${fmtUsd(item.unit_price)}</td><td class="num">${fmtUsd(item.quantity * item.unit_price)}</td></tr>`
        ).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${referenceOf.get(po.id)}</title><style>${PRINT_CSS}</style></head><body>
        <h1>Goods Receipt ${escapeHtml(referenceOf.get(po.id) || poShortId(po.id))}</h1>
        <div class="meta">
            <span>Date</span><span>${fmtDate(receiptDateOf(po))}</span>
            <span>Supplier</span><b>${escapeHtml(po.supplier?.name || '—')}</b>
            <span>Warehouse</span><span>${escapeHtml(warehouseName)}</span>
            <span>Status</span><span>${receiptStatusOf(po)}</span>
        </div>
        <table><thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">Total</td><td class="num">${fmtUsd(po.total_amount)}</td></tr></tfoot></table>
        <div class="foot">Printed ${new Date().toLocaleString()}</div>
        </body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    const activeTable = () => ({
        name: 'Goods Receipts',
        columns: ['Reference', 'Date', 'Supplier', 'Warehouse', 'Lines', 'Total', 'Status'],
        rows: filteredReceipts.map(po => [
            referenceOf.get(po.id) || '—', fmtDate(receiptDateOf(po)), po.supplier?.name || '—',
            warehouseName, po.items?.length || 0, fmtUsd(po.total_amount), receiptStatusOf(po),
        ]),
    });

    const exportCsv = () => {
        const t = activeTable();
        const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = [t.columns, ...t.rows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `goods-receipts-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const printList = () => {
        const t = activeTable();
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) return;
        const body = t.rows.map(r => `<tr>${r.map((c, i) => `<td class="${i >= 4 && i <= 5 ? 'num' : ''}">${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${t.name}</title><style>${PRINT_CSS}</style></head><body>
        <h1>${t.name}</h1><p class="muted">${filteredReceipts.length} ${filteredReceipts.length === 1 ? 'receipt' : 'receipts'} · Printed ${new Date().toLocaleString()}</p>
        <table><thead><tr>${t.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
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
                    onClick={() => { setReceiveTargetId(pendingPOs[0]?.id || ''); setIsPicking(true); }}
                    disabled={pendingPOs.length === 0}
                    title={pendingPOs.length === 0 ? 'No pending orders to receive' : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '8px', border: 'none', background: pendingPOs.length === 0 ? 'var(--color-border)' : '#4c5fd0', color: 'white', fontSize: '14px', fontWeight: 600, cursor: pendingPOs.length === 0 ? 'not-allowed' : 'pointer' }}
                >
                    <Plus size={16} /> New Receipt
                </button>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '340px' }}>
                    <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input type="text" placeholder="Search reference or supplier ref…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: '34px' }} />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'All' | ReceiptStatus)} style={{ ...inputStyle, width: 'auto', minWidth: '140px', cursor: 'pointer' }}>
                    <option value="All">All statuses</option>
                    <option value="Posted">Posted</option>
                    <option value="Draft">Draft</option>
                </select>
                <button onClick={() => { fetchPurchaseOrders(); fetchJournalEntries(); }} title="Refresh" style={{ ...inputStyle, width: 'auto', padding: '10px', cursor: 'pointer', display: 'flex' }}>
                    <RefreshCw size={15} />
                </button>
                {hasActiveFilters && (
                    <button onClick={() => { setSearch(''); setStatusFilter('All'); }} style={{ padding: '8px 12px', borderRadius: '8px', fontSize: '13px', color: '#ef4444', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 500 }}>
                        Clear
                    </button>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button onClick={printList} disabled={isLoading || filteredReceipts.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (isLoading || filteredReceipts.length === 0) ? 0.5 : 1 }}>
                        <Printer size={13} /> Print list
                    </button>
                    <button onClick={exportCsv} disabled={isLoading || filteredReceipts.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (isLoading || filteredReceipts.length === 0) ? 0.5 : 1 }}>
                        <Download size={13} /> Export CSV
                    </button>
                </div>
            </div>

            <div style={{ background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                {isLoading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading receipts...</div>
                ) : filteredReceipts.length === 0 ? (
                    <div className="glass-panel" style={{ textAlign: 'center', padding: '60px', border: 'none' }}>
                        <PackageCheck size={40} color="var(--color-text-muted)" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                        <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '8px' }}>No goods receipts found</h3>
                        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            {hasActiveFilters ? 'Try adjusting your filters.' : 'Receive a pending order to get started.'}
                        </p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '760px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                    {['Reference', 'Date', 'Supplier', 'Warehouse', 'Lines', 'Total', 'Status', ''].map((h, i) => (
                                        <th key={h || 'actions'} style={{ padding: '12px 20px', textAlign: i === 4 || i === 5 ? 'right' : 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredReceipts.map(po => {
                                    const status = receiptStatusOf(po);
                                    return (
                                        <tr key={po.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '12px 20px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--color-text-main)', fontWeight: 600 }}>{referenceOf.get(po.id) || '—'}</td>
                                            <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(receiptDateOf(po))}</td>
                                            <td className="d2-khmer" style={{ padding: '12px 20px', color: 'var(--color-text-main)' }}>{po.supplier?.name || '—'}</td>
                                            <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)' }}>{warehouseName}</td>
                                            <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{po.items?.length || 0}</td>
                                            <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(po.total_amount)}</td>
                                            <td style={{ padding: '12px 20px' }}>{statusChip(status)}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                    <button onClick={() => setViewPO(po)} title="View" style={{ background: 'rgba(99,102,241,0.08)', border: 'none', cursor: 'pointer', color: '#6366f1', padding: '6px', borderRadius: '6px' }}><Eye size={15} /></button>
                                                    <button onClick={() => printReceipt(po)} title="Print" style={{ background: 'rgba(37,99,235,0.08)', border: 'none', cursor: 'pointer', color: '#2563eb', padding: '6px', borderRadius: '6px' }}><Printer size={15} /></button>
                                                    {!po.invoice_number && (
                                                        <button onClick={() => navigate('/procurement/supplier-bills')} title="Bill this delivery" style={{ background: 'rgba(16,185,129,0.1)', border: 'none', cursor: 'pointer', color: '#10b981', padding: '6px', borderRadius: '6px' }}><Tag size={15} /></button>
                                                    )}
                                                    {status === 'Posted' && isAdmin && (
                                                        <button onClick={() => handleUnpost(po)} disabled={unpostingId === po.id} title="Unpost" style={{ background: 'rgba(245,158,11,0.1)', border: 'none', cursor: unpostingId === po.id ? 'not-allowed' : 'pointer', color: '#f59e0b', padding: '6px', borderRadius: '6px', opacity: unpostingId === po.id ? 0.6 : 1 }}><RotateCcw size={15} /></button>
                                                    )}
                                                    <button onClick={() => handleCancel(po)} disabled={cancellingId === po.id} title="Cancel" style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: cancellingId === po.id ? 'not-allowed' : 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px', opacity: cancellingId === po.id ? 0.6 : 1 }}><XCircle size={15} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* New Receipt: pick a pending order, then receive it */}
            {isPicking && (
                <div onClick={() => { setIsPicking(false); setReceiveTargetId(''); }} style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div onClick={e => e.stopPropagation()} className="glass-panel" style={{ background: 'var(--color-surface)', borderRadius: '16px', width: '100%', maxWidth: '420px', padding: '24px' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 14px', color: 'var(--color-text-main)' }}>Which order arrived?</h3>
                        <label style={labelStyle}>Purchase Order</label>
                        <select value={receiveTargetId} onChange={e => setReceiveTargetId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            {pendingPOs.map(po => (
                                <option key={po.id} value={po.id}>
                                    {poShortId(po.id)} · {po.supplier?.name || '—'} · {fmtUsd(po.total_amount)} · {po.items?.length || 0} line{po.items?.length === 1 ? '' : 's'}
                                </option>
                            ))}
                        </select>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                            <button onClick={() => { setIsPicking(false); setReceiveTargetId(''); }} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                                Cancel
                            </button>
                            <button
                                onClick={() => { const po = purchaseOrders.find(p => p.id === receiveTargetId); if (po) handleReceive(po); }}
                                disabled={!receiveTargetId || receivingId === receiveTargetId}
                                style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#4c5fd0', color: 'white', fontSize: '13px', fontWeight: 600, cursor: (!receiveTargetId || receivingId === receiveTargetId) ? 'not-allowed' : 'pointer', opacity: (!receiveTargetId || receivingId === receiveTargetId) ? 0.6 : 1 }}
                            >
                                {receivingId === receiveTargetId ? 'Receiving…' : 'Receive'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {viewPO && (
                <Modal isOpen={!!viewPO} onClose={() => setViewPO(null)} title="Goods Receipt" width="520px">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: '8px' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Reference</span>
                            <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{referenceOf.get(viewPO.id) || '—'}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Date</span>
                            <span>{fmtDate(receiptDateOf(viewPO))}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Supplier</span>
                            <span className="d2-khmer">{viewPO.supplier?.name || '—'}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Warehouse</span>
                            <span>{warehouseName}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Status</span>
                            <span>{statusChip(receiptStatusOf(viewPO))}</span>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <th style={{ textAlign: 'left', padding: '6px 0', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Item</th>
                                    <th style={{ textAlign: 'right', padding: '6px 0', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Qty</th>
                                    <th style={{ textAlign: 'right', padding: '6px 0', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(viewPO.items || []).map((item, i) => (
                                    <tr key={item.id || i}>
                                        <td className="d2-khmer" style={{ padding: '6px 0', color: 'var(--color-text-main)' }}>{item.product?.name || item.product_id}</td>
                                        <td style={{ padding: '6px 0', textAlign: 'right' }}>{item.quantity}</td>
                                        <td style={{ padding: '6px 0', textAlign: 'right' }}>{fmtUsd(item.quantity * item.unit_price)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0', borderTop: '1px solid var(--color-border)' }}>
                            <span style={{ fontWeight: 700 }}>Total</span>
                            <span style={{ fontWeight: 800, fontSize: '18px', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(viewPO.total_amount)}</span>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default ReceivingPage;
