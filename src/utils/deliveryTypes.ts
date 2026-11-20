// Sales Setup › Delivery Types: how an order travels (Phnom Penh delivery,
// Province courier, Grab / Express, Customer pickup…). An order's type
// FOLLOWS ITS COURIER: each shipping company is given a type in Sales Setup
// (app_config courierDeliveryTypes, company -> type), so every order — past
// ones too — shows its courier's type, with nothing extra to pick or save on
// the order. The list itself is app_config deliveryTypes (defaults until a
// store saves its own). Pure helpers, tests/delivery-types.test.mjs.
import type { ConfigOp } from './configOps';
import { defaultedList, defaultedListOp, sameName } from './defaultedList';

export const DEFAULT_DELIVERY_TYPES = [
    'Phnom Penh delivery',
    'Province courier',
    'Grab / Express',
    'Customer pickup',
];

export const deliveryTypeList = (saved: unknown): string[] => defaultedList(saved, DEFAULT_DELIVERY_TYPES);
export const deliveryTypeOp = (saved: unknown, action: 'add' | 'remove', name: string): ConfigOp | null =>
    defaultedListOp(saved, DEFAULT_DELIVERY_TYPES, action, name);

// The saved courier -> type map, without anything malformed.
export const courierTypeMap = (saved: unknown): Record<string, string> => {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
        if (k.trim() && typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
};

// Every stored spelling of this courier in the map (the order's
// shipping_company may differ in case or spaces from Sales Setup's name).
export const courierKeys = (map: Record<string, string>, company: string): string[] =>
    company.trim() ? Object.keys(map).filter(k => sameName(k, company)) : [];

// The type an order shows: its courier's, or '' when the courier has none.
export const courierDeliveryType = (map: Record<string, string>, company?: string | null): string => {
    const k = courierKeys(map, company || '')[0];
    return k ? map[k] : '';
};

// The map after giving a courier a type ('' clears it). Every other stored
// spelling of the courier is dropped, so one type remains. Saved whole
// (built from a fresh read): one write can hold only one op per key.
export const withCourierType = (map: Record<string, string>, company: string, type: string): Record<string, string> => {
    const name = company.trim();
    if (!name) return map;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) if (!sameName(k, name)) next[k] = v;
    if (type.trim()) next[name] = type.trim();
    return next;
};

// The op that gives ONE courier a type ('' clears it), scoped to that
// courier's keys so overlapping edits of other couriers can't undo each
// other: merge reuses the saved spelling; clearing unsets every spelling.
// null when nothing changes.
export const courierTypeOp = (map: Record<string, string>, company: string, type: string): ConfigOp | null => {
    const name = company.trim();
    if (!name) return null;
    const keys = courierKeys(map, name);
    const t = type.trim();
    if (!t) return keys.length ? { op: 'unsetKeys', keys } : null;
    const key = keys[0] ?? name;
    return map[key] === t ? null : { op: 'merge', value: { [key]: t } };
};

// The op that frees the couriers of a type removed from the list.
export const freeCouriersOfTypeOp = (map: Record<string, string>, type: string): ConfigOp | null => {
    const keys = Object.keys(map).filter(k => sameName(map[k], type));
    return keys.length ? { op: 'unsetKeys', keys } : null;
};

// The map after a type is removed from the list: its couriers go back to none.
export const withoutTypeInMap = (map: Record<string, string>, type: string): Record<string, string> => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) if (!sameName(v, type)) next[k] = v;
    return next;
};

// Orders column filter: the couriers whose type contains the typed text.
export const couriersMatchingTypeText = (map: Record<string, string>, text: string): string[] => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return Object.keys(map).filter(k => map[k].toLowerCase().includes(q));
};
