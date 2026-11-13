// Shipping points (drop-off / checkpoint pins) — the rows of the
// custom_locations table. This is the ONE source for them: the Shipping Point
// map page and Sales Setup's Province tree both read and write here.
import { supabase } from '../lib/supabase';
import { fetchAll } from './fetchAll';
import { resolveByCode, resolvePath, type LocProvince, type LocDistrict, type LocCommune } from './locationTree';

export const SHIPPING_POINTS_TABLE = 'custom_locations';

export interface ShippingPoint {
    id: string;
    pcode: string;
    name: string;
    lat: number;
    lng: number;
    type?: string | null;
    courier?: string | null;
    province?: string | null;
    district?: string | null;
    commune?: string | null;
    phone?: string | null;
    contact_name?: string | null;
    is_shutdown?: boolean;
}

export interface ShippingPointFields {
    name: string;
    lat: number;
    lng: number;
    courier: string;
    province: string;
    district: string;
    commune: string;
    phone: string;
    contactName: string;
    isShutdown: boolean;
}

// Chunk-fetched: a bare select('*') is silently capped by PostgREST around
// 1000 rows, and the pin list is already past 500.
export const fetchShippingPoints = (table: string = SHIPPING_POINTS_TABLE) =>
    fetchAll<ShippingPoint>((from, to) =>
        supabase.from(table).select('*').order('id', { ascending: true }).range(from, to),
        1000, { label: 'shipping points' }
    );

const rowFields = (f: ShippingPointFields) => ({
    name: f.name.trim(),
    lat: f.lat,
    lng: f.lng,
    courier: f.courier || null,
    province: f.province || null,
    district: f.district || null,
    commune: f.commune || null,
    phone: f.phone || null,
    contact_name: f.contactName || null,
    is_shutdown: f.isShutdown || false,
    updated_at: new Date().toISOString(),
});

/** Insert a new custom point (id null) or update an existing one. */
export async function saveShippingPoint(fields: ShippingPointFields, id: string | null, table: string = SHIPPING_POINTS_TABLE): Promise<void> {
    if (!fields.name.trim()) throw new Error('សូមបញ្ចូលឈ្មោះទីតាំង (Enter custom location name)');
    if (!Number.isFinite(fields.lat) || !Number.isFinite(fields.lng)) throw new Error('A valid latitude and longitude are required.');
    if (id) {
        const { error } = await supabase.from(table).update(rowFields(fields)).eq('id', id);
        if (error) throw error;
    } else {
        const { error } = await supabase.from(table).insert({
            pcode: 'CUSTOM_' + Date.now().toString(),
            type: 'custom',
            ...rowFields(fields),
        });
        if (error) throw error;
    }
}

export async function setShippingPointShutdown(id: string, isShutdown: boolean, table: string = SHIPPING_POINTS_TABLE): Promise<void> {
    const { error } = await supabase.from(table).update({ is_shutdown: isShutdown, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
}

export async function deleteShippingPoint(id: string, table: string = SHIPPING_POINTS_TABLE): Promise<void> {
    const { error, data } = await supabase.from(table).delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Nothing was deleted — the point is already gone, or the database refused it.');
}

/**
 * "11.5564, 104.9282", or a Google Maps link containing @lat,lng / q=lat,lng.
 * Both numbers must stand on their own: a match may not start or end inside a
 * longer number, so a swapped "104.9282, 11.5564" is rejected rather than
 * read as 4.9282, 11.5564. Returns any valid world position — check
 * isInCambodia before saving a typed one.
 */
export function parseLatLng(text: string): [number, number] | null {
    const m = String(text || '').match(/(?<![\d.])(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)(?![\d.])/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return [lat, lng];
}

/** Roughly Cambodia's bounding box, with a small margin (lat 9.5–15, lng 102–108). */
export const isInCambodia = (lat: number, lng: number): boolean =>
    lat >= 9.5 && lat <= 15 && lng >= 102 && lng <= 108;

// ─── Placing points on the address tree ───────────────────────────────────

export interface PointPlacement {
    /** Points that matched down to a visible commune. */
    byCommune: Map<string, ShippingPoint[]>;
    /** Matched a visible district but no (visible) commune. */
    byDistrict: Map<string, ShippingPoint[]>;
    /** Matched a visible province but no (visible) district. */
    byProvince: Map<string, ShippingPoint[]>;
    /** Matched no province by name. */
    unplaced: ShippingPoint[];
    /** Why a point sits above commune level / is unplaced, by point id. */
    notes: Map<string, string>;
    /** Totals including everything below. */
    districtCounts: Map<string, number>;
    provinceCounts: Map<string, number>;
}

const push = (m: Map<string, ShippingPoint[]>, k: string, p: ShippingPoint) => {
    const list = m.get(k);
    if (list) list.push(p); else m.set(k, [p]);
};
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);

/**
 * Put every point on the deepest VISIBLE tree node its province / district /
 * commune names match (normalised — see findByName). Nothing is dropped: a
 * point whose district or commune is hidden or unknown stays on the level
 * above with a note, and one with no matching province goes to `unplaced`.
 */
export function placeShippingPoints(tree: LocProvince[], points: ShippingPoint[]): PointPlacement {
    const out: PointPlacement = {
        byCommune: new Map(), byDistrict: new Map(), byProvince: new Map(), unplaced: [],
        notes: new Map(), districtCounts: new Map(), provinceCounts: new Map(),
    };
    for (const pt of points) {
        const { province, district, commune } = resolvePath(tree, pt.province, pt.district, pt.commune);
        if (!province) {
            const byCode = resolveByCode(tree, pt.pcode);
            const path = [byCode.province, byCode.district, byCode.commune, byCode.village].filter(Boolean).map(n => n!.khmer).join(' › ');
            out.notes.set(pt.id, pt.province
                ? `Province "${pt.province}" not found`
                : path ? `No province saved · area code ${pt.pcode} (${path})` : 'No province saved');
            out.unplaced.push(pt);
            continue;
        }
        bump(out.provinceCounts, province.code);
        const d: LocDistrict | undefined = district && !district.isHidden ? district : undefined;
        if (!d) {
            if (pt.district) out.notes.set(pt.id, district?.isHidden ? `District "${pt.district}" is hidden` : `District "${pt.district}" not in list`);
            push(out.byProvince, province.code, pt);
            continue;
        }
        bump(out.districtCounts, d.code);
        const c: LocCommune | undefined = commune && !commune.isHidden ? commune : undefined;
        if (!c) {
            if (pt.commune) out.notes.set(pt.id, commune?.isHidden ? `Commune "${pt.commune}" is hidden` : `Commune "${pt.commune}" not in list`);
            push(out.byDistrict, d.code, pt);
            continue;
        }
        push(out.byCommune, c.code, pt);
    }
    return out;
}
