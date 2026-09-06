import React, { useState } from 'react';
import { X, Plus, Trash2, Link2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { DEFAULT_TRACKING_TEMPLATES, detectCarrier } from '../utils/tracking';

interface ConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'shipping' | 'salesman' | 'page' | 'customerCare' | 'paymentMethod' | 'city';
}

const ConfigModal: React.FC<ConfigModalProps> = ({ isOpen, onClose, type }) => {
    const {
        shippingCompanies, salesmen, pages, customerCare, paymentMethods, cities,
        addShippingCompany, removeShippingCompany,
        addSalesman, removeSalesman,
        addPage, removePage,
        addCustomerCare, removeCustomerCare,
        addPaymentMethod, removePaymentMethod,
        addCity, removeCity,
        trackingUrlTemplates, updateTrackingUrlTemplate
    } = useStore();

    const [newItem, setNewItem] = useState('');
    // Draft tracking-URL edits per company (saved on blur / Enter).
    const [templateDrafts, setTemplateDrafts] = useState<Record<string, string>>({});

    if (!isOpen) return null;

    const handleAddItem = () => {
        if (!newItem.trim()) return;
        if (type === 'shipping') addShippingCompany(newItem.trim());
        else if (type === 'salesman') addSalesman(newItem.trim());
        else if (type === 'page') addPage(newItem.trim());
        else if (type === 'customerCare') addCustomerCare(newItem.trim());
        else if (type === 'paymentMethod') addPaymentMethod(newItem.trim());
        else addCity(newItem.trim());

        setNewItem('');
    };

    const getList = () => {
        switch (type) {
            case 'shipping': return shippingCompanies;
            case 'salesman': return salesmen;
            case 'page': return pages;
            case 'customerCare': return customerCare;
            case 'paymentMethod': return paymentMethods;
            case 'city': return cities;
            default: return [];
        }
    };

    const handleRemove = (item: string) => {
        if (type === 'shipping') removeShippingCompany(item);
        else if (type === 'salesman') removeSalesman(item);
        else if (type === 'page') removePage(item);
        else if (type === 'customerCare') removeCustomerCare(item);
        else if (type === 'paymentMethod') removePaymentMethod(item);
        else removeCity(item);
    };

    const getTitle = () => {
        switch (type) {
            case 'shipping': return 'Shipping Companies';
            case 'salesman': return 'Salesmen';
            case 'page': return 'Pages';
            case 'customerCare': return 'Customer Care';
            case 'paymentMethod': return 'Payment Methods';
            case 'city': return 'Cities / Provinces';
            default: return '';
        }
    };

    const commitTemplate = (company: string) => {
        const draft = templateDrafts[company];
        if (draft === undefined) return;
        setTemplateDrafts(prev => { const n = { ...prev }; delete n[company]; return n; });
        // Only write when something changed — each save upserts the whole
        // config blob, so tabbing through the fields must not spam it.
        const saved = (trackingUrlTemplates?.[company] || '').trim();
        if (draft.trim() === saved) return;
        updateTrackingUrlTemplate(company, draft);
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
            <div className="glass-panel" style={{ width: type === 'shipping' ? 'min(520px, 94vw)' : '400px', padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>
                        Manage {getTitle()}
                    </h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    <input type="text" value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Add new..." className="search-input" style={{ flex: 1, padding: '8px' }} />
                    <button onClick={handleAddItem} className="primary-button" style={{ padding: '0 12px' }}><Plus size={18} /></button>
                </div>
                {type === 'shipping' && (
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Link2 size={13} /> Tracking link per company — use <code style={{ background: 'var(--color-bg)', padding: '1px 5px', borderRadius: '4px' }}>{'{tracking}'}</code> where the tracking ID goes. J&amp;T is built in.
                    </div>
                )}
                <div style={{ maxHeight: '340px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                    {getList().map(item => {
                        const carrier = type === 'shipping' ? detectCarrier(item) : null;
                        const builtIn = carrier ? DEFAULT_TRACKING_TEMPLATES[carrier] : '';
                        const saved = trackingUrlTemplates?.[item] || '';
                        const draft = templateDrafts[item];
                        return (
                            <div key={item} style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: type === 'shipping' ? 600 : 400 }}>{item}</span>
                                    <button onClick={() => handleRemove(item)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                                </div>
                                {type === 'shipping' && (
                                    <input
                                        type="url"
                                        value={draft !== undefined ? draft : saved}
                                        placeholder={builtIn ? `Built-in: ${builtIn}` : 'https://carrier.example/track?no={tracking}'}
                                        title={builtIn && !saved ? 'Using the built-in template — type your own to override' : 'Tracking page URL template'}
                                        className="search-input"
                                        onChange={e => setTemplateDrafts(prev => ({ ...prev, [item]: e.target.value }))}
                                        onBlur={() => commitTemplate(item)}
                                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                        style={{ width: '100%', marginTop: '6px', padding: '6px 8px', fontSize: '12px', fontFamily: 'monospace', color: saved ? 'var(--color-text)' : 'var(--color-text-secondary)' }}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default ConfigModal;
