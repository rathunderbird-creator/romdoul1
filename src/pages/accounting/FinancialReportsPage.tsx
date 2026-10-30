// Standalone Financial Reports page under Accounting, with its own From /
// As-at pickers (year-to-date by default). The sidebar's Balance Sheet,
// Income Statement and Cash In / Out entries open this page on that statement.
import React, { useState, useEffect } from 'react';
import { useHeader } from '../../context/HeaderContext';
import { useMobile } from '../../hooks/useMobile';
import DateRangePicker from '../../components/DateRangePicker';
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
    const [range, setRange] = useState<{ start: string; end: string }>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('financial_reports_range') || 'null');
            if (saved && saved.start && saved.end) return saved;
        } catch { /* corrupted value — fall through to the default */ }
        return { start: `${new Date().getFullYear()}-01-01`, end: todayYmd() };
    });

    useEffect(() => {
        localStorage.setItem('financial_reports_range', JSON.stringify(range));
    }, [range]);

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
            <div className="acct-page" style={{ flex: isMobile ? undefined : '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <DateRangePicker value={range} onChange={setRange} />
                </div>
                <FinancialStatements startDate={range.start} endDate={range.end} initialTab={initialTab} />
            </div>

            {/* Reserved for future widgets — intentionally empty, and left
                out entirely on mobile since there's nothing in it to show. */}
            {!isMobile && (
                <>
                    <div style={{ display: 'none' }} />
                    <div style={{ display: 'none' }} />
                </>
            )}
        </div>
    );
};

export default FinancialReportsPage;
