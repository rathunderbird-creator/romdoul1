import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Package, Settings, Truck, Users, X, Wallet, MapPin, PieChart, CalendarClock, ChevronDown, Briefcase, HeartHandshake, ShoppingCart, Calculator, List, CircleDollarSign, Trash2, PackageSearch, ArrowRightLeft, TrendingUp, TrendingDown, DollarSign, BarChart3, Award, Banknote, CalendarOff, UserPlus, MessageSquare, FileText, Building2, FileCheck, Network, BookOpen, CreditCard, AlertTriangle, PackageCheck, Tags, Warehouse, Calendar, CheckSquare, HandCoins, Store, History, Pin, PinOff, Gauge, Megaphone } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useLanguage } from '../context/LanguageContext';
import { NavLink, useLocation } from 'react-router-dom';

interface SidebarProps {
    isCollapsed: boolean;
    toggleSidebar: () => void;
    isMobile: boolean;
    // Desktop pin: expanded + pushing content (never an overlay). See Layout.
    isPinned?: boolean;
    canPin?: boolean;       // false below 1200px, where the rail is forced
    onTogglePin?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, toggleSidebar, isMobile, isPinned = false, canPin = true, onTogglePin }) => {
    const { hasPermission, logo } = useStore();
    const { t, language, setLanguage } = useLanguage();


    // ... (rest of the hook logic is same)
    // Determine if user has access to management features
    const canManageUsers = hasPermission('manage_users');
    const canManageSettings = hasPermission('manage_settings');

    const location = useLocation();

    // Define navItems before hooks that depend on it
    const navItems: any[] = [];

    if (hasPermission('view_dashboard')) {
        // One dashboard entry: / is the merged dashboard (Dashboard 2 + every
        // classic card section); /dashboard-classic stays reachable by URL.
        navItems.push({ icon: LayoutDashboard, label: t('nav.dashboard'), path: '/' });
        navItems.push({ icon: Tags, label: t('nav.priceList'), path: '/price-list' });
        navItems.push({ icon: CheckSquare, label: t('nav.todo'), path: '/todo' });
    }

    if (hasPermission('manage_orders') || hasPermission('create_orders') || hasPermission('view_orders')) {
        navItems.push({
            icon: Truck,
            label: t('nav.orders'),
            path: '/orders',
            subItems: [
                { label: t('nav.allOrders'), path: '/orders', icon: List },
                { label: t('nav.ordersManagement2'), path: '/orders-management-2', icon: Gauge },
                { label: t('nav.shippingDelivery'), path: '/orders/shipping', icon: Truck },
                { label: t('nav.allPayStatus'), path: '/payment-tracking', icon: CircleDollarSign },
                { label: t('nav.scammers'), path: '/orders/scammers', icon: AlertTriangle },
                { label: t('nav.deletedOrders'), path: '/orders/deleted', icon: Trash2 }
            ]
        });
    }

    if (hasPermission('manage_income_expense')) {
        navItems.push({
            icon: Wallet,
            label: t('nav.incomeExpense'),
            path: '/income-expense',
            subItems: [
                { label: t('nav.allTransactions'), path: '/income-expense', icon: ArrowRightLeft },
                { label: t('nav.income'), path: '/income-expense/income', icon: TrendingUp },
                { label: t('nav.expense'), path: '/income-expense/expense', icon: TrendingDown },
                { label: t('nav.revenue'), path: '/income-expense/revenue', icon: DollarSign },
                { label: t('nav.incomePrediction'), path: '/income-expense/prediction', icon: Calendar },
                { label: t('nav.pagePrediction'), path: '/income-expense/page-prediction', icon: Megaphone },
                { label: t('nav.productPrediction'), path: '/income-expense/product-prediction', icon: BarChart3 },
                { label: t('nav.staffPrediction'), path: '/income-expense/staff-prediction', icon: Users }
            ]
        });
    }

    if (hasPermission('manage_procurement')) {
        navItems.push({
            icon: ShoppingCart,
            label: t('nav.procurement'),
            path: '/procurement',
            subItems: [
                { label: t('nav.purchaseOrders'), path: '/procurement/purchase-orders', icon: FileCheck },
                { label: t('nav.suppliers'), path: '/procurement/suppliers', icon: Building2 },
                { label: t('nav.receiving'), path: '/procurement/receiving', icon: PackageCheck }
            ]
        });
    }

    if (hasPermission('manage_orders')) {
        navItems.push({
            icon: Store,
            label: t('nav.wholesale'),
            path: '/wholesale',
            subItems: [
                { label: t('nav.wholesaleOrders'), path: '/wholesale/orders', icon: ShoppingCart },
                { label: t('nav.wholesaleCustomers'), path: '/wholesale/customers', icon: Users }
            ]
        });
    }

    if (hasPermission('manage_inventory') || hasPermission('view_inventory_stock')) {
        navItems.push({
            icon: Package,
            label: t('nav.inventory'),
            path: '/inventory',
            subItems: [
                { label: t('nav.products'), path: '/inventory', icon: PackageSearch },
                { label: t('nav.categories'), path: '/inventory/categories', icon: Tags },
                { label: t('nav.warehouses'), path: '/inventory/warehouses', icon: Warehouse },
                { label: t('nav.stockMovements'), path: '/inventory/stock-movements', icon: ArrowRightLeft }
            ]
        });
    }

    if (hasPermission('manage_accounting')) {
        navItems.push({
            icon: Calculator,
            label: t('nav.accounting'),
            path: '/accounting',
            subItems: [
                { label: t('nav.chartOfAccounts'), path: '/accounting/chart-of-accounts', icon: Network },
                { label: t('nav.journalEntries'), path: '/accounting/journal-entries', icon: BookOpen },
                { label: t('nav.accountsPayable'), path: '/accounting/payable', icon: Wallet },
                { label: t('nav.accountsReceivable'), path: '/accounting/receivable', icon: HandCoins },
                { label: t('nav.payments'), path: '/accounting/payments', icon: CreditCard }
            ]
        });
    }

    if (hasPermission('manage_hr') || hasPermission('manage_attendance')) {
        navItems.push({
            icon: Briefcase,
            label: t('nav.hrPayroll'),
            path: '/hr',
            subItems: [
                { label: t('nav.attendance'), path: '/hr/attendance', icon: CalendarClock },
                { label: t('nav.employees'), path: '/hr/employees', icon: Users },
                { label: t('nav.leaves'), path: '/hr/leaves', icon: CalendarOff },
                { label: t('nav.payroll'), path: '/hr/payroll', icon: Banknote }
            ]
        });
    }

    if (hasPermission('manage_crm')) {
        navItems.push({
            icon: HeartHandshake,
            label: t('nav.crm'),
            path: '/crm',
            subItems: [
                { label: t('nav.leads'), path: '/crm/leads', icon: UserPlus },
                { label: t('nav.interactions'), path: '/crm/interactions', icon: MessageSquare },
                { label: t('nav.quotations'), path: '/crm/quotations', icon: FileText }
            ]
        });
    }

    if (hasPermission('view_dashboard')) {
        navItems.push({ icon: MapPin, label: t('nav.shippingPoint'), path: '/shipping-point' });
    }

    if (hasPermission('view_reports')) {
        navItems.push({
            icon: PieChart,
            label: t('nav.reportsCenter'),
            path: '/reports',
            subItems: [
                { label: t('nav.salesOverview'), path: '/reports/sales', icon: BarChart3 },
                { label: t('nav.topProducts'), path: '/reports/products', icon: Award },
                { label: t('nav.inventory'), path: '/reports/inventory', icon: Package },
                { label: t('nav.financials'), path: '/reports/financials', icon: DollarSign },
                { label: t('nav.staffPerformance'), path: '/reports/staff', icon: Users },
                { label: t('nav.shippingCompanies'), path: '/reports/shipping', icon: Truck },
                { label: t('nav.purchaseCost'), path: '/reports/purchase-cost', icon: Banknote },
            ]
        });
    }

    if (hasPermission('view_dashboard')) {
        navItems.push({ icon: History, label: t('nav.activityLog'), path: '/activity-log' });
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
    //
    // Desktop: pinned = always expanded, pushing the content aside (Layout's
    // margin-left tracks `isCollapsed`, which is already `!isPinned` there).
    // Unpinned = the icon rail, but hovering it temporarily expands the
    // sidebar to show labels — an overlay on top of the page (Layout's
    // margin never moves for this, only `isPinned` does), not a reflow.
    const [isHovering, setIsHovering] = useState(false);
    const visualCollapsed = isMobile ? isCollapsed : (isPinned ? false : !isHovering);

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
                aria-label="Main navigation"
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
                style={{
                    width: sidebarWidth,
                    // Not 100vh: raw viewport units render short inside the
                    // zoomed body (see index.css) — the black column would end
                    // above the real screen bottom.
                    height: 'var(--vh-full)',
                    position: 'fixed',
                    left: 0,
                    top: 0,
                    backgroundColor: 'black',
                    borderRight: '1px solid #333',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: (isMobile || !visualCollapsed) ? '12px 16px' : '12px 6px',
                    zIndex: 100,
                    transition: 'width 0.3s ease, transform 0.3s ease',
                    transform: transform,
                    boxShadow: isMobile && !isCollapsed ? '4px 0 24px rgba(0,0,0,0.15)' : 'none'
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
                        color: 'black',
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

                    {/* Desktop, expanded (pinned, or just hover-revealed): toggle
                        pin state. Hover-revealed-but-unpinned still needs this —
                        otherwise there'd be no way to lock the sidebar open
                        without first letting it collapse back to the rail. */}
                    {!isMobile && !visualCollapsed && onTogglePin && (
                        <button
                            type="button"
                            onClick={onTogglePin}
                            disabled={!isPinned && !canPin}
                            title={isPinned ? 'Unpin sidebar (collapse to icons)' : (canPin ? 'Pin sidebar (keep it open)' : 'Pin sidebar (needs a wider window)')}
                            aria-label="Pin sidebar"
                            aria-pressed={isPinned}
                            className="sidebar-item"
                            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #333', color: '#9CA3AF', padding: '5px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: (!isPinned && !canPin) ? 0.5 : 1, cursor: (!isPinned && !canPin) ? 'not-allowed' : 'pointer' }}
                        >
                            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                        </button>
                    )}

                    {isMobile && !isCollapsed && (
                        <button
                            onClick={toggleSidebar}
                            style={{
                                marginLeft: 'auto',
                                background: 'transparent',
                                border: 'none',
                                color: '#9CA3AF',
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

                {/* Desktop, rail: pin → expanded sidebar that pushes the content */}
                {!isMobile && visualCollapsed && onTogglePin && (
                    <button
                        type="button"
                        onClick={onTogglePin}
                        disabled={!canPin}
                        title={canPin ? 'Pin sidebar (keep it open)' : 'Pin sidebar (needs a wider window)'}
                        aria-label="Pin sidebar"
                        aria-pressed={isPinned}
                        // Same accessible name as the expanded-state button
                        // above — a toggle's aria-pressed should carry the
                        // state, not a name that also flips ("Pin" vs "Unpin"
                        // both announcing "pressed"/"not pressed" reads as
                        // self-contradictory to a screen reader).
                        className="sidebar-item"
                        style={{ background: 'transparent', border: '1px solid #333', color: '#9CA3AF', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px', opacity: canPin ? 1 : 0.5, cursor: canPin ? 'pointer' : 'not-allowed' }}
                    >
                        <Pin size={14} />
                    </button>
                )}

                <nav aria-label="Pages" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px', overflowY: 'auto', overflowX: 'hidden' }}>
                    {navItems.map((item) => {
                        const hasSubItems = item.subItems && item.subItems.length > 0;
                        const isExpanded = expandedMenus[item.label] || false;

                        // Check if active matches exactly or if subroute is matched (e.g. /orders/returns)
                        const isParentActive = hasSubItems ? item.subItems.some((sub: any) => location.pathname === sub.path || location.pathname.startsWith(sub.path + '/')) : location.pathname === item.path;

                        return (
                            <div key={item.label}>
                                {hasSubItems ? (
                                    visualCollapsed ? (
                                        // Rail: a toggle here would disclose a sub-item list that
                                        // never renders while collapsed (dead click, dead Enter/Space,
                                        // misleading aria-expanded for screen readers) — link straight
                                        // to the group's first page instead, like every other icon.
                                        <NavLink
                                            to={item.subItems[0].path}
                                            title={item.label}
                                            aria-label={item.label}
                                            className={() => `sidebar-item ${isParentActive ? 'active-parent' : ''}`}
                                            style={{ justifyContent: 'center', padding: '10px' }}
                                        >
                                            <item.icon size={17} />
                                        </NavLink>
                                    ) : (
                                        <div
                                            className={`sidebar-item ${isParentActive ? 'active-parent' : ''}`}
                                            aria-label={item.label}
                                            aria-expanded={isExpanded}
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedMenus(prev => ({ ...prev, [item.label]: !prev[item.label] })); } }}
                                            onClick={() => {
                                                setExpandedMenus(prev => ({ ...prev, [item.label]: !prev[item.label] }));
                                            }}
                                            style={{
                                                justifyContent: 'space-between',
                                                padding: '9px 14px',
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <item.icon size={17} />
                                                <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
                                            </div>
                                            <ChevronDown size={14} style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                                        </div>
                                    )
                                ) : (
                                    <NavLink
                                        to={item.path}
                                        title={visualCollapsed ? item.label : ''}
                                        aria-label={item.label}
                                        className={({ isActive }) => `sidebar-item ${isActive ? 'active-link' : ''}`}
                                        onClick={() => {
                                            if (isMobile && !isCollapsed) {
                                                toggleSidebar();
                                            }
                                        }}
                                        style={{
                                            justifyContent: visualCollapsed ? 'center' : 'flex-start',
                                            padding: visualCollapsed ? '10px' : '9px 14px',
                                            gap: '10px',
                                        }}
                                    >
                                        <item.icon size={17} />
                                        {!visualCollapsed && <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>}
                                    </NavLink>
                                )}

                                {/* Render Sub Items */}
                                {hasSubItems && isExpanded && !visualCollapsed && (
                                    <div style={{ display: 'flex', flexDirection: 'column', marginTop: '3px', marginLeft: '28px', gap: '3px' }}>
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
                                                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                                                >
                                                    {subItem.icon && <subItem.icon size={14} />}
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

                <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid #333', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {canManageUsers && (
                        <NavLink
                            to="/users"
                            title={visualCollapsed ? t('nav.userManagement') : ''}
                            aria-label={t('nav.userManagement')}
                            onClick={() => {
                                if (isMobile && !isCollapsed) {
                                    toggleSidebar();
                                }
                            }}
                            className={({ isActive }) => `sidebar-item ${isActive ? 'active-link' : ''}`}
                            style={{
                                justifyContent: visualCollapsed ? 'center' : 'flex-start',
                                gap: '10px',
                                padding: visualCollapsed ? '10px' : '9px 14px'
                            }}
                        >
                            <Users size={17} />
                            {!visualCollapsed && <span>{t('nav.userManagement')}</span>}
                        </NavLink>
                    )}

                    {canManageSettings && (
                        <NavLink
                            to="/settings"
                            title={visualCollapsed ? t('nav.settings') : ''}
                            aria-label={t('nav.settings')}
                            onClick={() => {
                                if (isMobile && !isCollapsed) {
                                    toggleSidebar();
                                }
                            }}
                            className={({ isActive }) => `sidebar-item ${isActive ? 'active-link' : ''}`}
                            style={{
                                justifyContent: visualCollapsed ? 'center' : 'flex-start',
                                gap: '10px',
                                padding: visualCollapsed ? '10px' : '9px 14px'
                            }}
                        >
                            <Settings size={17} />
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
                            gap: '10px',
                            padding: visualCollapsed ? '10px' : '9px 14px',
                            borderRadius: '8px',
                            background: 'transparent',
                            border: '1px solid #333',
                            color: '#9CA3AF',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: 500,
                            width: '100%',
                            transition: 'background 0.2s'
                        }}
                        className="sidebar-item"
                    >
                        {language === 'en' ? (
                            <svg width="20" height="14" viewBox="0 0 25 16" style={{ borderRadius: '2px', flexShrink: 0 }}>
                                <rect width="25" height="4" fill="#032EA1" />
                                <rect y="4" width="25" height="8" fill="#E00025" />
                                <rect y="12" width="25" height="4" fill="#032EA1" />
                                <g fill="#fff" transform="translate(12.5,8)">
                                    <rect x="-5" y="-1.5" width="10" height="3" />
                                    <rect x="-4" y="-3" width="8" height="1.5" />
                                    <rect x="-1" y="-5" width="2" height="2" />
                                    <rect x="-3.5" y="-4" width="1.5" height="1" />
                                    <rect x="2" y="-4" width="1.5" height="1" />
                                </g>
                            </svg>
                        ) : (
                            <svg width="20" height="14" viewBox="0 0 25 16" style={{ borderRadius: '2px', flexShrink: 0 }}>
                                <rect width="25" height="16" fill="#B22234" />
                                <rect y="1.23" width="25" height="1.23" fill="#fff" />
                                <rect y="3.69" width="25" height="1.23" fill="#fff" />
                                <rect y="6.15" width="25" height="1.23" fill="#fff" />
                                <rect y="8.62" width="25" height="1.23" fill="#fff" />
                                <rect y="11.08" width="25" height="1.23" fill="#fff" />
                                <rect y="13.54" width="25" height="1.23" fill="#fff" />
                                <rect width="10" height="8.62" fill="#3C3B6E" />
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
