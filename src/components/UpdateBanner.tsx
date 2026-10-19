// Notices when a new build has been deployed while this tab stayed open —
// stale JS can otherwise fail to load a page it hasn't visited yet (a
// chunk 404 after a deploy replaces the old hashed files). Polls a small
// static file written at build time (see vite.config.ts) and prompts a
// reload instead of letting that happen silently.
import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const UpdateBanner: React.FC = () => {
    const [available, setAvailable] = useState(false);

    const checkForUpdate = useCallback(async () => {
        try {
            const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            if (data?.buildId && data.buildId !== __BUILD_ID__) setAvailable(true);
        } catch {
            // Offline, or a local dev server with no build to poll — either
            // way, nothing to report.
        }
    }, []);

    useEffect(() => {
        // Deferred, not called directly: a fetch-driven setState belongs in a
        // callback, not as a synchronous call in the effect body.
        const initial = setTimeout(checkForUpdate, 0);
        const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') checkForUpdate(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', checkForUpdate);
        return () => {
            clearTimeout(initial);
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', checkForUpdate);
        };
    }, [checkForUpdate]);

    if (!available) return null;

    return (
        <>
            <style>{`
                @keyframes updateBannerSlideIn {
                    from { transform: translateY(16px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `}</style>
            <div style={{
                position: 'fixed',
                bottom: '24px',
                left: '24px',
                zIndex: 10000,
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '10px',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
                padding: '12px 14px 12px 18px',
                fontSize: '13px',
                color: 'var(--color-text-main)',
                animation: 'updateBannerSlideIn 0.3s ease'
            }}>
                <span>A new version is available.</span>
                <button
                    onClick={() => window.location.reload()}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'var(--color-primary)',
                        color: 'white',
                        border: 'none',
                        padding: '7px 14px',
                        borderRadius: '8px',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                    }}
                >
                    <RefreshCw size={14} /> Reload
                </button>
            </div>
        </>
    );
};

export default UpdateBanner;
