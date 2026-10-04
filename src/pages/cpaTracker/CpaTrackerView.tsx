// Profit & CPA Tracker — pure view. Toolbar (date range, tabs, refresh) →
// banners → KPI cards → one of four tabs, one per sheet of the original
// workbook: Daily Tracker · Summary (by page / by product) · Weekly · Unit
// Economics. No store / router access: the container passes data and
// callbacks; src/dev/cpaTracker-preview.tsx renders it with fixtures.
import React, { useMemo, useState } from 'react';
import { Target, RefreshCw, AlertTriangle, AlertCircle, Lock, Plus, Megaphone, PackageCheck, DollarSign, MessageCircle, TrendingUp, Settings2, Search, X } from 'lucide-react';
import '../pageIncomePrediction/pageIncomePrediction.css';
import {
    buildCpaTracker, sumMeasures, entryKey, pageSummariesOf, productSummariesOf, searchNorm, searchTermsOf, matchesTerms,
    type DailyRow, type EntryField, type SettingField, type DayGroup,
} from './metrics';
import { MAX_RANGE_DAYS } from '../../utils/dateRange';
import { dayKeyOf } from '../pageIncomePrediction/metrics';
import { fmtMoney, fmtPct, rangeLabel, fill } from '../pageIncomePrediction/format';
import DateRangeControl from '../pageIncomePrediction/components/DateRangeControl';
import SkeletonRows from '../pageIncomePrediction/components/SkeletonRows';
import type { CpaTab, CpaViewProps } from './types';
import { CPA_TABS } from './types';
import { KpiCard, Banner, useCellSaveState, ACCENT } from './components/ui';
import DailyTable, { entryCellKey } from './components/DailyTable';
import { PageSummaryTable, ProductSummaryTable } from './components/SummaryTables';
import WeeklyTable from './components/WeeklyTable';
import UnitEconomicsTable, { settingCellKey } from './components/UnitEconomicsTable';
import AddEntryForm from './components/AddEntryForm';

const SIGN = (n: number): string => (n > 0.005 ? '16,185,129' : n < -0.005 ? '239,68,68' : '107,114,128');

const selectStyle: React.CSSProperties = {
    height: 38, padding: '0 10px', borderRadius: 10, border: '1px solid var(--color-border)',
    background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: 13, maxWidth: 220,
};

const CpaTrackerView: React.FC<CpaViewProps> = ({ state, data, loading, refreshing, ready, error, missingTables, canEdit, isMobile, t, language, actions }) => {
    const { range, tab } = state;
    const result = useMemo(
        () => buildCpaTracker({ sales: data.sales, entries: data.entries, settings: data.settings, products: data.products, range, now: data.now }),
        [data.sales, data.entries, data.settings, data.products, range, data.now],
    );
    // Never editable on data that didn't load: after a failed load the arrays
    // are empty, and a save then would be built from nothing.
    const editable = canEdit && !missingTables && !loading && ready && !error;
    const today = dayKeyOf(data.now);
    const cells = useCellSaveState();
    const [adding, setAdding] = useState(false);
    // The add form is only usable while editing is: a range switch or a failed
    // load empties the data its overwrite guard relies on, so it closes.
    if (adding && !editable) setAdding(false);
    const [onlyAdvertised, setOnlyAdvertised] = useState(false);
    // Free-text search over product + page names (Khmer-safe, multi-term AND).
    // Local like the checkbox — an ephemeral refinement, not a shareable view.
    const [query, setQuery] = useState('');
    const terms = useMemo(() => searchTermsOf(query), [query]);

    // ── Filters (page / product from the URL; search + "only rows with spend"
    // local). One rule set scopes the Daily tracker AND the Summary tables.
    const filtered = state.page !== null || state.product !== null || onlyAdvertised || terms.length > 0;
    const filteredDays = useMemo<DayGroup[]>(() => {
        const keep = (r: DailyRow) =>
            (state.page === null || r.page === state.page) &&
            (state.product === null || r.productId === state.product) &&
            (!onlyAdvertised || r.spend > 0) &&
            (terms.length === 0 || matchesTerms(searchNorm(`${r.productName} ${r.page}`), terms));
        if (!filtered) return result.days;
        return result.days
            .map(g => { const rows = g.rows.filter(keep); return { date: g.date, rows, subtotal: sumMeasures(rows) }; })
            .filter(g => g.rows.length > 0);
    }, [result.days, state.page, state.product, onlyAdvertised, terms, filtered]);
    const filteredTotals = useMemo(() => (filtered ? sumMeasures(filteredDays.flatMap(g => g.rows)) : result.totals), [filtered, filteredDays, result.totals]);

    // Summary tables follow the same filters (e.g. page = CH Sound scopes the
    // product table to that page's products; a search narrows both).
    const summaryPages = useMemo(() => (filtered ? pageSummariesOf(filteredDays.flatMap(g => g.rows)) : result.pages), [filtered, filteredDays, result.pages]);
    const economicsMap = useMemo(() => new Map(result.economics.map(u => [u.productId, u])), [result.economics]);
    const summaryProducts = useMemo(() => (filtered ? productSummariesOf(filteredDays.flatMap(g => g.rows), economicsMap) : result.products), [filtered, filteredDays, economicsMap, result.products]);
    // Unit Economics is a catalogue, not range rows: only the search applies.
    const economicsShown = useMemo(
        () => (terms.length === 0 ? result.economics : result.economics.filter(u => matchesTerms(searchNorm(`${u.name} ${u.model}`), terms))),
        [result.economics, terms],
    );

    // A month is ~400 rows of editable cells; a year would be ~5,000. Render the
    // newest DAY_PAGE days and let the user ask for more (totals always cover
    // every day). Reset whenever the range or filters change.
    const DAY_PAGE = 31;
    const [shownDays, setShownDays] = useState(DAY_PAGE);
    const viewKey = `${range.from}|${range.to}|${state.page}|${state.product}|${onlyAdvertised}|${query}`;
    const [shownFor, setShownFor] = useState(viewKey);
    if (shownFor !== viewKey) { setShownFor(viewKey); setShownDays(DAY_PAGE); }
    const visibleDays = filteredDays.slice(0, shownDays);
    const hiddenDays = filteredDays.length - visibleDays.length;

    const pageOptions = useMemo(() => {
        const set = new Set<string>(data.configPages.map(p => String(p || '').trim()).filter(Boolean));
        result.pageOptions.forEach(p => set.add(p));
        // A filter from the URL that this period doesn't have still gets an
        // option, so the select shows it instead of silently "All pages".
        if (state.page !== null) set.add(state.page);
        return Array.from(set).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    }, [data.configPages, result.pageOptions, state.page]);
    const productOptions = useMemo(() => {
        const seen = new Map<string, string>();
        result.products.forEach(p => seen.set(p.productId, p.productName || t('cpaTracker.unknownProduct')));
        if (state.product !== null && !seen.has(state.product)) {
            const name = data.products.find(p => p.id === state.product)?.name;
            // Only claim "not in this period" once the period has actually loaded.
            seen.set(state.product, ready
                ? `${name || t('cpaTracker.unknownProduct')} (${t('cpaTracker.notInPeriod')})`
                : name || '…');
        }
        return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    }, [result.products, state.product, data.products, ready, t]);

    const commitEntry = (row: Pick<DailyRow, 'date' | 'page' | 'productId'>, field: EntryField, value: number | null) =>
        cells.run(entryCellKey(row, field), () => actions.onCommitEntry(row.date, row.page, row.productId, { [field]: value }));
    const commitSetting = (productId: string, field: SettingField, value: number | null) =>
        cells.run(settingCellKey(productId, field), () => actions.onCommitSetting(productId, field, value));

    // An "Add entry" for a row that already has spend would overwrite it —
    // the form refuses and points at the table instead.
    const existingSpendOf = (date: string, page: string, productId: string): number | null => {
        const key = entryKey(date, page, productId);
        for (const g of result.days) for (const r of g.rows) if (r.key === key && r.spend > 0) return r.spend;
        return null;
    };

    // ── KPI cards (follow the filters wherever the tables below do) ──────
    const m = tab === 'daily' || tab === 'summary' ? filteredTotals : result.totals;
    const kpis = (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6, minmax(0, 1fr))', gap: 8 }}>
            <KpiCard label={t('cpaTracker.kpi.spend')} value={fmtMoney(m.spend)} hint={`${t('cpaTracker.columns.grossCpa')} ${m.grossCpa === null ? '-' : fmtMoney(m.grossCpa)}`} rgb="245,158,11" icon={<Megaphone size={12} color="#F59E0B" />} />
            <KpiCard label={t('cpaTracker.kpi.delivered')} value={m.delivered.toLocaleString()} hint={fill(t('cpaTracker.kpi.deliveredHint'), { closed: m.closed, open: m.open, rate: fmtPct(m.deliveryRate) })} rgb="59,130,246" icon={<PackageCheck size={12} color="#3B82F6" />} />
            <KpiCard label={t('cpaTracker.kpi.revenue')} value={fmtMoney(m.revenue)} hint={`${t('cpaTracker.columns.hardCosts')} ${fmtMoney(m.hardCosts)}`} rgb="16,185,129" icon={<TrendingUp size={12} color="#10B981" />} />
            <KpiCard label={t('cpaTracker.kpi.netProfit')} value={fmtMoney(m.netProfit)} hint={`${t('cpaTracker.columns.margin')} ${fmtPct(m.margin)}`} rgb={SIGN(m.netProfit)} icon={<DollarSign size={12} color={`rgb(${SIGN(m.netProfit)})`} />} />
            <KpiCard label={t('cpaTracker.kpi.netCpa')} value={m.netCpa === null ? '-' : fmtMoney(m.netCpa)} hint={t('cpaTracker.kpi.netCpaHint')} rgb="139,92,246" icon={<Target size={12} color={ACCENT} />} />
            <KpiCard label={t('cpaTracker.kpi.costPerChat')} value={m.costPerChat === null ? '-' : fmtMoney(m.costPerChat)} hint={m.chatsEntered ? fill(t('cpaTracker.kpi.chatsHint'), { chats: m.chats, rate: fmtPct(m.closingRate) }) : t('cpaTracker.kpi.noChats')} rgb="236,72,153" icon={<MessageCircle size={12} color="#EC4899" />} />
        </div>
    );

    // ── Weekly headline (the workbook's Weekly Summary KPIs) ─────────────
    const latestWeek = [...result.weeks].reverse().find(w => w.closed > 0 || w.spend > 0) ?? null;
    const weeklyHeadline = (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            <KpiCard label={t('cpaTracker.weekly.latestProfit')} value={latestWeek ? fmtMoney(latestWeek.netProfit) : '-'}
                hint={latestWeek
                    ? `${fill(t('cpaTracker.weekLabel'), { n: latestWeek.isoWeek })}`
                    + (latestWeek.inProgress ? ` · ${t('cpaTracker.weekly.inProgress')}` : latestWeek.partial ? ` · ${t('cpaTracker.partialWeek')}` : '')
                    + (latestWeek.profitChange !== null ? ` · ${fmtPct(latestWeek.profitChange)} ${t('cpaTracker.weekly.wow')}` : '')
                    : undefined}
                rgb={SIGN(latestWeek?.netProfit ?? 0)} icon={<DollarSign size={12} color={`rgb(${SIGN(latestWeek?.netProfit ?? 0)})`} />} />
            <KpiCard label={t('cpaTracker.weekly.latestNetCpa')} value={latestWeek?.netCpa != null ? fmtMoney(latestWeek.netCpa) : '-'} hint={latestWeek ? `${t('cpaTracker.columns.deliveryRate')} ${fmtPct(latestWeek.deliveryRate)}` : undefined} rgb="139,92,246" icon={<Target size={12} color={ACCENT} />} />
            <KpiCard label={t('cpaTracker.weekly.cumulativeProfit')} value={fmtMoney(result.totals.netProfit)} hint={rangeLabel(range, language)} rgb={SIGN(result.totals.netProfit)} icon={<TrendingUp size={12} color={`rgb(${SIGN(result.totals.netProfit)})`} />} />
            <KpiCard label={t('cpaTracker.weekly.cumulativeDelivered')} value={result.totals.delivered.toLocaleString()} hint={rangeLabel(range, language)} rgb="59,130,246" icon={<PackageCheck size={12} color="#3B82F6" />} />
        </div>
    );

    const tabs = (
        <div role="tablist" aria-label={t('cpaTracker.title')} style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--color-background)', border: '1px solid var(--color-border)', overflowX: 'auto', maxWidth: '100%' }}>
            {CPA_TABS.map((k: CpaTab) => {
                const active = k === tab;
                return (
                    <button key={k} type="button" role="tab" aria-selected={active} onClick={() => actions.onStateChange({ tab: k })}
                        style={{ padding: '7px 12px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500, whiteSpace: 'nowrap', background: active ? 'var(--color-surface)' : 'transparent', color: active ? ACCENT : 'var(--color-text-secondary)', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
                        {t(`cpaTracker.tabs.${k}`)}
                    </button>
                );
            })}
        </div>
    );

    const tableSkeleton = (
        <div className="glass-panel" style={{ border: '1px solid var(--color-border)', borderRadius: 16, padding: 0, overflow: 'hidden' }}>
            <table className="spreadsheet-table" style={{ border: 'none' }}><tbody><SkeletonRows rows={8} cols={isMobile ? 4 : 10} /></tbody></table>
        </div>
    );

    const empty = (text: string) => (
        <div className="glass-panel" style={{ padding: 32, borderRadius: 16, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 14 }}>{text}</div>
    );

    // ── Filter bar pieces (search on daily / summary / unit; the selects and
    // the spend checkbox wherever range rows are shown: daily + summary) ────
    const searchBox = (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: isMobile ? '1 1 100%' : '0 1 230px', minWidth: 170 }}>
            <Search size={14} aria-hidden style={{ position: 'absolute', left: 10, color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
            <input
                type="search"
                className="d2-khmer"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('cpaTracker.searchPlaceholder')}
                aria-label={t('cpaTracker.searchPlaceholder')}
                style={{ ...selectStyle, maxWidth: 'none', width: '100%', padding: '0 30px', appearance: 'none', WebkitAppearance: 'none', outline: 'none' }}
            />
            {query !== '' && (
                <button type="button" onClick={() => setQuery('')} aria-label={t('cpaTracker.clearFilters')}
                    style={{ position: 'absolute', right: 6, display: 'flex', padding: 2, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                    <X size={14} />
                </button>
            )}
        </div>
    );
    const clearAll = () => { setOnlyAdvertised(false); setQuery(''); actions.onStateChange({ page: null, product: null }); };
    const filterControls = (
        <>
            <select aria-label={t('cpaTracker.filterPage')} style={selectStyle} value={state.page ?? '__all'} onChange={e => actions.onStateChange({ page: e.target.value === '__all' ? null : e.target.value })}>
                <option value="__all">{t('cpaTracker.allPages')}</option>
                {pageOptions.map(p => <option key={p || '__none'} value={p}>{p || t('cpaTracker.noPage')}</option>)}
            </select>
            <select aria-label={t('cpaTracker.filterProduct')} style={selectStyle} value={state.product ?? '__all'} onChange={e => actions.onStateChange({ product: e.target.value === '__all' ? null : e.target.value })}>
                <option value="__all">{t('cpaTracker.allProducts')}</option>
                {productOptions.map(p => <option key={p.id || '__unknown'} value={p.id}>{p.name}</option>)}
            </select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={onlyAdvertised} onChange={e => setOnlyAdvertised(e.target.checked)} />
                {t('cpaTracker.onlyAdvertised')}
            </label>
            {filtered && (
                <button type="button" className="pip-text-button" onClick={clearAll}>{t('cpaTracker.clearFilters')}</button>
            )}
        </>
    );

    // ── Tab bodies ───────────────────────────────────────────────────────
    const dailyBody = (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {searchBox}
                {filterControls}
                <div style={{ flex: 1 }} />
                {editable && !adding && (
                    <button type="button" className="pip-text-button" onClick={() => setAdding(true)} style={{ borderColor: ACCENT, color: ACCENT }}>
                        <Plus size={14} /> {t('cpaTracker.addEntry')}
                    </button>
                )}
            </div>
            {adding && editable && (
                <AddEntryForm
                    range={range}
                    today={today}
                    pageOptions={pageOptions}
                    products={data.products}
                    t={t}
                    existingSpendOf={existingSpendOf}
                    onCancel={() => setAdding(false)}
                    onSave={async e => {
                        // Spend and chats in ONE write: no half-saved row if the second part failed.
                        await cells.run(entryCellKey(e, 'adSpend'), () => actions.onCommitEntry(e.date, e.page, e.productId,
                            e.inboundChats === null ? { adSpend: e.adSpend } : { adSpend: e.adSpend, inboundChats: e.inboundChats }));
                        setAdding(false);
                    }}
                />
            )}
            {loading ? tableSkeleton
                : !ready ? null
                : filteredDays.length === 0 ? empty(filtered ? t('cpaTracker.noMatches') : t('cpaTracker.emptyPeriod'))
                    : (
                        <>
                            <DailyTable
                                days={visibleDays}
                                totals={filteredTotals}
                                editable={editable}
                                t={t}
                                language={language}
                                isMobile={isMobile}
                                savingKeys={cells.saving}
                                savedKeys={cells.saved}
                                onCommit={(row, field, value) => commitEntry(row, field, value)}
                                onOpenOrders={actions.onOpenOrders}
                            />
                            {hiddenDays > 0 && (
                                <button type="button" className="pip-text-button" style={{ alignSelf: 'center' }} onClick={() => setShownDays(n => n + DAY_PAGE)}>
                                    {fill(t('cpaTracker.showMoreDays'), { n: Math.min(DAY_PAGE, hiddenDays), left: hiddenDays })}
                                </button>
                            )}
                        </>
                    )}
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{t('cpaTracker.dailyFootnote')}</div>
        </>
    );

    const summaryBody = loading ? tableSkeleton : !ready ? null : (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {searchBox}
                {filterControls}
            </div>
            <PageSummaryTable rows={summaryPages} totals={filteredTotals} t={t} emptyText={filtered ? t('cpaTracker.noMatches') : undefined} onOpen={page => { setOnlyAdvertised(false); actions.onStateChange({ tab: 'daily', page, product: null }); }} />
            <ProductSummaryTable rows={summaryProducts} totals={filteredTotals} t={t} emptyText={filtered ? t('cpaTracker.noMatches') : undefined} onOpen={product => { setOnlyAdvertised(false); actions.onStateChange({ tab: 'daily', product, page: null }); }} />
        </>
    );

    const weeklyBody = loading ? tableSkeleton : !ready ? null : (
        <>
            {weeklyHeadline}
            <WeeklyTable
                weeks={result.weeks}
                totals={result.totals}
                t={t}
                language={language}
                // Drill into one week: the Daily Tracker scoped to exactly its
                // days, filters cleared (the prev/next arrows then step week
                // by week; Back returns here with the original range).
                onOpenWeek={w => { setOnlyAdvertised(false); actions.onStateChange({ tab: 'daily', range: { from: w.weekStart, to: w.weekEnd }, page: null, product: null }); }}
            />
        </>
    );

    const unitBody = loading ? tableSkeleton : !ready ? null : (
        <>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{t('cpaTracker.unitIntro')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {searchBox}
            </div>
            {terms.length > 0 && economicsShown.length === 0
                ? empty(t('cpaTracker.noMatches'))
                : (
                    <UnitEconomicsTable
                        rows={economicsShown}
                        defaults={result.defaults}
                        editable={editable}
                        t={t}
                        savingKeys={cells.saving}
                        savedKeys={cells.saved}
                        onCommit={commitSetting}
                    />
                )}
        </>
    );

    return (
        <div style={{ padding: isMobile ? 12 : '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(139, 92, 246, 0.35)', flexShrink: 0 }}>
                        <Target size={22} color="white" />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--color-text-main)' }}>{t('cpaTracker.title')}</h2>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, margin: '2px 0 0 0' }}>{rangeLabel(range, language)}</p>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                    <DateRangeControl
                        range={range}
                        now={data.now}
                        onChange={next => actions.onStateChange({ range: next })}
                        labels={{ prev: t('cpaTracker.prev'), next: t('cpaTracker.next'), tooLong: fill(t('incomeRange.tooLong'), { n: MAX_RANGE_DAYS }) }}
                        compact={isMobile}
                    />
                    <button type="button" className="pip-icon-button" onClick={actions.onRefresh} title={t('cpaTracker.refresh')} aria-label={t('cpaTracker.refresh')}>
                        <RefreshCw size={16} className={refreshing ? 'pip-spin' : undefined} />
                    </button>
                </div>
            </div>

            {tabs}

            {/* Banners */}
            {error && (
                <Banner tone="red" icon={<AlertCircle size={18} />} action={<button type="button" className="pip-text-button" onClick={error.retry}>{t('cpaTracker.retry')}</button>}>
                    {t('cpaTracker.loadError')} {error.message}
                </Banner>
            )}
            {missingTables && !loading && (
                <Banner tone="amber" icon={<AlertTriangle size={18} />}>{t('cpaTracker.missingTables')}</Banner>
            )}
            {!canEdit && !missingTables && (
                <Banner tone="grey" icon={<Lock size={16} />}>{t('cpaTracker.readOnly')}</Banner>
            )}
            {ready && !error && !missingTables && result.logisticsUnset && (
                <Banner tone="amber" icon={<Settings2 size={18} />}
                    action={tab !== 'unit' ? <button type="button" className="pip-text-button" onClick={() => actions.onStateChange({ tab: 'unit' })}>{t('cpaTracker.setCosts')}</button> : undefined}>
                    {t('cpaTracker.logisticsUnset')}
                </Banner>
            )}

            {kpis}
            {filtered && (tab === 'daily' || tab === 'summary') && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{t('cpaTracker.kpiFiltered')}</div>}

            {tab === 'daily' && dailyBody}
            {tab === 'summary' && summaryBody}
            {tab === 'weekly' && weeklyBody}
            {tab === 'unit' && unitBody}
        </div>
    );
};

export default CpaTrackerView;
