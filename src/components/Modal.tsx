import React, { type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useMobile } from '../hooks/useMobile';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
    const isMobile = useMobile();

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: isMobile ? 'flex-end' : 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: isMobile ? '0' : '20px'
        }}>
            <div
                className="glass-panel"
                style={{
                    backgroundColor: 'var(--color-surface)',
                    width: '100%',
                    maxWidth: '500px',
                    maxHeight: isMobile ? '90vh' : '90vh',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: isMobile ? '24px 24px 0 0' : '16px',
                    animation: isMobile ? 'slideUp 0.3s ease-out' : 'fadeIn 0.2s ease-out',
                    overflow: 'hidden'
                }}
            >
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--color-surface)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                }}>
                    <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, color: 'var(--color-text-main)' }}>{title}</h2>
                    <button
                        onClick={onClose}
                        className="icon-button"
                        style={{ margin: '-8px' }}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div style={{
                    padding: '24px',
                    overflowY: 'auto',
                    flex: 1
                }}>
                    {children}
                </div>
            </div>

            <style>{`
                @keyframes slideUp {
                    from { transform: translateY(100%); }
                    to { transform: translateY(0); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
            `}</style>
        </div>
    );
};

export default Modal;
