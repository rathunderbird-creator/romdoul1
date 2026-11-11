// Standalone Financial Reports page under Accounting, with its own From /
// As-at pickers (year-to-date by default). The sidebar's Balance Sheet,
// Income Statement and Cash In / Out entries open this page on that statement.
import React, { useState, useEffect } from 'react';
import { useHeader } from '../../context/HeaderContext';
import { useMobile } from '../../hooks/useMobile';
import DateRangePicker from '../../components/DateRangePicker';
import { resolveRangePreset, type RangePreset } from '../../utils/dateRangePresets';
import FinancialStatements, { type TabKey } from './FinancialStatements';

const displayDate = (ymd: string): string => {
    if (!ymd) return '—';
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y}`;
};

// Local calendar day as YYYY-MM-DD — timezone-safe (uses local date parts,
// not a UTC-shifted 24h), so it can't land on the wrong date.
const todayYmd = (): string => {
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const FinancialReportsPage: React.FC<{ initialTab?: TabKey }> = ({ initialTab }) => {
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();
    // Rule (FIN-4): the default year-to-date range is computed FRESH on every
    // visit — only a range the user deliberately picked is persisted and
    // restored. A quick-pick preset ('Today', 'This month', …) is stored by
    // NAME and re-resolved on every load, so its meaning stays current; only
    // a hand-picked calendar range is stored as literal dates (`custom:
    // true`). The old code wrote the first visit's default into localStorage
    // immediately, so the "as at" date froze on that day forever and later
    // entries vanished from the statements. Old flagless saved values (that
    // frozen default) are deliberately ignored, which also heals
    // already-affected browsers. A deliberate 'Lifetime' pick ({start:'',
    // end:''}) now persists too — it used to fail the truthiness check and
    // revert to YTD on reload.
    const [range, setRangeState] = useState<{ start: string; end: string }>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('financial_reports_range') || 'null');
            if (saved && typeof saved.preset === 'string') {
                const resolved = resolveRangePreset(saved.preset);
                if (resolved) return resolved;
            }
            if (saved && saved.custom === true && typeof saved.start === 'string' && typeof saved.end === 'string') {
                return { start: saved.start, end: saved.end };
            }
        } catch { /* corrupted value — fall through to the default */ }
        return { start: `${new Date().getFullYear()}-01-01`, end: todayYmd() };
    });

    const setRange = (r: { start: string; end: string }, preset?: RangePreset) => {
        setRangeState(r);
        try {
            localStorage.setItem('financial_reports_range',
                JSON.stringify(preset ? { preset } : { ...r, custom: true }));
        } catch { /* storage unavailable — the picker still works for this visit */ }
    };

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Financial Reports</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>As at {displayDate(range.end || todayYmd())}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, range.end]);

    return (
        <div style={isMobile ? { display: 'flex', flexDirection: 'column', gap: '20px' } : { display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
            <div className="acct-page" style={{ flex: isMobile ? undefined : '18 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <DateRangePicker value={range} onChange={setRange} />
                </div>
                <FinancialStatements startDate={range.start} endDate={range.end} initialTab={initialTab} />
            </div>

            {/* Reserved for future widgets — intentionally empty, and left
                out entirely on mobile since there's nothing in it to show. */}
            {!isMobile && (
                <>
                    <div style={{ flex: '1 1 0' }} />
                    <div style={{ flex: '1 1 0' }} />
                </>
            )}
        </div>
    );
};

export default FinancialReportsPage;
