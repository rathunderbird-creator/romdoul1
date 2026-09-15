// Orders Management 2 — "Add tracking IDs" bulk modal (spec §4.6/§7): the
// real daily batch job. One <input> per selected order in natural DOM order
// (so Tab already moves between them correctly), plus paste-a-column support
// so a user can copy a column of tracking numbers from a spreadsheet and
// paste once instead of typing each one by hand.
import React, { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent } from 'react';
import { X } from 'lucide-react';
import { D2, cardStyle } from '../../dashboard2/theme';
import { IN_HOUSE_COURIER } from '../metrics';
import type { Order } from '../metrics';

interface AddTrackingModalProps {
    isOpen: boolean;
    orders: Order[];
    onClose: () => void;
    onSave: (updates: Array<{ orderId: string; trackingNumber: string }>) => Promise<void>;
}

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${D2.border}`,
    fontSize: 13,
    color: D2.ink,
    background: D2.card,
    boxSizing: 'border-box',
};

const AddTrackingModal: React.FC<AddTrackingModalProps> = ({ isOpen, orders, onClose, onSave }) => {
    const [values, setValues] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

    // Re-seed local state from each order's current tracking number every time
    // the modal opens (the selection can differ from the last time it opened).
    useEffect(() => {
        if (!isOpen) return;
        const initial: Record<string, string> = {};
        orders.forEach(o => { initial[o.id] = o.shipping?.trackingNumber || ''; });
        setValues(initial);
        setError(null);
        inputRefs.current = orders.map(() => null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, saving, onClose]);

    if (!isOpen) return null;

    const isOwnDriver = (o: Order) => o.shipping?.company === IN_HOUSE_COURIER;

    // A row counts as a pending change only when it has an external courier,
    // a non-empty value, and that value differs from what was already saved.
    const rowHasChange = (o: Order): boolean => {
        if (isOwnDriver(o)) return false;
        const v = (values[o.id] ?? '').trim();
        if (v === '') return false;
        return v !== (o.shipping?.trackingNumber || '').trim();
    };
    const hasChanges = orders.some(rowHasChange);

    // Distribute a pasted column of tracking numbers across the inputs
    // starting at the pasted-into row (always row 0 — the handler is only
    // wired to the first input). Single-line pastes fall through to the
    // browser's normal paste behaviour.
    const handleFirstPaste = (e: ClipboardEvent<HTMLInputElement>) => {
        const text = e.clipboardData.getData('text');
        const lines = text.split(/\r?\n/);
        while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
        if (lines.length <= 1) return;
        e.preventDefault();
        setValues(prev => {
            const next = { ...prev };
            lines.forEach((line, offset) => {
                const order = orders[offset];
                if (!order || isOwnDriver(order)) return;
                next[order.id] = line.trim();
            });
            return next;
        });
        const lastIndex = Math.min(lines.length, orders.length) - 1;
        requestAnimationFrame(() => inputRefs.current[lastIndex]?.focus());
    };

    const handleSave = async () => {
        const updates = orders
            .filter(rowHasChange)
            .map(o => ({ orderId: o.id, trackingNumber: (values[o.id] ?? '').trim() }));
        if (updates.length === 0) return;
        setSaving(true);
        setError(null);
        try {
            await onSave(updates);
            // Caller closes the modal on success; keep it open (with the
            // user's input intact) if the save rejects.
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save tracking numbers.');
        } finally {
            setSaving(false);
        }
    };

    const requestClose = () => { if (!saving) onClose(); };

    return (
        <div
            onClick={requestClose}
            style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(17,24,39,0.45)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
            <div
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`Add tracking IDs - ${orders.length} order(s)`}
                style={{ ...cardStyle, width: 560, maxWidth: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 48px rgba(17,24,39,0.25)' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${D2.border}`, flexShrink: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: D2.ink }}>
                        Add tracking IDs - {orders.length} order(s)
                    </div>
                    <button
                        type="button"
                        onClick={requestClose}
                        aria-label="Close"
                        className="d2-clickable"
                        style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${D2.border}`, background: D2.card, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    >
                        <X size={16} />
                    </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {orders.map((order, index) => {
                        const ownDriver = isOwnDriver(order);
                        const customerName = order.customer?.name || 'Unknown';
                        const courier = order.shipping?.company || '—';
                        return (
                            <div key={order.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ width: 180, flexShrink: 0, minWidth: 0 }}>
                                    <div
                                        className="om2-khmer"
                                        title={customerName}
                                        style={{ fontSize: 13, fontWeight: 600, color: D2.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                    >
                                        {customerName}
                                    </div>
                                    <div
                                        className="om2-khmer"
                                        title={courier}
                                        style={{ fontSize: 11, color: D2.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                    >
                                        {courier}
                                    </div>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <input
                                        ref={el => { inputRefs.current[index] = el; }}
                                        type="text"
                                        data-order-index={index}
                                        value={ownDriver ? 'own driver - no tracking needed' : (values[order.id] ?? '')}
                                        placeholder="Tracking ID"
                                        disabled={ownDriver || saving}
                                        onChange={ownDriver ? undefined : (e: ChangeEvent<HTMLInputElement>) => setValues(prev => ({ ...prev, [order.id]: e.target.value }))}
                                        onPaste={index === 0 ? handleFirstPaste : undefined}
                                        style={{ ...inputStyle, ...(ownDriver ? { color: D2.muted, fontStyle: 'italic', background: '#f9fafb', cursor: 'not-allowed' } : {}) }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {error && (
                    <div role="alert" style={{ margin: '0 16px 12px', padding: '8px 10px', borderRadius: 8, background: D2.redBg, border: '1px solid #fecaca', color: D2.red, fontSize: 12, flexShrink: 0 }}>
                        {error}
                    </div>
                )}

                <div style={{ padding: 14, borderTop: `1px solid ${D2.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        style={{ padding: '10px 18px', borderRadius: 10, fontWeight: 600, fontSize: 13, border: `1px solid ${D2.border}`, background: D2.card, color: D2.ink, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="primary-button"
                        onClick={handleSave}
                        disabled={saving || !hasChanges}
                        style={{ padding: '10px 18px', borderRadius: 10, fontWeight: 600, fontSize: 13 }}
                    >
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddTrackingModal;
