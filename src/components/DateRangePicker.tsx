import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMobile } from '../hooks/useMobile';

interface DateRangePickerProps {
    value: { start: string; end: string };
    onChange: (range: { start: string; end: string }) => void;
}

type Preset = 'Lifetime' | 'Today' | 'Yesterday' | 'Last 7 days' | 'Last 30 days' | 'This month' | 'Last month' | 'Custom Range';

const DateRangePicker: React.FC<DateRangePickerProps> = ({ value, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    // Internal state for the selection while open
    const [startDate, setStartDate] = useState<Date | null>(value.start ? new Date(value.start) : null);
    const [endDate, setEndDate] = useState<Date | null>(value.end ? new Date(value.end) : null);
    const [activePreset, setActivePreset] = useState<Preset>('Custom Range');
    const [viewDate, setViewDate] = useState(new Date()); // Date to control which month is shown
    const pickerRef = useRef<HTMLDivElement>(null);

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
            setStartDate(value.start ? new Date(value.start) : null);
            setEndDate(value.end ? new Date(value.end) : null);
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

    const presets: { label: Preset; getValue: () => { start: Date | null; end: Date | null } }[] = [
        { label: 'Lifetime', getValue: () => ({ start: null, end: null }) },
        {
            label: 'Today',
            getValue: () => {
                const now = new Date();
                return { start: now, end: now };
            }
        },
        {
            label: 'Yesterday',
            getValue: () => {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                return { start: d, end: d };
            }
        },
        {
            label: 'Last 7 days',
            getValue: () => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 6);
                return { start, end };
            }
        },
        {
            label: 'Last 30 days',
            getValue: () => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 29);
                return { start, end };
            }
        },
        {
            label: 'This month',
            getValue: () => {
                const now = new Date();
                const start = new Date(now.getFullYear(), now.getMonth(), 1);
                const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                return { start, end };
            }
        },
        {
            label: 'Last month',
            getValue: () => {
                const now = new Date();
                const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const end = new Date(now.getFullYear(), now.getMonth(), 0);
                return { start, end };
            }
        },
    ];

    const handlePresetClick = (preset: typeof presets[0]) => {
        setActivePreset(preset.label);
        const val = preset.getValue();
        setStartDate(val.start);
        setEndDate(val.end);
        if (val.start) setViewDate(new Date(val.start));
    };

    const handleDateClick = (date: Date) => {
        setActivePreset('Custom Range');
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
        onChange({
            start: startDate ? formatDate(startDate) : '',
            end: endDate ? formatDate(endDate) : ''
        });
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

    const isMobile = useMobile();

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
                                    background: isSelected ? '#10B981' : isInRange ? '#D1FAE5' : 'transparent',
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
            const rect = pickerRef.current.getBoundingClientRect();
            // Estimate width based on screen size (matching showTwoMonths logic)
            // Mobile (handled by CSS fixed) vs Desktop Single vs Desktop Double
            const isDouble = window.innerWidth >= 1024 && !isMobile;
            const estimatedWidth = isDouble ? 760 : 480;

            // Check if it would go off-screen to the right
            const wouldOverflow = rect.left + estimatedWidth > window.innerWidth;

            setCoords({
                top: rect.bottom + window.scrollY + 8,
                left: wouldOverflow ? (rect.right - estimatedWidth) + window.scrollX : rect.left + window.scrollX,
                width: rect.width
            });
        }
    };

    useEffect(() => {
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
                backgroundColor: '#ffffff', zIndex: 9999,
                display: 'flex', flexDirection: 'column', padding: '16px'
            } : {
                position: 'fixed',
                top: coords.top,
                left: coords.left,
                backgroundColor: '#ffffff', border: '1px solid var(--color-border)',
                borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                zIndex: 9999, display: 'flex', overflow: 'hidden',
                maxWidth: '90vw'
            }}
            onMouseDown={(e) => e.stopPropagation()}
        >

            {/* Mobile Header */}
            {isMobile && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Select Dates</h3>
                    <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}>&times;</button>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row' }}>
                {/* Sidebar / Presets */}
                <div style={{
                    width: isMobile ? '100%' : '140px',
                    borderRight: isMobile ? 'none' : '1px solid var(--color-border)',
                    padding: isMobile ? '0 0 16px 0' : '8px 0',
                    background: isMobile ? 'transparent' : '#f9fafb',
                    display: isMobile ? 'grid' : 'block',
                    gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : '1fr',
                    gap: isMobile ? '8px' : '0',
                    borderBottom: isMobile ? '1px solid var(--color-border)' : 'none',
                    marginBottom: isMobile ? '16px' : '0'
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
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', padding: '16px', flexDirection: isMobile ? 'column' : 'row', gap: '16px' }}>
                        {renderMonth(0)}
                        {!isMobile && showTwoMonths && (
                            <>
                                <div style={{ width: '1px', background: 'var(--color-border)' }}></div>
                                {renderMonth(1)}
                            </>
                        )}
                    </div>

                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
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

    return (
        <div style={{ position: 'relative' }} ref={pickerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)', color: 'var(--color-text-main)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '8px', minWidth: '40px',
                    height: '42px'
                }}
                title="Select Date Range"
            >
                <CalendarIcon size={16} />
                {value.start ? (
                    <span style={{ fontSize: '13px' }}>
                        {value.start === value.end ? value.start : `${value.start} - ${value.end}`}
                    </span>
                ) : null}
            </button>

            {isOpen && createPortal(pickerContent, document.body)}
        </div>
    );
};

export default DateRangePicker;
