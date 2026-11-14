// Dates in the app's language (Settings / the language switch, stored as
// pos_language). Khmer dates use Khmer month names with ordinary digits
// ("1 កញ្ញា 2026"), so dates read the same way as the amounts beside them.
// The month names are written here rather than taken from the browser:
// some browsers ship without Khmer locale data and would fall back to English.
export type AppLanguage = 'en' | 'km';

const KM_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];

const storedLanguage = (): string | null => {
    try { return localStorage.getItem('pos_language'); } catch { return null; }
};

const isKhmer = (language?: string | null) => (language ?? storedLanguage()) === 'km';

// "Sep 1, 2026" / "1 កញ្ញា 2026" (withYear), "Sep 1" / "1 កញ្ញា".
export const formatAppDate = (d: Date, opts: { year?: boolean } = {}, language?: string | null): string => {
    if (isNaN(d.getTime())) return '';
    if (isKhmer(language)) return `${d.getDate()} ${KM_MONTHS[d.getMonth()]}${opts.year ? ` ${d.getFullYear()}` : ''}`;
    return d.toLocaleDateString('en-US', opts.year ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
};

// English month names in an already-formatted date -> Khmer.
const EN_MONTH = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b\.?/g;
const MONTH_INDEX: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export const khmerMonthNames = (s: string): string =>
    s.replace(EN_MONTH, m => KM_MONTHS[MONTH_INDEX[m.slice(0, 3).toLowerCase()]] ?? m);

// Dates written with month names anywhere in the app (toLocaleDateString /
// toLocaleString with month: 'short' | 'long') come out in Khmer while the
// app is in Khmer, without changing each of the ~25 places that format one.
// Only text with a month NAME is touched: numeric dates (Excel/CSV exports,
// 14/11/2026) are unchanged, and nothing changes in English.
let monthPatchInstalled = false;
export function installKhmerMonthNames() {
    if (monthPatchInstalled || typeof Date === 'undefined') return;
    monthPatchInstalled = true;
    const wantsMonthName = (opts: unknown) => {
        const m = (opts as Intl.DateTimeFormatOptions | undefined)?.month;
        return m === 'short' || m === 'long' || m === 'narrow';
    };
    // AM/PM in a time: ព្រឹក (morning) / ល្ងាច (afternoon/evening).
    const khmerAmPm = (s: string) => s.replace(/\bAM\b/g, 'ព្រឹក').replace(/\bPM\b/g, 'ល្ងាច');
    const wrap = (name: 'toLocaleDateString' | 'toLocaleString' | 'toLocaleTimeString') => {
        const original = Date.prototype[name];
        Date.prototype[name] = function (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
            let out = original.call(this, locales, options);
            if (!isKhmer()) return out;
            if (name !== 'toLocaleTimeString' && wantsMonthName(options)) out = khmerMonthNames(out);
            if ((name === 'toLocaleTimeString' || options?.hour) && /\b[AP]M\b/.test(out)) out = khmerAmPm(out);
            return out;
        } as typeof original;
    };
    wrap('toLocaleDateString');
    wrap('toLocaleString');
    wrap('toLocaleTimeString');
}

// "Sep 2026" / "កញ្ញា 2026" (a calendar's month heading).
export const formatAppMonth = (d: Date, language?: string | null): string =>
    isKhmer(language) ? `${KM_MONTHS[d.getMonth()]} ${d.getFullYear()}` : d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
