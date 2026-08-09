import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Calendar, DollarSign, TrendingUp, TrendingDown, Package, Truck, Megaphone, Users, RefreshCw, ChevronLeft, ChevronRight, Check, Loader2, Save, RotateCcw, BarChart3 } from 'lucide-react';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { supabase } from '../lib/supabase';
import { useStore } from '../context/StoreContext';

// Formats YYYY-MM
const getLocalYYYYMM = (date: Date = new Date()) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface DailyPrediction {
    date: string;
    dayOfWeek: string;
    dayNum: number;
    shippedDelivered: number;
    orderCount: number;
    cogs: number;
    shipping: number;
    boostPage: number;
    staff: number;
    profit: number;
    isSaved: boolean;
    isToday: boolean;
    isFuture: boolean;
    isWeekend: boolean;
}

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Skeleton loader row
const SkeletonRow = () => (
    <tr>
        {Array.from({ length: 8 }).map((_, i) => (
            <td key={i} style={{ padding: '10px 12px' }}>
                <div style={{
                    height: '14px',
                    borderRadius: '4px',
                    background: 'linear-gradient(90deg, var(--color-border) 25%, rgba(255,255,255,0.1) 50%, var(--color-border) 75%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s infinite',
                    width: i === 0 ? '80px' : '60px',
                    marginLeft: i > 0 ? 'auto' : undefined
                }} />
            </td>
        ))}
    </tr>
);

const DEFAULT_COL_WIDTHS = [110, 70, 130, 110, 130, 120, 110, 130, 80];

const IncomePrediction: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();
    const { products, currentUser, shippingRates } = useStore();

    const [selectedMonth, setSelectedMonth] = useState(getLocalYYYYMM());
    const [isLoading, setIsLoading] = useState(false);
    const [dailyData, setDailyData] = useState<DailyPrediction[]>([]);
    const [draftValues, setDraftValues] = useState<Record<string, string>>({});
    const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
    const [savedCells, setSavedCells] = useState<Set<string>>(new Set());
    const todayRef = useRef<HTMLTableRowElement>(null);

    // Column resize state
    const [colWidths, setColWidths] = useState<number[]>(() => {
        try {
            const saved = localStorage.getItem('prediction-col-widths');
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        return [...DEFAULT_COL_WIDTHS];
    });
    const resizingRef = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);

    const handleResizeStart = useCallback((e: React.MouseEvent, colIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        resizingRef.current = { colIndex, startX: e.clientX, startWidth: colWidths[colIndex] };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (ev: MouseEvent) => {
            if (!resizingRef.current) return;
            const delta = ev.clientX - resizingRef.current.startX;
            const newWidth = Math.max(60, resizingRef.current.startWidth + delta);
            setColWidths(prev => {
                const next = [...prev];
                next[resizingRef.current!.colIndex] = newWidth;
                return next;
            });
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            resizingRef.current = null;
            setColWidths(prev => {
                localStorage.setItem('prediction-col-widths', JSON.stringify(prev));
                return prev;
            });
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [colWidths]);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Income Prediction</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Daily Profit Forecast & Manual Expenses</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const productCostMap = useMemo(() => {
        const map = new Map<string, number>();
        products.forEach(p => map.set(p.id, p.purchaseCost || 0));
        return map;
    }, [products]);

    // Parse selected month
    const { year, monthIdx, monthName } = useMemo(() => {
        const [y, m] = selectedMonth.split('-');
        return { year: parseInt(y), monthIdx: parseInt(m) - 1, monthName: MONTH_NAMES[parseInt(m) - 1] };
    }, [selectedMonth]);

    const navigateMonth = (delta: number) => {
        const d = new Date(year, monthIdx + delta, 1);
        setSelectedMonth(getLocalYYYYMM(d));
    };

    const fetchData = useCallback(async () => {
        if (!selectedMonth) return;
        setIsLoading(true);
        try {
            const endDate = new Date(year, monthIdx + 1, 0);
            const startStr = `${selectedMonth}-01T00:00:00.000Z`;
            const endStr = `${selectedMonth}-${String(endDate.getDate()).padStart(2, '0')}T23:59:59.999Z`;

            const [salesRes, predictionsRes] = await Promise.all([
                supabase.from('sales')
                    .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                    .gte('date', startStr).lte('date', endStr),
                supabase.from('income_predictions')
                    .select('*')
                    .gte('date', startStr).lte('date', endStr)
            ]);

            if (salesRes.error) throw salesRes.error;
            if (predictionsRes.error) throw predictionsRes.error;

            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const daysInMonth = endDate.getDate();
            const dailyMap = new Map<string, DailyPrediction>();

            for (let i = 1; i <= daysInMonth; i++) {
                const dateStr = `${selectedMonth}-${String(i).padStart(2, '0')}`;
                const dayDate = new Date(year, monthIdx, i);
                const dow = dayDate.getDay();
                dailyMap.set(dateStr, {
                    date: dateStr,
                    dayOfWeek: DAY_NAMES_SHORT[dow],
                    dayNum: i,
                    shippedDelivered: 0,
                    orderCount: 0,
                    cogs: 0,
                    shipping: 0,
                    boostPage: 0,
                    staff: 0,
                    profit: 0,
                    isSaved: false,
                    isToday: dateStr === todayStr,
                    isFuture: dateStr > todayStr,
                    isWeekend: dow === 0 || dow === 6
                });
            }

            // 1. Apply saved predictions first
            (predictionsRes.data || []).forEach((row: any) => {
                const dateStr = row.date;
                if (!dailyMap.has(dateStr)) return;
                const day = dailyMap.get(dateStr)!;
                day.isSaved = true;
                day.shippedDelivered = Number(row.shipped_delivered) || 0;
                day.orderCount = Number(row.order_count) || 0;
                day.cogs = Number(row.cogs) || 0;
                day.shipping = Number(row.shipping) || 0;
                day.boostPage = Number(row.boost_page) || 0;
                day.staff = Number(row.staff) || 0;
            });

            // 2. Auto-calculate from live sales ONLY for unsaved days
            (salesRes.data || []).forEach((sale: any) => {
                const saleDate = sale.date ? sale.date.substring(0, 10) : null;
                if (!saleDate || !dailyMap.has(saleDate)) return;
                const day = dailyMap.get(saleDate)!;
                if (day.isSaved) return; // Freeze auto-calc if saved

                const status = sale.shipping_status || 'Pending';
                if (status !== 'Shipped' && status !== 'Delivered') return;
                
                day.shippedDelivered += (sale.total || 0);
                day.orderCount += 1;
                (sale.items || []).forEach((item: any) => {
                    const cost = productCostMap.get(item.product_id) || 0;
                    day.cogs += (cost * (item.quantity || 1));
                });
                
                const coName = sale.shipping_company || 'Unassigned';
                const shippingFee = shippingRates[coName] || 0;
                day.shipping += shippingFee;
            });

            const results = Array.from(dailyMap.values()).map(day => {
                day.profit = day.shippedDelivered - day.cogs - day.shipping - day.boostPage - day.staff;
                return day;
            });

            setDailyData(results);
            const newDrafts: Record<string, string> = {};
            results.forEach(day => {
                newDrafts[`${day.date}-boostPage`] = day.boostPage > 0 ? day.boostPage.toString() : '';
                newDrafts[`${day.date}-staff`] = day.staff > 0 ? day.staff.toString() : '';
                newDrafts[`${day.date}-shipping`] = day.shipping > 0 ? day.shipping.toString() : '';
            });
            setDraftValues(newDrafts);

        } catch (error) {
            console.error('Failed to fetch prediction data:', error);
        } finally {
            setIsLoading(false);
        }
    }, [selectedMonth, productCostMap, year, monthIdx]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Auto-scroll to today
    useEffect(() => {
        if (!isLoading && todayRef.current) {
            todayRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [isLoading, dailyData]);

    const handleInputChange = (date: string, field: 'boostPage' | 'staff' | 'shipping', value: string) => {
        setDraftValues(prev => ({ ...prev, [`${date}-${field}`]: value }));
    };

    const handleInputBlur = (date: string, field: 'boostPage' | 'staff' | 'shipping') => {
        const dayIndex = dailyData.findIndex(d => d.date === date);
        if (dayIndex === -1) return;

        const day = dailyData[dayIndex];
        const draftValue = draftValues[`${date}-${field}`];
        const numValue = draftValue === '' ? 0 : parseFloat(draftValue);
        if (isNaN(numValue)) return;
        const currentValue = day[field];
        if (numValue === currentValue) return;

        const newData = [...dailyData];
        newData[dayIndex] = {
            ...day,
            [field]: numValue,
            profit: day.shippedDelivered - day.cogs -
                (field === 'shipping' ? numValue : day.shipping) -
                (field === 'boostPage' ? numValue : day.boostPage) -
                (field === 'staff' ? numValue : day.staff)
        };
        setDailyData(newData);
    };

    const handleSave = async (day: DailyPrediction) => {
        setSavingCells(prev => new Set(prev).add(day.date));
        try {
            const { error } = await supabase.from('income_predictions').upsert({
                date: day.date,
                shipped_delivered: day.shippedDelivered,
                order_count: day.orderCount,
                cogs: day.cogs,
                shipping: day.shipping,
                boost_page: day.boostPage,
                staff: day.staff,
                profit: day.profit,
                updated_at: new Date().toISOString(),
                updated_by: currentUser?.name || 'System'
            });
            if (error) throw error;
            
            const newData = [...dailyData];
            const idx = newData.findIndex(d => d.date === day.date);
            if (idx !== -1) {
                newData[idx].isSaved = true;
                setDailyData(newData);
            }
            
            setSavedCells(prev => new Set(prev).add(day.date));
            setTimeout(() => setSavedCells(prev => { const n = new Set(prev); n.delete(day.date); return n; }), 2000);
        } catch (error) {
            console.error('Failed to save prediction:', error);
            alert('Failed to save. Check console for details.');
        } finally {
            setSavingCells(prev => { const n = new Set(prev); n.delete(day.date); return n; });
        }
    };

    const handleReset = async (day: DailyPrediction) => {
        if (!confirm(`Are you sure you want to unsave ${day.date}? This will revert to auto-calculated live data.`)) return;
        
        setSavingCells(prev => new Set(prev).add(day.date));
        try {
            const { error } = await supabase.from('income_predictions').delete().eq('date', day.date);
            if (error) throw error;
            // Fetch data again to re-calculate this day from live sales
            fetchData();
        } catch (error) {
            console.error('Failed to reset prediction:', error);
            alert('Failed to reset. Check console for details.');
        } finally {
            setSavingCells(prev => { const n = new Set(prev); n.delete(day.date); return n; });
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent, _date: string, _field: 'boostPage' | 'staff' | 'shipping') => {
        if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
        }
    };

    const totals = useMemo(() => {
        return dailyData.reduce((acc, day) => {
            acc.shippedDelivered += day.shippedDelivered;
            acc.orderCount += day.orderCount;
            acc.cogs += day.cogs;
            acc.shipping += day.shipping;
            acc.boostPage += day.boostPage;
            acc.staff += day.staff;
            acc.profit += day.profit;
            return acc;
        }, { shippedDelivered: 0, orderCount: 0, cogs: 0, shipping: 0, boostPage: 0, staff: 0, profit: 0 });
    }, [dailyData]);

    const totalExpenses = totals.cogs + totals.shipping + totals.boostPage + totals.staff;
    const margin = totals.shippedDelivered > 0 ? ((totals.profit / totals.shippedDelivered) * 100) : 0;

    // Build a micro-sparkline from daily profits
    const sparkline = useMemo(() => {
        if (dailyData.length === 0) return null;
        const profits = dailyData.map(d => d.profit);
        const max = Math.max(...profits, 1);
        const min = Math.min(...profits, 0);
        const range = max - min || 1;
        const h = 32;
        const w = 120;
        const step = w / (profits.length - 1 || 1);
        const points = profits.map((p, i) => `${i * step},${h - ((p - min) / range) * h}`).join(' ');
        return (
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
                <defs>
                    <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
                    </linearGradient>
                </defs>
                <polygon points={`0,${h} ${points} ${w},${h}`} fill="url(#sparkGrad)" />
                <polyline points={points} fill="none" stroke="#8B5CF6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }, [dailyData]);

    const renderEditableCell = (day: DailyPrediction, field: 'boostPage' | 'staff' | 'shipping', color: string) => {
        const cellKey = `${day.date}-${field}`;
        const isSaving = savingCells.has(cellKey);
        const isSaved = savedCells.has(cellKey);

        return (
            <td style={{ padding: '2px 6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                    {isSaving && <Loader2 size={12} style={{ color, animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
                    {isSaved && <Check size={12} style={{ color: '#10B981', flexShrink: 0 }} />}
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth: '60px' }}>
                        <span style={{ position: 'absolute', left: '6px', color: 'var(--color-text-secondary)', fontSize: '11px', pointerEvents: 'none', opacity: 0.6 }}>$</span>
                        <input
                            type="number"
                            value={draftValues[cellKey] ?? ''}
                            onChange={e => handleInputChange(day.date, field, e.target.value)}
                            onBlur={() => handleInputBlur(day.date, field)}
                            onKeyDown={e => handleKeyDown(e, day.date, field)}
                            placeholder="0"
                            style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                textAlign: 'right',
                                padding: '5px 8px 5px 18px',
                                borderRadius: '6px',
                                border: `1px solid ${draftValues[cellKey] ? color + '40' : 'var(--color-border)'}`,
                                background: draftValues[cellKey] ? color + '08' : 'var(--color-background)',
                                color: 'var(--color-text-main)',
                                fontSize: '13px',
                                outline: 'none',
                                fontWeight: draftValues[cellKey] ? 600 : 400,
                                transition: 'all 0.2s'
                            }}
                            onFocus={e => { e.target.style.borderColor = color; e.target.style.boxShadow = `0 0 0 2px ${color}20`; }}
                            disabled={day.isSaved}
                        />
                    </div>
                </div>
            </td>
        );
    };

    const resizeHandle = (colIndex: number) => (
        <div
            onMouseDown={e => handleResizeStart(e, colIndex)}
            style={{
                position: 'absolute', right: 0, top: 0, bottom: 0,
                width: '6px', cursor: 'col-resize',
                background: 'transparent',
                zIndex: 5,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,0.3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
            <div style={{ width: '2px', height: '14px', borderRadius: '1px', background: 'inherit' }} />
        </div>
    );

    return (
        <div style={{ padding: isMobile ? '12px' : '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
            {/* Shimmer animation */}
            <style>{`
                @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
                .prediction-input::-webkit-inner-spin-button,
                .prediction-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
                .prediction-row:hover { background: var(--color-background) !important; }
                .prediction-row td { transition: background 0.15s ease; }
                .prediction-th { position: relative; }
                .prediction-th:hover .resize-hint { opacity: 1; }
            `}</style>

            {/* Header with month navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{
                        width: '44px', height: '44px', borderRadius: '14px',
                        background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 4px 14px rgba(139, 92, 246, 0.35)',
                        flexShrink: 0
                    }}>
                        <BarChart3 size={22} color="white" />
                    </div>
                    <div>
                        <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: 'var(--color-text-main)' }}>
                            Income Prediction
                        </h2>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: '2px 0 0 0' }}>
                            Daily profit forecast · {monthName} {year}
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button onClick={() => navigateMonth(-1)} className="secondary-button" style={{ padding: '8px', borderRadius: '10px', height: '38px', width: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Previous month">
                        <ChevronLeft size={18} />
                    </button>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Calendar size={16} style={{ position: 'absolute', left: '10px', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                        <input
                            type="month"
                            value={selectedMonth}
                            onChange={e => setSelectedMonth(e.target.value)}
                            style={{
                                padding: '8px 12px 8px 32px',
                                borderRadius: '10px',
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-surface)',
                                color: 'var(--color-text-main)',
                                fontSize: '13px',
                                fontWeight: 600,
                                outline: 'none',
                                cursor: 'pointer'
                            }}
                        />
                    </div>
                    <button onClick={() => navigateMonth(1)} className="secondary-button" style={{ padding: '8px', borderRadius: '10px', height: '38px', width: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Next month">
                        <ChevronRight size={18} />
                    </button>
                    <button
                        onClick={fetchData}
                        disabled={isLoading}
                        className="secondary-button"
                        style={{ padding: '8px', borderRadius: '10px', height: '38px', width: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Refresh"
                    >
                        <RefreshCw size={16} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '8px', flexShrink: 0 }}>
                {/* Revenue Card */}
                <div className="glass-panel hover-lift" style={{
                    padding: '12px', borderRadius: '12px',
                    background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02))',
                    border: '1px solid rgba(16,185,129,0.15)',
                    display: 'flex', flexDirection: 'column', gap: '6px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>Revenue ({monthName})</span>
                        <div style={{ padding: '4px', borderRadius: '6px', background: 'rgba(16,185,129,0.12)' }}><TrendingUp size={12} color="#10B981" /></div>
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#10B981' }}>${fmt(totals.shippedDelivered)}</div>
                    <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{totals.orderCount} orders</div>
                </div>

                {/* Total Expenses Card */}
                <div className="glass-panel hover-lift" style={{
                    padding: '12px', borderRadius: '12px',
                    background: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))',
                    border: '1px solid rgba(239,68,68,0.15)',
                    display: 'flex', flexDirection: 'column', gap: '6px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>Expenses ({monthName})</span>
                        <div style={{ padding: '4px', borderRadius: '6px', background: 'rgba(239,68,68,0.12)' }}><TrendingDown size={12} color="#EF4444" /></div>
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#EF4444' }}>${fmt(totalExpenses)}</div>
                    <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                        COGS ${fmt(totals.cogs)} · Ship ${fmt(totals.shipping)}
                    </div>
                </div>

                {/* Profit Card */}
                <div className="glass-panel hover-lift" style={{
                    padding: '12px', borderRadius: '12px',
                    background: `linear-gradient(135deg, rgba(${totals.profit >= 0 ? '139,92,246' : '239,68,68'},0.08), rgba(${totals.profit >= 0 ? '139,92,246' : '239,68,68'},0.02))`,
                    border: `1px solid rgba(${totals.profit >= 0 ? '139,92,246' : '239,68,68'},0.15)`,
                    display: 'flex', flexDirection: 'column', gap: '6px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>Profit ({monthName})</span>
                        <div style={{ padding: '4px', borderRadius: '6px', background: `rgba(${totals.profit >= 0 ? '139,92,246' : '239,68,68'},0.12)` }}>
                            <DollarSign size={12} color={totals.profit >= 0 ? '#8B5CF6' : '#EF4444'} />
                        </div>
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: totals.profit >= 0 ? '#8B5CF6' : '#EF4444' }}>
                        ${fmt(totals.profit)}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Margin: {margin.toFixed(1)}%</div>
                </div>

                {/* Trend Card */}
                <div className="glass-panel hover-lift" style={{
                    padding: '12px', borderRadius: '12px',
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(59,130,246,0.02))',
                    border: '1px solid rgba(59,130,246,0.15)',
                    display: 'flex', flexDirection: 'column', gap: '6px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>
                            Ad + Staff ({monthName})
                        </span>
                        <div style={{ padding: '4px', borderRadius: '6px', background: 'rgba(59,130,246,0.12)' }}><Megaphone size={12} color="#3B82F6" /></div>
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#3B82F6' }}>${fmt(totals.boostPage + totals.staff)}</div>
                    <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                        Ads ${fmt(totals.boostPage)} · Staff ${fmt(totals.staff)}
                    </div>
                </div>
            </div>

            {/* Sparkline trend */}
            {sparkline && !isLoading && (
                <div className="glass-panel" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#8B5CF6', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}>Daily Profit Trend</span>
                    </div>
                    <div style={{ flex: 1, maxWidth: '500px' }}>{sparkline}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                        Avg: <strong style={{ color: totals.profit >= 0 ? '#8B5CF6' : '#EF4444' }}>
                            ${fmt(dailyData.length > 0 ? totals.profit / (dailyData.filter(d => !d.isFuture).length || 1) : 0)}/day
                        </strong>
                    </div>
                </div>
            )}

            {/* Spreadsheet Table - Full height */}
            <div className="glass-panel" style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: '16px', flex: 1, minHeight: 0 }}>
                <table className="spreadsheet-table" style={{ minWidth: '920px', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: colWidths.reduce((a, b) => a + b, 0) }}>
                    <colgroup>
                        {colWidths.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}
                    </colgroup>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 4 }}>
                        <tr style={{ background: 'var(--color-surface)' }}>
                            <th className="prediction-th" style={{
                                position: 'sticky', left: 0, zIndex: 5, background: 'var(--color-surface)',
                                borderBottom: '2px solid var(--color-border)',
                                fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                                padding: '10px 12px', color: 'var(--color-text-secondary)'
                            }}>Date{resizeHandle(0)}</th>
                            <th className="prediction-th" style={{ borderBottom: '2px solid var(--color-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 12px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Orders{resizeHandle(1)}</th>
                            <th className="prediction-th" style={{ borderBottom: '2px solid var(--color-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 12px', textAlign: 'right', color: '#10B981' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Package size={12} /> Revenue</span>{resizeHandle(2)}
                            </th>
                            <th className="prediction-th" style={{ borderBottom: '2px solid var(--color-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 12px', textAlign: 'right', color: '#F59E0B' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Megaphone size={12} /> Boost</span>{resizeHandle(3)}
                            </th>
                            <th className="prediction-th" style={{ borderBottom: '2px solid var(--color-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 12px', textAlign: 'right', color: '#EF4444' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><DollarSign size={12} /> COGS</span>{resizeHandle(4)}
                            </th>
                            <th className="prediction-th" style={{ borderBottom: '2px solid var(--color-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 12px', textAlign: 'right', color: '#EF4444' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Truck size={12} /> Shipping</span>{resizeHandle(5)}
                            </th>
                            <th className="prediction-th" style={{ borderBottom: '2px solid var(--color-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 12px', textAlign: 'right', color: '#F59E0B' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Users size={12} /> Staff</span>{resizeHandle(6)}
                            </th>
                            <th className="prediction-th" style={{ borderBottom: '2px solid var(--color-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 12px', textAlign: 'right', color: '#8B5CF6' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><TrendingUp size={12} /> Profit</span>{resizeHandle(7)}
                            </th>
                            <th className="prediction-th" style={{ borderBottom: '2px solid var(--color-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 12px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                Action{resizeHandle(8)}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            Array.from({ length: 15 }).map((_, i) => <SkeletonRow key={i} />)
                        ) : (
                            dailyData.map((day, idx) => {
                                const rowBg = day.isToday
                                    ? 'rgba(139, 92, 246, 0.06)'
                                    : day.isFuture
                                        ? 'rgba(0,0,0,0.01)'
                                        : idx % 2 === 0
                                            ? 'transparent'
                                            : 'rgba(0,0,0,0.015)';

                                return (
                                    <tr
                                        key={day.date}
                                        ref={day.isToday ? todayRef : undefined}
                                        className="prediction-row"
                                        style={{
                                            background: rowBg,
                                            opacity: day.isFuture ? 0.5 : 1,
                                            borderLeft: day.isToday ? '3px solid #8B5CF6' : '3px solid transparent'
                                        }}
                                    >
                                        {/* Date cell */}
                                        <td style={{
                                            position: 'sticky', left: 0, zIndex: 1,
                                            background: day.isToday ? 'rgba(139,92,246,0.06)' : (idx % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface)'),
                                            padding: '8px 12px',
                                            borderRight: '1px solid var(--color-border)',
                                            fontSize: '12px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{
                                                    fontWeight: 700, fontSize: '16px',
                                                    color: day.isToday ? '#8B5CF6' : day.isWeekend ? '#EF4444' : 'var(--color-text-main)',
                                                    width: '24px'
                                                }}>
                                                    {day.dayNum}
                                                </span>
                                                <span style={{
                                                    fontSize: '10px', fontWeight: 600,
                                                    color: day.isWeekend ? '#EF4444' : 'var(--color-text-secondary)',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {day.dayOfWeek}
                                                </span>
                                                {day.isToday && (
                                                    <span style={{
                                                        fontSize: '8px', fontWeight: 700,
                                                        background: '#8B5CF6', color: 'white',
                                                        padding: '1px 5px', borderRadius: '4px',
                                                        textTransform: 'uppercase', letterSpacing: '0.5px'
                                                    }}>Today</span>
                                                )}
                                            </div>
                                        </td>

                                        {/* Order count */}
                                        <td style={{ textAlign: 'center', fontSize: '12px', fontWeight: 600, color: day.orderCount > 0 ? 'var(--color-text-main)' : 'var(--color-text-secondary)', padding: '8px' }}>
                                            {day.orderCount > 0 ? day.orderCount : '-'}
                                        </td>

                                        {/* Revenue */}
                                        <td style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, fontSize: '12px', color: day.shippedDelivered > 0 ? '#10B981' : 'var(--color-text-secondary)' }}>
                                            {day.shippedDelivered > 0 ? `$${fmt(day.shippedDelivered)}` : '-'}
                                        </td>

                                        {/* Boost Page (editable) */}
                                        {renderEditableCell(day, 'boostPage', '#F59E0B')}

                                        {/* COGS */}
                                        <td style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 500, fontSize: '12px', color: day.cogs > 0 ? '#EF4444' : 'var(--color-text-secondary)' }}>
                                            {day.cogs > 0 ? `$${fmt(day.cogs)}` : '-'}
                                        </td>

                                        {/* Shipping (editable) */}
                                        {renderEditableCell(day, 'shipping', '#EF4444')}

                                        {/* Staff (editable) */}
                                        {renderEditableCell(day, 'staff', '#3B82F6')}

                                        {/* Profit */}
                                        <td style={{
                                            textAlign: 'right', padding: '8px 12px',
                                            fontWeight: 700, fontSize: '13px',
                                            color: day.profit > 0 ? '#8B5CF6' : day.profit < 0 ? '#EF4444' : 'var(--color-text-secondary)',
                                            background: day.profit !== 0 ? `rgba(${day.profit > 0 ? '139,92,246' : '239,68,68'},0.04)` : undefined
                                        }}>
                                            {day.profit !== 0 ? `$${fmt(day.profit)}` : '-'}
                                        </td>
                                        
                                        {/* Action */}
                                        <td style={{ textAlign: 'center', padding: '4px' }}>
                                            {day.isSaved ? (
                                                <button 
                                                    onClick={() => handleReset(day)}
                                                    disabled={savingCells.has(day.date)}
                                                    title="Unsave and recalculate"
                                                    style={{ padding: '6px', background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', borderRadius: '8px', cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}
                                                >
                                                    {savingCells.has(day.date) ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={16} />}
                                                </button>
                                            ) : (
                                                <button 
                                                    onClick={() => handleSave(day)}
                                                    disabled={savingCells.has(day.date)}
                                                    title="Save prediction"
                                                    style={{ padding: '6px', background: savedCells.has(day.date) ? '#10B981' : 'rgba(139, 92, 246, 0.1)', color: savedCells.has(day.date) ? 'white' : '#8B5CF6', borderRadius: '8px', cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', transition: 'all 0.2s' }}
                                                >
                                                    {savingCells.has(day.date) ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : savedCells.has(day.date) ? <Check size={16} /> : <Save size={16} />}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                    {!isLoading && (
                        <tfoot>
                            {/* Column totals row */}
                            <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-surface)' }}>
                                <td style={{ bottom: 'auto', position: 'sticky', left: 0, zIndex: 1, background: 'var(--color-surface)', fontWeight: 700, fontSize: '12px', padding: '12px', borderRight: '1px solid var(--color-border)', color: 'var(--color-text-main)' }}>
                                    TOTALS
                                </td>
                                <td style={{ bottom: 'auto', textAlign: 'center', fontWeight: 700, fontSize: '12px', padding: '12px', color: 'var(--color-text-main)' }}>
                                    {totals.orderCount}
                                </td>
                                <td style={{ bottom: 'auto', textAlign: 'right', fontWeight: 700, fontSize: '12px', padding: '12px', color: '#10B981' }}>
                                    ${fmt(totals.shippedDelivered)}
                                </td>
                                <td style={{ bottom: 'auto', textAlign: 'right', fontWeight: 700, fontSize: '12px', padding: '12px', color: '#F59E0B' }}>
                                    ${fmt(totals.boostPage)}
                                </td>
                                <td style={{ bottom: 'auto', textAlign: 'right', fontWeight: 700, fontSize: '12px', padding: '12px', color: '#EF4444' }}>
                                    ${fmt(totals.cogs)}
                                </td>
                                <td style={{ bottom: 'auto', textAlign: 'right', fontWeight: 700, fontSize: '12px', padding: '12px', color: '#EF4444' }}>
                                    ${fmt(totals.shipping)}
                                </td>
                                <td style={{ bottom: 'auto', textAlign: 'right', fontWeight: 700, fontSize: '12px', padding: '12px', color: '#3B82F6' }}>
                                    ${fmt(totals.staff)}
                                </td>
                                <td style={{ bottom: 'auto', textAlign: 'right', fontWeight: 700, fontSize: '12px', padding: '12px', color: totals.profit >= 0 ? '#8B5CF6' : '#EF4444' }}>
                                    ${fmt(totals.profit)}
                                </td>
                                <td style={{ bottom: 'auto', background: 'var(--color-surface)' }}></td>
                            </tr>
                            {/* Profit highlight row */}
                            <tr style={{
                                background: totals.profit >= 0
                                    ? 'linear-gradient(90deg, rgba(139,92,246,0.1), rgba(16,185,129,0.1))'
                                    : 'linear-gradient(90deg, rgba(239,68,68,0.1), rgba(239,68,68,0.05))'
                            }}>
                                <td colSpan={7} style={{
                                    bottom: 'auto', position: 'sticky', left: 0,
                                    fontWeight: 800, fontSize: '15px', padding: '16px',
                                    color: totals.profit >= 0 ? '#6D28D9' : '#DC2626',
                                    borderBottomLeftRadius: '16px',
                                    background: totals.profit >= 0
                                        ? 'linear-gradient(90deg, rgba(139,92,246,0.1), rgba(16,185,129,0.1))'
                                        : 'linear-gradient(90deg, rgba(239,68,68,0.1), rgba(239,68,68,0.05))'
                                }}>
                                    {totals.profit >= 0 ? '🟢' : '🔴'} NET PROFIT ({monthName.toUpperCase()})
                                </td>
                                <td style={{
                                    bottom: 'auto', textAlign: 'right', fontWeight: 800, fontSize: '18px', padding: '16px',
                                    color: totals.profit >= 0 ? '#6D28D9' : '#DC2626',
                                    borderBottomRightRadius: '16px',
                                    background: totals.profit >= 0
                                        ? 'linear-gradient(90deg, rgba(16,185,129,0.1), rgba(139,92,246,0.15))'
                                        : 'linear-gradient(90deg, rgba(239,68,68,0.05), rgba(239,68,68,0.12))'
                                }}>
                                    ${fmt(totals.profit)}
                                </td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
};

export default IncomePrediction;
