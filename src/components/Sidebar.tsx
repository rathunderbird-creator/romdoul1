import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Package, Settings, Truck, Users, X, Wallet, Phone, MapPin, PieChart, CalendarClock, ChevronDown } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

interface SidebarProps {
    isCollapsed: boolean;
    toggleSidebar: () => void;
    isMobile: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, toggleSidebar, isMobile }) => {
    const { hasPermission, currentUser, logo } = useStore();


    // ... (rest of the hook logic is same)
    // Determine if user has access to management features
    const canManageUsers = hasPermission('manage_users');
    const canManageSettings = hasPermission('manage_settings');

    const location = useLocation();
    const navigate = useNavigate();
    
    // Define navItems before hooks that depend on it
    const navItems: any[] = [];

    if (hasPermission('view_dashboard')) {
        navItems.push({ icon: LayoutDashboard, label: 'Dashboard', path: '/' });
    }

    if (hasPermission('manage_orders') || hasPermission('create_orders') || hasPermission('view_orders')) {
        navItems.push({ 
            icon: Truck, 
            label: 'Orders Management', 
            path: '/orders'
        });
    }

    if (hasPermission('manage_inventory') || hasPermission('view_inventory_stock')) {
        navItems.push({ 
            icon: Package, 
            label: 'Inventory', 
            path: '/inventory',
            subItems: [
                { label: 'All Products', path: '/inventory' },
                { label: 'Stock-In', path: '/inventory/stock-in' },
                { label: 'Stock-Out', path: '/inventory/stock-out' },
                { label: 'Returns & Restocks', path: '/inventory/returns' }
            ]
        });
    }

    if (hasPermission('manage_income_expense')) {
        navItems.push({ 
            icon: Wallet, 
            label: 'Income & Expense', 
            path: '/income-expense',
            subItems: [
                { label: 'All Transactions', path: '/income-expense' },
                { label: 'Income', path: '/income-expense/income' },
                { label: 'Expense', path: '/income-expense/expense' },
                { label: 'Revenue', path: '/income-expense/revenue' }
            ]
        });
    }

    if (hasPermission('view_reports')) {
        navItems.push({ icon: PieChart, label: 'Reports Center', path: '/reports' });
    }

    if (hasPermission('view_dashboard')) {
        navItems.push({ icon: Phone, label: 'ប្រតិបត្តិករទូរស័ព្ទ', path: '/mobile-operators' });
        navItems.push({ icon: MapPin, label: 'Shipping Point', path: '/shipping-point' });
    }

    if (hasPermission('manage_attendance')) {
        navItems.push({ icon: CalendarClock, label: 'Attendance', path: '/attendance' });
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
                onMouseEnter={() => !isMobile && setIsHovered(true)}
                onMouseLeave={() => !isMobile && setIsHovered(false)}
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
                                            const isSubActive = location.pathname === subItem.path || location.pathname.startsWith(subItem.path + '/');
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
                            {!visualCollapsed && <span>User Management</span>}
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
                            {!visualCollapsed && <span>Settings</span>}
                        </NavLink>
                    )}

                </div>

            </aside>
        </>
    );
};

export default Sidebar;
