import React, { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Store, Globe, Bell, Shield, Database } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useHeader } from '../../context/HeaderContext';

const SettingsLayout: React.FC = () => {
    const { t } = useLanguage();
    const { setHeaderContent } = useHeader();
    const location = useLocation();

    // Default header (subpages will override this, but good to have a fallback during transitions)
    useEffect(() => {
        setHeaderContent({
            title: (
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{t('settings.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '14px' }}>{t('settings.subtitle')}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    const navItems = [
        { path: '/settings/store-profile', icon: Store, label: t('settings.storeProfile') },
        { path: '/settings/general', icon: Globe, label: 'General' },
        { path: '/settings/telegram', icon: Bell, label: 'Telegram' },
        { path: '/settings/security', icon: Shield, label: t('settings.security') },
        { path: '/settings/database', icon: Database, label: 'Database' }
    ];

    return (
        <div style={{ display: 'flex', gap: '24px', height: '100%', alignItems: 'flex-start' }}>
            {/* Sidebar Navigation */}
            <div className="glass-panel" style={{ width: '250px', padding: '16px', flexShrink: 0 }}>
                <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname.startsWith(item.path);
                        return (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    textDecoration: 'none',
                                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-main)',
                                    backgroundColor: isActive ? 'var(--color-primary-bg)' : 'transparent',
                                    fontWeight: isActive ? 600 : 500,
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <Icon size={20} color={isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)'} />
                                <span>{item.label}</span>
                            </NavLink>
                        );
                    })}
                </nav>
            </div>

            {/* Main Content Area */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <Outlet />
            </div>
        </div>
    );
};

export default SettingsLayout;
