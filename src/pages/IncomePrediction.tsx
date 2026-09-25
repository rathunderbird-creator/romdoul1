import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { DollarSign, TrendingUp, TrendingDown, Package, Truck, Megaphone, Users, RefreshCw, Check, Loader2, Save, RotateCcw, BarChart3, AlertTriangle } from 'lucide-react';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../utils/fetchAll';
import { fetchInMonthWindows } from '../utils/fetchInMonthWindows';
import { defaultRange, dayKeysOfRange, parseDay, rangeMonths, wholeMonthOf, MAX_RANGE_DAYS, type DateRange } from '../utils/dateRange';
import { roundCents } from '../utils/money';
import { isMissingTableError, errMessage } from '../utils/supabaseErrors';
import { useStore } from '../context/StoreContext';
import DateRangeControl from './pageIncomePrediction/components/DateRangeControl';
import { rangeLabel, monthShortLabel } from './pageIncomePrediction/format';
// The shared range control's pip-icon-button / pip-range-picker styles.
import './pageIncomePrediction/pageIncomePrediction.css';

// Staff is auto-saved to its own table, NOT into income_predictions: a row
// there means "this day is frozen", so writing Staff into it would freeze
// today's live sales (or a future day at $0). See
// migrations/create_income_prediction_staff.sql.
const STAFF_TABLE = 'income_prediction_staff';
// Save this long after the last keystroke, so a value typed right before a
// reload or tab close isn't lost. Leaving the box (or Enter) saves at once.
const STAFF_AUTOSAVE_MS = 800;

type EditableField = 'boostPage' | 'staff' | 'shipping';

// `sales.date` is a timestamptz stored in UTC, but the business runs in local time
// (UTC+7). Reading the date off the raw ISO string would book any sale made between
// midnight and 07:00 local to the *previous* day, so always convert to local first.
const getLocalYYYYMMDD = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The short period name in the KPI card titles and the NET PROFIT footer. A whole
// calendar month (the default view) keeps its bare month name, "September", so
// that view reads exactly as it always did; any other range reads
// "5 Sep – 15 Sep 2026" (see rangeLabel).
const periodShortLabel = (range: DateRange): string => {
    const whole = wholeMonthOf(range);
    return whole ? MONTH_NAMES[parseInt(whole.split('-')[1]) - 1] : rangeLabel(range, 'en');
};

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
    boostFromPages: boolean;   // Boost was auto-filled from Prediction by Page
    isToday: boolean;
    isFuture: boolean;
    isWeekend: boolean;
}

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const withProfit = (day: DailyPrediction): DailyPrediction => ({
    ...day,
    profit: day.shippedDelivered - day.cogs - day.shipping - day.boostPage - day.staff
});

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
// A range that spans months puts a month tag before the day number ("SEP 25 FRI
// TODAY"), which doesn't fit the default 110px Date column. Same rule as the
// other three screens' Day column: widen it unless the user has dragged it.
const MULTI_MONTH_DATE_COL_WIDTH = 170;

const IncomePrediction: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();
    const { products, currentUser, shippingRates } = useStore();

    // Any inclusive span of local days (default: the current calendar month).
    const [range, setRange] = useState<DateRange>(() => defaultRange(new Date()));
    const [isLoading, setIsLoading] = useState(false);
    const [dailyData, setDailyData] = useState<DailyPrediction[]>([]);
    const [draftValues, setDraftValues] = useState<Record<string, string>>({});
    const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
    const [savedCells, setSavedCells] = useState<Set<string>>(new Set());
    const todayRef = useRef<HTMLTableRowElement>(null);

    // Staff auto-save. `staffStoreError` is set when the Staff table can't be
    // read (e.g. not migrated on this instance): Staff then falls back to the
    // old behaviour — stored only by the row's Save button.
    const [staffStoreError, setStaffStoreError] = useState<{ missing: boolean; message: string } | null>(null);
    const [staffErrors, setStaffErrors] = useState<Record<string, string>>({});   // cellKey → why the last save failed
    const dailyDataRef = useRef<DailyPrediction[]>([]);
    // Writes for one day are chained so two quick edits land in order.
    const staffWrites = useRef<Map<string, Promise<void>>>(new Map());
    // Debounced commits still waiting for the typing pause, per day.
    const staffTimers = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>>(new Map());

    useEffect(() => { dailyDataRef.current = dailyData; }, [dailyData]);

    // Column resize state
    const [colWidths, setColWidths] = useState<number[]>(() => {
        try {
            const saved = localStorage.getItem('prediction-col-widths');
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        return [...DEFAULT_COL_WIDTHS];
    });
    const resizingRef = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);

    // Days of different months share the ledger, so each row is tagged with its
    // month (see the Date cell) — and the Date column is widened to fit the tag.
    const spansMonths = rangeMonths(range).length > 1;
    // The widths actually drawn: the stored ones, except the Date column is
    // widened for a multi-month range while it is still at its default.
    const effectiveWidths = useMemo(
        () => colWidths.map((w, i) => (i === 0 && spansMonths && w === DEFAULT_COL_WIDTHS[0] ? MULTI_MONTH_DATE_COL_WIDTH : w)),
        [colWidths, spansMonths]
    );

    const handleResizeStart = useCallback((e: React.MouseEvent, colIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        // Drag from the width the user actually sees, not the stored default.
        resizingRef.current = { colIndex, startX: e.clientX, startWidth: effectiveWidths[colIndex] };
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
    }, [effectiveWidths]);

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

    // fetchData depends on the range's two ends (primitives), not the object, so an
    // equal range re-created by the picker doesn't trigger a reload.
    const { from: rangeFrom, to: rangeTo } = range;

    // Only the newest fetchData may publish its result: a long range takes seconds,
    // so an older load finishing late must not overwrite the range now on screen.
    const fetchSeq = useRef(0);

    const fetchData = useCallback(async () => {
        const seq = ++fetchSeq.current;
        const fetchRange: DateRange = { from: rangeFrom, to: rangeTo };
        setIsLoading(true);
        // Commit Staff still waiting on its typing pause and let in-flight Staff
        // writes land first, so this read (range change / refresh) sees them.
        staffTimers.current.forEach(({ timer, run }) => { clearTimeout(timer); run(); });
        staffTimers.current.clear();
        await Promise.all(staffWrites.current.values());
        try {
            // `income_predictions.date` (and the two input tables) are plain calendar
            // dates, so they're bounded by the range's own YYYY-MM-DD strings rather
            // than by instants. Sales are bounded per calendar month by
            // fetchInMonthWindows, as half-open ranges of real instants derived from
            // LOCAL midnight boundaries (a `${day}T00:00:00Z` bound would start the
            // window 7 hours late and end it 7 hours into the next day).
            const firstDayStr = fetchRange.from;
            const lastDayStr = fetchRange.to;

            // Every read is chunk-fetched (fetchAll / fetchInMonthWindows) so a long
            // range is never silently truncated at the API's max-rows cap.
            const [salesRows, predictionRows, pageBoostRows, staffRes] = await Promise.all([
                fetchInMonthWindows(fetchRange, (startStr, endStr) => (from, to) =>
                    supabase.from('sales')
                        .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                        .gte('date', startStr).lt('date', endStr)
                        .order('id', { ascending: true }).range(from, to)
                ),
                // A failure here aborts the load (thrown out of Promise.all into the
                // catch below), as it always has. `date` is the primary key.
                fetchAll((from, to) =>
                    supabase.from('income_predictions')
                        .select('*')
                        .gte('date', firstDayStr).lte('date', lastDayStr)
                        .order('date', { ascending: true }).range(from, to)
                ),
                // Boost typed per Facebook page in Prediction by Page. Optional input:
                // that screen's table may not exist on this Supabase instance yet, in
                // which case Boost simply stays manual here instead of breaking the
                // whole screen. Ordered by its primary key so chunking is deterministic.
                fetchAll<{ date: string; boost_page: number | string | null }>((from, to) =>
                    supabase.from('page_income_predictions')
                        .select('date, boost_page')
                        .gte('date', firstDayStr).lte('date', lastDayStr)
                        .order('date', { ascending: true }).order('page', { ascending: true }).range(from, to)
                ).catch(error => {
                    console.warn('Prediction by Page Boost unavailable — Boost stays manual:', error);
                    return [] as { date: string; boost_page: number | string | null }[];
                }),
                // Auto-saved Staff. A failure here only switches Staff back to
                // Save-button mode instead of breaking the whole screen.
                fetchAll<{ date: string; staff: number | string | null }>((from, to) =>
                    supabase.from(STAFF_TABLE)
                        .select('date, staff')
                        .gte('date', firstDayStr).lte('date', lastDayStr)
                        .order('date', { ascending: true }).range(from, to)
                ).then(
                    rows => ({ rows, error: null as unknown }),
                    (error: unknown) => ({ rows: [] as { date: string; staff: number | string | null }[], error })
                )
            ]);

            // A newer load has started meanwhile (range switched / refreshed): drop this one.
            if (seq !== fetchSeq.current) return;

            if (staffRes.error) {
                const missing = isMissingTableError(staffRes.error);
                if (!missing) console.error('Failed to load saved Staff:', staffRes.error);
                setStaffStoreError({ missing, message: errMessage(staffRes.error) });
            } else {
                setStaffStoreError(null);
            }

            // Σ Boost over every page (incl. the "no page" bucket) per calendar day,
            // snapped to cents — the per-page amounts are cents, but their float sum
            // isn't (e.g. 259.82000000000005) and would surface in the Boost input.
            const pageBoostByDate = new Map<string, number>();
            pageBoostRows.forEach(r => {
                pageBoostByDate.set(r.date, (pageBoostByDate.get(r.date) || 0) + (Number(r.boost_page) || 0));
            });
            pageBoostByDate.forEach((v, k) => pageBoostByDate.set(k, roundCents(v)));

            const todayStr = getLocalYYYYMMDD(new Date());
            const dailyMap = new Map<string, DailyPrediction>();

            // One row per calendar day of the range. A day is identified by its
            // YYYY-MM-DD string; `dayNum` (day of the month) is display only.
            for (const dateStr of dayKeysOfRange(fetchRange)) {
                const dayDate = parseDay(dateStr);
                const dow = dayDate.getDay();
                dailyMap.set(dateStr, {
                    date: dateStr,
                    dayOfWeek: DAY_NAMES_SHORT[dow],
                    dayNum: dayDate.getDate(),
                    shippedDelivered: 0,
                    orderCount: 0,
                    cogs: 0,
                    shipping: 0,
                    boostPage: 0,
                    staff: 0,
                    profit: 0,
                    isSaved: false,
                    boostFromPages: false,
                    isToday: dateStr === todayStr,
                    isFuture: dateStr > todayStr,
                    isWeekend: dow === 0 || dow === 6
                });
            }

            // 1. Apply saved predictions first
            predictionRows.forEach((row: any) => {
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

            // 1b. Auto-saved Staff wins over a frozen row's copy, and applies to
            // unsaved days too — it's an input, not part of the frozen snapshot.
            staffRes.rows.forEach(row => {
                const day = dailyMap.get(String(row.date));
                if (day) day.staff = Number(row.staff) || 0;
            });

            // 2. Auto-calculate from live sales ONLY for unsaved days
            salesRows.forEach((sale: any) => {
                const saleDate = sale.date ? getLocalYYYYMMDD(new Date(sale.date)) : null;
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

            // 3. Boost for UNSAVED days comes from Prediction by Page (Σ of its BOOST
            // column for that date), the same way shipping/COGS auto-fill from live
            // sales. Saved days keep their frozen Boost — they're a deliberate
            // snapshot (e.g. hand-entered before Page existed) and must not be
            // overwritten. Still editable until saved, like shipping.
            dailyMap.forEach(day => {
                if (day.isSaved) return;
                const fromPages = pageBoostByDate.get(day.date) || 0;
                if (fromPages > 0) {
                    day.boostPage = fromPages;
                    day.boostFromPages = true;
                }
            });

            const results = Array.from(dailyMap.values()).map(day => {
                // An unsaved day's shipping is a float sum of per-order carrier fees
                // (line above), e.g. 3.3000000000000003. That raw value is what the
                // Shipping input shows and what Save would upsert — snap it to cents.
                day.shipping = roundCents(day.shipping);
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
            setStaffErrors({});

        } catch (error) {
            console.error('Failed to fetch prediction data:', error);
        } finally {
            if (seq === fetchSeq.current) setIsLoading(false);
        }
    }, [rangeFrom, rangeTo, productCostMap]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Auto-scroll to today
    useEffect(() => {
        if (!isLoading && todayRef.current) {
            todayRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [isLoading, dailyData]);

    const staffAutoSave = staffStoreError === null;

    // Persists one day's Staff. On failure the last saved amount goes back into
    // the totals while the typed text stays in the box, marked, so committing
    // it again retries.
    const saveStaff = (day: DailyPrediction, previousStaff: number) => {
        const { date, staff } = day;
        const cellKey = `${date}-staff`;
        setSavingCells(prev => new Set(prev).add(cellKey));
        setStaffErrors(prev => {
            if (!(cellKey in prev)) return prev;
            const next = { ...prev };
            delete next[cellKey];
            return next;
        });

        const write = async () => {
            const stamp = { updated_at: new Date().toISOString(), updated_by: currentUser?.name || 'System' };
            const { error } = await supabase.from(STAFF_TABLE).upsert({ date, staff, ...stamp });
            if (error) throw error;
            // A frozen day keeps its own Staff copy (and the profit built on it),
            // read by older app builds. The Staff table above wins everywhere in
            // this build, so a failure here is only worth a warning.
            if (day.isSaved) {
                const { error: frozenError } = await supabase.from('income_predictions')
                    .update({ staff, profit: roundCents(day.profit), ...stamp }).eq('date', date);
                if (frozenError) console.warn('Staff saved, but the frozen day copy was not updated:', frozenError);
            }
        };

        const chained = (staffWrites.current.get(date) || Promise.resolve())
            .then(write)
            .then(() => {
                setSavedCells(prev => new Set(prev).add(cellKey));
                setTimeout(() => setSavedCells(prev => { const n = new Set(prev); n.delete(cellKey); return n; }), 2000);
            }, (error: unknown) => {
                console.error('Failed to save staff:', error);
                setStaffErrors(prev => ({ ...prev, [cellKey]: errMessage(error) }));
                setDailyData(prev => prev.map(d => d.date === date && d.staff === staff ? withProfit({ ...d, staff: previousStaff }) : d));
            })
            .finally(() => setSavingCells(prev => { const n = new Set(prev); n.delete(cellKey); return n; }));
        staffWrites.current.set(date, chained);
    };

    // Applies a typed value to its day and recomputes profit. Staff is then
    // auto-saved; Boost and Shipping stay on screen until the row's Save.
    const commitInput = (date: string, field: EditableField, draftValue: string | undefined) => {
        const day = dailyDataRef.current.find(d => d.date === date);
        if (!day || draftValue === undefined) return;
        const numValue = draftValue === '' ? 0 : parseFloat(draftValue);
        if (isNaN(numValue) || numValue === day[field]) return;

        const updated = withProfit({
            ...day,
            [field]: numValue,
            // A hand-typed Boost is no longer "from Prediction by Page".
            ...(field === 'boostPage' ? { boostFromPages: false } : {})
        });
        dailyDataRef.current = dailyDataRef.current.map(d => d.date === date ? updated : d);
        setDailyData(prev => prev.map(d => d.date === date ? updated : d));
        if (field === 'staff' && staffAutoSave) saveStaff(updated, day.staff);
    };

    const cancelStaffTimer = (date: string) => {
        const pending = staffTimers.current.get(date);
        if (pending) clearTimeout(pending.timer);
        staffTimers.current.delete(date);
    };

    // Leaving the page commits Staff still waiting on its typing pause.
    useEffect(() => {
        const timers = staffTimers.current;
        return () => {
            timers.forEach(({ timer, run }) => { clearTimeout(timer); run(); });
            timers.clear();
        };
    }, []);

    const handleInputChange = (date: string, field: EditableField, value: string) => {
        setDraftValues(prev => ({ ...prev, [`${date}-${field}`]: value }));
        if (field === 'staff' && staffAutoSave) {
            cancelStaffTimer(date);
            const run = () => { staffTimers.current.delete(date); commitInput(date, 'staff', value); };
            staffTimers.current.set(date, { timer: setTimeout(run, STAFF_AUTOSAVE_MS), run });
        }
    };

    const handleInputBlur = (date: string, field: EditableField) => {
        if (field === 'staff') cancelStaffTimer(date);
        commitInput(date, field, draftValues[`${date}-${field}`]);
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
            // Unsaving drops the frozen snapshot, not the Staff input: a day frozen
            // before Staff auto-saved only has it in the snapshot, so copy it out first.
            if (staffAutoSave && day.staff !== 0) {
                const { error: staffError } = await supabase.from(STAFF_TABLE).upsert({
                    date: day.date,
                    staff: day.staff,
                    updated_at: new Date().toISOString(),
                    updated_by: currentUser?.name || 'System'
                });
                if (staffError) throw staffError;
            }
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

    const periodShort = periodShortLabel(range);
    // (`spansMonths` — days of different months share the ledger, so each is tagged
    // with its month — is declared above, next to the column widths that depend on it.)

    const totalExpenses = totals.cogs + totals.shipping + totals.boostPage + totals.staff;
    const margin = totals.shippedDelivered > 0 ? ((totals.profit / totals.shippedDelivered) * 100) : 0;

    // Build a micro-sparkline from daily profits
    const sparkline = useMemo(() => {
        if (dailyData.length === 0) return null;
        const profits = dailyData.map(d => d.profit);
        const max = Math.max(...profits, 1);
        const min = Math.min(...profits, 0);
        const spread = max - min || 1;
        const h = 32;
        const w = 120;
        const step = w / (profits.length - 1 || 1);
        const points = profits.map((p, i) => `${i * step},${h - ((p - min) / spread) * h}`).join(' ');
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

    const renderEditableCell = (day: DailyPrediction, field: EditableField, color: string, title?: string) => {
        const cellKey = `${day.date}-${field}`;
        const isSaving = savingCells.has(cellKey);
        const isSaved = savedCells.has(cellKey);
        const saveError = staffErrors[cellKey];
        // Auto-saved Staff stays editable on a frozen day; everything else is
        // part of the frozen snapshot.
        const autoSaved = field === 'staff' && staffAutoSave;

        return (
            <td style={{ padding: '2px 6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                    {isSaving && <Loader2 size={12} style={{ color, animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
                    {isSaved && <Check size={12} style={{ color: '#10B981', flexShrink: 0 }} />}
                    {saveError && !isSaving && (
                        <span title={`Not saved: ${saveError}. Click the box and press Enter to retry.`} style={{ display: 'inline-flex', flexShrink: 0 }}>
                            <AlertTriangle size={12} color="#EF4444" />
                        </span>
                    )}
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth: '60px' }}>
                        <span style={{ position: 'absolute', left: '6px', color: 'var(--color-text-secondary)', fontSize: '11px', pointerEvents: 'none', opacity: 0.6 }}>$</span>
                        <input
                            type="number"
                            value={draftValues[cellKey] ?? ''}
                            onChange={e => handleInputChange(day.date, field, e.target.value)}
                            onBlur={() => handleInputBlur(day.date, field)}
                            onKeyDown={e => handleKeyDown(e, day.date, field)}
                            placeholder="0"
                            title={autoSaved ? 'Saved automatically when you stop typing' : title}
                            style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                textAlign: 'right',
                                padding: '5px 8px 5px 18px',
                                borderRadius: '6px',
                                border: `1px solid ${saveError ? '#EF4444' : draftValues[cellKey] ? color + '40' : 'var(--color-border)'}`,
                                background: draftValues[cellKey] ? color + '08' : 'var(--color-background)',
                                color: 'var(--color-text-main)',
                                fontSize: '13px',
                                outline: 'none',
                                fontWeight: draftValues[cellKey] ? 600 : 400,
                                transition: 'all 0.2s'
                            }}
                            onFocus={e => { e.target.style.borderColor = color; e.target.style.boxShadow = `0 0 0 2px ${color}20`; }}
                            disabled={day.isSaved && !autoSaved}
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
        <div style={{ padding: isMobile ? '12px' : '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px', height: 'calc(var(--vh-full) - 60px)', overflow: 'hidden' }}>
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

            {/* Header with date-range navigation */}
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
                            Daily profit forecast · {rangeLabel(range, 'en')}
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <DateRangeControl
                        range={range}
                        now={new Date()}
                        onChange={setRange}
                        labels={{ prev: 'Previous period', next: 'Next period', tooLong: `Limited to the latest ${MAX_RANGE_DAYS} days` }}
                        compact={isMobile}
                    />
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
                        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>Revenue ({periodShort})</span>
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
                        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>Expenses ({periodShort})</span>
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
                        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>Profit ({periodShort})</span>
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
                            Ad + Staff ({periodShort})
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

            {staffStoreError && !isLoading && (
                <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 14px', borderRadius: '10px', border: '1px solid #FDE68A', background: '#FFFBEB', color: '#92400E', fontSize: '12px', flexShrink: 0 }}>
                    <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <span>
                        {staffStoreError.missing
                            ? <>Staff isn't auto-saved on this database yet: run <code>migrations/create_income_prediction_staff.sql</code> in the Supabase SQL editor. Until then, Staff is only stored when you press Save on the row.</>
                            : <>Couldn't load saved Staff amounts ({staffStoreError.message}), so Staff is only stored when you press Save on the row. Refresh to try again.</>}
                    </span>
                </div>
            )}

            {/* Spreadsheet Table - Full height */}
            <div className="glass-panel" style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: '16px', flex: 1, minHeight: 0 }}>
                <table className="spreadsheet-table" style={{ minWidth: '920px', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: effectiveWidths.reduce((a, b) => a + b, 0) }}>
                    <colgroup>
                        {effectiveWidths.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}
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
                                                {spansMonths && (
                                                    <span style={{
                                                        fontSize: '10px', fontWeight: 600,
                                                        color: day.isToday ? '#8B5CF6' : day.isWeekend ? '#EF4444' : 'var(--color-text-secondary)',
                                                        textTransform: 'uppercase'
                                                    }}>
                                                        {monthShortLabel(day.date, 'en')}
                                                    </span>
                                                )}
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
                                        {renderEditableCell(day, 'boostPage', '#F59E0B', day.boostFromPages ? 'From Prediction by Page (sum of all pages). Edit to override; Save freezes it.' : undefined)}

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
                                    {totals.profit >= 0 ? '🟢' : '🔴'} NET PROFIT ({periodShort.toUpperCase()})
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
