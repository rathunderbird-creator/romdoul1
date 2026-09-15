// Display formatting shared by the Prediction by Page AND Prediction by
// Product components (../../productIncomePrediction/*).
import type { Language } from './types';

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

// "Mon" / "ច"
export const weekdayShort = (dow: number, language: Language): string =>
    // 2026-03-01 is a Sunday, so day (1 + dow) of that month has weekday `dow`.
    new Date(2026, 2, 1 + dow).toLocaleDateString(localeOf(language), { weekday: 'short' });

// Simple "{n}"-style interpolation on top of the app's plain t(key).
export const fill = (template: string, values: Record<string, string | number>): string =>
    Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), template);
