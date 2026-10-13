// Standalone Financial Reports page under Accounting, with its own From /
// As-at pickers (year-to-date by default). The sidebar's Balance Sheet,
// Income Statement and Cash In / Out entries open this page on that statement.
import React, { useState, useEffect } from 'react';
import { useHeader } from '../../context/HeaderContext';
import FinancialStatements, { type TabKey } from './FinancialStatements';

const displayDate = (ymd: string): string => {
    if (!ymd) return '—';
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y}`;
};

const todayYmd = (): string => {
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const FinancialReportsPage: React.FC<{ initialTab?: TabKey }> = ({ initialTab }) => {
    const { setHeaderContent } = useHeader();
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
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>As at {displayDate(range.end)}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, range.end]);

    const dateInput: React.CSSProperties = {
        padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
        background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '13px', outline: 'none',
    };
    const dateLabel: React.CSSProperties = {
        display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px',
    };

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                    <label style={dateLabel}>From</label>
                    <input type="date" value={range.start} max={range.end} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} style={dateInput} />
                </div>
                <div>
                    <label style={dateLabel}>As at</label>
                    <input type="date" value={range.end} min={range.start} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} style={dateInput} />
                </div>
            </div>
            <FinancialStatements startDate={range.start} endDate={range.end} initialTab={initialTab} />
        </div>
    );
};

export default FinancialReportsPage;
