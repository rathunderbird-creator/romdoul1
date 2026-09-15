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
import React, { useCallback, useEffect, useRef } from 'react';
import { useLocalStorageState } from '../dashboard2/ui';

const MIN_WIDTH = 60;

export interface ColumnWidths {
    widthStyle: (key: string) => React.CSSProperties;
    resizeHandle: (key: string) => React.ReactNode;
    totalWidth: number;
}

export const useColumnWidths = (storageKey: string, defaults: Record<string, number>): ColumnWidths => {
    const [widths, setWidths] = useLocalStorageState<Record<string, number>>(storageKey, {});
    const dragRef = useRef<{ startX: number; startWidth: number; key: string } | null>(null);
    const cssVar = (key: string): string => `--${storageKey}-${key}-width`;

    const onMove = useCallback((e: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const width = Math.max(MIN_WIDTH, drag.startWidth + (e.clientX - drag.startX));
        document.documentElement.style.setProperty(cssVar(drag.key), `${width}px`);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onEnd = useCallback((e: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const width = Math.max(MIN_WIDTH, drag.startWidth + (e.clientX - drag.startX));
        setWidths(prev => ({ ...prev, [drag.key]: width }));
        document.documentElement.style.removeProperty(cssVar(drag.key));
        dragRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onMove, setWidths]);

    const onStart = useCallback((e: React.MouseEvent, key: string) => {
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = { startX: e.clientX, startWidth: widths[key] || defaults[key] || 120, key };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [widths, defaults, onMove, onEnd]);

    // Stop a drag cleanly if the table unmounts mid-drag (navigating away).
    useEffect(() => () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
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
