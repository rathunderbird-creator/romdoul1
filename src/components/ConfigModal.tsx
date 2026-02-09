import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';

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
        addCity, removeCity
    } = useStore();

    const [newItem, setNewItem] = useState('');

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

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
            <div className="glass-panel" style={{ width: '400px', padding: '24px' }}>
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
                <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                    {getList().map(item => (
                        <div key={item} style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{item}</span>
                            <button onClick={() => handleRemove(item)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ConfigModal;
