import React, { useState, useEffect } from 'react';
import { useStore } from '../context/StoreContext';
import { useNavigate } from 'react-router-dom';
import { Lock, LogIn, RefreshCw } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const Login: React.FC = () => {
    const { users, login, refreshData } = useStore();
    const navigate = useNavigate();
    const { showToast } = useToast();

    const [selectedUserId, setSelectedUserId] = useState<string>('');
    const [pin, setPin] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Auto-select first user if available and none selected
    useEffect(() => {
        if (users.length > 0) {
            // If no user selected, OR selected user not in list (stale ID)
            if (!selectedUserId || !users.find(u => u.id === selectedUserId)) {
                console.log('Resetting selected user to:', users[0].id);
                setSelectedUserId(users[0].id);
            }
        }
    }, [users, selectedUserId]);



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
        if (!pin) {
            showToast('Please enter password', 'error');
            return;
        }

        setIsLoading(true);
        console.log('Login Page: Calling login with:', { pin, selectedUserId });
        try {
            const success = await login(pin, selectedUserId);
            if (success) {
                navigate('/');
                showToast('Welcome back!', 'success');
            } else {
                showToast('Invalid password', 'error');
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
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Select user and enter password</p>
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
                                return (
                                    <option key={user.id} value={user.id}>
                                        {user.name}
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                </div>

                {/* Password Input */}
                <div style={{ position: 'relative', marginTop: '16px' }}>
                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Password</label>
                    <input
                        type="password"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && selectedUserId && pin && handleLogin()}
                        placeholder="Enter password"
                        style={{
                            width: '100%',
                            padding: '12px',
                            borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)',
                            color: 'var(--color-text-main)',
                            fontSize: '15px',
                            outline: 'none',
                        }}
                    />
                </div>

                <button
                    onClick={handleLogin}
                    disabled={isLoading || !selectedUserId || !pin}
                    className="primary-button"
                    style={{
                        width: '100%',
                        padding: '14px',
                        fontSize: '15px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        opacity: (!selectedUserId || !pin) ? 0.5 : 1,
                        marginTop: '16px'
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
