// Purchase Reports — three views over the same purchase-order ledger this
// app already treats as "bills" (a Received PO with an invoice_number):
// AP Aging (who we owe and how overdue), Supplier Statement (one supplier's
// bill/payment history with a running balance, mirroring the General
// Ledger's per-account card), and Open Orders (what's still to arrive —
// Draft/Sent POs that haven't been received yet).
//
// There's no stored supplier "code" in this app's data model — SUP001-style
// codes are derived here, numbered by each supplier's creation order.
// Likewise there's no stored "credit balance" concept; the Credit column is
// derived defensively from any bill where amount_paid exceeds total_amount
// (an overpayment), which the Total column then nets back out.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, FileText, PackageSearch, RefreshCw, Printer, Download } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useProcurement } from '../../hooks/useProcurement';
import { useMobile } from '../../hooks/useMobile';
import { dayKeyFromDate } from '../../utils/dateRange';
import type { PurchaseOrder } from '../../types';

type TabKey = 'aging' | 'statement' | 'open';
const TABS: { key: TabKey; label: string; icon: typeof Clock }[] = [
    { key: 'aging', label: 'AP Aging', icon: Clock },
    { key: 'statement', label: 'Supplier Statement', icon: FileText },
    { key: 'open', label: 'Open Orders', icon: PackageSearch },
];

const BLUE = '#5469d4', RED = '#DC2626';
const fmt = (n: number): string => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cellText = (n: number): string => (Math.abs(n) < 0.005 ? '—' : fmt(n));
const todayYmd = (): string => dayKeyFromDate(new Date());
const outstandingOf = (po: PurchaseOrder): number => (po.total_amount || 0) - (po.amount_paid || 0);
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const poRef = (po: PurchaseOrder): string => po.invoice_number || `PO-${po.id.slice(0, 8).toUpperCase()}`;

const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' };
const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px',
    border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' };
const inputStyle: React.CSSProperties = {
    padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
    fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)'
};
const refBadgeStyle: React.CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: '6px', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', fontSize: '11px', whiteSpace: 'nowrap' };

const PurchaseReportsPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { suppliers, purchaseOrders, supplierPayments, isLoading, fetchSuppliers, fetchPurchaseOrders, fetchSupplierPayments } = useProcurement();
    const [tab, setTab] = useState<TabKey>('aging');
    const isMobile = useMobile();

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Purchase Reports</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', margin: 0 }}>What we owe, and what is still to arrive</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const reload = useCallback(() => { fetchSuppliers(); fetchPurchaseOrders(); fetchSupplierPayments(); }, [fetchSuppliers, fetchPurchaseOrders, fetchSupplierPayments]);
    useEffect(() => { reload(); }, [reload]);

    // Every "bill" in this app is a received PO with an invoice number.
    const bills = useMemo(() => purchaseOrders.filter(po => po.status === 'Received' && !!po.invoice_number), [purchaseOrders]);
    const openOrders = useMemo(() => purchaseOrders.filter(po => po.status === 'Draft' || po.status === 'Sent'), [purchaseOrders]);

    // SUP001, SUP002, ... in creation order — not a stored field.
    const supplierCodes = useMemo(() => {
        const sorted = [...suppliers].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id));
        const map = new Map<string, string>();
        sorted.forEach((s, i) => map.set(s.id, `SUP${String(i + 1).padStart(3, '0')}`));
        return map;
    }, [suppliers]);

    // ── AP Aging ──
    const [asAt, setAsAt] = useState<string>(() => todayYmd());
    const daysOverdueAsOf = useCallback((due: string | null | undefined, asOf: string): number | null => {
        if (!due) return null;
        const d = new Date(due + 'T00:00:00');
        const a = new Date(asOf + 'T00:00:00');
        return Math.round((a.getTime() - d.getTime()) / 86400000);
    }, []);

    const aging = useMemo(() => {
        const bySupplier = new Map<string, { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; credit: number }>();
        for (const po of bills) {
            const out = outstandingOf(po);
            if (Math.abs(out) < 0.005) continue;
            const entry = bySupplier.get(po.supplier_id) || { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, credit: 0 };
            if (out < 0) {
                entry.credit += -out;
            } else {
                const od = daysOverdueAsOf(po.payment_due_date, asAt);
                if (od === null || od <= 0) entry.current += out;
                else if (od <= 30) entry.d1_30 += out;
                else if (od <= 60) entry.d31_60 += out;
                else if (od <= 90) entry.d61_90 += out;
                else entry.d90plus += out;
            }
            bySupplier.set(po.supplier_id, entry);
        }
        const rows = Array.from(bySupplier.entries()).map(([supplierId, b]) => {
            const supplier = suppliers.find(s => s.id === supplierId);
            const total = b.current + b.d1_30 + b.d31_60 + b.d61_90 + b.d90plus - b.credit;
            return { supplierId, supplierName: supplier?.name || 'Unknown supplier', code: supplierCodes.get(supplierId) || '—', ...b, total };
        }).sort((a, b) => a.code.localeCompare(b.code));
        const totals = rows.reduce((t, r) => ({
            current: t.current + r.current, d1_30: t.d1_30 + r.d1_30, d31_60: t.d31_60 + r.d31_60,
            d61_90: t.d61_90 + r.d61_90, d90plus: t.d90plus + r.d90plus, credit: t.credit + r.credit, total: t.total + r.total,
        }), { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, credit: 0, total: 0 });
        return { rows, totals };
    }, [bills, suppliers, asAt, daysOverdueAsOf, supplierCodes]);

    // ── Supplier Statement ──
    const [statementSupplierId, setStatementSupplierId] = useState('');
    const [statementFrom, setStatementFrom] = useState('');
    const [statementTo, setStatementTo] = useState('');

    const statementEntries = useMemo(() => {
        if (!statementSupplierId) return [];
        type Entry = { date: string; ref: string; description: string; amount: number };
        const entries: Entry[] = [];
        for (const po of bills) {
            if (po.supplier_id !== statementSupplierId) continue;
            entries.push({ date: po.order_date, ref: poRef(po), description: `Bill${po.invoice_number ? ` · ${po.invoice_number}` : ''}`, amount: po.total_amount || 0 });
        }
        for (const p of supplierPayments) {
            if (p.supplier_id !== statementSupplierId) continue;
            entries.push({ date: p.payment_date, ref: `PAY-${p.id.slice(0, 8).toUpperCase()}`, description: `Payment${p.payment_method ? ` · ${p.payment_method}` : ''}`, amount: -(p.amount || 0) });
        }
        entries.sort((a, b) => a.date.localeCompare(b.date));
        return entries;
    }, [bills, supplierPayments, statementSupplierId]);

    const statement = useMemo(() => {
        const opening = statementEntries.filter(e => statementFrom && e.date < statementFrom).reduce((s, e) => s + e.amount, 0);
        const inRange = statementEntries.filter(e => (!statementFrom || e.date >= statementFrom) && (!statementTo || e.date <= statementTo));
        let running = opening;
        const rows = inRange.map(e => { running += e.amount; return { ...e, balance: running }; });
        return { opening, rows, closing: running };
    }, [statementEntries, statementFrom, statementTo]);

    const statementSupplier = suppliers.find(s => s.id === statementSupplierId);

    const loading = isLoading;

    // ── Export / print: one flat table per tab ──
    const activeTable = (): { name: string; columns: string[]; rows: (string | number)[][] } => {
        if (tab === 'aging') {
            return {
                name: 'AP Aging', columns: ['Supplier', 'Code', 'Current', '1-30', '31-60', '61-90', '90+', 'Credit', 'Total'],
                rows: aging.rows.map(r => [r.supplierName, r.code, cellText(r.current), cellText(r.d1_30), cellText(r.d31_60), cellText(r.d61_90), cellText(r.d90plus), cellText(r.credit), fmt(r.total)]),
            };
        }
        if (tab === 'statement') {
            return {
                name: `Supplier Statement${statementSupplier ? ` - ${statementSupplier.name}` : ''}`,
                columns: ['Date', 'Reference', 'Description', 'Amount', 'Balance'],
                rows: statement.rows.map(r => [r.date, r.ref, r.description, fmt(r.amount), fmt(r.balance)]),
            };
        }
        return {
            name: 'Open Orders', columns: ['Reference', 'Supplier', 'Order Date', 'Expected Delivery', 'Status', 'Total'],
            rows: openOrders.map(po => [poRef(po), suppliers.find(s => s.id === po.supplier_id)?.name || 'Unknown supplier', po.order_date, po.expected_delivery_date || '—', po.status, fmt(po.total_amount || 0)]),
        };
    };

    const exportCsv = () => {
        const t = activeTable();
        const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = [t.columns, ...t.rows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${todayYmd()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const printList = () => {
        const t = activeTable();
        const w = window.open('', '_blank', 'width=1000,height=700');
        if (!w) return;
        const body = t.rows.map(r => `<tr>${r.map((c, i) => `<td style="text-align:${i >= 2 && tab !== 'statement' ? 'right' : i >= 3 ? 'right' : 'left'}">${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${t.name}</title><style>
            body{font-family:Segoe UI,Arial,sans-serif;color:#1a1f36;padding:28px}
            h1{font-size:20px;margin:0}p{color:#64748b;margin:4px 0 20px;font-size:13px}
            table{width:100%;border-collapse:collapse;font-size:13px}
            th{font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #cbd5e1;padding:8px;text-align:left}
            td{padding:7px 8px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums}
        </style></head><body><h1>${t.name}</h1><p>All figures are in USD.</p>
        <table><thead><tr>${t.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    return (
        <div style={isMobile ? { display: 'flex', flexDirection: 'column', gap: '20px' } : { display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
            <div className="acct-page" style={{ flex: isMobile ? undefined : '6 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {/* Tabs */}
                <div style={{ display: 'flex', gap: '4px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '4px', flexWrap: 'wrap', alignSelf: 'flex-start' }}>
                    {TABS.map(({ key, label, icon: Icon }) => (
                        <button key={key} onClick={() => setTab(key)} style={{
                            display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 16px', borderRadius: '9px', border: 'none',
                            background: tab === key ? 'var(--color-surface)' : 'transparent',
                            color: tab === key ? BLUE : 'var(--color-text-secondary)',
                            fontWeight: tab === key ? 700 : 500, fontSize: '13px', cursor: 'pointer',
                            boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.15s',
                        }}>
                            <Icon size={15} /> {label}
                        </button>
                    ))}
                </div>

                {tab === 'aging' && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', flexWrap: 'wrap' }}>
                            <div>
                                <label style={labelStyle}>As at</label>
                                <input type="date" value={asAt} onChange={e => setAsAt(e.target.value)} style={inputStyle} />
                            </div>
                            <button onClick={reload} title="Reload" style={{ ...btnStyle, padding: '9px 10px' }}>
                                <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
                            </button>
                            <button onClick={printList} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.5 : 1 }}><Printer size={14} /> Print list</button>
                            <button onClick={exportCsv} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.5 : 1 }}><Download size={14} /> Export CSV</button>
                            <button disabled title="Coming soon" style={{ ...btnStyle, opacity: 0.4, cursor: 'not-allowed' }}><FileText size={14} /> Print for approval</button>
                            <button disabled title="Coming soon" style={{ ...btnStyle, opacity: 0.4, cursor: 'not-allowed' }}><Download size={14} style={{ transform: 'rotate(180deg)' }} /> Request payment</button>
                        </div>

                        <div style={cardStyle}>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Supplier</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Current</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>1–30</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>31–60</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>61–90</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>90+</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Credit</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loading ? (
                                            <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading…</td></tr>
                                        ) : aging.rows.length === 0 ? (
                                            <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No outstanding bills.</td></tr>
                                        ) : aging.rows.map(r => (
                                            <tr key={r.supplierId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <td style={{ padding: '12px 20px' }}>
                                                    <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{r.supplierName}</div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{r.code}</div>
                                                </td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cellText(r.current)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cellText(r.d1_30)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cellText(r.d31_60)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cellText(r.d61_90)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.d90plus > 0.005 ? RED : 'var(--color-text-main)' }}>{cellText(r.d90plus)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: BLUE }}>{cellText(r.credit)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>USD {fmt(r.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    {!loading && aging.rows.length > 0 && (
                                        <tfoot>
                                            <tr style={{ background: 'var(--color-bg)' }}>
                                                <td style={{ padding: '12px 20px', fontWeight: 700 }}>Total · USD</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{cellText(aging.totals.current)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{cellText(aging.totals.d1_30)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{cellText(aging.totals.d31_60)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{cellText(aging.totals.d61_90)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{cellText(aging.totals.d90plus)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: BLUE }}>{cellText(aging.totals.credit)}</td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(aging.totals.total)}</td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        </div>
                    </>
                )}

                {tab === 'statement' && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', flexWrap: 'wrap' }}>
                            <div>
                                <label style={labelStyle}>Supplier</label>
                                <select value={statementSupplierId} onChange={e => setStatementSupplierId(e.target.value)} style={{ ...inputStyle, maxWidth: '260px', cursor: 'pointer' }}>
                                    <option value="">Select a supplier…</option>
                                    {[...suppliers].sort((a, b) => (supplierCodes.get(a.id) || '').localeCompare(supplierCodes.get(b.id) || '')).map(s => (
                                        <option key={s.id} value={s.id}>{supplierCodes.get(s.id)} · {s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>From</label>
                                <input type="date" value={statementFrom} onChange={e => setStatementFrom(e.target.value)} style={inputStyle} />
                            </div>
                            <div>
                                <label style={labelStyle}>To</label>
                                <input type="date" value={statementTo} onChange={e => setStatementTo(e.target.value)} style={inputStyle} />
                            </div>
                            <button onClick={reload} title="Reload" style={{ ...btnStyle, padding: '9px 10px' }}>
                                <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
                            </button>
                            <button onClick={printList} disabled={loading || !statementSupplierId} style={{ ...btnStyle, opacity: loading || !statementSupplierId ? 0.5 : 1 }}><Printer size={14} /> Print list</button>
                            <button onClick={exportCsv} disabled={loading || !statementSupplierId} style={{ ...btnStyle, opacity: loading || !statementSupplierId ? 0.5 : 1 }}><Download size={14} /> Export CSV</button>
                        </div>

                        {!statementSupplierId ? (
                            <div style={{ ...cardStyle, padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                Pick a supplier above to see their statement.
                            </div>
                        ) : (
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '14px 20px', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>{statementSupplier?.name}</span>
                                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{supplierCodes.get(statementSupplierId)}</span>
                                    </div>
                                    <span style={{ fontSize: '13px', fontWeight: 600 }}>
                                        Closing balance: <strong style={{ color: statement.closing < -0.005 ? BLUE : 'var(--color-text-main)' }}>{fmt(statement.closing)}</strong>
                                    </span>
                                </div>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Date</th>
                                                <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Reference</th>
                                                <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Description</th>
                                                <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Amount</th>
                                                <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Balance</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <td style={{ padding: '10px 20px', fontStyle: 'italic', color: 'var(--color-text-muted)' }}>Opening balance</td>
                                                <td></td><td></td><td></td>
                                                <td style={{ padding: '10px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: statement.opening < -0.005 ? BLUE : 'var(--color-text-secondary)' }}>{fmt(statement.opening)}</td>
                                            </tr>
                                            {statement.rows.map((r, i) => (
                                                <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                    <td style={{ padding: '10px 20px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{r.date}</td>
                                                    <td style={{ padding: '10px 20px', whiteSpace: 'nowrap' }}><span style={refBadgeStyle}>{r.ref}</span></td>
                                                    <td style={{ padding: '10px 20px', color: 'var(--color-text-main)' }}>{r.description}</td>
                                                    <td style={{ padding: '10px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.amount < 0 ? BLUE : 'var(--color-text-main)' }}>{r.amount < 0 ? `(${fmt(-r.amount)})` : fmt(r.amount)}</td>
                                                    <td style={{ padding: '10px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.balance < -0.005 ? BLUE : 'var(--color-text-main)' }}>{fmt(r.balance)}</td>
                                                </tr>
                                            ))}
                                            {statement.rows.length === 0 && (
                                                <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No activity in this range.</td></tr>
                                            )}
                                            <tr style={{ background: 'var(--color-bg)' }}>
                                                <td style={{ padding: '10px 20px', fontWeight: 700, color: 'var(--color-text-main)' }}>Closing balance</td>
                                                <td></td><td></td><td></td>
                                                <td style={{ padding: '10px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: statement.closing < -0.005 ? BLUE : 'var(--color-text-main)' }}>{fmt(statement.closing)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {tab === 'open' && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                            <button onClick={reload} title="Reload" style={{ ...btnStyle, padding: '9px 10px' }}>
                                <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
                            </button>
                            <button onClick={printList} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.5 : 1 }}><Printer size={14} /> Print list</button>
                            <button onClick={exportCsv} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.5 : 1 }}><Download size={14} /> Export CSV</button>
                        </div>

                        <div style={cardStyle}>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Reference</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Supplier</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Order Date</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Expected Delivery</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Status</th>
                                            <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loading ? (
                                            <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading…</td></tr>
                                        ) : openOrders.length === 0 ? (
                                            <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No open orders — everything has arrived.</td></tr>
                                        ) : openOrders.map(po => (
                                            <tr key={po.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <td style={{ padding: '12px 20px' }}><span style={refBadgeStyle}>{poRef(po)}</span></td>
                                                <td style={{ padding: '12px 20px', color: 'var(--color-text-main)' }}>{suppliers.find(s => s.id === po.supplier_id)?.name || 'Unknown supplier'}</td>
                                                <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{po.order_date}</td>
                                                <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{po.expected_delivery_date || '—'}</td>
                                                <td style={{ padding: '12px 20px' }}>
                                                    <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px', background: po.status === 'Sent' ? 'rgba(59,130,246,0.12)' : 'var(--color-bg)', color: po.status === 'Sent' ? '#3B82F6' : 'var(--color-text-secondary)' }}>{po.status}</span>
                                                </td>
                                                <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(po.total_amount || 0)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Reserved for future widgets — intentionally empty, and left
                out entirely on mobile since there's nothing in it to show. */}
            {!isMobile && (
                <>
                    <div style={{ flex: '1 1 0' }} />
                    <div style={{ flex: '1 1 0' }} />
                </>
            )}
        </div>
    );
};

export default PurchaseReportsPage;
