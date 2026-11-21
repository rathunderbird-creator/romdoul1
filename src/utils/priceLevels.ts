// Sales Setup › Price Levels: a percent off for the customers of some
// Customer Groups ("Dealer · 10% off" for VIP and Reseller). When Checkout's
// phone belongs to a customer in a linked group, the level fills Checkout's
// USD discount, like a Discounts preset: the order still saves one USD
// discount, so nothing in saving, stock, posting or the receipt changes.
// app_config priceLevels: [{ name, pct, groups }]; a group is in at most one
// level. Pure helpers, tests/price-levels.test.mjs.
import { roundCents } from './money';
import { sameName } from './defaultedList';
import { customerGroupOf, type CustomerGroupMembers } from './customerGroups';

export interface PriceLevel {
    name: string;
    pct: number;
    groups: string[];
}

export const MAX_PRICE_LEVEL_NAME = 40;

const validLevel = (p: unknown): p is { name: string; pct: number; groups?: unknown } => {
    if (!p || typeof p !== 'object') return false;
    const { name, pct } = p as Record<string, unknown>;
    return typeof name === 'string' && name.trim() !== ''
        && typeof pct === 'number' && Number.isFinite(pct) && pct > 0 && pct <= 100;
};

// The saved list, without anything malformed; each group once, and a group
// claimed by an earlier level dropped from later ones.
export const priceLevelList = (saved: unknown): PriceLevel[] => {
    if (!Array.isArray(saved)) return [];
    const taken: string[] = [];
    const out: PriceLevel[] = [];
    for (const p of saved) {
        if (!validLevel(p) || out.some(l => sameName(l.name, p.name))) continue;
        const groups: string[] = [];
        for (const g of Array.isArray(p.groups) ? p.groups : []) {
            if (typeof g !== 'string' || !g.trim() || taken.some(x => sameName(x, g))) continue;
            groups.push(g.trim());
            taken.push(g.trim());
        }
        out.push({ name: p.name.trim(), pct: roundCents(p.pct), groups });
    }
    return out;
};

// Why a new level can't be added (an i18n key under
// ui.admin.salesSetup.priceLevel), or null when it can.
export const priceLevelProblem = (list: PriceLevel[], name: string, pct: string): string | null => {
    if (!name.trim()) return 'needName';
    if (list.some(l => sameName(l.name, name))) return 'duplicate';
    const n = pct.trim() === '' ? NaN : roundCents(Number(pct));
    if (!Number.isFinite(n) || n <= 0) return 'badValue';
    if (n > 100) return 'pctOver100';
    return null;
};

export const withPriceLevel = (list: PriceLevel[], name: string, pct: number): PriceLevel[] =>
    [...list, { name: name.trim().slice(0, MAX_PRICE_LEVEL_NAME), pct: roundCents(pct), groups: [] }];

export const withoutPriceLevel = (list: PriceLevel[], name: string): PriceLevel[] =>
    list.filter(l => !sameName(l.name, name));

// Link a group to a level (taking it off any other level), or unlink it.
export const withLevelGroup = (list: PriceLevel[], level: string, group: string, on: boolean): PriceLevel[] => {
    const g = group.trim();
    if (!g || !list.some(l => sameName(l.name, level))) return list;
    return list.map(l => {
        const rest = l.groups.filter(x => !sameName(x, g));
        return { ...l, groups: on && sameName(l.name, level) ? [...rest, g] : rest };
    });
};

// The list after a Customer Group is removed: off every level, so a group
// made later with the same name doesn't bring an old level back.
export const withoutGroupOnLevels = (list: PriceLevel[], group: string): PriceLevel[] =>
    list.map(l => ({ ...l, groups: l.groups.filter(g => !sameName(g, group)) }));

// The level a group's customers get, or null.
export const priceLevelForGroup = (list: PriceLevel[], group: string): PriceLevel | null =>
    group.trim() ? list.find(l => l.groups.some(g => sameName(g, group))) || null : null;

// The level (and the group it comes from) for a customer's phone, or null.
export const priceLevelForPhone = (list: PriceLevel[], members: CustomerGroupMembers, phone: unknown): { level: PriceLevel; group: string } | null => {
    const group = customerGroupOf(members, phone);
    const level = group ? priceLevelForGroup(list, group) : null;
    return level ? { level, group } : null;
};

// The USD discount a level gives on this subtotal (0 … subtotal).
export const priceLevelAmount = (level: PriceLevel, subtotal: number): number => {
    const sub = Math.max(0, Number(subtotal) || 0);
    return roundCents(Math.min(sub, Math.max(0, sub * level.pct / 100)));
};

// "10% off" style number for a chip or row.
export const priceLevelPctLabel = (level: PriceLevel): string => `${Number(level.pct.toFixed(2))}%`;
