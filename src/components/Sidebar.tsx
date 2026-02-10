import { LayoutDashboard, Package, Settings, Truck, Users, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { NavLink } from 'react-router-dom';

interface SidebarProps {
    isCollapsed: boolean;
    toggleSidebar: () => void;
    isMobile: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, toggleSidebar, isMobile }) => {
    const { hasPermission } = useStore();


    // ... (rest of the hook logic is same)
    // Determine if user has access to management features
    const canManageUsers = hasPermission('manage_users');
    const canManageSettings = hasPermission('manage_settings');

    const navItems = [];

    if (hasPermission('view_dashboard')) {
        navItems.push({ icon: LayoutDashboard, label: 'Dashboard', path: '/' });
    }

    if (hasPermission('manage_orders') || hasPermission('create_orders') || hasPermission('view_orders')) {
        navItems.push({ icon: Truck, label: 'Orders & Sales', path: '/orders' });
    }

    if (hasPermission('manage_inventory')) {
        navItems.push({ icon: Package, label: 'Inventory', path: '/inventory' });
    }

    if (canManageUsers) {
        // navItems.push({ icon: Users, label: 'User Management', path: '/users' }); // Moved to bottom
    }

    // Mobile Logic:
    // isCollapsed = true -> Hidden
    // isCollapsed = false -> Overlay Open

    const sidebarWidth = isMobile ? '280px' : (isCollapsed ? '80px' : 'var(--sidebar-width)');
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

            <aside style={{
                width: sidebarWidth,
                height: '100vh',
                position: 'fixed',
                left: 0,
                top: 0,
                backgroundColor: 'var(--color-surface)',
                borderRight: '1px solid var(--color-border)',
                display: 'flex',
                flexDirection: 'column',
                padding: (isMobile || !isCollapsed) ? '12px 16px' : '12px 6px',
                zIndex: 100,
                transition: 'width 0.3s ease, transform 0.3s ease',
                transform: transform,
                boxShadow: isMobile && !isCollapsed ? '4px 0 24px rgba(0,0,0,0.15)' : 'none'
            }}>
                <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px', justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        background: 'var(--color-primary)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: '16px',
                        color: 'white',
                        flexShrink: 0
                    }}>
                        JBL
                    </div>
                    {!isCollapsed && <h1 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, background: 'none', WebkitTextFillColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>POS</h1>}
                </div>

                <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {navItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            title={isCollapsed ? item.label : ''}
                            style={({ isActive }) => ({
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                gap: '12px',
                                padding: isCollapsed ? '12px' : '12px 16px',
                                borderRadius: '8px',
                                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                backgroundColor: isActive ? 'rgba(255, 102, 0, 0.1)' : 'transparent',
                                transition: 'all 0.2s ease',
                                textDecoration: 'none',
                                fontWeight: isActive ? 600 : 400
                            })}
                        >
                            <item.icon size={20} />
                            {!isCollapsed && <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>}
                        </NavLink>
                    ))}
                </nav>

                <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {canManageUsers && (
                        <NavLink
                            to="/users"
                            title={isCollapsed ? 'User Management' : ''}
                            style={({ isActive }) => ({
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                gap: '12px',
                                padding: isCollapsed ? '12px' : '12px 16px',
                                borderRadius: '8px',
                                color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                backgroundColor: isActive ? 'rgba(255, 102, 0, 0.1)' : 'transparent',
                                transition: 'all 0.2s ease',
                                textDecoration: 'none',
                                fontWeight: isActive ? 600 : 400
                            })}
                        >
                            <Users size={20} />
                            {!isCollapsed && <span>User Management</span>}
                        </NavLink>
                    )}

                    {canManageSettings && (
                        <NavLink
                            to="/settings"
                            title={isCollapsed ? 'Settings' : ''}
                            style={({ isActive }) => ({
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                gap: '12px',
                                padding: isCollapsed ? '12px' : '12px 16px',
                                borderRadius: '8px',
                                color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                backgroundColor: isActive ? 'rgba(255, 102, 0, 0.1)' : 'transparent',
                                transition: 'all 0.2s ease',
                                textDecoration: 'none',
                                fontWeight: isActive ? 600 : 400
                            })}
                        >
                            <Settings size={20} />
                            {!isCollapsed && <span>Settings</span>}
                        </NavLink>
                    )}

                    <button
                        onClick={toggleSidebar}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '12px',
                            borderRadius: '8px',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--color-text-muted)',
                            cursor: 'pointer',
                            marginTop: '8px',
                            marginBottom: '8px'
                        }}
                    >
                        {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                    </button>
                </div>

            </aside>
        </>
    );
};

export default Sidebar;
