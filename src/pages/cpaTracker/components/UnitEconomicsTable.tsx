// Sheet 1 — Product Catalog & Unit Economics. Price and COGS are the real
// product's (edit them in Inventory); courier fee, packaging, desired profit and
// expected delivery rate are typed here. The first row holds the DEFAULTS every
// product inherits field by field until it sets its own value (it stays pinned
// on top whatever the sort). Rows arrive best-sellers-first; any header sorts
// the table (asc → desc → back to default), like the Purchase Orders list.
import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { UnitEconRow, SettingField } from '../metrics';
import { DEFAULT_SETTINGS_KEY, BUILTIN_SETTINGS } from '../metrics';
import type { Translate } from '../types';
import { fmtMoney } from '../../pageIncomePrediction/format';
import { thStyle, tdNum, MoneyText, EditableNumberCell, ACCENT } from './ui';

export interface UnitEconomicsTableProps {
    rows: UnitEconRow[];
    defaults: Record<SettingField, number | null>;
    editable: boolean;
    t: Translate;
    savingKeys: Set<string>;
    savedKeys: Set<string>;
    onCommit: (productId: string, field: SettingField, value: number | null) => Promise<void>;
}

export const settingCellKey = (productId: string, field: SettingField): string => `setting|${productId}|${field}`;

type SortKey = 'product' | 'sold' | 'price' | 'cogs' | 'courierFee' | 'packaging' | 'unitHardCosts' | 'breakEven' | 'desiredProfit' | 'target' | 'expectedDelivery' | 'targetGross';

const COLS: { key: SortKey; width: number; align?: 'left' | 'right'; color?: string }[] = [
    { key: 'product', width: 220, align: 'left' },
    { key: 'sold', width: 84 },
    { key: 'price', width: 92 },
    { key: 'cogs', width: 92 },
    { key: 'courierFee', width: 112 },
    { key: 'packaging', width: 112 },
    { key: 'unitHardCosts', width: 104, color: '#EF4444' },
    { key: 'breakEven', width: 104 },
    { key: 'desiredProfit', width: 112 },
    { key: 'target', width: 104, color: ACCENT },
    { key: 'expectedDelivery', width: 112 },
    { key: 'targetGross', width: 108, color: ACCENT },
];

// Settings columns compare by the EFFECTIVE value (own, else inherited) — the
// number the row actually runs on, and what the cell shows as placeholder.
const sortValue = (u: UnitEconRow, key: SortKey): string | number => {
    switch (key) {
        case 'product': return (u.name || u.productId).toLowerCase();
        case 'sold': return u.soldUnits;
        case 'price': return u.price;
        case 'cogs': return u.cogs;
        case 'courierFee': return u.courierFee;
        case 'packaging': return u.packaging;
        case 'unitHardCosts': return u.hardCosts;
        case 'breakEven': return u.breakEvenCpa;
        case 'desiredProfit': return u.desiredProfit;
        case 'target': return u.targetNetCpa;
        case 'expectedDelivery': return u.expectedDeliveryRate;
        case 'targetGross': return u.targetGrossCpa;
    }
};

const fmtField = (field: SettingField, v: number): string =>
    field === 'expectedDeliveryRate' ? `${Math.round(v * 1000) / 10}%` : fmtMoney(v);

const UnitEconomicsTable: React.FC<UnitEconomicsTableProps> = ({ rows, defaults, editable, t, savingKeys, savedKeys, onCommit }) => {
    const width = COLS.reduce((s, c) => s + c.width, 0);

    // null = the default order the rows arrived in (best sellers first).
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const handleSort = (key: SortKey) => {
        setSort(prev =>
            prev?.key === key
                ? (prev.dir === 'asc' ? { key, dir: 'desc' } : null)   // third click: back to default
                : { key, dir: 'asc' }
        );
    };
    const sorted = useMemo(() => {
        if (!sort) return rows;
        const dir = sort.dir === 'asc' ? 1 : -1;
        return [...rows].sort((a, b) => {
            const av = sortValue(a, sort.key);
            const bv = sortValue(b, sort.key);
            if (av === bv) return (a.name || a.productId).localeCompare(b.name || b.productId);
            return (av < bv ? -1 : 1) * dir;
        });
    }, [rows, sort]);

    // Enter moves down the column: row 0 is the defaults row, 1..n the products.
    const edit = (productId: string, field: SettingField, value: number | null, inherited: number, rowIdx: number) => (
        <td style={{ padding: '3px 6px' }}>
            <EditableNumberCell
                value={value}
                placeholder={field === 'expectedDeliveryRate' ? String(Math.round(inherited * 1000) / 10) : fmtField(field, inherited).replace('$', '')}
                placeholderTitle={productId === DEFAULT_SETTINGS_KEY ? t('cpaTracker.builtinTitle') : t('cpaTracker.inheritedTitle')}
                prefix={field === 'expectedDeliveryRate' ? undefined : '$'}
                suffix={field === 'expectedDeliveryRate' ? '%' : undefined}
                percent={field === 'expectedDeliveryRate'}
                max={field === 'expectedDeliveryRate' ? 100 : undefined}
                disabled={!editable}
                saving={savingKeys.has(settingCellKey(productId, field))}
                saved={savedKeys.has(settingCellKey(productId, field))}
                ariaLabel={`${t(`cpaTracker.columns.${field === 'expectedDeliveryRate' ? 'expectedDelivery' : field}`)} · ${productId === DEFAULT_SETTINGS_KEY ? t('cpaTracker.defaultsRow') : rows.find(r => r.productId === productId)?.name ?? productId}`}
                cellId={`${field}:${rowIdx}`}
                nextCellId={rowIdx + 1 <= rows.length ? `${field}:${rowIdx + 1}` : undefined}
                onCommit={v => onCommit(productId, field, v)}
            />
        </td>
    );

    const builtinOr = (field: SettingField) => defaults[field] ?? BUILTIN_SETTINGS[field];

    return (
        <div className="glass-panel" style={{ border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 300px)', minHeight: 200 }}>
            <table className="spreadsheet-table" style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width, minWidth: '100%', border: 'none' }}>
                <colgroup>{COLS.map(c => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
                <thead>
                    <tr>
                        {COLS.map((c, i) => {
                            const help = t(`cpaTracker.columnHelp.${c.key}`);
                            const active = sort?.key === c.key;
                            return (
                                <th key={c.key} scope="col" className={i === 0 ? 'pip-sticky-first' : undefined}
                                    title={help.startsWith('cpaTracker.') ? undefined : help}
                                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                                    onClick={() => handleSort(c.key)}
                                    style={{ ...thStyle, textAlign: c.align || 'right', color: active ? ACCENT : (c.color || thStyle.color), cursor: 'pointer', userSelect: 'none' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                        {t(`cpaTracker.columns.${c.key}`)}
                                        {active
                                            ? (sort!.dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)
                                            : <ChevronsUpDown size={11} style={{ opacity: 0.35 }} aria-hidden />}
                                    </span>
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {/* Defaults row */}
                    <tr style={{ background: 'rgba(139,92,246,0.07)' }}>
                        <td className="pip-sticky-first" style={{ padding: '8px 12px', borderRight: '1px solid var(--color-border)', background: 'rgb(245,243,255)' }}>
                            <div style={{ fontWeight: 800, fontSize: 12 }}>{t('cpaTracker.defaultsRow')}</div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{t('cpaTracker.defaultsHint')}</div>
                        </td>
                        <td style={tdNum} /><td style={tdNum} /><td style={tdNum} />
                        {edit(DEFAULT_SETTINGS_KEY, 'courierFee', defaults.courierFee, BUILTIN_SETTINGS.courierFee, 0)}
                        {edit(DEFAULT_SETTINGS_KEY, 'packaging', defaults.packaging, BUILTIN_SETTINGS.packaging, 0)}
                        <td style={tdNum} /><td style={tdNum} />
                        {edit(DEFAULT_SETTINGS_KEY, 'desiredProfit', defaults.desiredProfit, BUILTIN_SETTINGS.desiredProfit, 0)}
                        <td style={tdNum} />
                        {edit(DEFAULT_SETTINGS_KEY, 'expectedDeliveryRate', defaults.expectedDeliveryRate, BUILTIN_SETTINGS.expectedDeliveryRate, 0)}
                        <td style={tdNum} />
                    </tr>
                    {sorted.map((u, idx) => (
                        <tr key={u.productId} className="pip-row" style={{ background: idx % 2 ? 'rgba(0,0,0,0.015)' : 'transparent', opacity: u.isActive ? 1 : 0.6 }}>
                            <td className="pip-sticky-first" style={{ padding: '8px 12px', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)', overflow: 'hidden' }}>
                                <div className="d2-khmer" style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.5 }} title={u.name}>{u.name || u.productId}</div>
                                {(u.model || !u.isActive) && (
                                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {u.model}{!u.isActive && <>{u.model ? ' · ' : ''}{t('cpaTracker.inactive')}</>}
                                    </div>
                                )}
                            </td>
                            <td style={{ ...tdNum, fontWeight: u.soldUnits > 0 ? 700 : 400, color: u.soldUnits > 0 ? 'var(--color-text-main)' : 'var(--color-text-secondary)' }}>
                                {u.soldUnits > 0 ? u.soldUnits.toLocaleString() : '-'}
                            </td>
                            <td style={tdNum} title={t('cpaTracker.fromInventory')}><MoneyText value={u.price} /></td>
                            <td style={tdNum} title={t('cpaTracker.fromInventory')}><MoneyText value={u.cogs} /></td>
                            {edit(u.productId, 'courierFee', u.own.courierFee, builtinOr('courierFee'), idx + 1)}
                            {edit(u.productId, 'packaging', u.own.packaging, builtinOr('packaging'), idx + 1)}
                            <td style={{ ...tdNum, fontWeight: 600 }}><MoneyText value={u.hardCosts} /></td>
                            <td style={tdNum}><MoneyText value={u.breakEvenCpa} signed /></td>
                            {edit(u.productId, 'desiredProfit', u.own.desiredProfit, builtinOr('desiredProfit'), idx + 1)}
                            <td style={{ ...tdNum, fontWeight: 700 }}><MoneyText value={u.targetNetCpa} signed bold /></td>
                            {edit(u.productId, 'expectedDeliveryRate', u.own.expectedDeliveryRate, builtinOr('expectedDeliveryRate'), idx + 1)}
                            <td style={{ ...tdNum, fontWeight: 700 }}><MoneyText value={u.targetGrossCpa} signed bold /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default UnitEconomicsTable;
