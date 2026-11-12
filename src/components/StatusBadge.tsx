import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { usePortalPosition } from '../hooks/usePortalPosition';
import { orderStatusLabel } from '../utils/orderStatusRules';

interface StatusBadgeProps {
    status: string;
    onChange?: (status: string) => void;
    readOnly?: boolean;
    disabledOptions?: string[];
    bold?: boolean;
    // Lifts the built-in Delivered gating (admins — the store still shows them
    // a confirm before any transition that skips the stock flow).
    unrestricted?: boolean;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, onChange, readOnly = false, disabledOptions = [], bold = true, unrestricted = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    // In the zoomed body's coordinates, flipped above when there's no room below.
    const position = usePortalPosition(dropdownRef, popupRef, isOpen && !readOnly);

    const getStatusStyle = (s: string) => {
        switch (s) {
            case 'Pending': return { bg: '#FEF3C7', color: '#D97706', border: '#FCD34D' }; // Amber
            case 'Confirmed': return { bg: '#E0F2FE', color: '#0369A1', border: '#7DD3FC' }; // Cyan/Light Blue
            case 'Shipped': return { bg: '#DBEAFE', color: '#2563EB', border: '#93C5FD' }; // Blue
            case 'Delivered': return { bg: '#D1FAE5', color: '#059669', border: '#6EE7B7' }; // Green
            case 'Cancelled': return { bg: '#FEE2E2', color: '#DC2626', border: '#FCA5A5' }; // Red
            case 'Returned': return { bg: 'var(--color-surface-hover)', color: '#DC2626', border: '#D1D5DB' }; // Red text, Gray bg
            case 'ReStock': return { bg: '#E9D5FF', color: '#7E22CE', border: '#C084FC' }; // Purple
            case 'Drafted': return { bg: 'var(--color-surface-hover)', color: '#111827', border: '#E5E7EB' }; // Gray/Neutral
            case 'Active': return { bg: '#D1FAE5', color: '#059669', border: '#6EE7B7' }; // Green
            case 'Inactive': return { bg: 'var(--color-surface-hover)', color: '#6B7280', border: '#D1D5DB' }; // Gray
            default: return { bg: 'var(--color-surface-hover)', color: '#4B5563', border: '#D1D5DB' };
        }
    };

    const style = getStatusStyle(status);

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

    const options = ['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled'];

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
            <div className="status-badge" style={badgeStyle} onClick={handleToggle}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{orderStatusLabel(status)}</span>
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
                    {options.filter(opt => opt !== 'ReStock' || status === 'ReStock' || status === 'Returned').map((opt) => {
                        const optStyle = getStatusStyle(opt);
                        // Delivered is reachable from Shipped, and from Returned (the
                        // correction for a mistaken Returned — stock is counted out in
                        // both states, so the flip is stock-neutral).
                        const isDisabled = (disabledOptions || []).includes(opt) ||
                            (!unrestricted && opt === 'Delivered' && !['Shipped', 'Delivered', 'Returned'].includes(status));

                        return (
                            <div
                                key={opt}
                                onClick={() => !isDisabled && handleSelect(opt)}
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
                                {orderStatusLabel(opt)}
                            </div>
                        );
                    })}
                </div>,
                document.body
            )}
        </div>
    );
};

export default StatusBadge;
