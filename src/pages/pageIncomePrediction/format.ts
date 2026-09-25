// Display formatting shared by the Prediction by Page AND Prediction by
// Product components (../../productIncomePrediction/*).
import type { Language } from './types';
import { parseDay, wholeMonthOf, type DateRange } from '../../utils/dateRange';

export const fmtMoney = (n: number): string => {
    const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < -0.005 ? `-$${abs}` : `$${abs}`;
};

export const fmtPct = (ratio: number | null): string =>
    ratio === null || !Number.isFinite(ratio) ? '—' : `${(ratio * 100).toFixed(1)}%`;

// "3.2×" — revenue per boost dollar.
export const fmtRatio = (ratio: number | null): string =>
    ratio === null || !Number.isFinite(ratio) ? '—' : `${ratio.toFixed(1)}×`;

const localeOf = (language: Language): string => (language === 'km' ? 'km-KH' : 'en-US');

// "September 2026" / "កញ្ញា 2026"
export const monthLabel = (month: string, language: Language): string => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(localeOf(language), { month: 'long', year: 'numeric' });
};

// "September 2026" for a whole calendar month (the default view, unchanged);
// otherwise "5 Sep – 15 Sep 2026", or with both years when the range crosses one.
// A single-day range is just that date.
export const rangeLabel = (range: DateRange, language: Language): string => {
    const whole = wholeMonthOf(range);
    if (whole) return monthLabel(whole, language);
    const locale = localeOf(language);
    const from = parseDay(range.from);
    const to = parseDay(range.to);
    const withYear: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
    if (range.from === range.to) return to.toLocaleDateString(locale, withYear);
    const start = from.toLocaleDateString(locale, from.getFullYear() === to.getFullYear() ? { day: 'numeric', month: 'short' } : withYear);
    return `${start} – ${to.toLocaleDateString(locale, withYear)}`;
};

// "Sep" / "កញ្ញា" — the month tag shown on a ledger row when the range spans months.
export const monthShortLabel = (dayKey: string, language: Language): string =>
    parseDay(dayKey).toLocaleDateString(localeOf(language), { month: 'short' });

// "Mon" / "ច"
export const weekdayShort = (dow: number, language: Language): string =>
    // 2026-03-01 is a Sunday, so day (1 + dow) of that month has weekday `dow`.
    new Date(2026, 2, 1 + dow).toLocaleDateString(localeOf(language), { weekday: 'short' });

// Simple "{n}"-style interpolation on top of the app's plain t(key).
export const fill = (template: string, values: Record<string, string | number>): string =>
    Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), template);
