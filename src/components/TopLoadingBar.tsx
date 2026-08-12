import React from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Global top progress bar (NProgress-style). Mounted once in the Layout, so it
 * appears on every page. It animates on each route change, giving consistent
 * loading feedback as pages (and their lazy chunks) load.
 */
const TopLoadingBar: React.FC = () => {
    const location = useLocation();
    const [progress, setProgress] = React.useState(0);
    const [visible, setVisible] = React.useState(false);
    const timers = React.useRef<number[]>([]);

    React.useEffect(() => {
        // Cancel any in-flight animation from a previous navigation.
        timers.current.forEach(clearTimeout);
        timers.current = [];

        // Start: show the bar and jump to an initial visible width.
        setVisible(true);
        setProgress(12);

        // Trickle upward toward ~90% to convey ongoing work…
        const schedule = (delay: number, fn: () => void) => {
            timers.current.push(window.setTimeout(fn, delay));
        };
        schedule(120, () => setProgress(45));
        schedule(320, () => setProgress(72));
        schedule(620, () => setProgress(90));
        // …then complete and fade out.
        schedule(900, () => setProgress(100));
        schedule(1250, () => setVisible(false));
        schedule(1500, () => setProgress(0));

        return () => {
            timers.current.forEach(clearTimeout);
            timers.current = [];
        };
        // location.key changes on every navigation (even same-path), so this
        // re-runs for each page transition.
    }, [location.key]);

    return (
        <div
            aria-hidden
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                height: '3px',
                zIndex: 9999,
                pointerEvents: 'none',
                opacity: visible ? 1 : 0,
                transition: 'opacity 0.4s ease',
            }}
        >
            <div
                style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: 'var(--color-primary)',
                    boxShadow: '0 0 8px var(--color-primary), 0 0 4px var(--color-primary)',
                    borderRadius: '0 2px 2px 0',
                    transition: 'width 0.3s ease',
                }}
            />
        </div>
    );
};

export default TopLoadingBar;
