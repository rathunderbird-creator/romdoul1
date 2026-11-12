import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { bodyZoom } from '../utils/bodyZoom';

export interface PortalPosition { top: number; left: number; width: number; ready: boolean; maxHeight?: number }

// Places a dropdown that is portalled into <body> (position: absolute) right
// under its anchor, in the zoomed body's coordinates (see utils/bodyZoom.ts).
// Opens upward when there isn't room below; when it fits neither way it takes
// the roomier side and maxHeight (apply it with overflowY: 'auto') caps it.
// Stays hidden (ready=false)
// until measured, so it never flashes at the page's top-left corner first.
// Follows the anchor on any scroll (capture) and on resize while open.
export function usePortalPosition(
    anchorRef: RefObject<HTMLElement | null>,
    popupRef: RefObject<HTMLElement | null>,
    isOpen: boolean,
    gap = 4,
): PortalPosition {
    const [pos, setPos] = useState<PortalPosition>({ top: 0, left: 0, width: 0, ready: false });

    useLayoutEffect(() => {
        if (!isOpen) return;
        const update = () => {
            const anchor = anchorRef.current;
            if (!anchor) return;
            const z = bodyZoom();
            const r = anchor.getBoundingClientRect();
            // offsetHeight/Width are already in body (zoomed) CSS px.
            // Full height even while a previous maxHeight caps it (scrollHeight),
            // plus borders (offsetHeight - clientHeight). The popup is given the
            // anchor's width, so never clamp with less than that.
            const el = popupRef.current;
            const popupH = el ? el.scrollHeight + (el.offsetHeight - el.clientHeight) : 0;
            const popupW = Math.max(el?.offsetWidth || 0, r.width / z);
            const viewH = window.innerHeight / z;
            const viewW = window.innerWidth / z;
            const scrollY = window.scrollY / z;
            const scrollX = window.scrollX / z;
            const below = r.bottom / z + gap;
            const above = r.top / z - gap - popupH;
            const roomBelow = viewH - 4 - below;
            const roomAbove = r.top / z - gap - 4;
            const left = Math.max(4, Math.min(r.left / z, viewW - popupW - 4)) + scrollX;
            let top: number;
            let maxHeight: number | undefined;
            if (popupH <= roomBelow) top = below;
            else if (popupH <= roomAbove) top = above;
            else if (roomBelow >= roomAbove) { top = below; maxHeight = Math.max(80, roomBelow); }
            else { maxHeight = Math.max(80, roomAbove); top = Math.max(4, r.top / z - gap - maxHeight); }
            setPos({ top: top + scrollY, left, width: r.width / z, ready: true, maxHeight });
        };
        update();
        // Measure again once the popup has rendered and has a real height.
        const raf = requestAnimationFrame(update);
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
        };
    }, [isOpen, anchorRef, popupRef, gap]);

    // Closed means not ready: a reopened popup stays hidden until re-measured
    // (the layout effect measures before the browser paints).
    return isOpen ? pos : { ...pos, ready: false };
}
