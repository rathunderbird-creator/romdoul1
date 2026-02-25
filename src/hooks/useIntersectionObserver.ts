import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

export function useIntersectionObserver(
    elementRef: RefObject<Element | null>,
    options?: IntersectionObserverInit
): boolean {
    const [isIntersecting, setIsIntersecting] = useState(false);
    const [hasIntersected, setHasIntersected] = useState(false); // Only trigger once

    useEffect(() => {
        const element = elementRef.current;
        if (!element) return;

        const observer = new IntersectionObserver(([entry]) => {
            setIsIntersecting(entry.isIntersecting);
            if (entry.isIntersecting) {
                setHasIntersected(true);
            }
        }, options);

        observer.observe(element);

        return () => {
            if (element) {
                observer.unobserve(element);
            }
        };
    }, [elementRef, options]);

    // Return true if it is currently intersecting OR has ever intersected (useful for lazy loading)
    return isIntersecting || hasIntersected;
}
