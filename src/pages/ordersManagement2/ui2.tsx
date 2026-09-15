// Orders Management 2 — primitives specific to this page, on top of Dashboard
// 2's shared Card/Chip/EmptyState/ErrorInline/Skeleton/useLocalStorageState
// (../dashboard2/ui.tsx) and design tokens (../dashboard2/theme.ts). Kept in
// its own module so both screens can evolve their own tables/drawers without
// duplicating the tokens or the small stateful helpers.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { D2 } from '../dashboard2/theme';
import type { PillTone } from './types';
import { paramsToFilters, filtersToParams, DEFAULT_FILTERS, type OM2Filters } from './urlFilters';

// ─── Muted pills (spec §5: tinted bg + darker text + 1px border of the same
// hue — never fully saturated; saturated red is reserved for genuine
// exceptions like missing tracking). ─────────────────────────────────────

export const TONE_STYLE: Record<PillTone, { bg: string; fg: string; border: string }> = {
    neutral: { bg: '#f1f3f7', fg: D2.muted, border: '#e5e7eb' },
    amber: { bg: D2.amberBg, fg: D2.amber, border: '#fde3c4' },
    red: { bg: D2.redBg, fg: D2.red, border: '#fecaca' },
    green: { bg: D2.greenBg, fg: D2.green, border: '#bbf0da' },
    blue: { bg: D2.blueBg, fg: D2.blue, border: '#c8dcfb' },
    violet: { bg: D2.violetBg, fg: D2.violet, border: '#ddd0fb' },
};

// A genuine-exception pill (missing tracking): saturated, not muted.
export const AlertPill: React.FC<{ children: React.ReactNode; icon?: React.ReactNode; title?: string }> = ({ children, icon, title }) => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: '#fff', background: D2.redLine, whiteSpace: 'nowrap' }}>
        {icon}{children}
    </span>
);

export const MutedPill: React.FC<{ children: React.ReactNode; tone?: PillTone; title?: string; style?: React.CSSProperties }> = ({ children, tone = 'neutral', title, style }) => {
    const s = TONE_STYLE[tone];
    return (
        <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: s.fg, background: s.bg, border: `1px solid ${s.border}`, whiteSpace: 'nowrap', ...style }}>
            {children}
        </span>
    );
};

export const ORDER_STATUS_TONE: Record<string, PillTone> = {
    Pending: 'amber', Confirmed: 'blue', Shipped: 'violet', Delivered: 'green',
    Drafted: 'neutral', Cancelled: 'neutral', Returned: 'red', ReStock: 'blue',
};
export const PAY_STATUS_TONE: Record<string, PillTone> = {
    Unpaid: 'amber', Deposit: 'violet', Paid: 'green', Cancel: 'neutral', 'Get File': 'blue',
};

// ─── Filters <-> URL (react-router binding for ../urlFilters) ─────────────

export const useUrlFilters = (): [OM2Filters, (next: OM2Filters | ((prev: OM2Filters) => OM2Filters)) => void] => {
    const [params, setParams] = useSearchParams();
    const filters = paramsToFilters(params);
    const filtersRef = useRef(filters);
    filtersRef.current = filters;
    const setFilters = useCallback((next: OM2Filters | ((prev: OM2Filters) => OM2Filters)) => {
        const resolved = typeof next === 'function' ? (next as (p: OM2Filters) => OM2Filters)(filtersRef.current) : next;
        setParams(filtersToParams(resolved), { replace: true });
    }, [setParams]);
    return [filters, setFilters];
};

export { DEFAULT_FILTERS };

// ─── Right-side drawer shell (spec §4.5) ───────────────────────────────────

export const DrawerShell: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    title: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    // Extra buttons in the header row, between the title and Close — for an
    // action (e.g. Print) that belongs with the drawer at all times rather
    // than only after scrolling to a footer at the bottom.
    headerActions?: React.ReactNode;
    // Returning true blocks the close (e.g. unsaved changes) — caller shows its own prompt.
    onBeforeClose?: () => boolean;
    width?: number;
}> = ({ isOpen, onClose, title, children, footer, headerActions, onBeforeClose, width = 480 }) => {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const requestClose = useCallback(() => {
        // onBeforeClose returning true BLOCKS the close (per its own doc
        // comment above) — no "!" here; that inversion previously made the
        // drawer refuse to close whenever there were NO unsaved changes
        // (the common case) and close silently without confirming when
        // there WERE.
        if (onBeforeClose && onBeforeClose()) return;
        onClose();
    }, [onBeforeClose, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        closeButtonRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, requestClose]);

    if (!isOpen) return null;
    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1300 }} role="presentation">
            <div onClick={requestClose} style={{ position: 'absolute', inset: 0, background: 'rgba(17,24,39,0.45)' }} />
            <div
                role="dialog"
                aria-modal="true"
                aria-label={typeof title === 'string' ? title : undefined}
                style={{
                    position: 'absolute', top: 0, right: 0, bottom: 0, width: `min(${width}px, 100vw)`,
                    background: D2.card, boxShadow: '-12px 0 32px rgba(17,24,39,0.18)',
                    display: 'flex', flexDirection: 'column',
                    animation: 'om2-drawer-in 0.2s ease-out',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '14px 16px', borderBottom: `1px solid ${D2.border}` }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: D2.ink, minWidth: 0, flex: 1 }}>{title}</div>
                    {headerActions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{headerActions}</div>}
                    <button ref={closeButtonRef} type="button" onClick={requestClose} aria-label="Close" title="Close (Esc)" className="d2-clickable" style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${D2.border}`, background: D2.card, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <X size={16} />
                    </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>{children}</div>
                {footer && <div style={{ padding: 14, borderTop: `1px solid ${D2.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>{footer}</div>}
            </div>
            <style>{'@keyframes om2-drawer-in { from { transform: translateX(24px); opacity: .6 } to { transform: translateX(0); opacity: 1 } }'}</style>
        </div>
    );
};

// ─── Undo toast (spec §4.5: ~10s window after a status change) ────────────

export interface UndoToastHandle { show: (message: string, onUndo: () => void) => void }

export const UndoToast: React.FC<{ handleRef: React.MutableRefObject<UndoToastHandle | null> }> = ({ handleRef }) => {
    const [state, setState] = useState<{ message: string; onUndo: () => void; key: number } | null>(null);
    const [remaining, setRemaining] = useState(10);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        handleRef.current = {
            show: (message, onUndo) => {
                if (timerRef.current) clearInterval(timerRef.current);
                if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
                setState({ message, onUndo, key: Date.now() });
                setRemaining(10);
                timerRef.current = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);
                hideTimerRef.current = setTimeout(() => { setState(null); if (timerRef.current) clearInterval(timerRef.current); }, 10000);
            },
        };
        return () => { if (timerRef.current) clearInterval(timerRef.current); if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
    }, [handleRef]);

    if (!state) return null;
    return (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 1400, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: '#111827', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', fontSize: 13 }}>
            <span>{state.message}</span>
            <button
                type="button"
                onClick={() => { state.onUndo(); setState(null); if (timerRef.current) clearInterval(timerRef.current); }}
                style={{ background: 'none', border: '1px solid rgba(255,255,255,0.35)', color: '#fff', borderRadius: 6, padding: '4px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
            >
                Undo ({remaining}s)
            </button>
        </div>
    );
};

// ─── Copy to clipboard (spec §6.7) ─────────────────────────────────────────

export const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
};
