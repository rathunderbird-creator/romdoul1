import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, Trash2, ArrowLeftRight } from 'lucide-react';
import Modal from './Modal';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { fill } from '../i18n/translate';
import { dayKeyFromDate } from '../utils/dateRange';

// Warehouses › Move Stock. Picks a source (a warehouse, or Unassigned: the
// part of a product's stock no warehouse accounts for, as Inventory Reports
// › Stock on Hand shows it), a destination and product lines, then moves
// them in one database call (transferWarehouseStock). Availability shown here
// is from the loaded warehouse_stock; the database re-checks it under lock.

const UNASSIGNED = '__unassigned__';

interface Line { key: number; productId: string; quantity: string }

interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** Preselected source (the warehouse whose stock view it was opened from). */
    initialFromId?: string | null;
    onMoved?: () => void;
}

let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, productId: '', quantity: '' });

const MoveStockModal: React.FC<Props> = ({ isOpen, onClose, initialFromId, onMoved }) => {
    const { warehouses, warehouseStock, products, defaultWarehouseId, transferWarehouseStock } = useStore();
    const { showToast } = useToast();
    const { t } = useLanguage();

    const [fromId, setFromId] = useState('');
    const [toId, setToId] = useState('');
    const [date, setDate] = useState(() => dayKeyFromDate(new Date()));
    const [note, setNote] = useState('');
    const [lines, setLines] = useState<Line[]>([emptyLine()]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const from = initialFromId || defaultWarehouseId || warehouses[0]?.id || UNASSIGNED;
        setFromId(from);
        // Destination: the default warehouse when moving out of somewhere
        // else, otherwise the first other warehouse.
        const to = defaultWarehouseId && defaultWarehouseId !== from
            ? defaultWarehouseId
            : (warehouses.find(w => w.id !== from)?.id || '');
        setToId(to);
        setDate(dayKeyFromDate(new Date()));
        setNote('');
        setLines([emptyLine()]);
        // Only when the modal opens; later store changes must not reset the form.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Units available at the chosen source, per product.
    const available = useMemo(() => {
        const map = new Map<string, number>();
        if (fromId === UNASSIGNED) {
            const tracked = new Map<string, number>();
            for (const ws of warehouseStock) tracked.set(ws.productId, (tracked.get(ws.productId) || 0) + (Number(ws.quantity) || 0));
            for (const p of products) {
                const left = (Number(p.stock) || 0) - (tracked.get(p.id) || 0);
                if (left > 0) map.set(p.id, left);
            }
        } else {
            for (const ws of warehouseStock) {
                if (ws.warehouseId !== fromId) continue;
                const q = Number(ws.quantity) || 0;
                if (q > 0) map.set(ws.productId, (map.get(ws.productId) || 0) + q);
            }
        }
        return map;
    }, [fromId, warehouseStock, products]);

    const sourceProducts = useMemo(() => products
        .filter(p => p.isActive !== false && (available.get(p.id) || 0) > 0)
        .sort((a, b) => a.name.localeCompare(b.name)), [products, available]);

    if (!isOpen) return null;

    const nameOf = (id: string) => products.find(p => p.id === id)?.name || id;
    const setLine = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!toId) { showToast(t('ui.inventory.wh.move.chooseTo'), 'error'); return; }
        if (fromId === toId) { showToast(t('ui.inventory.wh.move.mustDiffer'), 'error'); return; }
        const filled = lines.filter(l => l.productId);
        if (filled.length === 0) { showToast(t('ui.inventory.wh.move.noLines'), 'error'); return; }
        for (const l of filled) {
            const q = Number(l.quantity);
            if (!Number.isInteger(q) || q <= 0) { showToast(t('ui.inventory.wh.move.wholeQty'), 'error'); return; }
            const have = available.get(l.productId) || 0;
            if (q > have) { showToast(fill(t('ui.inventory.wh.move.overAvailable'), { name: nameOf(l.productId), n: have }), 'error'); return; }
        }
        setSaving(true);
        try {
            await transferWarehouseStock({
                fromWarehouseId: fromId === UNASSIGNED ? null : fromId,
                toWarehouseId: toId,
                lines: filled.map(l => ({ productId: l.productId, quantity: Number(l.quantity) })),
                date,
                note,
            });
            showToast(fill(t('ui.inventory.wh.move.moved'), { n: filled.length }), 'success');
            onMoved?.();
            onClose();
        } catch (err) {
            showToast(err instanceof Error ? err.message : t('ui.inventory.wh.move.failed'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 10px', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '13px', background: 'var(--color-bg)', outline: 'none', boxSizing: 'border-box' };
    const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' };
    const usedIds = new Set(lines.map(l => l.productId).filter(Boolean));

    return (
        <Modal isOpen={isOpen} onClose={() => { if (!saving) onClose(); }} title={t('ui.inventory.wh.move.title')} width="640px">
                <form onSubmit={submit}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '10px', alignItems: 'end' }}>
                            <div>
                                <label htmlFor="move-from" style={labelStyle}>{t('ui.inventory.wh.move.from')}</label>
                                <select id="move-from" value={fromId} style={{ ...inputStyle, cursor: 'pointer' }}
                                    onChange={e => { setFromId(e.target.value); setLines([emptyLine()]); }}>
                                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    <option value={UNASSIGNED}>{t('ui.inventory.wh.move.unassigned')}</option>
                                </select>
                            </div>
                            <ArrowRight size={18} style={{ marginBottom: '10px', color: 'var(--color-text-muted)' }} />
                            <div>
                                <label htmlFor="move-to" style={labelStyle}>{t('ui.inventory.wh.move.to')}</label>
                                <select id="move-to" value={toId} style={{ ...inputStyle, cursor: 'pointer' }} onChange={e => setToId(e.target.value)}>
                                    <option value="">{t('ui.inventory.wh.move.chooseWarehouse')}</option>
                                    {warehouses.filter(w => w.id !== fromId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label style={labelStyle}>{t('ui.inventory.wh.move.products')}</label>
                            {sourceProducts.length === 0 ? (
                                <div style={{ padding: '16px', fontSize: '13px', color: 'var(--color-text-secondary)', border: '1px dashed var(--color-border)', borderRadius: '8px', textAlign: 'center' }}>
                                    {t('ui.inventory.wh.move.nothingAtSource')}
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {lines.map(l => {
                                        const have = l.productId ? (available.get(l.productId) || 0) : null;
                                        return (
                                            <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 32px', gap: '8px', alignItems: 'center' }}>
                                                <select aria-label={t('ui.inventory.wh.move.product')} value={l.productId} style={{ ...inputStyle, cursor: 'pointer' }}
                                                    onChange={e => setLine(l.key, { productId: e.target.value })}>
                                                    <option value="">{t('ui.inventory.wh.move.selectProduct')}</option>
                                                    {sourceProducts.filter(p => p.id === l.productId || !usedIds.has(p.id)).map(p => (
                                                        <option key={p.id} value={p.id}>
                                                            {p.name}{p.sku ? ` (${p.sku})` : ''} — {fill(t('ui.inventory.wh.move.availableN'), { n: (available.get(p.id) || 0).toLocaleString() })}
                                                        </option>
                                                    ))}
                                                </select>
                                                <input type="number" min={1} max={have ?? undefined} step={1} inputMode="numeric"
                                                    aria-label={t('ui.inventory.quantity')} placeholder={t('ui.inventory.quantity')}
                                                    value={l.quantity} onChange={e => setLine(l.key, { quantity: e.target.value })} style={inputStyle} />
                                                <button type="button" className="icon-button" style={{ padding: '6px', color: '#EF4444' }}
                                                    aria-label={t('ui.inventory.wh.move.removeLine')}
                                                    onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [emptyLine()])}>
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                    {lines.length < sourceProducts.length && (
                                        <button type="button" className="secondary-button" onClick={() => setLines(ls => [...ls, emptyLine()])}
                                            style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}>
                                            <Plus size={14} /> {t('ui.inventory.wh.move.addLine')}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '12px' }}>
                            <div>
                                <label htmlFor="move-date" style={labelStyle}>{t('ui.inventory.wh.move.date')}</label>
                                <input id="move-date" type="date" required value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
                            </div>
                            <div>
                                <label htmlFor="move-note" style={labelStyle}>{t('ui.inventory.wh.move.note')}</label>
                                <input id="move-note" type="text" value={note} onChange={e => setNote(e.target.value)} style={inputStyle}
                                    placeholder={t('ui.inventory.wh.move.notePlaceholder')} />
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
                        <button type="button" onClick={onClose} className="secondary-button" disabled={saving}>{t('common.cancel')}</button>
                        <button type="submit" className="primary-button" disabled={saving || sourceProducts.length === 0}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <ArrowLeftRight size={16} /> {saving ? t('ui.inventory.wh.move.moving') : t('ui.inventory.wh.move.submit')}
                        </button>
                    </div>
                </form>
        </Modal>
    );
};

export default MoveStockModal;
