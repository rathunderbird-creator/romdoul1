import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Store, Globe, Bell, Shield, Database } from 'lucide-react';
import { migrateData } from '../lib/migration';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useTheme } from '../context/ThemeContext';
import PinPrompt from '../components/PinPrompt';




const Settings: React.FC = () => {
    const { storeAddress, storeName, logo, email, phone, updateStoreProfile, backupData, restoreData, timezone, taxRate, currency } = useStore();
    const { showToast } = useToast();
    const { themeColor, setThemeColor, fontSize, setFontSize, resetTheme } = useTheme();
    const { setHeaderContent } = useHeader();

    // Local State
    const [localState, setLocalState] = useState({
        storeName: '',
        storeAddress: '',
        email: '',
        phone: '',
        timezone: '',
        taxRate: 0,
        currency: '',
        logo: ''
    });

    // PIN Protection State
    const [showDataManagement, setShowDataManagement] = useState(false);
    const [isPinPromptOpen, setIsPinPromptOpen] = useState(false);

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
                logo: currentData.logo
            });
            showToast('Settings saved successfully!', 'success');
        } catch (error) {
            console.error(error);
            showToast('Failed to save settings', 'error');
        }
    }, [updateStoreProfile, showToast]); // Dependencies for context functions

    // Header Content
    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Settings</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage your store preferences and configuration</p>
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
                    Save Changes
                </button>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, handleSave]);


    useEffect(() => {
        setLocalState({
            storeName: storeName || '',
            storeAddress: storeAddress || '',
            email: email || '',
            phone: phone || '',
            timezone: timezone || 'Asia/Phnom_Penh',
            taxRate: taxRate || 0,
            currency: currency || 'USD ($)',
            logo: logo || ''
        });
    }, [storeName, storeAddress, email, phone, timezone, taxRate, currency, logo]);







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
                            <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Appearance</h2>
                        </div>

                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Theme Color</label>
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
                                Font Size: {fontSize}px
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
                                <span>Small</span>
                                <span>Medium</span>
                                <span>Large</span>
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
                                Reset to Defaults
                            </button>
                        </div>
                    </div>
                </div>

                {/* Store Profile Section */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                        <Store className="text-primary" size={24} />
                        <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Store Profile</h2>
                    </div>

                    <div style={{ display: 'grid', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Store Name</label>
                            <input
                                type="text"
                                value={localState.storeName}
                                onChange={(e) => setLocalState({ ...localState, storeName: e.target.value })}
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Store Logo</label>
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
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                if (file.size > 500000) { // 500KB limit
                                                    showToast('Image too large (max 500KB)', 'error');
                                                    return;
                                                }
                                                const reader = new FileReader();
                                                reader.onloadend = () => {
                                                    setLocalState({ ...localState, logo: reader.result as string });
                                                };
                                                reader.readAsDataURL(file);
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={() => document.getElementById('logo-upload')?.click()}
                                        style={{
                                            padding: '8px 16px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--color-border)',
                                            background: 'var(--color-surface)',
                                            cursor: 'pointer',
                                            fontSize: '13px',
                                            color: 'var(--color-text-main)'
                                        }}
                                    >
                                        Upload Logo
                                    </button>
                                    <p style={{ marginTop: '4px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>Max 500KB. Square ratio recommended.</p>
                                </div>
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Store Address</label>
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
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Email Address</label>
                                <input
                                    type="email"
                                    value={localState.email}
                                    onChange={(e) => setLocalState({ ...localState, email: e.target.value })}
                                    className="search-input"
                                    style={{ width: '100%', padding: '12px' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Phone Number</label>
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
                        <h2 style={{ fontSize: '20px', fontWeight: '600' }}>General Configuration</h2>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Currency</label>
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
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Tax Rate (%)</label>
                            <input
                                type="number"
                                value={localState.taxRate}
                                onChange={(e) => setLocalState({ ...localState, taxRate: Number(e.target.value) })}
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                        </div>
                    </div>
                    <div style={{ marginTop: '20px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Timezone</label>
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
                            Affects date display across the application.
                        </p>
                    </div>
                </div>

                {/* Notifications & Security (Placeholder) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="glass-panel" style={{ padding: '24px', opacity: 0.7 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                            <Bell size={24} />
                            <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Notifications</h3>
                        </div>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Manage email and push notification preferences.</p>
                    </div>
                    <div className="glass-panel" style={{ padding: '24px', opacity: 0.7 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                            <Shield size={24} />
                            <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Security</h3>
                        </div>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Update password and 2FA settings.</p>
                    </div>
                </div>

                {/* Data Migration Section */}
                <div className="glass-panel" style={{ padding: '24px', borderColor: 'var(--color-primary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                        <Database size={24} className="text-primary" />
                        <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Data Management</h3>
                    </div>

                    {!showDataManagement ? (
                        <div style={{ textAlign: 'center', padding: '20px 0' }}>
                            <p style={{ color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                                This section is protected. Please enter your PIN to access sensitive data operations.
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
                                Unlock Data Management
                            </button>
                        </div>
                    ) : (
                        <>
                            <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
                                Manage your application data. You can back up your current data to a JSON file or migrate local data to the cloud.
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
                                    Backup Database
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
                                        Restore Database
                                    </button>
                                </div>
                                <button
                                    onClick={handleMigration}
                                    className="primary-button"
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}
                                >
                                    <Database size={18} />
                                    Migrate to Supabase
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
