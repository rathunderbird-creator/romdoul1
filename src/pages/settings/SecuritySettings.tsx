import React, { useEffect } from 'react';
import { Shield } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';

const SecuritySettings: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();

    useEffect(() => {
        setHeaderContent({
            title: (
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{t('settings.security')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '14px' }}>Manage security settings</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
            <div className="glass-panel" style={{ padding: '24px', opacity: 0.7 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <Shield size={24} />
                    <h3 style={{ fontSize: '18px', fontWeight: '600' }}>{t('settings.security')}</h3>
                </div>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>{t('settings.securityNote')}</p>
            </div>
        </div>
    );
};

export default SecuritySettings;
