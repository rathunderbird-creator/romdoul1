// Inventory Reports — mockup built from reference screenshots, to help
// decide what this app actually needs before any of it is built for real.
// Stock on Hand is wired to real data (products/warehouses/warehouse_stock)
// since that's cheap and makes the mockup genuinely useful. Stock Card and
// Valuation are also real, from the same data plus stock_movements. Expiring
// and Reconciliation have NO backing data at all in this schema (no batch/lot
// expiry tracking, no stock-count workflow) — rather than fake numbers, they
// show what would actually need to be built to populate them.
//
// Bin and Batch columns show "Default" / "—": same honest placeholder this
// app already uses in Stock Adjustments, because there is no real bin or
// batch/lot tracking system behind them.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, FileText, Tag, CalendarClock, CheckCircle2, RefreshCw, Printer, Download, Search } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { supabase } from '../../lib/supabase';
import { dayKeyFromDate, addDays } from '../../utils/dateRange';
import type { Product } from '../../types';

interface MovementRow {
    id: string;
    type: 'in' | 'out';
    quantity: number;
    unit_price: number;
    movement_date: string;
    source?: string;
    reference_id?: string;
}

type TabKey = 'stock-on-hand' | 'stock-card' | 'valuation' | 'expiring' | 'reconciliation';
const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ size?: number; color?: string }> }[] = [
    { key: 'stock-on-hand', label: 'Stock on Hand', icon: Layers },
    { key: 'stock-card', label: 'Stock Card', icon: FileText },
    { key: 'valuation', label: 'Valuation', icon: Tag },
    { key: 'expiring', label: 'Expiring', icon: CalendarClock },
    { key: 'reconciliation', label: 'Reconciliation', icon: CheckCircle2 },
];

const fmt = (n: number): string => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayYmd = (): string => dayKeyFromDate(new Date());
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
const inputStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' };
const btnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' };

interface StockLine { product: Product; warehouseName: string; qty: number; unitCost: number }

const EmptyConcept: React.FC<{ icon: React.ComponentType<{ size?: number; color?: string }>; title: string; body: string; actionLabel?: string; onAction?: () => void }> = ({ icon: Icon, title, body, actionLabel, onAction }) => (
    <div style={{ ...cardStyle, padding: '40px 32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', maxWidth: '560px', margin: '0 auto' }}>
        <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={20} color="var(--color-text-secondary)" />
        </div>
        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)' }}>{title}</div>
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.55, margin: 0 }}>{body}</p>
        {actionLabel && (
            <button onClick={onAction} style={{ ...btnStyle, marginTop: '8px' }}>{actionLabel}</button>
        )}
    </div>
);

const InventoryReportsPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { products, warehouses, warehouseStock, categories, isLoading, refreshData } = useStore();

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Inventory Reports</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>What you hold, what it is worth, and whether the books agree.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const [tab, setTab] = useState<TabKey>('stock-on-hand');
    const activeProducts = useMemo(() => products.filter(p => p.isActive !== false), [products]);

    // ── Shared filters (Stock on Hand + Valuation) ──
    const [warehouseId, setWarehouseId] = useState('');
    const [category, setCategory] = useState('');
    const [search, setSearch] = useState('');

    const warehouseStockByProductAndWarehouse = useMemo(() => {
        const m = new Map<string, number>();
        for (const ws of warehouseStock) m.set(`${ws.productId}::${ws.warehouseId}`, (m.get(`${ws.productId}::${ws.warehouseId}`) || 0) + (Number(ws.quantity) || 0));
        return m;
    }, [warehouseStock]);
    const anyWarehouseStockByProduct = useMemo(() => {
        const s = new Set<string>();
        for (const ws of warehouseStock) if ((Number(ws.quantity) || 0) !== 0) s.add(ws.productId);
        return s;
    }, [warehouseStock]);

    const filteredProducts = useMemo(() => {
        const q = search.trim().toLowerCase();
        return activeProducts.filter(p => {
            if (category && p.category !== category) return false;
            if (q && !(p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || (p.model || '').toLowerCase().includes(q))) return false;
            return true;
        });
    }, [activeProducts, category, search]);

    // One row per (product, warehouse) that actually holds stock — a product
    // with stock but no warehouse_stock rows at all still gets one
    // "Unassigned" row, so nothing silently disappears from the report.
    const stockLines = useMemo<StockLine[]>(() => {
        const lines: StockLine[] = [];
        for (const p of filteredProducts) {
            const unitCost = Number(p.purchaseCost) || 0;
            if (warehouseId) {
                const qty = warehouseStockByProductAndWarehouse.get(`${p.id}::${warehouseId}`) || 0;
                if (qty !== 0) lines.push({ product: p, warehouseName: warehouses.find(w => w.id === warehouseId)?.name || 'Unknown', qty, unitCost });
                continue;
            }
            let any = false;
            for (const w of warehouses) {
                const qty = warehouseStockByProductAndWarehouse.get(`${p.id}::${w.id}`) || 0;
                if (qty !== 0) { lines.push({ product: p, warehouseName: w.name, qty, unitCost }); any = true; }
            }
            if (!any && !anyWarehouseStockByProduct.has(p.id) && (Number(p.stock) || 0) !== 0) {
                lines.push({ product: p, warehouseName: 'Unassigned', qty: Number(p.stock) || 0, unitCost });
            }
        }
        return lines;
    }, [filteredProducts, warehouseId, warehouses, warehouseStockByProductAndWarehouse, anyWarehouseStockByProduct]);

    const totalQty = stockLines.reduce((s, l) => s + l.qty, 0);
    const totalValue = stockLines.reduce((s, l) => s + l.qty * l.unitCost, 0);

    const printList = () => {
        const w = window.open('', '_blank', 'width=1000,height=700');
        if (!w) return;
        const rows = stockLines.map(l => `<tr>
            <td>${escapeHtml(l.product.name)}<br><span style="color:#64748b;font-size:11px">${escapeHtml(l.product.sku || l.product.model || '')}</span></td>
            <td>${escapeHtml(l.warehouseName)}</td><td>Default</td><td>—</td>
            <td style="text-align:right">${fmt(l.qty)}</td><td style="text-align:right">${fmt(l.unitCost)}</td><td style="text-align:right">${fmt(l.qty * l.unitCost)}</td>
        </tr>`).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Stock on Hand</title><style>
            body{font-family:Segoe UI,Arial,sans-serif;color:#1a1f36;padding:28px}
            h1{font-size:20px;margin:0}p{color:#64748b;margin:4px 0 20px;font-size:13px}
            table{width:100%;border-collapse:collapse;font-size:13px}
            th{font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #cbd5e1;padding:8px;text-align:left}
            td{padding:7px 8px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums}
        </style></head><body><h1>Stock on Hand</h1><p>As of ${escapeHtml(new Date().toLocaleString())}</p>
        <table><thead><tr><th>Product</th><th>Warehouse</th><th>Bin</th><th>Batch</th><th>Qty</th><th>Unit Cost</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    const exportCsv = () => {
        const header = ['Product', 'SKU', 'Warehouse', 'Bin', 'Batch', 'Qty', 'Unit Cost', 'Value'];
        const rows = stockLines.map(l => [l.product.name, l.product.sku || l.product.model || '', l.warehouseName, 'Default', '—', fmt(l.qty), fmt(l.unitCost), fmt(l.qty * l.unitCost)]);
        const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `stock-on-hand-${todayYmd()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    // ── Stock Card ──
    const [cardProductId, setCardProductId] = useState('');
    const [cardMovements, setCardMovements] = useState<MovementRow[]>([]);
    const [cardLoading, setCardLoading] = useState(false);
    const loadCard = useCallback(async (productId: string) => {
        if (!productId) { setCardMovements([]); return; }
        setCardLoading(true);
        try {
            const since = addDays(todayYmd(), -365);
            const { data, error } = await supabase
                .from('stock_movements')
                .select('id, type, quantity, unit_price, movement_date, source, reference_id')
                .eq('product_id', productId)
                .gte('movement_date', since)
                .order('movement_date', { ascending: true });
            if (error) throw error;
            setCardMovements((data || []) as MovementRow[]);
        } catch (e) {
            console.error('Failed to fetch the stock card:', e);
            showToast('Failed to load the stock card for this product.', 'error');
        } finally {
            setCardLoading(false);
        }
    }, [showToast]);
    useEffect(() => { if (tab === 'stock-card') loadCard(cardProductId); }, [tab, cardProductId, loadCard]);

    const cardRows = useMemo(() => {
        let running = 0;
        return cardMovements.map(m => {
            const delta = m.type === 'in' ? Number(m.quantity) || 0 : -(Number(m.quantity) || 0);
            running += delta;
            return { ...m, delta, running };
        });
    }, [cardMovements]);

    // ── Valuation: grouped by category, average/purchase cost only ──
    const valuationRows = useMemo(() => {
        const byCategory = new Map<string, { qty: number; value: number }>();
        for (const l of stockLines) {
            const cur = byCategory.get(l.product.category) || { qty: 0, value: 0 };
            cur.qty += l.qty;
            cur.value += l.qty * l.unitCost;
            byCategory.set(l.product.category, cur);
        }
        return Array.from(byCategory.entries()).map(([cat, v]) => ({ category: cat, ...v, avgCost: v.qty !== 0 ? v.value / v.qty : 0 })).sort((a, b) => b.value - a.value);
    }, [stockLines]);

    const NavBtn: React.FC<{ tabKey: TabKey }> = ({ tabKey }) => {
        const { label, icon: Icon } = TABS.find(t => t.key === tabKey)!;
        const active = tab === tabKey;
        return (
            <button
                onClick={() => setTab(tabKey)}
                style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 14px', borderRadius: '10px', border: 'none',
                    background: active ? 'var(--color-surface)' : 'transparent',
                    color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    fontSize: '13px', fontWeight: active ? 700 : 600, cursor: 'pointer', textAlign: 'left',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
            >
                <Icon size={16} color={active ? 'var(--color-primary)' : 'var(--color-text-secondary)'} /> {label}
            </button>
        );
    };

    return (
        <div className="acct-page" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
            <div style={{ width: '210px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {TABS.map(t => <NavBtn key={t.key} tabKey={t.key} />)}
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {tab === 'stock-on-hand' && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                            <div>
                                <label style={labelStyle}>Warehouse</label>
                                <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                    <option value="">All warehouses</option>
                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>Category</label>
                                <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                    <option value="">All categories</option>
                                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: '1 1 220px', maxWidth: '280px' }}>
                                <label style={labelStyle}>Search</label>
                                <div style={{ position: 'relative' }}>
                                    <Search size={14} color="var(--color-text-muted)" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                                    <input type="text" placeholder="Product code or name…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, width: '100%', paddingLeft: '30px', boxSizing: 'border-box' }} />
                                </div>
                            </div>
                            <button onClick={() => refreshData()} title="Refresh" style={{ ...inputStyle, cursor: 'pointer', display: 'flex' }}>
                                <RefreshCw size={15} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                            </button>
                            <button onClick={printList} style={btnStyle}><Printer size={14} /> Print list</button>
                            <button onClick={exportCsv} style={btnStyle}><Download size={14} /> Export CSV</button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px' }}>
                            <div style={{ ...cardStyle, padding: '14px 18px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Lines</div>
                                <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>{stockLines.length}</div>
                            </div>
                            <div style={{ ...cardStyle, padding: '14px 18px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Total Quantity</div>
                                <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>{fmt(totalQty)}</div>
                            </div>
                            <div style={{ ...cardStyle, padding: '14px 18px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Total Value</div>
                                <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>{fmt(totalValue)}</div>
                            </div>
                        </div>

                        <div style={{ ...cardStyle, overflow: 'hidden' }}>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Product</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Warehouse</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Bin</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Batch</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Qty</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Unit Cost</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {isLoading ? (
                                            <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading…</td></tr>
                                        ) : stockLines.length === 0 ? (
                                            <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No stock matches these filters.</td></tr>
                                        ) : stockLines.map((l, i) => {
                                            const reorder = Number(l.product.reorderLevel) || 0;
                                            const below = reorder > 0 && l.qty < reorder;
                                            return (
                                                <tr key={`${l.product.id}-${l.warehouseName}-${i}`} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                    <td style={{ padding: '12px 16px' }}>
                                                        <div style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>{l.product.sku || l.product.model || l.product.name}</div>
                                                        <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{l.product.sku ? l.product.name : l.product.category}</div>
                                                    </td>
                                                    <td style={{ padding: '12px 16px', color: 'var(--color-text-main)' }}>{l.warehouseName}</td>
                                                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>Default</td>
                                                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>—</td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                                        <div style={{ fontWeight: 700, color: below ? '#D97706' : 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.qty)} <span style={{ fontWeight: 400, fontSize: '11px', color: 'var(--color-text-secondary)' }}>PCS</span></div>
                                                        {below && <div style={{ fontSize: '11px', color: '#D97706', fontWeight: 600 }}>below reorder ({fmt(reorder)})</div>}
                                                    </td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.unitCost)}</td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(l.qty * l.unitCost)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}

                {tab === 'stock-card' && (
                    <>
                        <div>
                            <label style={labelStyle}>Product</label>
                            <select value={cardProductId} onChange={e => setCardProductId(e.target.value)} style={{ ...inputStyle, minWidth: '280px', cursor: 'pointer' }}>
                                <option value="">Select a product…</option>
                                {activeProducts.map(p => <option key={p.id} value={p.id}>{p.sku ? `${p.sku} · ` : ''}{p.name}</option>)}
                            </select>
                        </div>
                        <div style={{ ...cardStyle, overflow: 'hidden' }}>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Date</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Type</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Source</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Qty</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Unit Cost</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Balance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {!cardProductId ? (
                                            <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Choose a product to see its stock card.</td></tr>
                                        ) : cardLoading ? (
                                            <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading…</td></tr>
                                        ) : cardRows.length === 0 ? (
                                            <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No movements for this product in the last 365 days.</td></tr>
                                        ) : cardRows.map(r => (
                                            <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{r.movement_date}</td>
                                                <td style={{ padding: '12px 16px' }}>
                                                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: '999px', background: r.type === 'in' ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.14)', color: r.type === 'in' ? '#059669' : '#DC2626' }}>{r.type === 'in' ? 'IN' : 'OUT'}</span>
                                                </td>
                                                <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>{r.source || '—'}{r.reference_id ? ` · ${r.reference_id}` : ''}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.delta < 0 ? '#DC2626' : 'var(--color-text-main)' }}>{r.delta > 0 ? '+' : ''}{fmt(r.delta)}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.unit_price)}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.running)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}

                {tab === 'valuation' && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                            <div>
                                <label style={labelStyle}>Warehouse</label>
                                <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                    <option value="">All warehouses</option>
                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: 0, maxWidth: '640px' }}>
                            Valued at each product's purchase cost — this system doesn't track FIFO/LIFO cost layers yet, so this stays the same regardless of the Default Costing Method chosen in Inventory Settings.
                        </p>
                        <div style={{ ...cardStyle, overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Category</th>
                                        <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Qty</th>
                                        <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Avg Unit Cost</th>
                                        <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {valuationRows.length === 0 ? (
                                        <tr><td colSpan={4} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No stock to value.</td></tr>
                                    ) : valuationRows.map(r => (
                                        <tr key={r.category} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-main)' }}>{r.category}</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.qty)}</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.avgCost)}</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.value)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                {valuationRows.length > 0 && (
                                    <tfoot>
                                        <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                                            <td style={{ padding: '12px 16px', fontWeight: 700 }}>Total</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(valuationRows.reduce((s, r) => s + r.qty, 0))}</td>
                                            <td />
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmt(valuationRows.reduce((s, r) => s + r.value, 0))}</td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    </>
                )}

                {tab === 'expiring' && (
                    <EmptyConcept
                        icon={CalendarClock}
                        title="No expiry data to show"
                        body="This system doesn't track batch or lot expiry dates yet. To populate this view, products would need an expiry-tracked flag, stock receipts would need a batch and expiry date, and issuing stock would need to check it before it goes out."
                    />
                )}

                {tab === 'reconciliation' && (
                    <EmptyConcept
                        icon={CheckCircle2}
                        title="No counts recorded yet"
                        body="This system doesn't have a stock-count / reconciliation workflow yet. To populate this view, a count session would record a counted quantity per product and bin against the book quantity, and post the difference as a Stock Adjustment."
                        actionLabel="Start a count"
                        onAction={() => showToast('Mockup only — there is no count workflow to start yet.', 'info')}
                    />
                )}
            </div>
        </div>
    );
};

export default InventoryReportsPage;
