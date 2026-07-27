import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal } from '../../components';
import { useAccounting } from '../../hooks/useAccounting';
import type { ChartOfAccount } from '../../types';

const ChartOfAccountsPage = () => {
    const { setHeaderContent } = useHeader();
    const { accounts, isLoading, fetchAccounts, saveAccount, deleteAccount } = useAccounting();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<ChartOfAccount | null>(null);
    const [formData, setFormData] = useState<Partial<ChartOfAccount>>({
        account_code: '',
        account_name: '',
        account_type: 'Asset',
        description: '',
        is_active: true
    });

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Chart of Accounts</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage your accounting ledger</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchAccounts();
    }, [fetchAccounts]);

    const handleOpenModal = (account?: ChartOfAccount) => {
        if (account) {
            setEditingAccount(account);
            setFormData(account);
        } else {
            setEditingAccount(null);
            setFormData({ account_code: '', account_name: '', account_type: 'Asset', description: '', is_active: true });
        }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.account_code || !formData.account_name) return;
        try {
            await saveAccount(formData);
            setIsModalOpen(false);
        } catch (error) {
            // Error handled in hook
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this account?')) {
            await deleteAccount(id);
        }
    };

    const getAccountTypeColor = (type: string) => {
        switch (type) {
            case 'Asset': return 'var(--color-blue)';
            case 'Liability': return 'var(--color-orange)';
            case 'Equity': return 'var(--color-purple)';
            case 'Revenue': return 'var(--color-green)';
            case 'Expense': return 'var(--color-red)';
            default: return 'var(--color-text-secondary)';
        }
    };

    return (
        <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Accounts Ledger</h2>
                <button 
                    className="primary-button" 
                    onClick={() => handleOpenModal()}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '8px' }}
                >
                    <Plus size={18} /> Add Account
                </button>
            </div>

            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '12px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ padding: '16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Code</th>
                            <th style={{ padding: '16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Name</th>
                            <th style={{ padding: '16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Type</th>
                            <th style={{ padding: '16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Description</th>
                            <th style={{ padding: '16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Status</th>
                            <th style={{ padding: '16px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center' }}>Loading...</td></tr>
                        ) : accounts.length === 0 ? (
                            <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center' }}>No accounts found</td></tr>
                        ) : (
                            accounts.map(account => (
                                <tr key={account.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={{ padding: '16px', fontWeight: '500' }}>{account.account_code}</td>
                                    <td style={{ padding: '16px' }}>{account.account_name}</td>
                                    <td style={{ padding: '16px' }}>
                                        <span style={{ 
                                            padding: '4px 8px', 
                                            borderRadius: '4px', 
                                            fontSize: '12px', 
                                            fontWeight: 500,
                                            backgroundColor: `${getAccountTypeColor(account.account_type)}20`,
                                            color: getAccountTypeColor(account.account_type)
                                        }}>
                                            {account.account_type}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px', color: 'var(--color-text-secondary)' }}>{account.description || '-'}</td>
                                    <td style={{ padding: '16px' }}>
                                        <span style={{
                                            padding: '4px 8px', borderRadius: '4px', fontSize: '12px',
                                            backgroundColor: account.is_active ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                            color: account.is_active ? 'var(--color-green)' : 'var(--color-red)'
                                        }}>
                                            {account.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                            <button 
                                                className="secondary-button" 
                                                style={{ padding: '8px', borderRadius: '6px' }}
                                                onClick={() => handleOpenModal(account)}
                                            >
                                                <Edit size={16} />
                                            </button>
                                            <button 
                                                className="danger-button" 
                                                style={{ padding: '8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-red)', border: 'none' }}
                                                onClick={() => handleDelete(account.id)}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <Modal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                title={editingAccount ? 'Edit Account' : 'New Account'}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 0' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Account Code</label>
                        <input 
                            type="text" 
                            className="input-field" 
                            style={{ width: '100%', padding: '10px' }}
                            value={formData.account_code || ''} 
                            onChange={(e) => setFormData({...formData, account_code: e.target.value})} 
                            placeholder="e.g. 1000"
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Account Name</label>
                        <input 
                            type="text" 
                            className="input-field" 
                            style={{ width: '100%', padding: '10px' }}
                            value={formData.account_name || ''} 
                            onChange={(e) => setFormData({...formData, account_name: e.target.value})} 
                            placeholder="e.g. Cash equivalents"
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Account Type</label>
                        <select 
                            className="input-field" 
                            style={{ width: '100%', padding: '10px' }}
                            value={formData.account_type}
                            onChange={(e) => setFormData({...formData, account_type: e.target.value as any})}
                        >
                            <option value="Asset">Asset</option>
                            <option value="Liability">Liability</option>
                            <option value="Equity">Equity</option>
                            <option value="Revenue">Revenue</option>
                            <option value="Expense">Expense</option>
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Description</label>
                        <textarea 
                            className="input-field" 
                            style={{ width: '100%', padding: '10px', minHeight: '80px' }}
                            value={formData.description || ''} 
                            onChange={(e) => setFormData({...formData, description: e.target.value})} 
                        />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input 
                            type="checkbox" 
                            checked={formData.is_active} 
                            onChange={(e) => setFormData({...formData, is_active: e.target.checked})} 
                        />
                        <span>Active</span>
                    </label>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 16px', borderRadius: '8px' }}>Cancel</button>
                        <button 
                            className="primary-button" 
                            onClick={handleSave} 
                            disabled={!formData.account_code || !formData.account_name}
                            style={{ padding: '10px 16px', borderRadius: '8px' }}
                        >
                            Save
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ChartOfAccountsPage;
