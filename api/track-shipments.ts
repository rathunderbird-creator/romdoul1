// Vercel serverless function: looks up carrier tracking status server-side.
//
// The browser can't call carrier sites directly (cross-origin), so the app
// POSTs { items: [{ trackingNo, carrier }] } here and gets back normalised
// statuses. Deployed automatically with the site (any file under /api on
// Vercel; vercel.json raises its maxDuration). Nothing here touches the
// database — the client stores results.
//
// Carrier adapters: keep each one isolated and fail-soft; carriers change
// their endpoints and may gate lookups behind a captcha.

interface TrackItem { trackingNo: string; carrier: string }
interface TrackEvent { time: string; status: string; desc: string }
interface TrackResult {
    trackingNo: string;
    carrier: string;
    ok: boolean;
    status: string | null;
    lastEventAt: string | null;
    isDelivered: boolean;
    events: TrackEvent[];
    error: string | null;
}

// Budget: MAX_ITEMS / CONCURRENCY rounds x TIMEOUT_MS must stay under the
// function's maxDuration (30s in vercel.json): 12 / 4 = 3 rounds x 6s = 18s.
const MAX_ITEMS = 12;
const CONCURRENCY = 4;
const TIMEOUT_MS = 6000;
const MAX_TRACKING_LEN = 40;

const stripHtml = (s: unknown) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// Final-delivery detection on the STATUS name only (not the free-text scan
// description): J&T's transit scans routinely contain "received" / "collected",
// and a false positive is sticky (the cache never re-checks a delivered parcel).
const isFinalDelivered = (status: string | null) => {
    const s = String(status || '').trim().toLowerCase();
    if (!s) return false;
    if (/out for delivery|delivering|attempt|failed|return/.test(s)) return false;
    return /^(delivered|signed|signed for|delivery successful|successfully delivered)/.test(s) || /已签收|ចែកចាយ/.test(s);
};

// --- J&T Express Cambodia -------------------------------------------------
// Same endpoint the public tracking page (jtexpresskh.com/trajectoryQuery)
// calls. Response: { code, succ, msg, data: { records: [{ isMaster, details:
// [{ scanTime, status, customerTracking }], ... }] } }.
async function trackJt(trackingNo: string): Promise<TrackResult> {
    const base: TrackResult = { trackingNo, carrier: 'jt', ok: false, status: null, lastEventAt: null, isDelivered: false, events: [], error: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch('https://ylofficial.jtexpresskh.com/official/logisticsTracking/v3/getDetailByWaybillNo', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://www.jtexpresskh.com',
                'Referer': 'https://www.jtexpresskh.com/trajectoryQuery',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
                'lang': 'EN',
            },
            body: JSON.stringify({ waybillNo: trackingNo, langType: 'EN', current: 1, size: 10 }),
            signal: controller.signal,
        });
        if (!res.ok) return { ...base, error: `Carrier responded ${res.status}` };
        const json: any = await res.json();
        // Verified 2026-09: the public endpoint answers code 999001030 "ticket /
        // randstr cannot be empty" — a Tencent Captcha ticket is mandatory on
        // every call, so lookups only work from a real browser session on
        // jtexpresskh.com. Report that plainly rather than as a generic failure.
        const msg = stripHtml(json?.msg);
        if (String(json?.code) === '999001030' || /ticket|randstr/i.test(msg)) {
            return { ...base, error: 'J&T requires captcha verification for tracking lookups; automatic checks are not possible via the public site. Use the Track link, or connect the official J&T merchant API.' };
        }
        if (!json || json.succ === false || (json.code !== undefined && String(json.code) !== '1' && json.succ !== true)) {
            return { ...base, error: msg || 'Carrier rejected the lookup (unknown waybill)' };
        }
        const records: any[] = json?.data?.records || [];
        if (records.length === 0) return { ...base, ok: true, status: 'Not found', error: null };
        const master = records.find(r => r.isMaster === 1 || r.isMaster === true) || records[0];
        const details: any[] = Array.isArray(master?.details) ? master.details : [];
        const events: TrackEvent[] = details.map(d => ({
            time: String(d.scanTime || d.time || ''),
            status: stripHtml(d.status),
            desc: stripHtml(d.customerTracking || d.desc || d.remark),
        }));
        const latest = events[0];
        const status = latest?.status || master?.waybillStatusName || null;
        return { ...base, ok: true, status, lastEventAt: latest?.time || null, isDelivered: isFinalDelivered(status), events };
    } catch (e: any) {
        return { ...base, error: e?.name === 'AbortError' ? 'Carrier timed out' : (e?.message || 'Lookup failed') };
    } finally {
        clearTimeout(timer);
    }
}

const ADAPTERS: Record<string, (no: string) => Promise<TrackResult>> = { jt: trackJt };

async function runLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return out;
}

export default async function handler(req: any, res: any) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
    const items: TrackItem[] = Array.isArray(body.items) ? body.items : [];
    const valid = items
        .map(i => ({ trackingNo: String(i?.trackingNo || '').trim().slice(0, MAX_TRACKING_LEN), carrier: String(i?.carrier || '').toLowerCase() }))
        .filter(i => /^[A-Za-z0-9-]+$/.test(i.trackingNo) && ADAPTERS[i.carrier])
        .slice(0, MAX_ITEMS);
    if (valid.length === 0) {
        res.status(400).json({ error: 'No trackable items (supported carriers: jt)', results: [] });
        return;
    }
    const results = await runLimited(valid, CONCURRENCY, (i) => ADAPTERS[i.carrier](i.trackingNo));
    res.status(200).json({ results });
}
