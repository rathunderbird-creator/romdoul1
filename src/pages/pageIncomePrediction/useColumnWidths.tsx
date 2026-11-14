// Resizable columns, reused by both Prediction by Page's and Prediction by
// Product's tables (../../productIncomePrediction/components/*) — the same
// drag pattern as Orders Management 2 (../ordersManagement2/components/OrdersTable.tsx):
// while dragging, the width goes straight into a CSS custom property so a
// month of rows doesn't re-render per pixel; the final width is committed to
// state (persisted per table in localStorage) on mouseup.
//
// Every cell gets width + min-width + max-width, all equal: with
// table-layout:fixed a plain `width` is only a hint the browser overrides once
// unbreakable content (a long Khmer page name) disagrees with it.
import React, { startTransition, useCallback, useEffect, useRef } from 'react';
import { useLocalStorageState } from '../dashboard2/ui';

const MIN_WIDTH = 60;

export interface ColumnWidths {
    widthStyle: (key: string) => React.CSSProperties;
    resizeHandle: (key: string) => React.ReactNode;
    totalWidth: number;
}

const setLiveWidth = (cell: HTMLElement | null, px: number) => {
    if (!cell) return;
    const w = `${px}px`;
    cell.style.width = w;
    cell.style.minWidth = w;
    cell.style.maxWidth = w;
};

const widthAt = (drag: { startX: number; startWidth: number; scale: number }, x: number) =>
    Math.max(MIN_WIDTH, Math.round(drag.startWidth + (x - drag.startX) / drag.scale));

export const useColumnWidths = (storageKey: string, defaults: Record<string, number>): ColumnWidths => {
    const [widths, setWidths] = useLocalStorageState<Record<string, number>>(storageKey, {});
    const dragRef = useRef<{ startX: number; startWidth: number; key: string; cell: HTMLElement | null; scale: number; lastX: number; frame: number; listeners: AbortController } | null>(null);
    const cssVar = (key: string): string => `--${storageKey}-${key}-width`;

    // While dragging, the width is written straight onto the header cell (at
    // most once per frame). A fixed-layout table sizes each column from its
    // header cell, so that is all the browser has to redo. A CSS variable
    // (on <html> or the table) is inherited, so changing it restyled every
    // cell of every row on each step: ~30ms a step on a 200-row table. The
    // page is scaled with CSS zoom, so the pointer's movement is converted to
    // the table's own pixels: the edge stays under the pointer.

    const onMove = useCallback((e: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        drag.lastX = e.clientX;
        if (drag.frame) return;
        drag.frame = requestAnimationFrame(() => {
            const d = dragRef.current;
            if (!d) return;
            d.frame = 0;
            setLiveWidth(d.cell, widthAt(d, d.lastX));
        });
    }, []);

    const onEnd = useCallback((e: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        if (drag.frame) cancelAnimationFrame(drag.frame);
        const width = widthAt(drag, e.clientX);
        // The header cell keeps showing the final width until the saved width
        // renders; saving re-renders the whole page (every row), so that runs
        // as a background update instead of freezing the page on release.
        setLiveWidth(drag.cell, width);
        startTransition(() => setWidths(prev => ({ ...prev, [drag.key]: width })));
        dragRef.current = null;
        drag.listeners.abort();
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, [setWidths]);

    const onStart = useCallback((e: React.MouseEvent, key: string) => {
        e.preventDefault();
        e.stopPropagation();
        const cell = (e.currentTarget as HTMLElement).closest('th, td') as HTMLElement | null;
        const scale = cell && cell.offsetWidth > 0 ? cell.getBoundingClientRect().width / cell.offsetWidth : 1;
        // A width still showing from the previous drag (its save may not have
        // rendered yet) is the starting point.
        const current = cell ? parseFloat(cell.style.width) : NaN;
        dragRef.current = {
            startX: e.clientX,
            startWidth: Number.isFinite(current) ? current : (widths[key] || defaults[key] || 120),
            key, cell, scale: scale > 0 ? scale : 1, lastX: e.clientX, frame: 0,
            listeners: new AbortController(),
        };
        // Removed together by aborting (onEnd can't name itself to remove itself).
        const { signal } = dragRef.current.listeners;
        document.addEventListener('mousemove', onMove, { signal });
        document.addEventListener('mouseup', onEnd, { signal });
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [widths, defaults, onMove, onEnd]);

    // Stop a drag cleanly if the table unmounts mid-drag (navigating away).
    useEffect(() => () => {
        const drag = dragRef.current;
        if (drag?.frame) cancelAnimationFrame(drag.frame);
        drag?.listeners.abort();
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, [onMove, onEnd]);

    const widthStyle = (key: string): React.CSSProperties => {
        const px = widths[key] || defaults[key] || 120;
        const width = `var(${cssVar(key)}, ${px}px)`;
        return { width, minWidth: width, maxWidth: width };
    };

    const resizeHandle = (key: string): React.ReactNode => (
        <div className="pip-resize-handle" role="presentation" aria-hidden onMouseDown={e => onStart(e, key)} />
    );

    const totalWidth = Object.keys(defaults).reduce((sum, key) => sum + (widths[key] || defaults[key]), 0);

    return { widthStyle, resizeHandle, totalWidth };
};
