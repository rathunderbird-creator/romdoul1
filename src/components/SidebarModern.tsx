// The modern light sidebar: white surface, uppercase group labels, pill-style
// active items — the alternative to the classic black rail. Same props, same
// pin/rail/drawer mechanics, same nav tree (useNavItems); only the look
// differs. Chosen via ThemeContext.layout ('modern').
import React, { useState, useEffect } from 'react';
import { X, ChevronDown, Pin, PinOff } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useNavItems, type NavItem, type NavSubItem } from './useNavItems';
import { NavLink, useLocation } from 'react-router-dom';

interface SidebarProps {
    isCollapsed: boolean;
    toggleSidebar: () => void;
    isMobile: boolean;
    isPinned?: boolean;
    canPin?: boolean;
    onTogglePin?: () => void;
}

const SidebarModern: React.FC<SidebarProps> = ({ isCollapsed, toggleSidebar, isMobile, isPinned = false, canPin = true, onTogglePin }) => {
    const { logo } = useStore();
    const location = useLocation();
    const navItems = useNavItems();

    const isSubActive = (sub: NavSubItem, item: NavItem) =>
        location.pathname === sub.path || (sub.path !== item.path && location.pathname.startsWith(sub.path + '/'));
    const isParentActive = (item: NavItem) =>
        item.subItems ? item.subItems.some(sub => isSubActive(sub, item)) : location.pathname === item.path;

    const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        navItems.forEach(item => { if (item.subItems && isParentActive(item)) initial[item.label] = true; });
        return initial;
    });

    useEffect(() => {
        navItems.forEach(item => {
            if (item.subItems && isParentActive(item)) {
                setExpandedMenus(prev => prev[item.label] ? prev : { ...prev, [item.label]: true });
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    // Same mechanics as the classic sidebar: mobile drawer; desktop pinned =
    // expanded and pushing, unpinned = 80px rail that expands as an overlay on
    // hover (Layout's margin only tracks the pin).
    const [isHovering, setIsHovering] = useState(false);
    const visualCollapsed = isMobile ? isCollapsed : (isPinned ? false : !isHovering);

    const sidebarWidth = isMobile ? '280px' : (visualCollapsed ? '80px' : 'var(--sidebar-width)');
    const transform = isMobile ? (isCollapsed ? 'translateX(-100%)' : 'translateX(0)') : 'none';
    const backdropVisible = isMobile && !isCollapsed;

    const closeOnMobile = () => { if (isMobile && !isCollapsed) toggleSidebar(); };

    const itemPad = visualCollapsed ? '10px' : '9px 12px';

    const renderFlatItem = (item: NavItem) => (
        <NavLink
            key={item.path}
            to={item.path}
            title={visualCollapsed ? item.label : ''}
            aria-label={item.label}
            onClick={closeOnMobile}
            className={({ isActive }) => `msidebar-item ${isActive ? 'active' : ''}`}
            style={{ justifyContent: visualCollapsed ? 'center' : 'flex-start', padding: itemPad, gap: '10px' }}
        >
            <item.icon size={17} style={{ flexShrink: 0 }} />
            {!visualCollapsed && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
        </NavLink>
    );

    const renderGroup = (item: NavItem) => {
        const isExpanded = expandedMenus[item.label] || false;
        const active = isParentActive(item);

        if (visualCollapsed) {
            // Rail: the group icon links straight to its first page.
            return (
                <NavLink
                    key={item.label}
                    to={item.subItems![0].path}
                    title={item.label}
                    aria-label={item.label}
                    className={() => `msidebar-item ${active ? 'active' : ''}`}
                    style={{ justifyContent: 'center', padding: '10px' }}
                >
                    <item.icon size={17} />
                </NavLink>
            );
        }

        return (
            <div key={item.label} style={{ marginTop: '10px' }}>
                <div
                    className="msidebar-group"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-label={item.label}
                    onClick={() => setExpandedMenus(prev => ({ ...prev, [item.label]: !prev[item.label] }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedMenus(prev => ({ ...prev, [item.label]: !prev[item.label] })); } }}
                    style={{ color: active && !isExpanded ? 'var(--color-primary)' : undefined }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <item.icon size={17} style={{ flexShrink: 0 }} />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                    </div>
                    <ChevronDown size={13} style={{ flexShrink: 0, transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }} />
                </div>
                {isExpanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                        {item.subItems!.map(sub => (
                            <NavLink
                                key={sub.path}
                                to={sub.path}
                                onClick={closeOnMobile}
                                className={isSubActive(sub, item) ? 'msidebar-item active' : 'msidebar-item'}
                                style={{ padding: '8px 12px', gap: '10px' }}
                            >
                                <sub.icon size={16} style={{ flexShrink: 0 }} />
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub.label}</span>
                            </NavLink>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            {backdropVisible && (
                <div onClick={toggleSidebar} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 99 }} />
            )}

            <aside
                aria-label="Main navigation"
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
                style={{
                    width: sidebarWidth,
                    height: 'var(--vh-full)',
                    position: 'fixed',
                    left: 0,
                    top: 0,
                    backgroundColor: 'var(--color-surface)',
                    borderRight: '1px solid var(--color-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: (isMobile || !visualCollapsed) ? '14px 12px' : '14px 8px',
                    zIndex: 100,
                    transition: 'width 0.3s ease, transform 0.3s ease',
                    transform,
                    boxShadow: isMobile && !isCollapsed ? '4px 0 24px rgba(0,0,0,0.12)' : 'none'
                }}
            >
                {/* Brand */}
                <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px', justifyContent: visualCollapsed ? 'center' : 'flex-start', padding: visualCollapsed ? 0 : '0 4px' }}>
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0, overflow: 'hidden',
                        background: logo ? 'transparent' : 'var(--color-primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', fontWeight: 800, fontSize: '14px',
                    }}>
                        {logo ? <img src={logo} alt="Store Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : 'JBL'}
                    </div>
                    {!visualCollapsed && (
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="d2-khmer" style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                                JBL POS
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>POS System</div>
                        </div>
                    )}
                    {!isMobile && !visualCollapsed && onTogglePin && (
                        <button
                            type="button"
                            onClick={onTogglePin}
                            disabled={!isPinned && !canPin}
                            title={isPinned ? 'Unpin sidebar (collapse to icons)' : (canPin ? 'Pin sidebar (keep it open)' : 'Pin sidebar (needs a wider window)')}
                            aria-label="Pin sidebar"
                            aria-pressed={isPinned}
                            className="msidebar-item"
                            style={{ background: 'transparent', border: '1px solid var(--color-border)', padding: '5px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: (!isPinned && !canPin) ? 0.5 : 1, cursor: (!isPinned && !canPin) ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                        >
                            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                        </button>
                    )}
                    {isMobile && !isCollapsed && (
                        <button onClick={toggleSidebar} aria-label="Close menu" style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', padding: '4px' }}>
                            <X size={20} />
                        </button>
                    )}
                </div>

                {!isMobile && visualCollapsed && onTogglePin && (
                    <button
                        type="button"
                        onClick={onTogglePin}
                        disabled={!canPin}
                        title={canPin ? 'Pin sidebar (keep it open)' : 'Pin sidebar (needs a wider window)'}
                        aria-label="Pin sidebar"
                        aria-pressed={isPinned}
                        className="msidebar-item"
                        style={{ background: 'transparent', border: '1px solid var(--color-border)', padding: '6px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px', opacity: canPin ? 1 : 0.5, cursor: canPin ? 'pointer' : 'not-allowed' }}
                    >
                        <Pin size={14} />
                    </button>
                )}

                <nav aria-label="Pages" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px', overflowY: 'auto', overflowX: 'hidden', paddingRight: '2px' }}>
                    {navItems.map(item => (item.subItems && item.subItems.length > 0) ? renderGroup(item) : renderFlatItem(item))}
                </nav>

            </aside>
        </>
    );
};

export default SidebarModern;
