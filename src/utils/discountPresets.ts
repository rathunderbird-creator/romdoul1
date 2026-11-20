// Sales Setup › Discounts: preset discounts offered as quick picks in
// Checkout (app_config discountPresets). A pick only fills Checkout's
// existing USD discount field — the order still saves one USD discount, so
// nothing in saving, posting or the receipt changes. Pure helpers, unit
// tested in tests/discount-presets.test.mjs.
import { roundCents } from './money';

export interface DiscountPreset {
    name: string;
    type: 'usd' | 'pct';
    value: number;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const validPreset = (p: unknown): p is DiscountPreset => {
    if (!p || typeof p !== 'object') return false;
    const { name, type, value } = p as Record<string, unknown>;
    return typeof name === 'string' && name.trim() !== ''
        && (type === 'usd' || type === 'pct')
        && typeof value === 'number' && Number.isFinite(value) && value > 0
        && (type !== 'pct' || value <= 100);
};

// The saved list, without anything malformed (a hand-edited config).
export const discountPresetList = (saved: unknown): DiscountPreset[] =>
    Array.isArray(saved) ? saved.filter(validPreset).map(p => ({ name: p.name.trim(), type: p.type, value: p.value })) : [];

// Why a new preset can't be added (an i18n key under
// ui.admin.salesSetup.discount), or null when it can.
export const discountPresetProblem = (list: DiscountPreset[], name: string, type: string, value: string): string | null => {
    if (!name.trim()) return 'needName';
    if (list.some(p => same(p.name, name))) return 'duplicate';
    // Checked as it will be saved (rounded to cents / 2 decimals).
    const n = value.trim() === '' ? NaN : roundCents(Number(value));
    if (!Number.isFinite(n) || n <= 0) return 'badValue';
    if (type === 'pct' && n > 100) return 'pctOver100';
    if (type !== 'pct' && type !== 'usd') return 'badValue';
    return null;
};

// The new list after adding (value rounded: cents, or 2 decimals of a percent).
export const withDiscountPreset = (list: DiscountPreset[], name: string, type: 'usd' | 'pct', value: number): DiscountPreset[] =>
    [...list, { name: name.trim(), type, value: roundCents(value) }];

export const withoutDiscountPreset = (list: DiscountPreset[], name: string): DiscountPreset[] =>
    list.filter(p => !same(p.name, name));

// The USD discount a preset gives on this subtotal: a percent of it, or the
// fixed amount — never below 0 or above the subtotal (the total can't go
// negative).
export const discountPresetAmount = (p: DiscountPreset, subtotal: number): number => {
    const sub = Math.max(0, Number(subtotal) || 0);
    const raw = p.type === 'pct' ? sub * p.value / 100 : p.value;
    return roundCents(Math.min(sub, Math.max(0, raw)));
};

// "10%" or "$2.00" — the part after the name on a chip or row.
export const discountPresetValueLabel = (p: DiscountPreset): string =>
    p.type === 'pct' ? `${Number(p.value.toFixed(2))}%` : `$${p.value.toFixed(2)}`;
