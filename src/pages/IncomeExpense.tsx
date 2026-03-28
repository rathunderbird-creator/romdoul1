import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Edit2, Trash2, TrendingUp, TrendingDown, DollarSign, Calendar, Tag, Search, FilterX, ChevronDown, RefreshCw, Wallet } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { useClickOutside } from '../hooks/useClickOutside';
import { DateRangePicker } from '../components';
import '../components/MobileOrderCard.css';
import type { Transaction } from '../types';
import StatsCard from '../components/StatsCard';
import Modal from '../components/Modal';
import { supabase } from '../lib/supabase';

// Safari fails on "YYYY-MM-DD HH:MM:SS" (needs "T" instead of space)
const parseDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    const safeStr = dateStr.includes(' ') ? dateStr.replace(' ', 'T') : dateStr;
    const d = new Date(safeStr);
    return isNaN(d.getTime()) ? new Date() : d;
};

const IncomeExpense: React.FC = () => {
    const { addTransaction, updateTransaction, deleteTransaction, currentUser, refreshData, hasPermission } = useStore();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();

    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

    const toggleCardExpand = (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setExpandedCards(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [filterType, setFilterType] = useState<'All' | 'Income' | 'Expense'>('All');
    const [filterCategory, setFilterCategory] = useState<string>('All');
    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState(() => {
        const saved = localStorage.getItem('incomeExpenseDateRange');
        if (saved) {
            try { return JSON.parse(saved); } catch (e) { }
        }
        return { start: '', end: '' };
    });

    useEffect(() => {
        localStorage.setItem('incomeExpenseDateRange', JSON.stringify(dateRange));
    }, [dateRange]);

    const [localTransactions, setLocalTransactions] = useState<Transaction[]>([]);
    const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
    const [allGlobalCategories, setAllGlobalCategories] = useState<string[]>([]);

    const fetchAllCategories = async () => {
        try {
            // Fetch distinct categories, limit to 200 to prevent huge payloads
            // Supabase RPC or distinct is better, but this simple approach works for small-medium tables
            const { data, error } = await supabase.from('transactions')
                .select('category')
                .not('category', 'is', null)
                .not('category', 'eq', '')
                .limit(500);

            if (error) throw error;

            const cats = new Set<string>();
            data?.forEach(t => {
                if (t.category) cats.add(t.category.trim());
            });
            setAllGlobalCategories(Array.from(cats).sort());
        } catch (e) {
            console.error('Failed to fetch global categories', e);
        }
    };

    useEffect(() => {
        fetchAllCategories();
    }, []);

    const fetchTransactions = React.useCallback(async () => {
        setIsLoadingTransactions(true);
        try {
            let query = supabase.from('transactions').select('*');

            if (dateRange.start) {
                const start = new Date(dateRange.start);
                start.setHours(0, 0, 0, 0);
                query = query.gte('date', start.toISOString());
            }
            if (dateRange.end) {
                const end = new Date(dateRange.end);
                end.setHours(23, 59, 59, 999);
                query = query.lte('date', end.toISOString());
            }

            if (!dateRange.start && !dateRange.end) {
                query = query.limit(1000); // Limit to prevent freezing on "All" dates
            }

            const { data, error } = await query.order('date', { ascending: false });
            if (error) throw error;

            setLocalTransactions((data || []) as Transaction[]);
        } catch (error) {
            console.error("Failed to fetch transactions:", error);
        } finally {
            setIsLoadingTransactions(false);
        }
    }, [dateRange]);

    useEffect(() => {
        fetchTransactions();
    }, [fetchTransactions]);

    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const categoryRef = useClickOutside<HTMLDivElement>(() => setShowCategoryDropdown(false));

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
        return localTransactions.filter(t => {
            const matchesType = filterType === 'All' || t.type === filterType;
            const matchesCategory = filterCategory === 'All' || t.category === filterCategory;
            const matchesSearch = (t.category?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                (t.description?.toLowerCase() || '').includes(searchTerm.toLowerCase());

            const itemDate = parseDate(t.date);

            let matchesDate = true;
            if (dateRange.start && dateRange.end) {
                const startDate = parseDate(dateRange.start);
                startDate.setHours(0, 0, 0, 0);
                const endDate = parseDate(dateRange.end);
                endDate.setHours(23, 59, 59, 999);
                matchesDate = itemDate >= startDate && itemDate <= endDate;
            } else if (dateRange.start) {
                const startDate = parseDate(dateRange.start);
                startDate.setHours(0, 0, 0, 0);
                matchesDate = itemDate >= startDate;
            } else if (dateRange.end) {
                const endDate = parseDate(dateRange.end);
                endDate.setHours(23, 59, 59, 999);
                matchesDate = itemDate <= endDate;
            }

            return matchesType && matchesCategory && matchesSearch && matchesDate;
        }).sort((a, b) => {
            const dateA = parseDate(a.date);
            const dateB = parseDate(b.date);

            // Compare dates ignoring time
            const dayA = new Date(dateA.getFullYear(), dateA.getMonth(), dateA.getDate()).getTime();
            const dayB = new Date(dateB.getFullYear(), dateB.getMonth(), dateB.getDate()).getTime();

            if (dayB !== dayA) {
                return dayB - dayA; // Newest first
            }

            // Same day: Income first, then Expense
            if (a.type !== b.type) {
                return a.type === 'Income' ? -1 : 1;
            }

            // If same type and day, newest time first
            return dateB.getTime() - dateA.getTime();
        });
    }, [localTransactions, filterType, filterCategory, searchTerm, dateRange]);

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

    const uniqueCategories = useMemo(() => {
        const cats = new Set<string>(allGlobalCategories);
        localTransactions.forEach(t => {
            if (t.category) {
                cats.add(t.category.trim());
            }
        });
        return Array.from(cats).sort();
    }, [localTransactions, allGlobalCategories]);

    const filteredCategories = useMemo(() => {
        if (!formData.category) return uniqueCategories;
        const lowerCategory = formData.category.toLowerCase();
        return uniqueCategories.filter(c => c.toLowerCase().includes(lowerCategory));
    }, [uniqueCategories, formData.category]);

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
            date: parseDate(t.date).toISOString().split('T')[0]
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
            await fetchTransactions();
            fetchAllCategories(); // Refresh global categories since a new one might have been added
        } catch (error) {
            console.error(error);
            alert('Failed to save transaction');
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this transaction?')) {
            try {
                await deleteTransaction(id);
                await fetchTransactions();
            } catch (error) {
                console.error(error);
                alert('Failed to delete transaction');
            }
        }
    };

    if (!hasPermission('manage_income_expense')) {
        return (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                You do not have permission to view Income & Expense.
            </div>
        );
    }

    return (
        <div style={{ paddingBottom: '40px', maxWidth: '1400px', margin: '0 auto' }}>
            {/* Premium Stats Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
                gap: isMobile ? '16px' : '24px',
                marginBottom: '32px',
                marginTop: '12px'
            }}>
                <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '24px', border: '1px solid rgba(16, 185, 129, 0.25)', boxShadow: '0 10px 30px -10px rgba(16, 185, 129, 0.15)', background: 'var(--color-surface)', backdropFilter: 'blur(12px)', transition: 'transform 0.3s ease', cursor: 'default' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-4px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, transparent 100%)', zIndex: 0 }} />
                    <div style={{ position: 'relative', zIndex: 1, padding: isMobile ? '8px' : '12px' }}>
                        <StatsCard
                            title="Total Income"
                            value={`$${stats.totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            icon={TrendingUp}
                            color="var(--color-green)"
                        />
                    </div>
                </div>

                <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '24px', border: '1px solid rgba(239, 68, 68, 0.25)', boxShadow: '0 10px 30px -10px rgba(239, 68, 68, 0.15)', background: 'var(--color-surface)', backdropFilter: 'blur(12px)', transition: 'transform 0.3s ease', cursor: 'default' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-4px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, transparent 100%)', zIndex: 0 }} />
                    <div style={{ position: 'relative', zIndex: 1, padding: isMobile ? '8px' : '12px' }}>
                        <StatsCard
                            title="Total Expense"
                            value={`$${stats.totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            icon={TrendingDown}
                            color="var(--color-red)"
                        />
                    </div>
                </div>

                <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '24px', border: `1px solid ${stats.netBalance >= 0 ? 'rgba(59, 130, 246, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`, boxShadow: `0 10px 30px -10px ${stats.netBalance >= 0 ? 'rgba(59, 130, 246, 0.15)' : 'rgba(239, 68, 68, 0.15)'}`, background: 'var(--color-surface)', backdropFilter: 'blur(12px)', transition: 'transform 0.3s ease', cursor: 'default' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-4px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: `linear-gradient(135deg, ${stats.netBalance >= 0 ? 'rgba(59, 130, 246, 0.15)' : 'rgba(239, 68, 68, 0.15)'} 0%, transparent 100%)`, zIndex: 0 }} />
                    <div style={{ position: 'relative', zIndex: 1, padding: isMobile ? '8px' : '12px' }}>
                        <StatsCard
                            title="Net Balance"
                            value={`$${stats.netBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            icon={DollarSign}
                            color={stats.netBalance >= 0 ? 'var(--color-primary)' : 'var(--color-red)'}
                        />
                    </div>
                </div>
            </div>

            {/* Unified Command Bar */}
            <div className="glass-panel" style={{ 
                padding: isMobile ? '16px' : '20px', 
                marginBottom: '24px', 
                display: 'flex', 
                flexDirection: isMobile ? 'column' : 'row',
                gap: '16px', 
                alignItems: isMobile ? 'stretch' : 'center',
                justifyContent: 'space-between',
                backgroundColor: 'var(--color-surface)', 
                border: '1px solid var(--color-border)', 
                borderRadius: '16px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)'
            }}>
                {/* Left Side: Type Filters & Search */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', flex: 1 }}>
                    <div style={{ display: 'flex', gap: '4px', background: 'var(--color-background)', padding: '6px', borderRadius: '12px', flex: isMobile ? '1 1 100%' : 'none' }}>
                        <button
                            onClick={() => setFilterType('All')}
                            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: filterType === 'All' ? 'var(--color-surface)' : 'transparent', color: filterType === 'All' ? 'var(--color-text-main)' : 'var(--color-text-secondary)', fontWeight: filterType === 'All' ? 600 : 500, boxShadow: filterType === 'All' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none', cursor: 'pointer', transition: 'all 0.2s', flex: 1 }}
                        >All</button>
                        <button
                            onClick={() => setFilterType('Income')}
                            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: filterType === 'Income' ? 'var(--color-surface)' : 'transparent', color: filterType === 'Income' ? 'var(--color-green)' : 'var(--color-text-secondary)', fontWeight: filterType === 'Income' ? 600 : 500, boxShadow: filterType === 'Income' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none', cursor: 'pointer', transition: 'all 0.2s', flex: 1 }}
                        >Income</button>
                        <button
                            onClick={() => setFilterType('Expense')}
                            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: filterType === 'Expense' ? 'var(--color-surface)' : 'transparent', color: filterType === 'Expense' ? 'var(--color-red)' : 'var(--color-text-secondary)', fontWeight: filterType === 'Expense' ? 600 : 500, boxShadow: filterType === 'Expense' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none', cursor: 'pointer', transition: 'all 0.2s', flex: 1 }}
                        >Expense</button>
                    </div>

                    <div style={{ position: 'relative', flex: isMobile ? '1 1 100%' : '0 1 200px', display: 'flex', alignItems: 'center' }}>
                        <Tag size={16} style={{ position: 'absolute', left: '16px', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                        <select
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '12px 36px 12px 40px',
                                borderRadius: '12px',
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-background)',
                                color: 'var(--color-text-main)',
                                fontSize: '14px',
                                appearance: 'none',
                                cursor: 'pointer',
                                outline: 'none',
                                transition: 'all 0.2s'
                            }}
                            onFocus={e => e.target.style.borderColor = 'var(--color-primary)'}
                            onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                        >
                            <option value="All">All Categories</option>
                            {uniqueCategories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                        <ChevronDown size={18} style={{ position: 'absolute', right: '16px', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                    </div>

                    <div style={{ position: 'relative', flex: '1 1 200px' }}>
                        <Search size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                        <input
                            type="text"
                            placeholder="Search category or description..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '12px 16px 12px 44px',
                                borderRadius: '12px',
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-background)',
                                color: 'var(--color-text-main)',
                                fontSize: '14px',
                                transition: 'all 0.2s',
                                outline: 'none'
                            }}
                            onFocus={e => e.target.style.borderColor = 'var(--color-primary)'}
                            onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                        />
                    </div>
                </div>

                {/* Right Side: Actions (Date, Clear, Refresh, Add) */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
                    <div style={{ flex: isMobile ? '1 1 100%' : 'none' }}>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>
                    
                    {(dateRange.start || dateRange.end || searchTerm || filterType !== 'All' || filterCategory !== 'All') && (
                        <button
                            onClick={() => {
                                setDateRange({ start: '', end: '' });
                                setSearchTerm('');
                                setFilterType('All');
                                setFilterCategory('All');
                            }}
                            className="secondary-button"
                            style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-secondary)', height: '42px', borderRadius: '10px' }}
                            title="Clear Filters"
                        >
                            <FilterX size={16} />
                            {!isMobile && 'Clear'}
                        </button>
                    )}

                    <div style={{ display: 'flex', gap: '10px', flex: isMobile ? '1 1 100%' : 'none' }}>
                        <button
                            disabled={isLoadingTransactions}
                            onClick={() => {
                                const btn = document.getElementById('ie-refresh-btn');
                                if (btn) btn.style.animation = 'spin 1s linear infinite';
                                Promise.all([refreshData(true), fetchTransactions()]).finally(() => {
                                    if (btn) btn.style.animation = 'none';
                                });
                            }}
                            className="secondary-button"
                            style={{ padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '10px', flexShrink: 0 }}
                            title="Refresh Transactions"
                        >
                            <RefreshCw id="ie-refresh-btn" size={20} />
                        </button>

                        <button onClick={handleOpenAddModal} className="primary-button hover-lift" style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, justifyContent: 'center', height: '44px', borderRadius: '10px', fontWeight: 600, boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)' }}>
                            <Plus size={20} />
                            Add Transaction
                        </button>
                    </div>
                </div>
            </div>

            {/* Transactions List / Table */}
            {isMobile ? (
                <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--color-surface)', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--color-border)', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                    {filteredTransactions.length === 0 ? (
                        <div style={{ padding: '60px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--color-background)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)' }}>
                                <Wallet size={32} color="var(--color-text-secondary)" style={{ opacity: 0.5 }} />
                            </div>
                            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>No transactions found</h3>
                            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>Try adjusting your filters or add a new record.</p>
                        </div>
                    ) : (
                        filteredTransactions.map(t => {
                            const isExpanded = expandedCards.has(t.id);
                            return (
                                <div key={t.id} className="mobile-order-card" style={{ cursor: 'pointer' }} onClick={() => toggleCardExpand(t.id)}>
                                    <div className="moc-header" style={{ paddingBottom: '12px', alignItems: 'flex-start' }}>
                                        <div
                                            className="moc-chevron"
                                            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', marginTop: '2px', marginRight: '4px' }}
                                        >
                                            <ChevronDown size={20} />
                                        </div>
                                        <div className="moc-avatar" style={{
                                            backgroundColor: t.type === 'Income' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                            color: t.type === 'Income' ? 'var(--color-green)' : 'var(--color-red)',
                                            marginTop: '2px'
                                        }}>
                                            {t.type === 'Income' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                                        </div>
                                        <div className="moc-info">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span className="moc-customer-name">
                                                    {t.category || 'Uncategorized'}
                                                </span>
                                                <span style={{ color: t.type === 'Income' ? 'var(--color-green)' : 'var(--color-red)', fontWeight: 'bold', fontSize: '15px' }}>
                                                    {t.type === 'Income' ? '+' : '-'}${Number(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                            {!isExpanded && (
                                                <div className="moc-products-summary" style={{ fontSize: '13px', color: '#4B5563', marginTop: '2px', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {t.description || 'No description'}
                                                </div>
                                            )}
                                            <div className="moc-meta-row" style={{ marginTop: '2px' }}>
                                                <span>{parseDate(t.date).toLocaleDateString()}</span>
                                                <span>•</span>
                                                <span>{t.type}</span>
                                            </div>
                                        </div>
                                    </div>
                                    {isExpanded && (
                                        <div className="moc-expanded">
                                            {t.description && (
                                                <div style={{ fontSize: '13px', color: 'var(--color-text-main)', padding: '12px 0', borderTop: '1px dashed var(--color-border)', marginBottom: '8px' }}>
                                                    {t.description}
                                                </div>
                                            )}
                                            <div className="moc-actions" style={{ padding: 0, marginTop: t.description ? 0 : '12px', justifyContent: 'flex-end', gap: '8px', borderTop: t.description ? 'none' : '1px dashed var(--color-border)', paddingTop: t.description ? 0 : '12px' }}>
                                                <button onClick={(e) => { e.stopPropagation(); handleOpenEditModal(t); }} className="moc-action-btn" style={{ padding: '6px 16px', fontSize: '13px' }}>
                                                    <Edit2 size={14} style={{ marginRight: '6px' }} /> Edit
                                                </button>
                                                {currentUser?.roleId === 'admin' && (
                                                    <button onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }} className="moc-action-btn" style={{ padding: '6px 16px', fontSize: '13px', color: 'var(--color-red)' }}>
                                                        <Trash2 size={14} style={{ marginRight: '6px' }} /> Delete
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            ) : (
                <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', border: '1px solid var(--color-border)', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', backgroundColor: 'var(--color-surface)' }}>
                                <th style={{ padding: '16px 20px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--color-surface)', boxShadow: '0 1px 0 var(--color-border)' }}>Date</th>
                                <th style={{ padding: '16px 20px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--color-surface)', boxShadow: '0 1px 0 var(--color-border)' }}>Type</th>
                                <th style={{ padding: '16px 20px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--color-surface)', boxShadow: '0 1px 0 var(--color-border)' }}>Category</th>
                                <th style={{ padding: '16px 20px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--color-surface)', boxShadow: '0 1px 0 var(--color-border)' }}>Description</th>
                                <th style={{ padding: '16px 20px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right', position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--color-surface)', boxShadow: '0 1px 0 var(--color-border)' }}>Amount</th>
                                <th style={{ padding: '16px 20px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center', position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--color-surface)', boxShadow: '0 1px 0 var(--color-border)' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredTransactions.length === 0 ? (
                                <tr>
                                    <td colSpan={6} style={{ padding: '80px 20px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                            <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'var(--color-background)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)' }}>
                                                <Wallet size={36} color="var(--color-text-secondary)" style={{ opacity: 0.5 }} />
                                            </div>
                                            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '8px' }}>No transactions found</h3>
                                            <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>Try adjusting your filters or add a new record to see it here.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredTransactions.map(t => (
                                    <tr key={t.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s' }} className="table-row-hover">
                                        <td style={{ padding: '20px', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-main)' }}>
                                            {parseDate(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
                                                {currentUser?.roleId === 'admin' && (
                                                    <button
                                                        onClick={() => handleDelete(t.id)}
                                                        className="icon-button"
                                                        style={{ color: 'var(--color-red)' }}
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                        <tfoot>
                            <tr style={{ backgroundColor: 'var(--color-surface)', fontWeight: 'bold', borderTop: '2px solid var(--color-border)' }}>
                                <td colSpan={4} style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>
                                    Total Income
                                </td>
                                <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--color-green)', fontSize: '14px' }}>
                                    +${stats.totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td></td>
                            </tr>
                            <tr style={{ backgroundColor: 'var(--color-surface)', fontWeight: 'bold' }}>
                                <td colSpan={4} style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>
                                    Total Expense
                                </td>
                                <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--color-red)', fontSize: '14px' }}>
                                    -${stats.totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td></td>
                            </tr>
                            <tr style={{ backgroundColor: 'var(--color-background)', fontWeight: '800', borderTop: '1px solid var(--color-border)' }}>
                                <td colSpan={4} style={{ padding: '14px 20px', textAlign: 'right', color: 'var(--color-text-main)', fontSize: '13px', textTransform: 'uppercase' }}>
                                    Net Balance
                                </td>
                                <td style={{ padding: '14px 20px', textAlign: 'right', color: stats.netBalance >= 0 ? 'var(--color-primary)' : 'var(--color-red)', fontSize: '15px' }}>
                                    ${stats.netBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

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
                            <div style={{ position: 'relative' }} ref={categoryRef}>
                                <Tag size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                <input
                                    type="text"
                                    placeholder="e.g. Utility, Salary"
                                    value={formData.category}
                                    onFocus={() => setShowCategoryDropdown(true)}
                                    onChange={(e) => {
                                        setFormData(p => ({ ...p, category: e.target.value }));
                                        setShowCategoryDropdown(true);
                                    }}
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
                                {showCategoryDropdown && filteredCategories.length > 0 && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '100%',
                                        left: 0,
                                        width: '100%',
                                        maxHeight: '200px',
                                        overflowY: 'auto',
                                        background: 'var(--color-surface)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '8px',
                                        marginTop: '4px',
                                        zIndex: 50,
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                                    }}>
                                        {filteredCategories.map(cat => (
                                            <div
                                                key={cat}
                                                onClick={() => {
                                                    setFormData(p => ({ ...p, category: cat }));
                                                    setShowCategoryDropdown(false);
                                                }}
                                                style={{
                                                    padding: '10px 12px',
                                                    cursor: 'pointer',
                                                    borderBottom: '1px solid var(--color-border)',
                                                    fontSize: '14px',
                                                    color: 'var(--color-text-main)'
                                                }}
                                                className="hover-bg-light"
                                            >
                                                {cat}
                                            </div>
                                        ))}
                                    </div>
                                )}
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
