import React, { useState, useEffect } from 'react';
import { X, ChevronDown, Pin, PinOff } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useNavItems } from './useNavItems';
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
    const { logo } = useStore();

    const location = useLocation();

    // The shared, permission-filtered nav tree (same source as the modern sidebar).
    const navItems = useNavItems();

    const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>(() => {
        const initialExpanded: Record<string, boolean> = {};
        navItems.forEach(item => {
            if (item.subItems) {
                const isParentActive = item.subItems.some((sub: any) => location.pathname === sub.path || (sub.path !== item.path && location.pathname.startsWith(sub.path + '/')));
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
                const isParentActive = item.subItems.some((sub: any) => location.pathname === sub.path || (sub.path !== item.path && location.pathname.startsWith(sub.path + '/')));
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
                        // Bound once so TypeScript knows it stays defined past the check.
                        const subItems = item.subItems && item.subItems.length > 0 ? item.subItems : null;
                        const isExpanded = expandedMenus[item.label] || false;

                        // Check if active matches exactly or if subroute is matched (e.g. /orders/returns)
                        const isParentActive = subItems ? subItems.some(sub => location.pathname === sub.path || (sub.path !== item.path && location.pathname.startsWith(sub.path + '/'))) : location.pathname === item.path;

                        return (
                            <div key={item.label}>
                                {subItems ? (
                                    visualCollapsed ? (
                                        // Rail: a toggle here would disclose a sub-item list that
                                        // never renders while collapsed (dead click, dead Enter/Space,
                                        // misleading aria-expanded for screen readers) — link straight
                                        // to the group's first page instead, like every other icon.
                                        <NavLink
                                            to={subItems[0].path}
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
                                {subItems && isExpanded && !visualCollapsed && (
                                    <div style={{ display: 'flex', flexDirection: 'column', marginTop: '3px', marginLeft: '28px', gap: '3px' }}>
                                        {subItems.map(subItem => {
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


            </aside>
        </>
    );
};

export default Sidebar;
