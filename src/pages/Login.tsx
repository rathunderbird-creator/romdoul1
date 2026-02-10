import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { useNavigate } from 'react-router-dom';
import { Lock, Delete, LogIn } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const Login: React.FC = () => {
    const { users, login } = useStore();
    const navigate = useNavigate();
    const { showToast } = useToast();

    const [selectedUserId, setSelectedUserId] = useState<string>(users.length > 0 ? users[0].id : '');
    const [pin, setPin] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Update selected user if users load late (though they should be loaded from context)
    React.useEffect(() => {
        if (!selectedUserId && users.length > 0) {
            setSelectedUserId(users[0].id);
        }
    }, [users, selectedUserId]);

    const handleNumberClick = (num: number) => {
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
            // In a real app we would validate user + pin combo
            // Here our simple login function just checks if *any* user has this PIN
            // We should ideally check if the *selected* user has this PIN.
            // Let's refine the StoreContext logic or handle it here.
            // The StoreContext `login` checks finds a user by PIN. 
            // If we select a user, we should ensure the found user matches the selected ID.

            // If 2 users have same PIN, it finds the first one. 
            // For now this is acceptable for a simple POS.

            const success = await login(pin, selectedUserId);
            if (success) {
                // Verify the logged in user matches selected user (optional, but good for UX)
                // Actually StoreContext sets currentUser based on PIN. 
                // If 2 users have same PIN, it finds the first one. 
                // For now this is acceptable for a simple POS.
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
                maxWidth: '400px',
                padding: '40px',
                display: 'flex',
                flexDirection: 'column',
                gap: '32px'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        background: 'var(--color-primary)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 16px'
                    }}>
                        <Lock size={32} />
                    </div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>POS Login</h1>
                    <p style={{ color: 'var(--color-text-secondary)' }}>Select user and enter PIN</p>
                </div>

                {/* User Selection */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    {users.map(user => (
                        <button
                            key={user.id}
                            onClick={() => { setSelectedUserId(user.id); setPin(''); }}
                            style={{
                                padding: '12px',
                                borderRadius: '8px',
                                border: selectedUserId === user.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                background: selectedUserId === user.id ? 'var(--color-surface)' : 'transparent',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.2s'
                            }}
                        >
                            <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                background: selectedUserId === user.id ? 'var(--color-primary)' : '#E0F2FE',
                                color: selectedUserId === user.id ? 'white' : '#0284C7',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold',
                                fontSize: '14px'
                            }}>
                                {user.name.charAt(0)}
                            </div>
                            <span style={{ fontSize: '12px', fontWeight: '500', color: 'var(--color-text-main)' }}>{user.name.split(' ')[0]}</span>
                        </button>
                    ))}
                </div>

                {/* PIN Display */}
                <div style={{
                    background: 'var(--color-surface)',
                    padding: '16px',
                    borderRadius: '12px',
                    textAlign: 'center',
                    height: '60px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px'
                }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            background: i < pin.length ? 'var(--color-primary)' : 'var(--color-border)',
                            transition: 'all 0.2s'
                        }} />
                    ))}
                </div>

                {/* Numpad */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                        <button
                            key={num}
                            onClick={() => handleNumberClick(num)}
                            style={{
                                height: '60px',
                                borderRadius: '12px',
                                border: '1px solid var(--color-border)',
                                background: 'transparent',
                                fontSize: '24px',
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
                            height: '60px',
                            borderRadius: '12px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            fontSize: '14px'
                        }}
                    >
                        Clear
                    </button>
                    <button
                        onClick={() => handleNumberClick(0)}
                        style={{
                            height: '60px',
                            borderRadius: '12px',
                            border: '1px solid var(--color-border)',
                            background: 'transparent',
                            fontSize: '24px',
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
                            height: '60px',
                            borderRadius: '12px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <Delete size={24} />
                    </button>
                </div>

                <button
                    onClick={handleLogin}
                    disabled={isLoading || !selectedUserId || pin.length < 4}
                    className="primary-button"
                    style={{
                        width: '100%',
                        padding: '16px',
                        fontSize: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        opacity: (!selectedUserId || pin.length < 4) ? 0.5 : 1
                    }}
                >
                    {isLoading ? 'Verifying...' : (
                        <>
                            <LogIn size={20} />
                            Login
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default Login;
