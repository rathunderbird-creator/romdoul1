import React, { useState, useRef, useEffect } from 'react';

import { ChevronDown } from 'lucide-react';

interface StatusBadgeProps {
    status: string;
    onChange?: (status: string) => void;
    readOnly?: boolean;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, onChange, readOnly = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const getStatusStyle = (s: string) => {
        switch (s) {
            case 'Pending': return { bg: '#FEF3C7', color: '#D97706', border: '#FCD34D' }; // Amber
            case 'Shipped': return { bg: '#DBEAFE', color: '#2563EB', border: '#93C5FD' }; // Blue
            case 'Delivered': return { bg: '#D1FAE5', color: '#059669', border: '#6EE7B7' }; // Green
            case 'Cancelled': return { bg: '#FEE2E2', color: '#DC2626', border: '#FCA5A5' }; // Red
            case 'Returned': return { bg: '#F3F4F6', color: '#DC2626', border: '#D1D5DB' }; // Red text, Gray bg
            case 'ReStock': return { bg: '#E9D5FF', color: '#7E22CE', border: '#C084FC' }; // Purple
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

    const options = ['Pending', 'Shipped', 'Delivered', 'Returned', 'ReStock'];

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
                        return (
                            <div
                                key={opt}
                                onClick={() => handleSelect(opt)}
                                style={{
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    color: optStyle.color,
                                    backgroundColor: opt === status ? '#F3F4F6' : 'white',
                                    display: 'flex',
                                    alignItems: 'center',
                                    whiteSpace: 'nowrap',
                                    transition: 'background-color 0.2s',
                                    borderLeft: `4px solid ${optStyle.color}`
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = '#F9FAFB';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = opt === status ? '#F3F4F6' : 'white';
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

export default StatusBadge;
