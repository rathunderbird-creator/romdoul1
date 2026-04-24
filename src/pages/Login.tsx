import React, { useState, useEffect } from 'react';
import { useStore } from '../context/StoreContext';
import { useNavigate } from 'react-router-dom';
import { Lock, LogIn, RefreshCw } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';

const Login: React.FC = () => {
    const { users, login, refreshData } = useStore();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { t, language, setLanguage } = useLanguage();

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
            showToast(t('login.userListUpdated'), 'success');
        } catch (error) {
            showToast(t('login.failedToRefresh'), 'error');
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleLogin = async () => {
        if (!selectedUserId) {
            showToast(t('login.pleaseSelectUser'), 'error');
            return;
        }
        if (!pin) {
            showToast(t('login.pleaseEnterPassword'), 'error');
            return;
        }

        setIsLoading(true);
        console.log('Login Page: Calling login with:', { pin, selectedUserId });
        try {
            const success = await login(pin, selectedUserId);
            if (success) {
                navigate('/');
                showToast(t('login.welcomeBack'), 'success');
            } else {
                showToast(t('login.invalidPassword'), 'error');
                setPin('');
            }
        } catch (error) {
            showToast(t('login.loginFailed'), 'error');
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
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px' }}>{t('login.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>{t('login.subtitle')}</p>
                </div>

                {/* User Selection */}
                <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <label style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{t('login.selectUser')}</label>
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
                            {t('login.refresh')}
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
                            {validUsers.length === 0 && <option value="">{t('login.noUsers')}</option>}
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
                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>{t('login.password')}</label>
                    <input
                        type="password"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && selectedUserId && pin && handleLogin()}
                        placeholder={t('login.enterPassword')}
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
                    {isLoading ? t('login.verifying') : (
                        <>
                            <LogIn size={18} />
                            {t('login.login')}
                        </>
                    )}
                </button>

                {/* Language Toggle */}
                <button
                    onClick={() => setLanguage(language === 'en' ? 'km' : 'en')}
                    style={{
                        width: '100%',
                        padding: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        background: 'transparent',
                        border: '1px solid var(--color-border)',
                        borderRadius: '8px',
                        color: 'var(--color-text-secondary)',
                        cursor: 'pointer',
                        fontSize: '13px'
                    }}
                >
                    {language === 'en' ? (
                        <svg width="20" height="14" viewBox="0 0 25 16" style={{ borderRadius: '2px', flexShrink: 0 }}>
                            <rect width="25" height="4" fill="#032EA1"/>
                            <rect y="4" width="25" height="8" fill="#E00025"/>
                            <rect y="12" width="25" height="4" fill="#032EA1"/>
                            <g fill="#fff" transform="translate(12.5,8)">
                                <rect x="-5" y="-1.5" width="10" height="3"/>
                                <rect x="-4" y="-3" width="8" height="1.5"/>
                                <rect x="-1" y="-5" width="2" height="2"/>
                                <rect x="-3.5" y="-4" width="1.5" height="1"/>
                                <rect x="2" y="-4" width="1.5" height="1"/>
                            </g>
                        </svg>
                    ) : (
                        <svg width="20" height="14" viewBox="0 0 25 16" style={{ borderRadius: '2px', flexShrink: 0 }}>
                            <rect width="25" height="16" fill="#B22234"/>
                            <rect y="1.23" width="25" height="1.23" fill="#fff"/>
                            <rect y="3.69" width="25" height="1.23" fill="#fff"/>
                            <rect y="6.15" width="25" height="1.23" fill="#fff"/>
                            <rect y="8.62" width="25" height="1.23" fill="#fff"/>
                            <rect y="11.08" width="25" height="1.23" fill="#fff"/>
                            <rect y="13.54" width="25" height="1.23" fill="#fff"/>
                            <rect width="10" height="8.62" fill="#3C3B6E"/>
                        </svg>
                    )}
                    {language === 'en' ? 'ខ្មែរ' : 'English'}
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
