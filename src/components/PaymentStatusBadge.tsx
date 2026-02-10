import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface PaymentStatusBadgeProps {
    status: string;
    onChange?: (status: string) => void;
    readOnly?: boolean;
    disabledOptions?: string[];
}

const PaymentStatusBadge: React.FC<PaymentStatusBadgeProps> = ({ status, onChange, readOnly = false, disabledOptions = [] }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const getStatusStyle = (s: string) => {
        switch (s) {
            case 'Paid': return { bg: '#D1FAE5', color: '#059669', border: '#6EE7B7' }; // Green
            case 'Unpaid': return { bg: '#FEE2E2', color: '#DC2626', border: '#FCA5A5' }; // Red
            case 'Settled': return { bg: '#E0E7FF', color: '#4F46E5', border: '#A5B4FC' }; // Indigo
            case 'Not Settle': return { bg: '#FEE2E2', color: '#DC2626', border: '#FCA5A5' }; // Red
            case 'Cancel': return { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' }; // Dark Red
            case 'Pending': return { bg: '#FEF3C7', color: '#D97706', border: '#FCD34D' }; // Yellow/Orange
            default: return { bg: '#F3F4F6', color: '#4B5563', border: '#D1D5DB' };
        }
    };

    const style = getStatusStyle(status);

    const badgeStyle: React.CSSProperties = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 8px 4px 12px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 600,
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

    const options = ['Pending', 'Paid', 'Unpaid', 'Settled', 'Not Settle', 'Cancel'];

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
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
            <div style={badgeStyle} onClick={handleToggle}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{status}</span>
                {!readOnly && <ChevronDown size={14} style={{ marginLeft: '4px', opacity: 0.7, flexShrink: 0 }} />}
            </div>

            {isOpen && !readOnly && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '4px',
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                    border: '1px solid #E5E7EB',
                    zIndex: 1000,
                    minWidth: '100%',
                    overflow: 'hidden'
                }}>
                    {options.map((opt) => {
                        const optStyle = getStatusStyle(opt);
                        const isDisabled = disabledOptions.includes(opt);
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
                                    backgroundColor: opt === status ? '#F3F4F6' : 'white',
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
                                    if (!isDisabled) e.currentTarget.style.backgroundColor = opt === status ? '#F3F4F6' : 'white';
                                }}
                            >
                                {opt}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default PaymentStatusBadge;
