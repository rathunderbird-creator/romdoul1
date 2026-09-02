import React, { useState, useEffect, useRef } from 'react';
import { useStore, isRpcMissingError } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { supabase } from '../lib/supabase';
import { Lock, X } from 'lucide-react';

interface PinPromptProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    title?: string;
    description?: string;
}

const PinPrompt: React.FC<PinPromptProps> = ({
    isOpen,
    onClose,
    onSuccess,
    title = "Enter Password",
    description = "Please enter your password to continue"
}) => {
    const { currentUser } = useStore();
    const { showToast } = useToast();
    const [pin, setPin] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setPin('');
            const timer = setTimeout(() => {
                inputRef.current?.focus();
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    const [isChecking, setIsChecking] = useState(false);

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (isChecking) return;

        const entered = pin.trim();
        if (!entered || !currentUser) {
            showToast('Please enter your password', 'error');
            return;
        }

        setIsChecking(true);
        try {
            // Verified server-side (check_pin RPC) — the account's PIN is never
            // present in the browser.
            const { data, error } = await supabase.rpc('check_pin', {
                p_pin: entered,
                p_user_id: currentUser.id
            });
            let ok: boolean;
            if (!error) {
                ok = Array.isArray(data) ? data.length > 0 : !!data;
            } else if (isRpcMissingError(error)) {
                // secure_pin_check.sql not applied yet: read this account's pin
                // the legacy way (still readable pre-migration) — the stored
                // snapshot can't be trusted, new logins no longer carry the pin.
                const { data: legacyRow } = await supabase.from('users').select('pin').eq('id', currentUser.id).single();
                ok = !!legacyRow?.pin && entered === String(legacyRow.pin).trim();
            } else {
                // Network/server failure — never report it as a wrong password.
                console.error('check_pin failed:', error);
                showToast('Could not verify password — check the connection and try again', 'error');
                return;
            }
            if (ok) {
                onSuccess();
                onClose();
            } else {
                showToast('Incorrect password', 'error');
                setPin('');
                inputRef.current?.focus();
            }
        } finally {
            setIsChecking(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            backdropFilter: 'blur(4px)'
        }}>
            <div style={{
                background: 'var(--color-surface)',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '360px',
                padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                position: 'relative',
                animation: 'slideUp 0.3s ease-out'
            }}>
                <button
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        top: '16px',
                        right: '16px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-text-secondary)',
                        cursor: 'pointer',
                        padding: '4px'
                    }}
                >
                    <X size={20} />
                </button>

                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    marginBottom: '24px'
                }}>
                    <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: 'rgba(59, 130, 246, 0.1)',
                        color: '#3B82F6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 16px'
                    }}>
                        <Lock size={24} />
                    </div>
                    <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--color-text)' }}>
                        {title}
                    </h3>
                    <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                        {description}
                    </p>
                </div>

                <form onSubmit={handleSubmit}>
                    <input
                        ref={inputRef}
                        type="password"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        className="search-input"
                        placeholder="Enter Password"
                        style={{
                            width: '100%',
                            padding: '16px',
                            textAlign: 'center',
                            fontSize: '24px',
                            marginBottom: '24px',
                            fontFamily: 'monospace'
                        }}
                    />

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                padding: '12px',
                                borderRadius: '8px',
                                border: '1px solid var(--color-border)',
                                background: 'transparent',
                                color: 'var(--color-text)',
                                fontWeight: 500,
                                cursor: 'pointer'
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            style={{
                                padding: '12px',
                                borderRadius: '8px',
                                border: 'none',
                                background: 'var(--color-primary)',
                                color: 'white',
                                fontWeight: 500,
                                cursor: 'pointer'
                            }}
                        >
                            Unlock
                        </button>
                    </div>
                </form>
            </div>
            <style>{`
                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default PinPrompt;
