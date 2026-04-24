import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Package, Settings, Truck, Users, X, Wallet, Phone, MapPin, PieChart, CalendarClock, ChevronDown } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useLanguage } from '../context/LanguageContext';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

interface SidebarProps {
    isCollapsed: boolean;
    toggleSidebar: () => void;
    isMobile: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, toggleSidebar, isMobile }) => {
    const { hasPermission, currentUser, logo } = useStore();
    const { t, language, setLanguage } = useLanguage();


    // ... (rest of the hook logic is same)
    // Determine if user has access to management features
    const canManageUsers = hasPermission('manage_users');
    const canManageSettings = hasPermission('manage_settings');

    const location = useLocation();
    const navigate = useNavigate();
    
    // Define navItems before hooks that depend on it
    const navItems: any[] = [];

    if (hasPermission('view_dashboard')) {
        navItems.push({ icon: LayoutDashboard, label: t('nav.dashboard'), path: '/' });
    }

    if (hasPermission('manage_orders') || hasPermission('create_orders') || hasPermission('view_orders')) {
        navItems.push({ 
            icon: Truck, 
            label: t('nav.orders'), 
            path: '/orders'
        });
    }

    if (hasPermission('manage_inventory') || hasPermission('view_inventory_stock')) {
        navItems.push({ 
            icon: Package, 
            label: t('nav.inventory'), 
            path: '/inventory',
            subItems: [
                { label: t('nav.allProducts'), path: '/inventory' },
                { label: t('nav.stockIn'), path: '/inventory/stock-in' },
                { label: t('nav.stockOut'), path: '/inventory/stock-out' },
                { label: t('nav.returnsRestocks'), path: '/inventory/returns' }
            ]
        });
    }

    if (hasPermission('manage_income_expense')) {
        navItems.push({ 
            icon: Wallet, 
            label: t('nav.incomeExpense'), 
            path: '/income-expense',
            subItems: [
                { label: t('nav.allTransactions'), path: '/income-expense' },
                { label: t('nav.income'), path: '/income-expense/income' },
                { label: t('nav.expense'), path: '/income-expense/expense' },
                { label: t('nav.revenue'), path: '/income-expense/revenue' }
            ]
        });
    }

    if (hasPermission('view_reports')) {
        navItems.push({ 
            icon: PieChart, 
            label: t('nav.reportsCenter'), 
            path: '/reports',
            subItems: [
                { label: t('nav.salesOverview'), path: '/reports/sales' },
                { label: t('nav.topProducts'), path: '/reports/products' },
                { label: t('nav.inventory'), path: '/reports/inventory' },
                { label: t('nav.financials'), path: '/reports/financials' },
                { label: t('nav.staffPerformance'), path: '/reports/staff' },
                { label: t('nav.shippingCompanies'), path: '/reports/shipping' },
            ]
        });
    }

    if (hasPermission('view_dashboard')) {
        navItems.push({ icon: Phone, label: t('nav.mobileOperators'), path: '/mobile-operators' });
        navItems.push({ icon: MapPin, label: t('nav.shippingPoint'), path: '/shipping-point' });
    }

    if (hasPermission('manage_attendance')) {
        navItems.push({ icon: CalendarClock, label: t('nav.attendance'), path: '/attendance' });
    }

    const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>(() => {
        const initialExpanded: Record<string, boolean> = {};
        navItems.forEach(item => {
            if (item.subItems) {
                const isParentActive = item.subItems.some((sub: any) => location.pathname === sub.path || location.pathname.startsWith(sub.path + '/'));
                if (isParentActive) {
                    initialExpanded[item.label] = true;
                }
            }
        });
        return initialExpanded;
    });

    useEffect(() => {
        navItems.forEach(item => {
            if (item.subItems) {
                const isParentActive = item.subItems.some((sub: any) => location.pathname === sub.path || location.pathname.startsWith(sub.path + '/'));
                if (isParentActive) {
                    setExpandedMenus(prev => {
                        if (!prev[item.label]) {
                            return { ...prev, [item.label]: true };
                        }
                        return prev;
                    });
                }
            }
        });
    }, [location.pathname]);

    // Mobile Logic:
    // isCollapsed = true -> Hidden
    // isCollapsed = false -> Overlay Open

    const [isHovered, setIsHovered] = useState(false);
    const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const visualCollapsed = isCollapsed && !isHovered;

    const sidebarWidth = isMobile ? '280px' : (visualCollapsed ? '80px' : 'var(--sidebar-width)');
    const transform = isMobile ? (isCollapsed ? 'translateX(-100%)' : 'translateX(0)') : 'none';
    const backdropVisible = isMobile && !isCollapsed;

    return (
        <>
            {/* Mobile Backdrop */}
            {backdropVisible && (
                <div
                    onClick={toggleSidebar}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        zIndex: 99,
                    }}
                />
            )}

            <aside 
                onMouseEnter={() => {
                    if (!isMobile) {
                        hoverTimerRef.current = setTimeout(() => setIsHovered(true), 500);
                    }
                }}
                onMouseLeave={() => {
                    if (!isMobile) {
                        if (hoverTimerRef.current) {
                            clearTimeout(hoverTimerRef.current);
                            hoverTimerRef.current = null;
                        }
                        setIsHovered(false);
                    }
                }}
                style={{
                width: sidebarWidth,
                height: '100vh',
                position: 'fixed',
                left: 0,
                top: 0,
                backgroundColor: 'var(--color-surface)',
                borderRight: '1px solid var(--color-border)',
                display: 'flex',
                flexDirection: 'column',
                padding: (isMobile || !visualCollapsed) ? '12px 16px' : '12px 6px',
                zIndex: 100,
                transition: 'width 0.3s ease, transform 0.3s ease',
                transform: transform,
                boxShadow: isMobile && !isCollapsed ? '4px 0 24px rgba(0,0,0,0.15)' : (isHovered && isCollapsed ? '4px 0 24px rgba(0,0,0,0.1)' : 'none')
            }}>
                <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px', justifyContent: visualCollapsed ? 'center' : 'flex-start' }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        background: logo ? 'transparent' : 'var(--color-primary)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: '16px',
                        color: 'white',
                        flexShrink: 0,
                        overflow: 'hidden'
                    }}>
                        {logo ? (
                            <img src={logo} alt="Store Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        ) : (
                            'JBL'
                        )}
                    </div>
                    {!visualCollapsed && <h1 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, background: 'none', WebkitTextFillColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>POS</h1>}

                    {isMobile && !isCollapsed && (
                        <button
                            onClick={toggleSidebar}
                            style={{
                                marginLeft: 'auto',
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--color-text-muted)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '4px'
                            }}
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>

                <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {navItems.map((item) => {
                        const hasSubItems = item.subItems && item.subItems.length > 0;
                        const isExpanded = expandedMenus[item.label] || false;
                        
                        // Check if active matches exactly or if subroute is matched (e.g. /orders/returns)
                        const isParentActive = hasSubItems ? item.subItems.some((sub: any) => location.pathname === sub.path || location.pathname.startsWith(sub.path + '/')) : location.pathname === item.path;

                        return (
                            <div key={item.label}>
                                {hasSubItems ? (
                                    <div
                                        className={`sidebar-item ${isParentActive ? 'active-parent' : ''}`}
                                        title={visualCollapsed ? item.label : ''}
                                        onClick={() => {
                                            // Check if it's already active. If not, maybe auto-navigate to the first subitem
                                            if (!isParentActive && item.subItems && item.subItems.length > 0) {
                                                navigate(item.subItems[0].path);
                                            }
                                            
                                            setExpandedMenus(prev => ({ ...prev, [item.label]: !prev[item.label] }));
                                        }}
                                        style={{
                                            justifyContent: visualCollapsed ? 'center' : 'space-between',
                                            padding: visualCollapsed ? '12px' : '12px 16px',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <item.icon size={20} />
                                            {!visualCollapsed && <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>}
                                        </div>
                                        {!visualCollapsed && (
                                            <ChevronDown size={16} style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                                        )}
                                    </div>
                                ) : (
                                    <NavLink
                                        to={item.path}
                                        title={visualCollapsed ? item.label : ''}
                                        className={({ isActive }) => `sidebar-item ${isActive ? 'active-link' : ''}`}
                                        onClick={() => {
                                            if (isMobile && !isCollapsed) {
                                                toggleSidebar();
                                            }
                                        }}
                                        style={{
                                            justifyContent: visualCollapsed ? 'center' : 'flex-start',
                                            padding: visualCollapsed ? '12px' : '12px 16px',
                                            gap: '12px',
                                        }}
                                    >
                                        <item.icon size={20} />
                                        {!visualCollapsed && <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>}
                                    </NavLink>
                                )}

                                {/* Render Sub Items */}
                                {hasSubItems && isExpanded && !visualCollapsed && (
                                    <div style={{ display: 'flex', flexDirection: 'column', marginTop: '4px', marginLeft: '32px', gap: '4px' }}>
                                        {item.subItems.map((subItem: any) => {
                                            const isSubActive = location.pathname === subItem.path || (subItem.path !== item.path && location.pathname.startsWith(subItem.path + '/'));
                                            return (
                                                <NavLink
                                                    key={subItem.path}
                                                    to={subItem.path}
                                                    onClick={() => {
                                                        if (isMobile && !isCollapsed) {
                                                            toggleSidebar();
                                                        }
                                                    }}
                                                    className={isSubActive ? "sidebar-subitem active-sublink" : "sidebar-subitem"}
                                                >
                                                    {subItem.label}
                                                </NavLink>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </nav>

                <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {canManageUsers && (
                        <NavLink
                            to="/users"
                            title={visualCollapsed ? 'User Management' : ''}
                            onClick={() => {
                                if (isMobile && !isCollapsed) {
                                    toggleSidebar();
                                }
                            }}
                            className={({ isActive }) => `sidebar-item ${isActive ? 'active-link' : ''}`}
                            style={{
                                justifyContent: visualCollapsed ? 'center' : 'flex-start',
                                gap: '12px',
                                padding: visualCollapsed ? '12px' : '12px 16px'
                            }}
                        >
                            <Users size={20} />
                            {!visualCollapsed && <span>{t('nav.userManagement')}</span>}
                        </NavLink>
                    )}

                    {canManageSettings && currentUser?.roleId !== 'customer_care' && (
                        <NavLink
                            to="/settings"
                            title={visualCollapsed ? 'Settings' : ''}
                            onClick={() => {
                                if (isMobile && !isCollapsed) {
                                    toggleSidebar();
                                }
                            }}
                            className={({ isActive }) => `sidebar-item ${isActive ? 'active-link' : ''}`}
                            style={{
                                justifyContent: visualCollapsed ? 'center' : 'flex-start',
                                gap: '12px',
                                padding: visualCollapsed ? '12px' : '12px 16px'
                            }}
                        >
                            <Settings size={20} />
                            {!visualCollapsed && <span>{t('nav.settings')}</span>}
                        </NavLink>
                    )}

                    {/* Language Toggle */}
                    <button
                        onClick={() => setLanguage(language === 'en' ? 'km' : 'en')}
                        title={language === 'en' ? 'ប្ដូរទៅភាសាខ្មែរ' : 'Switch to English'}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: visualCollapsed ? 'center' : 'flex-start',
                            gap: '12px',
                            padding: visualCollapsed ? '12px' : '12px 16px',
                            borderRadius: '8px',
                            background: 'transparent',
                            border: '1px solid var(--color-border)',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: 500,
                            width: '100%',
                            transition: 'background 0.2s'
                        }}
                        className="sidebar-item"
                    >
                        {language === 'en' ? (
                            <svg width="20" height="14" viewBox="0 0 25 16" style={{ borderRadius: '2px', flexShrink: 0 }}>
                                <rect width="25" height="4" fill="#032EA1"/>
                                <rect y="4" width="25" height="8" fill="#E00025"/>
                                <rect y="12" width="25" height="4" fill="#032EA1"/>
                                <g fill="#fff" transform="translate(12.5,8)">
                                    <rect x="-5" y="-1.5" width="10" height="3"/>
                                    <rect x="-4" y="-3" width="8" height="1.5"/>
                                    <rect x="-1" y="-5" width="2" height="2"/>
                                    <rect x="-3.5" y="-4" width="1.5" height="1"/>
                                    <rect x="2" y="-4" width="1.5" height="1"/>
                                </g>
                            </svg>
                        ) : (
                            <svg width="20" height="14" viewBox="0 0 25 16" style={{ borderRadius: '2px', flexShrink: 0 }}>
                                <rect width="25" height="16" fill="#B22234"/>
                                <rect y="1.23" width="25" height="1.23" fill="#fff"/>
                                <rect y="3.69" width="25" height="1.23" fill="#fff"/>
                                <rect y="6.15" width="25" height="1.23" fill="#fff"/>
                                <rect y="8.62" width="25" height="1.23" fill="#fff"/>
                                <rect y="11.08" width="25" height="1.23" fill="#fff"/>
                                <rect y="13.54" width="25" height="1.23" fill="#fff"/>
                                <rect width="10" height="8.62" fill="#3C3B6E"/>
                            </svg>
                        )}
                        {!visualCollapsed && <span>{language === 'en' ? 'ខ្មែរ' : 'English'}</span>}
                    </button>
                </div>

            </aside>
        </>
    );
};

export default Sidebar;
