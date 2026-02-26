import React, { useState } from 'react';
import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useLocation } from 'react-router-dom';

import { useMobile } from '../hooks/useMobile';

interface LayoutProps {
    children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const isMobile = useMobile();
    const location = useLocation();
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [isHeaderHidden, setIsHeaderHidden] = useState(false);
    const lastScrollY = React.useRef(0);

    // Reset header visibility when switching routes
    React.useEffect(() => {
        setIsHeaderHidden(false);
    }, [location.pathname]);

    // Auto-collapse on mobile, but let user toggle
    // Actually, on mobile, "collapsed" might mean hidden vs shown.
    // Let's interpret isCollapsed as "Sidebar Hidden" on mobile, and "Sidebar Mini" on Desktop.

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

        <div style={{ height: '100vh', display: 'flex', overflow: 'hidden' }}>
            <Sidebar isCollapsed={isCollapsed} toggleSidebar={() => setIsCollapsed(!isCollapsed)} isMobile={isMobile} />
            <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                marginLeft: isMobile ? 0 : (isCollapsed ? '80px' : 'var(--sidebar-width)'),
                transition: 'margin-left 0.3s ease',
                width: isMobile ? '100%' : `calc(100vw - ${isCollapsed ? '80px' : 'var(--sidebar-width)'})`,
                overflow: 'hidden'
            }}>
                <Header isCollapsed={isCollapsed} toggleSidebar={() => setIsCollapsed(!isCollapsed)} isHidden={isHeaderHidden} />
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
