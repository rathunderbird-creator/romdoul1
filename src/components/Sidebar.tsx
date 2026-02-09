import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Package, Settings, Truck, BarChart2, ChevronLeft, ChevronRight } from 'lucide-react';

interface SidebarProps {
    isCollapsed: boolean;
    toggleSidebar: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, toggleSidebar }) => {
    const navItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
        // { icon: ShoppingCart, label: 'Point of Sale', path: '/pos' },
        { icon: Truck, label: 'Orders & Sales', path: '/orders' },
        // { icon: Package, label: 'Delivery Tracking', path: '/delivery-tracking' },
        // { icon: Settings, label: 'Payment Tracking', path: '/payment-tracking' },
        { icon: Package, label: 'Inventory', path: '/inventory' },
        { icon: BarChart2, label: 'Report', path: '/report' },
    ];

    return (
        <aside style={{
            width: isCollapsed ? '80px' : 'var(--sidebar-width)',
            height: '100vh',
            position: 'fixed',
            left: 0,
            top: 0,
            backgroundColor: 'var(--color-surface)',
            borderRight: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            padding: isCollapsed ? '12px 6px' : '12px 16px',
            zIndex: 100,
            transition: 'width 0.3s ease'
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
                        marginTop: '8px'
                    }}
                >
                    {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
