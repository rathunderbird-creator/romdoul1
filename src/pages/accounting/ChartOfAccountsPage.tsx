import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit, Trash2, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal } from '../../components';
import { useAccounting } from '../../hooks/useAccounting';
import type { ChartOfAccount } from '../../types';
import { supabase } from '../../lib/supabase';

const SAMPLE_ACCOUNTS = [
    { account_code: '100', account_name: 'Current Assets', account_type: 'Asset', is_active: true, dummy_balance: 0 },
    { account_code: '1000', account_name: 'Cash on Hand', account_type: 'Asset', is_active: true, dummy_balance: 2500.50 },
    { account_code: '1010', account_name: 'Bank Account (ABA)', account_type: 'Asset', is_active: true, dummy_balance: 15420.00 },
    { account_code: '1020', account_name: 'Bank Account (Acleda)', account_type: 'Asset', is_active: true, dummy_balance: 8500.00 },
    { account_code: '1200', account_name: 'Accounts Receivable', account_type: 'Asset', is_active: true, dummy_balance: 4300.00 },
    { account_code: '1300', account_name: 'Inventory', account_type: 'Asset', is_active: true, dummy_balance: 35000.00 },
    { account_code: '1400', account_name: 'Prepaid Expenses', account_type: 'Asset', is_active: true, dummy_balance: 1200.00 },
    { account_code: '150', account_name: 'Fixed Assets', account_type: 'Asset', is_active: true, dummy_balance: 0 },
    { account_code: '1510', account_name: 'Equipment', account_type: 'Asset', is_active: true, dummy_balance: 12500.00 },
    { account_code: '1520', account_name: 'Vehicles', account_type: 'Asset', is_active: true, dummy_balance: 45000.00 },
    { account_code: '1590', account_name: 'Accumulated Depreciation', account_type: 'Asset', is_active: true, dummy_balance: -8500.00 },
    { account_code: '200', account_name: 'Current Liabilities', account_type: 'Liability', is_active: true, dummy_balance: 0 },
    { account_code: '2000', account_name: 'Accounts Payable', account_type: 'Liability', is_active: true, dummy_balance: 5200.00 },
    { account_code: '2100', account_name: 'Credit Card (Corporate)', account_type: 'Liability', is_active: true, dummy_balance: 1250.00 },
    { account_code: '2200', account_name: 'Sales Tax Payable', account_type: 'Liability', is_active: true, dummy_balance: 850.00 }
];

const ChartOfAccountsPage = () => {
    const { setHeaderContent } = useHeader();
    const { accounts, isLoading, fetchAccounts, saveAccount, deleteAccount } = useAccounting();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<ChartOfAccount | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        '100': true,
        '150': true,
        '200': true
    });
    
    // For sample dummy balances since our DB doesn't have journal entries for them yet
    const [dummyBalances, setDummyBalances] = useState<Record<string, number>>({});

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
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: '#1a1f36' }}>Chart of Accounts</h1>
                    <p style={{ color: '#8792a2', fontSize: '13px' }}>Manage your ledger accounts and hierarchies.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchAccounts();
    }, [fetchAccounts]);

    useEffect(() => {
        // Seed sample data if table is completely empty after loading
        if (!isLoading && accounts.length === 0) {
            const seedData = async () => {
                const balances: Record<string, number> = {};
                for (const sample of SAMPLE_ACCOUNTS) {
                    const { dummy_balance, ...accountData } = sample;
                    try {
                        const { data } = await supabase.from('chart_of_accounts').insert(accountData).select().single();
                        if (data) balances[data.id] = dummy_balance;
                    } catch (e) {
                        console.error('Failed to seed', e);
                    }
                }
                setDummyBalances(balances);
                fetchAccounts();
            };
            seedData();
        } else if (!isLoading && accounts.length > 0) {
            // Re-map dummy balances based on account code for mockup display
            const balances: Record<string, number> = {};
            accounts.forEach(acc => {
                const sample = SAMPLE_ACCOUNTS.find(s => s.account_code === acc.account_code);
                if (sample) balances[acc.id] = sample.dummy_balance;
            });
            setDummyBalances(balances);
        }
    }, [isLoading, accounts.length]);

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
            console.error(error);
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this account?')) {
            await deleteAccount(id);
        }
    };

    const toggleGroup = (code: string) => {
        setExpandedGroups(prev => ({ ...prev, [code]: !prev[code] }));
    };

    // Build hierarchy
    const hierarchicalAccounts = useMemo(() => {
        let filtered = accounts;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = accounts.filter(a => 
                a.account_name.toLowerCase().includes(q) || 
                a.account_code.toLowerCase().includes(q)
            );
        }

        // Sort by code first
        const sorted = [...filtered].sort((a, b) => a.account_code.localeCompare(b.account_code));
        
        const parents: (ChartOfAccount & { children: ChartOfAccount[], isParent: boolean })[] = [];
        const orphans: ChartOfAccount[] = [];

        // Identify parents (usually shorter codes, e.g., 3 digits)
        sorted.forEach(acc => {
            if (acc.account_code.length <= 3) {
                parents.push({ ...acc, children: [], isParent: true });
            } else {
                // Find matching parent (first 2 or 3 chars)
                const parent = parents.find(p => acc.account_code.startsWith(p.account_code.substring(0, 2)));
                if (parent) {
                    parent.children.push(acc);
                } else {
                    orphans.push(acc);
                }
            }
        });

        // Calculate parent balances based on children
        parents.forEach(p => {
            if (p.children.length > 0) {
                // Ignore if it has a hardcoded dummy balance from seeds
            }
        });

        return { parents, orphans };
    }, [accounts, searchQuery]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount);
    };

    return (
        <div style={{ padding: '32px', maxWidth: '100%', margin: '0 auto', background: '#f7f9fc', minHeight: '100vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div style={{ position: 'relative', width: '300px' }}>
                    <Search size={16} color="#8792a2" style={{ position: 'absolute', left: '12px', top: '10px' }} />
                    <input 
                        type="text" 
                        placeholder="Search by code or name..." 
                        style={{ 
                            width: '100%', padding: '8px 12px 8px 36px', 
                            borderRadius: '8px', border: '1px solid #e2e8f0',
                            fontSize: '14px', outline: 'none', background: 'white'
                        }}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <button 
                    onClick={() => handleOpenModal()}
                    style={{ 
                        display: 'flex', alignItems: 'center', gap: '8px', 
                        padding: '10px 16px', borderRadius: '8px',
                        background: '#5469d4', color: 'white', border: 'none',
                        fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                >
                    <Plus size={16} /> Add Account
                </button>
            </div>

            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: '#64748b', fontSize: '12px', textTransform: 'uppercase', width: '120px' }}>Code</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>Account Name</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: '#64748b', fontSize: '12px', textTransform: 'uppercase', width: '150px' }}>Type</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: '#64748b', fontSize: '12px', textTransform: 'uppercase', width: '150px', textAlign: 'right' }}>Balance</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: '#64748b', fontSize: '12px', textTransform: 'uppercase', width: '100px', textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading accounts...</td></tr>
                        ) : accounts.length === 0 ? (
                            <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>No accounts found</td></tr>
                        ) : (
                            <>
                                {hierarchicalAccounts.parents.map(parent => {
                                    const isExpanded = expandedGroups[parent.account_code];
                                    const hasChildren = parent.children.length > 0;
                                    const balance = dummyBalances[parent.id] || 0;
                                    
                                    return (
                                        <React.Fragment key={parent.id}>
                                            <tr style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff', transition: 'background 0.2s' }}>
                                                <td style={{ padding: '16px 24px', fontWeight: '600', color: '#334155' }}>{parent.account_code}</td>
                                                <td style={{ padding: '16px 24px', fontWeight: '600', color: '#334155' }}>
                                                    <div 
                                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: hasChildren ? 'pointer' : 'default' }}
                                                        onClick={() => hasChildren && toggleGroup(parent.account_code)}
                                                    >
                                                        {hasChildren ? (isExpanded ? <ChevronDown size={16} color="#94a3b8" /> : <ChevronRight size={16} color="#94a3b8" />) : <span style={{ width: 16 }}/>}
                                                        {parent.account_name}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '16px 24px', color: '#64748b', textTransform: 'uppercase', fontSize: '12px' }}>{parent.account_type}</td>
                                                <td style={{ padding: '16px 24px', fontWeight: '600', textAlign: 'right', color: '#334155' }}>{formatCurrency(balance)}</td>
                                                <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                                        <Edit size={16} color="#94a3b8" style={{ cursor: 'pointer' }} onClick={() => handleOpenModal(parent)} />
                                                        <Trash2 size={16} color="#94a3b8" style={{ cursor: 'pointer' }} onClick={() => handleDelete(parent.id)} />
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && parent.children.map(child => {
                                                const childBalance = dummyBalances[child.id] || 0;
                                                return (
                                                    <tr key={child.id} style={{ borderBottom: '1px solid #f8fafc', background: '#fafbfc' }}>
                                                        <td style={{ padding: '14px 24px 14px 48px', color: '#475569', fontWeight: '500' }}>{child.account_code}</td>
                                                        <td style={{ padding: '14px 24px 14px 48px', color: '#475569' }}>{child.account_name}</td>
                                                        <td style={{ padding: '14px 24px', color: '#94a3b8', textTransform: 'uppercase', fontSize: '12px' }}>{child.account_type}</td>
                                                        <td style={{ padding: '14px 24px', textAlign: 'right', color: '#475569' }}>{formatCurrency(childBalance)}</td>
                                                        <td style={{ padding: '14px 24px', textAlign: 'right' }}>
                                                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                                                <Edit size={16} color="#cbd5e1" style={{ cursor: 'pointer' }} onClick={() => handleOpenModal(child)} />
                                                                <Trash2 size={16} color="#cbd5e1" style={{ cursor: 'pointer' }} onClick={() => handleDelete(child.id)} />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                })}
                                {hierarchicalAccounts.orphans.map(orphan => {
                                    const orphanBalance = dummyBalances[orphan.id] || 0;
                                    return (
                                        <tr key={orphan.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '16px 24px', fontWeight: '500', color: '#334155' }}>{orphan.account_code}</td>
                                            <td style={{ padding: '16px 24px', color: '#334155' }}>{orphan.account_name}</td>
                                            <td style={{ padding: '16px 24px', color: '#64748b', textTransform: 'uppercase', fontSize: '12px' }}>{orphan.account_type}</td>
                                            <td style={{ padding: '16px 24px', textAlign: 'right', color: '#334155' }}>{formatCurrency(orphanBalance)}</td>
                                            <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                                    <Edit size={16} color="#94a3b8" style={{ cursor: 'pointer' }} onClick={() => handleOpenModal(orphan)} />
                                                    <Trash2 size={16} color="#94a3b8" style={{ cursor: 'pointer' }} onClick={() => handleDelete(orphan.id)} />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </>
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
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px', color: '#334155' }}>Account Code</label>
                        <input 
                            type="text" 
                            style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}
                            value={formData.account_code || ''} 
                            onChange={(e) => setFormData({...formData, account_code: e.target.value})} 
                            placeholder="e.g. 1000"
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px', color: '#334155' }}>Account Name</label>
                        <input 
                            type="text" 
                            style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}
                            value={formData.account_name || ''} 
                            onChange={(e) => setFormData({...formData, account_name: e.target.value})} 
                            placeholder="e.g. Cash on Hand"
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px', color: '#334155' }}>Account Type</label>
                        <select 
                            style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', background: 'white' }}
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
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
                        <input 
                            type="checkbox" 
                            checked={formData.is_active} 
                            onChange={(e) => setFormData({...formData, is_active: e.target.checked})} 
                        />
                        <span style={{ fontSize: '14px', color: '#334155' }}>Active</span>
                    </label>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                        <button onClick={() => setIsModalOpen(false)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'white', color: '#475569', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                        <button 
                            onClick={handleSave} 
                            disabled={!formData.account_code || !formData.account_name}
                            style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#5469d4', color: 'white', fontWeight: 500, cursor: 'pointer', opacity: (!formData.account_code || !formData.account_name) ? 0.5 : 1 }}
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
