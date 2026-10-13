import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit, Trash2, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal } from '../../components';
import { useAccounting } from '../../hooks/useAccounting';
import type { ChartOfAccount } from '../../types';
import { supabase } from '../../lib/supabase';

const SAMPLE_ACCOUNTS = [
    { account_code: '100', account_name: 'Current Assets', account_type: 'Asset', is_active: true },
    { account_code: '1000', account_name: 'Cash on Hand', account_type: 'Asset', is_active: true },
    { account_code: '1010', account_name: 'Bank Account (ABA)', account_type: 'Asset', is_active: true },
    { account_code: '1020', account_name: 'Bank Account (Acleda)', account_type: 'Asset', is_active: true },
    { account_code: '1200', account_name: 'Accounts Receivable', account_type: 'Asset', is_active: true },
    { account_code: '1300', account_name: 'Inventory', account_type: 'Asset', is_active: true },
    { account_code: '1400', account_name: 'Prepaid Expenses', account_type: 'Asset', is_active: true },
    { account_code: '150', account_name: 'Fixed Assets', account_type: 'Asset', is_active: true },
    { account_code: '1510', account_name: 'Equipment', account_type: 'Asset', is_active: true },
    { account_code: '1520', account_name: 'Vehicles', account_type: 'Asset', is_active: true },
    { account_code: '1590', account_name: 'Accumulated Depreciation', account_type: 'Asset', is_active: true },
    { account_code: '200', account_name: 'Current Liabilities', account_type: 'Liability', is_active: true },
    { account_code: '2000', account_name: 'Accounts Payable', account_type: 'Liability', is_active: true },
    { account_code: '2100', account_name: 'Credit Card (Corporate)', account_type: 'Liability', is_active: true },
    { account_code: '2200', account_name: 'Sales Tax Payable', account_type: 'Liability', is_active: true }
];

const TYPE_CARDS: { type: ChartOfAccount['account_type']; label: string; color: string }[] = [
    { type: 'Asset', label: 'Assets', color: '#10B981' },
    { type: 'Liability', label: 'Liabilities', color: '#EF4444' },
    { type: 'Equity', label: 'Equity', color: '#5469d4' },
    { type: 'Revenue', label: 'Revenue', color: '#0EA5E9' },
    { type: 'Expense', label: 'Expenses', color: '#F59E0B' },
];

// Asset and Expense accounts carry a debit-normal balance; the rest credit-normal.
const signedBalance = (type: ChartOfAccount['account_type'], s: { debit: number; credit: number }): number =>
    type === 'Asset' || type === 'Expense' ? s.debit - s.credit : s.credit - s.debit;

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
    
    // Per-account debit/credit sums across every journal entry line.
    // null = still loading; a missing key = the account has no postings.
    const [lineSums, setLineSums] = useState<Record<string, { debit: number; credit: number }> | null>(null);

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

    // True once the first fetch has settled. The seed effect below must not run
    // before that: on mount `accounts` is [] while the fetch is still in flight,
    // and the old check fired 15 sample inserts on EVERY visit (they only
    // bounced off the unique account_code constraint as 409s).
    const [fetchedOnce, setFetchedOnce] = useState(false);

    useEffect(() => {
        fetchAccounts().finally(() => setFetchedOnce(true));
    }, [fetchAccounts]);

    useEffect(() => {
        // Seed sample data if table is completely empty after loading
        if (fetchedOnce && !isLoading && accounts.length === 0) {
            const seedData = async () => {
                // Re-check on the server — a failed fetch must not read as "empty table".
                const { count, error } = await supabase.from('chart_of_accounts').select('id', { count: 'exact', head: true });
                if (error || (count ?? 0) > 0) return;
                for (const sample of SAMPLE_ACCOUNTS) {
                    try {
                        await supabase.from('chart_of_accounts').insert(sample);
                    } catch (e) {
                        console.error('Failed to seed', e);
                    }
                }
                fetchAccounts();
            };
            seedData();
        }
    }, [fetchedOnce, isLoading, accounts.length]);

    // Real balances: total debits/credits per account from journal_entry_lines.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const sums: Record<string, { debit: number; credit: number }> = {};
                for (let from = 0; from < 100000; from += 1000) {
                    const { data, error } = await supabase
                        .from('journal_entry_lines')
                        .select('account_id, debit, credit')
                        .order('id', { ascending: true })
                        .range(from, from + 999);
                    if (error) throw error;
                    for (const l of data || []) {
                        const s = sums[l.account_id] || (sums[l.account_id] = { debit: 0, credit: 0 });
                        s.debit += Number(l.debit) || 0;
                        s.credit += Number(l.credit) || 0;
                    }
                    if (!data || data.length < 1000) break;
                }
                if (alive) setLineSums(sums);
            } catch (e) {
                console.error('Failed to load account balances:', e);
                if (alive) setLineSums({});
            }
        })();
        return () => { alive = false; };
    }, []);

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

        return { parents, orphans };
    }, [accounts, searchQuery]);

    // One account's own ledger balance (no roll-up of children).
    const balanceOf = (account: ChartOfAccount): number => {
        const s = lineSums?.[account.id];
        return s ? signedBalance(account.account_type, s) : 0;
    };

    // Totals for the summary cards: per-type balance and account count, plus the
    // ledger check summed over EVERY posted line (lines whose account was later
    // deleted still count — total debits must equal total credits regardless).
    const summary = useMemo(() => {
        const types = Object.fromEntries(TYPE_CARDS.map(c => [c.type, { balance: 0, count: 0 }])) as
            Record<ChartOfAccount['account_type'], { balance: number; count: number }>;
        for (const a of accounts) {
            const t = types[a.account_type];
            if (!t) continue;
            t.count += 1;
            const s = lineSums?.[a.id];
            if (s) t.balance += signedBalance(a.account_type, s);
        }
        let debits = 0, credits = 0;
        for (const s of Object.values(lineSums ?? {})) {
            debits += s.debit;
            credits += s.credit;
        }
        return { types, debits, credits, balanced: Math.abs(debits - credits) < 0.005 };
    }, [accounts, lineSums]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount);
    };

    const balanceCell = (account: ChartOfAccount): { text: string; negative: boolean } => {
        if (lineSums === null) return { text: '…', negative: false };
        const bal = balanceOf(account);
        return { text: formatCurrency(bal), negative: bal < 0 };
    };

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: '#f7f9fc', minHeight: 'var(--vh-full)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '360px' }}>
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

            {/* Summary: real balances per account type, from journal entry lines */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px', marginBottom: '24px' }}>
                {TYPE_CARDS.map(({ type, label, color }) => {
                    const t = summary.types[type];
                    return (
                        <div key={type} style={{ background: 'white', border: '1px solid #e2e8f0', borderTop: `3px solid ${color}`, borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
                            <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '6px', fontVariantNumeric: 'tabular-nums', color: lineSums === null ? '#94a3b8' : t.balance < 0 ? '#DC2626' : '#1a1f36' }}>
                                {lineSums === null ? '…' : formatCurrency(t.balance)}
                            </div>
                            <div style={{ fontSize: '12px', color: '#8792a2', marginTop: '4px' }}>
                                {t.count} {t.count === 1 ? 'account' : 'accounts'}
                            </div>
                        </div>
                    );
                })}
                <div
                    title="In double-entry bookkeeping, total debits must equal total credits across all journal entries."
                    style={{ background: 'white', border: '1px solid #e2e8f0', borderTop: `3px solid ${lineSums !== null && !summary.balanced ? '#DC2626' : '#10B981'}`, borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
                >
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Ledger Check</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '6px', color: lineSums === null ? '#94a3b8' : summary.balanced ? '#10B981' : '#DC2626' }}>
                        {lineSums === null ? '…' : summary.balanced ? 'Balanced' : `Off by ${formatCurrency(summary.debits - summary.credits)}`}
                    </div>
                    <div style={{ fontSize: '12px', color: '#8792a2', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                        {lineSums === null ? 'Loading journal entries…' : `Debits ${formatCurrency(summary.debits)} · Credits ${formatCurrency(summary.credits)}`}
                    </div>
                </div>
            </div>

            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '620px' }}>
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
                                    const balance = balanceCell(parent);

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
                                                <td style={{ padding: '16px 24px', fontWeight: '600', textAlign: 'right', color: balance.negative ? '#DC2626' : '#334155' }}>{balance.text}</td>
                                                <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                                        <Edit size={16} color="#94a3b8" style={{ cursor: 'pointer' }} onClick={() => handleOpenModal(parent)} />
                                                        <Trash2 size={16} color="#94a3b8" style={{ cursor: 'pointer' }} onClick={() => handleDelete(parent.id)} />
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && parent.children.map(child => {
                                                const childBalance = balanceCell(child);
                                                return (
                                                    <tr key={child.id} style={{ borderBottom: '1px solid #f8fafc', background: '#fafbfc' }}>
                                                        <td style={{ padding: '14px 24px 14px 48px', color: '#475569', fontWeight: '500' }}>{child.account_code}</td>
                                                        <td style={{ padding: '14px 24px 14px 48px', color: '#475569' }}>{child.account_name}</td>
                                                        <td style={{ padding: '14px 24px', color: '#94a3b8', textTransform: 'uppercase', fontSize: '12px' }}>{child.account_type}</td>
                                                        <td style={{ padding: '14px 24px', textAlign: 'right', color: childBalance.negative ? '#DC2626' : '#475569' }}>{childBalance.text}</td>
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
                                    const orphanBalance = balanceCell(orphan);
                                    return (
                                        <tr key={orphan.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '16px 24px', fontWeight: '500', color: '#334155' }}>{orphan.account_code}</td>
                                            <td style={{ padding: '16px 24px', color: '#334155' }}>{orphan.account_name}</td>
                                            <td style={{ padding: '16px 24px', color: '#64748b', textTransform: 'uppercase', fontSize: '12px' }}>{orphan.account_type}</td>
                                            <td style={{ padding: '16px 24px', textAlign: 'right', color: orphanBalance.negative ? '#DC2626' : '#334155' }}>{orphanBalance.text}</td>
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
