// "Add entry": record ad spend (and chats) for a page + product that has no
// row yet — typically a campaign that spent money but closed nothing, which
// otherwise would never appear (rows come from orders). Rows that already
// exist are simply edited in the table.
import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Product } from '../../../types';
import type { Translate } from '../types';
import { inRange, type DateRange } from '../../../utils/dateRange';
import { ACCENT } from './ui';

export interface AddEntryFormProps {
    range: DateRange;
    today: string;
    pageOptions: string[];          // Settings → Pages ∪ pages seen in the range
    products: Product[];
    t: Translate;
    // Spend already recorded for that (day, page, product), if any — saving
    // here would overwrite it, so the form sends the user to the table instead.
    existingSpendOf: (date: string, page: string, productId: string) => number | null;
    onCancel: () => void;
    // Resolves once saved; rejects on failure (toast already shown).
    onSave: (entry: { date: string; page: string; productId: string; adSpend: number; inboundChats: number | null }) => Promise<void>;
}

const field: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
    border: '1px solid var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text-main)', fontSize: 13,
};
const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' };

const AddEntryForm: React.FC<AddEntryFormProps> = ({ range, today, pageOptions, products, t, existingSpendOf, onCancel, onSave }) => {
    const [date, setDate] = useState(() => (inRange(today, range) ? today : range.to));
    const [page, setPage] = useState(pageOptions.find(p => p !== '') ?? '');
    const [productId, setProductId] = useState('');
    const [spend, setSpend] = useState('');
    const [chats, setChats] = useState('');
    const [saving, setSaving] = useState(false);

    const activeProducts = useMemo(
        () => products.filter(p => p.isActive !== false).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        [products],
    );
    const spendNum = Number(spend);
    const chatsNum = chats.trim() === '' ? null : Math.round(Number(chats));
    const existing = productId && date ? existingSpendOf(date, page.trim(), productId) : null;
    // A product picked before the list changed (e.g. a range switch) no longer counts.
    const productOk = activeProducts.some(p => p.id === productId);
    const valid = !!date && inRange(date, range) && productOk && existing === null && Number.isFinite(spendNum) && spendNum > 0
        && (chatsNum === null || (Number.isFinite(chatsNum) && chatsNum >= 0));

    const submit = async () => {
        if (!valid || saving) return;
        setSaving(true);
        try {
            await onSave({ date, page: page.trim(), productId, adSpend: spendNum, inboundChats: chatsNum });
        } catch {
            /* toast already shown by the container; keep the form open */
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="glass-panel" style={{ border: `1px solid ${ACCENT}40`, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{t('cpaTracker.addEntry')}</div>
                <button type="button" className="pip-icon-button" style={{ width: 30, height: 30 }} onClick={onCancel} aria-label={t('cpaTracker.cancel')}><X size={16} /></button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{t('cpaTracker.addEntryHint')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <div>
                    <label style={label} htmlFor="cpa-add-date">{t('cpaTracker.columns.date')}</label>
                    <input id="cpa-add-date" type="date" style={field} value={date} min={range.from} max={range.to} onChange={e => setDate(e.target.value)} />
                </div>
                <div>
                    <label style={label} htmlFor="cpa-add-page">{t('cpaTracker.columns.page')}</label>
                    <select id="cpa-add-page" style={field} value={page} onChange={e => setPage(e.target.value)}>
                        {pageOptions.map(p => <option key={p || '__none'} value={p}>{p || t('cpaTracker.noPage')}</option>)}
                    </select>
                </div>
                <div>
                    <label style={label} htmlFor="cpa-add-product">{t('cpaTracker.columns.product')}</label>
                    <select id="cpa-add-product" style={field} value={productId} onChange={e => setProductId(e.target.value)}>
                        <option value="">{t('cpaTracker.selectProduct')}</option>
                        {activeProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                <div>
                    <label style={label} htmlFor="cpa-add-spend">{t('cpaTracker.columns.spend')}</label>
                    <input id="cpa-add-spend" type="number" min={0} step="0.01" inputMode="decimal" className="pip-input" style={field} value={spend} placeholder="0.00" onChange={e => setSpend(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
                </div>
                <div>
                    <label style={label} htmlFor="cpa-add-chats">{t('cpaTracker.columns.chats')}</label>
                    <input id="cpa-add-chats" type="number" min={0} step="1" inputMode="numeric" className="pip-input" style={field} value={chats} placeholder="-" onChange={e => setChats(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
                </div>
            </div>
            {existing !== null && (
                <div role="status" style={{ fontSize: 12, color: '#B45309', background: 'rgba(245,158,11,0.1)', borderRadius: 8, padding: '6px 10px' }}>
                    {t('cpaTracker.alreadyHasSpend').replace('{amount}', `$${existing.toFixed(2)}`)}
                </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="pip-text-button" onClick={onCancel}>{t('cpaTracker.cancel')}</button>
                <button type="button" className="pip-text-button" disabled={!valid || saving} onClick={submit}
                    style={{ background: valid ? ACCENT : undefined, color: valid ? 'white' : undefined, borderColor: valid ? ACCENT : undefined, opacity: saving ? 0.7 : 1 }}>
                    <Plus size={14} /> {saving ? t('cpaTracker.saving') : t('cpaTracker.save')}
                </button>
            </div>
        </div>
    );
};

export default AddEntryForm;
