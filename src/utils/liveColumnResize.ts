// Live column-resize step shared by the tables that size their own columns
// (Orders, Payment Tracking, Delivery Tracking, Deleted Orders, Orders
// Management 2).
//
// While a column is dragged its width is written straight onto that header
// cell, at most once per frame. A fixed-layout table takes each column's
// width from its header cell, so that is all the browser has to redo. These
// tables used to set a CSS variable on <html> instead: a custom property is
// inherited, so every change restyled every element on the page (~30ms a step
// with 200 rows, which made dragging feel sticky).
//
// The page is scaled with CSS zoom (utils/bodyZoom), so pointer movement is
// converted to the table's own pixels: the column edge stays under the
// pointer instead of falling behind it.

export interface LiveResize {
    cell: HTMLElement | null;
    scale: number;
    frame: number;
    pending: number;
    border: string | null;
}

// The dragged column's right border is highlighted directly too: a React
// state for it re-rendered the whole page on mousedown and again on release.
const HIGHLIGHT = '2px solid var(--color-primary)';

// Call on mousedown with the resize handle (or anything inside the header cell).
export const beginLiveResize = (handle: Element | null): LiveResize => {
    const cell = (handle?.closest('th, td') as HTMLElement | null) ?? null;
    const scale = cell && cell.offsetWidth > 0 ? cell.getBoundingClientRect().width / cell.offsetWidth : 1;
    const border = cell ? cell.style.borderRight : null;
    if (cell) cell.style.borderRight = HIGHLIGHT;
    return { cell, scale: scale > 0 ? scale : 1, frame: 0, pending: 0, border };
};

// Pointer movement since mousedown, in the table's own pixels.
export const liveDelta = (live: LiveResize | undefined, dx: number) => dx / (live?.scale || 1);

const write = (cell: HTMLElement | null, px: number) => {
    if (!cell) return;
    const w = `${Math.round(px)}px`;
    cell.style.width = w;
    cell.style.minWidth = w;
    cell.style.maxWidth = w;
};

// Call on mousemove: shows the width on the next frame.
export const showLiveWidth = (live: LiveResize | undefined, px: number) => {
    if (!live) return;
    live.pending = px;
    if (live.frame) return;
    live.frame = requestAnimationFrame(() => {
        live.frame = 0;
        write(live.cell, live.pending);
    });
};

// Call on mouseup: shows the final width now; the saved width takes over
// when it renders (the same value, so nothing jumps).
export const endLiveResize = (live: LiveResize | undefined, px: number) => {
    if (!live) return;
    if (live.frame) cancelAnimationFrame(live.frame);
    live.frame = 0;
    write(live.cell, px);
    if (live.cell && live.cell.style.borderRight === HIGHLIGHT) live.cell.style.borderRight = live.border ?? '';
};
