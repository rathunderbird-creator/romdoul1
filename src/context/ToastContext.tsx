import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    showToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, type: ToastType) => {
        const id = Date.now().toString();
        setToasts((prev) => [...prev, { id, message, type }]);

        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 3000);
    }, []);

    const removeToast = (id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    };

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div style={{
                position: 'fixed',
                top: '24px',
                right: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                zIndex: 2000
            }}>
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        style={{
                            minWidth: '300px',
                            padding: '16px',
                            borderRadius: '8px',
                            backgroundColor: 'var(--color-surface)',
                            border: `1px solid ${toast.type === 'success' ? '#10B981' :
                                toast.type === 'error' ? '#EF4444' :
                                    'var(--color-primary)'
                                }`,
                            color: 'var(--color-text-main)',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            animation: 'slideIn 0.3s ease-out'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {toast.type === 'success' && <CheckCircle size={20} color="#10B981" />}
                            {toast.type === 'error' && <AlertCircle size={20} color="#EF4444" />}
                            {toast.type === 'info' && <Info size={20} color="var(--color-primary)" />}
                            <span style={{ fontSize: '14px' }}>{toast.message}</span>
                        </div>
                        <button onClick={() => removeToast(toast.id)} style={{ background: 'none', color: '#6B7280' }}>
                            <X size={16} />
                        </button>
                    </div>
                ))}
            </div>
            <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (context === undefined) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};
