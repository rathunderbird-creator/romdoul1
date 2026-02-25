import React from 'react';
import { useHeader } from '../context/HeaderContext';
import { useStore } from '../context/StoreContext';
import { Bell, User, Menu, LogOut } from 'lucide-react';
import { useMobile } from '../hooks/useMobile';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
    isCollapsed: boolean;
    toggleSidebar?: () => void; // Pass toggle function
    isHidden?: boolean;
}

const Header: React.FC<HeaderProps> = ({ toggleSidebar, isHidden }) => {
    const { headerContent } = useHeader();
    const { currentUser, roles, logout } = useStore();
    const isMobile = useMobile();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    return (
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
            marginBottom: isMobile && isHidden ? (headerContent?.actions ? '-90px' : '-50px') : '0' // smooth content collapse
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

                    {/* Notification Bell */}
                    <button style={{
                        background: 'none',
                        color: 'var(--color-text-secondary)',
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '4px',
                        cursor: 'pointer',
                        border: 'none'
                    }}>
                        <Bell size={18} />
                        <span style={{
                            position: 'absolute',
                            top: 2,
                            right: 2,
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor: 'var(--color-primary)'
                        }}></span>
                    </button>

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
    );
};

export default Header;
