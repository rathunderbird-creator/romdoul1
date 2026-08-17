import React, { useState, useMemo, useEffect } from 'react';
import { Download, RefreshCw, Table2, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useMobile } from '../hooks/useMobile';
import DateRangePicker from './DateRangePicker';

// One row of the summary (per-product stock recap).
interface MovementSummaryRow {
    id: string;
    name: string;
    oldStock: number;
    sold: number;
    ret: number;
    buy: number;
    newStock: number;
}

interface StockMovementSummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Period the popup opens with; empty strings (or omitted) = all time. */
    initialRange?: { start: string; end: string };
    /** Restrict to one warehouse; omit for all warehouses. */
    warehouseId?: string;
}

/**
 * "Show Movements" popup: per-product recap of Old Stock / Sold / Return /
 * Buy / New Stock over a period. New Stock = the product's current stock;
 * Old Stock is back-calculated so every row satisfies
 * New = Old + Buy + Return - Sold.
 * Shared by the Stock Movements page and Orders Management.
 */
const StockMovementSummaryModal: React.FC<StockMovementSummaryModalProps> = ({ isOpen, onClose, initialRange, warehouseId }) => {
    const { products, warehouses } = useStore();
    const { showToast } = useToast();
    const isMobile = useMobile();

    const [isLoading, setIsLoading] = useState(false);
    const [rows, setRows] = useState<MovementSummaryRow[]>([]);
    // The popup has its own date range (seeded from initialRange on open),
    // so the period can be changed without leaving the popup.
    const [range, setRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
    // Table controls: hide zero-movement rows, sortable columns.
    const [onlyMovement, setOnlyMovement] = useState(false);
    const [sort, setSort] = useState<{ key: keyof MovementSummaryRow; direction: 'asc' | 'desc' } | null>(null);

    const fetchSummary = async (r: { start: string; end: string }) => {
        setIsLoading(true);
        try {
            // Only the date range and warehouse restriction apply here — callers'
            // other filters (e.g. the movements page In/Out toggle) can't skew it.
            let query = supabase.from('stock_movements').select('product_id, product_name, type, quantity, source');
            if (r.start) query = query.gte('movement_date', r.start);
            if (r.end) query = query.lte('movement_date', r.end);
            if (warehouseId) query = query.eq('warehouse_id', warehouseId);
            const { data, error } = await query;
            if (error) throw error;

            const byProduct = new Map<string, { sold: number; ret: number; buy: number; name: string }>();
            for (const m of (data || []) as any[]) {
                const key = m.product_id || m.product_name || '?';
                const agg = byProduct.get(key) || { sold: 0, ret: 0, buy: 0, name: m.product_name || 'Unknown' };
                if (m.type === 'out') agg.sold += m.quantity || 0;
                else if (m.source === 'Customer Return') agg.ret += m.quantity || 0;
                else agg.buy += m.quantity || 0; // PO receipts + other stock-ins
                byProduct.set(key, agg);
            }

            const built: MovementSummaryRow[] = products.map(p => {
                const agg = byProduct.get(p.id) || { sold: 0, ret: 0, buy: 0, name: p.name };
                byProduct.delete(p.id);
                const newStock = p.stock || 0;
                return {
                    id: p.id,
                    name: p.name,
                    oldStock: newStock - agg.buy - agg.ret + agg.sold,
                    sold: agg.sold,
                    ret: agg.ret,
                    buy: agg.buy,
                    newStock
                };
            });
            // Movements whose product was deleted still show up, with zero current stock.
            for (const [key, agg] of byProduct) {
                built.push({ id: key, name: agg.name, oldStock: agg.sold - agg.buy - agg.ret, sold: agg.sold, ret: agg.ret, buy: agg.buy, newStock: 0 });
            }
            setRows(built);
        } catch (e: any) {
            console.error('Failed to build movement summary:', e);
            showToast('Failed to build summary: ' + e.message, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // Re-seed the period and refetch every time the popup opens.
    useEffect(() => {
        if (isOpen) {
            const seed = initialRange || { start: '', end: '' };
            setRange(seed);
            fetchSummary(seed);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const hasMovement = (r: MovementSummaryRow) => r.sold > 0 || r.ret > 0 || r.buy > 0;
    const movementCount = useMemo(() => rows.filter(hasMovement).length, [rows]);

    const displayedRows = useMemo(() => {
        let out = onlyMovement ? rows.filter(hasMovement) : rows;
        if (sort) {
            const { key, direction } = sort;
            out = [...out].sort((a, b) => {
                const av = a[key], bv = b[key];
                const cmp = typeof av === 'string' || typeof bv === 'string'
                    ? String(av).localeCompare(String(bv))
                    : (av as number) - (bv as number);
                return direction === 'asc' ? cmp : -cmp;
            });
        }
        return out;
    }, [rows, onlyMovement, sort]);

    // Footer totals always match what's on screen (and what exports).
    const totals = useMemo(() => displayedRows.reduce(
        (acc, r) => ({
            oldStock: acc.oldStock + r.oldStock,
            sold: acc.sold + r.sold,
            ret: acc.ret + r.ret,
            buy: acc.buy + r.buy,
            newStock: acc.newStock + r.newStock
        }),
        { oldStock: 0, sold: 0, ret: 0, buy: 0, newStock: 0 }
    ), [displayedRows]);

    const exportSummary = () => {
        if (displayedRows.length === 0) return;
        const exportData = displayedRows.map(r => ({
            'Model': r.name, 'Old Stock': r.oldStock, 'Sold': r.sold,
            'Return': r.ret, 'Buy': r.buy, 'New Stock': r.newStock
        }));
        exportData.push({ 'Model': 'Total', 'Old Stock': totals.oldStock, 'Sold': totals.sold, 'Return': totals.ret, 'Buy': totals.buy, 'New Stock': totals.newStock });
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Movement Summary');
        XLSX.writeFile(wb, `Movement_Summary_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    if (!isOpen) return null;

    const rangeLabel = range.start || range.end
        ? `${range.start || '…'} → ${range.end || '…'}`
        : 'All time';

    const numTd: React.CSSProperties = { padding: '9px 14px', textAlign: 'center', fontSize: '13px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border)' };
    const pill = (bg: string, color: string): React.CSSProperties => ({ display: 'inline-block', minWidth: '36px', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700, background: bg, color });
    const zero = <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>0</span>;
    const thBase: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, padding: '10px 14px', background: 'var(--color-bg)', borderBottom: '2px solid var(--color-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', textAlign: 'center', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
    const footTd: React.CSSProperties = { ...numTd, position: 'sticky', bottom: 0, background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)', borderBottom: 'none', fontWeight: 800, padding: '11px 14px' };
    const chip = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, background: active ? 'var(--color-primary)' : '#FFFFFF', color: active ? 'white' : 'var(--color-text-secondary)', cursor: 'pointer', transition: 'all 0.15s' });
    // Every header is clickable — show a faint ↕ on inactive columns so
    // sortability is visible, and a solid ↑ / ↓ on the active one.
    const arrow = (key: keyof MovementSummaryRow) => sort?.key === key
        ? <span style={{ marginLeft: '4px' }}>{sort.direction === 'asc' ? '↑' : '↓'}</span>
        : <span style={{ marginLeft: '4px', opacity: 0.35 }}>↕</span>;
    const toggleSort = (key: keyof MovementSummaryRow) => setSort(prev => prev?.key === key ? (prev.direction === 'asc' ? { key, direction: 'desc' } : null) : { key, direction: 'asc' });

    return (
        <div
            onClick={onClose}
            style={{
                // Below the DateRangePicker portal (z 9999) so the calendar
                // opens ON TOP of this popup instead of hiding behind it.
                position: 'fixed', inset: 0, zIndex: 9000,
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: isMobile ? '12px' : '24px',
                animation: 'fadeIn 0.2s ease',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: '#FFFFFF', borderRadius: '20px',
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
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.07), rgba(37,99,235,0.03))', gap: '10px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '13px', minWidth: 0 }}>
                        <div style={{
                            width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                            background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
                        }}>
                            <Table2 size={20} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#111827' }}>Stock Movement Summary</h2>
                            <p style={{ fontSize: '12px', color: '#6B7280', margin: '2px 0 0 0' }}>
                                {rangeLabel}
                                {warehouseId && ` · ${warehouses.find(w => w.id === warehouseId)?.name || ''}`}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <div style={{ background: '#FFFFFF', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '2px' }}>
                            <DateRangePicker
                                compact={isMobile}
                                value={range}
                                onChange={(v) => { setRange(v); fetchSummary(v); }}
                            />
                        </div>
                        {(range.start || range.end) && (
                            <button
                                onClick={() => { const all = { start: '', end: '' }; setRange(all); fetchSummary(all); }}
                                style={{
                                    padding: '8px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                                    border: '1px solid var(--color-border)', background: '#FFFFFF',
                                    color: '#6B7280', cursor: 'pointer', whiteSpace: 'nowrap'
                                }}
                            >
                                All time
                            </button>
                        )}
                        <button onClick={exportSummary} title="Export to Excel" style={{
                            display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px',
                            borderRadius: '10px', border: '1px solid var(--color-border)',
                            background: 'var(--color-bg)', color: '#111827', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                        }}>
                            <Download size={14} /> {!isMobile && 'Export'}
                        </button>
                        <button onClick={onClose} style={{
                            background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                            cursor: 'pointer', color: '#6B7280', width: '34px', height: '34px',
                            borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* View toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: isMobile ? '10px 12px' : '12px 22px', borderBottom: '1px solid var(--color-border)', background: '#FFFFFF', flexShrink: 0 }}>
                    <button onClick={() => setOnlyMovement(false)} style={chip(!onlyMovement)}>
                        All Products ({rows.length})
                    </button>
                    <button onClick={() => setOnlyMovement(true)} style={chip(onlyMovement)}>
                        With Movement ({movementCount})
                    </button>
                </div>

                {/* Body */}
                <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                    {isLoading ? (
                        <div style={{ padding: '60px', textAlign: 'center', color: '#6B7280' }}>
                            <RefreshCw size={28} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
                            Building summary…
                        </div>
                    ) : displayedRows.length === 0 ? (
                        <div style={{ padding: '48px', textAlign: 'center', color: '#6B7280', fontSize: '13px' }}>
                            No products with movement in this period.
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: '560px', background: '#FFFFFF' }}>
                            <thead>
                                <tr>
                                    <th onClick={() => toggleSort('name')} style={{ ...thBase, textAlign: 'left' }}>Model{arrow('name')}</th>
                                    <th onClick={() => toggleSort('oldStock')} style={thBase}>Old Stock{arrow('oldStock')}</th>
                                    <th onClick={() => toggleSort('sold')} style={{ ...thBase, color: '#DC2626' }}>Sold{arrow('sold')}</th>
                                    <th onClick={() => toggleSort('ret')} style={{ ...thBase, color: '#B45309' }}>Return{arrow('ret')}</th>
                                    <th onClick={() => toggleSort('buy')} style={{ ...thBase, color: '#7E22CE' }}>Buy{arrow('buy')}</th>
                                    <th onClick={() => toggleSort('newStock')} style={{ ...thBase, color: '#2563EB' }}>New Stock{arrow('newStock')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedRows.map((r, idx) => {
                                    const moved = hasMovement(r);
                                    const net = r.newStock - r.oldStock;
                                    return (
                                        <tr key={r.id} style={{ background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : '#FFFFFF' }}>
                                            <td style={{ padding: '9px 14px', fontSize: '13px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', color: moved ? 'var(--color-text-main)' : 'var(--color-text-secondary)', borderLeft: `3px solid ${moved ? '#3B82F6' : 'transparent'}`, whiteSpace: 'nowrap', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {r.name}
                                            </td>
                                            <td style={{ ...numTd, color: 'var(--color-text-secondary)' }}>{r.oldStock}</td>
                                            <td style={numTd}>{r.sold > 0 ? <span style={pill('rgba(239,68,68,0.1)', '#DC2626')}>-{r.sold}</span> : zero}</td>
                                            <td style={numTd}>{r.ret > 0 ? <span style={pill('rgba(245,158,11,0.12)', '#B45309')}>+{r.ret}</span> : zero}</td>
                                            <td style={numTd}>{r.buy > 0 ? <span style={pill('rgba(147,51,234,0.1)', '#7E22CE')}>+{r.buy}</span> : zero}</td>
                                            <td style={{ ...numTd, fontWeight: 800, color: 'var(--color-text-main)' }}>
                                                {r.newStock}
                                                {net !== 0 && (
                                                    <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 700, color: net > 0 ? '#059669' : '#DC2626' }}>
                                                        {net > 0 ? `▲${net}` : `▼${Math.abs(net)}`}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td style={{ ...footTd, textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>
                                        Total · {displayedRows.length} {displayedRows.length === 1 ? 'model' : 'models'}
                                    </td>
                                    <td style={{ ...footTd, color: 'var(--color-text-secondary)' }}>{totals.oldStock}</td>
                                    <td style={{ ...footTd, color: '#DC2626' }}>{totals.sold > 0 ? `-${totals.sold}` : 0}</td>
                                    <td style={{ ...footTd, color: '#B45309' }}>{totals.ret > 0 ? `+${totals.ret}` : 0}</td>
                                    <td style={{ ...footTd, color: '#7E22CE' }}>{totals.buy > 0 ? `+${totals.buy}` : 0}</td>
                                    <td style={{ ...footTd, color: '#2563EB' }}>{totals.newStock}</td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>
            </div>
            {/* Entrance animations — defined here so the popup animates on any page. */}
            <style>{`
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
            `}</style>
        </div>
    );
};

export default StockMovementSummaryModal;
