// Stock Adjustments (Inventory → Adjust Stock): opening balances,
// corrections and write-offs, Draft until Posted the same way Journal
// Entries are. Posting is what actually moves warehouse_stock/products.stock
// and books a ledger entry (see src/hooks/useStockAdjustments.ts) — saving
// here only ever creates a Draft.
//
// Bin and Batch are lightweight, UI-only fields: this app has no real bin-
// location or lot/batch-tracking system, so Bin is just "Default" and Batch
// is free text, kept for whoever wants a note to find stock by later.
// Removal lines are costed by posting at FIFO (the oldest layers); the form
// shows that cost from fifo_peek and saves it as the draft's estimate. Only a
// store without migrations/add_fifo_costing.sql asks for a unit cost on a
// removal, pre-filled from the product's purchase cost.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, RefreshCw, Printer, Download, Eye, X, Trash2, Upload, Pencil } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useStockAdjustments } from '../../hooks/useStockAdjustments';
import DataImportModal from '../../components/DataImportModal';
import { dayKeyFromDate } from '../../utils/dateRange';
import { fetchFifoPeek, FIFO_MISSING_MESSAGE, type FifoPeekResult } from '../../hooks/useFifo';
import type { StockAdjustment, StockAdjustmentReason } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { fill } from '../../i18n/translate';

const REASONS: StockAdjustmentReason[] = ['Opening balance', 'Stock correction', 'Damaged goods', 'Expired goods', 'Theft / loss', 'Sample / giveaway', 'Other'];
// Display labels only: the stored reason stays the English value above.
const REASON_KEYS: Partial<Record<StockAdjustmentReason, string>> = {
    'Count correction': 'ui.inventory.reasons.countCorrection',
    'Loss/Damage': 'ui.inventory.adjust.reasons.lossDamage',
    'Opening balance': 'ui.inventory.adjust.reasons.opening',
    'Stock correction': 'ui.inventory.adjust.reasons.correction',
    'Damaged goods': 'ui.inventory.adjust.reasons.damaged',
    'Expired goods': 'ui.inventory.adjust.reasons.expired',
    'Theft / loss': 'ui.inventory.adjust.reasons.theft',
    'Sample / giveaway': 'ui.inventory.adjust.reasons.sample',
    'Other': 'ui.inventory.adjust.reasons.other',
};
const todayYmd = (): string => dayKeyFromDate(new Date());
const fmt = (n: number): string => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const genKey = (): string => Math.random().toString(36).slice(2);
const netValueOf = (a: StockAdjustment): number => (a.lines || []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);

// ADJ-YYYYMMDD-NNN: a display-only reference, not stored — ranked by
// created_at within the same adjustment_date, same convention as this
// session's other ADJ/PAY/RCP-style references.
function referenceOf(adjustment: StockAdjustment, all: StockAdjustment[]): string {
    const ymd = (adjustment.adjustment_date || '').replace(/-/g, '');
    const sameDay = all.filter(a => a.adjustment_date === adjustment.adjustment_date)
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    const idx = sameDay.findIndex(a => a.id === adjustment.id);
    return `ADJ-${ymd}-${String(idx + 1).padStart(3, '0')}`;
}

const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' };
const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px',
    border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
    padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
    fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)'
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' };

interface DraftLine { key: string; product_id: string; bin: string; quantity: string; unit_cost: string; batch: string }
const emptyLine = (): DraftLine => ({ key: genKey(), product_id: '', bin: 'Default', quantity: '', unit_cost: '', batch: '' });

const AdjustStockPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { products, warehouses, currentUser, refreshData, defaultWarehouseId } = useStore();
    const { adjustments, isLoading, schemaReady, fetchAdjustments, saveAdjustment, updateAdjustment, deleteAdjustment, postAdjustment } = useStockAdjustments();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const reasonLabel = (r: string): string => { const k = REASON_KEYS[r as StockAdjustmentReason]; return k ? t(k) : r; };
    const statusLabel = (s: string): string => s === 'Posted' ? t('ui.inventory.adjust.status.posted') : s === 'Draft' ? t('ui.inventory.adjust.status.draft') : s;

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>{t('ui.inventory.adjust.title')}</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', margin: 0 }}>{t('ui.inventory.adjust.subtitle')}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    useEffect(() => { fetchAdjustments(); }, [fetchAdjustments]);

    const activeProducts = useMemo(() => products.filter(p => p.isActive !== false), [products]);
    const warehouseName = useCallback((id?: string) => warehouses.find(w => w.id === id)?.name || t('ui.inventory.adjust.unknownWarehouse'), [warehouses, t]);

    // ── List filters ──
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [reasonFilter, setReasonFilter] = useState('all');

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return adjustments.filter(a => {
            if (statusFilter !== 'all' && a.status !== statusFilter) return false;
            if (reasonFilter !== 'all' && a.reason !== reasonFilter) return false;
            if (q) {
                const ref = referenceOf(a, adjustments).toLowerCase();
                if (!ref.includes(q) && !(a.notes || '').toLowerCase().includes(q)) return false;
            }
            return true;
        });
    }, [adjustments, search, statusFilter, reasonFilter]);

    // ── Create modal ──
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [warehouseId, setWarehouseId] = useState('');
    const [date, setDate] = useState(() => todayYmd());
    const [reason, setReason] = useState<StockAdjustmentReason>('Opening balance');
    const [notes, setNotes] = useState('');
    const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // When set, the modal edits this Draft in place instead of creating a new one.
    const [editingId, setEditingId] = useState<string | null>(null);

    const openCreate = () => {
        setEditingId(null);
        setWarehouseId(defaultWarehouseId || warehouses[0]?.id || '');
        setDate(todayYmd());
        setReason('Opening balance');
        setNotes('');
        setLines([emptyLine()]);
        setIsCreateOpen(true);
    };

    const openEdit = (a: StockAdjustment) => {
        if (a.status !== 'Draft') { showToast(t('ui.inventory.adjust.toast.cantEdit'), 'info'); return; }
        setEditingId(a.id);
        setWarehouseId(a.warehouse_id || '');
        setDate(a.adjustment_date);
        setReason(a.reason);
        setNotes(a.notes || '');
        setLines((a.lines || []).map(l => ({
            key: genKey(),
            product_id: l.product_id || '',
            bin: l.bin || 'Default',
            quantity: String(l.quantity ?? ''),
            unit_cost: String(l.unit_cost ?? ''),
            batch: l.batch || '',
        })));
        setViewingId(null);
        setIsCreateOpen(true);
    };

    // ── FIFO peek for removal lines ──
    const peekKey = (productId: string, qty: number) => `${productId}|${qty}`;
    const removalQty = (l: DraftLine): number => {
        const q = parseFloat(l.quantity);
        return l.product_id && Number.isInteger(q) && q < 0 ? -q : 0;
    };
    const peekRequests = useRef(new Map<string, Promise<FifoPeekResult>>());
    const [peeks, setPeeks] = useState<Record<string, FifoPeekResult | 'loading'>>({});
    const [fifoMissing, setFifoMissing] = useState(false);
    const getPeek = useCallback((productId: string, qty: number): Promise<FifoPeekResult> => {
        const key = peekKey(productId, qty);
        let req = peekRequests.current.get(key);
        if (!req) {
            req = fetchFifoPeek(productId, qty).catch(e => ({ ok: false as const, missing: false, message: e instanceof Error ? e.message : String(e) }));
            peekRequests.current.set(key, req);
            setPeeks(prev => ({ ...prev, [key]: 'loading' }));
            req.then(res => {
                // A failed read is retried on the next change or save.
                if (!res.ok && !res.missing) peekRequests.current.delete(key);
                if (!res.ok && res.missing) setFifoMissing(true);
                setPeeks(prev => ({ ...prev, [key]: res }));
            });
        }
        return req;
    }, []);
    // Layers move with every sale, so each opening of the form reads afresh.
    useEffect(() => {
        if (!isCreateOpen) return;
        peekRequests.current.clear();
        setPeeks({});
    }, [isCreateOpen]);
    useEffect(() => {
        if (!isCreateOpen || fifoMissing) return;
        const timer = setTimeout(() => {
            for (const l of lines) {
                const q = removalQty(l);
                if (q > 0) getPeek(l.product_id, q);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [lines, isCreateOpen, fifoMissing, getPeek]);
    const peekOf = (l: DraftLine): FifoPeekResult | 'loading' | undefined => {
        const q = removalQty(l);
        return q > 0 ? peeks[peekKey(l.product_id, q)] : undefined;
    };

    const estimatedValueChange = useMemo(() => lines.reduce((s, l) => {
        const q = parseFloat(l.quantity);
        if (!q) return s;
        const product = activeProducts.find(p => p.id === l.product_id);
        if (q < 0 && !fifoMissing) {
            const peek = l.product_id && Number.isInteger(q) ? peeks[`${l.product_id}|${-q}`] : undefined;
            return peek && peek !== 'loading' && peek.ok ? s - peek.data.cost : s;
        }
        const uc = l.unit_cost !== '' ? parseFloat(l.unit_cost) : (product?.purchaseCost || 0);
        return s + q * (uc || 0);
    }, 0), [lines, activeProducts, peeks, fifoMissing]);

    const updateLine = (key: string, patch: Partial<DraftLine>) => setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
    const removeLine = (key: string) => setLines(prev => prev.length > 1 ? prev.filter(l => l.key !== key) : prev);

    const downloadProducts = () => {
        const header = ['SKU', 'Name', 'Current Stock'];
        const rows = activeProducts.map(p => [p.sku || '', p.name, p.stock]);
        const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `products-${todayYmd()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const handleImportLines = async (rows: Record<string, unknown>[]) => {
        const newLines: DraftLine[] = [];
        const notFound: string[] = [];
        for (const row of rows) {
            const sku = String(row['SKU'] ?? row['Sku'] ?? row['sku'] ?? '').trim();
            const product = activeProducts.find(p => (p.sku || '').toLowerCase() === sku.toLowerCase());
            if (!product) { if (sku) notFound.push(sku); continue; }
            newLines.push({
                key: genKey(),
                product_id: product.id,
                bin: String(row['Bin'] ?? 'Default') || 'Default',
                quantity: String(row['Quantity'] ?? ''),
                unit_cost: String(row['Unit Cost'] ?? ''),
                batch: String(row['Batch'] ?? ''),
            });
        }
        if (newLines.length === 0) { showToast(t('ui.inventory.adjust.toast.noMatches'), 'error'); return; }
        setLines(prev => {
            const kept = prev.filter(l => l.product_id || l.quantity);
            return [...kept, ...newLines];
        });
        showToast(notFound.length
            ? fill(t('ui.inventory.adjust.toast.importedSomeMissing'), { n: newLines.length, m: notFound.length, list: `${notFound.slice(0, 5).join(', ')}${notFound.length > 5 ? '…' : ''}` })
            : fill(t('ui.inventory.adjust.toast.imported'), { n: newLines.length }), notFound.length ? 'info' : 'success');
    };

    const handleSaveDraft = async () => {
        if (!warehouseId) { showToast(t('ui.inventory.adjust.toast.chooseWarehouse'), 'error'); return; }
        const validLines = lines.filter(l => l.product_id && l.quantity !== '' && parseFloat(l.quantity) !== 0);
        if (validLines.length === 0) { showToast(t('ui.inventory.adjust.toast.needLine'), 'error'); return; }
        const seenProducts = new Set<string>();
        for (const l of validLines) {
            if (seenProducts.has(l.product_id)) {
                showToast(fill(t('ui.inventory.adjust.toast.duplicate'), { name: activeProducts.find(p => p.id === l.product_id)?.name || t('ui.inventory.adjust.aProductCap') }), 'error');
                return;
            }
            seenProducts.add(l.product_id);
            const q = parseFloat(l.quantity);
            const product = activeProducts.find(p => p.id === l.product_id);
            if (!Number.isInteger(q)) {
                showToast(fill(t('ui.inventory.adjust.toast.qtyWhole'), { name: product?.name || t('ui.inventory.adjust.aProduct') }), 'error');
                return;
            }
            if (l.unit_cost !== '' && !(parseFloat(l.unit_cost) >= 0)) {
                showToast(fill(t('ui.inventory.adjust.toast.costNegative'), { name: product?.name || t('ui.inventory.adjust.aProduct') }), 'error');
                return;
            }
            const hasCost = (l.unit_cost !== '' && parseFloat(l.unit_cost) >= 0) || (product?.purchaseCost || 0) > 0;
            if (q < 0 && fifoMissing && !hasCost) {
                showToast(fill(t('ui.inventory.adjust.toast.costRequired'), { name: product?.name || t('ui.inventory.adjust.aProduct') }), 'error');
                return;
            }
        }
        setIsSaving(true);
        try {
            // Removal lines carry today's FIFO cost as the draft's estimate;
            // posting replaces it with the cost of the layers it takes.
            const removalCost = new Map<string, number | null>();
            let missing = fifoMissing;
            for (const l of validLines) {
                const q = parseFloat(l.quantity);
                if (q >= 0 || missing) continue;
                const res = await getPeek(l.product_id, -q);
                if (!res.ok && res.missing) { missing = true; break; }
                if (!res.ok) {
                    showToast(fill(t('ui.inventory.adjust.toast.peekFailedFor'), { name: activeProducts.find(p => p.id === l.product_id)?.name || t('ui.inventory.adjust.aProduct'), msg: res.message }), 'error');
                    return;
                }
                removalCost.set(l.key, res.data.unit_cost);
            }
            if (missing && !fifoMissing) {
                showToast(t('ui.inventory.adjust.toast.fifoMissing'), 'info');
                return;
            }
            const payloadLines = validLines.map(l => {
                const product = activeProducts.find(p => p.id === l.product_id);
                const q = parseFloat(l.quantity);
                const unitCost = q < 0 && !missing
                    ? (removalCost.get(l.key) ?? 0)
                    : (l.unit_cost !== '' ? parseFloat(l.unit_cost) : (product?.purchaseCost || 0));
                return {
                    product_id: l.product_id,
                    bin: l.bin || 'Default',
                    quantity: q,
                    unit_cost: unitCost,
                    batch: l.batch || undefined,
                };
            });
            if (editingId) {
                await updateAdjustment(editingId, { warehouse_id: warehouseId, adjustment_date: date, reason, notes: notes || null }, payloadLines);
                showToast(t('ui.inventory.adjust.toast.draftUpdated'), 'success');
            } else {
                await saveAdjustment({ warehouse_id: warehouseId, adjustment_date: date, reason, notes: notes || undefined }, payloadLines, currentUser?.id);
                showToast(t('ui.inventory.adjust.toast.draftSaved'), 'success');
            }
            setIsCreateOpen(false);
            setEditingId(null);
        } catch (e) {
            showToast(t('ui.inventory.adjust.toast.saveFailed') + (e instanceof Error ? e.message : t('ui.inventory.unknownError')), 'error');
        } finally {
            setIsSaving(false);
        }
    };

    // ── View / Post modal ──
    const [viewingId, setViewingId] = useState<string | null>(null);
    const viewing = adjustments.find(a => a.id === viewingId) || null;
    const [isPosting, setIsPosting] = useState(false);
    const [isVoiding, setIsVoiding] = useState(false);

    const handlePost = async () => {
        if (!viewing) return;
        setIsPosting(true);
        try {
            await postAdjustment(viewing, currentUser?.id);
            showToast(t('ui.inventory.adjust.toast.posted'), 'success');
            setViewingId(null);
        } catch (e) {
            showToast(t('ui.inventory.adjust.toast.postFailed') + (e instanceof Error ? e.message : t('ui.inventory.unknownError')), 'error');
        } finally {
            setIsPosting(false);
            // Stock changed in the database; refresh the cached products and
            // warehouse stock so other pages and the template export see it.
            refreshData(true).catch(() => { /* the next load picks it up */ });
        }
    };

    const handleVoid = async (a: StockAdjustment) => {
        if (a.status !== 'Draft') { showToast(t('ui.inventory.adjust.toast.cantDelete'), 'info'); return; }
        if (!confirm(t('ui.inventory.adjust.confirmDelete'))) return;
        setIsVoiding(true);
        try {
            await deleteAdjustment(a.id, a.status);
            showToast(t('ui.inventory.adjust.toast.draftDeleted'), 'success');
            if (viewingId === a.id) setViewingId(null);
        } catch (e) {
            showToast(t('ui.inventory.adjust.toast.deleteFailed') + (e instanceof Error ? e.message : t('ui.inventory.unknownError')), 'error');
        } finally {
            setIsVoiding(false);
        }
    };

    // ── Export / print ──
    const exportCsv = () => {
        const header = ['Reference', 'Date', 'Warehouse', 'Reason', 'Lines', 'Net Value', 'Status'];
        const rows = filtered.map(a => [referenceOf(a, adjustments), a.adjustment_date, warehouseName(a.warehouse_id), a.reason, (a.lines || []).length, fmt(netValueOf(a)), a.status]);
        const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `stock-adjustments-${todayYmd()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const printList = () => {
        const w = window.open('', '_blank', 'width=1000,height=700');
        if (!w) return;
        const rowsHtml = filtered.map(a => `<tr>
            <td>${escapeHtml(referenceOf(a, adjustments))}</td><td>${escapeHtml(a.adjustment_date)}</td>
            <td>${escapeHtml(warehouseName(a.warehouse_id))}</td><td>${escapeHtml(a.reason)}</td>
            <td style="text-align:right">${(a.lines || []).length}</td><td style="text-align:right">${fmt(netValueOf(a))}</td><td>${escapeHtml(a.status)}</td>
        </tr>`).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Stock Adjustments</title><style>
            body{font-family:Segoe UI,Arial,sans-serif;color:#1a1f36;padding:28px}
            h1{font-size:20px;margin:0}p{color:#64748b;margin:4px 0 20px;font-size:13px}
            table{width:100%;border-collapse:collapse;font-size:13px}
            th{font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #cbd5e1;padding:8px;text-align:left}
            td{padding:7px 8px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums}
        </style></head><body><h1>Stock Adjustments</h1><p>Opening balances, corrections and write-offs</p>
        <table><thead><tr><th>Reference</th><th>Date</th><th>Warehouse</th><th>Reason</th><th>Lines</th><th>Net Value</th><th>Status</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    const printOne = (a: StockAdjustment) => {
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) return;
        const rowsHtml = (a.lines || []).map(l => `<tr>
            <td>${escapeHtml(l.product?.name || l.product_id)}</td><td>${escapeHtml(l.bin || '—')}</td>
            <td style="text-align:right">${fmt(Number(l.quantity))}</td><td style="text-align:right">${fmt(Number(l.unit_cost))}</td>
            <td>${escapeHtml(l.batch || '—')}</td><td style="text-align:right">${fmt(Number(l.quantity) * Number(l.unit_cost))}</td>
        </tr>`).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(referenceOf(a, adjustments))}</title><style>
            body{font-family:Segoe UI,Arial,sans-serif;color:#1a1f36;padding:28px}
            h1{font-size:20px;margin:0}p{color:#64748b;margin:4px 0 20px;font-size:13px}
            table{width:100%;border-collapse:collapse;font-size:13px}
            th{font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #cbd5e1;padding:8px;text-align:left}
            td{padding:7px 8px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums}
        </style></head><body><h1>${escapeHtml(referenceOf(a, adjustments))}</h1>
        <p>${escapeHtml(a.adjustment_date)} · ${escapeHtml(warehouseName(a.warehouse_id))} · ${escapeHtml(a.reason)} · ${escapeHtml(a.status)}</p>
        <table><thead><tr><th>Product</th><th>Bin</th><th>Qty</th><th>Unit Cost</th><th>Batch</th><th>Value</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' };
    const modalStyle: React.CSSProperties = { background: 'var(--color-surface)', borderRadius: '14px', width: '100%', maxWidth: '760px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={openCreate} className="primary-button" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 18px' }}>
                    <Plus size={16} /> {t('ui.inventory.adjust.new')}
                </button>
            </div>

            {!schemaReady ? (
                <div style={{ ...cardStyle, padding: '32px 24px', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                    {t('ui.inventory.adjust.setupBefore')} <code>migrations/create_stock_adjustments.sql</code> {t('ui.inventory.adjust.setupAfter')}
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '320px' }}>
                            <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                            <input type="text" placeholder={t('ui.inventory.adjust.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, width: '100%', paddingLeft: '34px', boxSizing: 'border-box' }} />
                        </div>
                        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            <option value="all">{t('ui.inventory.filter.allStatuses')}</option>
                            <option value="Draft">{t('ui.inventory.adjust.status.draft')}</option>
                            <option value="Posted">{t('ui.inventory.adjust.status.posted')}</option>
                        </select>
                        <select value={reasonFilter} onChange={e => setReasonFilter(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            <option value="all">{t('ui.inventory.adjust.allReasons')}</option>
                            {REASONS.map(r => <option key={r} value={r}>{reasonLabel(r)}</option>)}
                        </select>
                        <button onClick={() => fetchAdjustments()} title={t('ui.inventory.adjust.reload')} style={{ ...btnStyle, padding: '9px 10px' }}>
                            <RefreshCw size={14} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                        </button>
                        <button onClick={printList} disabled={isLoading} style={{ ...btnStyle, opacity: isLoading ? 0.5 : 1 }}><Printer size={14} /> {t('ui.inventory.reports.printList')}</button>
                        <button onClick={exportCsv} disabled={isLoading} style={{ ...btnStyle, opacity: isLoading ? 0.5 : 1 }}><Download size={14} /> {t('ui.inventory.exportCsv')}</button>
                    </div>

                    <div style={cardStyle}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('ui.inventory.adjust.col.reference')}</th>
                                        <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('orders.date')}</th>
                                        <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('ui.inventory.warehouse')}</th>
                                        <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('ui.inventory.reason')}</th>
                                        <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>{t('ui.inventory.reports.lines')}</th>
                                        <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>{t('ui.inventory.adjust.col.netValue')}</th>
                                        <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>{t('ui.inventory.col.status')}</th>
                                        <th style={{ padding: '12px 20px', width: '110px' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isLoading ? (
                                        <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.loading')}</td></tr>
                                    ) : filtered.length === 0 ? (
                                        <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.adjust.noneMatch')}</td></tr>
                                    ) : filtered.map(a => (
                                        <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '12px 20px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{referenceOf(a, adjustments)}</td>
                                            <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{a.adjustment_date}</td>
                                            <td style={{ padding: '12px 20px', color: 'var(--color-text-main)' }}>{warehouseName(a.warehouse_id)}</td>
                                            <td style={{ padding: '12px 20px', color: 'var(--color-text-main)' }}>{reasonLabel(a.reason)}</td>
                                            <td style={{ padding: '12px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{(a.lines || []).length}</td>
                                            <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(netValueOf(a))}</td>
                                            <td style={{ padding: '12px 20px' }}>
                                                <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px', background: a.status === 'Posted' ? 'rgba(84,105,212,0.12)' : 'var(--color-bg)', color: a.status === 'Posted' ? '#5469d4' : 'var(--color-text-secondary)' }}>{statusLabel(a.status)}</span>
                                            </td>
                                            <td style={{ padding: '12px 20px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                <button onClick={() => setViewingId(a.id)} title={t('ui.inventory.adjust.view')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: '4px' }}><Eye size={15} /></button>
                                                {a.status === 'Draft' && (
                                                    <button onClick={() => openEdit(a)} title={t('ui.inventory.adjust.editDraft')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: '4px' }}><Pencil size={15} /></button>
                                                )}
                                                <button onClick={() => printOne(a)} title={t('ui.inventory.adjust.print')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: '4px' }}><Printer size={15} /></button>
                                                <button onClick={() => handleVoid(a)} disabled={isVoiding} title={a.status === 'Draft' ? t('ui.inventory.adjust.deleteDraft') : t('ui.inventory.adjust.postedNoDelete')} style={{ background: 'none', border: 'none', cursor: a.status === 'Draft' ? 'pointer' : 'not-allowed', color: a.status === 'Draft' ? '#DC2626' : 'var(--color-text-muted)', padding: '4px', opacity: a.status === 'Draft' ? 1 : 0.5 }}><X size={15} /></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* New Adjustment modal */}
            {isCreateOpen && (
                <div style={overlayStyle}>
                    <div style={{ ...modalStyle, maxWidth: '820px' }}>
                        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0 }}>{editingId ? t('ui.inventory.adjust.editTitle') : t('ui.inventory.adjust.newTitle')}</h3>
                            <button onClick={() => setIsCreateOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={20} /></button>
                        </div>
                        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '16px' }}>
                                <div>
                                    <label style={labelStyle}>{t('ui.inventory.warehouse')} *</label>
                                    <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={{ ...inputStyle, width: '100%', cursor: 'pointer', boxSizing: 'border-box' }}>
                                        <option value="">{t('ui.inventory.adjust.selectWarehouse')}</option>
                                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={labelStyle}>{t('orders.date')}</label>
                                    <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                    <label style={labelStyle}>{t('ui.inventory.reason')} *</label>
                                    <select value={reason} onChange={e => setReason(e.target.value as StockAdjustmentReason)} style={{ ...inputStyle, width: '100%', cursor: 'pointer', boxSizing: 'border-box' }}>
                                        {REASONS.map(r => <option key={r} value={r}>{reasonLabel(r)}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                                <button onClick={downloadProducts} style={btnStyle}><Download size={14} /> {t('ui.inventory.adjust.downloadProducts')}</button>
                                <button onClick={() => setIsImportOpen(true)} style={btnStyle}><Upload size={14} /> {t('ui.inventory.adjust.importCsv')}</button>
                            </div>
                            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '20px' }}>
                                {t('ui.inventory.adjust.importHelp')}
                                {fifoMissing
                                    ? t('ui.inventory.adjust.helpNoFifo')
                                    : t('ui.inventory.adjust.helpFifo')}
                            </p>
                            {fifoMissing && (
                                <p style={{ fontSize: '12px', color: '#B45309', margin: '-12px 0 20px' }}>
                                    {FIFO_MISSING_MESSAGE}
                                </p>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                {lines.map((l, i) => {
                                    const isRemoval = parseFloat(l.quantity) < 0;
                                    const showFifo = isRemoval && !fifoMissing;
                                    const peek = peekOf(l);
                                    const peekOk = peek && peek !== 'loading' && peek.ok ? peek.data : null;
                                    return (
                                    <div key={l.key} style={{ ...cardStyle, padding: '14px 16px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)' }}>{fill(t('ui.inventory.adjust.lineN'), { n: i + 1 })}</span>
                                            {lines.length > 1 && (
                                                <button onClick={() => removeLine(l.key)} title={t('ui.inventory.adjust.removeLine')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626' }}><Trash2 size={14} /></button>
                                            )}
                                        </div>
                                        <label style={labelStyle}>{t('ui.inventory.priceList.product')}</label>
                                        <select value={l.product_id} onChange={e => updateLine(l.key, { product_id: e.target.value })} style={{ ...inputStyle, width: '100%', cursor: 'pointer', boxSizing: 'border-box', marginBottom: '10px' }}>
                                            <option value="">{t('ui.inventory.adjust.selectProduct')}</option>
                                            {activeProducts.map(p => <option key={p.id} value={p.id}>{p.sku ? `${p.sku} · ` : ''}{p.name}</option>)}
                                        </select>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                                            <div>
                                                <label style={labelStyle}>{t('ui.inventory.reports.bin')}</label>
                                                <select value={l.bin} onChange={e => updateLine(l.key, { bin: e.target.value })} style={{ ...inputStyle, width: '100%', cursor: 'pointer', boxSizing: 'border-box' }}>
                                                    <option value="Default">{t('ui.inventory.reports.defaultBin')}</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label style={labelStyle}>{t('ui.inventory.quantity')}</label>
                                                <input type="number" step="1" placeholder={t('ui.inventory.adjust.qtyPlaceholder')} value={l.quantity} onChange={e => updateLine(l.key, { quantity: e.target.value })} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                                            </div>
                                            <div>
                                                <label style={labelStyle}>{showFifo ? t('ui.inventory.adjust.fifoUnitCost') : t('ui.inventory.adjust.unitCost')}</label>
                                                {showFifo ? (
                                                    <div title={t('ui.inventory.adjust.fifoCostTitle')} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', background: 'var(--color-bg)', color: peekOk ? 'var(--color-text-main)' : 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                                                        {!l.product_id ? t('ui.inventory.adjust.pickProduct') : !peek || peek === 'loading' ? '…' : peekOk ? fmt(peekOk.unit_cost ?? 0) : '—'}
                                                    </div>
                                                ) : (
                                                    <input type="number" step="any" min="0" placeholder={isRemoval ? t('ui.inventory.adjust.purchaseCost') : t('ui.inventory.adjust.lastReceiptCost')} value={l.unit_cost} onChange={e => updateLine(l.key, { unit_cost: e.target.value })} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                                                )}
                                            </div>
                                            <div>
                                                <label style={labelStyle}>{t('ui.inventory.reports.batch')}</label>
                                                <input type="text" placeholder={t('ui.inventory.adjust.na')} value={l.batch} onChange={e => updateLine(l.key, { batch: e.target.value })} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                                            </div>
                                        </div>
                                        {showFifo && peek && peek !== 'loading' && (
                                            <div style={{ marginTop: '8px', fontSize: '12px', color: peekOk && peekOk.short_qty === 0 ? 'var(--color-text-secondary)' : '#B45309' }}>
                                                {peekOk
                                                    ? <>{fill(t('ui.inventory.adjust.peekTakes'), { taken: fmt(peekOk.qty - peekOk.short_qty), available: fmt(peekOk.available), cost: fmt(peekOk.cost) })}{peekOk.short_qty > 0 && fill(t('ui.inventory.adjust.peekShort'), { short: fmt(peekOk.short_qty), fallback: fmt(peekOk.fallback_cost) })}</>
                                                    : !peek.ok && fill(t('ui.inventory.adjust.peekFailed'), { msg: peek.message })}
                                            </div>
                                        )}
                                    </div>
                                    );
                                })}
                            </div>

                            <button onClick={() => setLines(prev => [...prev, emptyLine()])} style={{ width: '100%', marginTop: '14px', padding: '12px', borderRadius: '10px', border: '2px dashed var(--color-border)', background: 'transparent', color: 'var(--color-primary)', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                <Plus size={14} /> {t('ui.inventory.adjust.addLine')}
                            </button>

                            <div style={{ ...cardStyle, marginTop: '18px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{t('ui.inventory.adjust.estimatedChange')}</span>
                                <span style={{ fontSize: '15px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: estimatedValueChange < 0 ? '#DC2626' : 'var(--color-text-main)' }}>{fmt(estimatedValueChange)}</span>
                            </div>

                            <div style={{ marginTop: '18px' }}>
                                <label style={labelStyle}>{t('ui.inventory.adjust.notes')}</label>
                                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('ui.inventory.adjust.notesPlaceholder')} rows={3} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
                            </div>
                        </div>
                        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button onClick={() => setIsCreateOpen(false)} style={{ ...btnStyle, background: 'var(--color-surface)' }}>{t('common.cancel')}</button>
                            <button onClick={handleSaveDraft} disabled={isSaving} className="primary-button" style={{ padding: '10px 20px', opacity: isSaving ? 0.6 : 1 }}>{isSaving ? t('ui.inventory.adjust.saving') : editingId ? t('ui.inventory.adjust.saveChangesLower') : t('ui.inventory.adjust.saveDraft')}</button>
                        </div>
                    </div>
                </div>
            )}

            {isImportOpen && (
                <DataImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} type="stock-adjustment" onImport={handleImportLines} />
            )}

            {/* View / Post modal */}
            {viewing && (
                <div style={overlayStyle}>
                    <div style={modalStyle}>
                        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>{referenceOf(viewing, adjustments)}</h3>
                                <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px', background: viewing.status === 'Posted' ? 'rgba(84,105,212,0.12)' : 'var(--color-bg)', color: viewing.status === 'Posted' ? '#5469d4' : 'var(--color-text-secondary)' }}>{statusLabel(viewing.status)}</span>
                            </div>
                            <button onClick={() => setViewingId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={20} /></button>
                        </div>
                        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '18px', fontSize: '13px' }}>
                                <div><span style={{ color: 'var(--color-text-secondary)' }}>{t('ui.inventory.warehouse')}: </span><strong>{warehouseName(viewing.warehouse_id)}</strong></div>
                                <div><span style={{ color: 'var(--color-text-secondary)' }}>{t('orders.date')}: </span><strong>{viewing.adjustment_date}</strong></div>
                                <div><span style={{ color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reason')}: </span><strong>{reasonLabel(viewing.reason)}</strong></div>
                                <div><span style={{ color: 'var(--color-text-secondary)' }}>{t('ui.inventory.adjust.netValue')}: </span><strong>{fmt(netValueOf(viewing))}</strong></div>
                                {viewing.notes && <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--color-text-secondary)' }}>{t('ui.inventory.adjust.notes')}: </span>{viewing.notes}</div>}
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <th style={{ padding: '8px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.priceList.product')}</th>
                                        <th style={{ padding: '8px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.bin')}</th>
                                        <th style={{ padding: '8px', textAlign: 'right', fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.qty')}</th>
                                        <th style={{ padding: '8px', textAlign: 'right', fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.unitCost')}</th>
                                        <th style={{ padding: '8px', textAlign: 'right', fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{t('ui.inventory.reports.value')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(viewing.lines || []).map(l => (
                                        <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '8px' }}>{l.product?.name || l.product_id}</td>
                                            <td style={{ padding: '8px' }}>{l.bin || '—'}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: Number(l.quantity) < 0 ? '#DC2626' : 'var(--color-text-main)' }}>{fmt(Number(l.quantity))}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(Number(l.unit_cost))}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(Number(l.quantity) * Number(l.unit_cost))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                            <div>
                                {viewing.status === 'Draft' && (
                                    <button onClick={() => handleVoid(viewing)} disabled={isVoiding} style={{ ...btnStyle, color: '#DC2626', borderColor: '#DC2626' }}>{t('ui.inventory.adjust.deleteDraft')}</button>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button onClick={() => setViewingId(null)} style={{ ...btnStyle, background: 'var(--color-surface)' }}>{t('common.close')}</button>
                                {viewing.status === 'Draft' && (
                                    <>
                                        <button onClick={() => openEdit(viewing)} style={btnStyle}><Pencil size={14} /> {t('common.edit')}</button>
                                        <button onClick={handlePost} disabled={isPosting} className="primary-button" style={{ padding: '10px 20px', opacity: isPosting ? 0.6 : 1 }}>{isPosting ? t('ui.inventory.adjust.posting') : t('ui.inventory.adjust.post')}</button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdjustStockPage;
