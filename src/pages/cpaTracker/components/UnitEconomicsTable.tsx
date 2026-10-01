// Sheet 1 — Product Catalog & Unit Economics. Price and COGS are the real
// product's (edit them in Inventory); courier fee, packaging, desired profit and
// expected delivery rate are typed here. The first row holds the DEFAULTS every
// product inherits field by field until it sets its own value.
import React from 'react';
import type { UnitEconomics, SettingField } from '../metrics';
import { DEFAULT_SETTINGS_KEY, BUILTIN_SETTINGS } from '../metrics';
import type { Translate } from '../types';
import { fmtMoney } from '../../pageIncomePrediction/format';
import { thStyle, tdNum, MoneyText, EditableNumberCell, ACCENT } from './ui';

export interface UnitEconomicsTableProps {
    rows: UnitEconomics[];
    defaults: Record<SettingField, number | null>;
    editable: boolean;
    t: Translate;
    savingKeys: Set<string>;
    savedKeys: Set<string>;
    onCommit: (productId: string, field: SettingField, value: number | null) => Promise<void>;
}

export const settingCellKey = (productId: string, field: SettingField): string => `setting|${productId}|${field}`;

const COLS: { key: string; width: number; align?: 'left' | 'right'; color?: string }[] = [
    { key: 'product', width: 220, align: 'left' },
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

const fmtField = (field: SettingField, v: number): string =>
    field === 'expectedDeliveryRate' ? `${Math.round(v * 1000) / 10}%` : fmtMoney(v);

const UnitEconomicsTable: React.FC<UnitEconomicsTableProps> = ({ rows, defaults, editable, t, savingKeys, savedKeys, onCommit }) => {
    const width = COLS.reduce((s, c) => s + c.width, 0);

    const edit = (productId: string, field: SettingField, value: number | null, inherited: number) => (
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
                            return (
                                <th key={c.key} scope="col" className={i === 0 ? 'pip-sticky-first' : undefined}
                                    title={help.startsWith('cpaTracker.') ? undefined : help}
                                    style={{ ...thStyle, textAlign: c.align || 'right', color: c.color || thStyle.color }}>
                                    {t(`cpaTracker.columns.${c.key}`)}
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
                        <td style={tdNum} /><td style={tdNum} />
                        {edit(DEFAULT_SETTINGS_KEY, 'courierFee', defaults.courierFee, BUILTIN_SETTINGS.courierFee)}
                        {edit(DEFAULT_SETTINGS_KEY, 'packaging', defaults.packaging, BUILTIN_SETTINGS.packaging)}
                        <td style={tdNum} /><td style={tdNum} />
                        {edit(DEFAULT_SETTINGS_KEY, 'desiredProfit', defaults.desiredProfit, BUILTIN_SETTINGS.desiredProfit)}
                        <td style={tdNum} />
                        {edit(DEFAULT_SETTINGS_KEY, 'expectedDeliveryRate', defaults.expectedDeliveryRate, BUILTIN_SETTINGS.expectedDeliveryRate)}
                        <td style={tdNum} />
                    </tr>
                    {rows.map((u, idx) => (
                        <tr key={u.productId} className="pip-row" style={{ background: idx % 2 ? 'rgba(0,0,0,0.015)' : 'transparent', opacity: u.isActive ? 1 : 0.6 }}>
                            <td className="pip-sticky-first" style={{ padding: '8px 12px', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)', overflow: 'hidden' }}>
                                <div className="d2-khmer" style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.5 }} title={u.name}>{u.name || u.productId}</div>
                                {(u.model || !u.isActive) && (
                                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {u.model}{!u.isActive && <>{u.model ? ' · ' : ''}{t('cpaTracker.inactive')}</>}
                                    </div>
                                )}
                            </td>
                            <td style={tdNum} title={t('cpaTracker.fromInventory')}><MoneyText value={u.price} /></td>
                            <td style={tdNum} title={t('cpaTracker.fromInventory')}><MoneyText value={u.cogs} /></td>
                            {edit(u.productId, 'courierFee', u.own.courierFee, builtinOr('courierFee'))}
                            {edit(u.productId, 'packaging', u.own.packaging, builtinOr('packaging'))}
                            <td style={{ ...tdNum, fontWeight: 600 }}><MoneyText value={u.hardCosts} /></td>
                            <td style={tdNum}><MoneyText value={u.breakEvenCpa} signed /></td>
                            {edit(u.productId, 'desiredProfit', u.own.desiredProfit, builtinOr('desiredProfit'))}
                            <td style={{ ...tdNum, fontWeight: 700 }}><MoneyText value={u.targetNetCpa} signed bold /></td>
                            {edit(u.productId, 'expectedDeliveryRate', u.own.expectedDeliveryRate, builtinOr('expectedDeliveryRate'))}
                            <td style={{ ...tdNum, fontWeight: 700 }}><MoneyText value={u.targetGrossCpa} signed bold /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default UnitEconomicsTable;
