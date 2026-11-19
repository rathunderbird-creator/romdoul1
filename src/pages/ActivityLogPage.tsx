import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useHeader } from '../context/HeaderContext';
import { useStore } from '../context/StoreContext';
import { useMobile } from '../hooks/useMobile';
import { supabase } from '../lib/supabase';
import { DateRangePicker } from '../components';
import { useLanguage } from '../context/LanguageContext';
import { tNow, fill } from '../i18n/translate';
import {
    Bell, Truck, Package, DollarSign, ShieldCheck, UserPlus, ArrowDownCircle,
    ArrowUpCircle, RotateCcw, Settings, RefreshCw, Search, ChevronLeft,
    ChevronRight, History, CalendarDays, Activity, ExternalLink, X, Download, EyeOff, Eye
} from 'lucide-react';

interface ActivityLogRow {
    id: string;
    action: string;
    description: string;
    user_id: string;
    user_name: string;
    metadata: Record<string, any>;
    created_at: string;
}

// Icon + color per action (same visual language as the header bell panel).
const ACTION_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    order_created: { icon: <Truck size={14} />, color: '#3B82F6', label: 'Order Created' },
    order_shipped: { icon: <Truck size={14} />, color: '#10B981', label: 'Order Shipped' },
    order_status: { icon: <Truck size={14} />, color: '#F59E0B', label: 'Order Status' },
    order_updated: { icon: <Truck size={14} />, color: '#F59E0B', label: 'Order Updated' },
    order_deleted: { icon: <Truck size={14} />, color: '#EF4444', label: 'Order Deleted' },
    order_restored: { icon: <RotateCcw size={14} />, color: '#10B981', label: 'Order Restored' },
    // Written by Orders Management 2 (its own action names).
    order_update: { icon: <Truck size={14} />, color: '#F59E0B', label: 'Order Updated' },
    bulk_ship: { icon: <Truck size={14} />, color: '#10B981', label: 'Bulk Ship' },
    bulk_tracking: { icon: <Truck size={14} />, color: '#3B82F6', label: 'Bulk Tracking' },
    bulk_edit: { icon: <Truck size={14} />, color: '#F59E0B', label: 'Bulk Edit' },
    stock_in: { icon: <ArrowDownCircle size={14} />, color: '#10B981', label: 'Stock In' },
    stock_out: { icon: <ArrowUpCircle size={14} />, color: '#F59E0B', label: 'Stock Out' },
    stock_restock: { icon: <RotateCcw size={14} />, color: '#8B5CF6', label: 'Restock' },
    product_added: { icon: <Package size={14} />, color: '#3B82F6', label: 'Product Added' },
    product_updated: { icon: <Package size={14} />, color: '#F59E0B', label: 'Product Updated' },
    product_deleted: { icon: <Package size={14} />, color: '#EF4444', label: 'Product Deleted' },
    transaction_added: { icon: <DollarSign size={14} />, color: '#10B981', label: 'Transaction Added' },
    transaction_deleted: { icon: <DollarSign size={14} />, color: '#EF4444', label: 'Transaction Deleted' },
    payment_updated: { icon: <DollarSign size={14} />, color: '#F59E0B', label: 'Payment Updated' },
    user_login: { icon: <UserPlus size={14} />, color: '#06B6D4', label: 'User Login' },
    settings_updated: { icon: <Settings size={14} />, color: '#6B7280', label: 'Settings Updated' },
    permission_changed: { icon: <ShieldCheck size={14} />, color: '#8B5CF6', label: 'Permission Changed' },
};

const CATEGORY_ACTIONS: Record<string, string[]> = {
    Orders: ['order_created', 'order_shipped', 'order_status', 'order_updated', 'order_deleted', 'order_restored', 'order_update', 'bulk_ship', 'bulk_tracking', 'bulk_edit'],
    Stock: ['stock_in', 'stock_out', 'stock_restock'],
    Products: ['product_added', 'product_updated', 'product_deleted'],
    Money: ['transaction_added', 'transaction_deleted', 'payment_updated'],
    Users: ['user_login'],
    System: ['settings_updated', 'permission_changed'],
};

const CATEGORIES = ['All', ...Object.keys(CATEGORY_ACTIONS)];

const categoryOf = (action: string): string | null =>
    Object.keys(CATEGORY_ACTIONS).find(c => CATEGORY_ACTIONS[c].includes(action)) || null;

// "some_new_action" -> "Some New Action" for actions this page doesn't know yet.
const humanize = (action: string) =>
    action.split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

const fullTimestamp = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

// Every order this entry points at: a single orderId, Orders Management 2's
// { edit: { orderId } }, or a restock's orderIds list.
const orderIdsOf = (log: ActivityLogRow): string[] => {
    const m = log.metadata || {};
    const ids: string[] = [];
    if (typeof m.orderId === 'string' && m.orderId) ids.push(m.orderId);
    if (typeof m.edit?.orderId === 'string' && m.edit.orderId) ids.push(m.edit.orderId);
    if (Array.isArray(m.orderIds)) for (const id of m.orderIds) if (typeof id === 'string' && id) ids.push(id);
    return Array.from(new Set(ids));
};

// The filter builder supabase.from(...).select(...) returns (its filters return `this`).
type LogQuery = ReturnType<ReturnType<typeof supabase.from>['select']>;

const HIDE_LOGINS_KEY = 'activity_log_hide_logins';
const readHideLogins = () => {
    try { return localStorage.getItem(HIDE_LOGINS_KEY) === '1'; } catch { return false; }
};

const toYMD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const formatTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const timeAgo = (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return tNow('ui.admin.activity.justNow');
    if (min < 60) return tNow('ui.admin.activity.minAgo', { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return tNow('ui.admin.activity.hrAgo', { n: hr });
    return '';
};

// "Today" / "Yesterday" / "Tue, 12 Aug 2026" — used for the day separators.
const dayLabel = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return tNow('ui.admin.activity.today');
    const yesterday = new Date(now.getTime() - 86400000);
    if (d.toDateString() === yesterday.toDateString()) return tNow('ui.admin.activity.yesterday');
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};

// Old -> new change details logged with order edits (remark / tracking).
const MetadataDetails: React.FC<{ log: ActivityLogRow }> = ({ log }) => {
    const { t } = useLanguage();
    const none = t('ui.admin.activity.none');
    const m = log.metadata;
    if (!m || Object.keys(m).length === 0) return null;
    const parts: React.ReactNode[] = [];
    if (m.oldRemark !== undefined && m.newRemark !== undefined) {
        parts.push(
            <span key="remark">
                <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{m.oldRemark || none}</span>
                {' → '}
                <span style={{ fontWeight: 600 }}>{m.newRemark || none}</span>
            </span>
        );
    }
    if (m.oldTracking !== undefined && m.newTracking !== undefined) {
        parts.push(
            <span key="tracking">
                <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{m.oldTracking || none}</span>
                {' → '}
                <span style={{ fontWeight: 600 }}>{m.newTracking || none}</span>
            </span>
        );
    }
    if (m.remark && m.newRemark === undefined) parts.push(<span key="r">{m.remark}</span>);
    if (m.trackingNumber && m.newTracking === undefined) parts.push(<span key="t">{m.trackingNumber}</span>);
    if (m.status) parts.push(<span key="s" style={{ fontWeight: 600 }}>{m.status}</span>);
    // Bulk edits: which field was set, and to what.
    if (m.field !== undefined) {
        parts.push(
            <span key="f">
                {String(m.field)}{m.value !== undefined && <>: <span style={{ fontWeight: 600 }}>{typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value) || none}</span></>}
            </span>
        );
    }
    // Orders Management 2 edits: the fields the drawer changed.
    if (m.edit && typeof m.edit === 'object') {
        const changed = Object.entries(m.edit)
            .filter(([k, v]) => k !== 'orderId' && k !== 'expectedShippingStatus' && v !== undefined && v !== null && typeof v !== 'object')
            .map(([k, v]) => `${k}: ${v}`);
        if (changed.length) parts.push(<span key="e">{changed.join(' · ')}</span>);
    }
    if (parts.length === 0) return null;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
            {parts}
        </div>
    );
};

const ActivityLogPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { users } = useStore();
    const isMobile = useMobile();
    const navigate = useNavigate();
    const { t } = useLanguage();

    const [logs, setLogs] = useState<ActivityLogRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [totalCount, setTotalCount] = useState(0);
    const [statToday, setStatToday] = useState(0);
    const [statWeek, setStatWeek] = useState(0);

    // Filters live in the URL, so opening an order and pressing Back returns
    // to the same filtered view, and a filtered view can be shared as a link.
    const [searchParams, setSearchParams] = useSearchParams();
    const searchTerm = searchParams.get('q') || '';
    const category = CATEGORIES.includes(searchParams.get('cat') || '') ? searchParams.get('cat')! : 'All';
    const userFilter = searchParams.get('user') || 'All';
    const dateRange = useMemo(
        () => ({ start: searchParams.get('from') || '', end: searchParams.get('to') || '' }),
        [searchParams]
    );
    const currentPage = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = [50, 100, 200, 500].includes(Number(searchParams.get('size'))) ? Number(searchParams.get('size')) : 100;

    // Any filter change goes back to page 1; replace keeps Back meaningful.
    const setParams = useCallback((changes: Record<string, string | null>, keepPage = false) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            for (const [k, v] of Object.entries(changes)) {
                if (v === null || v === '' || v === 'All') next.delete(k); else next.set(k, v);
            }
            if (!keepPage) next.delete('page');
            return next;
        }, { replace: true });
    }, [setSearchParams]);
    const setCategory = (c: string) => setParams({ cat: c });
    const setUserFilter = (u: string) => setParams({ user: u });
    const setDateRange = (r: { start: string; end: string }) => setParams({ from: r.start, to: r.end });
    const setPageSize = (n: number) => setParams({ size: n === 100 ? null : String(n) });
    const setCurrentPage = (fn: (p: number) => number) => setParams({ page: String(fn(currentPage)) }, true);

    // Typing updates the box at once; the query waits for a 350ms pause.
    const [searchInput, setSearchInput] = useState(searchTerm);
    useEffect(() => { setSearchInput(searchTerm); }, [searchTerm]);
    useEffect(() => {
        if (searchInput === searchTerm) return;
        const h = setTimeout(() => setParams({ q: searchInput.trim() }), 350);
        return () => clearTimeout(h);
    }, [searchInput, searchTerm, setParams]);

    const [hideLogins, setHideLogins] = useState(readHideLogins);
    const toggleHideLogins = () => {
        setHideLogins(prev => {
            try { localStorage.setItem(HIDE_LOGINS_KEY, prev ? '0' : '1'); } catch { /* private mode */ }
            return !prev;
        });
    };
    const [isExporting, setIsExporting] = useState(false);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: isMobile ? '8px' : 0 }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('nav.activityLog')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('ui.admin.activity.subtitle')}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, isMobile, t]);

    // The same filters for the list and for the CSV export.
    const applyFilters = useCallback((query: LogQuery): LogQuery => {
        if (category !== 'All') {
            query = query.in('action', CATEGORY_ACTIONS[category] || []);
        } else if (hideLogins) {
            query = query.neq('action', 'user_login');
        }
        if (userFilter !== 'All') {
            query = query.eq('user_name', userFilter);
        }
        if (dateRange.start) {
            // YYYY-MM-DD + T00:00 parses as LOCAL midnight (a bare date is UTC).
            const start = new Date(`${dateRange.start}T00:00:00`);
            query = query.gte('created_at', start.toISOString());
        }
        if (dateRange.end) {
            const end = new Date(`${dateRange.end}T23:59:59.999`);
            query = query.lte('created_at', end.toISOString());
        }
        // "#a1b2c3d4" finds the order: descriptions carry the short id.
        const esc = searchTerm.trim().replace(/^#/, '').replace(/[%(),*]/g, '');
        if (esc) query = query.or(`description.ilike.%${esc}%,user_name.ilike.%${esc}%,action.ilike.%${esc}%`);
        return query;
    }, [searchTerm, category, userFilter, dateRange, hideLogins]);

    // silent = background refresh: no spinner, the list just updates in place.
    const fetchLogs = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const from = (currentPage - 1) * pageSize;
            const { data, count, error } = await applyFilters(supabase.from('activity_logs').select('*', { count: 'exact' }))
                .order('created_at', { ascending: false })
                .range(from, from + pageSize - 1);
            if (error) throw error;
            setLogs((data || []) as ActivityLogRow[]);
            setTotalCount(count || 0);
        } catch (err) {
            console.error('Failed to fetch activity logs:', err);
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [applyFilters, currentPage, pageSize]);

    // CSV of everything matching the filters (not just this page), in 1000-row
    // pages since that is the most one Supabase request returns.
    const exportCsv = async () => {
        setIsExporting(true);
        try {
            const rows: ActivityLogRow[] = [];
            const CHUNK = 1000;
            const MAX = 20000;
            for (let from = 0; from < MAX; from += CHUNK) {
                const { data, error } = await applyFilters(supabase.from('activity_logs').select('*'))
                    .order('created_at', { ascending: false })
                    .range(from, from + CHUNK - 1);
                if (error) throw error;
                rows.push(...((data || []) as ActivityLogRow[]));
                if (!data || data.length < CHUNK) break;
            }
            const cell = (v: unknown) => {
                const s = v === null || v === undefined ? '' : String(v);
                return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            };
            const header = ['Date', 'Time', 'User', 'Action', 'Description', 'Orders', 'Details'];
            const lines = rows.map(r => {
                const d = new Date(r.created_at);
                return [
                    toYMD(d),
                    d.toLocaleTimeString('en-GB'),
                    r.user_name,
                    ACTION_META[r.action]?.label || humanize(r.action || ''),
                    r.description,
                    orderIdsOf(r).join(' '),
                    r.metadata && Object.keys(r.metadata).length ? JSON.stringify(r.metadata) : '',
                ].map(cell).join(',');
            });
            const csv = [header.join(','), ...lines].join('\r\n');
            // BOM so Excel opens the Khmer text as UTF-8.
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `activity_log_${toYMD(new Date())}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Failed to export activity logs:', err);
            alert(t('ui.admin.activity.exportFailed'));
        } finally {
            setIsExporting(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    // Keep the page live: silently refresh every 60s with the current filters.
    useEffect(() => {
        const interval = setInterval(() => fetchLogs(true), 60000);
        return () => clearInterval(interval);
    }, [fetchLogs]);

    // Stat cards: today / last 7 days (count-only queries, independent of filters).
    const fetchStats = useCallback(async () => {
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const weekStart = new Date(Date.now() - 7 * 86400000);
            const [todayRes, weekRes] = await Promise.all([
                supabase.from('activity_logs').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
                supabase.from('activity_logs').select('id', { count: 'exact', head: true }).gte('created_at', weekStart.toISOString()),
            ]);
            setStatToday(todayRes.count || 0);
            setStatWeek(weekRes.count || 0);
        } catch (err) {
            console.error('Failed to fetch activity stats:', err);
        }
    }, []);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    // --- Quick date chips ---
    const todayYMD = toYMD(new Date());
    const yesterdayYMD = toYMD(new Date(Date.now() - 86400000));
    const weekAgoYMD = toYMD(new Date(Date.now() - 6 * 86400000));
    const isRange = (start: string, end: string) => dateRange.start === start && dateRange.end === end;
    const quickChips: { label: string; active: boolean; onClick: () => void }[] = [
        { label: t('ui.admin.activity.today'), active: isRange(todayYMD, todayYMD), onClick: () => setDateRange({ start: todayYMD, end: todayYMD }) },
        { label: t('ui.admin.activity.yesterday'), active: isRange(yesterdayYMD, yesterdayYMD), onClick: () => setDateRange({ start: yesterdayYMD, end: yesterdayYMD }) },
        { label: t('ui.admin.activity.sevenDays'), active: isRange(weekAgoYMD, todayYMD), onClick: () => setDateRange({ start: weekAgoYMD, end: todayYMD }) },
    ];

    const activeFilterCount =
        (searchTerm.trim() ? 1 : 0) +
        (category !== 'All' ? 1 : 0) +
        (userFilter !== 'All' ? 1 : 0) +
        ((dateRange.start || dateRange.end) ? 1 : 0);

    const clearFilters = () => {
        setSearchInput('');
        setParams({ q: null, cat: null, user: null, from: null, to: null });
    };

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    // Log names can outlive the user list (System, removed staff): keep the
    // active one selectable so the dropdown never shows the wrong value.
    const userNames = ['All', ...Array.from(new Set([
        ...users.map(u => u.name),
        ...(userFilter !== 'All' ? [userFilter] : []),
    ])).sort()];

    // Group the loaded page by day for separator rows.
    const groupedLogs = useMemo(() => {
        const groups: { label: string; items: ActivityLogRow[] }[] = [];
        for (const log of logs) {
            const label = dayLabel(log.created_at);
            const last = groups[groups.length - 1];
            if (last && last.label === label) last.items.push(log);
            else groups.push({ label, items: [log] });
        }
        return groups;
        // t: the day labels follow a language switch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [logs, t]);


    const statCard = (label: string, value: number, gradient: string, icon: React.ReactNode) => (
        <div style={{
            flex: 1, minWidth: isMobile ? '100px' : '160px', background: 'var(--color-surface)',
            border: '1px solid var(--color-border)', borderRadius: '14px', padding: isMobile ? '12px' : '16px',
            display: 'flex', alignItems: 'center', gap: '12px'
        }}>
            <div style={{
                width: '40px', height: '40px', borderRadius: '10px', background: gradient,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0
            }}>
                {icon}
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-text-main)' }}>{value.toLocaleString()}</div>
            </div>
        </div>
    );

    const actionMeta = (action: string) =>
        ACTION_META[action] ? { ...ACTION_META[action], label: t(`ui.admin.activity.actions.${action}`) } : { icon: <Bell size={14} />, color: '#6B7280', label: action ? humanize(action) : t('ui.admin.activity.activity') };

    // Click a name: show only that person's activity (click again to undo).
    const userButton = (name: string) => (
        <button
            onClick={() => setUserFilter(userFilter === name ? 'All' : name)}
            title={userFilter === name ? t('ui.admin.activity.showAllUsers') : fill(t('ui.admin.activity.onlyUser'), { name })}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: 'inherit', cursor: 'pointer', textDecoration: userFilter === name ? 'underline' : 'none' }}
        >
            {name}
        </button>
    );

    // Click an action badge: narrow to that action's category.
    const actionBadge = (action: string) => {
        const meta = actionMeta(action);
        const cat = categoryOf(action);
        return (
            <button
                onClick={() => cat && setCategory(category === cat ? 'All' : cat)}
                disabled={!cat}
                title={cat ? fill(t('ui.admin.activity.onlyCategory'), { cat: t(`ui.admin.activity.categories.${cat}`) }) : undefined}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, background: `${meta.color}1A`, color: meta.color, border: 'none', cursor: cat ? 'pointer' : 'default' }}
            >
                {meta.icon} {meta.label}
            </button>
        );
    };

    // Up to 3 order links, then "+N" (a restock can cover many orders).
    const orderLinks = (log: ActivityLogRow) => {
        const ids = orderIdsOf(log);
        if (ids.length === 0) return null;
        return (
            <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                {ids.slice(0, 3).map(viewOrderButton)}
                {ids.length > 3 && (
                    <span title={ids.slice(3).map(id => '#' + id.slice(0, 8)).join(', ')} style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                        +{ids.length - 3}
                    </span>
                )}
            </span>
        );
    };

    const viewOrderButton = (orderId: string) => (
        <button
            key={orderId}
            onClick={() => navigate(`/orders/${orderId}`)}
            title={t('ui.admin.activity.openOrder')}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px',
                borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                color: 'var(--color-primary)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'
            }}
        >
            <ExternalLink size={11} /> #{orderId.slice(0, 8)}
        </button>
    );

    const daySeparatorStyle: React.CSSProperties = {
        padding: '7px 12px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.8px', color: 'var(--color-text-secondary)', background: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border)', borderTop: '1px solid var(--color-border)'
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Stat cards */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {statCard(t('ui.admin.activity.today'), statToday, 'linear-gradient(135deg, #3B82F6, #2563EB)', <Activity size={19} />)}
                {statCard(t('ui.admin.activity.last7Days'), statWeek, 'linear-gradient(135deg, #8B5CF6, #7C3AED)', <CalendarDays size={19} />)}
                {statCard(t('ui.admin.activity.matchingFilter'), totalCount, 'linear-gradient(135deg, #10B981, #059669)', <History size={19} />)}
            </div>

            {/* Filters */}
            <div className="glass-panel" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', borderRadius: '14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: isMobile ? '100%' : '220px' }}>
                        <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input
                            type="text"
                            placeholder={t('ui.admin.activity.searchPlaceholder')}
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setSearchInput(''); }}
                            style={{ width: '100%', padding: '9px 10px 9px 32px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text-main)' }}
                        />
                    </div>
                    <select
                        value={userFilter}
                        onChange={(e) => setUserFilter(e.target.value)}
                        style={{ padding: '9px 10px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text-main)', cursor: 'pointer', maxWidth: isMobile ? '48%' : '180px' }}
                    >
                        {userNames.map(n => <option key={n} value={n}>{n === 'All' ? t('ui.admin.activity.allUsers') : n}</option>)}
                    </select>
                    <div style={{ minWidth: isMobile ? '48%' : '220px' }}>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>
                    <button
                        onClick={() => { fetchLogs(); fetchStats(); }}
                        title={t('ui.admin.activity.refresh')}
                        style={{ width: '38px', height: '38px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                    >
                        <RefreshCw size={16} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                    <button
                        onClick={exportCsv}
                        disabled={isExporting || totalCount === 0}
                        title={t('ui.admin.activity.exportTitle')}
                        style={{ height: '38px', padding: '0 12px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, cursor: isExporting || totalCount === 0 ? 'not-allowed' : 'pointer', opacity: totalCount === 0 ? 0.5 : 1, flexShrink: 0 }}
                    >
                        {isExporting ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={15} />}
                        {!isMobile && t('ui.admin.activity.export')}
                    </button>
                </div>
                {/* Category pills + quick dates + clear */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {CATEGORIES.map(cat => {
                        const active = category === cat;
                        return (
                            <button
                                key={cat}
                                onClick={() => setCategory(cat)}
                                style={{
                                    padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 600,
                                    border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                    background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                                    color: active ? 'white' : 'var(--color-text-main)', cursor: 'pointer', transition: 'all 0.15s'
                                }}
                            >
                                {cat === 'All' ? t('common.all') : t(`ui.admin.activity.categories.${cat}`)}
                            </button>
                        );
                    })}
                    <div style={{ width: '1px', height: '18px', background: 'var(--color-border)', margin: '0 4px' }} />
                    {quickChips.map(chip => (
                        <button
                            key={chip.label}
                            onClick={chip.onClick}
                            style={{
                                padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 600,
                                border: `1px solid ${chip.active ? '#7C3AED' : 'var(--color-border)'}`,
                                background: chip.active ? '#7C3AED' : 'var(--color-surface)',
                                color: chip.active ? 'white' : 'var(--color-text-main)', cursor: 'pointer', transition: 'all 0.15s'
                            }}
                        >
                            {chip.label}
                        </button>
                    ))}
                    {category === 'All' && (
                        <>
                            <div style={{ width: '1px', height: '18px', background: 'var(--color-border)', margin: '0 4px' }} />
                            <button
                                onClick={toggleHideLogins}
                                title={t('ui.admin.activity.hideLoginsTitle')}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                                    padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 600,
                                    border: `1px solid ${hideLogins ? '#0891B2' : 'var(--color-border)'}`,
                                    background: hideLogins ? '#0891B2' : 'var(--color-surface)',
                                    color: hideLogins ? 'white' : 'var(--color-text-main)', cursor: 'pointer', transition: 'all 0.15s'
                                }}
                            >
                                {hideLogins ? <EyeOff size={13} /> : <Eye size={13} />} {t('ui.admin.activity.hideLogins')}
                            </button>
                        </>
                    )}
                    {activeFilterCount > 0 && (
                        <button
                            onClick={clearFilters}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 700,
                                border: '1px solid #DC2626', background: '#DC2626', color: 'white',
                                cursor: 'pointer', marginLeft: 'auto'
                            }}
                        >
                            <X size={13} /> {fill(t('ui.admin.activity.clear'), { n: activeFilterCount })}
                        </button>
                    )}
                </div>
            </div>

            {/* Log list */}
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
                {isLoading && logs.length === 0 ? (
                    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> {t('ui.admin.activity.loading')}
                    </div>
                ) : logs.length === 0 ? (
                    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                        {t('ui.admin.activity.empty')}
                    </div>
                ) : isMobile ? (
                    // Mobile: flat inbox-style rows, grouped by day
                    <div>
                        {groupedLogs.map(group => (
                            <React.Fragment key={group.label}>
                                <div style={{ ...daySeparatorStyle, position: 'sticky', top: 0, zIndex: 5 }}>
                                    {group.label} <span style={{ opacity: 0.6, fontWeight: 600 }}>· {group.items.length}</span>
                                </div>
                                {group.items.map(log => {
                                    const meta = actionMeta(log.action);
                                    return (
                                        <div key={log.id} style={{ display: 'flex', gap: '10px', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', borderLeft: `4px solid ${meta.color}` }}>
                                            <div style={{ width: '30px', height: '30px', borderRadius: '8px', backgroundColor: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px', color: meta.color }}>
                                                {meta.icon}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ marginBottom: '3px' }}>{actionBadge(log.action)}</div>
                                                <div style={{ fontSize: '13px', color: 'var(--color-text-main)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                                                    {log.description}
                                                </div>
                                                <MetadataDetails log={log} />
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', fontSize: '11px', color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
                                                    {userButton(log.user_name)}
                                                    <span>·</span>
                                                    <span title={fullTimestamp(log.created_at)}>{formatTime(log.created_at)}</span>
                                                    {timeAgo(log.created_at) && <span style={{ opacity: 0.8 }}>({timeAgo(log.created_at)})</span>}
                                                    {orderLinks(log)}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </div>
                ) : (
                    // Desktop: compact table, grouped by day
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ background: 'var(--color-bg)' }}>
                                    {['Time', 'User', 'Action', 'Description', 'Order', 'Details'].map(h => (
                                        <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                                            {t(`ui.admin.activity.columns.${h}`)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {groupedLogs.map(group => (
                                    <React.Fragment key={group.label}>
                                        <tr>
                                            <td colSpan={6} style={daySeparatorStyle}>
                                                {group.label} <span style={{ opacity: 0.6, fontWeight: 600 }}>· {fill(group.items.length === 1 ? t('ui.admin.activity.entryOne') : t('ui.admin.activity.entryMany'), { n: group.items.length })}</span>
                                            </td>
                                        </tr>
                                        {group.items.map((log, idx) => {
                                            const ago = timeAgo(log.created_at);
                                            const links = orderLinks(log);
                                            return (
                                                <tr key={log.id} style={{ background: idx % 2 === 1 ? 'var(--color-bg)' : 'transparent' }}>
                                                    <td title={fullTimestamp(log.created_at)} style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                                                        {formatTime(log.created_at)}
                                                        {ago && <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--color-text-muted)' }}>({ago})</span>}
                                                    </td>
                                                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>
                                                        {userButton(log.user_name)}
                                                    </td>
                                                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border)' }}>
                                                        {actionBadge(log.action)}
                                                    </td>
                                                    <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', minWidth: '280px', maxWidth: '520px' }}>
                                                        {log.description}
                                                    </td>
                                                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border)' }}>
                                                        {links || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                                                    </td>
                                                    <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                                                        <MetadataDetails log={log} />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Pagination */}
            {totalCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', paddingBottom: isMobile ? '24px' : 0 }}>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                        {fill(t('ui.admin.activity.showing'), { from: Math.min((currentPage - 1) * pageSize + 1, totalCount), to: Math.min(currentPage * pageSize, totalCount), total: totalCount.toLocaleString() })}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                            style={{ padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '13px', cursor: 'pointer' }}
                        >
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value={200}>200</option>
                            <option value={500}>500</option>
                        </select>
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            style={{ padding: '7px', borderRadius: '8px', border: '1px solid var(--color-border)', background: currentPage === 1 ? 'var(--color-bg)' : 'var(--color-surface)', color: currentPage === 1 ? 'var(--color-text-muted)' : 'var(--color-text-main)', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', display: 'flex' }}
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                            {t('ui.admin.activity.page')} <span style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>{currentPage}</span> {fill(t('ui.admin.activity.ofPages'), { n: totalPages })}
                        </span>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage >= totalPages}
                            style={{ padding: '7px', borderRadius: '8px', border: '1px solid var(--color-border)', background: currentPage >= totalPages ? 'var(--color-bg)' : 'var(--color-surface)', color: currentPage >= totalPages ? 'var(--color-text-muted)' : 'var(--color-text-main)', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer', display: 'flex' }}
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ActivityLogPage;
