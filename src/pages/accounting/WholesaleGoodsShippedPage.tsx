// Goods Shipped — "stock that left for wholesale customers": a ledger of
// every wholesale order already Delivered. This is a report, not a status-
// manager — "Mark Delivered" already lives on Wholesale Orders (the sibling
// page), so this page doesn't duplicate it. Stock itself already left the
// warehouse at order CREATION (createWholesaleOrder deducts it immediately,
// regardless of status), not at the Delivered transition — Delivered is
// purely a fulfillment checkpoint, same relation Receiving has to a
// Received purchase order. Reference reuses each order's real
// invoice_number (falling back to a short order-id, same convention
// Wholesale Orders itself uses everywhere) rather than inventing a new
// derived reference — unlike Procurement, which has no such field on a PO.
import React, { useMemo, useState } from 'react';
import { Search, Eye, Printer, RefreshCw, Download, Truck, Database } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useWholesale } from '../../hooks/useWholesale';
import Modal from '../../components/Modal';
import type { WholesaleOrder } from '../../types';

const fmtUsd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const fmtDate = (d?: string | null) => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB') : '—';
const escapeHtml = (s: string): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const refOf = (o: WholesaleOrder) => o.invoice_number || `WO-${o.id.slice(0, 8).toUpperCase()}`;

const payConfig = (s?: string) => {
    switch (s) {
        case 'Paid': return { color: '#059669', bg: 'rgba(16,185,129,0.1)' };
        case 'Partial': return { color: '#D97706', bg: 'rgba(217,119,6,0.1)' };
        default: return { color: '#DC2626', bg: 'rgba(239,68,68,0.1)' };
    }
};
const payChip = (s?: string) => {
    const pc = payConfig(s);
    return <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap', background: pc.bg, color: pc.color }}>{s || 'Unpaid'}</span>;
};

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

const WholesaleGoodsShippedPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { warehouses } = useStore();
    const { wholesaleOrders, isLoading, tableMissing, fetchWholesaleOrders } = useWholesale();

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Goods Shipped</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Wholesale orders already delivered</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    React.useEffect(() => { fetchWholesaleOrders(); }, [fetchWholesaleOrders]);

    const warehouseName = (id?: string) => warehouses.find(w => w.id === id)?.name || '—';
    const shipments = useMemo(() => wholesaleOrders.filter(o => o.status === 'Delivered'), [wholesaleOrders]);

    const [search, setSearch] = useState('');
    const [warehouseFilter, setWarehouseFilter] = useState('');

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return shipments
            .filter(o => !warehouseFilter || o.warehouse_id === warehouseFilter)
            .filter(o => !q || refOf(o).toLowerCase().includes(q) || o.customer_name.toLowerCase().includes(q) || (o.customer_phone || '').includes(q))
            .sort((a, b) => b.order_date.localeCompare(a.order_date) || (b.created_at || '').localeCompare(a.created_at || ''));
    }, [shipments, search, warehouseFilter]);

    const hasActiveFilters = search !== '' || warehouseFilter !== '';

    // ── View / Print ──
    const [viewOrder, setViewOrder] = useState<WholesaleOrder | null>(null);
    const printShipment = (o: WholesaleOrder) => {
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) return;
        const rows = (o.items || []).map(item =>
            `<tr><td>${escapeHtml(item.product_name || item.product_id)}</td><td class="num">${item.quantity}</td><td class="num">${fmtUsd(item.unit_price)}</td><td class="num">${fmtUsd(item.quantity * item.unit_price)}</td></tr>`
        ).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${refOf(o)}</title><style>${PRINT_CSS}</style></head><body>
        <h1>Goods Shipped ${escapeHtml(refOf(o))}</h1>
        <div class="meta">
            <span>Date</span><span>${fmtDate(o.order_date)}</span>
            <span>Customer</span><b>${escapeHtml(o.customer_name)}</b>
            <span>Warehouse</span><span>${escapeHtml(warehouseName(o.warehouse_id))}</span>
            <span>Payment</span><span>${escapeHtml(o.payment_status || 'Unpaid')}</span>
        </div>
        <table><thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">Total</td><td class="num">${fmtUsd(o.total_amount)}</td></tr></tfoot></table>
        <div class="foot">Printed ${new Date().toLocaleString()}</div>
        </body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    const activeTable = () => ({
        name: 'Goods Shipped',
        columns: ['Reference', 'Date', 'Customer', 'Warehouse', 'Lines', 'Total', 'Payment'],
        rows: filtered.map(o => [
            refOf(o), fmtDate(o.order_date), o.customer_name,
            warehouseName(o.warehouse_id), o.items?.length || 0, fmtUsd(o.total_amount), o.payment_status || 'Unpaid',
        ]),
    });

    const exportCsv = () => {
        const t = activeTable();
        const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = [t.columns, ...t.rows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `goods-shipped-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const printList = () => {
        const t = activeTable();
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) return;
        const body = t.rows.map(r => `<tr>${r.map((c, i) => `<td class="${i === 4 || i === 5 ? 'num' : ''}">${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${t.name}</title><style>${PRINT_CSS}</style></head><body>
        <h1>${t.name}</h1><p class="muted">${filtered.length} ${filtered.length === 1 ? 'shipment' : 'shipments'} · Printed ${new Date().toLocaleString()}</p>
        <table><thead><tr>${t.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
        <div class="foot">All figures are in USD.</div>
        </body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '340px' }}>
                    <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input type="text" placeholder="Search reference, customer or phone…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: '34px' }} />
                </div>
                <select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)} style={{ ...inputStyle, width: 'auto', minWidth: '160px', cursor: 'pointer' }}>
                    <option value="">All warehouses</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <button onClick={() => fetchWholesaleOrders()} title="Refresh" style={{ ...inputStyle, width: 'auto', padding: '10px', cursor: 'pointer', display: 'flex' }}>
                    <RefreshCw size={15} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                </button>
                {hasActiveFilters && (
                    <button onClick={() => { setSearch(''); setWarehouseFilter(''); }} style={{ padding: '8px 12px', borderRadius: '8px', fontSize: '13px', color: '#ef4444', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 500 }}>
                        Clear
                    </button>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button onClick={printList} disabled={isLoading || filtered.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (isLoading || filtered.length === 0) ? 0.5 : 1 }}>
                        <Printer size={13} /> Print list
                    </button>
                    <button onClick={exportCsv} disabled={isLoading || filtered.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (isLoading || filtered.length === 0) ? 0.5 : 1 }}>
                        <Download size={13} /> Export CSV
                    </button>
                </div>
            </div>

            <div style={{ background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                {tableMissing ? (
                    <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                        <Database size={40} style={{ opacity: 0.25, margin: '0 auto 12px', color: '#D97706' }} />
                        <p style={{ fontWeight: 600, color: 'var(--color-text)' }}>Database setup needed</p>
                        <p style={{ fontSize: '13px' }}>Run <code>migrations/full_schema.sql</code> in your Supabase SQL editor, then Refresh.</p>
                    </div>
                ) : isLoading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading shipments...</div>
                ) : filtered.length === 0 ? (
                    <div className="glass-panel" style={{ textAlign: 'center', padding: '60px', border: 'none' }}>
                        <Truck size={40} color="var(--color-text-muted)" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                        <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '8px' }}>No goods shipped yet</h3>
                        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            {hasActiveFilters ? 'Try adjusting your filters.' : 'Mark a wholesale order Delivered to see it here.'}
                        </p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '760px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                    {['Reference', 'Date', 'Customer', 'Warehouse', 'Lines', 'Total', 'Payment', ''].map((h, i) => (
                                        <th key={h || 'actions'} style={{ padding: '12px 20px', textAlign: i === 4 || i === 5 ? 'right' : 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(o => (
                                    <tr key={o.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '12px 20px', fontSize: '12px', color: 'var(--color-text-main)', fontWeight: 600 }}>{refOf(o)}</td>
                                        <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(o.order_date)}</td>
                                        <td className="d2-khmer" style={{ padding: '12px 20px', color: 'var(--color-text-main)' }}>{o.customer_name}</td>
                                        <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)' }}>{warehouseName(o.warehouse_id)}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{o.items?.length || 0}</td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(o.total_amount)}</td>
                                        <td style={{ padding: '12px 20px' }}>{payChip(o.payment_status)}</td>
                                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                <button onClick={() => setViewOrder(o)} title="View" style={{ background: 'rgba(99,102,241,0.08)', border: 'none', cursor: 'pointer', color: '#6366f1', padding: '6px', borderRadius: '6px' }}><Eye size={15} /></button>
                                                <button onClick={() => printShipment(o)} title="Print" style={{ background: 'rgba(37,99,235,0.08)', border: 'none', cursor: 'pointer', color: '#2563eb', padding: '6px', borderRadius: '6px' }}><Printer size={15} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {viewOrder && (
                <Modal isOpen={!!viewOrder} onClose={() => setViewOrder(null)} title="Goods Shipped" width="520px">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: '8px' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Reference</span>
                            <span style={{ fontWeight: 600 }}>{refOf(viewOrder)}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Date</span>
                            <span>{fmtDate(viewOrder.order_date)}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Customer</span>
                            <span className="d2-khmer">{viewOrder.customer_name}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Warehouse</span>
                            <span>{warehouseName(viewOrder.warehouse_id)}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Payment</span>
                            <span>{payChip(viewOrder.payment_status)}</span>
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
                                {(viewOrder.items || []).map((item, i) => (
                                    <tr key={item.id || i}>
                                        <td className="d2-khmer" style={{ padding: '6px 0', color: 'var(--color-text-main)' }}>{item.product_name || item.product_id}</td>
                                        <td style={{ padding: '6px 0', textAlign: 'right' }}>{item.quantity}</td>
                                        <td style={{ padding: '6px 0', textAlign: 'right' }}>{fmtUsd(item.quantity * item.unit_price)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0', borderTop: '1px solid var(--color-border)' }}>
                            <span style={{ fontWeight: 700 }}>Total</span>
                            <span style={{ fontWeight: 800, fontSize: '18px', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(viewOrder.total_amount)}</span>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default WholesaleGoodsShippedPage;
