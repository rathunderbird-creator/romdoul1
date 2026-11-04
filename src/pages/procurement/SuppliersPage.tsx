import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Mail, Phone, MapPin, Search, Building2, FileText, Users, AlertTriangle, DollarSign, ArrowUpDown, Printer, Download, RefreshCw } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useMobile } from '../../hooks/useMobile';
import { MiniStatCard, MobileSearchBar, MobileFilterDrawer, MobileChipGroup } from '../../components/MobileFilterKit';
import { Modal } from '../../components';
import { useProcurement } from '../../hooks/useProcurement';
import type { Supplier } from '../../types';
import { dayKeyFromDate, daysBetween } from '../../utils/dateRange';

// Helper for generating avatar color based on name
const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 65%, 50%)`;
};

const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
};

const formatCurrency = (val: number) => {
    if (val === 0) return '$0.00';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
};

type StatusFilter = 'All' | 'Active' | 'Inactive';
type SortOption = 'name' | 'balance' | 'newest';

// Active/Inactive pill — same shape as Supplier Bills/Payments' status chips.
const supplierChip = (active: boolean) => (
    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap', background: active ? 'rgba(16, 185, 129, 0.1)' : 'var(--color-bg)', color: active ? '#10b981' : 'var(--color-text-secondary)' }}>
        {active ? 'Active' : 'Inactive'}
    </span>
);

// The flat card + big colored total used across the procurement pages.
const SummaryCard: React.FC<{ color: string; label: string; value: string; sub?: string }> = ({ color, label, value, sub }) => (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '16px 20px' }}>
        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: '26px', fontWeight: 800, color, marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        {sub && <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>{sub}</div>}
    </div>
);

const toolbarBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: '8px',
    border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};

const SuppliersPage = () => {
    const navigate = useNavigate();
    const { setHeaderContent } = useHeader();
    const { suppliers, purchaseOrders, isLoading, fetchSuppliers, fetchPurchaseOrders, saveSupplier, deleteSupplier } = useProcurement();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const isMobile = useMobile();
    const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
    const [sortBy, setSortBy] = useState<SortOption>('name');
    const [formData, setFormData] = useState<Partial<Supplier>>({
        name: '',
        contact_name: '',
        email: '',
        phone: '',
        address: '',
        tax_id: '',
        is_active: true
    });

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Suppliers</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage vendor and supplier information</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchSuppliers();
        fetchPurchaseOrders();
    }, [fetchSuppliers, fetchPurchaseOrders]);

    // Calculate balances
    const supplierBalances = useMemo(() => {
        const balances: Record<string, { totalAmount: number, amountPaid: number, balance: number, overdue: boolean, overdueDays: number, poCount: number }> = {};
        const todayKey = dayKeyFromDate(new Date());

        suppliers.forEach(s => {
            balances[s.id] = { totalAmount: 0, amountPaid: 0, balance: 0, overdue: false, overdueDays: 0, poCount: 0 };
        });

        purchaseOrders.forEach(po => {
            if (po.supplier_id && balances[po.supplier_id]) {
                balances[po.supplier_id].totalAmount += (po.total_amount || 0);
                balances[po.supplier_id].amountPaid += (po.amount_paid || 0);
                balances[po.supplier_id].poCount += 1;
                
                if (po.payment_status !== 'Paid' && po.payment_due_date) {
                    // payment_due_date is a DATE: overdue only once the whole local due day has passed.
                    const dueKey = String(po.payment_due_date).slice(0, 10);
                    if (dueKey < todayKey) {
                        balances[po.supplier_id].overdue = true;
                        const daysDiff = daysBetween(dueKey, todayKey);
                        if (daysDiff > balances[po.supplier_id].overdueDays) {
                            balances[po.supplier_id].overdueDays = daysDiff;
                        }
                    }
                }
            }
        });

        Object.keys(balances).forEach(id => {
            balances[id].balance = balances[id].totalAmount - balances[id].amountPaid;
        });

        return balances;
    }, [suppliers, purchaseOrders]);

    // Summary stats
    const summaryStats = useMemo(() => {
        const activeCount = suppliers.filter(s => s.is_active).length;
        const inactiveCount = suppliers.filter(s => !s.is_active).length;
        const totalOutstanding = Object.values(supplierBalances).reduce((sum, b) => sum + b.balance, 0);
        const overdueCount = Object.values(supplierBalances).filter(b => b.overdue).length;
        return { total: suppliers.length, activeCount, inactiveCount, totalOutstanding, overdueCount };
    }, [suppliers, supplierBalances]);

    const filteredSuppliers = useMemo(() => {
        let result = suppliers;

        // Status filter
        if (statusFilter === 'Active') result = result.filter(s => s.is_active);
        else if (statusFilter === 'Inactive') result = result.filter(s => !s.is_active);

        // Search
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(s => 
                s.name.toLowerCase().includes(query) || 
                (s.email && s.email.toLowerCase().includes(query)) ||
                (s.contact_name && s.contact_name.toLowerCase().includes(query)) ||
                (s.phone && s.phone.includes(query))
            );
        }

        // Sort
        result = [...result].sort((a, b) => {
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'balance') return (supplierBalances[b.id]?.balance || 0) - (supplierBalances[a.id]?.balance || 0);
            // newest
            return (b.created_at || '').localeCompare(a.created_at || '');
        });

        return result;
    }, [suppliers, searchQuery, statusFilter, sortBy, supplierBalances]);

    const handleOpenModal = (supplier?: Supplier) => {
        if (supplier) {
            setEditingSupplier(supplier);
            setFormData(supplier);
        } else {
            setEditingSupplier(null);
            setFormData({ name: '', contact_name: '', email: '', phone: '', address: '', tax_id: '', is_active: true });
        }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.name) return;
        try {
            await saveSupplier(formData);
            setIsModalOpen(false);
        } catch (error) {
            // Error handled in hook
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this supplier?')) {
            await deleteSupplier(id);
        }
    };

    // Export/print the list as filtered — same conventions as Supplier
    // Bills/Payments (BOM'd CSV, print window with the shared table CSS).
    const exportCsv = () => {
        const header = ['Supplier', 'Contact', 'Phone', 'Email', 'POs', 'Total Ordered', 'Paid', 'Balance', 'Overdue', 'Status'];
        const rows = filteredSuppliers.map(s => {
            const b = supplierBalances[s.id] || { totalAmount: 0, amountPaid: 0, balance: 0, overdue: false, overdueDays: 0, poCount: 0 };
            return [s.name, s.contact_name || '', s.phone || '', s.email || '', b.poCount, b.totalAmount.toFixed(2), b.amountPaid.toFixed(2), b.balance.toFixed(2), b.overdue ? `${b.overdueDays}d` : '', s.is_active ? 'Active' : 'Inactive'];
        });
        const esc = (v: string | number) => { const str = String(v); return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str; };
        const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `suppliers-${dayKeyFromDate(new Date())}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const escapeHtml = (s: string): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const printList = () => {
        const w = window.open('', '_blank', 'width=1000,height=700');
        if (!w) return;
        const rowsHtml = filteredSuppliers.map(s => {
            const b = supplierBalances[s.id] || { totalAmount: 0, amountPaid: 0, balance: 0, overdue: false, overdueDays: 0, poCount: 0 };
            return `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml([s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || '—')}</td>
                <td style="text-align:right">${b.poCount}</td><td style="text-align:right">${formatCurrency(b.totalAmount)}</td>
                <td style="text-align:right">${formatCurrency(b.amountPaid)}</td><td style="text-align:right">${formatCurrency(b.balance)}</td>
                <td>${b.overdue ? `${b.overdueDays}d overdue` : ''}</td><td>${s.is_active ? 'Active' : 'Inactive'}</td></tr>`;
        }).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Suppliers</title><style>
            body{font-family:Segoe UI,Arial,sans-serif;color:#1a1f36;padding:28px}
            h1{font-size:20px;margin:0}p{color:#64748b;margin:4px 0 20px;font-size:13px}
            table{width:100%;border-collapse:collapse;font-size:13px}
            th{font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #cbd5e1;padding:8px;text-align:left}
            td{padding:7px 8px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums}
        </style></head><body><h1>Suppliers</h1><p>Vendor directory with outstanding balances · All figures are in USD.</p>
        <table><thead><tr><th>Supplier</th><th>Contact</th><th>POs</th><th>Total Ordered</th><th>Paid</th><th>Balance</th><th>Overdue</th><th>Status</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    const statusTabs: { label: string; value: StatusFilter; count: number }[] = [
        { label: 'All', value: 'All', count: summaryStats.total },
        { label: 'Active', value: 'Active', count: summaryStats.activeCount },
        { label: 'Inactive', value: 'Inactive', count: summaryStats.inactiveCount },
    ];

    return (
        <div style={isMobile ? { display: 'flex', flexDirection: 'column', gap: '20px' } : { display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
            <div className="page-container fade-in" style={{ flex: isMobile ? undefined : '18 1 0', minWidth: 0 }}>
                {/* Summary Stats Bar — mobile: four compact cards on one row */}
                {isMobile ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px', marginBottom: '12px' }}>
                        <MiniStatCard icon={Users} gradient="linear-gradient(135deg, #6366f1, #8b5cf6)" label="Suppliers" value={String(summaryStats.total)} />
                        <MiniStatCard icon={Building2} gradient="linear-gradient(135deg, #10b981, #34d399)" label="Active" value={String(summaryStats.activeCount)} valueColor="#10b981" />
                        <MiniStatCard icon={AlertTriangle} gradient="linear-gradient(135deg, #f59e0b, #fbbf24)" label="Overdue" value={String(summaryStats.overdueCount)} valueColor={summaryStats.overdueCount > 0 ? '#ef4444' : undefined} />
                        <MiniStatCard icon={DollarSign} gradient="linear-gradient(135deg, #ef4444, #f87171)" label="Balance" value={formatCurrency(summaryStats.totalOutstanding)} valueColor={summaryStats.totalOutstanding > 0 ? '#ef4444' : '#10b981'} />
                    </div>
                ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                    <SummaryCard color="#6366f1" label="Total Suppliers" value={String(summaryStats.total)} sub={`${summaryStats.activeCount} active · ${summaryStats.inactiveCount} inactive`} />
                    <SummaryCard color="#10B981" label="Active" value={String(summaryStats.activeCount)} sub={`of ${summaryStats.total} suppliers`} />
                    <SummaryCard color={summaryStats.overdueCount > 0 ? '#EF4444' : '#D97706'} label="Overdue" value={String(summaryStats.overdueCount)} sub={summaryStats.overdueCount === 1 ? 'supplier past due' : 'suppliers past due'} />
                    <SummaryCard color={summaryStats.totalOutstanding > 0 ? '#EF4444' : '#10B981'} label="Outstanding Balance" value={formatCurrency(summaryStats.totalOutstanding)} sub="unpaid across all suppliers" />
                </div>
                )}

                {/* Mobile: slim search/filter bar + right-side drawer */}
                {isMobile && (
                    <>
                        <MobileSearchBar
                            searchValue={searchQuery}
                            onSearchChange={setSearchQuery}
                            placeholder="Search suppliers..."
                            activeCount={(statusFilter !== 'All' ? 1 : 0)}
                            onOpenFilter={() => setIsFilterDrawerOpen(true)}
                            onAdd={() => handleOpenModal()}
                        />
                        <MobileFilterDrawer
                            isOpen={isFilterDrawerOpen}
                            onClose={() => setIsFilterDrawerOpen(false)}
                            onClear={() => { setSearchQuery(''); setStatusFilter('All'); setSortBy('name'); }}
                            searchValue={searchQuery}
                            onSearchChange={setSearchQuery}
                            searchPlaceholder="Search suppliers..."
                        >
                            <MobileChipGroup
                                title="Status"
                                options={statusTabs.map(t => ({ value: t.value, label: t.label, count: t.count }))}
                                selected={statusFilter}
                                onSelect={(v) => setStatusFilter(v as any)}
                            />
                            <MobileChipGroup
                                title="Sort By"
                                options={[{ value: 'name', label: 'Name' }, { value: 'balance', label: 'Balance' }, { value: 'newest', label: 'Newest' }]}
                                selected={sortBy}
                                onSelect={(v) => setSortBy(v as any)}
                            />
                        </MobileFilterDrawer>
                    </>
                )}

                {/* Toolbar: Filters, Search, Actions (desktop) */}
                {!isMobile && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        {/* Status filter tabs */}
                        <div style={{ display: 'flex', background: 'var(--color-surface)', borderRadius: '10px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                            {statusTabs.map(tab => (
                                <button
                                    key={tab.value}
                                    onClick={() => setStatusFilter(tab.value)}
                                    style={{
                                        padding: '8px 16px',
                                        border: 'none',
                                        background: statusFilter === tab.value ? 'var(--color-primary)' : 'transparent',
                                        color: statusFilter === tab.value ? 'white' : 'var(--color-text-secondary)',
                                        fontWeight: 600,
                                        fontSize: '13px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                    }}
                                >
                                    {tab.label}
                                    <span style={{
                                        background: statusFilter === tab.value ? 'rgba(255,255,255,0.25)' : 'var(--color-bg)',
                                        padding: '1px 8px',
                                        borderRadius: '12px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                    }}>{tab.count}</span>
                                </button>
                            ))}
                        </div>

                        {/* Sort */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <ArrowUpDown size={14} color="var(--color-text-muted)" />
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as SortOption)}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    background: 'var(--color-surface)',
                                    color: 'var(--color-text)',
                                    fontSize: '13px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                }}
                            >
                                <option value="name">Sort by Name</option>
                                <option value="balance">Sort by Balance</option>
                                <option value="newest">Sort by Newest</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        {/* Search */}
                        <div style={{ position: 'relative', width: '240px' }}>
                            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                            <input
                                type="text"
                                className="input-field"
                                placeholder="Search suppliers..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ width: '100%', padding: '9px 10px 9px 36px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px' }}
                            />
                        </div>
                        <button onClick={() => { fetchSuppliers(); fetchPurchaseOrders(); }} title="Reload" style={{ ...toolbarBtnStyle, padding: '9px 10px' }}>
                            <RefreshCw size={14} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                        </button>
                        <button onClick={printList} disabled={isLoading} style={{ ...toolbarBtnStyle, opacity: isLoading ? 0.5 : 1 }}><Printer size={14} /> Print list</button>
                        <button onClick={exportCsv} disabled={isLoading} style={{ ...toolbarBtnStyle, opacity: isLoading ? 0.5 : 1 }}><Download size={14} /> Export CSV</button>
                        <button
                            className="primary-button"
                            onClick={() => handleOpenModal()}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '10px', fontWeight: 600, boxShadow: 'var(--shadow-sm)', whiteSpace: 'nowrap' }}
                        >
                            <Plus size={18} /> New Supplier
                        </button>
                    </div>
                </div>
                )}

                {/* Mobile: inbox-style supplier rows — tap to open the supplier */}
                {isMobile ? (
                    <div className="glass-panel" style={{ borderRadius: '16px', padding: 0, overflow: 'hidden' }}>
                        {isLoading ? (
                            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading suppliers...</div>
                        ) : filteredSuppliers.length === 0 ? (
                            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                <Building2 size={36} style={{ opacity: 0.3, margin: '0 auto 10px', display: 'block' }} />
                                No suppliers found.
                            </div>
                        ) : (
                            filteredSuppliers.map(supplier => {
                                const bal = supplierBalances[supplier.id] || { totalAmount: 0, amountPaid: 0, balance: 0, overdue: false, overdueDays: 0, poCount: 0 };
                                return (
                                    <div
                                        key={supplier.id}
                                        onClick={() => navigate(`/procurement/suppliers/${supplier.id}`)}
                                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', borderLeft: `4px solid ${supplier.is_active === false ? '#9CA3AF' : '#10b981'}`, cursor: 'pointer' }}
                                    >
                                        <div style={{
                                            width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
                                            background: `linear-gradient(135deg, ${stringToColor(supplier.name)}, ${stringToColor(supplier.name + 'x')})`,
                                            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '12px'
                                        }}>
                                            {getInitials(supplier.name)}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{supplier.name}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {[supplier.contact_name, supplier.phone].filter(Boolean).join(' · ') || '—'}
                                                {bal.poCount > 0 && ` · ${bal.poCount} PO${bal.poCount === 1 ? '' : 's'}`}
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                            <div style={{ fontSize: '13px', fontWeight: 800, color: bal.balance > 0.005 ? '#ef4444' : '#10b981', fontVariantNumeric: 'tabular-nums' }}>
                                                {formatCurrency(bal.balance)}
                                            </div>
                                            {bal.overdue && <div style={{ fontSize: '10px', fontWeight: 700, color: '#ef4444' }}>OVERDUE</div>}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                ) : (
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px', minWidth: '860px' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                {['Supplier', 'Contact', 'POs', 'Payment Progress', 'Balance', 'Status', ''].map((h, i) => (
                                    <th key={h || 'actions'} style={{ padding: '12px 20px', fontWeight: 700, fontSize: '11px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: i === 4 || i === 6 ? 'right' : i === 2 ? 'center' : 'left' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading suppliers...</td></tr>
                            ) : filteredSuppliers.length === 0 ? (
                                <tr>
                                    <td colSpan={7} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--color-text-secondary)' }}>
                                            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <Building2 size={32} style={{ opacity: 0.5 }} />
                                            </div>
                                            <div>
                                                <h3 style={{ color: 'var(--color-text-main)', marginBottom: '4px', fontSize: '16px' }}>No suppliers found</h3>
                                                <p style={{ fontSize: '14px' }}>{searchQuery ? 'Try adjusting your search terms.' : 'Get started by adding your first supplier.'}</p>
                                            </div>
                                            {!searchQuery && (
                                                <button 
                                                    className="secondary-button" 
                                                    onClick={() => handleOpenModal()}
                                                    style={{ padding: '8px 16px', borderRadius: '8px', marginTop: '8px' }}
                                                >
                                                    Add Supplier
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredSuppliers.map(supplier => {
                                    const bal = supplierBalances[supplier.id] || { totalAmount: 0, amountPaid: 0, balance: 0, overdue: false, overdueDays: 0, poCount: 0 };
                                    const paidPercent = bal.totalAmount > 0 ? Math.min(100, Math.round((bal.amountPaid / bal.totalAmount) * 100)) : 0;
                                    return (
                                        <tr 
                                            key={supplier.id} 
                                            onClick={() => navigate(`/procurement/suppliers/${supplier.id}`)}
                                            style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease', cursor: 'pointer' }} 
                                            className="hover-highlight"
                                        >
                                            <td style={{ padding: '14px 20px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                                    <div style={{
                                                        width: '38px', height: '38px', borderRadius: '10px',
                                                        background: `color-mix(in srgb, ${stringToColor(supplier.name)} 16%, var(--color-surface))`,
                                                        border: `1px solid color-mix(in srgb, ${stringToColor(supplier.name)} 35%, var(--color-border))`,
                                                        color: stringToColor(supplier.name), display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontWeight: 800, fontSize: '12px', flexShrink: 0,
                                                    }}>
                                                        {getInitials(supplier.name)}
                                                    </div>
                                                    <div>
                                                        <div className="d2-khmer" style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--color-text-main)' }}>{supplier.name}</div>
                                                        {supplier.contact_name && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>{supplier.contact_name}</div>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ padding: '14px 20px' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                    {supplier.phone && <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Phone size={12} style={{ opacity: 0.6 }} /> {supplier.phone}</span>}
                                                    {supplier.email && <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Mail size={12} style={{ opacity: 0.6 }} /> {supplier.email}</span>}
                                                    {!supplier.phone && !supplier.email && <span style={{ fontStyle: 'italic', opacity: 0.5 }}>—</span>}
                                                </div>
                                            </td>
                                            <td style={{ padding: '14px 20px', textAlign: 'center' }}>
                                                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>{bal.poCount}</span>
                                            </td>
                                            <td style={{ padding: '14px 20px', minWidth: '180px' }}>
                                                {bal.totalAmount > 0 ? (
                                                    <div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                                                            <span>{formatCurrency(bal.amountPaid)}</span>
                                                            <span>{paidPercent}%</span>
                                                        </div>
                                                        <div style={{ width: '100%', height: '6px', borderRadius: '4px', background: 'var(--color-border)', overflow: 'hidden' }}>
                                                            <div style={{ 
                                                                width: `${paidPercent}%`, 
                                                                height: '100%', 
                                                                borderRadius: '4px',
                                                                background: paidPercent >= 100 ? '#10b981' : paidPercent >= 50 ? '#3b82f6' : '#f59e0b',
                                                                transition: 'width 0.5s ease',
                                                            }} />
                                                        </div>
                                                        <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                                                            of {formatCurrency(bal.totalAmount)}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No orders</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                                                <div style={{ fontWeight: 700, fontSize: '15px', color: bal.balance > 0 ? '#ef4444' : '#10b981' }}>
                                                    {formatCurrency(bal.balance)}
                                                </div>
                                                {bal.overdue && (
                                                    <div style={{ 
                                                        fontSize: '11px', fontWeight: 700, color: '#ef4444', marginTop: '4px',
                                                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                        padding: '2px 8px', borderRadius: '12px', background: 'rgba(239,68,68,0.1)',
                                                    }}>
                                                        <AlertTriangle size={10} /> {bal.overdueDays}d overdue
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '14px 20px' }}>
                                                {supplierChip(!!supplier.is_active)}
                                            </td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        style={{ background: 'rgba(99,102,241,0.08)', border: 'none', cursor: 'pointer', color: '#6366f1', padding: '6px', borderRadius: '6px' }}
                                                        onClick={() => navigate(`/procurement/suppliers/${supplier.id}`)}
                                                        title="View ledger"
                                                    >
                                                        <FileText size={15} />
                                                    </button>
                                                    <button
                                                        style={{ background: 'rgba(37,99,235,0.08)', border: 'none', cursor: 'pointer', color: '#2563eb', padding: '6px', borderRadius: '6px' }}
                                                        onClick={() => handleOpenModal(supplier)}
                                                        title="Edit supplier"
                                                    >
                                                        <Edit size={15} />
                                                    </button>
                                                    <button
                                                        style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px' }}
                                                        onClick={(e) => handleDelete(supplier.id, e)}
                                                        title="Delete supplier"
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                    </div>
                </div>
                )}

                <Modal
                    isOpen={isModalOpen} 
                    onClose={() => setIsModalOpen(false)} 
                    title={editingSupplier ? 'Edit Supplier Details' : 'Register New Supplier'}
                >
                    {/* minWidth 500 forced the modal wider than a phone screen */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '12px' : '20px', padding: isMobile ? '8px 0' : '16px 0', minWidth: isMobile ? undefined : '500px', maxWidth: '100%' }}>
                    
                        <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                            <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Building2 size={16} /> Company Information
                            </h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Supplier Name *</label>
                                    <input 
                                        type="text" 
                                        className="input-field" 
                                        style={{ width: '100%', padding: '10px 12px' }}
                                        value={formData.name || ''} 
                                        onChange={(e) => setFormData({...formData, name: e.target.value})} 
                                        placeholder="Enter company or individual name"
                                        autoFocus
                                    />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '1fr 1fr', gap: isMobile ? '10px' : '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Contact Person</label>
                                        <input 
                                            type="text" 
                                            className="input-field" 
                                            style={{ width: '100%', padding: '10px 12px' }}
                                            value={formData.contact_name || ''} 
                                            onChange={(e) => setFormData({...formData, contact_name: e.target.value})} 
                                            placeholder="Full name"
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Tax ID / VAT</label>
                                        <input 
                                            type="text" 
                                            className="input-field" 
                                            style={{ width: '100%', padding: '10px 12px' }}
                                            value={formData.tax_id || ''}
                                            onChange={(e) => setFormData({...formData, tax_id: e.target.value})} 
                                            placeholder="Optional"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                            <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <MapPin size={16} /> Contact Details
                            </h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '1fr 1fr', gap: isMobile ? '10px' : '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Email Address</label>
                                        <input 
                                            type="email" 
                                            className="input-field" 
                                            style={{ width: '100%', padding: '10px 12px' }}
                                            value={formData.email || ''} 
                                            onChange={(e) => setFormData({...formData, email: e.target.value})} 
                                            placeholder="contact@company.com"
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Phone Number</label>
                                        <input 
                                            type="text" 
                                            className="input-field" 
                                            style={{ width: '100%', padding: '10px 12px' }}
                                            value={formData.phone || ''} 
                                            onChange={(e) => setFormData({...formData, phone: e.target.value})} 
                                            placeholder="+855 ..."
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Physical Address</label>
                                    <textarea 
                                        className="input-field" 
                                        style={{ width: '100%', padding: '10px 12px', minHeight: '80px', resize: 'vertical' }}
                                        value={formData.address || ''} 
                                        onChange={(e) => setFormData({...formData, address: e.target.value})} 
                                        placeholder="Full street address..."
                                    />
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                <input 
                                    type="checkbox" 
                                    checked={formData.is_active} 
                                    onChange={(e) => setFormData({...formData, is_active: e.target.checked})} 
                                    style={{ width: '18px', height: '18px', accentColor: 'var(--color-primary)' }}
                                />
                                <span style={{ fontWeight: 500 }}>Active Supplier</span>
                            </label>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: isMobile ? '8px' : '16px', borderTop: '1px solid var(--color-border)', paddingTop: isMobile ? '12px' : '20px' }}>
                            <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px', flex: isMobile ? '0 0 auto' : undefined }}>Cancel</button>
                            <button
                                className="primary-button"
                                onClick={handleSave}
                                disabled={!formData.name}
                                style={{ padding: '10px 24px', borderRadius: '8px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flex: isMobile ? 1 : undefined }}
                            >
                                {editingSupplier ? 'Save Changes' : 'Register Supplier'}
                            </button>
                        </div>
                    </div>
                </Modal>
            </div>

            {/* Reserved for future widgets — intentionally empty, and left
                out entirely on mobile since there's nothing in it to show. */}
            {!isMobile && (
                <>
                    <div style={{ flex: '1 1 0' }} />
                    <div style={{ flex: '1 1 0' }} />
                </>
            )}
        </div>
    );
};

export default SuppliersPage;
