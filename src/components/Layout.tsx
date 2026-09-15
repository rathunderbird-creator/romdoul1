import React, { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import TopLoadingBar from './TopLoadingBar';
import { useLocation } from 'react-router-dom';

import { useMobile } from '../hooks/useMobile';

interface LayoutProps {
    children: ReactNode;
}

// Desktop sidebar: PINNED = expanded and pushing the content aside (it never
// overlays the page); UNPINNED = 80px icon rail with tooltips. The choice is
// remembered per browser. Below 1200px the rail is forced so the content keeps
// its width on tablets.
const SIDEBAR_PIN_KEY = 'sidebar_pinned';
const WIDE_QUERY = '(min-width: 1200px)';
const readPinned = (): boolean => {
    try { return localStorage.getItem(SIDEBAR_PIN_KEY) === '1'; } catch { return false; }
};
const matchesWide = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY).matches : true;

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const isMobile = useMobile();
    const location = useLocation();
    // Mobile: the sidebar is a drawer (true = hidden).
    const [isDrawerHidden, setIsDrawerHidden] = useState(true);
    const [isPinned, setIsPinned] = useState<boolean>(readPinned);
    const [isWide, setIsWide] = useState<boolean>(matchesWide);
    const [isHeaderHidden, setIsHeaderHidden] = useState(false);
    const lastScrollY = React.useRef(0);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(WIDE_QUERY);
        const onChange = () => setIsWide(mq.matches);
        onChange();
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    // Reset header visibility when switching routes
    React.useEffect(() => {
        setIsHeaderHidden(false);
    }, [location.pathname]);

    const togglePin = () => {
        setIsPinned(prev => {
            const next = !prev;
            try { localStorage.setItem(SIDEBAR_PIN_KEY, next ? '1' : '0'); } catch { /* private mode */ }
            return next;
        });
    };

    // Desktop shows the expanded sidebar only when pinned on a wide screen.
    const isCollapsed = isMobile ? isDrawerHidden : !(isPinned && isWide);
    const toggleSidebar = () => {
        if (isMobile) setIsDrawerHidden(hidden => !hidden);
        else togglePin();
    };

    const handleScroll = (e: React.UIEvent<HTMLElement>) => {
        if (!isMobile) return;

        // Disable header auto-hide when the POS form is mounted to prevent layout jumps
        if (document.body.classList.contains('pos-active')) {
            return;
        }

        const currentScrollY = e.currentTarget.scrollTop;
        if (currentScrollY > lastScrollY.current && currentScrollY > 60) {
            // Scrolling down and past initial 60px
            setIsHeaderHidden(true);
        } else if (currentScrollY < lastScrollY.current) {
            // Scrolling up
            setIsHeaderHidden(false);
        }
        lastScrollY.current = currentScrollY;
    };

    return (

        // --vh-full/--vw-full, not 100vh/100vw: raw viewport units render short
        // inside the zoomed body (see index.css) and left a bottom/right gap.
        <div style={{ height: 'var(--vh-full)', display: 'flex', overflow: 'hidden' }}>
            <TopLoadingBar />
            <Sidebar
                isCollapsed={isCollapsed}
                toggleSidebar={toggleSidebar}
                isMobile={isMobile}
                isPinned={isPinned && isWide}
                canPin={isWide}
                onTogglePin={togglePin}
            />
            <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                marginLeft: isMobile ? 0 : (isCollapsed ? '80px' : 'var(--sidebar-width)'),
                transition: 'margin-left 0.3s ease',
                width: isMobile ? '100%' : `calc(var(--vw-full) - ${isCollapsed ? '80px' : 'var(--sidebar-width)'})`,
                overflow: 'hidden'
            }}>
                <Header isCollapsed={isCollapsed} toggleSidebar={toggleSidebar} isHidden={isHeaderHidden} />
                <main
                    onScroll={handleScroll}
                    style={{
                        flex: 1,
                        padding: '12px',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        position: 'relative' // Ensure content flows under header if needed
                    }}
                >
                    {children}
                </main>
            </div>
        </div>
    );
};

export default Layout;
