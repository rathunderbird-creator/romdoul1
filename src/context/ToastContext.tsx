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


    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div style={{
                position: 'fixed',
                bottom: '24px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                zIndex: 2000,
                alignItems: 'center'
            }}>
                {toasts.map((toast) => (
                    <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
                ))}
            </div>
            <style>{`
        @keyframes slideIn {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
        </ToastContext.Provider>
    );
};

const ToastItem: React.FC<{ toast: Toast; onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
    const [isPaused, setIsPaused] = useState(false);

    React.useEffect(() => {
        if (isPaused) return;

        const timer = setTimeout(() => {
            onRemove(toast.id);
        }, 3000);

        return () => clearTimeout(timer);
    }, [isPaused, toast.id, onRemove]);

    return (
        <div
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
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
                animation: 'slideIn 0.3s ease-out',
                cursor: 'pointer'
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {toast.type === 'success' ? <CheckCircle size={20} color="#10B981" /> :
                    toast.type === 'error' ? <AlertCircle size={20} color="#EF4444" /> :
                        <Info size={20} color="var(--color-primary)" />}
                <span style={{ fontSize: '14px' }}>{toast.message}</span>
            </div>
            <button onClick={() => onRemove(toast.id)} style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                <X size={16} />
            </button>
        </div>
    );
};


export const useToast = () => {
    const context = useContext(ToastContext);
    if (context === undefined) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};
