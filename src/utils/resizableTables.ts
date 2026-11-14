// Makes every table in the app column-resizable without touching the tables
// themselves: a drag grip goes on the right edge of each header cell, and a
// dragged width is kept per browser (localStorage) for that page and table.
//
// How it stays out of the way:
// - A table is left exactly as it renders until someone actually drags one of
//   its columns (a plain click on a grip does nothing), or a width was saved
//   for it earlier. Only then is it "frozen": every header cell gets a px
//   width, the table switches to table-layout: fixed and is exactly as wide
//   as its columns. It is never stretched to 100%: spreading spare width over
//   the columns made dragging one column move the others.
// - Grips are plain DOM added next to React's children. If React rewrites a
//   header's text (which drops the grip), the observer below puts it back;
//   each scan also re-asserts a frozen table's widths in case a re-render
//   overwrote them.
// - Skipped: tables with no single <thead> row of >= 2 cells, or with
//   colspan/rowspan in it (grouped columns); tables that size their own
//   columns (data-resize="own", or their own grip .pip-resize-handle /
//   .om2-resize-handle / [data-col-resize]); anything inside
//   [data-resize="off"] (receipts and other printed layouts).
// - A frozen table clips plain-text cells with an ellipsis; cells holding
//   inputs, buttons or menus are never clipped, and data-resize-clip="off"
//   turns clipping off for a whole table.
// - Double-click a grip to put that table back to its original layout.
// - Widths are saved under the page (record ids in the path folded to :id),
//   plus the table's first column names (or data-resize-key when given), and
//   per column under its header text (sort arrows, counts and form controls
//   ignored; data-col-key when given).

const GRIP_CLASS = 'rt-grip';
const HOST_CLASS = 'rt-host';
const FROZEN_ATTR = 'data-rt-frozen';
const STORAGE_PREFIX = 'rt-widths:';
const MIN_WIDTH = 40;
const DRAG_THRESHOLD = 3;
const MAX_SAVED_TABLES = 150;

type Saved = Record<string, number>;

const injectStyles = () => {
    if (document.getElementById('rt-styles')) return;
    const style = document.createElement('style');
    style.id = 'rt-styles';
    // :where() keeps these at zero specificity: a stylesheet's position: sticky
    // on a header cell still wins (sticky is a containing block for the grip).
    const clip = `table[${FROZEN_ATTR}]:not([data-resize-clip="off"])`;
    const plain = ':not(:has(input, select, textarea, button, [role="menu"], [role="listbox"], [role="dialog"]))';
    style.textContent = `
:where(th.${HOST_CLASS}) { position: relative; }
.${GRIP_CLASS} { position: absolute; top: 0; right: 0; width: 7px; height: 100%; cursor: col-resize; z-index: 1; user-select: none; touch-action: none; background: transparent; }
@media (pointer: coarse) { .${GRIP_CLASS} { width: 14px; } }
.${GRIP_CLASS}:hover, .${GRIP_CLASS}.rt-active { background: rgba(84, 105, 212, 0.35); }
${clip} > thead > tr > th${plain}, ${clip} > tbody > tr > td${plain}, ${clip} > tfoot > tr > td${plain} { overflow: hidden; text-overflow: ellipsis; }
body.rt-dragging, body.rt-dragging * { cursor: col-resize !important; user-select: none !important; }
@media print {
  .${GRIP_CLASS} { display: none !important; }
  table[${FROZEN_ATTR}] { width: auto !important; min-width: 0 !important; table-layout: auto !important; }
  table[${FROZEN_ATTR}] > thead > tr > th, table[${FROZEN_ATTR}] > colgroup > col { width: auto !important; min-width: 0 !important; max-width: none !important; }
}
`;
    document.head.appendChild(style);
};

// An unsized trailing filler cell (the "100% + filler" pattern) is not a column.
const isFiller = (c: HTMLTableCellElement) =>
    c.getAttribute('aria-hidden') === 'true' && (c.textContent || '').trim() === '' && c.children.length === 0;

// The header row whose cells are the columns: exactly one <thead> row, no
// colspan/rowspan (grouped headers can't be sized cell by cell).
const headerCells = (table: HTMLTableElement): HTMLTableCellElement[] | null => {
    const thead = table.tHead;
    if (!thead || thead.rows.length !== 1) return null;
    const cells = (Array.from(thead.rows[0].cells) as HTMLTableCellElement[]).filter(c => !isFiller(c));
    if (cells.length < 2) return null;
    if (cells.some(c => c.colSpan > 1 || c.rowSpan > 1)) return null;
    return cells;
};

const isEligible = (table: HTMLTableElement): boolean => {
    if (table.closest('[data-resize="off"]')) return false;
    if (table.getAttribute('data-resize') === 'own') return false;
    // Tables that already size their own columns.
    if (table.querySelector(':scope > thead .pip-resize-handle, :scope > thead .om2-resize-handle, :scope > thead [data-col-resize]')) return false;
    return headerCells(table) !== null;
};

// A header's own text: no grip, no form controls (a <select>'s options),
// no hidden decorations; sort arrows and "(n)" counts dropped.
const headerText = (cell: HTMLTableCellElement): string => {
    const explicit = cell.getAttribute('data-col-key');
    if (explicit) return explicit;
    let text = '';
    const walk = (n: Node) => {
        if (n.nodeType === Node.TEXT_NODE) { text += n.nodeValue || ''; return; }
        if (!(n instanceof HTMLElement)) return;
        if (n.classList.contains(GRIP_CLASS) || n.getAttribute('aria-hidden') === 'true') return;
        if (/^(SELECT|OPTION|INPUT|TEXTAREA|BUTTON|SVG)$/i.test(n.tagName) && n !== cell) {
            // A sort button's label is still the column's name.
            if (n.tagName === 'BUTTON') n.childNodes.forEach(walk);
            return;
        }
        n.childNodes.forEach(walk);
    };
    walk(cell);
    return text.replace(/[↑↓↕▲▼⇅⬍⬆⬇]/g, '').replace(/\(\s*\d[\d,.]*\s*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
};

// Column keys: the header text, made unique; empty headers (checkbox,
// actions) fall back to their position.
const columnKeys = (cells: HTMLTableCellElement[]): string[] => {
    const seen = new Map<string, number>();
    return cells.map((c, i) => {
        const text = headerText(c) || `#${i}`;
        const n = seen.get(text) || 0;
        seen.set(text, n + 1);
        return n ? `${text}~${n}` : text;
    });
};

// The page, with record ids folded so /orders/123 and /orders/456 share widths.
const pagePath = () => location.pathname
    .split('/')
    .map(seg => (/^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg) ? ':id' : seg))
    .join('/');

// A table's storage key: the page plus data-resize-key, or else its first
// named columns (stable when optional columns further right come and go, and
// different for different tables on the same page or in its pop-ups).
const tableKey = (table: HTMLTableElement, cells: HTMLTableCellElement[]): string => {
    const explicit = table.getAttribute('data-resize-key') || table.closest('[data-resize-key]')?.getAttribute('data-resize-key');
    const id = explicit || columnKeys(cells).filter(k => !k.startsWith('#')).slice(0, 3).join('|') || `${cells.length}cols`;
    return `${STORAGE_PREFIX}${pagePath()}|${id}`;
};

const load = (key: string): Saved => {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
};
const save = (key: string, widths: Saved) => {
    try {
        localStorage.removeItem(key);
        if (Object.keys(widths).length === 0) return;
        localStorage.setItem(key, JSON.stringify(widths));
        // Keep the number of saved tables bounded (oldest first: localStorage
        // keeps insertion order for new keys, and a save re-inserts its key).
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
        }
        keys.slice(0, Math.max(0, keys.length - MAX_SAVED_TABLES)).forEach(k => localStorage.removeItem(k));
    } catch { /* storage full / blocked: widths just aren't kept */ }
};

// What a frozen table looked like before, and the widths it was frozen at.
interface FrozenState {
    cells: HTMLTableCellElement[];
    widths: number[];
    orig: {
        table: { width: string; minWidth: string; maxWidth: string; tableLayout: string };
        cells: { width: string; minWidth: string; maxWidth: string }[];
        cols: { col: HTMLTableColElement; width: string; minWidth: string; maxWidth: string }[];
    };
}
const frozen = new WeakMap<HTMLTableElement, FrozenState>();

// A fixed-layout table takes column widths from <col> elements before header
// cells, so when it has one <col> per header cell the width goes there too.
const colsOf = (table: HTMLTableElement, count: number): HTMLTableColElement[] | null => {
    const cols = Array.from(table.querySelectorAll(':scope > colgroup > col')) as HTMLTableColElement[];
    return cols.length >= count && cols.slice(0, count).every(c => c.span <= 1) ? cols.slice(0, count) : null;
};

const px = (n: number) => `${Math.round(n)}px`;

// Writes the frozen widths (also used to re-assert them after a re-render).
const apply = (table: HTMLTableElement, st: FrozenState) => {
    const cols = colsOf(table, st.cells.length);
    let total = 0;
    st.cells.forEach((c, i) => {
        const w = px(st.widths[i]);
        if (c.style.width !== w) { c.style.width = w; c.style.minWidth = w; c.style.maxWidth = w; }
        const col = cols?.[i];
        if (col && col.style.width !== w) { col.style.width = w; col.style.minWidth = w; col.style.maxWidth = w; }
        total += Math.round(st.widths[i]);
    });
    if (table.style.tableLayout !== 'fixed') table.style.tableLayout = 'fixed';
    if (table.style.width !== px(total)) table.style.width = px(total);
    if (table.style.minWidth !== '0px') table.style.minWidth = '0px';
    if (table.style.maxWidth !== 'none') table.style.maxWidth = 'none';
    if (!table.hasAttribute(FROZEN_ATTR)) table.setAttribute(FROZEN_ATTR, '');
};

// The app scales the page with CSS zoom on <body> (utils/bodyZoom);
// getBoundingClientRect widths are zoomed, style widths are not.
const layoutScale = (el: HTMLElement): number => {
    const w = el.getBoundingClientRect().width;
    return el.offsetWidth > 0 && w > 0 ? w / el.offsetWidth : 1;
};

const isRendered = (table: HTMLTableElement) => table.getClientRects().length > 0 && table.offsetWidth > 0;

// Fixes every column at its current (or saved) width.
const freeze = (table: HTMLTableElement, cells: HTMLTableCellElement[], saved: Saved) => {
    const prev = frozen.get(table);
    const cols = colsOf(table, cells.length) || [];
    const orig: FrozenState['orig'] = prev?.orig || {
        table: { width: table.style.width, minWidth: table.style.minWidth, maxWidth: table.style.maxWidth, tableLayout: table.style.tableLayout },
        cells: [],
        cols: cols.map(col => ({ col, width: col.style.width, minWidth: col.style.minWidth, maxWidth: col.style.maxWidth })),
    };
    orig.cells = cells.map(c => ({ width: c.style.width, minWidth: c.style.minWidth, maxWidth: c.style.maxWidth }));
    const keys = columnKeys(cells);
    // Measure everything before writing anything (one layout pass).
    const zoom = layoutScale(table);
    const measured = cells.map(c => c.getBoundingClientRect().width / zoom);
    // Columns keep their rendered width (a narrow checkbox column stays narrow);
    // MIN_WIDTH only limits how far a drag can shrink one.
    const widths = cells.map((_, i) => Math.max(8, Math.round(saved[keys[i]] ?? measured[i])));
    const st: FrozenState = { cells, widths, orig };
    frozen.set(table, st);
    apply(table, st);
};

const unfreeze = (table: HTMLTableElement) => {
    const st = frozen.get(table);
    if (st) {
        // Restore only what still holds the frozen value: anything React has
        // rewritten since is React's and stays.
        const setIf = (el: HTMLElement, prop: 'width' | 'minWidth' | 'maxWidth' | 'tableLayout', frozenVal: string, original: string) => {
            if (el.style[prop] === frozenVal) el.style[prop] = original;
        };
        let total = 0;
        st.cells.forEach((c, i) => {
            const w = px(st.widths[i]);
            total += Math.round(st.widths[i]);
            const o = st.orig.cells[i];
            if (!o) return;
            setIf(c, 'width', w, o.width); setIf(c, 'minWidth', w, o.minWidth); setIf(c, 'maxWidth', w, o.maxWidth);
        });
        st.orig.cols.forEach(({ col, width, minWidth, maxWidth }, i) => {
            const w = st.widths[i] !== undefined ? px(st.widths[i]) : '';
            setIf(col, 'width', w, width); setIf(col, 'minWidth', w, minWidth); setIf(col, 'maxWidth', w, maxWidth);
        });
        setIf(table, 'width', px(total), st.orig.table.width);
        setIf(table, 'minWidth', '0px', st.orig.table.minWidth);
        setIf(table, 'maxWidth', 'none', st.orig.table.maxWidth);
        setIf(table, 'tableLayout', 'fixed', st.orig.table.tableLayout);
        frozen.delete(table);
    }
    table.removeAttribute(FROZEN_ATTR);
};

const startDrag = (e: PointerEvent, table: HTMLTableElement, cell: HTMLTableCellElement, grip: HTMLElement) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    let moved = false;
    let ended = false;
    let st: FrozenState | undefined;
    let idx = -1;
    let zoom = 1;
    let startW = 0;
    try { grip.setPointerCapture(e.pointerId); } catch { /* not capturable */ }

    const onMove = (ev: PointerEvent) => {
        if (ended) return;
        const dx = ev.clientX - startX;
        if (!moved) {
            // A click (or a jitter) on a grip must not freeze the table.
            if (Math.abs(dx) < DRAG_THRESHOLD) return;
            const cells = headerCells(table);
            if (!cells || !cells.includes(cell)) { end(); return; }
            if (!frozen.has(table)) freeze(table, cells, load(tableKey(table, cells)));
            st = frozen.get(table);
            idx = st ? st.cells.indexOf(cell) : -1;
            if (!st || idx < 0) { end(); return; }
            zoom = layoutScale(table);
            startW = st.widths[idx];
            moved = true;
            grip.classList.add('rt-active');
            document.body.classList.add('rt-dragging');
        }
        if (!st) return;
        st.widths[idx] = Math.max(Math.min(MIN_WIDTH, startW), Math.round(startW + dx / zoom));
        apply(table, st);
    };
    // Ends the drag however it ends: released, cancelled, capture lost (the
    // grip was re-rendered away), or the window lost focus mid-drag.
    const end = () => {
        if (ended) return;
        ended = true;
        grip.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', end);
        grip.removeEventListener('pointercancel', end);
        grip.removeEventListener('lostpointercapture', end);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('blur', end);
        grip.classList.remove('rt-active');
        document.body.classList.remove('rt-dragging');
        if (moved && st) {
            const keys = columnKeys(st.cells);
            const widths: Saved = {};
            st.cells.forEach((_, i) => { widths[keys[i]] = Math.round(st!.widths[i]); });
            save(tableKey(table, st.cells), widths);
        }
    };
    grip.addEventListener('pointermove', onMove);
    window.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('lostpointercapture', end);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
};

const addGrip = (table: HTMLTableElement, cell: HTMLTableCellElement) => {
    if (cell.querySelector(`:scope > .${GRIP_CLASS}`)) return;
    cell.classList.add(HOST_CLASS);
    const grip = document.createElement('div');
    grip.className = GRIP_CLASS;
    grip.setAttribute('aria-hidden', 'true');
    grip.title = 'Drag to resize · double-click to reset';
    grip.addEventListener('pointerdown', e => startDrag(e, table, cell, grip));
    // The header may sort on click: a drag or a reset must not count as one.
    grip.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); });
    grip.addEventListener('dblclick', e => {
        e.stopPropagation();
        e.preventDefault();
        const cells = frozen.get(table)?.cells || headerCells(table);
        if (cells) save(tableKey(table, cells), {});
        unfreeze(table);
    });
    cell.appendChild(grip);
};

const removeGrips = (table: HTMLTableElement) => {
    table.querySelectorAll(`:scope > thead .${GRIP_CLASS}`).forEach(g => g.remove());
    table.querySelectorAll(`:scope > thead .${HOST_CLASS}`).forEach(c => c.classList.remove(HOST_CLASS));
};

// Saved widths are applied once per table element (and again if its columns
// change), only while it is actually on screen: measured inside display:none
// every column would come out 0.
const restored = new WeakSet<HTMLTableElement>();

const setup = (table: HTMLTableElement) => {
    if (!isEligible(table)) {
        if (table.hasAttribute('data-rt')) {
            removeGrips(table);
            unfreeze(table);
            table.removeAttribute('data-rt');
            restored.delete(table);
        }
        return;
    }
    table.setAttribute('data-rt', '');
    const cells = headerCells(table)!;
    cells.forEach(c => addGrip(table, c));
    const st = frozen.get(table);
    if (st) {
        const same = st.cells.length === cells.length && st.cells.every((c, i) => c === cells[i]);
        if (same) { apply(table, st); return; }
        // Columns added or removed since it was frozen: refit to the new set.
        unfreeze(table);
        restored.delete(table);
    }
    if (restored.has(table) || !isRendered(table)) return;
    restored.add(table);
    const saved = load(tableKey(table, cells));
    if (Object.keys(saved).length > 0) freeze(table, cells, saved);
};

let scheduled = false;
const scan = () => {
    scheduled = false;
    document.querySelectorAll('table').forEach(t => setup(t as HTMLTableElement));
};
// Before the next paint when the page is drawing; a timer as well, for when
// the browser holds animation frames back (background tab, hidden window).
const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const run = () => { if (scheduled) scan(); };
    requestAnimationFrame(run);
    setTimeout(run, 150);
};

let installed = false;
export function installResizableTables() {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    injectStyles();
    // Grips must not count as mutations we react to, or adding one would
    // schedule another scan forever. Attribute changes that matter (a header
    // gaining colspan, data-resize toggled, a hidden tab shown via class or
    // style) are watched too, but only on tables and their header cells.
    const observer = new MutationObserver(records => {
        for (const r of records) {
            if (r.type === 'childList') {
                const relevant = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)]
                    .some(n => !(n instanceof HTMLElement && n.classList.contains(GRIP_CLASS)));
                if (relevant) { schedule(); return; }
            } else if (r.type === 'attributes') {
                const t = r.target as HTMLElement;
                if (t.classList.contains(GRIP_CLASS)) continue;
                if (r.attributeName === 'style' || r.attributeName === 'class') {
                    // Only a table, header cell or a container that could hide
                    // or show one (cheap check: it contains a table).
                    if (t.tagName === 'TABLE' || t.tagName === 'TH' || t.tagName === 'COL' || t.querySelector?.('table')) { schedule(); return; }
                } else { schedule(); return; }
            }
        }
    });
    const start = () => {
        observer.observe(document.body, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['colspan', 'rowspan', 'data-resize', 'class', 'style', 'hidden', 'open'],
        });
        schedule();
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}
