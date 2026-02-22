import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Edit2, Trash2, TrendingUp, TrendingDown, DollarSign, Calendar, Tag, Search } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import type { Transaction } from '../types';
import StatsCard from '../components/StatsCard';
import Modal from '../components/Modal';

const IncomeExpense: React.FC = () => {
    const { transactions, addTransaction, updateTransaction, deleteTransaction, currentUser } = useStore();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [filterType, setFilterType] = useState<'All' | 'Income' | 'Expense'>('All');
    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState({
        start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    });

    // Form State
    const [formData, setFormData] = useState({
        type: 'Expense' as 'Income' | 'Expense',
        amount: '',
        currency: 'USD' as 'USD' | 'KHR',
        exchangeRate: '4100',
        category: '',
        description: '',
        date: new Date().toISOString().split('T')[0]
    });

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Income & Expense</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Track your cash flow manually</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    // Filtering
    const filteredTransactions = useMemo(() => {
        return transactions.filter(t => {
            const matchesType = filterType === 'All' || t.type === filterType;
            const matchesSearch = (t.category?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                (t.description?.toLowerCase() || '').includes(searchTerm.toLowerCase());

            const itemDate = new Date(t.date);

            let matchesDate = true;
            if (dateRange.start) {
                const startDate = new Date(dateRange.start);
                startDate.setHours(0, 0, 0, 0);
                matchesDate = matchesDate && itemDate >= startDate;
            }
            if (dateRange.end) {
                const endDate = new Date(dateRange.end);
                endDate.setHours(23, 59, 59, 999);
                matchesDate = matchesDate && itemDate <= endDate;
            }

            return matchesType && matchesSearch && matchesDate;
        }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [transactions, filterType, searchTerm, dateRange]);

    // Stats
    const stats = useMemo(() => {
        let totalIncome = 0;
        let totalExpense = 0;

        filteredTransactions.forEach(t => {
            if (t.type === 'Income') totalIncome += Number(t.amount);
            if (t.type === 'Expense') totalExpense += Number(t.amount);
        });

        return {
            totalIncome,
            totalExpense,
            netBalance: totalIncome - totalExpense
        };
    }, [filteredTransactions]);

    const handleOpenAddModal = () => {
        setFormData({
            type: 'Expense',
            amount: '',
            currency: 'USD',
            exchangeRate: '4100',
            category: '',
            description: '',
            date: new Date().toISOString().split('T')[0]
        });
        setEditingTransaction(null);
        setIsAddModalOpen(true);
    };

    const handleOpenEditModal = (t: Transaction) => {
        setEditingTransaction(t);
        setFormData({
            type: t.type,
            amount: t.amount.toString(),
            currency: 'USD',
            exchangeRate: '4100',
            category: t.category || '',
            description: t.description || '',
            date: new Date(t.date).toISOString().split('T')[0]
        });
        setIsAddModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.amount || isNaN(Number(formData.amount))) {
            alert('Please enter a valid amount');
            return;
        }

        let finalAmount = Number(formData.amount);
        if (formData.currency === 'KHR') {
            const rate = Number(formData.exchangeRate);
            if (!rate || isNaN(rate) || rate <= 0) {
                alert('Please enter a valid exchange rate');
                return;
            }
            finalAmount = finalAmount / rate;
        }

        try {
            if (editingTransaction) {
                await updateTransaction(editingTransaction.id, {
                    type: formData.type,
                    amount: finalAmount,
                    category: formData.category,
                    description: formData.description,
                    date: formData.date
                });
            } else {
                await addTransaction({
                    type: formData.type,
                    amount: finalAmount,
                    category: formData.category,
                    description: formData.description,
                    date: formData.date,
                    added_by: currentUser?.name || 'Unknown'
                });
            }
            setIsAddModalOpen(false);
        } catch (error) {
            console.error(error);
            alert('Failed to save transaction');
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this transaction?')) {
            try {
                await deleteTransaction(id);
            } catch (error) {
                console.error(error);
                alert('Failed to delete transaction');
            }
        }
    };

    return (
        <div style={{ paddingBottom: '40px' }}>
            {/* Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <button onClick={handleOpenAddModal} className="primary-button" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Plus size={20} />
                    {!isMobile && 'Add Transaction'}
                </button>
            </div>

            {/* Stats Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
                gap: '16px',
                marginBottom: '24px'
            }}>
                <StatsCard
                    title="Total Income"
                    value={`$${stats.totalIncome.toLocaleString()}`}
                    icon={TrendingUp}
                    color="var(--color-green)"
                />
                <StatsCard
                    title="Total Expense"
                    value={`$${stats.totalExpense.toLocaleString()}`}
                    icon={TrendingDown}
                    color="var(--color-red)"
                />
                <StatsCard
                    title="Net Balance"
                    value={`$${stats.netBalance.toLocaleString()}`}
                    icon={DollarSign}
                    color={stats.netBalance >= 0 ? 'var(--color-primary)' : 'var(--color-red)'}
                />
            </div>

            {/* Filters */}
            <div className="glass-panel" style={{ padding: '16px', marginBottom: '24px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '8px', flex: isMobile ? '1 1 100%' : 'none' }}>
                    <button
                        onClick={() => setFilterType('All')}
                        style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: filterType === 'All' ? 'var(--color-primary)' : 'transparent', color: filterType === 'All' ? 'white' : 'var(--color-text-main)', cursor: 'pointer' }}
                    >All</button>
                    <button
                        onClick={() => setFilterType('Income')}
                        style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: filterType === 'Income' ? 'var(--color-green)' : 'transparent', color: filterType === 'Income' ? 'white' : 'var(--color-text-main)', cursor: 'pointer' }}
                    >Income</button>
                    <button
                        onClick={() => setFilterType('Expense')}
                        style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: filterType === 'Expense' ? 'var(--color-red)' : 'transparent', color: filterType === 'Expense' ? 'white' : 'var(--color-text-main)', cursor: 'pointer' }}
                    >Expense</button>
                </div>

                <div style={{ display: 'flex', gap: '8px', flex: '1 1 200px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                        <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                        <input
                            type="text"
                            placeholder="Search category or description..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '10px 12px 10px 40px',
                                borderRadius: '8px',
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-background)',
                                color: 'var(--color-text-main)',
                                fontSize: '14px'
                            }}
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', flex: isMobile ? '1 1 100%' : 'none', alignItems: 'center' }}>
                    <input
                        type="date"
                        value={dateRange.start}
                        onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                        style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text-main)' }}
                    />
                    <span style={{ color: 'var(--color-text-secondary)' }}>to</span>
                    <input
                        type="date"
                        value={dateRange.end}
                        onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                        style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text-main)' }}
                    />
                </div>
            </div>

            {/* Table */}
            <div className="glass-panel" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', backgroundColor: 'var(--color-background)' }}>
                            <th style={{ padding: '16px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '14px' }}>Date</th>
                            <th style={{ padding: '16px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '14px' }}>Type</th>
                            <th style={{ padding: '16px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '14px' }}>Category</th>
                            <th style={{ padding: '16px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '14px' }}>Description</th>
                            <th style={{ padding: '16px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '14px', textAlign: 'right' }}>Amount</th>
                            <th style={{ padding: '16px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '14px', textAlign: 'center' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredTransactions.length === 0 ? (
                            <tr>
                                <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                    No transactions found.
                                </td>
                            </tr>
                        ) : (
                            filteredTransactions.map(t => (
                                <tr key={t.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={{ padding: '16px', fontSize: '14px' }}>
                                        {new Date(t.date).toLocaleDateString()}
                                    </td>
                                    <td style={{ padding: '16px' }}>
                                        <span style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            padding: '4px 8px',
                                            borderRadius: '12px',
                                            fontSize: '12px',
                                            fontWeight: 500,
                                            background: t.type === 'Income' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                            color: t.type === 'Income' ? 'var(--color-green)' : 'var(--color-red)'
                                        }}>
                                            {t.type === 'Income' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                            {t.type}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px', fontSize: '14px', color: 'var(--color-text-main)' }}>
                                        {t.category || '-'}
                                    </td>
                                    <td style={{ padding: '16px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                                        {t.description || '-'}
                                    </td>
                                    <td style={{ padding: '16px', fontSize: '15px', fontWeight: 600, color: t.type === 'Income' ? 'var(--color-green)' : 'var(--color-red)', textAlign: 'right' }}>
                                        {t.type === 'Income' ? '+' : '-'}${Number(t.amount).toLocaleString()}
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'center' }}>
                                        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                                            <button
                                                onClick={() => handleOpenEditModal(t)}
                                                className="icon-button"
                                                title="Edit"
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(t.id)}
                                                className="icon-button"
                                                style={{ color: 'var(--color-red)' }}
                                                title="Delete"
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

            {/* Add/Edit Modal */}
            <Modal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                title={editingTransaction ? "Edit Transaction" : "New Transaction"}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                    {/* Type Toggle */}
                    <div style={{ display: 'flex', gap: '8px', padding: '4px', background: 'var(--color-background)', borderRadius: '12px' }}>
                        <button
                            onClick={() => setFormData({ ...formData, type: 'Income' })}
                            style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '8px',
                                border: 'none',
                                background: formData.type === 'Income' ? 'var(--color-green)' : 'transparent',
                                color: formData.type === 'Income' ? 'white' : 'var(--color-text-secondary)',
                                fontWeight: formData.type === 'Income' ? 600 : 400,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px'
                            }}
                        >
                            <TrendingUp size={18} />
                            Income
                        </button>
                        <button
                            onClick={() => setFormData({ ...formData, type: 'Expense' })}
                            style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '8px',
                                border: 'none',
                                background: formData.type === 'Expense' ? 'var(--color-red)' : 'transparent',
                                color: formData.type === 'Expense' ? 'white' : 'var(--color-text-secondary)',
                                fontWeight: formData.type === 'Expense' ? 600 : 400,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px'
                            }}
                        >
                            <TrendingDown size={18} />
                            Expense
                        </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Amount*</label>
                            <div style={{ display: 'flex', background: 'var(--color-background)', borderRadius: '6px', padding: '2px' }}>
                                <button
                                    onClick={() => setFormData({ ...formData, currency: 'USD' })}
                                    style={{
                                        padding: '4px 12px',
                                        borderRadius: '4px',
                                        border: 'none',
                                        fontSize: '12px',
                                        fontWeight: formData.currency === 'USD' ? 600 : 400,
                                        background: formData.currency === 'USD' ? 'var(--color-surface)' : 'transparent',
                                        color: formData.currency === 'USD' ? 'var(--color-text-main)' : 'var(--color-text-secondary)',
                                        boxShadow: formData.currency === 'USD' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                        cursor: 'pointer'
                                    }}
                                >USD</button>
                                <button
                                    onClick={() => setFormData({ ...formData, currency: 'KHR' })}
                                    style={{
                                        padding: '4px 12px',
                                        borderRadius: '4px',
                                        border: 'none',
                                        fontSize: '12px',
                                        fontWeight: formData.currency === 'KHR' ? 600 : 400,
                                        background: formData.currency === 'KHR' ? 'var(--color-surface)' : 'transparent',
                                        color: formData.currency === 'KHR' ? 'var(--color-text-main)' : 'var(--color-text-secondary)',
                                        boxShadow: formData.currency === 'KHR' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                        cursor: 'pointer'
                                    }}
                                >KHR (៛)</button>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '12px' }}>
                            <div style={{ position: 'relative', flex: 1 }}>
                                <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', fontWeight: 'bold' }}>
                                    {formData.currency === 'USD' ? '$' : '៛'}
                                </span>
                                <input
                                    type="number"
                                    required
                                    min="0"
                                    step="any"
                                    value={formData.amount}
                                    onChange={(e) => setFormData(p => ({ ...p, amount: e.target.value }))}
                                    style={{
                                        width: '100%',
                                        padding: '12px 12px 12px 32px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        background: 'var(--color-surface)',
                                        color: 'var(--color-text-main)',
                                        fontSize: '16px',
                                        fontWeight: 'bold'
                                    }}
                                />
                            </div>

                            {formData.currency === 'KHR' && (
                                <div style={{ position: 'relative', width: '120px' }}>
                                    <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                        Rate
                                    </span>
                                    <input
                                        type="number"
                                        required
                                        min="1"
                                        step="any"
                                        value={formData.exchangeRate}
                                        onChange={(e) => setFormData(p => ({ ...p, exchangeRate: e.target.value }))}
                                        style={{
                                            width: '100%',
                                            padding: '12px 12px 12px 48px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            background: 'var(--color-surface)',
                                            color: 'var(--color-text-main)',
                                            fontSize: '14px'
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Date</label>
                            <div style={{ position: 'relative' }}>
                                <Calendar size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                <input
                                    type="date"
                                    required
                                    value={formData.date}
                                    onChange={(e) => setFormData(p => ({ ...p, date: e.target.value }))}
                                    style={{
                                        width: '100%',
                                        padding: '12px 12px 12px 40px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        background: 'var(--color-surface)',
                                        color: 'var(--color-text-main)',
                                        fontSize: '14px'
                                    }}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Category</label>
                            <div style={{ position: 'relative' }}>
                                <Tag size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                <input
                                    type="text"
                                    placeholder="e.g. Utility, Salary"
                                    value={formData.category}
                                    onChange={(e) => setFormData(p => ({ ...p, category: e.target.value }))}
                                    style={{
                                        width: '100%',
                                        padding: '12px 12px 12px 40px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        background: 'var(--color-surface)',
                                        color: 'var(--color-text-main)',
                                        fontSize: '14px'
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Description / Note</label>
                        <textarea
                            rows={3}
                            placeholder="Optional details..."
                            value={formData.description}
                            onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-surface)',
                                color: 'var(--color-text-main)',
                                fontSize: '14px',
                                resize: 'vertical'
                            }}
                        />
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                        <button
                            onClick={() => setIsAddModalOpen(false)}
                            className="secondary-button"
                            style={{ flex: 1, padding: '12px' }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="primary-button"
                            style={{ flex: 1, padding: '12px', background: formData.type === 'Income' ? 'var(--color-green)' : 'var(--color-red)' }}
                        >
                            Save {formData.type}
                        </button>
                    </div>

                </div>
            </Modal>
        </div>
    );
};

export default IncomeExpense;
