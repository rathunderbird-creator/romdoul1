// The DateRangePicker's quick-pick presets, resolvable OUTSIDE the component
// too. Rule (FIN-4): a preset means "this month"/"today" SEMANTICALLY — a
// screen that persists a preset pick must store the preset's NAME and
// re-resolve it here on every load, never freeze the literal dates the preset
// happened to resolve to on the day it was clicked.

export type RangePreset = 'Lifetime' | 'Today' | 'Yesterday' | 'Last 7 days' | 'This week' | 'Last week' | 'Last 30 days' | 'This month' | 'Last month';

export const RANGE_PRESETS: RangePreset[] = ['Lifetime', 'Today', 'Yesterday', 'Last 7 days', 'This week', 'Last week', 'Last 30 days', 'This month', 'Last month'];

const ymd = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const startOfToday = (): Date => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};

/**
 * Resolve a preset to the concrete range it means TODAY ('' = open-ended, for
 * Lifetime). null for an unknown name (e.g. a stale persisted value). Shared
 * by the picker's quick-pick buttons and by callers re-resolving a persisted
 * preset on load (FIN-4).
 */
export const resolveRangePreset = (preset: string): { start: string; end: string } | null => {
    const today = startOfToday();
    switch (preset as RangePreset) {
        case 'Lifetime':
            return { start: '', end: '' };
        case 'Today':
            return { start: ymd(today), end: ymd(today) };
        case 'Yesterday': {
            const d = startOfToday();
            d.setDate(d.getDate() - 1);
            return { start: ymd(d), end: ymd(d) };
        }
        case 'Last 7 days': {
            const start = startOfToday();
            start.setDate(start.getDate() - 6);
            return { start: ymd(start), end: ymd(today) };
        }
        case 'This week': {
            const start = startOfToday();
            const day = start.getDay();
            start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            return { start: ymd(start), end: ymd(end) };
        }
        case 'Last week': {
            const start = startOfToday();
            const day = start.getDay();
            start.setDate(start.getDate() - day + (day === 0 ? -6 : 1) - 7);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            return { start: ymd(start), end: ymd(end) };
        }
        case 'Last 30 days': {
            const start = startOfToday();
            start.setDate(start.getDate() - 29);
            return { start: ymd(start), end: ymd(today) };
        }
        case 'This month': {
            const start = new Date(today.getFullYear(), today.getMonth(), 1);
            const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            return { start: ymd(start), end: ymd(end) };
        }
        case 'Last month': {
            const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const end = new Date(today.getFullYear(), today.getMonth(), 0);
            return { start: ymd(start), end: ymd(end) };
        }
        default:
            return null;
    }
};
