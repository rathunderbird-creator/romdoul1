// The one province → district → commune → village tree every address picker
// uses: the official gazetteer (src/data/cambodia.json) with Sales Setup's
// overrides from app_config layered on top —
//   customDistricts / customCommunes        shop-specific entries, added
//   removedDistrictCodes / removedCommuneCodes  official entries, hidden
//
// Hidden entries stay IN the tree, flagged `isHidden`, so an order or a
// shipping point that already uses a hidden name can still be resolved and
// shown; pickers list only visible entries (see pickerOptions), plus whatever
// value the record currently holds so it never blanks out.
import type { CustomDistrict, CustomCommune } from '../types';

export interface LocNode {
    code: string;
    khmer: string;
    latin: string;
    /** Added in Sales Setup (lives in app_config, not the gazetteer). */
    isCustom?: boolean;
    /** An official entry hidden in Sales Setup. */
    isHidden?: boolean;
}
export type LocVillage = LocNode;
export interface LocCommune extends LocNode { villages?: LocVillage[] }
export interface LocDistrict extends LocNode { communes?: LocCommune[] }
export interface LocProvince extends LocNode { districts?: LocDistrict[] }

export interface LocationOverrides {
    customDistricts: CustomDistrict[];
    customCommunes: CustomCommune[];
    removedDistrictCodes: string[];
    removedCommuneCodes: string[];
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function buildLocationTree(gazetteer: LocProvince[], overrides: Partial<LocationOverrides>): LocProvince[] {
    const hiddenDistricts = new Set(asArray<string>(overrides.removedDistrictCodes));
    const hiddenCommunes = new Set(asArray<string>(overrides.removedCommuneCodes));
    const customDistrictsByProvince = new Map<string, CustomDistrict[]>();
    for (const cd of asArray<CustomDistrict>(overrides.customDistricts)) {
        if (!cd?.code) continue;
        const list = customDistrictsByProvince.get(cd.provinceCode) || [];
        list.push(cd);
        customDistrictsByProvince.set(cd.provinceCode, list);
    }
    const customCommunesByDistrict = new Map<string, CustomCommune[]>();
    for (const cc of asArray<CustomCommune>(overrides.customCommunes)) {
        if (!cc?.code) continue;
        const list = customCommunesByDistrict.get(cc.districtCode) || [];
        list.push(cc);
        customCommunesByDistrict.set(cc.districtCode, list);
    }

    const communesFor = (districtCode: string, official: LocCommune[]): LocCommune[] => [
        ...official.map(c => (hiddenCommunes.has(c.code) ? { ...c, isHidden: true } : c)),
        // Custom communes have no villages of their own.
        ...(customCommunesByDistrict.get(districtCode) || []).map(cc => ({
            code: cc.code, khmer: cc.khmer, latin: cc.latin || cc.khmer, isCustom: true, villages: [],
        })),
    ];

    return gazetteer.map(p => ({
        code: p.code, khmer: p.khmer, latin: p.latin,
        districts: [
            ...(p.districts || []).map(d => ({
                code: d.code, khmer: d.khmer, latin: d.latin,
                ...(hiddenDistricts.has(d.code) ? { isHidden: true } : {}),
                communes: communesFor(d.code, d.communes || []),
            })),
            ...(customDistrictsByProvince.get(p.code) || []).map(cd => ({
                code: cd.code, khmer: cd.khmer, latin: cd.latin || cd.khmer, isCustom: true,
                communes: communesFor(cd.code, []),
            })),
        ],
    }));
}

// ─── Name matching ─────────────────────────────────────────────────────────

// Khmer names arrive with zero-width characters (pasted from chats), stray
// spaces, and an optional administrative prefix ("ខេត្តសៀមរាប" vs "សៀមរាប",
// "សង្កាត់ស្វាយដង្គំ" vs "ស្វាយដង្គំ"). Compare on this reduced form.
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const ADMIN_PREFIX = /^(ខេត្ត|រាជធានី|ស្រុក|ខណ្ឌ|ក្រុង|ឃុំ|សង្កាត់)/;

export const cleanLocName = (s: string | null | undefined): string =>
    String(s ?? '').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();

export const normalizeLocName = (s: string | null | undefined): string =>
    String(s ?? '').replace(ZERO_WIDTH, '').replace(/\s+/g, '').replace(ADMIN_PREFIX, '').toLowerCase();

/** Exact (Khmer or Latin) first, then the normalised form — so two siblings
 *  that only differ by prefix (ក្រុងX / ស្រុកX) still resolve correctly. */
export function findByName<T extends LocNode>(list: T[] | undefined, name: string | null | undefined): T | undefined {
    if (!list || !name) return undefined;
    const clean = cleanLocName(name);
    if (!clean) return undefined;
    const lower = clean.toLowerCase();
    const exact = list.find(n => n.khmer === clean || n.latin.toLowerCase() === lower);
    if (exact) return exact;
    const norm = normalizeLocName(clean);
    if (!norm) return undefined;
    return list.find(n => normalizeLocName(n.khmer) === norm || normalizeLocName(n.latin) === norm);
}

export interface ResolvedPath {
    province?: LocProvince;
    district?: LocDistrict;
    commune?: LocCommune;
}

/** Walk province → district → commune by name as far as it matches. */
export function resolvePath(tree: LocProvince[], province?: string | null, district?: string | null, commune?: string | null): ResolvedPath {
    const p = findByName(tree, province);
    if (!p) return {};
    const d = findByName(p.districts, district);
    if (!d) return { province: p };
    const c = findByName(d.communes, commune);
    return { province: p, district: d, commune: c };
}

/** Walk the tree by gazetteer code prefix (01 / 0102 / 010201 / 01020101). */
export function resolveByCode(tree: LocProvince[], code: string | null | undefined): ResolvedPath & { village?: LocVillage } {
    if (!code || !/^\d{2,}$/.test(code)) return {};
    const p = tree.find(x => x.code === code.slice(0, 2));
    if (!p || code.length < 4) return { province: p };
    const d = p.districts?.find(x => x.code === code.slice(0, 4));
    if (!d || code.length < 6) return { province: p, district: d };
    const c = d.communes?.find(x => x.code === code.slice(0, 6));
    if (!c || code.length < 8) return { province: p, district: d, commune: c };
    return { province: p, district: d, commune: c, village: c.villages?.find(x => x.code === code) };
}

// ─── Picker helpers ────────────────────────────────────────────────────────

export const visibleOnly = <T extends LocNode>(list: T[] | undefined): T[] =>
    (list || []).filter(n => !n.isHidden);

/**
 * Options for a name-valued <select>: the visible entries, plus the record's
 * current value when it isn't among them (a hidden entry, or a free-typed
 * name that matches nothing) — so editing an old order never blanks it.
 * The returned `value` is what the select should be bound to.
 */
export function pickerOptions<T extends LocNode>(list: T[] | undefined, current: string | null | undefined): { options: LocNode[]; value: string } {
    const visible: LocNode[] = visibleOnly(list);
    const cur = current || '';
    if (!cur) return { options: visible, value: '' };
    const hit = findByName(list, cur);
    if (hit && !hit.isHidden) {
        // Bind to the canonical Khmer only when the stored value IS that
        // name; a prefixed/variant spelling keeps its own option.
        if (hit.khmer === cur) return { options: visible, value: cur };
    }
    return { options: [...visible, { code: `__current:${cur}`, khmer: cur, latin: hit ? hit.latin : cur, isHidden: hit?.isHidden }], value: cur };
}

/** Same as pickerOptions, for a code-valued <select>. */
export function pickerOptionsByCode<T extends LocNode>(list: T[] | undefined, currentCode: string): T[] {
    const visible = visibleOnly(list);
    if (!currentCode || visible.some(n => n.code === currentCode)) return visible;
    const hit = (list || []).find(n => n.code === currentCode);
    return hit ? [...visible, hit] : visible;
}

export const locLabel = (n: LocNode): string =>
    (n.khmer === n.latin ? n.khmer : `${n.khmer} (${n.latin})`) + (n.isHidden ? ' — hidden' : '');
