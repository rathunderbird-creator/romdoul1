import React from 'react';
import { useHeader } from '../context/HeaderContext';
import { Bell, User } from 'lucide-react';

interface HeaderProps {
    isCollapsed: boolean;
}

const Header: React.FC<HeaderProps> = ({ isCollapsed }) => {
    const { headerContent } = useHeader();

    return (
        <header style={{
            height: 'var(--header-height)',
            position: 'fixed',
            top: 0,
            left: isCollapsed ? '80px' : 'var(--sidebar-width)',
            right: 0,
            backgroundColor: 'var(--color-surface)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            zIndex: 90,
            transition: 'left 0.3s ease'
        }}>
            {/* Left: Dynamic Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flex: 1 }}>
                {headerContent?.title}
            </div>

            {/* Center: Date, Bell, User */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '24px',
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)'
            }}>
                {/* Date Display */}
                <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                    {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>

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
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}>Admin User</div>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Store Manager</div>
                    </div>
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
            </div>

            {/* Right: Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', justifyContent: 'flex-end', flex: 1 }}>
                {headerContent?.actions}
            </div>
        </header>
    );
};

export default Header;
