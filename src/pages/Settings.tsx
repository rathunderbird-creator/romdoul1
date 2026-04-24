import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Store, Globe, Bell, Shield, Database } from 'lucide-react';
import { migrateData } from '../lib/migration';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import PinPrompt from '../components/PinPrompt';
import { supabase } from '../lib/supabase';
import { processImageForUpload } from '../utils/imageUtils';




const Settings: React.FC = () => {
    const { storeAddress, storeName, logo, email, phone, telegramBotToken, telegramChatId, updateStoreProfile, backupData, restoreData, timezone, taxRate, currency, khrExchangeRate } = useStore();
    const { showToast } = useToast();
    const { themeColor, setThemeColor, fontSize, setFontSize, resetTheme } = useTheme();
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();

    // Local State
    const [localState, setLocalState] = useState({
        storeName: '',
        storeAddress: '',
        email: '',
        phone: '',
        timezone: '',
        taxRate: 0,
        currency: '',
        khrExchangeRate: 4100,
        logo: '',
        telegramBotToken: '',
        telegramChatId: ''
    });

    // PIN Protection State
    const [showDataManagement, setShowDataManagement] = useState(false);
    const [isPinPromptOpen, setIsPinPromptOpen] = useState(false);
    const [isUploadingLogo, setIsUploadingLogo] = useState(false);

    // Use ref to hold the latest state for the save handler (avoid stale closure)
    const stateRef = useRef(localState);
    useEffect(() => {
        stateRef.current = localState;
    }, [localState]);

    const handleSave = useCallback(async () => {
        const currentData = stateRef.current;
        try {
            await updateStoreProfile({
                storeName: currentData.storeName,
                storeAddress: currentData.storeAddress,
                email: currentData.email,
                phone: currentData.phone,
                timezone: currentData.timezone,
                taxRate: currentData.taxRate,
                currency: currentData.currency,
                khrExchangeRate: currentData.khrExchangeRate,
                logo: currentData.logo,
                telegramBotToken: currentData.telegramBotToken,
                telegramChatId: currentData.telegramChatId
            });
            showToast(t('settings.settingsSaved'), 'success');
        } catch (error) {
            console.error(error);
            showToast(t('settings.settingsFailed'), 'error');
        }
    }, [updateStoreProfile, showToast]); // Dependencies for context functions

    // Header Content
    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('settings.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('settings.subtitle')}</p>
                </div>
            ),
            actions: (
                <button
                    onClick={handleSave}
                    className="primary-button"
                    style={{
                        padding: '12px 24px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <Save size={20} />
                    {t('settings.saveChanges')}
                </button>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, handleSave, t]);


    useEffect(() => {
        setLocalState({
            storeName: storeName || '',
            storeAddress: storeAddress || '',
            email: email || '',
            phone: phone || '',
            timezone: timezone || 'Asia/Phnom_Penh',
            taxRate: taxRate || 0,
            currency: currency || 'USD ($)',
            khrExchangeRate: khrExchangeRate || 4100,
            logo: logo || '',
            telegramBotToken: telegramBotToken || '',
            telegramChatId: telegramChatId || ''
        });
    }, [storeName, storeAddress, email, phone, timezone, taxRate, currency, logo, telegramBotToken, telegramChatId]);







    const handleMigration = async () => {
        if (!confirm('This will upload all local data to Supabase. Proceed?')) return;
        const result = await migrateData();
        if (result.success) {
            showToast('Migration successful!', 'success');
        } else {
            showToast(`Migration failed: ${result.error}`, 'error');
        }
    };

    return (
        <div>


            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
                {/* Appearance Section */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'linear-gradient(135deg, #FF6600 0%, #FF8533 100%)' }}></div>
                            <h2 style={{ fontSize: '20px', fontWeight: '600' }}>{t('settings.appearance')}</h2>
                        </div>

                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.themeColor')}</label>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <input
                                    type="color"
                                    value={themeColor}
                                    onChange={(e) => setThemeColor(e.target.value)}
                                    style={{
                                        border: 'none',
                                        width: '40px',
                                        height: '40px',
                                        cursor: 'pointer',
                                        background: 'none'
                                    }}
                                />
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {['#FF6600', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444'].map(color => (
                                        <button
                                            key={color}
                                            onClick={() => setThemeColor(color)}
                                            style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '50%',
                                                backgroundColor: color,
                                                border: themeColor === color ? `2px solid var(--color-text-main)` : '2px solid transparent',
                                                cursor: 'pointer',
                                                transition: 'transform 0.2s'
                                            }}
                                            title={color}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                {t('settings.fontSize')}: {fontSize}px
                            </label>
                            <input
                                type="range"
                                min="12"
                                max="20"
                                step="1"
                                value={fontSize}
                                onChange={(e) => setFontSize(Number(e.target.value))}
                                style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                                <span>{t('settings.small')}</span>
                                <span>{t('settings.medium')}</span>
                                <span>{t('settings.large')}</span>
                            </div>
                        </div>
                        <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
                            <button onClick={resetTheme} style={{
                                padding: '8px 16px',
                                border: '1px solid var(--color-border)',
                                borderRadius: '8px',
                                background: 'transparent',
                                color: 'var(--color-text-secondary)',
                                fontSize: '13px',
                                cursor: 'pointer'
                            }}>
                                {t('settings.resetToDefaults')}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Store Profile Section */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                        <Store className="text-primary" size={24} />
                        <h2 style={{ fontSize: '20px', fontWeight: '600' }}>{t('settings.storeProfile')}</h2>
                    </div>

                    <div style={{ display: 'grid', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.storeName')}</label>
                            <input
                                type="text"
                                value={localState.storeName}
                                onChange={(e) => setLocalState({ ...localState, storeName: e.target.value })}
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.storeLogo')}</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <div style={{
                                    width: '64px',
                                    height: '64px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    background: 'var(--color-bg)',
                                    backgroundImage: localState.logo ? `url(${localState.logo})` : 'none',
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    overflow: 'hidden'
                                }}>
                                    {!localState.logo && <Store size={24} color="var(--color-text-secondary)" />}
                                </div>
                                <div>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        id="logo-upload"
                                        style={{ display: 'none' }}
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;

                                            try {
                                                setIsUploadingLogo(true);

                                                // 1. Process logo (crop 1:1, resize to 300x300 logo size)
                                                const processedBlob = await processImageForUpload(file, { width: 300, quality: 0.9 });

                                                const fileName = `logo_${Date.now()}.jpg`;

                                                // 2. Upload to Storage
                                                const { error } = await supabase.storage
                                                    .from('products')
                                                    .upload(fileName, processedBlob, {
                                                        contentType: 'image/jpeg',
                                                        upsert: false
                                                    });

                                                if (error) throw error;

                                                // 3. Get Public URL
                                                const { data: publicData } = supabase.storage
                                                    .from('products')
                                                    .getPublicUrl(fileName);

                                                if (publicData?.publicUrl) {
                                                    setLocalState({ ...localState, logo: publicData.publicUrl });
                                                    showToast('Logo uploaded', 'success');
                                                }
                                            } catch (err: any) {
                                                console.error('Logo upload error:', err);
                                                showToast('Logo upload failed', 'error');
                                            } finally {
                                                setIsUploadingLogo(false);
                                                e.target.value = ''; // Reset input
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={() => document.getElementById('logo-upload')?.click()}
                                        disabled={isUploadingLogo}
                                        style={{
                                            padding: '8px 16px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--color-border)',
                                            background: 'var(--color-surface)',
                                            cursor: isUploadingLogo ? 'not-allowed' : 'pointer',
                                            fontSize: '13px',
                                            color: 'var(--color-text-main)',
                                            opacity: isUploadingLogo ? 0.7 : 1
                                        }}
                                    >
                                        {isUploadingLogo ? t('settings.uploading') : t('settings.uploadLogo')}
                                    </button>
                                    <p style={{ marginTop: '4px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{t('settings.autoCropsSquare')}</p>
                                </div>
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.storeAddress')}</label>
                            <input
                                type="text"
                                value={localState.storeAddress}
                                onChange={(e) => setLocalState({ ...localState, storeAddress: e.target.value })}
                                placeholder="e.g. 123 Speaker Ave, Audio City"
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.emailAddress')}</label>
                                <input
                                    type="email"
                                    value={localState.email}
                                    onChange={(e) => setLocalState({ ...localState, email: e.target.value })}
                                    className="search-input"
                                    style={{ width: '100%', padding: '12px' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.phoneNumber')}</label>
                                <input
                                    type="tel"
                                    value={localState.phone}
                                    onChange={(e) => setLocalState({ ...localState, phone: e.target.value })}
                                    className="search-input"
                                    style={{ width: '100%', padding: '12px' }}
                                />
                            </div>
                        </div>
                    </div>
                </div>



                <PinPrompt
                    isOpen={isPinPromptOpen}
                    onClose={() => setIsPinPromptOpen(false)}
                    onSuccess={() => {
                        setShowDataManagement(true);
                        showToast('Access granted', 'success');
                    }}
                    title="Unlock Data Management"
                    description="Enter your PIN to access backup and migration tools"
                />





                {/* General Settings Section */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                        <Globe className="text-primary" size={24} />
                        <h2 style={{ fontSize: '20px', fontWeight: '600' }}>{t('settings.generalConfig')}</h2>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.currency')}</label>
                            <select
                                value={localState.currency}
                                onChange={(e) => setLocalState({ ...localState, currency: e.target.value })}
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            >
                                <option>USD ($)</option>
                                <option>EUR (€)</option>
                                <option>GBP (£)</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.taxRate')}</label>
                            <input
                                type="number"
                                value={localState.taxRate}
                                onChange={(e) => setLocalState({ ...localState, taxRate: Number(e.target.value) })}
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.khrExchangeRate')}</label>
                            <input
                                type="number"
                                value={localState.khrExchangeRate}
                                onChange={(e) => setLocalState({ ...localState, khrExchangeRate: Number(e.target.value) })}
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                            <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                                {t('settings.khrExchangeRateNote')}
                            </p>
                        </div>
                    </div>
                    <div style={{ marginTop: '20px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.timezone')}</label>
                        <select
                            value={localState.timezone}
                            onChange={(e) => setLocalState({ ...localState, timezone: e.target.value })}
                            className="search-input"
                            style={{ width: '100%', padding: '12px' }}
                        >
                            <option value="Asia/Phnom_Penh">Phnom Penh (GMT+7)</option>
                            <option value="Asia/Bangkok">Bangkok (GMT+7)</option>
                            <option value="Asia/Ho_Chi_Minh">Ho Chi Minh (GMT+7)</option>
                            <option value="America/New_York">New York (GMT-5)</option>
                            <option value="Europe/London">London (GMT+0)</option>
                            <option value="UTC">UTC (GMT+0)</option>
                        </select>
                        <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                            {t('settings.timezoneNote')}
                        </p>
                    </div>
                </div>

                {/* Telegram Notifications Section */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Bell className="text-primary" size={24} />
                            <h2 style={{ fontSize: '20px', fontWeight: '600' }}>{t('settings.telegramNotifications')}</h2>
                        </div>
                        <button
                            onClick={async () => {
                                if (!localState.telegramBotToken || !localState.telegramChatId) {
                                    showToast('Please enter Bot Token and Chat ID first', 'error');
                                    return;
                                }
                                try {
                                    const { sendTelegramTestMessage } = await import('../utils/telegram');
                                    await sendTelegramTestMessage(localState.telegramBotToken, localState.telegramChatId);
                                    showToast('Test message sent!', 'success');
                                } catch (err: any) {
                                    showToast(err.message || 'Failed to send test message', 'error');
                                }
                            }}
                            className="primary-button"
                            style={{ padding: '8px 16px', fontSize: '13px', background: 'var(--color-surface)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)' }}
                        >
                            {t('settings.sendTest')}
                        </button>
                    </div>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
                        {t('settings.telegramNote')}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.telegramBotToken')}</label>
                            <input
                                type="password"
                                value={localState.telegramBotToken}
                                onChange={(e) => setLocalState({ ...localState, telegramBotToken: e.target.value })}
                                placeholder="123456789:ABCDefgh..."
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>{t('settings.telegramChatIds')}</label>
                            <input
                                type="text"
                                value={localState.telegramChatId}
                                onChange={(e) => setLocalState({ ...localState, telegramChatId: e.target.value })}
                                placeholder="-100123..., -45678..."
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Security Section */}
                <div className="glass-panel" style={{ padding: '24px', opacity: 0.7 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                        <Shield size={24} />
                        <h3 style={{ fontSize: '18px', fontWeight: '600' }}>{t('settings.security')}</h3>
                    </div>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>{t('settings.securityNote')}</p>
                </div>

                {/* Data Migration Section */}
                <div className="glass-panel" style={{ padding: '24px', borderColor: 'var(--color-primary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                        <Database size={24} className="text-primary" />
                        <h3 style={{ fontSize: '18px', fontWeight: '600' }}>{t('settings.dataManagement')}</h3>
                    </div>

                    {!showDataManagement ? (
                        <div style={{ textAlign: 'center', padding: '20px 0' }}>
                            <p style={{ color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                                {t('settings.dataProtected')}
                            </p>
                            <button
                                onClick={() => setIsPinPromptOpen(true)}
                                className="primary-button"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '10px 20px'
                                }}
                            >
                                <Shield size={18} />
                                {t('settings.unlockDataManagement')}
                            </button>
                        </div>
                    ) : (
                        <>
                            <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
                                {t('settings.dataManagementNote')}
                            </p>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button
                                    onClick={async () => {
                                        await backupData();
                                        showToast('Backup download started', 'success');
                                    }}
                                    className="primary-button"
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: 'var(--color-surface)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)' }}
                                >
                                    <Save size={18} />
                                    {t('settings.backupDatabase')}
                                </button>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type="file"
                                        id="restore-file"
                                        style={{ display: 'none' }}
                                        accept=".json"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;

                                            if (!confirm(`Are you sure you want to restore from ${file.name}? This will OVERWRITE existing data with the same IDs.`)) {
                                                e.target.value = ''; // Reset
                                                return;
                                            }

                                            const reader = new FileReader();
                                            reader.onload = async (event) => {
                                                try {
                                                    const json = JSON.parse(event.target?.result as string);
                                                    await restoreData(json);
                                                } catch (err) {
                                                    console.error(err);
                                                    showToast('Failed to parse backup file', 'error');
                                                }
                                            };
                                            reader.readAsText(file);
                                            e.target.value = ''; // Reset
                                        }}
                                    />
                                    <button
                                        onClick={() => document.getElementById('restore-file')?.click()}
                                        className="primary-button"
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}
                                    >
                                        <Database size={18} />
                                        {t('settings.restoreDatabase')}
                                    </button>
                                </div>
                                <button
                                    onClick={handleMigration}
                                    className="primary-button"
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}
                                >
                                    <Database size={18} />
                                    {t('settings.migrateToSupabase')}
                                </button>
                            </div>
                        </>
                    )}
                </div>


            </div>
        </div>
    );
};

export default Settings;
