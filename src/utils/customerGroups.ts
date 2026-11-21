// Sales Setup › Customer Groups: label retail customers (VIP, Reseller…) to
// slice Orders by. A retail customer has no record of its own (an order keeps
// a copy of the customer), so a customer is its PHONE: app_config
// customerGroupMembers maps the phone's digits to { group, name }, and every
// order with that phone, past ones too, shows the group. The group list is
// app_config customerGroups. A label only: nothing prices or posts by it.
// Pure helpers, tests/customer-groups.test.mjs.
import type { ConfigOp } from './configOps';
import { defaultedList, sameName } from './defaultedList';

export type CustomerGroupMember = { group: string; name?: string };
export type CustomerGroupMembers = Record<string, CustomerGroupMember>;

// The longest customer name kept on a member (the order's name, for the
// Sales Setup member list).
export const MAX_MEMBER_NAME = 80;

// A phone as the map keys it: digits only (orders carry '012 345 678',
// '012-345-678'…), the same rule as normalizePhone and the SQL
// customer_phone_digits() the Orders filter uses.
export const phoneDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

// The group list (no built-in groups: a store adds its own).
export const customerGroupList = (saved: unknown): string[] => defaultedList(saved, []);
// The op for an add or a remove, or null when nothing changes. Always
// append / removeItems (never the whole list): with no defaults to keep,
// a first save is an append too, so two first adds both land.
export const customerGroupOp = (saved: unknown, action: 'add' | 'remove', name: string): ConfigOp | null => {
    const clean = name.trim();
    if (!clean) return null;
    const list = customerGroupList(saved);
    if (action === 'add') return list.some(g => sameName(g, clean)) ? null : { op: 'append', items: [clean] };
    const matches = list.filter(g => sameName(g, clean));
    return matches.length ? { op: 'removeItems', values: matches } : null;
};

// The saved phone -> member map, without anything malformed.
export const customerGroupMemberMap = (saved: unknown): CustomerGroupMembers => {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    const out: CustomerGroupMembers = {};
    for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
        if (!k || phoneDigits(k) !== k || !v || typeof v !== 'object') continue;
        const group = (v as { group?: unknown }).group;
        const name = (v as { name?: unknown }).name;
        if (typeof group !== 'string' || !group.trim()) continue;
        out[k] = typeof name === 'string' && name.trim() ? { group: group.trim(), name: name.trim() } : { group: group.trim() };
    }
    return out;
};

// The group an order's customer is in, or ''.
export const customerGroupOf = (map: CustomerGroupMembers, phone: unknown): string => {
    const d = phoneDigits(phone);
    return d ? map[d]?.group || '' : '';
};

// The op that puts ONE phone in a group ('' takes it out), scoped to that
// phone so taggings of other customers landing meanwhile are kept. null
// when nothing changes (no digits, already so).
export const customerGroupMemberOp = (map: CustomerGroupMembers, phone: unknown, group: string, name?: string): ConfigOp | null => {
    const d = phoneDigits(phone);
    if (!d) return null;
    const g = group.trim();
    if (!g) return map[d] ? { op: 'unsetKeys', keys: [d] } : null;
    const n = (name || '').trim().slice(0, MAX_MEMBER_NAME);
    const cur = map[d];
    if (cur && cur.group === g && (cur.name || '') === n) return null;
    return { op: 'merge', value: { [d]: n ? { group: g, name: n } : { group: g } } };
};

// The phones in a group (Sales Setup's member list, removing a group).
export const phonesInGroup = (map: CustomerGroupMembers, group: string): string[] =>
    Object.keys(map).filter(k => sameName(map[k].group, group));

// The op that takes everyone out of a group removed from the list.
export const freeMembersOfGroupOp = (map: CustomerGroupMembers, group: string): ConfigOp | null => {
    const keys = phonesInGroup(map, group);
    return keys.length ? { op: 'unsetKeys', keys } : null;
};

// Orders column filter: the phones whose group contains the typed text.
export const phonesMatchingGroupText = (map: CustomerGroupMembers, text: string): string[] => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return Object.keys(map).filter(k => map[k].group.toLowerCase().includes(q));
};

// The groups a picker offers: the list, plus a member's group that was
// removed from it (or is spelled differently, even only in case) so the
// picker shows it rather than "No group".
export const customerGroupOptions = (groups: string[], current: string): string[] =>
    current && !groups.includes(current) ? [...groups, current] : groups;
