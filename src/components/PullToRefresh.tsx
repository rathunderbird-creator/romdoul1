import React, { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useMobile } from '../hooks/useMobile';

interface PullToRefreshProps {
    onRefresh: () => Promise<void>;
    children: ReactNode;
}

const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, children }) => {
    const isMobile = useMobile();
    const [pullDistance, setPullDistance] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const startY = useRef<number | null>(null);
    const currentY = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const MAX_PULL = 100;
    const THRESHOLD = 80;

    useEffect(() => {
        if (!isMobile) return;

        const handleTouchStart = (e: TouchEvent) => {
            // Only capture pull if at the very top of the scrollable container or page
            if (window.scrollY === 0) {
                startY.current = e.touches[0].clientY;
            } else {
                startY.current = null;
            }
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (startY.current === null || isRefreshing) return;

            currentY.current = e.touches[0].clientY;
            const diff = currentY.current - startY.current;

            if (diff > 0) {
                // Prevent default scrolling when pulling down at the top
                if (e.cancelable) {
                    e.preventDefault();
                }

                // Add resistance
                const distance = Math.min(diff * 0.5, MAX_PULL);
                setPullDistance(distance);
            }
        };

        const handleTouchEnd = async () => {
            if (startY.current === null || isRefreshing) return;

            if (pullDistance >= THRESHOLD) {
                setIsRefreshing(true);
                setPullDistance(THRESHOLD); // Hold at threshold while loading

                try {
                    await onRefresh();
                } finally {
                    setIsRefreshing(false);
                    setPullDistance(0);
                }
            } else {
                // Not pulled enough, snap back
                setPullDistance(0);
            }

            startY.current = null;
            currentY.current = null;
        };

        // Passive false is needed to allow e.preventDefault() in touchmove
        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd);

        return () => {
            document.removeEventListener('touchstart', handleTouchStart);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
        };
    }, [isMobile, pullDistance, isRefreshing, onRefresh]);

    if (!isMobile) {
        return <>{children}</>;
    }

    return (
        <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
            {/* Pull Indicator */}
            <div
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: `${pullDistance}px`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    transition: isRefreshing || pullDistance === 0 ? 'height 0.3s ease' : 'none',
                    zIndex: 10,
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text-secondary)',
                    pointerEvents: 'none'
                }}
            >
                {isRefreshing ? (
                    <Loader2 className="animate-spin" size={24} color="var(--color-primary)" />
                ) : pullDistance > 0 ? (
                    <div style={{
                        transform: `rotate(${Math.min(pullDistance * 2, 180)}deg)`,
                        opacity: pullDistance / THRESHOLD
                    }}>
                        ↓
                    </div>
                ) : null}
            </div>

            {/* Content Container */}
            <div
                style={{
                    transform: `translateY(${pullDistance}px)`,
                    transition: isRefreshing || pullDistance === 0 ? 'transform 0.3s ease' : 'none',
                    height: '100%'
                }}
            >
                {children}
            </div>
        </div>
    );
};

export default PullToRefresh;
