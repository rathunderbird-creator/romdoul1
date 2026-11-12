// The app scales the whole UI with CSS `zoom` on <body> (index.css's compact
// desktop scale times the Text Size setting in ThemeContext). getBoundingClientRect
// reports screen pixels, but `top`/`left` set on an element inside the zoomed
// body are multiplied by that zoom again — so a popup portalled into <body> and
// placed at a rect's coordinates lands short (at 0.88× the distance on a default
// desktop), drifting further from its anchor the lower/righter the anchor is.
// Divide screen coordinates by this before using them as body coordinates.
export const bodyZoom = (): number => {
    if (typeof document === 'undefined' || !document.body) return 1;
    const z = parseFloat(getComputedStyle(document.body).zoom || '1');
    return Number.isFinite(z) && z > 0 ? z : 1;
};

// Screen-pixel value → the CSS value that puts something there inside <body>.
export const toBodyPx = (screenPx: number): number => screenPx / bodyZoom();
