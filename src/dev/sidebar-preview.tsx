// Dev-only preview: open http://localhost:5173/dev/sidebar.html while
// `npm run dev` is running.
//
// Mounts the real Sidebar component with a mock StoreContext (no auth, no
// Supabase — see StoreContext.tsx's exported `StoreContext`) so pin/hover
// behaviour can be checked in a browser without logging in. A slim grey bar
// on top mirrors Layout.tsx's own state derivation (isCollapsed, isPinned)
// so this preview behaves exactly like the real app shell. Not part of the
// production build (Vite only builds index.html).
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../index.css';
import ErrorBoundary from '../components/ErrorBoundary';
import { LanguageProvider } from '../context/LanguageContext';
import { StoreContext } from '../context/StoreContext';
import Sidebar from '../components/Sidebar';

const mockStore = {
    hasPermission: () => true,
    logo: '',
} as any;

const devBarStyle = {
    display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 10,
    padding: '6px 12px', background: '#e5e7eb', color: '#374151',
    fontSize: 12, fontFamily: 'system-ui, sans-serif', borderBottom: '1px solid #d1d5db',
};

const Preview = () => {
    const [isMobile, setIsMobile] = useState(false);
    const [isDrawerHidden, setIsDrawerHidden] = useState(true);
    const [isPinned, setIsPinned] = useState(false);
    const [isWide, setIsWide] = useState(true);

    // Mirrors Layout.tsx's own derivation exactly.
    const isCollapsed = isMobile ? isDrawerHidden : !(isPinned && isWide);
    const toggleSidebar = () => { if (isMobile) setIsDrawerHidden(h => !h); else setIsPinned(p => !p); };
    const togglePin = () => setIsPinned(p => !p);

    return (
        <MemoryRouter>
            <StoreContext.Provider value={mockStore}>
                <LanguageProvider>
                    <div style={devBarStyle}>
                        <strong>Sidebar preview</strong>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <input type="checkbox" checked={isMobile} onChange={e => setIsMobile(e.target.checked)} />
                            isMobile
                        </label>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <input type="checkbox" checked={isWide} onChange={e => setIsWide(e.target.checked)} />
                            isWide (canPin)
                        </label>
                        <span>isPinned: <b>{String(isPinned)}</b></span>
                        <span>isCollapsed (drives content margin): <b>{String(isCollapsed)}</b></span>
                    </div>
                    <div style={{ height: 'var(--vh-full)', display: 'flex', overflow: 'hidden', background: '#f4f6fa' }}>
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
                            marginLeft: isMobile ? 0 : (isCollapsed ? '80px' : 'var(--sidebar-width)'),
                            transition: 'margin-left 0.3s ease',
                            padding: 20,
                        }}>
                            <p>Page content. marginLeft only reacts to isPinned — hovering the rail should overlay on top of this without shifting it.</p>
                        </div>
                    </div>
                </LanguageProvider>
            </StoreContext.Provider>
        </MemoryRouter>
    );
};

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ErrorBoundary>
            <Preview />
        </ErrorBoundary>
    </StrictMode>,
);
