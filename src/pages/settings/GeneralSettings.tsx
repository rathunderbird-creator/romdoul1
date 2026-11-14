import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Save } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import { checkRate, DEFAULT_KHR_RATE, formatRate, shopRate } from '../../utils/currency';

const GeneralSettings: React.FC = () => {
    const { timezone, taxRate, currency, khrExchangeRate, khrExchangeRateUpdatedAt, updateStoreProfile } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();

    const [localState, setLocalState] = useState({
        timezone: '',
        taxRate: 0,
        currency: '',
        khrExchangeRate: DEFAULT_KHR_RATE
    });

    const originalStateRef = useRef<any>(null);

    useEffect(() => {
        const originalState = {
            timezone: timezone || 'Asia/Phnom_Penh',
            taxRate: taxRate || 0,
            currency: currency || 'USD ($)',
            khrExchangeRate: shopRate(khrExchangeRate)
        };
        originalStateRef.current = originalState;
        setLocalState(originalState);
    }, [timezone, taxRate, currency, khrExchangeRate]);

    const hasChanges = originalStateRef.current ? JSON.stringify(localState) !== JSON.stringify(originalStateRef.current) : false;

    const rateCheck = checkRate(Number(localState.khrExchangeRate), shopRate(khrExchangeRate));

    const handleSave = useCallback(async () => {
        // The shop rate converts every riel payment: never 0 or empty, and
        // a figure far from the usual ~4,100 needs a confirm.
        const rate = Math.round(Number(localState.khrExchangeRate));
        const check = checkRate(rate, shopRate(khrExchangeRate));
        if (check === 'invalid') {
            showToast(t('settings.khrExchangeRateInvalid'), 'error');
            return;
        }
        if (check && !window.confirm(`The rate ${formatRate(rate)} riel per dollar is far from the usual (now ${formatRate(shopRate(khrExchangeRate))}). Save it anyway?`)) return;
        try {
            await updateStoreProfile({
                timezone: localState.timezone,
                taxRate: localState.taxRate,
                currency: localState.currency,
                khrExchangeRate: rate
            });
            showToast(t('settings.settingsSaved'), 'success');
        } catch (error) {
            console.error(error);
            showToast(t('settings.settingsFailed'), 'error');
        }
    }, [localState, khrExchangeRate, updateStoreProfile, showToast, t]);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>General</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '14px' }}>Configure regional and tax settings</p>
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
            <div className="glass-panel" style={{ padding: '24px' }}>
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
                            min="1"
                            step="1"
                            onChange={(e) => setLocalState({ ...localState, khrExchangeRate: Number(e.target.value) })}
                            className="search-input"
                            style={{ width: '100%', padding: '12px', borderColor: rateCheck === 'invalid' ? '#DC2626' : (rateCheck ? '#F59E0B' : undefined) }}
                        />
                        {rateCheck === 'invalid' && (
                            <p style={{ fontSize: '12px', color: '#DC2626', marginTop: '4px' }}>{t('settings.khrExchangeRateInvalid')}</p>
                        )}
                        {rateCheck && rateCheck !== 'invalid' && (
                            <p style={{ fontSize: '12px', color: '#B45309', marginTop: '4px' }}>
                                {formatRate(Number(localState.khrExchangeRate))} is far from the usual 3,500-4,700.
                            </p>
                        )}
                        <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                            {t('settings.khrExchangeRateNote')}
                        </p>
                        <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                            {khrExchangeRateUpdatedAt
                                ? `${t('settings.khrExchangeRateLastChanged')}: ${new Date(khrExchangeRateUpdatedAt).toLocaleDateString()}`
                                : t('settings.khrExchangeRateNeverChanged')}
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
        </div>
    );
};

export default GeneralSettings;
