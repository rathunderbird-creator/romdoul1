import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { usePortalPosition } from '../hooks/usePortalPosition';
import { useTx } from './useTx';

interface PaymentStatusBadgeProps {
    status: string;
    onChange?: (status: string) => void;
    readOnly?: boolean;
    disabledOptions?: string[];
    bold?: boolean;
    // A Salesman's deposit/payment not yet confirmed as received: the status
    // shows in gray (with this tooltip) until someone confirms it.
    unconfirmed?: string;
}

const PaymentStatusBadge: React.FC<PaymentStatusBadgeProps> = ({ status, onChange, readOnly = false, disabledOptions = [], bold = true, unconfirmed }) => {
    const [isOpen, setIsOpen] = useState(false);
    const tx = useTx();
    // Display labels only: the stored values (options, status) stay English.
    const extraLabels: Record<string, string> = {
        Settled: tx('ui.components.payStatus.settled', 'Settled'),
        'Not Settle': tx('ui.components.payStatus.notSettle', 'Not Settle'),
        Pending: tx('status.pending', 'Pending'),
    };
    const payLabel = (s: string) => extraLabels[s] ?? tx(`dashboard2.pay.${s}`, s);
    const pdFeeTitle = tx('ui.components.payStatus.pdFeeTitle', 'Paid for Delivery Fee');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    // In the zoomed body's coordinates, flipped above when there's no room below.
    const position = usePortalPosition(dropdownRef, popupRef, isOpen && !readOnly);

    const getStatusStyle = (s: string) => {
        switch (s) {
            case 'Paid': return { bg: '#D1FAE5', color: '#059669', border: '#6EE7B7' }; // Green
            case 'PdFee': return { bg: '#CFFAFE', color: '#0E7490', border: '#67E8F9' }; // Teal
            case 'Deposit': return { bg: '#F3E8FF', color: '#7E22CE', border: '#D8B4FE' }; // Purple
            case 'Get File': return { bg: '#DBEAFE', color: '#1D4ED8', border: '#93C5FD' }; // Blue
            case 'Collected': return { bg: '#ECFCCB', color: '#4D7C0F', border: '#BEF264' }; // Lime
            case 'Unpaid': return { bg: '#FEE2E2', color: '#DC2626', border: '#FCA5A5' }; // Red
            case 'Settled': return { bg: '#E0E7FF', color: '#4F46E5', border: '#A5B4FC' }; // Indigo
            case 'Not Settle': return { bg: '#FEE2E2', color: '#DC2626', border: '#FCA5A5' }; // Red
            case 'Cancel': return { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' }; // Dark Red
            case 'Pending': return { bg: '#FEF3C7', color: '#D97706', border: '#FCD34D' }; // Yellow/Orange
            default: return { bg: 'var(--color-surface-hover)', color: '#4B5563', border: '#D1D5DB' };
        }
    };

    const style = unconfirmed ? { bg: '#F3F4F6', color: '#6B7280', border: '#D1D5DB' } : getStatusStyle(status);

    const badgeStyle: React.CSSProperties = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 8px 4px 12px',
        borderRadius: '9999px',
        fontSize: 'inherit',
        fontWeight: bold ? 600 : 400,
        backgroundColor: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
        cursor: readOnly ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
        minWidth: '80px',
        position: 'relative',
        userSelect: 'none',
        width: '100%'
    };

    const options = ['Unpaid', 'Deposit', 'Get File', 'Collected', 'Paid', 'PdFee', 'Cancel'];

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            // The menu is portalled into <body>, so check it separately.
            if (dropdownRef.current?.contains(target) || popupRef.current?.contains(target)) return;
            setIsOpen(false);
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const handleToggle = () => {
        if (!readOnly && onChange) {
            setIsOpen(!isOpen);
        }
    };

    const handleSelect = (newStatus: string) => {
        if (onChange) {
            onChange(newStatus);
            setIsOpen(false);
        }
    };

    return (
        <div style={{ position: 'relative', display: 'inline-block', width: '100%' }} ref={dropdownRef}>
            <div className="status-badge" data-unconfirmed={unconfirmed ? '' : undefined} style={badgeStyle} onClick={handleToggle} title={unconfirmed || (status === 'PdFee' ? pdFeeTitle : undefined)}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{payLabel(status)}</span>
                {!readOnly && <ChevronDown size={14} style={{ marginLeft: '4px', opacity: 0.7, flexShrink: 0 }} />}
            </div>

            {isOpen && !readOnly && createPortal(
                <div
                    ref={popupRef}
                    style={{
                        position: 'absolute',
                        top: position.top,
                        left: position.left,
                        width: position.width,
                        visibility: position.ready ? 'visible' : 'hidden',
                        maxHeight: position.maxHeight,
                        overflowY: position.maxHeight ? 'auto' : 'hidden',
                        backgroundColor: 'var(--color-surface)',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                        border: '1px solid #E5E7EB',
                        zIndex: 9999,
                        overflowX: 'hidden'
                    }}
                >
                    {options.map((opt) => {
                        const optStyle = getStatusStyle(opt);
                        const isDisabled = disabledOptions.includes(opt);
                        return (
                            <div
                                key={opt}
                                onClick={() => !isDisabled && handleSelect(opt)}
                                title={opt === 'PdFee' ? pdFeeTitle : undefined}
                                style={{
                                    padding: '8px 12px',
                                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    color: isDisabled ? '#9CA3AF' : optStyle.color,
                                    backgroundColor: opt === status ? 'var(--color-surface-hover)' : 'white',
                                    display: 'flex',
                                    alignItems: 'center',
                                    whiteSpace: 'nowrap',
                                    transition: 'background-color 0.2s',
                                    borderLeft: `4px solid ${isDisabled ? '#E5E7EB' : optStyle.color}`,
                                    opacity: isDisabled ? 0.6 : 1
                                }}
                                onMouseEnter={(e) => {
                                    if (!isDisabled) e.currentTarget.style.backgroundColor = '#F9FAFB';
                                }}
                                onMouseLeave={(e) => {
                                    if (!isDisabled) e.currentTarget.style.backgroundColor = opt === status ? 'var(--color-surface-hover)' : 'white';
                                }}
                            >
                                {payLabel(opt)}
                            </div>
                        );
                    })}
                </div>,
                document.body
            )}
        </div>
    );
};

export default PaymentStatusBadge;
