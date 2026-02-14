import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

interface StatusBadgeProps {
    status: string;
    onChange?: (status: string) => void;
    readOnly?: boolean;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, onChange, readOnly = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

    const getStatusStyle = (s: string) => {
        switch (s) {
            case 'Pending': return { bg: '#FEF3C7', color: '#D97706', border: '#FCD34D' }; // Amber
            case 'Shipped': return { bg: '#DBEAFE', color: '#2563EB', border: '#93C5FD' }; // Blue
            case 'Delivered': return { bg: '#D1FAE5', color: '#059669', border: '#6EE7B7' }; // Green
            case 'Cancelled': return { bg: '#FEE2E2', color: '#DC2626', border: '#FCA5A5' }; // Red
            case 'Returned': return { bg: '#F3F4F6', color: '#DC2626', border: '#D1D5DB' }; // Red text, Gray bg
            case 'ReStock': return { bg: '#E9D5FF', color: '#7E22CE', border: '#C084FC' }; // Purple
            case 'Ordered': return { bg: '#F3F4F6', color: '#111827', border: '#E5E7EB' }; // Gray/Neutral
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
        fontSize: 'inherit',
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

    const options = ['Ordered', 'Pending', 'Shipped', 'Delivered', 'Returned', 'ReStock'];

    // Update position when opening
    useEffect(() => {
        if (isOpen && dropdownRef.current) {
            const updatePosition = () => {
                const rect = dropdownRef.current?.getBoundingClientRect();
                if (rect) {
                    setPosition({
                        top: rect.bottom + window.scrollY + 4,
                        left: rect.left + window.scrollX,
                        width: rect.width
                    });
                }
            };

            updatePosition();
            window.addEventListener('scroll', updatePosition, true);
            window.addEventListener('resize', updatePosition);

            return () => {
                window.removeEventListener('scroll', updatePosition, true);
                window.removeEventListener('resize', updatePosition);
            };
        }
    }, [isOpen]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                // Check if click is inside the portal content? 
                // Since portal is in body, contains won't work if target is in portal.
                // We need a ref for the portal content too.
                const portalElement = document.getElementById(`status-dropdown-${status}-${position.top}`);
                if (portalElement && portalElement.contains(event.target as Node)) {
                    return;
                }
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, status, position.top]);

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
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{status}</span>
                {!readOnly && <ChevronDown size={14} style={{ marginLeft: '4px', opacity: 0.7, flexShrink: 0 }} />}
            </div>

            {isOpen && !readOnly && createPortal(
                <div
                    id={`status-dropdown-${status}-${position.top}`}
                    style={{
                        position: 'absolute',
                        top: position.top,
                        left: position.left,
                        width: position.width,
                        backgroundColor: 'white',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                        border: '1px solid #E5E7EB',
                        zIndex: 9999,
                        overflow: 'hidden'
                    }}
                >
                    {options.filter(opt => opt !== 'ReStock' || status === 'ReStock').map((opt) => {
                        const optStyle = getStatusStyle(opt);
                        return (
                            <div
                                key={opt}
                                onClick={() => handleSelect(opt)}
                                style={{
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    fontSize: '12px', // Hardcoded or inherit? Inherit might be risky in body
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
                </div>,
                document.body
            )}
        </div>
    );
};

export default StatusBadge;
