import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import DateRangePicker from '../../../components/DateRangePicker';
import { sanitizeRange, shiftRange, type DateRange } from '../../../utils/dateRange';

// The date filter shared by all four Income Prediction screens (classic, by
// Page, by Product, by Staff): previous / range picker / next. Replaces the old
// month picker. The range defaults to the current calendar month, and while it
// is exactly a whole month the arrows still step month by month, so the screens
// behave as before until someone picks other dates.
//
// The app's DateRangePicker only calls back on "Apply" and can hand back open
// ends ("Lifetime" = two empty strings). Everything it returns goes through
// sanitizeRange so the screens only ever see a bounded, ordered range of at
// most MAX_RANGE_DAYS; when that meant trimming it, a small note says so.
export interface DateRangeControlProps {
    range: DateRange;
    now: Date;
    onChange: (range: DateRange) => void;
    labels: { prev: string; next: string; tooLong: string };
    compact?: boolean;       // icon-only picker (mobile)
    disabled?: boolean;
}

const DateRangeControl: React.FC<DateRangeControlProps> = ({ range, now, onChange, labels, compact, disabled }) => {
    // The note belongs to ONE range: the one a picker choice was trimmed to. It is
    // keyed on that range (not a plain boolean) so it disappears the moment the
    // range changes any other way — the arrows, or browser Back/Forward changing
    // the URL under this still-mounted control.
    const [clampedFor, setClampedFor] = useState<string | null>(null);
    const showNote = clampedFor === `${range.from}|${range.to}`;

    const apply = (next: DateRange) => onChange(next);

    return (
        // Wraps so the note can drop to its own line instead of pushing the toolbar
        // past a phone's width.
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
            <button type="button" className="pip-icon-button" disabled={disabled} onClick={() => apply(shiftRange(range, -1))} title={labels.prev} aria-label={labels.prev}>
                <ChevronLeft size={18} />
            </button>
            <div className="pip-range-picker" style={{ minWidth: compact ? 42 : 210 }}>
                <DateRangePicker
                    value={{ start: range.from, end: range.to }}
                    compact={compact}
                    onChange={picked => {
                        const { range: next, clamped } = sanitizeRange(picked.start, picked.end, now);
                        setClampedFor(clamped ? `${next.from}|${next.to}` : null);
                        onChange(next);
                    }}
                />
            </div>
            <button type="button" className="pip-icon-button" disabled={disabled} onClick={() => apply(shiftRange(range, 1))} title={labels.next} aria-label={labels.next}>
                <ChevronRight size={18} />
            </button>
            {showNote && (
                <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999, background: 'rgba(245,158,11,0.12)', color: '#B45309', whiteSpace: 'nowrap' }}>
                    <Info size={12} aria-hidden /> {labels.tooLong}
                </span>
            )}
        </div>
    );
};

export default DateRangeControl;
