// Multi-select dropdown for list filters, the same shape as Purchase
// Orders' supplier filter: the trigger summarises the selection, the menu
// lists one checkbox row per option with its entry count; none ticked = all.
// Used by Revenue & Expense (source + account) and Journal Entries (area).
// The menu is position:fixed because those pages' cards clip overflow
// (overflow:hidden for rounded corners) and would cut the menu off over a
// short list — fixed can't track the trigger, so it closes on scroll or
// resize instead of drifting.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';

export type FilterOption = { key: string; label: string; count: number; title?: string };
const MENU_WIDTH = 260;
// Only one filter menu open at a time. useClickOutside alone can't guarantee
// that: activating the sibling's trigger by keyboard fires click without any
// mousedown, so the first menu would stay open underneath the second.
let closeOpenFilterMenu: (() => void) | null = null;

const FilterDropdown: React.FC<{
    allLabel: string;      // e.g. 'All Sources' — the trigger text when nothing is ticked
    noun: string;          // 'source' / 'account' / 'area', for the "2 sources" summary
    options: FilterOption[];
    selected: ReadonlySet<string>;
    onToggle: (key: string) => void;
    onClear: () => void;
    emptyTitle: string;    // tooltip on a zero-count, unticked row
}> = ({ allLabel, noun, options, selected, onToggle, onClear, emptyTitle }) => {
    const [open, setOpen] = useState(false);
    const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number }>({ top: 0, left: 0, maxHeight: 320 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    // Closing paths other than Escape (outside click, scroll, resize) can
    // unmount the menu while keyboard focus is inside it, which would strand
    // focus on <body> — hand it back to the trigger first.
    const closeMenu = useCallback(() => {
        const ae = document.activeElement;
        if (ae && menuRef.current?.contains(ae)) triggerRef.current?.focus();
        setOpen(false);
    }, []);
    const wrapRef = useClickOutside<HTMLDivElement>(closeMenu);

    const placeMenu = () => {
        const r = triggerRef.current?.getBoundingClientRect();
        if (!r) return;
        const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8));
        const below = window.innerHeight - r.bottom - 16;
        // Open upward when the trigger sits too close to the bottom edge
        // for a usable menu (phones; a scrolled-down filter bar).
        if (below < 180 && r.top > below) {
            setMenuPos({ bottom: window.innerHeight - r.top + 4, left, maxHeight: Math.max(140, Math.min(320, r.top - 16)) });
        } else {
            setMenuPos({ top: r.bottom + 4, left, maxHeight: Math.max(140, Math.min(320, below)) });
        }
    };
    const openMenu = () => {
        placeMenu();
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return;
        if (closeOpenFilterMenu && closeOpenFilterMenu !== closeMenu) closeOpenFilterMenu();
        closeOpenFilterMenu = closeMenu;
        const onScroll = (e: Event) => {
            // The menu scrolls internally (overflowY auto) — only an OUTSIDE
            // scroll moves the trigger away from the fixed menu.
            if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
            closeMenu();
        };
        // Capture phase so scrolling inside any ancestor container counts too.
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', closeMenu);
        return () => {
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', closeMenu);
            if (closeOpenFilterMenu === closeMenu) closeOpenFilterMenu = null;
        };
    }, [open, closeMenu]);

    // Ticking an option can reshape the page (a collapsing scrollbar, the
    // trigger's own label growing), moving the trigger without any scroll or
    // resize event — re-anchor the fixed menu after such renders.
    useEffect(() => {
        if (!open) return;
        // After paint, so the measurement sees the settled layout (the
        // scrollbar collapse happens in the same commit as the tick).
        const raf = requestAnimationFrame(placeMenu);
        return () => cancelAnimationFrame(raf);
    }, [open, selected]);

    const picked = options.filter(o => selected.has(o.key));
    // active/summary key off the SELECTION, not off `picked`: a stale
    // selected key with no matching option (say, an account that has been
    // deactivated) still filters the list, so the trigger must not dress
    // itself as "All …" while rows are being held back.
    const active = selected.size > 0;
    const summary = !active ? allLabel
        : picked.length === 1 && selected.size === 1 ? picked[0].label
        : `${selected.size} ${noun}${selected.size === 1 ? '' : 's'}`;

    return (
        <div
            ref={wrapRef}
            onKeyDown={e => {
                if (e.key === 'Escape' && open) {
                    e.stopPropagation();
                    setOpen(false);
                    triggerRef.current?.focus();
                }
            }}
        >
            <button
                ref={triggerRef}
                onClick={() => (open ? setOpen(false) : openMenu())}
                // No aria-haspopup: "true" means role=menu with arrow-key
                // semantics, and this opens a plain group of checkboxes.
                aria-expanded={open}
                // The visible text is just the summary ("Retail") — the name
                // carries the facet so a Tab stop still says what it filters.
                aria-label={`Filter by ${noun}: ${summary}`}
                className="d2-khmer"
                title={`Filter by ${noun} — tick one or more`}
                style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 12px', borderRadius: '9px',
                    // The JE area chips' blue — white text passes contrast on
                    // it; the page accents don't.
                    border: active ? '1px solid #5469d4' : '1px solid var(--color-border)',
                    background: active ? '#5469d4' : 'var(--color-surface)',
                    color: active ? 'white' : 'var(--color-text-secondary)',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer', maxWidth: '220px', whiteSpace: 'nowrap',
                }}
            >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>
                <ChevronDown size={14} style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
            {open && (
                <div ref={menuRef} role="group" aria-label={`Filter by ${noun}`} style={{
                    position: 'fixed', top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, zIndex: 900,
                    width: MENU_WIDTH, maxHeight: menuPos.maxHeight, overflowY: 'auto',
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: '6px',
                }}>
                    <button
                        onClick={onClear}
                        // Without this the row's ticked state is a bare svg —
                        // visual only; pressed = "showing everything".
                        aria-pressed={selected.size === 0}
                        className="d2-khmer"
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                            padding: '8px 10px', borderRadius: '8px', border: 'none', textAlign: 'left',
                            background: selected.size === 0 ? 'rgba(84, 105, 212, 0.12)' : 'transparent',
                            color: 'var(--color-text-main)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                        }}
                    >
                        {selected.size === 0 ? <Check size={14} style={{ flexShrink: 0 }} /> : <span style={{ width: 14, flexShrink: 0 }} />}
                        {allLabel}
                    </button>
                    {options.map(o => {
                        const checked = selected.has(o.key);
                        const empty = !checked && o.count === 0;
                        return (
                            <label
                                key={o.key}
                                title={empty ? emptyTitle : o.title || o.label}
                                className="d2-khmer"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    padding: '8px 10px', borderRadius: '8px',
                                    cursor: empty ? 'default' : 'pointer', opacity: empty ? 0.45 : 1,
                                    fontSize: '13px', color: 'var(--color-text-main)',
                                    background: checked ? 'rgba(84, 105, 212, 0.12)' : 'transparent',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    // aria-disabled + a no-op handler instead
                                    // of disabled: flipping disabled onto the
                                    // focused checkbox (unticking a row whose
                                    // cross-count is 0) would silently throw
                                    // keyboard focus to <body>.
                                    aria-disabled={empty}
                                    onChange={() => { if (!empty) onToggle(o.key); }}
                                    style={{ accentColor: '#5469d4', cursor: empty ? 'default' : 'pointer', flexShrink: 0 }}
                                />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{o.label}</span>
                                <span style={{
                                    marginLeft: 'auto', flexShrink: 0, fontSize: '11px', fontWeight: 700,
                                    fontVariantNumeric: 'tabular-nums', padding: '1px 7px', borderRadius: '12px',
                                    background: 'var(--color-bg)', color: 'var(--color-text-muted)',
                                }}>{o.count.toLocaleString()}</span>
                            </label>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default FilterDropdown;
