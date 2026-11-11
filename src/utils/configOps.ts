// Per-key operations for the shared app_config blob (audit APP-1).
//
// Every settings write used to upsert the ENTIRE config JSON from the
// terminal's in-memory copy, silently reverting whatever other terminals had
// saved since this one last loaded. The database function update_app_config
// (migrations/add_config_functions.sql) fixes that: the client sends only the
// operations for the keys it changed, the database locks the config row and
// merges them into the STORED value. Writers to different keys both win;
// same-key 'set' is last-write-wins (fine for scalars); array keys use
// append/prepend/removeItems/updateItems so two terminals adding DIFFERENT
// entries (e.g. two scammers to the blocklist) both keep theirs.
//
// applyConfigOpsLocally is the exact JS mirror of the SQL (cfg_apply_op): it
// drives the optimistic UI update, and the read-merge-write fallback for a
// store that has not run the migration yet. Keep the two in sync.

export type ConfigOp =
    | { op: 'set'; value: unknown }
    | { op: 'remove' }
    | { op: 'merge'; value: Record<string, unknown> }
    | { op: 'unsetKeys'; keys: string[] }
    | { op: 'append' | 'prepend'; items: unknown[]; idKey?: string; norm?: 'phone' }
    | { op: 'removeItems'; values: unknown[]; idKey?: string; norm?: 'phone' }
    | { op: 'updateItems'; items: unknown[]; idKey?: string; norm?: 'phone' };

// One operation per top-level config key.
export type ConfigOps = Record<string, ConfigOp>;

// The comparable identity of one array item — mirror of cfg_internal.cfg_item_key.
// With idKey, an object item is identified by that field; otherwise (and for
// non-objects) by its own value. norm 'phone' compares digits only, the same
// rule as normalizePhone: blocklist entries carry mixed phone formats.
const itemKey = (item: unknown, idKey?: string, norm?: string): string | null => {
    let raw: unknown = item;
    if (idKey && item && typeof item === 'object' && !Array.isArray(item)) {
        raw = (item as Record<string, unknown>)[idKey];
    }
    if (raw === null || raw === undefined) return null;
    const text = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
    return norm === 'phone' ? text.replace(/\D/g, '') : text;
};

const asArray = (cur: unknown): unknown[] => (Array.isArray(cur) ? cur : []);
const asObject = (cur: unknown): Record<string, unknown> =>
    cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur as Record<string, unknown>) : {};

const applyOp = (cur: unknown, op: ConfigOp): unknown => {
    switch (op.op) {
        case 'set':
            return op.value;
        case 'merge':
            return { ...asObject(cur), ...(op.value || {}) };
        case 'unsetKeys': {
            const out = { ...asObject(cur) };
            for (const k of op.keys || []) delete out[k];
            return out;
        }
        case 'append':
        case 'prepend': {
            const arr = asArray(cur);
            const keys = new Set(arr.map(e => itemKey(e, op.idKey, op.norm)));
            const added: unknown[] = [];
            for (const item of op.items || []) {
                const key = itemKey(item, op.idKey, op.norm);
                if (keys.has(key)) continue; // already there (or already in this batch)
                keys.add(key);
                added.push(item);
            }
            return op.op === 'prepend' ? [...added, ...arr] : [...arr, ...added];
        }
        case 'removeItems': {
            const gone = new Set((op.values || []).map(v => itemKey(v, op.idKey, op.norm)));
            return asArray(cur).filter(e => !gone.has(itemKey(e, op.idKey, op.norm)));
        }
        case 'updateItems': {
            const byKey = new Map((op.items || []).map(item => [itemKey(item, op.idKey, op.norm), item]));
            return asArray(cur).map(e => {
                const match = byKey.get(itemKey(e, op.idKey, op.norm));
                return match === undefined ? e : match;
            });
        }
    }
};

// The whole ops object applied to a config blob. Returns a NEW object; the
// input is never mutated.
export function applyConfigOpsLocally<T extends object>(base: T, ops: ConfigOps): T {
    const next: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, op] of Object.entries(ops)) {
        if (op.op === 'remove') delete next[key];
        else next[key] = applyOp(next[key], op);
    }
    return next as T;
}
