import React from 'react';
import ReactDOM from 'react-dom';
import { useHeader } from '../context/HeaderContext';
import { useStore } from '../context/StoreContext';
import { useActivityLog } from '../context/ActivityLogContext';
import { Bell, User, Menu, LogOut, RefreshCw, Package, Truck, DollarSign, ShieldCheck, UserPlus, ArrowDownCircle, ArrowUpCircle, RotateCcw, Settings, X } from 'lucide-react';
import { useMobile } from '../hooks/useMobile';
import { useNavigate } from 'react-router-dom';
import { useClickOutside } from '../hooks/useClickOutside';

interface HeaderProps {
    isCollapsed: boolean;
    toggleSidebar?: () => void;
    isHidden?: boolean;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
    order_created: <Truck size={14} style={{ color: '#3B82F6' }} />,
    order_shipped: <Truck size={14} style={{ color: '#10B981' }} />,
    order_status: <Truck size={14} style={{ color: '#F59E0B' }} />,
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
                    <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Activity Log</h3>
                    <p style={{ margin: 0, fontSize: '11px', color: 'var(--color-text-muted)' }}>
                        Recent actions across the system
                    </p>
                </div>
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

            {/* Log List */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '4px 0',
            }}>
                {isLoading && logs.length === 0 ? (
                    <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                        Loading activity...
                    </div>
                ) : logs.length === 0 ? (
                    <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                        No recent activity
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
        <header style={{
            height: isMobile ? 'auto' : 'var(--header-height)',
            minHeight: 'var(--header-height)',
            backgroundColor: 'var(--color-surface)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid var(--color-border)',
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
                        <button onClick={toggleSidebar} className="icon-button">
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
                            color: 'var(--color-text-secondary)',
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
                                color: isOpen ? 'var(--color-primary)' : 'var(--color-text-secondary)',
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
                                    {currentUser?.name || 'Guest'}
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
                            backgroundColor: 'var(--color-surface-hover)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--color-primary)'
                        }}>
                            <User size={16} />
                        </div>
                    </div>

                    {/* Logout Button */}
                    <button
                        onClick={handleLogout}
                        title="Logout"
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--color-text-secondary)',
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
                    borderTop: '1px solid var(--color-border)',
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
        </>
    );
};

export default Header;
