// A Sales Setup name list that shows built-in defaults until a store saves
// its own (Rejection Reasons, Delivery Types). Pure helpers, unit tested via
// tests/rejection-reasons.test.mjs and tests/delivery-types.test.mjs.
import type { ConfigOp } from './configOps';

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The list the app offers: the saved one, or the defaults while none is saved.
export const defaultedList = (saved: unknown, defaults: string[]): string[] =>
    Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : defaults;

// The config op for an add or a remove, or null when nothing changes (empty
// name, a duplicate add, removing a name that isn't listed). While no list is
// saved the defaults are on screen, so the first edit saves the whole list
// ('set') — an append/removeItems on the missing key would drop the defaults.
export const defaultedListOp = (saved: unknown, defaults: string[], action: 'add' | 'remove', name: string): ConfigOp | null => {
    const clean = name.trim();
    if (!clean) return null;
    const list = defaultedList(saved, defaults);
    if (action === 'add') {
        if (list.some(r => sameName(r, clean))) return null;
        return Array.isArray(saved) ? { op: 'append', items: [clean] } : { op: 'set', value: [...list, clean] };
    }
    const matches = list.filter(r => sameName(r, clean));
    if (matches.length === 0) return null;
    return Array.isArray(saved) ? { op: 'removeItems', values: matches } : { op: 'set', value: list.filter(r => !sameName(r, clean)) };
};
