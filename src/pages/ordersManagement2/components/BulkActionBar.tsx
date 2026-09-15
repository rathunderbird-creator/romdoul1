// Orders Management 2 — floating bulk action bar (spec §4.6). Appears once
// rows are selected; "Add tracking IDs" is the primary/emphasised action
// since it's the real daily batch job this page exists to speed up.
import React from 'react';
import { Truck, PackageCheck, Printer, Download, X, Pencil } from 'lucide-react';
import { D2, tabular } from '../../dashboard2/theme';
import type { Order } from '../metrics';

interface BulkActionBarProps {
    selectedOrders: Order[];
    onClear: () => void;
    onAddTracking: () => void;
    onMarkShipped: () => void;
    onBulkEdit: () => void;
    onPrint: () => void;
    onExport: () => void;
}

const secondaryBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px',
    borderRadius: 8, border: `1px solid ${D2.border}`, background: D2.card, color: D2.ink,
    fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
};

const BulkActionBar: React.FC<BulkActionBarProps> = ({ selectedOrders, onClear, onAddTracking, onMarkShipped, onBulkEdit, onPrint, onExport }) => {
    const count = selectedOrders.length;
    return (
        <div
            role="toolbar"
            aria-label="Bulk actions"
            style={{
                position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 1250,
                maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box',
                background: D2.card, border: `1px solid ${D2.border}`, borderRadius: 12,
                boxShadow: '0 12px 32px rgba(17,24,39,0.18)', padding: '10px 14px',
                display: 'flex', alignItems: 'center', gap: 10,
            }}
        >
            {/* Horizontal scroll instead of wrapping (spec §4.6) so the bar never
                grows tall enough to cover most of a narrow screen. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflowX: 'auto', whiteSpace: 'nowrap' }}>
                <span style={{ ...tabular, fontSize: 13, fontWeight: 700, color: D2.ink, flexShrink: 0 }}>
                    {count} selected
                </span>

                <span aria-hidden style={{ width: 1, height: 20, background: D2.border, flexShrink: 0 }} />

                <button
                    type="button"
                    onClick={onAddTracking}
                    className="primary-button d2-clickable om2-tap-target"
                    style={{ height: 34, padding: '0 14px', borderRadius: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                    <Truck size={15} aria-hidden /> Add tracking IDs
                </button>

                <button type="button" onClick={onMarkShipped} className="d2-clickable om2-tap-target" style={secondaryBtn}>
                    <PackageCheck size={15} aria-hidden /> Mark shipped
                </button>

                <button type="button" onClick={onBulkEdit} className="d2-clickable om2-tap-target" style={secondaryBtn}>
                    <Pencil size={15} aria-hidden /> Edit
                </button>

                <button type="button" onClick={onPrint} className="d2-clickable om2-tap-target" style={secondaryBtn}>
                    <Printer size={15} aria-hidden /> Print receipts
                </button>

                <button type="button" onClick={onExport} className="d2-clickable om2-tap-target" style={secondaryBtn}>
                    <Download size={15} aria-hidden /> Export
                </button>

                <button
                    type="button"
                    onClick={onClear}
                    aria-label="Clear selection"
                    title="Clear selection"
                    className="d2-clickable om2-tap-target"
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8, border: `1px solid ${D2.border}`, background: D2.card, color: D2.muted, flexShrink: 0 }}
                >
                    <X size={16} aria-hidden />
                </button>
            </div>
        </div>
    );
};

export default BulkActionBar;
