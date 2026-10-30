import { useEffect, useState } from 'react';

export interface DateRange { start: string; end: string }

// A {start, end} date-range filter that survives navigation and reloads,
// kept per page key in localStorage — the same pattern Financial Reports
// uses for financial_reports_range.
export function usePersistedDateRange(storageKey: string, initial: DateRange = { start: '', end: '' }) {
    const [range, setRange] = useState<DateRange>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (saved && typeof saved.start === 'string' && typeof saved.end === 'string') return saved;
        } catch { /* corrupted value — fall through to the default */ }
        return initial;
    });

    useEffect(() => {
        try { localStorage.setItem(storageKey, JSON.stringify(range)); } catch { /* storage unavailable */ }
    }, [storageKey, range]);

    return [range, setRange] as const;
}
