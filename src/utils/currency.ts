// Riel (KHR) money, phases 1-2. The books stay in USD: a riel payment keeps
// the riel amount it was entered in (original_amount) and the shop rate it
// used (exchange_rate), and books USD = round(riel / rate, 2). A NULL
// currency means USD (every row written before add_khr_currency.sql, and any
// row a DB function wrote that the app did not tag afterwards).
//
// The shop rate is app_config.data.khrExchangeRate (Settings > General),
// 4,100 when it is missing or not positive. Every riel row stores the rate
// it used, so changing the setting never changes an old record.
//
// Pure helpers, no supabase import (tests/currency-utils.test.mjs bundles
// this file with esbuild).
import { roundCents } from './money';

export type Currency = 'USD' | 'KHR';
export const DEFAULT_KHR_RATE = 4100;
// A rate outside this band is accepted with a warning.
export const RATE_WARN_MIN = 3500;
export const RATE_WARN_MAX = 4700;
// A USD figure at or above this and a whole multiple of 100 looks like riel
// (the Romdoul2 incident: a $2 delivery fee typed as 8000).
export const RIEL_SHAPED_MIN = 1000;
// A riel figure under this looks like dollars.
export const KHR_MIN_PLAUSIBLE = 1000;
// A riel figure within this of a fixed USD target books exactly the target.
export const SNAP_TOLERANCE_USD = 0.03;
// Above this share of the target, a riel/USD difference needs a confirm.
export const SNAP_CONFIRM_SHARE = 0.05;

export const shopRate = (configured?: number | string | null): number => {
    const n = Number(configured);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_KHR_RATE;
};

export const khrToUsd = (riel: number, rate: number): number =>
    rate > 0 && Number.isFinite(riel) ? roundCents(riel / rate) : 0;

// To the nearest `step` riel (100 by default: the smallest note in use).
export const usdToKhr = (usd: number, rate: number, step = 100): number =>
    Number.isFinite(usd) && rate > 0 ? Math.round((usd * rate) / step) * step : 0;

export const formatKhr = (n: number): string => '៛' + Math.round(Number(n) || 0).toLocaleString('en-US');
export const formatUsd = (n: number): string => {
    const v = Number(n) || 0;
    const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-$' : '$') + s;
};
export const formatRate = (r: number): string => (Number(r) || 0).toLocaleString('en-US', { maximumFractionDigits: 4 });

export type MoneyMeta = { currency: Currency; original_amount: number; exchange_rate: number };
export const CURRENCY_KEYS = ['currency', 'original_amount', 'exchange_rate'] as const;
export const usdMeta = (usd: number): MoneyMeta => ({ currency: 'USD', original_amount: roundCents(usd), exchange_rate: 1 });
export const khrMeta = (riel: number, rate: number): MoneyMeta => ({ currency: 'KHR', original_amount: Math.round(riel), exchange_rate: rate });

// A riel amount split over USD parts in proportion (one supplier payment
// over several bills): whole riel each, the last part takes the remainder so
// the parts add up to the riel paid.
export const splitRiel = (riel: number, usdParts: number[]): number[] => {
    const total = usdParts.reduce((s, x) => s + (Number(x) || 0), 0);
    const r = Math.round(riel);
    if (usdParts.length === 0) return [];
    if (!(total > 0)) return usdParts.map((_, i) => (i === usdParts.length - 1 ? r : 0));
    const out = usdParts.map(x => Math.round(r * (Number(x) || 0) / total));
    out[out.length - 1] = r - out.slice(0, -1).reduce((s, x) => s + x, 0);
    return out;
};

const toNum = (v: string | number | null | undefined): number => {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[,\s៛$]/g, '');
    return s === '' ? NaN : Number(s);
};
export const parseAmount = toNum;

// What the user typed, as the USD the books get plus the meta.
// snapToUsd: a fixed USD target (order total, balance). A riel figure within
// SNAP_TOLERANCE_USD of it books exactly the target. diffUsd = riel/rate −
// target (0 without a target or for USD).
export function resolveMoney(input: {
    amount: string | number;
    currency: Currency;
    rate: string | number;
    snapToUsd?: number | null;
}): { usd: number; meta: MoneyMeta; diffUsd: number } {
    const typed = toNum(input.amount);
    const v = Number.isFinite(typed) ? typed : 0;
    if (input.currency !== 'KHR') {
        const usd = roundCents(v);
        return { usd, meta: usdMeta(usd), diffUsd: 0 };
    }
    const rate = shopRate(toNum(input.rate));
    const raw = khrToUsd(v, rate);
    const target = input.snapToUsd;
    if (target !== undefined && target !== null && Number.isFinite(target)) {
        const diff = roundCents(raw - target);
        const usd = Math.abs(diff) <= SNAP_TOLERANCE_USD ? roundCents(target) : raw;
        return { usd, meta: khrMeta(v, rate), diffUsd: diff };
    }
    return { usd: raw, meta: khrMeta(v, rate), diffUsd: 0 };
}

export type MoneyRow = {
    amount: number | string;
    currency?: string | null;
    original_amount?: number | string | null;
    exchange_rate?: number | string | null;
};
export const isKhrRow = (row?: MoneyRow | null): boolean =>
    !!row && row.currency === 'KHR' && Number(row.original_amount) > 0 && Number(row.exchange_rate) > 0;

// "៛82,000 @ 4,100 = $20.00"; "៛80,000 @ 4,100 → $20.00 booked" when the
// booked USD differs from riel/rate by more than a cent; "$20.00" for a USD
// (or untagged) row.
export function formatMoneyLine(row: MoneyRow): string {
    const amount = Number(row.amount) || 0;
    if (!isKhrRow(row)) return formatUsd(amount);
    const riel = Number(row.original_amount);
    const rate = Number(row.exchange_rate);
    const conv = khrToUsd(riel, rate);
    const head = `${formatKhr(riel)} @ ${formatRate(rate)}`;
    return Math.abs(conv - Math.abs(amount)) > 0.011
        ? `${head} → ${formatUsd(amount)} booked`
        : `${head} = ${formatUsd(amount)}`;
}

// The USD an edited row books. A riel row is often booked at a USD that is
// not riel/rate on purpose (Settle books the order's USD; a riel figure
// within 3 cents snaps to the balance), so an edit that leaves the currency,
// the riel amount and the rate as they were keeps the booked USD. Only a
// changed figure is converted again. A USD row keeps its amount when the
// typed figure equals it.
export function editedBookedUsd(
    prev: MoneyRow,
    next: { currency: Currency; amount: string | number; rate?: string | number | null },
): number {
    const typed = toNum(next.amount);
    const v = Number.isFinite(typed) ? typed : 0;
    const prevAmount = Number(prev.amount) || 0;
    if (next.currency === 'KHR') {
        const rate = toNum(next.rate ?? NaN);
        if (isKhrRow(prev)
            && Math.round(v) === Math.round(Number(prev.original_amount))
            && Number.isFinite(rate) && Math.abs(rate - Number(prev.exchange_rate)) < 1e-9) {
            return prevAmount;
        }
        return khrToUsd(v, rate > 0 ? rate : NaN);
    }
    if (!isKhrRow(prev) && Math.abs(roundCents(v) - roundCents(prevAmount)) < 0.005) return prevAmount;
    return roundCents(v);
}

// ── Wrong-amount heuristics (warn, never block) ─────────────────────────
export type AmountWarning =
    | { kind: 'usd-looks-riel'; typed: number; asUsd: number; asRielUsd: number; rate: number; reason: 'riel-shaped' | 'over-max' }
    | { kind: 'khr-looks-usd'; typed: number; asRielUsd: number; asUsd: number; asKhr: number; rate: number }
    | { kind: 'rate-off'; rate: number; shopRate: number };

export function checkUsdAmount(v: number, o: { rate: number; maxPlausibleUsd?: number | null }): AmountWarning | null {
    if (!(v > 0)) return null;
    const rate = shopRate(o.rate);
    const overMax = o.maxPlausibleUsd !== undefined && o.maxPlausibleUsd !== null && o.maxPlausibleUsd > 0 && v > o.maxPlausibleUsd;
    const rielShaped = v >= RIEL_SHAPED_MIN && Number.isInteger(v) && v % 100 === 0;
    if (!overMax && !rielShaped) return null;
    return { kind: 'usd-looks-riel', typed: v, asUsd: roundCents(v), asRielUsd: khrToUsd(v, rate), rate, reason: rielShaped ? 'riel-shaped' : 'over-max' };
}

export function checkKhrAmount(v: number, o: { rate: number }): AmountWarning | null {
    if (!(v > 0)) return null;
    if (v >= KHR_MIN_PLAUSIBLE && Number.isInteger(v)) return null;
    const rate = shopRate(o.rate);
    return { kind: 'khr-looks-usd', typed: v, asRielUsd: khrToUsd(v, rate), asUsd: roundCents(v), asKhr: usdToKhr(v, rate), rate };
}

// 'invalid' blocks the save (0, negative, not a number).
export function checkRate(r: number, shop: number): AmountWarning | 'invalid' | null {
    if (!(Number(r) > 0) || !Number.isFinite(Number(r))) return 'invalid';
    if (r < RATE_WARN_MIN || r > RATE_WARN_MAX) return { kind: 'rate-off', rate: r, shopRate: shopRate(shop) };
    return null;
}

type Tr = (key: string, vars?: Record<string, string>) => string;
const fill = (s: string, vars: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

// The confirm text: both readings of what was typed. `t` is an optional
// translator (i18n key, vars); the English text is the fallback.
// bookedUsd: the form books this fixed USD whatever is typed (Settle books
// the order's amount and only records the riel with it), so the last line
// says that instead of the typed figure's USD.
export function amountWarningText(w: AmountWarning, t?: Tr, bookedUsd?: number | null): string {
    const tr = (key: string, en: string, vars: Record<string, string>) => {
        const out = t ? t(key, vars) : '';
        return out && out !== key ? fill(out, vars) : fill(en, vars);
    };
    if (w.kind !== 'rate-off' && bookedUsd !== undefined && bookedUsd !== null && Number.isFinite(bookedUsd)) {
        const body = amountWarningText(w, t).split('\n');
        body.pop();
        body.push(tr('money.fixedBooksConfirm',
            'OK books {{booked}} (the amount due) and records {{typed}} with it. Cancel to fix it.',
            { booked: formatUsd(bookedUsd), typed: w.kind === 'khr-looks-usd' ? formatKhr(w.typed) : w.typed.toLocaleString('en-US') }));
        return body.join('\n');
    }
    if (w.kind === 'usd-looks-riel') {
        return tr('money.usdLooksRielConfirm',
            'You typed {{typed}} in a USD field.\n• As dollars: {{asUsd}}\n• As riel: {{asKhr}} = {{asRielUsd}} at {{rate}}\nOK books {{asUsd}}. Cancel to fix it.',
            { typed: w.typed.toLocaleString('en-US'), asUsd: formatUsd(w.asUsd), asKhr: formatKhr(w.typed), asRielUsd: formatUsd(w.asRielUsd), rate: formatRate(w.rate) });
    }
    if (w.kind === 'khr-looks-usd') {
        return tr('money.khrLooksUsdConfirm',
            'You typed {{asKhrTyped}} in a riel field.\n• As riel: {{asKhrTyped}} = {{asRielUsd}}\n• As dollars: {{asUsd}} (= {{asKhr}})\nOK books {{asRielUsd}}. Cancel to fix it.',
            { asKhrTyped: formatKhr(w.typed), asRielUsd: formatUsd(w.asRielUsd), asUsd: formatUsd(w.asUsd), asKhr: formatKhr(w.asKhr) });
    }
    return tr('money.rateOffConfirm',
        'The rate {{rate}} riel per dollar is far from the usual (shop rate {{shop}}). Use it anyway?',
        { rate: formatRate(w.rate), shop: formatRate(w.shopRate) });
}

// One-line form of the same warning, shown under the field.
export function amountWarningLine(w: AmountWarning, t?: Tr): string {
    const tr = (key: string, en: string, vars: Record<string, string>) => {
        const out = t ? t(key, vars) : '';
        return out && out !== key ? fill(out, vars) : fill(en, vars);
    };
    if (w.kind === 'usd-looks-riel') {
        return tr('money.usdLooksRiel', '{{asUsd}} looks like a riel amount ({{asKhr}} = {{asRielUsd}}).',
            { asUsd: formatUsd(w.asUsd), asKhr: formatKhr(w.typed), asRielUsd: formatUsd(w.asRielUsd) });
    }
    if (w.kind === 'khr-looks-usd') {
        return tr('money.khrLooksUsd', '{{asKhrTyped}} looks like a dollar amount ({{asUsd}} = {{asKhr}}).',
            { asKhrTyped: formatKhr(w.typed), asUsd: formatUsd(w.asUsd), asKhr: formatKhr(w.asKhr) });
    }
    return tr('money.rateOff', 'Rate {{rate}} is far from the shop rate {{shop}}.',
        { rate: formatRate(w.rate), shop: formatRate(w.shopRate) });
}

// ── Account currency ────────────────────────────────────────────────────
export const isKhrAccountName = (name?: string | null): boolean => /\bkhr\b|riel|៛/i.test(name || '');
export const accountCurrency = (a?: { account_name?: string | null } | null): Currency =>
    (isKhrAccountName(a?.account_name) ? 'KHR' : 'USD');

// ── Store has not run add_khr_currency.sql ──────────────────────────────
export const isMissingCurrencyColumnError = (e: unknown): boolean => {
    const err = e as { code?: string; message?: string; details?: string; hint?: string } | null;
    if (!err) return false;
    const msg = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`;
    const columnish = err.code === 'PGRST204' || err.code === '42703' || /column|schema cache/i.test(msg);
    return columnish && /currency|original_amount|exchange_rate/i.test(msg);
};

export const stripCurrency = <T extends Record<string, unknown>>(o: T): T => {
    const out = { ...o } as Record<string, unknown>;
    for (const k of CURRENCY_KEYS) delete out[k];
    return out as T;
};
