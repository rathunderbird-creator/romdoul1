import React, { useState, useEffect, useRef, useCallback } from 'react';
import { isValidBotToken, splitChatIds, telegramConfigProblem } from '../../utils/telegram';
import { Bell, Eye, EyeOff, ChevronDown } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import { fill } from '../../i18n/translate';
import type { TelegramConfig } from '../../types';

const TelegramSettings: React.FC = () => {
    const { telegramBotToken, telegramChatId, telegramConfigs, commitTelegramGroup, removeTelegramGroup } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();
    // Status codes stay as stored; only their display is translated.
    const statusLabel = (s: string) => { const v = t('ui.admin.telegram.status.' + s); return v && v !== 'ui.admin.telegram.status.' + s ? v : s; };

    const [localState, setLocalState] = useState<{ telegramConfigs: TelegramConfig[] }>({
        telegramConfigs: []
    });

    const [visibleTokens, setVisibleTokens] = useState<Record<number, boolean>>({});
    const [statusDropdownOpen, setStatusDropdownOpen] = useState<Record<number, boolean>>({});
    const [templateDropdownOpen, setTemplateDropdownOpen] = useState<Record<number, boolean>>({});

    const originalStateRef = useRef<{ telegramConfigs: TelegramConfig[] }>({ telegramConfigs: [] });
    // The legacy single-token draft is synthesized once, on first mount only.
    // Re-synthesizing whenever the list is empty made removing the LAST group
    // look broken: the deleted row's bot token reappeared as a fresh "Main
    // Group" draft (HR-1 all over again, visually).
    const seededLegacyDraftRef = useRef(false);

    useEffect(() => {
        let initialConfigs = telegramConfigs || [];
        if (initialConfigs.length === 0 && !seededLegacyDraftRef.current) {
            seededLegacyDraftRef.current = true;
            initialConfigs = [{
                id: crypto.randomUUID(),
                name: 'Main Group',
                botToken: telegramBotToken || '',
                chatId: telegramChatId || '',
                triggerStatuses: ['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned'],
                note: ''
            }];
        }

        const originalState = { telegramConfigs: initialConfigs };
        originalStateRef.current = originalState;
        setLocalState(originalState);
    }, [telegramBotToken, telegramChatId, telegramConfigs]);

    // In-flight guard: committing or removing twice in a row would race the
    // delete/upsert against itself.
    const [isCommitting, setIsCommitting] = useState(false);

    // Commit saves ONE group's row; it never re-upserts the other groups from
    // this screen's possibly stale copy (another terminal's edits to them
    // would be silently reverted).
    const handleCommitTelegramConfigs = useCallback(async (configId: string) => {
        const localConfig = localState.telegramConfigs.find(c => c.id === configId);
        if (!localConfig) return;
        if (isCommitting) {
            showToast(t('ui.admin.telegram.anotherSave'), 'error');
            return;
        }
        // A group that can never send is not saved (a token like "t" made
        // every new order show "Telegram Error: … Failed to fetch").
        const problem = telegramConfigProblem(localConfig.botToken, localConfig.chatId);
        if (problem) {
            showToast(problem, 'error');
            return;
        }
        setIsCommitting(true);
        try {
            await commitTelegramGroup({ ...localConfig, botToken: localConfig.botToken.trim(), chatId: splitChatIds(localConfig.chatId).join(', ') });
            showToast(t('ui.admin.telegram.committed'), 'success');
        } catch (error) {
            console.error(error);
            showToast(fill(t('ui.admin.telegram.commitFailed'), { error: error instanceof Error ? error.message : t('ui.admin.settings.db.unknownError') }), 'error');
        } finally {
            setIsCommitting(false);
        }
    }, [localState, isCommitting, commitTelegramGroup, showToast, t]);

    // HR-1: Remove deletes exactly this one group's row. On failure the row is
    // put back on screen (it still exists in the database).
    const handleRemoveTelegramConfig = useCallback(async (configId: string) => {
        const originalConfigs: TelegramConfig[] = originalStateRef.current.telegramConfigs || [];
        if (!originalConfigs.some(c => c.id === configId)) {
            // A never-committed "+ Add Group" draft: discard locally, nothing
            // to delete or re-save in the database.
            setLocalState(prev => ({ ...prev, telegramConfigs: prev.telegramConfigs.filter(c => c.id !== configId) }));
            showToast(t('ui.admin.telegram.groupRemoved'), 'success');
            return;
        }
        if (isCommitting) {
            showToast(t('ui.admin.telegram.anotherSave'), 'error');
            return;
        }
        setIsCommitting(true);
        const before = localState.telegramConfigs;
        setLocalState(prev => ({ ...prev, telegramConfigs: prev.telegramConfigs.filter(c => c.id !== configId) }));
        try {
            await removeTelegramGroup(configId);
            showToast(t('ui.admin.telegram.telegramGroupRemoved'), 'success');
        } catch (error) {
            console.error(error);
            // The delete failed: the group still exists — show it again.
            setLocalState(prev => ({ ...prev, telegramConfigs: before }));
            showToast(fill(t('ui.admin.telegram.removeFailed'), { error: error instanceof Error ? error.message : t('ui.admin.settings.db.unknownError') }), 'error');
        } finally {
            setIsCommitting(false);
        }
    }, [localState, isCommitting, removeTelegramGroup, showToast, t]);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{t('settings.telegramNotifications')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '14px' }}>{t('ui.admin.telegram.subtitle')}</p>
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
                                triggerStatuses: ['Drafted']
                            };
                            setLocalState({ ...localState, telegramConfigs: [...(localState.telegramConfigs || []), newConfig] });
                        }}
                        className="primary-button"
                        style={{ padding: '8px 16px', fontSize: '13px', background: 'var(--color-surface)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)' }}
                    >
                        {t('ui.admin.telegram.addGroup')}
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
                                placeholder={t('ui.admin.telegram.groupName')}
                            />
                            <div>
                                <button
                                    // Auto-commit removals since there's no overall Save button for telegram easily accessible
                                    onClick={() => handleRemoveTelegramConfig(config.id)}
                                    disabled={isCommitting}
                                    style={{ padding: '6px 12px', fontSize: '12px', background: '#FEE2E2', color: '#DC2626', border: 'none', borderRadius: '4px', cursor: isCommitting ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: isCommitting ? 0.6 : 1 }}
                                >
                                    {t('ui.admin.telegram.remove')}
                                </button>
                            </div>
                        </div>
                        
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'nowrap' }}>
                            <div style={{ flex: '1' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '13px' }}>{t('ui.admin.telegram.botToken')}</label>
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
                                        aria-invalid={!!config.botToken && !isValidBotToken(config.botToken)}
                                        style={{ width: '100%', padding: '10px', paddingRight: '40px', ...(config.botToken && !isValidBotToken(config.botToken) ? { borderColor: '#DC2626' } : {}) }}
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
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '13px' }}>{t('ui.admin.telegram.chatIds')}</label>
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
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '13px' }}>{t('ui.admin.telegram.triggerStatuses')}</label>
                                <div style={{ position: 'relative' }}>
                                    <div
                                        onClick={() => setStatusDropdownOpen(prev => ({ ...prev, [index]: !prev[index] }))}
                                        className="search-input"
                                        style={{ width: '100%', padding: '10px', minHeight: '42px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-bg)' }}
                                    >
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', minWidth: 0, flex: 1, marginRight: '8px' }}>
                                            {config.triggerStatuses?.length === 8 ? t('ui.admin.telegram.allStatuses') : (config.triggerStatuses?.length > 0 ? config.triggerStatuses.map(statusLabel).join(', ') : t('ui.admin.telegram.selectStatus'))}
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
                                                            newConfigs[index] = { ...newConfigs[index], triggerStatuses: ['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled'] };
                                                        } else {
                                                            newConfigs[index] = { ...newConfigs[index], triggerStatuses: [] };
                                                        }
                                                        setLocalState({ ...localState, telegramConfigs: newConfigs });
                                                    }}
                                                    style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                                                />
                                                {t('ui.admin.telegram.allStatuses')}
                                            </label>
                                            {['Drafted', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled'].map(status => (
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
                                                    {statusLabel(status)}
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            <div style={{ flex: '1' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '13px' }}>{t('ui.admin.telegram.note')}</label>
                                <input
                                    type="text"
                                    value={config.note || ''}
                                    onChange={(e) => {
                                        const newConfigs = [...localState.telegramConfigs];
                                        newConfigs[index] = { ...newConfigs[index], note: e.target.value };
                                        setLocalState({ ...localState, telegramConfigs: newConfigs });
                                    }}
                                    placeholder={t('ui.admin.telegram.notePlaceholder')}
                                    className="search-input"
                                    style={{ width: '100%', padding: '10px' }}
                                />
                            </div>
                                <button
                                    onClick={() => setTemplateDropdownOpen(prev => ({ ...prev, [index]: !prev[index] }))}
                                    style={{ padding: '10px 16px', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}
                                >
                                    {t('ui.admin.telegram.template')}
                                </button>
                                <button
                                    onClick={async () => {
                                        if (!config.botToken || !config.chatId) {
                                            showToast(t('ui.admin.telegram.enterTokenFirst'), 'error');
                                            return;
                                        }
                                        try {
                                            const { sendTelegramTestMessage } = await import('../../utils/telegram');
                                            await sendTelegramTestMessage(config.botToken, config.chatId);
                                            showToast(t('ui.admin.telegram.testSent'), 'success');
                                        } catch (err: any) {
                                            showToast(err.message || t('ui.admin.telegram.testFailed'), 'error');
                                        }
                                    }}
                                    style={{ padding: '10px 16px', fontSize: '13px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}
                                >
                                    {t('ui.admin.telegram.test')}
                                </button>
                                <button
                                    onClick={() => handleCommitTelegramConfigs(config.id)}
                                    disabled={!isRowChanged || isCommitting}
                                    style={{ padding: '10px 16px', fontSize: '13px', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: (isRowChanged && !isCommitting) ? 'pointer' : 'not-allowed', fontWeight: 600, height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', opacity: (isRowChanged && !isCommitting) ? 1 : 0.5 }}
                                >
                                    {isCommitting ? t('ui.admin.telegram.saving') : t('ui.admin.telegram.commit')}
                                </button>
                        </div>
                        {templateDropdownOpen[index] && (
                            <div style={{ marginTop: '8px', padding: '16px', background: 'var(--color-bg)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '13px' }}>{t('ui.admin.telegram.messageTemplate')}</label>
                                <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
                                    {t('ui.admin.telegram.availableVariables')} <code>{`{order_no}`}</code>, <code>{`{customer_name}`}</code>, <code>{`{phone}`}</code>, <code>{`{address}`}</code>, <code>{`{page}`}</code>, <code>{`{items}`}</code>, <code>{`{total}`}</code>, <code>{`{shipping_company}`}</code>, <code>{`{salesman}`}</code>, <code>{`{remark}`}</code>
                                </p>
                                <textarea
                                    value={config.messageTemplate || ''}
                                    onChange={(e) => {
                                        const newConfigs = [...localState.telegramConfigs];
                                        newConfigs[index] = { ...newConfigs[index], messageTemplate: e.target.value };
                                        setLocalState({ ...localState, telegramConfigs: newConfigs });
                                    }}
                                    placeholder={t('ui.admin.telegram.templatePlaceholder')}
                                    className="search-input"
                                    style={{ width: '100%', padding: '12px', minHeight: '150px', resize: 'vertical', fontSize: '13px' }}
                                />
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                                    <button
                                        onClick={async () => {
                                            if (!config.botToken || !config.chatId) {
                                                showToast(t('ui.admin.telegram.enterTokenFirst'), 'error');
                                                return;
                                            }
                                            if (!config.messageTemplate) {
                                                showToast(t('ui.admin.telegram.enterTemplate'), 'error');
                                                return;
                                            }
                                            try {
                                                const { sendTelegramTestTemplateMessage } = await import('../../utils/telegram');
                                                await sendTelegramTestTemplateMessage(config.botToken, config.chatId, config.messageTemplate);
                                                showToast(t('ui.admin.telegram.testTemplateSent'), 'success');
                                            } catch (err: any) {
                                                showToast(err.message || t('ui.admin.telegram.testFailed'), 'error');
                                            }
                                        }}
                                        style={{ padding: '8px 16px', fontSize: '13px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    >
                                        {t('ui.admin.telegram.testTemplate')}
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
