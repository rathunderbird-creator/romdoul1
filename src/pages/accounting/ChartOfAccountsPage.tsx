import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Search, ChevronDown, ChevronRight, Check, AlertTriangle } from 'lucide-react';
import { useMobile } from '../../hooks/useMobile';
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

// Sub-category choices per account type, shown next to the account name.
const SUB_TYPES: Record<ChartOfAccount['account_type'], string[]> = {
    Asset: ['Current Asset', 'Fixed Asset', 'Other Asset'],
    Liability: ['Current Liability', 'Long-term Liability'],
    Equity: ['Equity', 'Contributed Capital', 'Other Equity', 'Retained Earnings'],
    Revenue: ['Operating Revenue', 'Other Revenue'],
    Expense: ['Operating Expense', 'Cost of Goods Sold', 'Other Expense'],
};

// The label next to the name: the account's own sub-category, or its parent
// group's name for children that have no explicit sub_type yet.
const subLabelOf = (acc: ChartOfAccount, parentName?: string): string =>
    acc.sub_type || parentName || '';

const subLabelStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 500, color: 'var(--color-text-muted)',
    marginLeft: '8px', whiteSpace: 'nowrap'
};

const ChartOfAccountsPage = () => {
    const isMobile = useMobile();
    const navigate = useNavigate();
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
        sub_type: '',
        description: '',
        is_active: true
    });

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Chart of Accounts</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Manage your ledger accounts and hierarchies.</p>
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
            setFormData({ account_code: '', account_name: '', account_type: 'Asset', sub_type: '', description: '', is_active: true });
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

    // Collapsible category sections (Assets, Liabilities, …), default expanded.
    const [collapsedTypes, setCollapsedTypes] = useState<Record<string, boolean>>({});
    const toggleType = (type: string) => setCollapsedTypes(prev => ({ ...prev, [type]: !prev[type] }));

    // Group accounts by their category, then build the code hierarchy inside
    // each one (parents = short codes, children matched by code prefix) so an
    // account can never nest under a parent of another category.
    const accountGroups = useMemo(() => {
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

        return TYPE_CARDS.map(card => {
            const parents: (ChartOfAccount & { children: ChartOfAccount[], isParent: boolean })[] = [];
            const orphans: ChartOfAccount[] = [];
            sorted.filter(a => a.account_type === card.type).forEach(acc => {
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
            const count = parents.reduce((n, p) => n + 1 + p.children.length, 0) + orphans.length;
            return { ...card, parents, orphans, count };
        }).filter(g => g.count > 0);
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

    // Subtotal of the rows actually shown in one category section (so it
    // follows the search filter, and matches the type cards when unfiltered).
    const groupBalance = (g: { parents: (ChartOfAccount & { children: ChartOfAccount[] })[]; orphans: ChartOfAccount[] }): number => {
        let total = 0;
        for (const p of g.parents) { total += balanceOf(p); for (const c of p.children) total += balanceOf(c); }
        for (const o of g.orphans) total += balanceOf(o);
        return total;
    };

    // Navigate to this account's activity in the General Ledger — used by the
    // read-only code/name references below (never inside the edit form).
    const goToLedger = (accountId: string) => navigate(`/accounting/general-ledger?account=${accountId}`);

    // Phone row: name + code/type on the left, balance + actions on the right.
    const mobileAccountRow = (acc: ChartOfAccount, opts: { indent?: boolean; bold?: boolean; chevron?: boolean | undefined; onPress?: () => void; subLabel?: string } = {}) => {
        const bal = balanceCell(acc);
        return (
            <div
                key={acc.id}
                onClick={opts.onPress}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 14px', paddingLeft: opts.indent ? '30px' : '14px', borderBottom: '1px solid #f1f5f9', cursor: opts.onPress ? 'pointer' : 'default', background: opts.indent ? 'var(--color-bg)' : 'white' }}
            >
                {opts.chevron !== undefined && (opts.chevron ? <ChevronDown size={15} color="#94a3b8" style={{ flexShrink: 0 }} /> : <ChevronRight size={15} color="#94a3b8" style={{ flexShrink: 0 }} />)}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="d2-khmer" style={{ fontSize: '13px', fontWeight: opts.bold ? 700 : 500, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc.account_name}</div>
                    <div
                        className="hover-highlight"
                        onClick={(e) => { e.stopPropagation(); goToLedger(acc.id); }}
                        title="View in General Ledger"
                        style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '1px', cursor: 'pointer', display: 'inline-block' }}
                    >{acc.account_code} · {opts.subLabel || acc.account_type.toUpperCase()}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: bal.negative ? '#DC2626' : 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{bal.text}</div>
                    <div style={{ display: 'flex', gap: '14px', justifyContent: 'flex-end', marginTop: '4px' }}>
                        <Edit size={14} color="#94a3b8" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); handleOpenModal(acc); }} />
                        <Trash2 size={14} color="#94a3b8" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); handleDelete(acc.id); }} />
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '360px' }}>
                    <Search size={16} color="#8792a2" style={{ position: 'absolute', left: '12px', top: '10px' }} />
                    <input 
                        type="text" 
                        placeholder="Search by code or name..." 
                        style={{ 
                            width: '100%', padding: '8px 12px 8px 36px', 
                            borderRadius: '8px', border: '1px solid #e2e8f0',
                            fontSize: '14px', outline: 'none', background: 'var(--color-surface)'
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
                        <div key={type} style={{ background: 'var(--color-surface)', border: '1px solid #e2e8f0', borderTop: `3px solid ${color}`, borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
                            <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '6px', fontVariantNumeric: 'tabular-nums', color: lineSums === null ? 'var(--color-text-muted)' : t.balance < 0 ? '#DC2626' : 'var(--color-text-main)' }}>
                                {lineSums === null ? '…' : formatCurrency(t.balance)}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                                {t.count} {t.count === 1 ? 'account' : 'accounts'}
                            </div>
                        </div>
                    );
                })}
                <div
                    title="In double-entry bookkeeping, total debits must equal total credits across all journal entries."
                    style={{ background: 'var(--color-surface)', border: '1px solid #e2e8f0', borderTop: `3px solid ${lineSums !== null && !summary.balanced ? '#DC2626' : '#10B981'}`, borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
                >
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Ledger Check</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '6px', color: lineSums === null ? 'var(--color-text-muted)' : summary.balanced ? '#10B981' : '#DC2626' }}>
                        {lineSums === null ? '…' : summary.balanced ? 'Balanced' : `Off by ${formatCurrency(summary.debits - summary.credits)}`}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                        {lineSums === null ? 'Loading journal entries…' : `Debits ${formatCurrency(summary.debits)} · Credits ${formatCurrency(summary.credits)}`}
                    </div>
                </div>
            </div>

            <div style={{ background: 'var(--color-surface)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                {isMobile ? (
                    // Phones: stacked account rows instead of the wide table.
                    isLoading ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading accounts...</div>
                    ) : accounts.length === 0 ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>No accounts found</div>
                    ) : (
                        <>
                            {accountGroups.length === 0 && (
                                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>No accounts found</div>
                            )}
                            {accountGroups.map(group => {
                                const typeCollapsed = !!collapsedTypes[group.type] && !searchQuery;
                                return (
                                    <React.Fragment key={group.type}>
                                        <div
                                            onClick={() => toggleType(group.type)}
                                            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'var(--color-bg)', borderBottom: '1px solid #f1f5f9', borderLeft: `3px solid ${group.color}`, cursor: 'pointer' }}
                                        >
                                            {typeCollapsed ? <ChevronRight size={14} color="#94a3b8" style={{ flexShrink: 0 }} /> : <ChevronDown size={14} color="#94a3b8" style={{ flexShrink: 0 }} />}
                                            <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: group.color }}>{group.label}</span>
                                            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>· {group.count}</span>
                                            <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' }}>
                                                {lineSums === null ? '…' : formatCurrency(groupBalance(group))}
                                            </span>
                                        </div>
                                        {!typeCollapsed && (
                                            <>
                                                {group.parents.map(parent => {
                                                    const isExpanded = expandedGroups[parent.account_code];
                                                    const hasChildren = parent.children.length > 0;
                                                    return (
                                                        <React.Fragment key={parent.id}>
                                                            {mobileAccountRow(parent, { bold: true, chevron: hasChildren ? !!isExpanded : undefined, onPress: hasChildren ? () => toggleGroup(parent.account_code) : undefined, subLabel: subLabelOf(parent) })}
                                                            {isExpanded && parent.children.map(child => mobileAccountRow(child, { indent: true, subLabel: subLabelOf(child, parent.account_name) }))}
                                                        </React.Fragment>
                                                    );
                                                })}
                                                {group.orphans.map(orphan => mobileAccountRow(orphan, { subLabel: subLabelOf(orphan) }))}
                                            </>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </>
                    )
                ) : (
                <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '620px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', width: '120px' }}>Code</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Account Name</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', width: '150px' }}>Type</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', width: '150px', textAlign: 'right' }}>Balance</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', width: '100px', textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading accounts...</td></tr>
                        ) : accounts.length === 0 ? (
                            <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No accounts found</td></tr>
                        ) : (
                            <>
                                {accountGroups.length === 0 && (
                                    <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No accounts found</td></tr>
                                )}
                                {accountGroups.map(group => {
                                    const typeCollapsed = !!collapsedTypes[group.type] && !searchQuery;
                                    return (
                                <React.Fragment key={group.type}>
                                <tr
                                    onClick={() => toggleType(group.type)}
                                    style={{ background: 'var(--color-bg)', borderBottom: '1px solid #e2e8f0', cursor: 'pointer' }}
                                >
                                    <td colSpan={3} style={{ padding: '10px 24px', borderLeft: `3px solid ${group.color}` }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {typeCollapsed ? <ChevronRight size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
                                            <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: group.color }}>{group.label}</span>
                                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>· {group.count} {group.count === 1 ? 'account' : 'accounts'}</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: '10px 24px', textAlign: 'right', fontSize: '13px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' }}>
                                        {lineSums === null ? '…' : formatCurrency(groupBalance(group))}
                                    </td>
                                    <td />
                                </tr>
                                {!typeCollapsed && group.parents.map(parent => {
                                    const isExpanded = expandedGroups[parent.account_code];
                                    const hasChildren = parent.children.length > 0;
                                    const balance = balanceCell(parent);

                                    return (
                                        <React.Fragment key={parent.id}>
                                            <tr style={{ borderBottom: '1px solid #f1f5f9', background: 'var(--color-surface)', transition: 'background 0.2s' }}>
                                                <td
                                                    className="hover-highlight"
                                                    onClick={() => goToLedger(parent.id)}
                                                    title="View in General Ledger"
                                                    style={{ padding: '16px 24px', fontWeight: '600', color: 'var(--color-text-main)', cursor: 'pointer' }}
                                                >{parent.account_code}</td>
                                                <td style={{ padding: '16px 24px', fontWeight: '600', color: 'var(--color-text-main)' }}>
                                                    <div 
                                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: hasChildren ? 'pointer' : 'default' }}
                                                        onClick={() => hasChildren && toggleGroup(parent.account_code)}
                                                    >
                                                        {hasChildren ? (isExpanded ? <ChevronDown size={16} color="#94a3b8" /> : <ChevronRight size={16} color="#94a3b8" />) : <span style={{ width: 16 }}/>}
                                                        {parent.account_name}
                                                        {subLabelOf(parent) && <span style={subLabelStyle}>{subLabelOf(parent)}</span>}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '16px 24px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', fontSize: '12px' }}>{parent.account_type}</td>
                                                <td style={{ padding: '16px 24px', fontWeight: '600', textAlign: 'right', color: balance.negative ? '#DC2626' : 'var(--color-text-main)' }}>{balance.text}</td>
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
                                                    <tr key={child.id} style={{ borderBottom: '1px solid #f8fafc', background: 'var(--color-bg)' }}>
                                                        <td
                                                            className="hover-highlight"
                                                            onClick={() => goToLedger(child.id)}
                                                            title="View in General Ledger"
                                                            style={{ padding: '14px 24px 14px 48px', color: 'var(--color-text-secondary)', fontWeight: '500', cursor: 'pointer' }}
                                                        >{child.account_code}</td>
                                                        <td style={{ padding: '14px 24px 14px 48px', color: 'var(--color-text-secondary)' }}>
                                                            {child.account_name}
                                                            {subLabelOf(child, parent.account_name) && <span style={subLabelStyle}>{subLabelOf(child, parent.account_name)}</span>}
                                                        </td>
                                                        <td style={{ padding: '14px 24px', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontSize: '12px' }}>{child.account_type}</td>
                                                        <td style={{ padding: '14px 24px', textAlign: 'right', color: childBalance.negative ? '#DC2626' : 'var(--color-text-secondary)' }}>{childBalance.text}</td>
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
                                {!typeCollapsed && group.orphans.map(orphan => {
                                    const orphanBalance = balanceCell(orphan);
                                    return (
                                        <tr key={orphan.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td
                                                className="hover-highlight"
                                                onClick={() => goToLedger(orphan.id)}
                                                title="View in General Ledger"
                                                style={{ padding: '16px 24px', fontWeight: '500', color: 'var(--color-text-main)', cursor: 'pointer' }}
                                            >{orphan.account_code}</td>
                                            <td style={{ padding: '16px 24px', color: 'var(--color-text-main)' }}>
                                                {orphan.account_name}
                                                {subLabelOf(orphan) && <span style={subLabelStyle}>{subLabelOf(orphan)}</span>}
                                            </td>
                                            <td style={{ padding: '16px 24px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', fontSize: '12px' }}>{orphan.account_type}</td>
                                            <td style={{ padding: '16px 24px', textAlign: 'right', color: orphanBalance.negative ? '#DC2626' : 'var(--color-text-main)' }}>{orphanBalance.text}</td>
                                            <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                                    <Edit size={16} color="#94a3b8" style={{ cursor: 'pointer' }} onClick={() => handleOpenModal(orphan)} />
                                                    <Trash2 size={16} color="#94a3b8" style={{ cursor: 'pointer' }} onClick={() => handleDelete(orphan.id)} />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                </React.Fragment>
                                    );
                                })}
                            </>
                        )}
                    </tbody>
                </table>
                </div>
                )}
            </div>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingAccount ? 'Edit Account' : 'Create Account'}
                width="640px"
            >
                {(() => {
                    const fieldLabel: React.CSSProperties = { display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-main)' };
                    const fieldInput: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none', boxSizing: 'border-box', fontSize: '14px', background: 'var(--color-surface)', color: 'var(--color-text-main)' };
                    const ready = !!(formData.account_code && formData.account_name);
                    const typeColor = TYPE_CARDS.find(c => c.type === (formData.account_type || 'Asset'))?.color || '#2742c9';
                    const accent = ready ? typeColor : '#DC2626';
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', padding: '8px 0' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '160px 1fr', gap: '16px' }}>
                                <div>
                                    <label style={fieldLabel}>Account Code</label>
                                    <input
                                        type="text"
                                        style={fieldInput}
                                        value={formData.account_code || ''}
                                        onChange={(e) => setFormData({ ...formData, account_code: e.target.value })}
                                        placeholder="e.g., 1000"
                                    />
                                </div>
                                <div>
                                    <label style={fieldLabel}>Account Name</label>
                                    <input
                                        type="text"
                                        className="d2-khmer"
                                        style={fieldInput}
                                        value={formData.account_name || ''}
                                        onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                                        placeholder="e.g., Cash on Hand"
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={fieldLabel}>Account Type</label>
                                    <select
                                        style={{ ...fieldInput, cursor: 'pointer' }}
                                        value={formData.account_type}
                                        onChange={(e) => setFormData({ ...formData, account_type: e.target.value as ChartOfAccount['account_type'], sub_type: '' })}
                                    >
                                        <option value="Asset">Asset</option>
                                        <option value="Liability">Liability</option>
                                        <option value="Equity">Equity</option>
                                        <option value="Revenue">Revenue</option>
                                        <option value="Expense">Expense</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={fieldLabel}>
                                        Sub Category <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional)</span>
                                    </label>
                                    <select
                                        style={{ ...fieldInput, cursor: 'pointer' }}
                                        value={formData.sub_type || ''}
                                        onChange={(e) => setFormData({ ...formData, sub_type: e.target.value })}
                                    >
                                        <option value="">—</option>
                                        {SUB_TYPES[formData.account_type || 'Asset'].map(s => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label style={fieldLabel}>Description <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional)</span></label>
                                <input
                                    type="text"
                                    className="d2-khmer"
                                    style={fieldInput}
                                    value={formData.description || ''}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Describe the account..."
                                />
                            </div>

                            {/* Live preview banner — the account type's color once code and name are in. */}
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                                padding: '12px 16px', borderRadius: '10px',
                                border: `1.5px solid ${accent}`,
                                background: `color-mix(in srgb, ${accent} 6%, var(--color-surface))`
                            }}>
                                <div style={{ minWidth: 0 }}>
                                    <div className="d2-khmer" style={{ fontSize: '14px', fontWeight: 700, color: accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {ready ? <>✓ {formData.account_code} · {formData.account_name}</> : 'Code and name required'}
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                                        {formData.account_type || 'Asset'}{formData.sub_type ? ` · ${formData.sub_type}` : ''}{formData.is_active ? '' : ' · Inactive'}
                                    </div>
                                </div>
                                {ready
                                    ? <Check size={20} color={accent} style={{ flexShrink: 0 }} />
                                    : <AlertTriangle size={20} color={accent} style={{ flexShrink: 0 }} />}
                            </div>

                            <label style={{
                                display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                                padding: '12px 16px', borderRadius: '10px', background: 'var(--color-bg)'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={formData.is_active}
                                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                    style={{ cursor: 'pointer' }}
                                />
                                <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--color-text-main)' }}>Active</span>
                                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>— inactive accounts stay out of entry forms</span>
                            </label>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '4px' }}>
                                <button
                                    onClick={() => setIsModalOpen(false)}
                                    style={{ padding: '10px 18px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)', fontWeight: 600, fontSize: '13.5px', cursor: 'pointer' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={!ready}
                                    style={{ padding: '10px 18px', borderRadius: '8px', border: 'none', background: '#2742c9', color: 'white', fontWeight: 600, fontSize: '13.5px', cursor: ready ? 'pointer' : 'not-allowed', opacity: ready ? 1 : 0.55 }}
                                >
                                    {editingAccount ? 'Save Changes' : 'Create Account'}
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </Modal>
        </div>
    );
};

export default ChartOfAccountsPage;
