// Inventory Reports — mockup built from reference screenshots, to help
// decide what this app actually needs before any of it is built for real.
// Stock on Hand is wired to real data (products/warehouses/warehouse_stock)
// since that's cheap and makes the mockup genuinely useful. Stock Card and
// Valuation are also real, from the same data plus stock_movements, and are
// costed at FIFO (fifo_inventory_valuation, stock_movements.unit_cost); a
// store without migrations/add_fifo_costing.sql falls back to purchase cost
// and the page says so. FIFO check shows fifo_inventory_check. Expiring
// and Reconciliation have NO backing data at all in this schema (no batch/lot
// expiry tracking, no stock-count workflow) — rather than fake numbers, they
// show what would actually need to be built to populate them.
//
// Bin and Batch columns show "Default" / "—": same honest placeholder this
// app already uses in Stock Adjustments, because there is no real bin or
// batch/lot tracking system behind them.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, FileText, Tag, CalendarClock, CheckCircle2, RefreshCw, Printer, Download, Search, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { supabase } from '../../lib/supabase';
import { dayKeyFromDate, addDays } from '../../utils/dateRange';
import { productWarehouseLines } from '../../utils/stockOnHand';
import { useFifoValuation, fifoUnitCost, fifoMismatchCount, fetchFifoCheck, isMissingColumnError, type FifoCheck, type FifoStatus } from '../../hooks/useFifo';
import type { Product } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { fill, tNow } from '../../i18n/translate';

interface MovementRow {
    id: string;
    type: 'in' | 'out';
    quantity: number;
    unit_price: number;
    unit_cost?: number | null;
    movement_date: string;
    source?: string;
    reference_id?: string;
}

interface ShortLine { id: string; order: string; product: string; quantity: number; short: number; cost: number | null }

type TabKey = 'stock-on-hand' | 'stock-card' | 'valuation' | 'fifo-check' | 'expiring' | 'reconciliation';
const TABS: { key: TabKey; label: string; tKey: string; icon: React.ComponentType<{ size?: number; color?: string }> }[] = [
    { key: 'stock-on-hand', label: 'Stock on Hand', tKey: 'ui.inventory.reports.tabs.stockOnHand', icon: Layers },
    { key: 'stock-card', label: 'Stock Card', tKey: 'ui.inventory.reports.tabs.stockCard', icon: FileText },
    { key: 'valuation', label: 'Valuation', tKey: 'ui.inventory.reports.tabs.valuation', icon: Tag },
    { key: 'fifo-check', label: 'FIFO check', tKey: 'ui.inventory.reports.tabs.fifoCheck', icon: ShieldCheck },
    { key: 'expiring', label: 'Expiring', tKey: 'ui.inventory.reports.tabs.expiring', icon: CalendarClock },
    { key: 'reconciliation', label: 'Reconciliation', tKey: 'ui.inventory.reports.tabs.reconciliation', icon: CheckCircle2 },
];

const fmt = (n: number): string => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayYmd = (): string => dayKeyFromDate(new Date());
const SHORT_LINE_LIMIT = 200;
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

const kpiLabel: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' };
const thStyle: React.CSSProperties = { padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' };
const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'ok' | 'bad' }> = ({ label, value, sub, tone }) => (
    <div style={{ ...cardStyle, padding: '14px 18px' }}>
        <div style={kpiLabel}>{label}</div>
        <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px', fontVariantNumeric: 'tabular-nums', color: tone === 'bad' ? '#DC2626' : tone === 'ok' ? '#059669' : 'var(--color-text-main)' }}>{value}</div>
        {sub && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>{sub}</div>}
    </div>
);

// Which cost the Stock on Hand and Valuation figures use.
const CostBasisNote: React.FC<{ status: FifoStatus; message: string | null; mismatches: number; onCheck: () => void }> = ({ status, message, mismatches, onCheck }) => {
    const { t } = useLanguage();
    if (status === 'loading') return <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: 0 }}>{t('ui.inventory.reports.loadingFifo')}</p>;
    if (status !== 'ready') {
        return (
            <p style={{ fontSize: '12px', color: '#B45309', margin: 0, maxWidth: '680px' }}>
                {t('ui.inventory.reports.valuedPurchase')} {message}
            </p>
        );
    }
    return (
        <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: 0, maxWidth: '680px' }}>
            {t('ui.inventory.reports.valuedFifo')}
            {mismatches > 0 && (
                <span style={{ color: '#B45309' }}>
                    {' '}{fill(mismatches === 1 ? t('ui.inventory.reports.mismatchEstimateOne') : t('ui.inventory.reports.mismatchEstimateMany'), { n: mismatches })}{' '}
                    <button onClick={onCheck} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>{t('ui.inventory.reports.seeFifoCheck')}</button>.
                </span>
            )}
        </p>
    );
};

const InventoryReportsPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const { products, warehouses, warehouseStock, categories, isLoading, refreshData } = useStore();
    const stockSignature = useMemo(() => products.map(p => `${p.id}:${p.stock}`).join('|'), [products]);
    const fifo = useFifoValuation(true, stockSignature);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>{t('ui.inventory.reports.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>{t('ui.inventory.reports.subtitle')}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

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

    const filteredProducts = useMemo(() => {
        const q = search.trim().toLowerCase();
        return activeProducts.filter(p => {
            if (category && p.category !== category) return false;
            if (q && !(p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || (p.model || '').toLowerCase().includes(q))) return false;
            return true;
        });
    }, [activeProducts, category, search]);

    // Rule (INV-1): products.stock is the authoritative company total (every
    // flow maintains it), while warehouse_stock is written only by the flows
    // that record a warehouse (posted stock adjustments, wholesale, A/R
    // restocks, stock movements) — retail orders and PO receipts don't touch
    // it, so a product's warehouse rows go stale the moment those flows move
    // it. The old report trusted warehouse_stock outright whenever a product
    // had any row there, showing old quantities and valuations. Now each
    // product's rows are its tracked warehouse figures PLUS an explicit
    // "Unassigned" remainder, so the lines always sum to the real company
    // stock (see productWarehouseLines). A single-warehouse view can only
    // show the tracked figure — the note under the filter says so.
    const stockLines = useMemo<StockLine[]>(() => {
        const lines: StockLine[] = [];
        for (const p of filteredProducts) {
            const purchaseCost = Number(p.purchaseCost) || 0;
            // FIFO is company-wide: a warehouse line uses the product's average layer cost.
            const unitCost = fifo.status === 'ready' ? fifoUnitCost(fifo.rows.get(p.id), purchaseCost) : purchaseCost;
            if (warehouseId) {
                const qty = warehouseStockByProductAndWarehouse.get(`${p.id}::${warehouseId}`) || 0;
                if (qty !== 0) lines.push({ product: p, warehouseName: warehouses.find(w => w.id === warehouseId)?.name || t('ui.inventory.unknown'), qty, unitCost });
                continue;
            }
            const tracked = warehouses.map(w => ({
                warehouseId: w.id,
                warehouseName: w.name,
                qty: warehouseStockByProductAndWarehouse.get(`${p.id}::${w.id}`) || 0,
            }));
            for (const entry of productWarehouseLines(Number(p.stock) || 0, tracked)) {
                lines.push({ product: p, warehouseName: entry.warehouseName, qty: entry.qty, unitCost });
            }
        }
        return lines;
    }, [filteredProducts, warehouseId, warehouses, warehouseStockByProductAndWarehouse, fifo.status, fifo.rows, t]);

    const fifoMismatches = useMemo(() => fifo.status === 'ready' ? fifoMismatchCount(fifo.rows, filteredProducts.map(p => p.id)) : 0, [fifo.status, fifo.rows, filteredProducts]);
    const costBasisNote = <CostBasisNote status={fifo.status} message={fifo.message} mismatches={fifoMismatches} onCheck={() => setTab('fifo-check')} />;

    // Shown whenever a single warehouse is selected (Stock on Hand + Valuation).
    const warehouseCaveat = warehouseId ? (
        <p style={{ fontSize: '12px', color: '#B45309', margin: 0, maxWidth: '680px' }}>
            {t('ui.inventory.reports.warehouseCaveat')}
        </p>
    ) : null;

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
            const query = (columns: string) => supabase
                .from('stock_movements')
                .select(columns)
                .eq('product_id', productId)
                .gte('movement_date', since)
                .order('movement_date', { ascending: true });
            let { data, error } = await query('id, type, quantity, unit_price, unit_cost, movement_date, source, reference_id');
            if (error && isMissingColumnError(error, 'unit_cost')) {
                ({ data, error } = await query('id, type, quantity, unit_price, movement_date, source, reference_id'));
            }
            if (error) throw error;
            setCardMovements((data || []) as unknown as MovementRow[]);
        } catch (e) {
            console.error('Failed to fetch the stock card:', e);
            showToast(tNow('ui.inventory.reports.cardLoadFailed'), 'error');
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
            // unit_price is the selling price on order stock-outs, so it is
            // shown as a cost only for stock in recorded before FIFO.
            const recorded = m.unit_cost === null || m.unit_cost === undefined ? null : Number(m.unit_cost);
            const unitCost = recorded !== null && Number.isFinite(recorded)
                ? recorded
                : (m.type === 'in' && Number(m.unit_price) > 0 ? Number(m.unit_price) : null);
            return { ...m, delta, running, unitCost, costRecorded: recorded !== null };
        });
    }, [cardMovements]);
    const cardHasUncosted = cardRows.some(r => !r.costRecorded);

    // ── FIFO check ──
    const [check, setCheck] = useState<{ status: FifoStatus; data: FifoCheck | null; message: string | null }>({ status: 'loading', data: null, message: null });
    const [shortLines, setShortLines] = useState<{ retail: ShortLine[]; wholesale: ShortLine[]; message: string | null }>({ retail: [], wholesale: [], message: null });
    const loadCheck = useCallback(async () => {
        setCheck(c => ({ ...c, status: 'loading' }));
        const res = await fetchFifoCheck().catch(e => ({ status: 'error' as const, data: null, message: tNow('ui.inventory.reports.checkFailed', { msg: e instanceof Error ? e.message : String(e) }) }));
        setCheck(res);
        if (res.status !== 'ready' || !res.data) { setShortLines({ retail: [], wholesale: [], message: null }); return; }
        const { retail_lines, wholesale_lines } = res.data.shortfall;
        const [r, w] = await Promise.all([
            retail_lines > 0
                ? supabase.from('sale_items').select('id, sale_id, product_id, name, quantity, cogs_short_qty, cogs_cost').gt('cogs_short_qty', 0).order('sale_id').limit(SHORT_LINE_LIMIT)
                : Promise.resolve({ data: [], error: null }),
            wholesale_lines > 0
                ? supabase.from('wholesale_order_items').select('id, wholesale_order_id, product_id, product_name, quantity, cogs_short_qty, cogs_cost').gt('cogs_short_qty', 0).eq('cogs_backfill', false).order('wholesale_order_id').limit(SHORT_LINE_LIMIT)
                : Promise.resolve({ data: [], error: null }),
        ]);
        const toNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
        setShortLines({
            retail: ((r.data || []) as Record<string, unknown>[]).map(x => ({ id: String(x.id), order: String(x.sale_id ?? ''), product: String(x.name || x.product_id || ''), quantity: Number(x.quantity) || 0, short: Number(x.cogs_short_qty) || 0, cost: toNum(x.cogs_cost) })),
            wholesale: ((w.data || []) as Record<string, unknown>[]).map(x => ({ id: String(x.id), order: String(x.wholesale_order_id ?? ''), product: String(x.product_name || x.product_id || ''), quantity: Number(x.quantity) || 0, short: Number(x.cogs_short_qty) || 0, cost: toNum(x.cogs_cost) })),
            message: r.error || w.error ? tNow('ui.inventory.reports.shortListFailed', { msg: (r.error || w.error)?.message || tNow('ui.inventory.unknownError') }) : null,
        });
    }, []);
    useEffect(() => { if (tab === 'fifo-check') loadCheck(); }, [tab, loadCheck]);
    const productLabel = useMemo(() => new Map(products.map(p => [p.id, p.sku || p.model || ''])), [products]);

    // ── Valuation: grouped by category ──
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
        const { tKey, icon: Icon } = TABS.find(tb => tb.key === tabKey)!;
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
                <Icon size={16} color={active ? 'var(--color-primary)' : 'var(--color-text-secondary)'} /> {t(tKey)}
            </button>
        );
    };

    return (
        <div className="acct-page" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
            <div style={{ width: '210px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {TABS.map(tb => <NavBtn key={tb.key} tabKey={tb.key} />)}
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {tab === 'stock-on-hand' && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                            <div>
                                <label style={labelStyle}>{t('ui.inventory.warehouse')}</label>
                                <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                    <option value="">{t('ui.inventory.allWarehouses')}</option>
                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>{t('inventory.category')}</label>
                                <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                    <option value="">{t('ui.inventory.filter.allCategories')}</option>
                                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: '1 1 220px', maxWidth: '280px' }}>
                                <label style={labelStyle}>{t('common.search')}</label>
                                <div style={{ position: 'relative' }}>
                                    <Search size={14} color="var(--color-text-muted)" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                                    <input type="text" placeholder={t('ui.inventory.reports.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, width: '100%', paddingLeft: '30px', boxSizing: 'border-box' }} />
                                </div>
                            </div>
                            <button onClick={() => { refreshData(); fifo.reload(); }} title={t('ui.inventory.refresh')} style={{ ...inputStyle, cursor: 'pointer', display: 'flex' }}>
                                <RefreshCw size={15} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                            </button>
                            <button onClick={printList} style={btnStyle}><Printer size={14} /> {t('ui.inventory.reports.printList')}</button>
                            <button onClick={exportCsv} style={btnStyle}><Download size={14} /> {t('ui.inventory.exportCsv')}</button>
                        </div>

                        {warehouseCaveat}
                        {costBasisNote}

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px' }}>
                            <div style={{ ...cardStyle, padding: '14px 18px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.lines')}</div>
                                <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>{stockLines.length}</div>
                            </div>
                            <div style={{ ...cardStyle, padding: '14px 18px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.totalQty')}</div>
                                <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>{fmt(totalQty)}</div>
                            </div>
                            <div style={{ ...cardStyle, padding: '14px 18px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.stats.totalValue')}</div>
                                <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>{fmt(totalValue)}</div>
                            </div>
                        </div>

                        <div style={{ ...cardStyle, overflow: 'hidden' }}>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('ui.inventory.priceList.product')}</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('ui.inventory.warehouse')}</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('ui.inventory.reports.bin')}</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('ui.inventory.reports.batch')}</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>{t('ui.inventory.reports.qty')}</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>{t('ui.inventory.reports.unitCost')}</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>{t('ui.inventory.reports.value')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {isLoading ? (
                                            <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.loading')}</td></tr>
                                        ) : stockLines.length === 0 ? (
                                            <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.noStockMatch')}</td></tr>
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
                                                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.defaultBin')}</td>
                                                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>—</td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                                        <div style={{ fontWeight: 700, color: below ? '#D97706' : 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.qty)} <span style={{ fontWeight: 400, fontSize: '11px', color: 'var(--color-text-secondary)' }}>PCS</span></div>
                                                        {below && <div style={{ fontSize: '11px', color: '#D97706', fontWeight: 600 }}>{fill(t('ui.inventory.reports.belowReorder'), { n: fmt(reorder) })}</div>}
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
                            <label style={labelStyle}>{t('ui.inventory.priceList.product')}</label>
                            <select value={cardProductId} onChange={e => setCardProductId(e.target.value)} style={{ ...inputStyle, minWidth: '280px', cursor: 'pointer' }}>
                                <option value="">{t('ui.inventory.reports.selectProduct')}</option>
                                {activeProducts.map(p => <option key={p.id} value={p.id}>{p.sku ? `${p.sku} · ` : ''}{p.name}</option>)}
                            </select>
                        </div>
                        <div style={{ ...cardStyle, overflow: 'hidden' }}>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('orders.date')}</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('ui.inventory.reports.type')}</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('ui.inventory.reports.source')}</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>{t('ui.inventory.reports.qty')}</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>{t('ui.inventory.reports.unitCost')}</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>{t('orders.balance')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {!cardProductId ? (
                                            <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.chooseProduct')}</td></tr>
                                        ) : cardLoading ? (
                                            <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.loading')}</td></tr>
                                        ) : cardRows.length === 0 ? (
                                            <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.noCardMovements')}</td></tr>
                                        ) : cardRows.map(r => (
                                            <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{r.movement_date}</td>
                                                <td style={{ padding: '12px 16px' }}>
                                                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: '999px', background: r.type === 'in' ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.14)', color: r.type === 'in' ? '#059669' : '#DC2626' }}>{r.type === 'in' ? t('ui.inventory.reports.in') : t('ui.inventory.reports.out')}</span>
                                                </td>
                                                <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>{r.source || '—'}{r.reference_id ? ` · ${r.reference_id}` : ''}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.delta < 0 ? '#DC2626' : 'var(--color-text-main)' }}>{r.delta > 0 ? '+' : ''}{fmt(r.delta)}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.costRecorded ? 'var(--color-text-main)' : 'var(--color-text-secondary)' }} title={r.costRecorded ? t('ui.inventory.reports.costRecordedTitle') : t('ui.inventory.reports.preFifoTitle')}>{r.unitCost === null ? '—' : fmt(r.unitCost)}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.running)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        {cardProductId && cardHasUncosted && (
                            <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: 0, maxWidth: '680px' }}>
                                {t('ui.inventory.reports.cardCostNote')}
                            </p>
                        )}
                    </>
                )}

                {tab === 'valuation' && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                            <div>
                                <label style={labelStyle}>{t('ui.inventory.warehouse')}</label>
                                <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                    <option value="">{t('ui.inventory.allWarehouses')}</option>
                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                            </div>
                        </div>
                        {warehouseCaveat}
                        {costBasisNote}
                        <div style={{ ...cardStyle, overflow: 'hidden' }}>
                            {/* Scrolls sideways once a column is dragged wider (the card clips overflow). */}
                            <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('inventory.category')}</th>
                                        <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>{t('ui.inventory.reports.qty')}</th>
                                        <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>{t('ui.inventory.reports.avgUnitCost')}</th>
                                        <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>{t('ui.inventory.reports.value')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {valuationRows.length === 0 ? (
                                        <tr><td colSpan={4} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.noStockToValue')}</td></tr>
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
                                            <td style={{ padding: '12px 16px', fontWeight: 700 }}>{t('common.total')}</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(valuationRows.reduce((s, r) => s + r.qty, 0))}</td>
                                            <td />
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmt(valuationRows.reduce((s, r) => s + r.value, 0))}</td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                            </div>
                        </div>
                    </>
                )}

                {tab === 'fifo-check' && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <button onClick={loadCheck} style={btnStyle} disabled={check.status === 'loading'}>
                                <RefreshCw size={14} style={check.status === 'loading' ? { animation: 'spin 1s linear infinite' } : {}} /> {t('ui.inventory.reports.runCheck')}
                            </button>
                            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                {t('ui.inventory.reports.checkHelp')}
                            </span>
                        </div>

                        {check.status === 'loading' && !check.data ? (
                            <div style={{ ...cardStyle, padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>{t('ui.inventory.reports.runningCheck')}</div>
                        ) : check.status === 'missing' || check.status === 'error' || !check.data ? (
                            <EmptyConcept icon={ShieldCheck} title={check.status === 'missing' ? t('ui.inventory.reports.fifoNotSetUp') : t('ui.inventory.reports.checkCouldNotRun')} body={check.message || t('ui.inventory.reports.unknownErrorCap')} />
                        ) : (() => {
                            const c = check.data;
                            const balanced = Math.abs(c.variance) < 0.005;
                            const shortLinesTotal = c.shortfall.retail_lines + c.shortfall.wholesale_lines;
                            const allClear = balanced && c.product_mismatches === 0 && shortLinesTotal === 0 && c.inventory_account_found;
                            const recon: { label: string; help: string; amount: number; sign: '+' | '−' | '' ; strong?: boolean }[] = [
                                { label: t('ui.inventory.reports.recon.layers'), help: fill(t('ui.inventory.reports.nUnits'), { n: fmt(c.pool_units) }), amount: c.pool_value, sign: '' },
                                { label: t('ui.inventory.reports.recon.shippedNotBooked'), help: t('ui.inventory.reports.recon.shippedNotBookedHelp'), amount: c.retail_out_unbooked, sign: '+' },
                                { label: t('ui.inventory.reports.recon.bookedNotShipped'), help: t('ui.inventory.reports.recon.bookedNotShippedHelp'), amount: c.retail_booked_not_out, sign: '−' },
                                { label: t('ui.inventory.reports.recon.costChange'), help: t('ui.inventory.reports.recon.costChangeHelp'), amount: c.retail_booked_out_diff, sign: '+' },
                                { label: t('ui.inventory.reports.recon.expected'), help: '', amount: c.expected_1300, sign: '', strong: true },
                                { label: t('ui.inventory.reports.recon.ledger'), help: fill(t('ui.inventory.reports.recon.ledgerHelp'), { n: fmt(c.ledger_1300_posted) }), amount: c.ledger_1300, sign: '', strong: true },
                            ];
                            return (
                                <>
                                    <div style={{ ...cardStyle, padding: '12px 16px', display: 'flex', gap: '10px', alignItems: 'flex-start', borderColor: allClear ? 'rgba(16,185,129,0.45)' : 'rgba(245,158,11,0.55)', background: allClear ? 'rgba(16,185,129,0.07)' : 'rgba(245,158,11,0.08)' }}>
                                        {allClear ? <CheckCircle2 size={18} color="#059669" /> : <AlertTriangle size={18} color="#D97706" />}
                                        <div style={{ fontSize: '13px', color: 'var(--color-text-main)', lineHeight: 1.5 }}>
                                            {allClear ? t('ui.inventory.reports.allClear') : (
                                                <>
                                                    <strong>{t('ui.inventory.reports.needsAttention')}</strong>{' '}
                                                    {[
                                                        !balanced && fill(c.variance > 0 ? t('ui.inventory.reports.ledgerAbove') : t('ui.inventory.reports.ledgerBelow'), { amount: fmt(Math.abs(c.variance)) }),
                                                        c.product_mismatches > 0 && fill(c.product_mismatches === 1 ? t('ui.inventory.reports.mismatchOne') : t('ui.inventory.reports.mismatchMany'), { n: c.product_mismatches }),
                                                        shortLinesTotal > 0 && fill(shortLinesTotal === 1 ? t('ui.inventory.reports.shortOne') : t('ui.inventory.reports.shortMany'), { n: shortLinesTotal }),
                                                        !c.inventory_account_found && t('ui.inventory.reports.noInventoryAccount'),
                                                    ].filter(Boolean).join('; ')}.
                                                    {' '}{t('ui.inventory.reports.draftNote')}
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px' }}>
                                        <Kpi label={t('ui.inventory.reports.kpi.costLayers')} value={fmt(c.pool_value)} sub={fill(t('ui.inventory.reports.kpi.unitsInStock'), { n: fmt(c.pool_units) })} />
                                        <Kpi label={t('ui.inventory.reports.kpi.expected')} value={fmt(c.expected_1300)} sub={t('ui.inventory.reports.kpi.expectedSub')} />
                                        <Kpi label={t('ui.inventory.reports.kpi.ledger')} value={fmt(c.ledger_1300)} sub={fill(t('ui.inventory.reports.kpi.postedOnly'), { n: fmt(c.ledger_1300_posted) })} />
                                        <Kpi label={t('ui.inventory.reports.variance')} value={fmt(c.variance)} sub={t('ui.inventory.reports.kpi.varianceSub')} tone={balanced ? 'ok' : 'bad'} />
                                    </div>

                                    <div style={{ ...cardStyle, overflow: 'hidden' }}>
                                        <div style={{ padding: '14px 16px 4px', fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>{t('ui.inventory.reports.reconTitle')}</div>
                                        <table data-resize="off" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                            <tbody>
                                                {recon.map(row => (
                                                    <tr key={row.label} style={{ borderTop: row.strong ? '2px solid var(--color-border)' : '1px solid var(--color-border)' }}>
                                                        <td style={{ padding: '10px 16px', width: '28px', color: 'var(--color-text-secondary)', fontWeight: 700 }}>{row.sign}</td>
                                                        <td style={{ padding: '10px 16px 10px 0' }}>
                                                            <div style={{ fontWeight: row.strong ? 700 : 600, color: 'var(--color-text-main)' }}>{row.label}</div>
                                                            {row.help && <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{row.help}</div>}
                                                        </td>
                                                        <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: row.strong ? 800 : 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(row.amount)}</td>
                                                    </tr>
                                                ))}
                                                <tr style={{ borderTop: '1px solid var(--color-border)', background: balanced ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)' }}>
                                                    <td style={{ padding: '10px 16px' }} />
                                                    <td style={{ padding: '10px 16px 10px 0', fontWeight: 700, color: 'var(--color-text-main)' }}>{t('ui.inventory.reports.variance')}</td>
                                                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: balanced ? '#059669' : '#DC2626' }}>{fmt(c.variance)}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    <div style={{ ...cardStyle, overflow: 'hidden' }}>
                                        <div style={{ padding: '14px 16px 4px', fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>{t('ui.inventory.reports.layersTitle')}</div>
                                        <div style={{ padding: '0 16px 10px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.layersHelp')}</div>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid var(--color-border)', borderTop: '1px solid var(--color-border)' }}>
                                                        <th style={thStyle}>{t('ui.inventory.priceList.product')}</th>
                                                        <th style={{ ...thStyle, textAlign: 'right' }}>{t('inventory.stock')}</th>
                                                        <th style={{ ...thStyle, textAlign: 'right' }}>{t('ui.inventory.reports.layers')}</th>
                                                        <th style={{ ...thStyle, textAlign: 'right' }}>{t('ui.inventory.reports.difference')}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {c.products.length === 0 ? (
                                                        <tr><td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.allLayersMatch')}</td></tr>
                                                    ) : c.products.map(p => (
                                                        <tr key={p.product_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                            <td style={{ padding: '10px 16px' }}>
                                                                <div style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>{p.name}</div>
                                                                {productLabel.get(p.product_id) && <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{productLabel.get(p.product_id)}</div>}
                                                            </td>
                                                            <td style={{ padding: '10px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(p.stock)}</td>
                                                            <td style={{ padding: '10px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(p.pool_qty)}</td>
                                                            <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#D97706' }}>{p.pool_qty - p.stock > 0 ? '+' : ''}{fmt(p.pool_qty - p.stock)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    <div style={{ ...cardStyle, overflow: 'hidden' }}>
                                        <div style={{ padding: '14px 16px 4px', fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)' }}>{t('ui.inventory.reports.shortTitle')}</div>
                                        <div style={{ padding: '0 16px 10px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                            {t('ui.inventory.reports.shortHelp')}
                                            {' '}{fill(t('ui.inventory.reports.shortCounts'), { rl: fmt(c.shortfall.retail_lines), rlWord: c.shortfall.retail_lines === 1 ? t('ui.inventory.reports.lineOne') : t('ui.inventory.reports.lineMany'), rq: fmt(c.shortfall.retail_qty), wl: fmt(c.shortfall.wholesale_lines), wlWord: c.shortfall.wholesale_lines === 1 ? t('ui.inventory.reports.lineOne') : t('ui.inventory.reports.lineMany'), wq: fmt(c.shortfall.wholesale_qty) })}
                                        </div>
                                        {c.shortfall.wholesale_backfill_lines > 0 && (
                                            <div style={{ padding: '0 16px 10px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                {fill(t('ui.inventory.reports.backfillNote'), { n: fmt(c.shortfall.wholesale_backfill_lines), lineWord: c.shortfall.wholesale_backfill_lines === 1 ? t('ui.inventory.reports.lineOne') : t('ui.inventory.reports.lineMany'), q: fmt(c.shortfall.wholesale_backfill_qty), cost: fmt(c.shortfall.wholesale_backfill_cost) })}
                                            </div>
                                        )}
                                        {shortLines.message && <div style={{ padding: '0 16px 10px', fontSize: '12px', color: '#B45309' }}>{shortLines.message}</div>}
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid var(--color-border)', borderTop: '1px solid var(--color-border)' }}>
                                                        <th style={thStyle}>{t('ui.inventory.reports.kind')}</th>
                                                        <th style={thStyle}>{t('ui.inventory.reports.order')}</th>
                                                        <th style={thStyle}>{t('ui.inventory.priceList.product')}</th>
                                                        <th style={{ ...thStyle, textAlign: 'right' }}>{t('ui.inventory.reports.qty')}</th>
                                                        <th style={{ ...thStyle, textAlign: 'right' }}>{t('ui.inventory.reports.short')}</th>
                                                        <th style={{ ...thStyle, textAlign: 'right' }}>{t('ui.inventory.reports.lineCost')}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {shortLinesTotal === 0 ? (
                                                        <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.noShort')}</td></tr>
                                                    ) : [...shortLines.retail.map(l => ({ ...l, kind: 'Retail' })), ...shortLines.wholesale.map(l => ({ ...l, kind: 'Wholesale' }))].map(l => (
                                                        <tr key={`${l.kind}-${l.id}`} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                            <td style={{ padding: '10px 16px', color: 'var(--color-text-secondary)' }}>{l.kind === 'Retail' ? t('ui.inventory.reports.retail') : t('ui.inventory.summary.wholesale')}</td>
                                                            <td style={{ padding: '10px 16px', color: 'var(--color-text-main)', fontSize: '12px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.order}>{l.order || '—'}</td>
                                                            <td style={{ padding: '10px 16px', color: 'var(--color-text-main)' }}>{l.product || '—'}</td>
                                                            <td style={{ padding: '10px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.quantity)}</td>
                                                            <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: '#D97706', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.short)}</td>
                                                            <td style={{ padding: '10px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.cost === null ? '—' : fmt(l.cost)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        {(shortLines.retail.length >= SHORT_LINE_LIMIT || shortLines.wholesale.length >= SHORT_LINE_LIMIT) && (
                                            <div style={{ padding: '10px 16px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{fill(t('ui.inventory.reports.showingFirst'), { n: SHORT_LINE_LIMIT })}</div>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </>
                )}

                {tab === 'expiring' && (
                    <EmptyConcept
                        icon={CalendarClock}
                        title={t('ui.inventory.reports.noExpiryTitle')}
                        body={t('ui.inventory.reports.noExpiryBody')}
                    />
                )}

                {tab === 'reconciliation' && (
                    <EmptyConcept
                        icon={CheckCircle2}
                        title={t('ui.inventory.reports.noCountsTitle')}
                        body={t('ui.inventory.reports.noCountsBody')}
                        actionLabel={t('ui.inventory.reports.startCount')}
                        onAction={() => showToast(t('ui.inventory.reports.countMock'), 'info')}
                    />
                )}
            </div>
        </div>
    );
};

export default InventoryReportsPage;
