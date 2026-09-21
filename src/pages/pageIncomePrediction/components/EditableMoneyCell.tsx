import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { roundCents } from '../metrics';

export interface EditableMoneyCellProps {
    value: number | null;          // stored value; null = nothing entered
    placeholder?: string;          // shown when empty (e.g. the computed shipping)
    placeholderTitle?: string;
    disabled: boolean;
    saving: boolean;
    saved: boolean;                // brief "saved" flash
    color: string;                 // accent for a filled cell
    ariaLabel: string;
    warnAbove?: number;            // e.g. 2000 — a riel figure typed into a dollar field
    warnTitle?: string;
    // Rejects when the save failed — the cell then reverts to `value`.
    onCommit: (value: number | null) => Promise<void>;
}

// Spreadsheet-style cell: type, then blur or press Enter to commit. An
// emptied cell commits null (= "nothing entered"); an unparseable draft
// reverts. Nothing is sent when the value didn't change.
const EditableMoneyCell: React.FC<EditableMoneyCellProps> = ({ value, placeholder, placeholderTitle, disabled, saving, saved, color, ariaLabel, warnAbove, warnTitle, onCommit }) => {
    // Whole cents only — a computed total like 0.1 + 0.2 must not surface as
    // "0.30000000000000004" in the box (callers round too; this is the guard
    // for anything they miss).
    const toText = (v: number | null): string => (v === null ? '' : String(roundCents(v)));
    const [draft, setDraft] = useState(() => toText(value));
    // Follow external changes (refresh, a failed save reverting the row).
    useEffect(() => { setDraft(toText(value)); }, [value]);

    // Escape reverts the draft and blurs to leave the cell — but calling
    // .blur() imperatively fires a native 'blur' event synchronously, nested
    // inside this same keydown handler. React batches that nested dispatch
    // until the outer handler unwinds, so onBlur/commit would otherwise still
    // close over the pre-Escape `draft` (the setDraft revert above it is only
    // queued, not yet applied) and commit the value Escape was meant to
    // discard. This ref, set synchronously before .blur(), lets commit()
    // detect "this blur is the Escape-triggered one" and skip it outright.
    const skipNextCommitRef = useRef(false);

    const commit = () => {
        if (skipNextCommitRef.current) { skipNextCommitRef.current = false; return; }
        const trimmed = draft.trim();
        const revert = () => setDraft(toText(value));
        if (trimmed === '') {
            if (value !== null) onCommit(null).catch(revert);
            return;
        }
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 0) { revert(); return; }
        // Compared in cents: the box shows `value` rounded to cents, so a
        // focus-then-blur with no edit must not count as a change (and write
        // the rounded figure over a stored sub-cent one).
        if (value !== null && roundCents(n) === roundCents(value)) return;
        onCommit(n).catch(revert);
    };

    const filled = draft.trim() !== '';
    const warn = warnAbove !== undefined && filled && Number(draft) > warnAbove;
    const border = warn ? '#F59E0B' : filled ? `${color}40` : 'var(--color-border)';

    return (
        // Clicks/keys stopped from bubbling: some callers (the Overview table)
        // put this cell inside a row that's itself clickable/keyboard-activable
        // for navigation — without this, focusing or committing the input would
        // also fire the row's onClick/onKeyDown and navigate away mid-edit.
        // Harmless where the row isn't clickable (the daily ledger).
        <td style={{ padding: '2px 6px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                {saving && <Loader2 size={12} className="pip-spin" style={{ color, flexShrink: 0 }} aria-hidden />}
                {saved && !saving && <Check size={12} style={{ color: '#10B981', flexShrink: 0 }} aria-hidden />}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth: 60 }}>
                    <span aria-hidden style={{ position: 'absolute', left: 6, color: 'var(--color-text-secondary)', fontSize: 11, pointerEvents: 'none', opacity: 0.6 }}>$</span>
                    <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        className="pip-input"
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={commit}
                        onKeyDown={e => {
                            e.stopPropagation();
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') {
                                skipNextCommitRef.current = true;
                                setDraft(toText(value));
                                (e.target as HTMLInputElement).blur();
                            }
                        }}
                        placeholder={placeholder ?? '0'}
                        title={warn ? warnTitle : (!filled ? placeholderTitle : undefined)}
                        aria-label={ariaLabel}
                        disabled={disabled}
                        style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            textAlign: 'right',
                            padding: '5px 8px 5px 18px',
                            borderRadius: 6,
                            border: `1px solid ${border}`,
                            background: warn ? 'rgba(245,158,11,0.08)' : filled ? `${color}08` : 'var(--color-background)',
                            color: 'var(--color-text-main)',
                            fontSize: 13,
                            outline: 'none',
                            fontWeight: filled ? 600 : 400,
                            opacity: disabled ? 0.6 : 1,
                            transition: 'all 0.2s',
                        }}
                        onFocus={e => { e.target.style.borderColor = color; e.target.style.boxShadow = `0 0 0 2px ${color}20`; }}
                        onBlurCapture={e => { e.target.style.boxShadow = ''; e.target.style.borderColor = border; }}
                    />
                </div>
            </div>
        </td>
    );
};

export default EditableMoneyCell;
