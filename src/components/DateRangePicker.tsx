import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMobile } from '../hooks/useMobile';
import { RANGE_PRESETS, resolveRangePreset, type RangePreset } from '../utils/dateRangePresets';
import { bodyZoom } from '../utils/bodyZoom';

interface DateRangePickerProps {
    value: { start: string; end: string };
    /**
     * `preset` names the quick-pick the user applied (absent for a hand-picked
     * range). Rule (FIN-4): a preset means "this month"/"today" SEMANTICALLY —
     * a caller that persists the pick should store the preset name and
     * re-resolve it with resolveRangePreset() on load, not freeze the literal
     * dates the preset happened to resolve to that day.
     */
    onChange: (range: { start: string; end: string }, preset?: RangePreset) => void;
    className?: string;
    style?: React.CSSProperties;
    // Trigger button height (default 42px) — to line up with a filter bar's other controls.
    height?: number;
    compact?: boolean;
}

type Preset = RangePreset | 'Custom Range';

const DateRangePicker: React.FC<DateRangePickerProps> = ({ value, onChange, className, style, compact = false, height = 42 }) => {
    const [isOpen, setIsOpen] = useState(false);

    // Helper to parse "YYYY-MM-DD" as local midnight date
    const parseLocalDate = (dateStr: string) => {
        if (!dateStr) return null;
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
    };

    // Internal state for the selection while open
    const [startDate, setStartDate] = useState<Date | null>(parseLocalDate(value.start));
    const [endDate, setEndDate] = useState<Date | null>(parseLocalDate(value.end));
    const [activePreset, setActivePreset] = useState<Preset>('Custom Range');
    const [viewDate, setViewDate] = useState(new Date()); // Date to control which month is shown
    const pickerRef = useRef<HTMLDivElement>(null);
    const isMobile = useMobile();

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Reset internal state when value changes externally (or when opening)
    useEffect(() => {
        if (isOpen) {
            setStartDate(parseLocalDate(value.start));
            setEndDate(parseLocalDate(value.end));
            // Try to infer preset (simple inference)
            if (!value.start && !value.end) setActivePreset('Lifetime');
            else setActivePreset('Custom Range');
        }
    }, [isOpen]);

    const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Each quick-pick resolves through the shared, exported resolveRangePreset
    // so a persisted preset re-resolves to the same dates on load (FIN-4).
    const presets: { label: RangePreset; getValue: () => { start: Date | null; end: Date | null } }[] =
        RANGE_PRESETS
            .map(label => ({
                label,
                getValue: () => {
                    const r = resolveRangePreset(label) || { start: '', end: '' };
                    return { start: parseLocalDate(r.start), end: parseLocalDate(r.end) };
                },
            }));

    const handlePresetClick = (preset: typeof presets[0]) => {
        setActivePreset(preset.label);
        const val = preset.getValue();
        setStartDate(val.start);
        setEndDate(val.end);
        if (val.start) setViewDate(new Date(val.start));
    };

    const handleDateClick = (date: Date) => {
        setActivePreset('Custom Range');
        if (!isMobile) {
            // Desktop: one click selects that day as BOTH start and end, so a
            // single-day range is one click. Clicking a second, different day
            // extends the range — the new day becomes the end date (swapped if
            // it lies before the start). Any click after that starts over.
            if (startDate && endDate && startDate.getTime() === endDate.getTime() && date.getTime() !== startDate.getTime()) {
                if (date < startDate) {
                    setEndDate(startDate);
                    setStartDate(date);
                } else {
                    setEndDate(date);
                }
            } else {
                setStartDate(date);
                setEndDate(date);
            }
            return;
        }
        // Mobile keeps the original two-tap flow (tap start, tap end).
        if (!startDate || (startDate && endDate)) {
            // Start new selection
            setStartDate(date);
            setEndDate(null);
        } else {
            // Complete selection
            if (date < startDate) {
                setEndDate(startDate);
                setStartDate(date);
            } else {
                setEndDate(date);
            }
        }
    };

    const handleApply = () => {
        onChange(
            {
                start: startDate ? formatDate(startDate) : '',
                end: endDate ? formatDate(endDate) : ''
            },
            // Clicking any calendar day resets activePreset to 'Custom Range',
            // so a preset is only reported when the applied range really IS
            // that preset's (FIN-4: preset picks carry their semantics).
            activePreset !== 'Custom Range' ? activePreset : undefined
        );
        setIsOpen(false);
    };

    const getDaysInMonth = (year: number, month: number) => {
        const date = new Date(year, month, 1);
        const days = [];
        while (date.getMonth() === month) {
            days.push(new Date(date));
            date.setDate(date.getDate() + 1);
        }
        return days;
    };

    const renderMonth = (offset: number) => {
        const year = viewDate.getFullYear();
        const month = viewDate.getMonth() + offset;
        const currentMonthDate = new Date(year, month, 1); // Normalize

        const days = getDaysInMonth(currentMonthDate.getFullYear(), currentMonthDate.getMonth());
        const firstDayOfWeek = days[0].getDay(); // 0 = Sun
        const blanks = Array(firstDayOfWeek).fill(null);

        return (
            <div style={{ width: isMobile ? '100%' : '280px', padding: '0 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <button onClick={() => setViewDate(new Date(year, month - 1, 1))} className="icon-button">
                        <ChevronLeft size={16} />
                    </button>
                    <span style={{ fontWeight: 600 }}>
                        {currentMonthDate.toLocaleString('default', { month: 'short', year: 'numeric' })}
                    </span>
                    <button onClick={() => setViewDate(new Date(year, month + 1, 1))} className="icon-button">
                        <ChevronRight size={16} />
                    </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', fontSize: '12px', textAlign: 'center', marginBottom: '4px', color: 'var(--color-text-secondary)' }}>
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d}>{d}</div>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                    {blanks.map((_, i) => <div key={`blank-${i}`} />)}
                    {days.map(d => {
                        const isSelected = (startDate && d.getTime() === startDate.getTime()) || (endDate && d.getTime() === endDate.getTime());
                        const isInRange = startDate && endDate && d > startDate && d < endDate;
                        const isToday = new Date().toDateString() === d.toDateString();

                        return (
                            <button
                                key={d.toISOString()}
                                onClick={() => handleDateClick(d)}
                                style={{
                                    width: '100%', aspectRatio: '1', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                    background: isSelected ? '#10B981' : isInRange ? 'var(--range-tint)' : 'transparent',
                                    color: isSelected ? 'white' : 'var(--color-text-main)',
                                    fontWeight: isToday ? 600 : 400,
                                }}
                            >
                                {d.getDate()}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    const [showTwoMonths, setShowTwoMonths] = useState(false);

    useEffect(() => {
        const checkWidth = () => {
            setShowTwoMonths(window.innerWidth >= 1024);
        };
        checkWidth();
        window.addEventListener('resize', checkWidth);
        return () => window.removeEventListener('resize', checkWidth);
    }, []);

    const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

    const updatePosition = () => {
        if (pickerRef.current) {
            // Screen px -> the zoomed body's px (see utils/bodyZoom.ts).
            const z = bodyZoom();
            const raw = pickerRef.current.getBoundingClientRect();
            const rect = { left: raw.left / z, right: raw.right / z, bottom: raw.bottom / z, width: raw.width / z };
            const viewW = window.innerWidth / z;
            // Estimate width based on screen size (matching showTwoMonths logic)
            // Mobile (handled by CSS fixed) vs Desktop Single vs Desktop Double
            const isDouble = window.innerWidth >= 1024 && !isMobile;
            const estimatedWidth = isDouble ? 760 : 480;

            // Check if it would go off-screen to the right
            const wouldOverflow = rect.left + estimatedWidth > viewW;
            // The desktop popup is position: fixed — viewport coordinates, no scroll offset.
            const left = wouldOverflow ? rect.right - estimatedWidth : rect.left;

            setCoords({
                top: rect.bottom + 8,
                left: Math.max(8, left),
                width: rect.width
            });
        }
    };

    // Layout effect: positioned before the first paint, so no flash at (0,0).
    useLayoutEffect(() => {
        if (isOpen) {
            updatePosition();
            window.addEventListener('resize', updatePosition);
            window.addEventListener('scroll', updatePosition, true);
        }
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen]);

    const pickerContent = (
        <div
            style={isMobile ? {
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'var(--color-surface)', zIndex: 9999,
                display: 'flex', flexDirection: 'column', padding: '16px',
                overflowY: 'auto'
            } : {
                position: 'fixed',
                top: coords.top,
                left: coords.left,
                backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                zIndex: 9999, display: 'flex', overflow: 'hidden',
                maxWidth: '90vw'
            }}
            onMouseDown={(e) => e.stopPropagation()}
        >

            {/* Mobile Header */}
            {isMobile && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexShrink: 0 }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Select Dates</h3>
                    <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}>&times;</button>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flex: isMobile ? '1 0 auto' : 'auto' }}>
                {/* Sidebar / Presets */}
                <div style={{
                    width: isMobile ? '100%' : '140px',
                    borderRight: isMobile ? 'none' : '1px solid var(--color-border)',
                    padding: isMobile ? '0 0 16px 0' : '8px 0',
                    background: isMobile ? 'transparent' : 'var(--color-bg)',
                    display: isMobile ? 'grid' : 'block',
                    gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : '1fr',
                    gap: isMobile ? '8px' : '0',
                    borderBottom: isMobile ? '1px solid var(--color-border)' : 'none',
                    marginBottom: isMobile ? '16px' : '0',
                    flexShrink: 0
                }}>
                    {presets.map(preset => (
                        <button
                            key={preset.label}
                            onClick={() => handlePresetClick(preset)}
                            style={{
                                display: 'block', width: '100%', textAlign: isMobile ? 'center' : 'left',
                                padding: isMobile ? '8px' : '8px 16px',
                                border: isMobile ? '1px solid var(--color-border)' : 'none',
                                borderRadius: isMobile ? '8px' : '0',
                                background: activePreset === preset.label ? '#10B981' : 'transparent',
                                color: activePreset === preset.label ? 'white' : 'var(--color-text-main)',
                                cursor: 'pointer', fontSize: '12px'
                            }}
                        >
                            {preset.label}
                        </button>
                    ))}
                    <button
                        onClick={() => setActivePreset('Custom Range')}
                        style={{
                            display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px',
                            border: 'none', background: activePreset === 'Custom Range' ? '#10B981' : 'transparent',
                            color: activePreset === 'Custom Range' ? 'white' : 'var(--color-text-main)',
                            cursor: 'pointer', fontSize: '12px'
                        }}
                    >
                        Custom Range
                    </button>
                </div>

                {/* Main Content */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', padding: '16px', flexDirection: isMobile ? 'column' : 'row', gap: '16px', flex: 1 }}>
                        {renderMonth(0)}
                        {!isMobile && showTwoMonths && (
                            <>
                                <div style={{ width: '1px', background: 'var(--color-border)' }}></div>
                                {renderMonth(1)}
                            </>
                        )}
                    </div>

                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', flexShrink: 0 }}>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                            {startDate ? startDate.toLocaleDateString() : 'Start'} - {endDate ? endDate.toLocaleDateString() : 'End'}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={() => setIsOpen(false)}
                                style={{
                                    padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--color-border)',
                                    background: 'transparent', cursor: 'pointer', fontSize: '13px'
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleApply}
                                style={{
                                    padding: '8px 24px', borderRadius: '6px', border: 'none',
                                    background: '#10B981', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 500
                                }}
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const getFormattedDate = (dateStr: string) => {
        const date = parseLocalDate(dateStr);
        if (!date) return '';
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const isActive = Boolean(value.start || value.end);

    return (
        <div style={{ position: 'relative', ...style }} className={className} ref={pickerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '8px 12px', borderRadius: '8px',
                    border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                    background: isOpen ? 'var(--color-primary)' : (isActive ? 'var(--color-primary-light)' : 'var(--color-surface)'),
                    color: isOpen ? 'white' : (isActive ? 'var(--color-primary)' : 'var(--color-text-main)'),
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '8px', minWidth: `${height}px`,
                    height: `${height}px`, boxSizing: 'border-box',
                    width: '100%',
                    justifyContent: 'center'
                }}
                title="Select Date Range"
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CalendarIcon size={18} />
                    {!compact && value.start && (
                        <span style={{ fontSize: '13px' }}>
                            {getFormattedDate(value.start)}
                            {value.start !== value.end && ` - ${getFormattedDate(value.end)}`}
                        </span>
                    )}
                </div>
            </button>

            {isOpen && createPortal(pickerContent, document.body)}
        </div>
    );
};

export default DateRangePicker;
