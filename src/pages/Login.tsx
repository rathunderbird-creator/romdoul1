import React, { useState, useEffect } from 'react';
import { useStore } from '../context/StoreContext';
import { useNavigate } from 'react-router-dom';
import { Lock, Delete, LogIn, RefreshCw } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const Login: React.FC = () => {
    const { users, roles, login, refreshData } = useStore();
    const navigate = useNavigate();
    const { showToast } = useToast();

    const [selectedUserId, setSelectedUserId] = useState<string>('');
    const [pin, setPin] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Auto-select first user if available and none selected
    useEffect(() => {
        if (!selectedUserId && users.length > 0) {
            setSelectedUserId(users[0].id);
        }
    }, [users, selectedUserId]);

    const handleNumberClick = (num: number) => {
        if (!selectedUserId) {
            showToast('Please select a user first', 'error');
            return;
        }
        if (pin.length < 4) {
            setPin(prev => prev + num);
        }
    };

    const handleClear = () => {
        setPin('');
    };

    const handleBackspace = () => {
        setPin(prev => prev.slice(0, -1));
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await refreshData();
            showToast('User list updated', 'success');
        } catch (error) {
            showToast('Failed to refresh data', 'error');
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleLogin = async () => {
        if (!selectedUserId) {
            showToast('Please select a user', 'error');
            return;
        }
        if (pin.length === 0) {
            showToast('Please enter PIN', 'error');
            return;
        }

        setIsLoading(true);
        try {
            const success = await login(pin, selectedUserId);
            if (success) {
                navigate('/');
                showToast('Welcome back!', 'success');
            } else {
                showToast('Invalid PIN', 'error');
                setPin('');
            }
        } catch (error) {
            showToast('Login failed', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // Construct valid users list
    const validUsers = users || [];

    return (
        <div style={{
            height: '100vh',
            width: '100vw',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-bg)',
            color: 'var(--color-text-main)'
        }}>
            <div className="glass-panel" style={{
                width: '100%',
                maxWidth: '360px', // Reduced max-width for compactness
                padding: '24px', // Reduced padding from 40px
                display: 'flex',
                flexDirection: 'column',
                gap: '20px' // Reduced gap from 32px
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        width: '48px', // Reduced size
                        height: '48px', // Reduced size
                        borderRadius: '50%',
                        background: 'var(--color-primary)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 12px' // Reduced margin
                    }}>
                        <Lock size={24} /> {/* Reduced icon size */}
                    </div>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px' }}>POS Login</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Select user and enter PIN</p>
                </div>

                {/* User Selection */}
                <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <label style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Select User</label>
                        <button
                            onClick={handleRefresh}
                            disabled={isRefreshing}
                            className="text-button"
                            style={{
                                padding: '4px',
                                color: 'var(--color-primary)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '11px',
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer'
                            }}
                            title="Refresh Users"
                        >
                            <RefreshCw size={12} className={isRefreshing ? 'spin' : ''} />
                            Refresh
                        </button>
                    </div>

                    <div style={{ position: 'relative' }}>
                        <select
                            value={selectedUserId}
                            onChange={(e) => { setSelectedUserId(e.target.value); setPin(''); }}
                            style={{
                                width: '100%',
                                padding: '10px', // Reduced padding
                                borderRadius: '8px',
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-surface)',
                                color: 'var(--color-text-main)',
                                fontSize: '14px', // Reduced font size
                                outline: 'none',
                                cursor: 'pointer',
                                appearance: 'none'
                            }}
                        >
                            {validUsers.length === 0 && <option value="">No users found</option>}
                            {validUsers.map(user => {
                                const userRole = roles.find(r => r.id === user.roleId);
                                return (
                                    <option key={user.id} value={user.id}>
                                        {user.name}
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                </div>

                {/* PIN Display */}
                <div style={{
                    background: 'var(--color-surface)',
                    padding: '12px', // Reduced padding
                    borderRadius: '10px',
                    textAlign: 'center',
                    height: '48px', // Reduced height
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    // marginBottom: '16px' // Handled by flex gap
                }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            background: i < pin.length ? 'var(--color-primary)' : 'var(--color-border)',
                            transition: 'all 0.2s',
                            transform: i < pin.length ? 'scale(1.2)' : 'scale(1)'
                        }} />
                    ))}
                </div>

                {/* Numpad */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                        <button
                            key={num}
                            onClick={() => handleNumberClick(num)}
                            style={{
                                height: '48px', // Reduced height
                                borderRadius: '10px',
                                border: '1px solid var(--color-border)',
                                background: 'transparent',
                                fontSize: '20px', // Reduced font size
                                fontWeight: '500',
                                color: 'var(--color-text-main)',
                                cursor: 'pointer'
                            }}
                            className="hover-card"
                        >
                            {num}
                        </button>
                    ))}
                    <button
                        onClick={handleClear}
                        style={{
                            height: '48px',
                            borderRadius: '10px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            fontSize: '13px',
                            textTransform: 'uppercase',
                            fontWeight: 600
                        }}
                    >
                        Clear
                    </button>
                    <button
                        onClick={() => handleNumberClick(0)}
                        style={{
                            height: '48px',
                            borderRadius: '10px',
                            border: '1px solid var(--color-border)',
                            background: 'transparent',
                            fontSize: '20px',
                            fontWeight: '500',
                            color: 'var(--color-text-main)',
                            cursor: 'pointer'
                        }}
                        className="hover-card"
                    >
                        0
                    </button>
                    <button
                        onClick={handleBackspace}
                        style={{
                            height: '48px',
                            borderRadius: '10px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <Delete size={20} />
                    </button>
                </div>

                <button
                    onClick={handleLogin}
                    disabled={isLoading || !selectedUserId || pin.length < 4}
                    className="primary-button"
                    style={{
                        width: '100%',
                        padding: '14px', // Reduced padding
                        fontSize: '15px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        opacity: (!selectedUserId || pin.length < 4) ? 0.5 : 1,
                        marginTop: '8px'
                    }}
                >
                    {isLoading ? 'Verifying...' : (
                        <>
                            <LogIn size={18} />
                            Login
                        </>
                    )}
                </button>
            </div>

            <style>{`
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default Login;
