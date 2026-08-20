import React from 'react';
import ReactDOM from 'react-dom';
import { useHeader } from '../context/HeaderContext';
import { useStore } from '../context/StoreContext';
import { useActivityLog } from '../context/ActivityLogContext';
import { Bell, User, Menu, LogOut, RefreshCw, Package, Truck, DollarSign, ShieldCheck, UserPlus, ArrowDownCircle, ArrowUpCircle, RotateCcw, Settings, X, ClipboardList, CheckCircle2, Circle, ExternalLink, Plus, Calculator } from 'lucide-react';
import { supabase } from '../lib/supabase';
import CalculatorDrawer from './CalculatorDrawer';
import { useMobile } from '../hooks/useMobile';
import { useNavigate } from 'react-router-dom';
import { useClickOutside } from '../hooks/useClickOutside';
import { useLanguage } from '../context/LanguageContext';

interface HeaderProps {
    isCollapsed: boolean;
    toggleSidebar?: () => void;
    isHidden?: boolean;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
    order_created: <Truck size={14} style={{ color: '#3B82F6' }} />,
    order_shipped: <Truck size={14} style={{ color: '#10B981' }} />,
    order_status: <Truck size={14} style={{ color: '#F59E0B' }} />,
    order_updated: <Truck size={14} style={{ color: '#F59E0B' }} />,
    order_deleted: <Truck size={14} style={{ color: '#EF4444' }} />,
    stock_in: <ArrowDownCircle size={14} style={{ color: '#10B981' }} />,
    stock_out: <ArrowUpCircle size={14} style={{ color: '#F59E0B' }} />,
    stock_restock: <RotateCcw size={14} style={{ color: '#8B5CF6' }} />,
    product_added: <Package size={14} style={{ color: '#3B82F6' }} />,
    product_updated: <Package size={14} style={{ color: '#F59E0B' }} />,
    product_deleted: <Package size={14} style={{ color: '#EF4444' }} />,
    transaction_added: <DollarSign size={14} style={{ color: '#10B981' }} />,
    transaction_deleted: <DollarSign size={14} style={{ color: '#EF4444' }} />,
    payment_updated: <DollarSign size={14} style={{ color: '#F59E0B' }} />,
    user_login: <UserPlus size={14} style={{ color: '#06B6D4' }} />,
    settings_updated: <Settings size={14} style={{ color: '#6B7280' }} />,
    permission_changed: <ShieldCheck size={14} style={{ color: '#8B5CF6' }} />,
};

const getTimeAgo = (dateStr: string): string => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const Header: React.FC<HeaderProps> = ({ toggleSidebar, isHidden }) => {
    const { headerContent } = useHeader();
    const { currentUser, roles, logout, refreshData } = useStore();
    const { logs, unreadCount, isOpen, togglePanel, closePanel, markAllRead, isLoading } = useActivityLog();
    const isMobile = useMobile();
    const navigate = useNavigate();
    const { t } = useLanguage();
    const [isRefreshing, setIsRefreshing] = React.useState(false);

    const panelRef = useClickOutside<HTMLDivElement>(() => {
        if (isOpen) closePanel();
    });

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await refreshData(false);
        } catch (error) {
            console.error('Refresh failed:', error);
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleBellClick = () => {
        togglePanel();
        if (!isOpen) {
            // Opening the panel - mark as read
            markAllRead();
        }
    };

    // --- Today's Tasks drawer (right-side popup fed by the Todo page's table) ---
    interface HeaderTodo {
        id: string;
        title: string;
        due_date: string | null;
        status: string;
        remind_at: string | null;
        priority: number;
        updated_at: string;
        created_at: string;
    }
    const [isTasksOpen, setIsTasksOpen] = React.useState(false);
    const [isCalcOpen, setIsCalcOpen] = React.useState(false);
    const [tasks, setTasks] = React.useState<HeaderTodo[]>([]);
    const [tasksLoading, setTasksLoading] = React.useState(false);
    const [openTaskCount, setOpenTaskCount] = React.useState(0);

    const localYMD = (d: Date) => d.toLocaleDateString('en-CA');

    const fetchTasks = React.useCallback(async () => {
        if (!currentUser) return;
        setTasksLoading(true);
        try {
            const { data, error } = await supabase.from('todos')
                .select('id, title, due_date, status, remind_at, priority, updated_at, created_at')
                .eq('user_id', currentUser.id)
                .order('priority', { ascending: true })
                .order('created_at', { ascending: false });
            if (error) throw error;
            const today = localYMD(new Date());
            // Same rules as the Todo page's "Today" view: open tasks due today or
            // overdue (or undated ones created today); completed tasks only if
            // they were finished today or were due today.
            const isTodayTask = (t: HeaderTodo) => {
                if (t.status === 'completed') {
                    const completedToday = t.updated_at && localYMD(new Date(t.updated_at)) === today;
                    return completedToday || t.due_date === today || (!t.due_date && localYMD(new Date(t.created_at)) === today);
                }
                return (!!t.due_date && t.due_date <= today) || (!t.due_date && localYMD(new Date(t.created_at)) === today);
            };
            const list = ((data || []) as HeaderTodo[]).filter(isTodayTask);
            list.sort((a, b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0));
            setTasks(list);
            setOpenTaskCount(list.filter(t => t.status !== 'completed').length);
        } catch (e) {
            console.error('Failed to fetch today\'s tasks:', e);
        } finally {
            setTasksLoading(false);
        }
    }, [currentUser]);

    // Badge count on load (and when the user changes).
    React.useEffect(() => { fetchTasks(); }, [fetchTasks]);

    const toggleTask = async (t: HeaderTodo) => {
        const newStatus = t.status === 'completed' ? 'open' : 'completed';
        const now = new Date().toISOString();
        setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: newStatus, updated_at: now } : x));
        setOpenTaskCount(prev => Math.max(0, prev + (newStatus === 'completed' ? -1 : 1)));
        const { error } = await supabase.from('todos')
            .update({ status: newStatus, updated_at: now })
            .eq('id', t.id)
            .eq('user_id', currentUser?.id);
        if (error) {
            console.error('Failed to toggle task:', error);
            fetchTasks();
        }
    };

    // Quick-add from the drawer: new open task due today (same shape the
    // Todo page inserts — unfiled, default priority).
    const [newTaskTitle, setNewTaskTitle] = React.useState('');
    const [isAddingTask, setIsAddingTask] = React.useState(false);

    const addTask = async () => {
        const title = newTaskTitle.trim();
        if (!title || !currentUser || isAddingTask) return;
        setIsAddingTask(true);
        try {
            const { data, error } = await supabase.from('todos').insert([{
                title,
                priority: 4,
                status: 'open',
                due_date: localYMD(new Date()),
                user_id: currentUser.id,
                repeat_rule: null,
                remind_at: null,
                last_reminded_on: null,
                updated_at: new Date().toISOString()
            }]).select('id, title, due_date, status, remind_at, priority, updated_at, created_at').single();
            if (error) throw error;
            if (data) {
                setTasks(prev => [data as HeaderTodo, ...prev]);
                setOpenTaskCount(prev => prev + 1);
            }
            setNewTaskTitle('');
        } catch (e: any) {
            console.error('Failed to add task:', e);
            alert('Failed to add task: ' + (e?.message || 'unknown error'));
        } finally {
            setIsAddingTask(false);
        }
    };

    const renderActivityLogContent = () => (
        <>
            {/* Panel Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderBottom: '1px solid var(--color-border)',
            }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>{t('header.activityLog')}</h3>
                    <p style={{ margin: 0, fontSize: '11px', color: 'var(--color-text-muted)' }}>
                        {t('header.recentActions')}
                    </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                        onClick={() => { closePanel(); navigate('/activity-log'); }}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--color-primary)', fontSize: '12px', fontWeight: 600, padding: '4px'
                        }}
                    >
                        View all
                    </button>
                    <button
                        onClick={closePanel}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--color-text-muted)', display: 'flex', padding: '4px'
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Log List */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '4px 0',
            }}>
                {isLoading && logs.length === 0 ? (
                    <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                        {t('header.loadingActivity')}
                    </div>
                ) : logs.length === 0 ? (
                    <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                        {t('header.noRecentActivity')}
                    </div>
                ) : (
                    logs.map((log) => (
                        <div
                            key={log.id}
                            style={{
                                display: 'flex',
                                gap: '10px',
                                padding: '10px 16px',
                                borderBottom: '1px solid var(--color-border)',
                                cursor: 'default',
                            }}
                        >
                            {/* Icon */}
                            <div style={{
                                width: '28px', height: '28px', borderRadius: '8px',
                                backgroundColor: 'var(--color-bg)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0, marginTop: '2px',
                            }}>
                                {ACTION_ICONS[log.action] || <Bell size={14} style={{ color: 'var(--color-text-muted)' }} />}
                            </div>

                            {/* Content */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: '12px',
                                    color: 'var(--color-text-main)',
                                    lineHeight: 1.4,
                                    wordBreak: 'break-word',
                                }}>
                                    {log.description}
                                </div>
                                {log.action === 'order_updated' && log.metadata && (
                                    <div style={{
                                        marginTop: '4px',
                                        padding: '6px 8px',
                                        backgroundColor: 'var(--color-bg)',
                                        borderRadius: '4px',
                                        borderLeft: '2px solid var(--color-primary)',
                                        fontSize: '11px',
                                        color: 'var(--color-text-secondary)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '2px'
                                    }}>
                                        {log.metadata.oldRemark !== undefined && log.metadata.newRemark !== undefined && (
                                            <div><span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{log.metadata.oldRemark || 'None'}</span> → <span style={{ fontWeight: 500, color: 'var(--color-text-main)' }}>{log.metadata.newRemark || 'None'}</span></div>
                                        )}
                                        {log.metadata.oldTracking !== undefined && log.metadata.newTracking !== undefined && (
                                            <div><span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{log.metadata.oldTracking || 'None'}</span> → <span style={{ fontWeight: 500, color: 'var(--color-text-main)' }}>{log.metadata.newTracking || 'None'}</span></div>
                                        )}
                                        {log.metadata.remark && log.metadata.newRemark === undefined && (
                                            <div><span style={{ fontWeight: 500, color: 'var(--color-text-main)' }}>{log.metadata.remark}</span></div>
                                        )}
                                        {log.metadata.trackingNumber && log.metadata.newTracking === undefined && (
                                            <div><span style={{ fontWeight: 500, color: 'var(--color-text-main)' }}>{log.metadata.trackingNumber}</span></div>
                                        )}
                                    </div>
                                )}
                                <div style={{
                                    display: 'flex',
                                    gap: '8px',
                                    marginTop: '3px',
                                    fontSize: '10px',
                                    color: 'var(--color-text-muted)',
                                }}>
                                    <span>{log.user_name}</span>
                                    <span>·</span>
                                    <span>{getTimeAgo(log.created_at)}</span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </>
    );

    return (
        <>
        <header className={isMobile ? 'header-mobile-dark' : undefined} style={{
            height: isMobile ? 'auto' : 'var(--header-height)',
            minHeight: 'var(--header-height)',
            backgroundColor: isMobile ? '#000000' : 'var(--color-surface)',
            backdropFilter: 'blur(10px)',
            borderBottom: isMobile ? '1px solid #1F2937' : '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'center',
            justifyContent: 'space-between',
            padding: isMobile ? '8px 12px' : '0 24px',
            zIndex: 90,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            gap: isMobile ? '8px' : '0',
            width: '100%',
            flexShrink: 0,
            position: isMobile ? 'sticky' : 'static',
            top: 0,
            transform: isMobile && isHidden ? 'translateY(-100%)' : 'translateY(0)',
            opacity: isMobile && isHidden ? 0 : 1,
            pointerEvents: isMobile && isHidden ? 'none' : 'auto',
            marginBottom: isMobile && isHidden ? (headerContent?.actions ? '-90px' : '-50px') : '0'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                {/* Left: Menu Toggle & Title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '12px' : '24px', flex: 1 }}>
                    {isMobile && toggleSidebar && (
                        <button onClick={toggleSidebar} className="icon-button" style={{ color: '#F9FAFB' }}>
                            <Menu size={20} />
                        </button>
                    )}
                    {headerContent?.title}
                </div>

                {/* Right: Date, Profile & Bell */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {/* Date (Hidden on Mobile) */}
                    {!isMobile && (
                        <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px', marginRight: '8px' }}>
                            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </div>
                    )}

                    {/* Refresh Button */}
                    <button
                        onClick={handleRefresh}
                        title="Refresh Data"
                        className="hover-opacity"
                        style={{
                            background: 'none',
                            color: isMobile ? '#D1D5DB' : 'var(--color-text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '4px',
                            cursor: 'pointer',
                            border: 'none',
                        }}
                    >
                        <RefreshCw size={18} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
                    </button>

                    {/* Notification Bell */}
                    <div style={{ position: 'relative' }} ref={panelRef}>
                        <button
                            onClick={handleBellClick}
                            style={{
                                background: 'none',
                                color: isOpen ? 'var(--color-primary)' : (isMobile ? '#D1D5DB' : 'var(--color-text-secondary)'),
                                position: 'relative',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '4px',
                                cursor: 'pointer',
                                border: 'none'
                            }}
                        >
                            <Bell size={18} />
                            {unreadCount > 0 && (
                                <span style={{
                                    position: 'absolute',
                                    top: 0,
                                    right: -2,
                                    minWidth: '16px',
                                    height: '16px',
                                    borderRadius: '8px',
                                    backgroundColor: '#EF4444',
                                    color: 'white',
                                    fontSize: '9px',
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '0 4px',
                                    lineHeight: 1,
                                }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
                            )}
                        </button>
                    </div>

                    {/* Activity Log Panel - Desktop: inline dropdown, Mobile: portal overlay */}
                    {isOpen && !isMobile && (
                        <div style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: '8px',
                            width: '380px',
                            maxHeight: '480px',
                            backgroundColor: 'var(--color-surface)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '12px',
                            boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
                            display: 'flex',
                            flexDirection: 'column',
                            zIndex: 200,
                            overflow: 'hidden',
                        }}>
                            {renderActivityLogContent()}
                        </div>
                    )}

                    {/* User Profile */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {!isMobile && (
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                                    {currentUser?.name || t('header.guest')}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                                    {currentUser?.roleId ? (roles?.find(r => r.id === currentUser.roleId)?.name || currentUser.roleId) : ''}
                                </div>
                            </div>
                        )}
                        <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            backgroundColor: isMobile ? '#1F2937' : 'var(--color-surface-hover)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--color-primary)'
                        }}>
                            <User size={16} />
                        </div>
                    </div>

                    {/* Calculator */}
                    <button
                        onClick={() => { setIsTasksOpen(false); setIsCalcOpen(true); }}
                        title="Calculator"
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: isMobile ? '#D1D5DB' : 'var(--color-text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '4px'
                        }}
                    >
                        <Calculator size={18} />
                    </button>

                    {/* Today's Tasks */}
                    <button
                        onClick={() => { setIsCalcOpen(false); setIsTasksOpen(true); fetchTasks(); }}
                        title="Today's Tasks"
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: isMobile ? '#D1D5DB' : 'var(--color-text-secondary)',
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '4px'
                        }}
                    >
                        <ClipboardList size={18} />
                        {openTaskCount > 0 && (
                            <span style={{
                                position: 'absolute',
                                top: -2,
                                right: -4,
                                minWidth: '16px',
                                height: '16px',
                                borderRadius: '8px',
                                backgroundColor: '#F59E0B',
                                color: 'white',
                                fontSize: '9px',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '0 4px',
                                lineHeight: 1,
                            }}>{openTaskCount > 9 ? '9+' : openTaskCount}</span>
                        )}
                    </button>

                    {/* Logout Button */}
                    <button
                        onClick={handleLogout}
                        title="Logout"
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: isMobile ? '#D1D5DB' : 'var(--color-text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '4px',
                            marginLeft: '4px'
                        }}
                        className="hover-danger"
                    >
                        <LogOut size={18} />
                    </button>
                </div>
            </div>

            {/* Center: Actions (Hidden on Mobile, Moved from Right) */}
            {!isMobile && headerContent?.actions && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)'
                }}>
                    {headerContent.actions}
                </div>
            )}

            {/* Actions Row (Bottom on Mobile Only) */}
            {isMobile && headerContent?.actions && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    justifyContent: 'flex-start',
                    width: '100%',
                    borderTop: '1px solid #1F2937',
                    paddingTop: '8px',
                    overflowX: 'auto'
                }}>
                    {headerContent.actions}
                </div>
            )}
        </header>

            {/* Mobile Activity Log Portal */}
            {isOpen && isMobile && ReactDOM.createPortal(
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                }}>
                    {/* Backdrop */}
                    <div
                        onClick={closePanel}
                        style={{
                            position: 'absolute',
                            inset: 0,
                            backgroundColor: 'rgba(0,0,0,0.5)',
                        }}
                    />
                    {/* Panel */}
                    <div style={{
                        position: 'relative',
                        marginTop: '56px',
                        flex: 1,
                        backgroundColor: 'var(--color-surface)',
                        borderTopLeftRadius: '16px',
                        borderTopRightRadius: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
                    }}>
                        {renderActivityLogContent()}
                    </div>
                </div>,
                document.body
            )}

            {/* Today's Tasks — right-side drawer */}
            {ReactDOM.createPortal(
                <>
                    {isTasksOpen && (
                        <div onClick={() => setIsTasksOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1198 }} />
                    )}
                    <div style={{
                        position: 'fixed', top: 0, right: 0, bottom: 0,
                        width: isMobile ? '85%' : '360px', maxWidth: '360px', zIndex: 1199,
                        display: 'flex', flexDirection: 'column',
                        background: 'var(--color-surface)',
                        transform: isTasksOpen ? 'translateX(0)' : 'translateX(105%)',
                        transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                        boxShadow: '-8px 0 30px rgba(0,0,0,0.18)',
                        borderRadius: '16px 0 0 16px',
                    }}>
                        {/* Drawer header */}
                        <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #F59E0B, #D97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                    <ClipboardList size={18} />
                                </div>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Today's Tasks</h3>
                                    <p style={{ margin: 0, fontSize: '11px', color: 'var(--color-text-muted)' }}>
                                        {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })} · {openTaskCount} open
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setIsTasksOpen(false)} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={18} />
                            </button>
                        </div>

                        {/* Quick add */}
                        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '8px' }}>
                            <input
                                type="text"
                                placeholder="Add a task for today…"
                                value={newTaskTitle}
                                onChange={(e) => setNewTaskTitle(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
                                style={{ flex: 1, padding: '9px 12px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text-main)', outline: 'none' }}
                            />
                            <button
                                onClick={addTask}
                                disabled={!newTaskTitle.trim() || isAddingTask}
                                title="Add Task"
                                style={{
                                    width: '38px', height: '38px', borderRadius: '10px', border: 'none', flexShrink: 0,
                                    background: newTaskTitle.trim() && !isAddingTask ? 'linear-gradient(135deg, #F59E0B, #D97706)' : 'var(--color-bg)',
                                    color: newTaskTitle.trim() && !isAddingTask ? 'white' : 'var(--color-text-muted)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: newTaskTitle.trim() && !isAddingTask ? 'pointer' : 'not-allowed',
                                    transition: 'all 0.15s'
                                }}
                            >
                                <Plus size={18} />
                            </button>
                        </div>

                        {/* Task list */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
                            {tasksLoading && tasks.length === 0 ? (
                                <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                                    Loading tasks…
                                </div>
                            ) : tasks.length === 0 ? (
                                <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                                    🎉 No tasks for today
                                </div>
                            ) : (
                                tasks.map(t => {
                                    const done = t.status === 'completed';
                                    const today = localYMD(new Date());
                                    const overdue = !done && !!t.due_date && t.due_date < today;
                                    return (
                                        <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--color-border)' }}>
                                            <button
                                                onClick={() => toggleTask(t)}
                                                title={done ? 'Mark as open' : 'Mark as done'}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: '1px', color: done ? '#10B981' : 'var(--color-text-muted)', display: 'flex', flexShrink: 0 }}
                                            >
                                                {done ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                                            </button>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: '13px', fontWeight: 500, color: done ? 'var(--color-text-muted)' : 'var(--color-text-main)', textDecoration: done ? 'line-through' : 'none', wordBreak: 'break-word', lineHeight: 1.4 }}>
                                                    {t.title}
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', marginTop: '3px', fontSize: '11px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                    {overdue ? (
                                                        <span style={{ color: '#DC2626', fontWeight: 700 }}>Overdue · {t.due_date}</span>
                                                    ) : t.due_date ? (
                                                        <span style={{ color: 'var(--color-text-muted)' }}>{t.due_date === today ? 'Today' : t.due_date}</span>
                                                    ) : null}
                                                    {t.remind_at && <span style={{ color: 'var(--color-text-muted)' }}>⏰ {t.remind_at}</span>}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* Footer */}
                        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)' }}>
                            <button
                                onClick={() => { setIsTasksOpen(false); navigate('/todo'); }}
                                className="primary-button"
                                style={{ width: '100%', padding: '11px', borderRadius: '10px', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                            >
                                <ExternalLink size={15} /> Open Todo
                            </button>
                        </div>
                    </div>
                </>,
                document.body
            )}

            {/* Calculator — right-side drawer */}
            <CalculatorDrawer isOpen={isCalcOpen} onClose={() => setIsCalcOpen(false)} isMobile={isMobile} />
        </>
    );
};

export default Header;
