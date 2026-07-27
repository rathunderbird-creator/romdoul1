import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Store, Palette } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { supabase } from '../../lib/supabase';
import { processImageForUpload } from '../../utils/imageUtils';

const StoreProfileSettings: React.FC = () => {
    const { storeName, storeAddress, logo, email, phone, updateStoreProfile } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();
    const { themeColor, setThemeColor, fontSize, setFontSize, resetTheme } = useTheme();

    const [localState, setLocalState] = useState({
        storeName: '',
        storeAddress: '',
        email: '',
        phone: '',
        logo: ''
    });

    const [isUploadingLogo, setIsUploadingLogo] = useState(false);
    const originalStateRef = useRef<any>(null);

    useEffect(() => {
        const originalState = {
            storeName: storeName || '',
            storeAddress: storeAddress || '',
            email: email || '',
            phone: phone || '',
            logo: logo || ''
        };
        originalStateRef.current = originalState;
        setLocalState(originalState);
    }, [storeName, storeAddress, email, phone, logo]);

    const hasChanges = originalStateRef.current ? JSON.stringify(localState) !== JSON.stringify(originalStateRef.current) : false;

    const handleSave = useCallback(async () => {
        try {
            await updateStoreProfile({
                storeName: localState.storeName,
                storeAddress: localState.storeAddress,
                email: localState.email,
                phone: localState.phone,
                logo: localState.logo
            });
            showToast(t('settings.settingsSaved'), 'success');
        } catch (error) {
            console.error(error);
            showToast(t('settings.settingsFailed'), 'error');
        }
    }, [localState, updateStoreProfile, showToast, t]);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{t('settings.storeProfile')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '14px' }}>Manage your business info and appearance</p>
                </div>
            ),
            actions: (
                <button
                    onClick={handleSave}
                    disabled={!hasChanges}
                    className="primary-button"
                    style={{
                        padding: '12px 24px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        opacity: hasChanges ? 1 : 0.5,
                        cursor: hasChanges ? 'pointer' : 'not-allowed'
                    }}
                >
                    <Save size={20} />
                    {t('settings.saveChanges')}
                </button>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t, handleSave, hasChanges]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
            
            {/* Appearance Section */}
            <div className="glass-panel" style={{ padding: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                    <Palette className="text-primary" size={24} />
                    <h2 style={{ fontSize: '20px', fontWeight: '600' }}>{t('settings.appearance')}</h2>
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
                                            const processedBlob = await processImageForUpload(file, { width: 300, quality: 0.9 });
                                            const fileName = `logo_${Date.now()}.jpg`;

                                            const { error } = await supabase.storage
                                                .from('products')
                                                .upload(fileName, processedBlob, {
                                                    contentType: 'image/jpeg',
                                                    upsert: false
                                                });

                                            if (error) throw error;

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
                                            e.target.value = '';
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
        </div>
    );
};

export default StoreProfileSettings;
