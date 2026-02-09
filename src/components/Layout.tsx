import React, { useState } from 'react';
import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

interface LayoutProps {
    children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const [isCollapsed, setIsCollapsed] = useState(true);

    return (
        <div style={{ minHeight: '100vh', display: 'flex' }}>
            <Sidebar isCollapsed={isCollapsed} toggleSidebar={() => setIsCollapsed(!isCollapsed)} />
            <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                marginLeft: isCollapsed ? '80px' : 'var(--sidebar-width)',
                transition: 'margin-left 0.3s ease',
                maxWidth: '100vw',
                overflowX: 'hidden'
            }}>
                <Header isCollapsed={isCollapsed} />
                <main style={{
                    flex: 1,
                    marginTop: 'var(--header-height)',
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
