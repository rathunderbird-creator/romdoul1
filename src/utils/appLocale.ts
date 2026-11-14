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

// "Sep 2026" / "កញ្ញា 2026" (a calendar's month heading).
export const formatAppMonth = (d: Date, language?: string | null): string =>
    isKhmer(language) ? `${KM_MONTHS[d.getMonth()]} ${d.getFullYear()}` : d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
