import React, { useState } from 'react';
import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

import { useMobile } from '../hooks/useMobile';

interface LayoutProps {
    children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const isMobile = useMobile();
    const [isCollapsed, setIsCollapsed] = useState(true);

    // Auto-collapse on mobile, but let user toggle
    // Actually, on mobile, "collapsed" might mean hidden vs shown.
    // Let's interpret isCollapsed as "Sidebar Hidden" on mobile, and "Sidebar Mini" on Desktop.

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
                <Header isCollapsed={isCollapsed} toggleSidebar={() => setIsCollapsed(!isCollapsed)} />
                <main style={{
                    flex: 1,
                    padding: '12px',
                    overflowY: 'auto',
                    overflowX: 'hidden'
                }}>
                    {children}
                </main>
            </div>
        </div>
    );
};

export default Layout;
