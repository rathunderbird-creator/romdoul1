// Small presentational pieces shared by the Profit & CPA Tracker tables.
import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { CpaStatus, Health, ProductStatus } from '../metrics';
import type { Translate } from '../types';
import { fmtMoney, fmtPct } from '../../pageIncomePrediction/format';

export const ACCENT = '#8B5CF6';

export const thStyle: React.CSSProperties = {
    borderBottom: '2px solid var(--color-border)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.5px', padding: '10px 10px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap',
    background: 'var(--color-surface)',
};

export const tdNum: React.CSSProperties = { padding: '7px 10px', textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap' };

// "$7.24" or "-" for null; negative money red, positive green when `signed`.
export const MoneyText: React.FC<{ value: number | null; signed?: boolean; bold?: boolean; muted?: boolean }> = ({ value, signed, bold, muted }) => {
    if (value === null || !Number.isFinite(value)) return <span style={{ color: 'var(--color-text-secondary)' }}>-</span>;
    const color = muted ? 'var(--color-text-secondary)'
        : signed ? (value < -0.005 ? '#EF4444' : value > 0.005 ? '#10B981' : 'var(--color-text-secondary)')
            : 'var(--color-text-main)';
    return <span style={{ color, fontWeight: bold ? 700 : 500 }}>{fmtMoney(value)}</span>;
};

export const PctText: React.FC<{ value: number | null; signed?: boolean }> = ({ value, signed }) => {
    const color = !signed || value === null ? 'var(--color-text-main)' : value < -0.0005 ? '#EF4444' : value > 0.0005 ? '#10B981' : 'var(--color-text-secondary)';
    return <span style={{ color: value === null ? 'var(--color-text-secondary)' : color }}>{value === null ? '-' : fmtPct(value)}</span>;
};

type AnyStatus = CpaStatus | Health | ProductStatus;

const STATUS_STYLE: Record<AnyStatus, { fg: string; bg: string }> = {
    'on-target': { fg: '#047857', bg: 'rgba(16,185,129,0.12)' },
    healthy: { fg: '#047857', bg: 'rgba(16,185,129,0.12)' },
    winner: { fg: '#047857', bg: 'rgba(16,185,129,0.12)' },
    squeeze: { fg: '#B45309', bg: 'rgba(245,158,11,0.14)' },
    loss: { fg: '#B91C1C', bg: 'rgba(239,68,68,0.12)' },
    'at-risk': { fg: '#B91C1C', bg: 'rgba(239,68,68,0.12)' },
    refresh: { fg: '#B91C1C', bg: 'rgba(239,68,68,0.12)' },
    pending: { fg: '#1D4ED8', bg: 'rgba(59,130,246,0.12)' },
    organic: { fg: '#475569', bg: 'rgba(100,116,139,0.12)' },
    none: { fg: 'var(--color-text-secondary)', bg: 'transparent' },
};

export const StatusChip: React.FC<{ status: AnyStatus; t: Translate; title?: string }> = ({ status, t, title }) => {
    const s = STATUS_STYLE[status];
    if (status === 'none' || !s) return <span style={{ color: 'var(--color-text-secondary)' }}>-</span>;
    return (
        <span title={title} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: s.fg, background: s.bg, whiteSpace: 'nowrap' }}>
            {t(`cpaTracker.status.${status}`)}
        </span>
    );
};

export const KpiCard: React.FC<{ label: string; value: string; hint?: React.ReactNode; rgb: string; icon: React.ReactNode; title?: string }> = ({ label, value, hint, rgb, icon, title }) => (
    <div className="glass-panel" title={title} style={{ padding: 12, borderRadius: 12, background: `linear-gradient(135deg, rgba(${rgb},0.08), rgba(${rgb},0.02))`, border: `1px solid rgba(${rgb},0.15)`, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            {/* Wraps (2 lines max) so similar labels stay distinguishable on a phone. */}
            <span title={label} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minWidth: 0 }}>{label}</span>
            <div style={{ padding: 4, borderRadius: 6, background: `rgba(${rgb},0.12)`, display: 'flex', flexShrink: 0 }}>{icon}</div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: `rgb(${rgb})`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
        {/* Wraps instead of truncating: on a phone the hint carries figures
            (e.g. the delivery rate) that would otherwise never be visible. */}
        {hint !== undefined && <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', lineHeight: 1.35 }}>{hint}</div>}
    </div>
);

export const Banner: React.FC<{ tone: 'amber' | 'red' | 'grey'; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }> = ({ tone, icon, children, action }) => {
    const c = tone === 'red'
        ? { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)', fg: '#B91C1C' }
        : tone === 'amber'
            ? { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.35)', fg: '#B45309' }
            : { bg: 'rgba(107,114,128,0.08)', border: 'var(--color-border)', fg: 'var(--color-text-secondary)' };
    return (
        <div role={tone === 'red' ? 'alert' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: c.bg, border: `1px solid ${c.border}`, color: c.fg, fontSize: 13, flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
            {action}
        </div>
    );
};

// Spreadsheet-style number cell: type, then blur or Enter to commit; Escape
// reverts. Empty commits null ("nothing entered" / "use the counted number").
// `integer` rounds and rejects decimals; `percent` shows 0..1 as 0..100.
export interface EditableNumberCellProps {
    value: number | null;
    placeholder?: string;
    placeholderTitle?: string;
    disabled: boolean;
    saving: boolean;
    saved: boolean;
    ariaLabel: string;
    prefix?: string;
    suffix?: string;
    integer?: boolean;
    percent?: boolean;
    max?: number;              // in displayed units
    minWidth?: number;
    onCommit: (value: number | null) => Promise<void>;
}

export const EditableNumberCell: React.FC<EditableNumberCellProps> = ({ value, placeholder, placeholderTitle, disabled, saving, saved, ariaLabel, prefix, suffix, integer, percent, max, minWidth = 64, onCommit }) => {
    const shown = (v: number | null): string => {
        if (v === null || !Number.isFinite(v)) return '';
        const d = percent ? v * 100 : v;
        return integer ? String(Math.round(d)) : String(Math.round(d * 100) / 100);
    };
    const [draft, setDraft] = useState(() => shown(value));
    useEffect(() => { setDraft(shown(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
    // Escape's imperative blur would otherwise commit the pre-revert draft
    // (see pageIncomePrediction/components/EditableMoneyCell.tsx).
    const skipNextCommitRef = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const commit = () => {
        if (skipNextCommitRef.current) { skipNextCommitRef.current = false; return; }
        const el = inputRef.current;
        const revert = () => {
            setDraft(shown(value));
            // A malformed number ("45-", "4..5") keeps showing in a type=number
            // box even though React's value is '' — reset the DOM text too.
            if (el) el.value = shown(value);
        };
        // A malformed number reads as '' from a type=number input: that must
        // revert, never be taken as "cleared" (which would delete the value).
        if (el?.validity.badInput) { revert(); return; }
        const trimmed = draft.trim();
        if (trimmed === '') {
            if (value !== null) onCommit(null).catch(revert);
            return;
        }
        let n = Number(trimmed);
        if (!Number.isFinite(n) || n < 0 || (max !== undefined && n > max)) { revert(); return; }
        if (integer) n = Math.round(n);
        const stored = percent ? n / 100 : n;
        if (value !== null && shown(stored) === shown(value)) { setDraft(shown(value)); return; }
        onCommit(stored).catch(revert);
    };

    const filled = draft.trim() !== '';
    const border = filled ? `${ACCENT}55` : 'var(--color-border)';
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }} onClick={e => e.stopPropagation()}>
            {saving && <Loader2 size={12} className="pip-spin" style={{ color: ACCENT, flexShrink: 0 }} aria-hidden />}
            {saved && !saving && <Check size={12} style={{ color: '#10B981', flexShrink: 0 }} aria-hidden />}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth }}>
                {prefix && <span aria-hidden style={{ position: 'absolute', left: 6, color: 'var(--color-text-secondary)', fontSize: 11, pointerEvents: 'none', opacity: 0.6 }}>{prefix}</span>}
                <input
                    ref={inputRef}
                    type="number"
                    inputMode={integer ? 'numeric' : 'decimal'}
                    min={0}
                    step={integer ? 1 : 0.01}
                    className="pip-input"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') {
                            const el = e.target as HTMLInputElement;
                            skipNextCommitRef.current = true;
                            setDraft(shown(value));
                            el.value = shown(value);   // also clears malformed text React can't see
                            el.blur();
                        }
                    }}
                    placeholder={placeholder ?? '0'}
                    title={!filled ? placeholderTitle : undefined}
                    aria-label={ariaLabel}
                    disabled={disabled}
                    style={{
                        width: '100%', boxSizing: 'border-box', textAlign: 'right',
                        padding: `5px ${suffix ? 18 : 8}px 5px ${prefix ? 16 : 8}px`,
                        borderRadius: 6, border: `1px solid ${border}`,
                        background: filled ? `${ACCENT}0D` : 'var(--color-background)',
                        color: 'var(--color-text-main)', fontSize: 12, outline: 'none',
                        fontWeight: filled ? 700 : 400, opacity: disabled ? 0.6 : 1,
                    }}
                />
                {suffix && <span aria-hidden style={{ position: 'absolute', right: 6, color: 'var(--color-text-secondary)', fontSize: 11, pointerEvents: 'none', opacity: 0.7 }}>{suffix}</span>}
            </div>
        </div>
    );
};

// Per-cell saving spinner + 2 s "saved" flash, keyed by any string. The
// latest request per key wins, so a stale save settling late can't clear the
// spinner of — or flash "saved" over — a newer one still in flight.
export const useCellSaveState = () => {
    const [saving, setSaving] = useState<Set<string>>(new Set());
    const [saved, setSaved] = useState<Set<string>>(new Set());
    const timers = useRef<number[]>([]);
    const latest = useRef<Map<string, number>>(new Map());
    useEffect(() => () => { timers.current.forEach(id => window.clearTimeout(id)); }, []);

    const run = async (key: string, task: () => Promise<void>): Promise<void> => {
        const my = (latest.current.get(key) ?? 0) + 1;
        latest.current.set(key, my);
        setSaving(prev => new Set(prev).add(key));
        setSaved(prev => { const n = new Set(prev); n.delete(key); return n; });
        try {
            await task();
            if (latest.current.get(key) !== my) return;
            setSaved(prev => new Set(prev).add(key));
            timers.current.push(window.setTimeout(() => {
                if (latest.current.get(key) !== my) return;
                setSaved(prev => { const n = new Set(prev); n.delete(key); return n; });
            }, 2000));
        } finally {
            if (latest.current.get(key) === my) setSaving(prev => { const n = new Set(prev); n.delete(key); return n; });
        }
    };
    return { saving, saved, run };
};
