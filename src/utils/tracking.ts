// Shipment tracking helpers shared by Orders, Delivery Tracking, the mobile
// order card, and the Settings shipping-company list.

export interface ShipmentTrackingRow {
    tracking_no: string;
    carrier: string | null;
    last_status: string | null;
    last_event_at: string | null;
    is_delivered: boolean;
    events: Array<{ time: string; status: string; desc: string }>;
    error: string | null;
    checked_at: string;
}

// Carriers the server-side lookup (api/track-shipments) knows how to query.
export type TrackableCarrier = 'jt';

// Built-in tracking page templates, keyed by carrier. `{tracking}` is replaced
// with the waybill number. Companies without a template (or a custom one set
// in Settings → Shipping Companies) get no link.
export const DEFAULT_TRACKING_TEMPLATES: Record<TrackableCarrier, string> = {
    jt: 'https://www.jtexpresskh.com/trajectoryQuery?waybillNo={tracking}&flag=1',
};

// Recognise a shipping-company name as a known carrier ('J&T', 'J&T Express',
// 'JT Express', 'jnt' ...).
export const detectCarrier = (company?: string | null): TrackableCarrier | null => {
    const c = String(company || '').toLowerCase().replace(/[^a-z]/g, '');
    if (c === 'jt' || c === 'jnt' || c.startsWith('jtexpress') || c.startsWith('jntexpress')) return 'jt';
    return null;
};

// The template for a company: a custom one from Settings wins, then the
// built-in one for a recognised carrier.
export const resolveTrackingTemplate = (company: string | undefined | null, custom: Record<string, string> | undefined): string | null => {
    const name = String(company || '').trim();
    if (!name) return null;
    // Own-property lookup only: company names are free text, and a name like
    // "constructor" would otherwise resolve to an inherited function.
    const raw = custom && Object.prototype.hasOwnProperty.call(custom, name) ? custom[name] : undefined;
    const own = typeof raw === 'string' ? raw.trim() : '';
    if (own) return own;
    const carrier = detectCarrier(name);
    return carrier ? DEFAULT_TRACKING_TEMPLATES[carrier] : null;
};

export const buildTrackingUrl = (company: string | undefined | null, trackingNo: string | undefined | null, custom: Record<string, string> | undefined): string | null => {
    const no = String(trackingNo || '').trim();
    if (!no) return null;
    const template = resolveTrackingTemplate(company, custom);
    if (!template) return null;
    return template.includes('{tracking}')
        ? template.replace(/\{tracking\}/g, encodeURIComponent(no))
        : template + encodeURIComponent(no);
};

// Carriers whose status can be fetched automatically by api/track-shipments.
// EMPTY for now: J&T's public tracking endpoint demands a Tencent Captcha
// ticket on every call (verified 2026-09), so it can't be queried from a
// server. Add 'jt' here once an adapter for J&T's official merchant API
// (credentials from J&T) is in place — the rest of the pipeline (cache table,
// hook, status chips, Track Shipped button) switches on by itself.
const AUTO_TRACKABLE: ReadonlySet<TrackableCarrier> = new Set<TrackableCarrier>([]);
export const canAutoTrack = (company?: string | null): boolean => {
    const carrier = detectCarrier(company);
    return carrier !== null && AUTO_TRACKABLE.has(carrier);
};

// "2h ago" style label for a checked_at / event timestamp.
export const timeAgo = (iso?: string | null): string => {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return iso;
    const diff = Math.max(0, Date.now() - t);
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
};

// A cached carrier status is fresh enough to skip re-checking.
export const isRecentlyChecked = (row: ShipmentTrackingRow | undefined, maxAgeMinutes: number): boolean => {
    if (!row?.checked_at) return false;
    const t = new Date(row.checked_at).getTime();
    return !isNaN(t) && Date.now() - t < maxAgeMinutes * 60000;
};
