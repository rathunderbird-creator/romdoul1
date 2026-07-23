import React, { useState, useEffect } from 'react';
import { Database, Save, Shield } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import PinPrompt from '../../components/PinPrompt';
import { migrateData } from '../../lib/migration';

const DatabaseSettings: React.FC = () => {
    const { backupData, restoreData } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();

    const [showDataManagement, setShowDataManagement] = useState(false);
    const [isPinPromptOpen, setIsPinPromptOpen] = useState(false);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{t('settings.dataManagement')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '14px' }}>Backup, restore, and migrate your data</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
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
        </div>
    );
};

export default DatabaseSettings;
