import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, Eye, EyeOff, ChevronDown } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import type { TelegramConfig } from '../../types';

const TelegramSettings: React.FC = () => {
    const { telegramBotToken, telegramChatId, telegramConfigs, updateStoreProfile } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();

    const [localState, setLocalState] = useState<{ telegramConfigs: TelegramConfig[] }>({
        telegramConfigs: []
    });

    const [visibleTokens, setVisibleTokens] = useState<Record<number, boolean>>({});
    const [statusDropdownOpen, setStatusDropdownOpen] = useState<Record<number, boolean>>({});
    const [templateDropdownOpen, setTemplateDropdownOpen] = useState<Record<number, boolean>>({});

    const originalStateRef = useRef<{ telegramConfigs: TelegramConfig[] }>({ telegramConfigs: [] });

    useEffect(() => {
        let initialConfigs = telegramConfigs || [];
        if (initialConfigs.length === 0) {
            initialConfigs = [{
                id: crypto.randomUUID(),
                name: 'Main Group',
                botToken: telegramBotToken || '',
                chatId: telegramChatId || '',
                triggerStatuses: ['Ordered', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned'],
                note: ''
            }];
        }
        
        const originalState = { telegramConfigs: initialConfigs };
        originalStateRef.current = originalState;
        setLocalState(originalState);
    }, [telegramBotToken, telegramChatId, telegramConfigs]);

    const handleCommitTelegramConfigs = useCallback(async (configId: string) => {
        const originalConfigs: TelegramConfig[] = originalStateRef.current.telegramConfigs || [];
        const localConfig = localState.telegramConfigs.find(c => c.id === configId);
        
        let mergedConfigs = [...originalConfigs];
        if (!localConfig) {
            mergedConfigs = originalConfigs.filter((c: TelegramConfig) => c.id !== configId);
        } else {
            const existingIndex = mergedConfigs.findIndex(c => c.id === configId);
            if (existingIndex >= 0) {
                mergedConfigs[existingIndex] = localConfig;
            } else {
                mergedConfigs.push(localConfig);
            }
        }
        
        try {
            await updateStoreProfile({
                telegramConfigs: mergedConfigs
            });
            showToast('Telegram Configuration committed!', 'success');
        } catch (error: any) {
            console.error(error);
            showToast('Failed to commit Telegram configuration: ' + (error.message || 'Unknown error'), 'error');
        }
    }, [localState, updateStoreProfile, showToast]);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{t('settings.telegramNotifications')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '14px' }}>Configure your bot alerts</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
            <div className="glass-panel" style={{ padding: '24px', position: 'relative', zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Bell className="text-primary" size={24} />
                        <h2 style={{ fontSize: '20px', fontWeight: '600' }}>{t('settings.telegramNotifications')}</h2>
                    </div>
                    <button
                        onClick={() => {
                            const newConfig: TelegramConfig = {
                                id: crypto.randomUUID(),
                                name: 'New Group',
                                botToken: '',
                                chatId: '',
                                triggerStatuses: ['Ordered']
                            };
                            setLocalState({ ...localState, telegramConfigs: [...(localState.telegramConfigs || []), newConfig] });
                        }}
                        className="primary-button"
                        style={{ padding: '8px 16px', fontSize: '13px', background: 'var(--color-surface)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)' }}
                    >
                        + Add Group
                    </button>
                </div>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
                    {t('settings.telegramNote')}
                </p>

                {localState.telegramConfigs?.map((config, index) => {
                    const originalConfig = originalStateRef.current?.telegramConfigs?.find(c => c.id === config.id);
                    const isRowChanged = !originalConfig || JSON.stringify(config) !== JSON.stringify(originalConfig);

                    return (
                    <div key={config.id} style={{ marginBottom: '20px', padding: '16px', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', position: 'relative', zIndex: 100 - index }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <input 
                                type="text" 
                                value={config.name}
                                onChange={(e) => {
                                    const newConfigs = [...localState.telegramConfigs];
                                    newConfigs[index] = { ...newConfigs[index], name: e.target.value };
                                    setLocalState({ ...localState, telegramConfigs: newConfigs });
                                }}
                                style={{ fontSize: '16px', fontWeight: '600', padding: '4px 8px', border: '1px solid transparent', borderBottom: '1px solid var(--color-border)', background: 'transparent' }}
                                placeholder="Group Name"
                            />
                            <div>
                                <button
                                    onClick={() => {
                                        const newConfigs = localState.telegramConfigs.filter((_, i) => i !== index);
                                        setLocalState({ ...localState, telegramConfigs: newConfigs });
                                        // Auto-commit removals since there's no overall Save button for telegram easily accessible
                                        handleCommitTelegramConfigs(config.id);
                                    }}
                                    style={{ padding: '6px 12px', fontSize: '12px', background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                        
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'nowrap' }}>
                            <div style={{ flex: '1' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '13px' }}>Bot Token</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={visibleTokens[index] ? "text" : "password"}
                                        value={config.botToken}
                                        onChange={(e) => {
                                            const newConfigs = [...localState.telegramConfigs];
                                            newConfigs[index] = { ...newConfigs[index], botToken: e.target.value };
                                            setLocalState({ ...localState, telegramConfigs: newConfigs });
                                        }}
                                        placeholder="123456789:ABCDefgh..."
                                        className="search-input"
                                        style={{ width: '100%', padding: '10px', paddingRight: '40px' }}
                                    />
                                    <button
                                        onClick={() => setVisibleTokens(prev => ({ ...prev, [index]: !prev[index] }))}
                                        style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}
                                    >
                                        {visibleTokens[index] ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>
                            
                            <div style={{ flex: '1' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '13px' }}>Chat IDs</label>
                                <input
                                    type="text"
                                    value={config.chatId}
                                    onChange={(e) => {
                                        const newConfigs = [...localState.telegramConfigs];
                                        newConfigs[index] = { ...newConfigs[index], chatId: e.target.value };
                                        setLocalState({ ...localState, telegramConfigs: newConfigs });
                                    }}
                                    placeholder="-100123..., -45678..."
                                    className="search-input"
                                    style={{ width: '100%', padding: '10px' }}
                                />
                            </div>

                            <div style={{ flex: '1' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '13px' }}>Trigger Statuses</label>
                                <div style={{ position: 'relative' }}>
                                    <div
                                        onClick={() => setStatusDropdownOpen(prev => ({ ...prev, [index]: !prev[index] }))}
                                        className="search-input"
                                        style={{ width: '100%', padding: '10px', minHeight: '42px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-bg)' }}
                                    >
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', minWidth: 0, flex: 1, marginRight: '8px' }}>
                                            {config.triggerStatuses?.length === 8 ? 'All Statuses' : (config.triggerStatuses?.length > 0 ? config.triggerStatuses.join(', ') : 'Select Status')}
                                        </span>
                                        <ChevronDown size={16} />
                                    </div>
                                    {statusDropdownOpen[index] && (
                                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', marginTop: '4px', padding: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', maxHeight: '200px', overflowY: 'auto' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid var(--color-border)', marginBottom: '4px', fontWeight: 600 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={config.triggerStatuses?.length === 8}
                                                    onChange={(e) => {
                                                        const newConfigs = [...localState.telegramConfigs];
                                                        if (e.target.checked) {
                                                            newConfigs[index] = { ...newConfigs[index], triggerStatuses: ['Ordered', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled'] };
                                                        } else {
                                                            newConfigs[index] = { ...newConfigs[index], triggerStatuses: [] };
                                                        }
                                                        setLocalState({ ...localState, telegramConfigs: newConfigs });
                                                    }}
                                                    style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                                                />
                                                All Statuses
                                            </label>
                                            {['Ordered', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled'].map(status => (
                                                <label key={status} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', cursor: 'pointer', fontSize: '13px' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={config.triggerStatuses?.includes(status) || false}
                                                        onChange={(e) => {
                                                            const newConfigs = [...localState.telegramConfigs];
                                                            const currentStatuses = config.triggerStatuses || [];
                                                            if (e.target.checked) {
                                                                newConfigs[index] = { ...newConfigs[index], triggerStatuses: [...currentStatuses, status] };
                                                            } else {
                                                                newConfigs[index] = { ...newConfigs[index], triggerStatuses: currentStatuses.filter(s => s !== status) };
                                                            }
                                                            setLocalState({ ...localState, telegramConfigs: newConfigs });
                                                        }}
                                                        style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                                                    />
                                                    {status}
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            <div style={{ flex: '1' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '13px' }}>Note (Remark)</label>
                                <input
                                    type="text"
                                    value={config.note || ''}
                                    onChange={(e) => {
                                        const newConfigs = [...localState.telegramConfigs];
                                        newConfigs[index] = { ...newConfigs[index], note: e.target.value };
                                        setLocalState({ ...localState, telegramConfigs: newConfigs });
                                    }}
                                    placeholder="Add a remark for this bot configuration..."
                                    className="search-input"
                                    style={{ width: '100%', padding: '10px' }}
                                />
                            </div>
                                <button
                                    onClick={() => setTemplateDropdownOpen(prev => ({ ...prev, [index]: !prev[index] }))}
                                    style={{ padding: '10px 16px', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}
                                >
                                    Template
                                </button>
                                <button
                                    onClick={async () => {
                                        if (!config.botToken || !config.chatId) {
                                            showToast('Please enter Bot Token and Chat ID first', 'error');
                                            return;
                                        }
                                        try {
                                            const { sendTelegramTestMessage } = await import('../../utils/telegram');
                                            await sendTelegramTestMessage(config.botToken, config.chatId);
                                            showToast('Test message sent!', 'success');
                                        } catch (err: any) {
                                            showToast(err.message || 'Failed to send test message', 'error');
                                        }
                                    }}
                                    style={{ padding: '10px 16px', fontSize: '13px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}
                                >
                                    Test
                                </button>
                                <button
                                    onClick={() => handleCommitTelegramConfigs(config.id)}
                                    disabled={!isRowChanged}
                                    style={{ padding: '10px 16px', fontSize: '13px', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: isRowChanged ? 'pointer' : 'not-allowed', fontWeight: 600, height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', opacity: isRowChanged ? 1 : 0.5 }}
                                >
                                    Commit
                                </button>
                        </div>
                        {templateDropdownOpen[index] && (
                            <div style={{ marginTop: '8px', padding: '16px', background: 'var(--color-bg)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '13px' }}>Message Template</label>
                                <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
                                    Available variables: <code>{`{order_no}`}</code>, <code>{`{customer_name}`}</code>, <code>{`{phone}`}</code>, <code>{`{address}`}</code>, <code>{`{page}`}</code>, <code>{`{items}`}</code>, <code>{`{total}`}</code>, <code>{`{shipping_company}`}</code>, <code>{`{salesman}`}</code>, <code>{`{remark}`}</code>
                                </p>
                                <textarea
                                    value={config.messageTemplate || ''}
                                    onChange={(e) => {
                                        const newConfigs = [...localState.telegramConfigs];
                                        newConfigs[index] = { ...newConfigs[index], messageTemplate: e.target.value };
                                        setLocalState({ ...localState, telegramConfigs: newConfigs });
                                    }}
                                    placeholder="Leave empty to use the default message format."
                                    className="search-input"
                                    style={{ width: '100%', padding: '12px', minHeight: '150px', resize: 'vertical', fontFamily: 'monospace', fontSize: '13px' }}
                                />
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                                    <button
                                        onClick={async () => {
                                            if (!config.botToken || !config.chatId) {
                                                showToast('Please enter Bot Token and Chat ID first', 'error');
                                                return;
                                            }
                                            if (!config.messageTemplate) {
                                                showToast('Please enter a message template to test', 'error');
                                                return;
                                            }
                                            try {
                                                const { sendTelegramTestTemplateMessage } = await import('../../utils/telegram');
                                                await sendTelegramTestTemplateMessage(config.botToken, config.chatId, config.messageTemplate);
                                                showToast('Test template message sent!', 'success');
                                            } catch (err: any) {
                                                showToast(err.message || 'Failed to send test message', 'error');
                                            }
                                        }}
                                        style={{ padding: '8px 16px', fontSize: '13px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    >
                                        Test Template
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TelegramSettings;
