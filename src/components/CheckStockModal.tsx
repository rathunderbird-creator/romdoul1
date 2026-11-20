import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Download, RefreshCw, Search, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../utils/fetchAll';
import { productWarehouseLines, type StockOnHandLine } from '../utils/stockOnHand';
import { dayKeyFromDate } from '../utils/dateRange';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useMobile } from '../hooks/useMobile';
import { useOptionalLanguage } from '../context/LanguageContext';

type StockStatus = 'out' | 'low' | 'ok';

interface CheckStockRow {
    id: string;
    name: string;
    model: string;
    category: string;
    stock: number;
    /** Units sold in the last SOLD_WINDOW_DAYS (drives the default order). */
    sold: number;
    threshold: number;
    status: StockStatus;
    lines: StockOnHandLine[];
}

type SortKey = 'sold' | 'name' | 'category' | 'stock';

// Same "top sold" window and counting rule as the Price List page: sale line
// items from the last 90 days, excluding Cancelled / Returned / ReStock orders.
const SOLD_WINDOW_DAYS = 90;

interface ProductStockRow {
    id: string;
    name: string | null;
    model: string | null;
    category: string | null;
    stock: number | null;
    low_stock_threshold: number | null;
    is_active: boolean | null;
}

interface CheckStockModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const statusOf = (stock: number, threshold: number): StockStatus =>
    stock <= 0 ? 'out' : stock < threshold ? 'low' : 'ok';

/**
 * "Check Stock" popup (Orders Management): the CURRENT stock on hand of every
 * active product, so whoever is taking orders can answer "do we have it?"
 * without leaving the page. Read fresh from the database on every open — the
 * store's product list is loaded once at boot and goes stale as other users
 * sell. Same rules as the Inventory page: products.stock is the company-wide
 * quantity, Low = below the product's low-stock threshold (default 5), and the
 * per-warehouse split comes from the shared Stock on Hand rule (stockOnHand.ts)
 * so the warehouse figures always add up to the total.
 */
const CheckStockModal: React.FC<CheckStockModalProps> = ({ isOpen, onClose }) => {
    const { warehouses } = useStore();
    const { showToast } = useToast();
    const isMobile = useMobile();
    const lang = useOptionalLanguage();
    const tx = (k: string, en: string) => { const v = lang?.t(k); return v && v !== k ? v : en; };

    const [isLoading, setIsLoading] = useState(false);
    const [rows, setRows] = useState<CheckStockRow[]>([]);
    const [loadedAt, setLoadedAt] = useState<Date | null>(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'inStock' | 'low' | 'out'>('all');
    const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'sold', direction: 'desc' });
    const fetchSeq = useRef(0);
    const searchRef = useRef<HTMLInputElement>(null);

    const load = async () => {
        const seq = ++fetchSeq.current;
        const isStale = () => seq !== fetchSeq.current;
        setIsLoading(true);
        try {
            const since = new Date(Date.now() - SOLD_WINDOW_DAYS * 86400000).toISOString();
            const [products, whRows, soldRows] = await Promise.all([
                fetchAll<ProductStockRow>((from, to) => supabase
                    .from('products')
                    .select('id, name, model, category, stock, low_stock_threshold, is_active')
                    .order('id', { ascending: true })
                    .range(from, to), 1000, { label: 'CheckStockModal products' }),
                fetchAll<{ id: string; product_id: string; warehouse_id: string; quantity: number | null }>((from, to) => supabase
                    .from('warehouse_stock')
                    .select('id, product_id, warehouse_id, quantity')
                    .order('id', { ascending: true })
                    .range(from, to), 1000, { label: 'CheckStockModal warehouse stock' }),
                // Sold counts only decide the order — if they fail, still show stock.
                fetchAll<{ id: string; product_id: string | null; quantity: number | null }>((from, to) => supabase
                    .from('sale_items')
                    .select('id, product_id, quantity, sales!inner(date, shipping_status)')
                    .gte('sales.date', since)
                    .not('sales.shipping_status', 'in', '("Cancelled","Returned","ReStock")')
                    .order('id', { ascending: true })
                    .range(from, to), 1000, { label: 'CheckStockModal sold', concurrency: 4 })
                    .catch((e: unknown) => { console.error('Failed to load sold counts:', e); return []; }),
            ]);
            if (isStale()) return;

            const soldBy = new Map<string, number>();
            for (const si of soldRows) {
                if (!si.product_id) continue;
                soldBy.set(si.product_id, (soldBy.get(si.product_id) || 0) + (Number(si.quantity) || 0));
            }

            const whName = new Map(warehouses.map(w => [w.id, w.name]));
            const tracked = new Map<string, { warehouseId: string; warehouseName: string; qty: number }[]>();
            for (const ws of whRows) {
                const list = tracked.get(ws.product_id) || [];
                list.push({ warehouseId: ws.warehouse_id, warehouseName: whName.get(ws.warehouse_id) || '?', qty: ws.quantity || 0 });
                tracked.set(ws.product_id, list);
            }

            const built: CheckStockRow[] = products
                .filter(p => p.is_active !== false)
                .map(p => {
                    const stock = Number(p.stock) || 0;
                    const threshold = Number(p.low_stock_threshold) || 5;
                    return {
                        id: p.id,
                        name: p.name || '',
                        model: p.model || '',
                        category: p.category || '',
                        stock,
                        sold: soldBy.get(p.id) || 0,
                        threshold,
                        status: statusOf(stock, threshold),
                        lines: productWarehouseLines(stock, tracked.get(p.id) || []),
                    };
                });
            setRows(built);
            setLoadedAt(new Date());
        } catch (e: unknown) {
            if (isStale()) return;
            console.error('Failed to load stock:', e);
            showToast(tx('ui.orders.checkStock.loadFailed', 'Failed to load stock: ') + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            if (!isStale()) setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            load();
            // Opening this is almost always "do we have X?" — put the cursor in search.
            setTimeout(() => searchRef.current?.focus(), 50);
        } else {
            fetchSeq.current++;
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    const counts = useMemo(() => ({
        all: rows.length,
        inStock: rows.filter(r => r.stock > 0).length,
        low: rows.filter(r => r.status === 'low').length,
        out: rows.filter(r => r.status === 'out').length,
    }), [rows]);

    const displayed = useMemo(() => {
        const q = search.trim().toLowerCase();
        let out = rows.filter(r => {
            if (filter === 'inStock' && r.stock <= 0) return false;
            if (filter === 'low' && r.status !== 'low') return false;
            if (filter === 'out' && r.status !== 'out') return false;
            if (!q) return true;
            return r.name.toLowerCase().includes(q) || r.model.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
        });
        const { key, direction } = sort;
        out = [...out].sort((a, b) => {
            const cmp = key === 'stock' || key === 'sold' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]));
            // Ties (e.g. equal sold counts, or never sold) fall back to name A→Z.
            return (direction === 'asc' ? cmp : -cmp) || a.name.localeCompare(b.name);
        });
        return out;
    }, [rows, search, filter, sort]);

    const totalUnits = useMemo(() => displayed.reduce((s, r) => s + r.stock, 0), [displayed]);
    const showWarehouses = warehouses.length > 0;

    const exportExcel = () => {
        if (displayed.length === 0) return;
        const data: Record<string, string | number>[] = displayed.map(r => ({
            'Product': r.name,
            'Model': r.model,
            'Category': r.category,
            'Stock': r.stock,
            [`Sold (${SOLD_WINDOW_DAYS}d)`]: r.sold,
            'Status': r.status === 'out' ? 'Out of Stock' : r.status === 'low' ? 'Low Stock' : 'In Stock',
            ...(showWarehouses ? { 'Warehouses': r.lines.map(l => `${l.warehouseName}: ${l.qty}`).join(', ') } : {}),
        }));
        data.push({ 'Product': 'Total', 'Stock': totalUnits });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Stock');
        XLSX.writeFile(wb, `Stock_${dayKeyFromDate(new Date())}.xlsx`);
    };

    if (!isOpen) return null;

    const toggleSort = (key: SortKey) => setSort(prev => prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'stock' || key === 'sold' ? 'desc' : 'asc' });
    const arrow = (key: SortKey) => sort.key === key
        ? <span style={{ marginLeft: '4px' }}>{sort.direction === 'asc' ? '↑' : '↓'}</span>
        : <span style={{ marginLeft: '4px', opacity: 0.35 }}>↕</span>;

    const cell: React.CSSProperties = { padding: isMobile ? '7px 8px' : '9px 14px', fontSize: isMobile ? '12px' : '13px', borderBottom: '1px solid var(--color-border)' };
    const th: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, padding: isMobile ? '8px 8px' : '10px 14px', background: 'var(--color-bg)', borderBottom: '2px solid var(--color-border)', fontSize: isMobile ? '10px' : '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', textAlign: 'left', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
    const chip = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, background: active ? 'var(--color-primary)' : '#FFFFFF', color: active ? 'white' : 'var(--color-text-secondary)', cursor: 'pointer', transition: 'all 0.15s' });
    const statusPill = (s: StockStatus) => {
        const map = {
            out: { bg: 'rgba(239,68,68,0.1)', color: '#DC2626', label: tx('ui.orders.checkStock.out', 'Out of Stock') },
            low: { bg: 'rgba(245,158,11,0.12)', color: '#B45309', label: tx('ui.orders.checkStock.low', 'Low Stock') },
            ok: { bg: 'rgba(16,185,129,0.1)', color: '#059669', label: tx('ui.orders.checkStock.inStock', 'In Stock') },
        }[s];
        return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, background: map.bg, color: map.color, whiteSpace: 'nowrap' }}>{map.label}</span>;
    };
    const stockColor = (s: StockStatus) => s === 'out' ? '#DC2626' : s === 'low' ? '#B45309' : 'var(--color-text-main)';

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 9000,
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: isMobile ? '12px' : '24px',
                animation: 'fadeIn 0.2s ease',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={tx('ui.orders.checkStock.title', 'Check Stock')}
                style={{
                    background: 'var(--color-surface)', borderRadius: '20px',
                    width: '100%', maxWidth: '820px', maxHeight: '88vh',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
                    animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
            >
                {/* Header */}
                <div style={{
                    padding: '18px 22px', borderBottom: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(217,119,6,0.03))', gap: '10px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '13px', minWidth: 0 }}>
                        <div style={{
                            width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
                        }}>
                            <Boxes size={20} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#111827' }}>{tx('ui.orders.checkStock.title', 'Check Stock')}</h2>
                            <p style={{ fontSize: '12px', color: '#6B7280', margin: '2px 0 0 0' }}>
                                {tx('ui.orders.checkStock.subtitle', 'Current stock on hand')}
                                {loadedAt && ` · ${loadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center' }}>
                        <button onClick={load} disabled={isLoading} title={tx('ui.orders.checkStock.refresh', 'Refresh')} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '34px',
                            borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                            color: '#111827', cursor: isLoading ? 'wait' : 'pointer',
                        }}>
                            <RefreshCw size={15} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
                        </button>
                        <button onClick={exportExcel} title={tx('ui.inventory.exportExcel', 'Export to Excel')} style={{
                            display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px',
                            borderRadius: '10px', border: '1px solid var(--color-border)',
                            background: 'var(--color-bg)', color: '#111827', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                        }}>
                            <Download size={14} /> {!isMobile && tx('common.export', 'Export')}
                        </button>
                        <button onClick={onClose} aria-label={tx('common.close', 'Close')} style={{
                            background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                            cursor: 'pointer', color: '#6B7280', width: '34px', height: '34px',
                            borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Search + filters */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: isMobile ? '10px 12px' : '12px 22px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
                    <div style={{ position: 'relative', flex: isMobile ? '1 1 100%' : '1 1 220px', minWidth: 0 }}>
                        <Search size={15} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
                        <input
                            ref={searchRef}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder={tx('ui.orders.checkStock.search', 'Search product, model or category…')}
                            style={{ width: '100%', padding: '8px 30px 8px 32px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px', background: 'var(--color-surface)', boxSizing: 'border-box' }}
                        />
                        {search && (
                            <button onClick={() => setSearch('')} aria-label={tx('common.clear', 'Clear')} style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', display: 'flex' }}>
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <button onClick={() => setFilter('all')} style={chip(filter === 'all')}>{tx('ui.orders.checkStock.all', 'All')} ({counts.all})</button>
                    <button onClick={() => setFilter('inStock')} style={chip(filter === 'inStock')}>{tx('ui.orders.checkStock.inStock', 'In Stock')} ({counts.inStock})</button>
                    <button onClick={() => setFilter('low')} style={chip(filter === 'low')}>{tx('ui.orders.checkStock.low', 'Low Stock')} ({counts.low})</button>
                    <button onClick={() => setFilter('out')} style={chip(filter === 'out')}>{tx('ui.orders.checkStock.out', 'Out of Stock')} ({counts.out})</button>
                </div>

                {/* Body */}
                <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                    {isLoading && rows.length === 0 ? (
                        <div style={{ padding: '60px', textAlign: 'center', color: '#6B7280' }}>
                            <RefreshCw size={28} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
                            {tx('ui.orders.checkStock.loading', 'Loading stock…')}
                        </div>
                    ) : displayed.length === 0 ? (
                        <div style={{ padding: '48px', textAlign: 'center', color: '#6B7280', fontSize: '13px' }}>
                            {tx('ui.orders.checkStock.empty', 'No products match.')}
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: isMobile ? '460px' : '600px', background: 'var(--color-surface)' }}>
                            <thead>
                                <tr>
                                    <th onClick={() => toggleSort('name')} style={th}>{tx('ui.orders.checkStock.product', 'Product')}{arrow('name')}</th>
                                    {!isMobile && <th onClick={() => toggleSort('category')} style={th}>{tx('ui.orders.checkStock.category', 'Category')}{arrow('category')}</th>}
                                    <th onClick={() => toggleSort('stock')} style={{ ...th, textAlign: 'center' }}>{tx('ui.orders.checkStock.stock', 'Stock')}{arrow('stock')}</th>
                                    <th onClick={() => toggleSort('sold')} title={tx('ui.orders.checkStock.soldHint', `Units sold in the last ${SOLD_WINDOW_DAYS} days`)} style={{ ...th, textAlign: 'center' }}>{tx('ui.orders.checkStock.sold', `Sold ${SOLD_WINDOW_DAYS}d`)}{arrow('sold')}</th>
                                    <th style={{ ...th, cursor: 'default', textAlign: 'center' }}>{tx('ui.orders.checkStock.status', 'Status')}</th>
                                    {showWarehouses && !isMobile && <th style={{ ...th, cursor: 'default' }}>{tx('ui.orders.checkStock.warehouses', 'Warehouses')}</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {displayed.map((r, idx) => (
                                    <tr key={r.id} style={{ background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : '#FFFFFF' }}>
                                        <td style={{ ...cell, borderLeft: `3px solid ${stockColor(r.status) === 'var(--color-text-main)' ? '#10B981' : stockColor(r.status)}` }}>
                                            <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{r.name}</div>
                                            {r.model && r.model !== r.name && <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{r.model}</div>}
                                        </td>
                                        {!isMobile && <td style={{ ...cell, color: 'var(--color-text-secondary)' }}>{r.category || '—'}</td>}
                                        <td style={{ ...cell, textAlign: 'center', fontWeight: 800, fontSize: isMobile ? '13px' : '15px', fontVariantNumeric: 'tabular-nums', color: stockColor(r.status) }}>{r.stock}</td>
                                        <td style={{ ...cell, textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: r.sold > 0 ? 'var(--color-text-main)' : 'var(--color-text-secondary)' }}>{r.sold || '—'}</td>
                                        <td style={{ ...cell, textAlign: 'center' }}>{statusPill(r.status)}</td>
                                        {showWarehouses && !isMobile && (
                                            <td style={{ ...cell, fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                {r.lines.length === 0 ? '—' : r.lines.map(l => (
                                                    <span key={l.warehouseId ?? 'unassigned'} style={{ display: 'inline-block', marginRight: '10px', whiteSpace: 'nowrap', fontStyle: l.warehouseId ? 'normal' : 'italic' }}>
                                                        {l.warehouseId ? l.warehouseName : tx('ui.orders.checkStock.unassigned', 'Unassigned')}: <b style={{ color: 'var(--color-text-main)' }}>{l.qty}</b>
                                                    </span>
                                                ))}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                {displayed.length > 0 && (
                    <div style={{ padding: isMobile ? '10px 12px' : '11px 22px', borderTop: '2px solid var(--color-border)', background: 'var(--color-bg)', display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, flexShrink: 0 }}>
                        <span>{displayed.length} {tx('ui.orders.checkStock.products', 'products')}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{tx('ui.orders.checkStock.totalUnits', 'Total units')}: {totalUnits}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CheckStockModal;
