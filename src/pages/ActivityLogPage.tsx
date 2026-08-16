import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHeader } from '../context/HeaderContext';
import { useStore } from '../context/StoreContext';
import { useMobile } from '../hooks/useMobile';
import { supabase } from '../lib/supabase';
import { DateRangePicker } from '../components';
import {
    Bell, Truck, Package, DollarSign, ShieldCheck, UserPlus, ArrowDownCircle,
    ArrowUpCircle, RotateCcw, Settings, RefreshCw, Search, ChevronLeft,
    ChevronRight, History, CalendarDays, Activity, ExternalLink, X
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
    Orders: ['order_created', 'order_shipped', 'order_status', 'order_updated', 'order_deleted'],
    Stock: ['stock_in', 'stock_out', 'stock_restock'],
    Products: ['product_added', 'product_updated', 'product_deleted'],
    Money: ['transaction_added', 'transaction_deleted', 'payment_updated'],
    Users: ['user_login'],
    System: ['settings_updated', 'permission_changed'],
};

const CATEGORIES = ['All', ...Object.keys(CATEGORY_ACTIONS)];

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
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return '';
};

// "Today" / "Yesterday" / "Tue, 12 Aug 2026" — used for the day separators.
const dayLabel = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now.getTime() - 86400000);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};

// Old -> new change details logged with order edits (remark / tracking).
const MetadataDetails: React.FC<{ log: ActivityLogRow }> = ({ log }) => {
    const m = log.metadata;
    if (!m || Object.keys(m).length === 0) return null;
    const parts: React.ReactNode[] = [];
    if (m.oldRemark !== undefined && m.newRemark !== undefined) {
        parts.push(
            <span key="remark">
                <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{m.oldRemark || 'None'}</span>
                {' → '}
                <span style={{ fontWeight: 600 }}>{m.newRemark || 'None'}</span>
            </span>
        );
    }
    if (m.oldTracking !== undefined && m.newTracking !== undefined) {
        parts.push(
            <span key="tracking">
                <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{m.oldTracking || 'None'}</span>
                {' → '}
                <span style={{ fontWeight: 600 }}>{m.newTracking || 'None'}</span>
            </span>
        );
    }
    if (m.remark && m.newRemark === undefined) parts.push(<span key="r">{m.remark}</span>);
    if (m.trackingNumber && m.newTracking === undefined) parts.push(<span key="t">{m.trackingNumber}</span>);
    if (m.status) parts.push(<span key="s" style={{ fontWeight: 600 }}>{m.status}</span>);
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

    const [logs, setLogs] = useState<ActivityLogRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [totalCount, setTotalCount] = useState(0);
    const [statToday, setStatToday] = useState(0);
    const [statWeek, setStatWeek] = useState(0);

    const [searchTerm, setSearchTerm] = useState('');
    const [category, setCategory] = useState('All');
    const [userFilter, setUserFilter] = useState('All');
    const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(100);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: isMobile ? '8px' : 0 }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Activity Log</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Who did what, and when</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, isMobile]);

    // Reset to page 1 whenever a filter changes.
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, category, userFilter, dateRange, pageSize]);

    // silent = background refresh: no spinner, the list just updates in place.
    const fetchLogs = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            let query = supabase.from('activity_logs').select('*', { count: 'exact' });

            if (category !== 'All') {
                query = query.in('action', CATEGORY_ACTIONS[category] || []);
            }
            if (userFilter !== 'All') {
                query = query.eq('user_name', userFilter);
            }
            if (dateRange.start) {
                const start = new Date(dateRange.start);
                start.setHours(0, 0, 0, 0);
                query = query.gte('created_at', start.toISOString());
            }
            if (dateRange.end) {
                const end = new Date(dateRange.end);
                end.setHours(23, 59, 59, 999);
                query = query.lte('created_at', end.toISOString());
            }
            const term = searchTerm.trim();
            if (term) {
                const esc = term.replace(/[%(),]/g, '');
                if (esc) query = query.or(`description.ilike.%${esc}%,user_name.ilike.%${esc}%`);
            }

            const from = (currentPage - 1) * pageSize;
            const { data, count, error } = await query
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
    }, [searchTerm, category, userFilter, dateRange, currentPage, pageSize]);

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
        { label: 'Today', active: isRange(todayYMD, todayYMD), onClick: () => setDateRange({ start: todayYMD, end: todayYMD }) },
        { label: 'Yesterday', active: isRange(yesterdayYMD, yesterdayYMD), onClick: () => setDateRange({ start: yesterdayYMD, end: yesterdayYMD }) },
        { label: '7 Days', active: isRange(weekAgoYMD, todayYMD), onClick: () => setDateRange({ start: weekAgoYMD, end: todayYMD }) },
    ];

    const activeFilterCount =
        (searchTerm.trim() ? 1 : 0) +
        (category !== 'All' ? 1 : 0) +
        (userFilter !== 'All' ? 1 : 0) +
        ((dateRange.start || dateRange.end) ? 1 : 0);

    const clearFilters = () => {
        setSearchTerm('');
        setCategory('All');
        setUserFilter('All');
        setDateRange({ start: '', end: '' });
    };

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const userNames = ['All', ...Array.from(new Set(users.map(u => u.name))).sort()];

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
    }, [logs]);

    const orderIdOf = (log: ActivityLogRow): string | null => {
        const oid = log.metadata?.orderId;
        return typeof oid === 'string' && oid.length > 0 ? oid : null;
    };

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
        ACTION_META[action] || { icon: <Bell size={14} />, color: '#6B7280', label: action || 'Activity' };

    const viewOrderButton = (orderId: string) => (
        <button
            onClick={() => navigate(`/orders/${orderId}`)}
            title="Open this order"
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
                {statCard('Today', statToday, 'linear-gradient(135deg, #3B82F6, #2563EB)', <Activity size={19} />)}
                {statCard('Last 7 Days', statWeek, 'linear-gradient(135deg, #8B5CF6, #7C3AED)', <CalendarDays size={19} />)}
                {statCard('Matching Filter', totalCount, 'linear-gradient(135deg, #10B981, #059669)', <History size={19} />)}
            </div>

            {/* Filters */}
            <div className="glass-panel" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', borderRadius: '14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: isMobile ? '100%' : '220px' }}>
                        <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input
                            type="text"
                            placeholder="Search description or user..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ width: '100%', padding: '9px 10px 9px 32px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text-main)' }}
                        />
                    </div>
                    <select
                        value={userFilter}
                        onChange={(e) => setUserFilter(e.target.value)}
                        style={{ padding: '9px 10px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text-main)', cursor: 'pointer', maxWidth: isMobile ? '48%' : '180px' }}
                    >
                        {userNames.map(n => <option key={n} value={n}>{n === 'All' ? 'All Users' : n}</option>)}
                    </select>
                    <div style={{ minWidth: isMobile ? '48%' : '220px' }}>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>
                    <button
                        onClick={() => { fetchLogs(); fetchStats(); }}
                        title="Refresh"
                        style={{ width: '38px', height: '38px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                    >
                        <RefreshCw size={16} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
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
                                {cat}
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
                            <X size={13} /> Clear ({activeFilterCount})
                        </button>
                    )}
                </div>
            </div>

            {/* Log list */}
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
                {isLoading && logs.length === 0 ? (
                    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading activity…
                    </div>
                ) : logs.length === 0 ? (
                    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                        No activity found for these filters.
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
                                    const oid = orderIdOf(log);
                                    return (
                                        <div key={log.id} style={{ display: 'flex', gap: '10px', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', borderLeft: `4px solid ${meta.color}` }}>
                                            <div style={{ width: '30px', height: '30px', borderRadius: '8px', backgroundColor: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px', color: meta.color }}>
                                                {meta.icon}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: '13px', color: 'var(--color-text-main)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                                                    {log.description}
                                                </div>
                                                <MetadataDetails log={log} />
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', fontSize: '11px', color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
                                                    <span style={{ fontWeight: 600 }}>{log.user_name}</span>
                                                    <span>·</span>
                                                    <span>{formatTime(log.created_at)}</span>
                                                    {timeAgo(log.created_at) && <span style={{ opacity: 0.8 }}>({timeAgo(log.created_at)})</span>}
                                                    {oid && viewOrderButton(oid)}
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
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {groupedLogs.map(group => (
                                    <React.Fragment key={group.label}>
                                        <tr>
                                            <td colSpan={6} style={daySeparatorStyle}>
                                                {group.label} <span style={{ opacity: 0.6, fontWeight: 600 }}>· {group.items.length} {group.items.length === 1 ? 'entry' : 'entries'}</span>
                                            </td>
                                        </tr>
                                        {group.items.map((log, idx) => {
                                            const meta = actionMeta(log.action);
                                            const oid = orderIdOf(log);
                                            const ago = timeAgo(log.created_at);
                                            return (
                                                <tr key={log.id} style={{ background: idx % 2 === 1 ? 'var(--color-bg)' : 'transparent' }}>
                                                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                                                        {formatTime(log.created_at)}
                                                        {ago && <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--color-text-muted)' }}>({ago})</span>}
                                                    </td>
                                                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>
                                                        {log.user_name}
                                                    </td>
                                                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border)' }}>
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, background: `${meta.color}1A`, color: meta.color }}>
                                                            {meta.icon} {meta.label}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', maxWidth: '440px' }}>
                                                        {log.description}
                                                    </td>
                                                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border)' }}>
                                                        {oid ? viewOrderButton(oid) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
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
                        Showing {Math.min((currentPage - 1) * pageSize + 1, totalCount)}–{Math.min(currentPage * pageSize, totalCount)} of {totalCount.toLocaleString()}
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
                            Page <span style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>{currentPage}</span> of {totalPages}
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
