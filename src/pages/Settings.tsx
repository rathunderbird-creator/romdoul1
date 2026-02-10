import React, { useState } from 'react';
import { Save, Store, Globe, Bell, Shield, Moon, Sun, Database } from 'lucide-react';
import { migrateData } from '../lib/migration';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useTheme } from '../context/ThemeContext';




const Settings: React.FC = () => {
    const { storeAddress, updateStoreAddress, storeName, email, phone, updateStoreProfile } = useStore();
    const { showToast } = useToast();
    const { themeColor, setThemeColor, fontSize, setFontSize, resetTheme, isDarkMode, toggleTheme } = useTheme();
    const { setHeaderContent } = useHeader();

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
    }, [setHeaderContent, isDarkMode]); // Add dependencies if needed, handleSave might need to be wrapped or stable.

    // Local state for settings form (mock implementation)
    const [currency, setCurrency] = useState('USD ($)');
    const [taxRate, setTaxRate] = useState('8.5');





    const handleSave = () => {
        // Placeholder for save functionality
        showToast('Settings saved successfully!', 'success');
    };





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
                        <button
                            onClick={toggleTheme}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'var(--color-bg)',
                                border: '1px solid var(--color-border)',
                                padding: '8px 16px',
                                borderRadius: '20px',
                                cursor: 'pointer',
                                color: 'var(--color-text-main)'
                            }}
                        >
                            {isDarkMode ? <Moon size={18} /> : <Sun size={18} />}
                            <span>{isDarkMode ? 'Dark Mode' : 'Light Mode'}</span>
                        </button>
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
                                value={storeName}
                                onChange={(e) => updateStoreProfile({ storeName: e.target.value })}
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Store Address</label>
                            <input
                                type="text"
                                value={storeAddress}
                                onChange={(e) => updateStoreAddress(e.target.value)}
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
                                    value={email}
                                    onChange={(e) => updateStoreProfile({ email: e.target.value })}
                                    className="search-input"
                                    style={{ width: '100%', padding: '12px' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Phone Number</label>
                                <input
                                    type="tel"
                                    value={phone}
                                    onChange={(e) => updateStoreProfile({ phone: e.target.value })}
                                    className="search-input"
                                    style={{ width: '100%', padding: '12px' }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Data Migration Section */}
                <div className="glass-panel" style={{ padding: '24px', borderColor: 'var(--color-primary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                        <Database size={24} className="text-primary" />
                        <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Data Migration</h3>
                    </div>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
                        Upload your local data to the cloud database (Supabase). This ensures your data is backed up and accessible across devices.
                    </p>
                    <button
                        onClick={handleMigration}
                        className="primary-button"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}
                    >
                        <Database size={18} />
                        Migrate to Supabase
                    </button>
                </div>





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
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value)}
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
                                value={taxRate}
                                onChange={(e) => setTaxRate(e.target.value)}
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                        </div>
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


            </div>
        </div>
    );
};

export default Settings;
