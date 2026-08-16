import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, DollarSign, ShoppingCart, RefreshCw, X, Database, Search, User, Calendar, FileSignature, Package, CheckCircle2, Eye, AlertTriangle, ArrowUp, ArrowDown, ChevronsUpDown, ChevronLeft, ChevronRight, Copy, PackageCheck, Ban } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useWholesale } from '../../hooks/useWholesale';
import type { WholesaleOrder, WholesaleOrderItem } from '../../types';

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const today = () => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

const payConfig = (s?: string) => {
    switch (s) {
        case 'Paid': return { color: '#059669', bg: 'rgba(16,185,129,0.1)' };
        case 'Partial': return { color: '#D97706', bg: 'rgba(217,119,6,0.1)' };
        default: return { color: '#DC2626', bg: 'rgba(239,68,68,0.1)' };
    }
};

// Order lifecycle badge (mirror of the Purchase Order status badge).
const orderStatusConfig = (s?: string) => {
    switch (s) {
        case 'Delivered': return { color: '#10b981', bg: 'rgba(16,185,129,0.1)' };
        case 'Cancelled': return { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };
        default: return { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' }; // Open
    }
};

const WholesaleOrdersPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { products, warehouses, currentUser, refreshData } = useStore();
    const { wholesaleOrders, customers, isLoading, tableMissing, fetchWholesaleOrders, fetchCustomers, createWholesaleOrder, deleteWholesaleOrder, updateWholesaleOrderStatus, recordCustomerPayment, deleteCustomerPayment } = useWholesale();

    const [search, setSearch] = useState('');
    const [payFilter, setPayFilter] = useState<'All' | 'Unpaid' | 'Partial' | 'Paid'>('All');
    const [statusFilter, setStatusFilter] = useState<'All' | 'Open' | 'Delivered' | 'Cancelled'>('All');

    // Create modal
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [warehouseId, setWarehouseId] = useState('');
    const [orderDate, setOrderDate] = useState(today());
    const [dueDate, setDueDate] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [orderStatus, setOrderStatus] = useState<'Open' | 'Delivered'>('Open');
    const [notes, setNotes] = useState('');
    const [lines, setLines] = useState<Partial<WholesaleOrderItem>[]>([{ product_id: '', quantity: 1, unit_price: 0 }]);
    const [saving, setSaving] = useState(false);

    // Payment modal
    const [payOrder, setPayOrder] = useState<WholesaleOrder | null>(null);
    const [payAmount, setPayAmount] = useState<number | string>('');
    const [payMethod, setPayMethod] = useState('Bank Transfer');
    const [payNote, setPayNote] = useState('');
    const [payDate, setPayDate] = useState(today());

    // View-details modal
    const [viewOrder, setViewOrder] = useState<WholesaleOrder | null>(null);

    // --- Column sorting (mirror of Purchase Orders) ---
    type WsSortKey = 'invoice' | 'customer' | 'order_date' | 'due_date' | 'items' | 'total' | 'paid' | 'balance' | 'ostatus' | 'status';
    const [sortConfig, setSortConfig] = useState<{ key: WsSortKey; direction: 'asc' | 'desc' } | null>(null);

    const handleSort = (key: WsSortKey) => {
        setSortConfig(prev =>
            prev?.key === key
                ? (prev.direction === 'asc' ? { key, direction: 'desc' } : null) // third click clears
                : { key, direction: 'asc' }
        );
    };

    const sortValue = (o: WholesaleOrder, key: WsSortKey): string | number => {
        switch (key) {
            case 'invoice': return (o.invoice_number || o.id).toLowerCase();
            case 'customer': return o.customer_name.toLowerCase();
            case 'order_date': return o.order_date ? new Date(o.order_date).getTime() : 0;
            case 'due_date': return o.due_date ? new Date(o.due_date).getTime() : 0;
            case 'items': return o.items?.length || 0;
            case 'total': return o.total_amount || 0;
            case 'paid': return o.amount_paid || 0;
            case 'balance': return (o.total_amount || 0) - (o.amount_paid || 0);
            case 'ostatus': return (o.status || 'Open').toLowerCase();
            case 'status': return (o.payment_status || 'Unpaid').toLowerCase();
            default: return '';
        }
    };

    // Days a due date is past (positive = late); null when no due date.
    const daysLate = (due?: string): number | null => {
        if (!due) return null;
        const d = new Date(due); d.setHours(0, 0, 0, 0);
        const now = new Date(); now.setHours(0, 0, 0, 0);
        const diff = Math.round((now.getTime() - d.getTime()) / 86400000);
        return diff > 0 ? diff : null;
    };

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Wholesale Orders</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Credit sales to customers — the source of Accounts Receivable</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => { fetchWholesaleOrders(); fetchCustomers(); }, [fetchWholesaleOrders, fetchCustomers]);

    const openCreate = () => {
        setCustomerName(''); setCustomerPhone(''); setWarehouseId(warehouses[0]?.id || '');
        setOrderDate(today()); setDueDate(''); setInvoiceNumber(''); setOrderStatus('Open'); setNotes('');
        setLines([{ product_id: '', quantity: 1, unit_price: 0 }]);
        setIsCreateOpen(true);
    };

    const lineTotal = (l: Partial<WholesaleOrderItem>) => (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
    const orderTotal = useMemo(() => lines.reduce((s, l) => s + lineTotal(l), 0), [lines]);

    const setLine = (idx: number, patch: Partial<WholesaleOrderItem>) => {
        setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
    };

    const submitCreate = async () => {
        if (!customerName.trim()) { showToast('Enter the customer name', 'error'); return; }
        const validLines = lines.filter(l => l.product_id && (Number(l.quantity) || 0) > 0);
        if (validLines.length === 0) { showToast('Add at least one product line', 'error'); return; }

        setSaving(true);
        try {
            const items: Partial<WholesaleOrderItem>[] = validLines.map(l => ({
                product_id: l.product_id!,
                product_name: products.find(p => p.id === l.product_id)?.name || '',
                quantity: Number(l.quantity) || 0,
                unit_price: Number(l.unit_price) || 0
            }));
            await createWholesaleOrder(
                { invoice_number: invoiceNumber, customer_name: customerName.trim(), customer_phone: customerPhone.trim(), warehouse_id: warehouseId, order_date: orderDate, due_date: dueDate, status: orderStatus, notes },
                items,
                currentUser?.name
            );
            setIsCreateOpen(false);
            refreshData(true); // keep in-memory product stock in sync after the deduction
        } catch { /* hook toasts */ } finally { setSaving(false); }
    };

    // Copy a formatted text summary of the order to the clipboard (for chat/Telegram).
    const handleCopyOrder = async (o: WholesaleOrder) => {
        const d = (v?: string) => (v ? new Date(v).toLocaleDateString('en-GB').replace(/\//g, '-') : '-');
        const paid = o.amount_paid || 0;
        const balance = (o.total_amount || 0) - paid;
        const whName = warehouses.find(w => w.id === o.warehouse_id)?.name;
        const lines: string[] = [
            '🛒 Wholesale Order',
            '',
            `#️⃣ Invoice: ${o.invoice_number || `WO-${o.id.slice(0, 8).toUpperCase()}`}`,
            `👤 Customer: ${o.customer_name}`,
        ];
        if (o.customer_phone) lines.push(`📞 Phone: ${o.customer_phone}`);
        if (whName) lines.push(`🏬 Warehouse: ${whName}`);
        lines.push(`📅 Order Date: ${d(o.order_date)}`);
        if (o.due_date) lines.push(`⏰ Due: ${d(o.due_date)}`);
        lines.push('', '📦 Items:');
        for (const item of o.items || []) {
            lines.push(`- ${item.product_name || 'Unknown'} x${item.quantity} (${fmt(item.unit_price || 0)})`);
        }
        lines.push(
            '',
            `💰 Total: ${fmt(o.total_amount || 0)}`,
            `💵 Paid: ${fmt(paid)}`,
            `🔴 Balance: ${fmt(balance)}`,
            `📊 Status: ${o.status || 'Open'} | Payment: ${o.payment_status || 'Unpaid'}`
        );
        if (o.notes) lines.push(`📝 Notes: ${o.notes}`);
        try {
            await navigator.clipboard.writeText(lines.join('\n'));
            showToast('Order details copied to clipboard', 'success');
        } catch {
            showToast('Failed to copy to clipboard', 'error');
        }
    };

    const openPay = (o: WholesaleOrder) => {
        setPayOrder(o);
        setPayAmount(((o.total_amount || 0) - (o.amount_paid || 0)).toFixed(2));
        setPayMethod('Bank Transfer'); setPayNote(''); setPayDate(today());
    };

    const submitPay = async () => {
        if (!payOrder) return;
        const amount = Number(payAmount);
        if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
        setSaving(true);
        try {
            await recordCustomerPayment(payOrder.id, amount, payMethod, payNote, payDate, currentUser?.name);
            setPayOrder(null);
        } catch { /* hook toasts */ } finally { setSaving(false); }
    };

    const handleDelete = async (o: WholesaleOrder) => {
        if (!confirm(`Delete wholesale order for ${o.customer_name}? Stock will be returned.`)) return;
        try { await deleteWholesaleOrder(o); } catch { /* hook toasts */ }
    };

    // Delete a payment from the View Details popup: reverts the order balance and
    // removes the linked Income transaction (handled inside deleteCustomerPayment).
    const handleDeleteViewPayment = async (p: { id: string; amount: number }) => {
        if (!viewOrder) return;
        if (!confirm(`Delete this payment of ${fmt(Number(p.amount) || 0)}? The order balance will be restored.`)) return;
        try {
            await deleteCustomerPayment(p.id);
            const newPaid = Math.max(0, (viewOrder.amount_paid || 0) - Number(p.amount));
            const newStatus = newPaid === 0 ? 'Unpaid' : (newPaid >= (viewOrder.total_amount || 0) ? 'Paid' : 'Partial');
            setViewOrder({ ...viewOrder, amount_paid: newPaid, payment_status: newStatus as WholesaleOrder['payment_status'], payments: (viewOrder.payments || []).filter(x => x.id !== p.id) });
        } catch { /* hook toasts */ }
    };

    const handleMarkDelivered = async (o: WholesaleOrder) => {
        if (!confirm(`Mark ${o.invoice_number || `WO-${o.id.slice(0, 8).toUpperCase()}`} as Delivered?`)) return;
        try { await updateWholesaleOrderStatus(o, 'Delivered'); } catch { /* hook toasts */ }
    };

    const handleCancelOrder = async (o: WholesaleOrder) => {
        if (!confirm(`Cancel this order for ${o.customer_name}? Stock will be returned to inventory.`)) return;
        try { await updateWholesaleOrderStatus(o, 'Cancelled'); } catch { /* hook toasts */ }
    };

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return wholesaleOrders
            .filter(o => statusFilter === 'All' || (o.status || 'Open') === statusFilter)
            .filter(o => payFilter === 'All' || (o.payment_status || 'Unpaid') === payFilter)
            .filter(o => !q || o.customer_name.toLowerCase().includes(q) || (o.customer_phone || '').includes(q) || (o.invoice_number || '').toLowerCase().includes(q));
    }, [wholesaleOrders, search, payFilter, statusFilter]);

    const totals = useMemo(() => {
        let sales = 0, outstanding = 0, overdue = 0, overdueCount = 0;
        for (const o of wholesaleOrders) {
            if (o.status === 'Cancelled') continue;
            const total = o.total_amount || 0;
            const balance = total - (o.amount_paid || 0);
            sales += total;
            outstanding += balance;
            if (balance > 0.005 && daysLate(o.due_date) !== null) {
                overdue += balance;
                overdueCount += 1;
            }
        }
        return { sales, outstanding, collected: sales - outstanding, overdue, overdueCount };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wholesaleOrders]);

    // Counts for the payment-status filter tabs.
    const payCounts = useMemo(() => {
        const c: Record<string, number> = { All: 0, Unpaid: 0, Partial: 0, Paid: 0 };
        for (const o of wholesaleOrders) {
            if (o.status === 'Cancelled') continue;
            c.All += 1;
            const k = o.payment_status || 'Unpaid';
            c[k] = (c[k] || 0) + 1;
        }
        return c;
    }, [wholesaleOrders]);

    const sortedOrders = useMemo(() => {
        if (!sortConfig) return filtered;
        const dir = sortConfig.direction === 'asc' ? 1 : -1;
        return [...filtered].sort((a, b) => {
            const av = sortValue(a, sortConfig.key);
            const bv = sortValue(b, sortConfig.key);
            if (av === bv) return 0;
            return (av < bv ? -1 : 1) * dir;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filtered, sortConfig]);

    // --- Pagination ---
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(() => Number(localStorage.getItem('ws_orders_itemsPerPage')) || 100);
    useEffect(() => { setCurrentPage(1); }, [search, payFilter, statusFilter, itemsPerPage]);
    useEffect(() => { localStorage.setItem('ws_orders_itemsPerPage', String(itemsPerPage)); }, [itemsPerPage]);
    const totalPages = Math.max(1, Math.ceil(sortedOrders.length / itemsPerPage));
    const safePage = Math.min(currentPage, totalPages);
    const paginatedOrders = sortedOrders.slice((safePage - 1) * itemsPerPage, safePage * itemsPerPage);

    return (
        <div style={{ padding: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <SummaryCard icon={ShoppingCart} gradient="linear-gradient(135deg, #6366f1, #8b5cf6)" label="Total Wholesale Sales" value={fmt(totals.sales)} />
                <SummaryCard icon={DollarSign} gradient="linear-gradient(135deg, #10b981, #34d399)" label="Collected" value={fmt(totals.collected)} valueColor="#10b981" />
                <SummaryCard icon={DollarSign} gradient="linear-gradient(135deg, #ef4444, #f87171)" label="Outstanding" value={fmt(totals.outstanding)} valueColor={totals.outstanding > 0 ? '#ef4444' : '#10b981'} />
                <SummaryCard icon={AlertTriangle} gradient="linear-gradient(135deg, #f59e0b, #fbbf24)" label={`Overdue${totals.overdueCount > 0 ? ` (${totals.overdueCount})` : ''}`} value={fmt(totals.overdue)} valueColor={totals.overdue > 0 ? '#ef4444' : undefined} />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                    <input className="search-input" style={{ width: '100%', paddingLeft: '36px' }} placeholder="Search customer, phone, invoice…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div style={{ display: 'flex', background: 'var(--color-surface)', borderRadius: '10px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                    {(['All', 'Unpaid', 'Partial', 'Paid'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setPayFilter(tab)}
                            style={{
                                padding: '7px 14px', border: 'none',
                                background: payFilter === tab ? 'var(--color-primary)' : 'transparent',
                                color: payFilter === tab ? 'white' : 'var(--color-text-secondary)',
                                fontWeight: 600, fontSize: '12px', cursor: 'pointer', transition: 'all 0.2s ease',
                                display: 'flex', alignItems: 'center', gap: '5px',
                            }}
                        >
                            {tab}
                            <span style={{ background: payFilter === tab ? 'rgba(255,255,255,0.25)' : 'var(--color-bg)', padding: '1px 7px', borderRadius: '12px', fontSize: '10px', fontWeight: 700 }}>{payCounts[tab] || 0}</span>
                        </button>
                    ))}
                </div>
                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as any)}
                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}
                >
                    <option value="All">All Statuses</option>
                    <option value="Open">Open</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Cancelled">Cancelled</option>
                </select>
                <button className="secondary-button" onClick={() => fetchWholesaleOrders()}>
                    <RefreshCw size={16} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} /> Refresh
                </button>
                <button className="primary-button" disabled={tableMissing} onClick={openCreate}><Plus size={18} /> New Wholesale Order</button>
            </div>

            {tableMissing ? (
                <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Database size={40} style={{ opacity: 0.25, margin: '0 auto 12px', color: '#D97706' }} />
                    <p style={{ fontWeight: 600, color: 'var(--color-text)' }}>Database setup needed</p>
                    <p style={{ fontSize: '13px' }}>Run <code>migrations/wholesale_orders.sql</code> in your Supabase SQL editor, then Refresh.</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="glass-panel" style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <ShoppingCart size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                    <p>No wholesale orders yet. Create one to start tracking customer credit.</p>
                </div>
            ) : (
                <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                    <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', border: 'none', minWidth: '960px' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                                {([
                                    { key: 'invoice', label: 'Invoice', align: 'left' },
                                    { key: 'customer', label: 'Customer', align: 'left' },
                                    { key: 'order_date', label: 'Date', align: 'left' },
                                    { key: 'due_date', label: 'Due', align: 'left' },
                                    { key: 'items', label: 'Items', align: 'center' },
                                    { key: 'total', label: 'Total', align: 'right' },
                                    { key: 'paid', label: 'Paid', align: 'right' },
                                    { key: 'balance', label: 'Balance', align: 'right' },
                                    { key: 'ostatus', label: 'Status', align: 'center' },
                                    { key: 'status', label: 'Payment', align: 'center' },
                                    { key: null, label: 'Actions', align: 'center' },
                                ] as Array<{ key: WsSortKey | null; label: string; align: 'left' | 'center' | 'right' }>).map(col => {
                                    const isSorted = col.key !== null && sortConfig?.key === col.key;
                                    return (
                                        <th
                                            key={col.label}
                                            onClick={col.key ? () => handleSort(col.key!) : undefined}
                                            title={col.key ? 'Click to sort' : undefined}
                                            style={{ ...thStyle, textAlign: col.align, cursor: col.key ? 'pointer' : 'default', userSelect: 'none', color: isSorted ? 'var(--color-primary)' : thStyle.color }}
                                        >
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', verticalAlign: 'middle' }}>
                                                {col.label}
                                                {col.key && (
                                                    isSorted
                                                        ? (sortConfig!.direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)
                                                        : <ChevronsUpDown size={13} style={{ opacity: 0.25 }} />
                                                )}
                                            </span>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedOrders.map((o, idx) => {
                                const balance = (o.total_amount || 0) - (o.amount_paid || 0);
                                const pc = payConfig(o.payment_status);
                                const late = balance > 0.005 ? daysLate(o.due_date) : null;
                                const paidPercent = (o.total_amount || 0) > 0 ? Math.min(100, Math.round(((o.amount_paid || 0) / (o.total_amount || 1)) * 100)) : 0;
                                return (
                                    <tr key={o.id} className="hover-highlight" style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease', background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : undefined, opacity: o.status === 'Cancelled' ? 0.5 : 1 }}>
                                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-text)' }}>{o.invoice_number || `WO-${o.id.slice(0, 8).toUpperCase()}`}</td>
                                        <td style={tdStyle}>
                                            <div style={{ fontWeight: 500 }}>{o.customer_name}</div>
                                            {o.customer_phone && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{o.customer_phone}</div>}
                                        </td>
                                        <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>{o.order_date ? new Date(o.order_date).toLocaleDateString('en-GB').replace(/\//g, '-') : '—'}</td>
                                        <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>
                                            {o.due_date ? (
                                                <span style={{ color: late !== null ? '#ef4444' : 'var(--color-text-secondary)', fontWeight: late !== null ? 600 : 400 }}>
                                                    {new Date(o.due_date).toLocaleDateString('en-GB').replace(/\//g, '-')}
                                                    {late !== null && <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 700 }}>{late}d late</span>}
                                                </span>
                                            ) : '—'}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>{o.items?.length || 0}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontSize: '14px', fontWeight: 700, color: 'var(--color-text)' }}>{fmt(o.total_amount || 0)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{fmt(o.amount_paid || 0)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: balance > 0.005 ? '#ef4444' : '#059669' }}>{fmt(balance)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', backgroundColor: orderStatusConfig(o.status).bg, color: orderStatusConfig(o.status).color }}>{o.status || 'Open'}</span>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', backgroundColor: pc.bg, color: pc.color }}>{o.payment_status || 'Unpaid'}</span>
                                            {paidPercent > 0 && paidPercent < 100 && (
                                                <div style={{ marginTop: '6px' }}>
                                                    <div style={{ width: '60px', height: '4px', borderRadius: '2px', background: 'var(--color-border)', margin: '0 auto', overflow: 'hidden' }}>
                                                        <div style={{ width: `${paidPercent}%`, height: '100%', background: '#f59e0b', borderRadius: '2px' }} />
                                                    </div>
                                                    <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>{paidPercent}%</div>
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                                <button onClick={() => setViewOrder(o)} title="View Details" style={{ background: 'rgba(99,102,241,0.08)', border: 'none', cursor: 'pointer', color: '#6366f1', padding: '6px', borderRadius: '6px', transition: 'all 0.2s' }}>
                                                    <Eye size={15} />
                                                </button>
                                                <button onClick={() => handleCopyOrder(o)} title="Copy Details" style={{ background: 'rgba(107,114,128,0.08)', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '6px', borderRadius: '6px', transition: 'all 0.2s' }}>
                                                    <Copy size={15} />
                                                </button>
                                                {o.status === 'Open' && (
                                                    <button onClick={() => handleMarkDelivered(o)} title="Mark Delivered" style={{ background: 'rgba(16,185,129,0.12)', border: 'none', cursor: 'pointer', color: '#059669', padding: '6px', borderRadius: '6px', transition: 'all 0.2s' }}>
                                                        <PackageCheck size={15} />
                                                    </button>
                                                )}
                                                {o.status !== 'Cancelled' && (
                                                    <button onClick={() => handleCancelOrder(o)} title="Cancel Order (returns stock)" style={{ background: 'rgba(245,158,11,0.1)', border: 'none', cursor: 'pointer', color: '#d97706', padding: '6px', borderRadius: '6px', transition: 'all 0.2s' }}>
                                                        <Ban size={15} />
                                                    </button>
                                                )}
                                                {o.status !== 'Cancelled' && balance > 0.005 && (
                                                    <button onClick={() => openPay(o)} title="Record Payment" style={{ background: 'rgba(16,185,129,0.08)', border: 'none', cursor: 'pointer', color: '#10b981', padding: '6px', borderRadius: '6px', transition: 'all 0.2s' }}>
                                                        <DollarSign size={15} />
                                                    </button>
                                                )}
                                                <button onClick={() => handleDelete(o)} title="Delete" style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px', transition: 'all 0.2s' }}>
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {/* Pagination */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderTop: '1px solid var(--color-border)', flexWrap: 'wrap', gap: '10px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                            Showing {sortedOrders.length === 0 ? 0 : (safePage - 1) * itemsPerPage + 1} to {Math.min(safePage * itemsPerPage, sortedOrders.length)} of {sortedOrders.length} entries
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Show:</span>
                                <select value={itemsPerPage} onChange={e => setItemsPerPage(Number(e.target.value))} style={{ padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '12px', cursor: 'pointer', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                                    {[100, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage === 1} style={{ padding: '5px', opacity: safePage === 1 ? 0.4 : 1, border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', cursor: safePage === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', color: 'var(--color-text)' }}>
                                    <ChevronLeft size={15} />
                                </button>
                                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', margin: '0 8px' }}>
                                    Page <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{safePage}</span> of {totalPages}
                                </span>
                                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={{ padding: '5px', opacity: safePage === totalPages ? 0.4 : 1, border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', cursor: safePage === totalPages ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', color: 'var(--color-text)' }}>
                                    <ChevronRight size={15} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Create modal — styled like the Purchase Order popup */}
            {isCreateOpen && (
                <div style={modalOverlay} onClick={() => setIsCreateOpen(false)}>
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ background: 'var(--color-surface)', borderRadius: '24px', width: '100%', maxWidth: '940px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.25)', overflow: 'hidden', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}
                    >
                        {/* Header */}
                        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(99,102,241,0.05), rgba(139,92,246,0.05))' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                    <ShoppingCart size={20} />
                                </div>
                                <div>
                                    <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>New Wholesale Order</h2>
                                    <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '2px 0 0 0' }}>Sale on credit — stock leaves now, payment comes later</p>
                                </div>
                            </div>
                            <button onClick={() => setIsCreateOpen(false)} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={18} />
                            </button>
                        </div>

                        {/* Body */}
                        <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* Customer */}
                            <div style={sectionCard}>
                                <h4 style={sectionHeading}><User size={15} /> Customer Information</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={fieldLabel}>Customer *</label>
                                        <input list="ws-customer-names" style={fieldInput} value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Type or pick a customer" />
                                        <datalist id="ws-customer-names">
                                            {customers.map(c => <option key={c.id} value={c.name} />)}
                                        </datalist>
                                    </div>
                                    <div>
                                        <label style={fieldLabel}>Phone</label>
                                        <input style={fieldInput} value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="Optional" />
                                    </div>
                                </div>
                            </div>

                            {/* Order details */}
                            <div style={sectionCard}>
                                <h4 style={sectionHeading}><Calendar size={15} /> Order Details</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={fieldLabel}>From Warehouse</label>
                                        <select style={fieldInput} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
                                            <option value="">—</option>
                                            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={fieldLabel}>Order Date *</label>
                                        <input type="date" style={fieldInput} value={orderDate} onChange={e => setOrderDate(e.target.value)} />
                                    </div>
                                    <div>
                                        <label style={fieldLabel}>Due Date</label>
                                        <input type="date" style={fieldInput} value={dueDate} onChange={e => setDueDate(e.target.value)} />
                                    </div>
                                    <div>
                                        <label style={fieldLabel}>Status</label>
                                        <select style={fieldInput} value={orderStatus} onChange={e => setOrderStatus(e.target.value as 'Open' | 'Delivered')}>
                                            <option value="Open">Open</option>
                                            <option value="Delivered">Delivered</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Reference */}
                            <div style={sectionCard}>
                                <h4 style={sectionHeading}><FileSignature size={15} /> Reference & Notes</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={fieldLabel}>Invoice Number</label>
                                        <input style={{ ...fieldInput, fontFamily: 'monospace' }} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="e.g. WS-2026-001" />
                                    </div>
                                    <div>
                                        <label style={fieldLabel}>Notes</label>
                                        <input style={fieldInput} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
                                    </div>
                                </div>
                            </div>

                            {/* Line items */}
                            <div style={sectionCard}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                    <h4 style={{ ...sectionHeading, marginBottom: 0 }}>
                                        <Package size={15} /> Line Items
                                        <span style={{ background: 'var(--color-primary)', color: 'white', padding: '1px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, marginLeft: '4px' }}>{lines.length}</span>
                                    </h4>
                                    <button className="primary-button" style={{ padding: '7px 14px', fontSize: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }} onClick={() => setLines(prev => [...prev, { product_id: '', quantity: 1, unit_price: 0 }])}>
                                        <Plus size={14} /> Add Product
                                    </button>
                                </div>
                                <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ background: 'var(--color-bg)' }}>
                                                <th style={liTh(36)}>#</th>
                                                <th style={{ ...liTh(), textAlign: 'left' }}>Product</th>
                                                <th style={{ ...liTh(90), textAlign: 'right' }}>Qty</th>
                                                <th style={{ ...liTh(130), textAlign: 'right' }}>Unit Price</th>
                                                <th style={{ ...liTh(130), textAlign: 'right' }}>Subtotal</th>
                                                <th style={liTh(44)}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {lines.map((l, idx) => (
                                                <tr key={idx} style={{ borderTop: '1px solid var(--color-border)' }}>
                                                    <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <select style={{ ...fieldInput, padding: '8px 10px', fontSize: '13px' }} value={l.product_id || ''} onChange={e => setLine(idx, { product_id: e.target.value })}>
                                                            <option value="">Select product...</option>
                                                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                        </select>
                                                    </td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <input type="number" style={{ ...fieldInput, padding: '8px 10px', fontSize: '13px', textAlign: 'right' }} min="0" value={l.quantity ?? ''} onChange={e => setLine(idx, { quantity: Number(e.target.value) })} />
                                                    </td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <input type="number" style={{ ...fieldInput, padding: '8px 10px', fontSize: '13px', textAlign: 'right' }} min="0" step="0.01" value={l.unit_price ?? ''} onChange={e => setLine(idx, { unit_price: Number(e.target.value) })} />
                                                    </td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '14px', fontWeight: 600 }}>{fmt(lineTotal(l))}</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                                        <button onClick={() => setLines(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)} disabled={lines.length <= 1} style={{ background: lines.length > 1 ? 'rgba(239,68,68,0.08)' : 'transparent', border: 'none', cursor: lines.length > 1 ? 'pointer' : 'not-allowed', color: lines.length > 1 ? '#ef4444' : 'var(--color-text-muted)', padding: '5px', borderRadius: '6px' }}>
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div style={{ padding: '18px 28px', borderTop: '2px solid var(--color-border)', background: 'linear-gradient(135deg, rgba(99,102,241,0.04), rgba(139,92,246,0.04))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Order Total</span>
                                <span style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-primary)', letterSpacing: '-0.5px' }}>{fmt(orderTotal)}</span>
                                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', background: 'var(--color-bg)', padding: '3px 10px', borderRadius: '12px', fontWeight: 600 }}>{lines.length} item{lines.length !== 1 ? 's' : ''}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button className="secondary-button" onClick={() => setIsCreateOpen(false)} style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600 }}>Cancel</button>
                                <button className="primary-button" onClick={submitCreate} disabled={saving} style={{ padding: '10px 24px', borderRadius: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <CheckCircle2 size={16} /> {saving ? 'Saving…' : 'Create Order'}
                                </button>
                            </div>
                        </div>
                    </div>
                    <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
                </div>
            )}

            {/* View Details modal */}
            {viewOrder && (() => {
                const paid = viewOrder.amount_paid || 0;
                const balance = (viewOrder.total_amount || 0) - paid;
                const pc = payConfig(viewOrder.payment_status);
                const whName = warehouses.find(w => w.id === viewOrder.warehouse_id)?.name || '—';
                const payments = [...(viewOrder.payments || [])].sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || ''));
                return (
                    <div style={modalOverlay} onClick={() => setViewOrder(null)}>
                        <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: '24px', width: '100%', maxWidth: '760px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.25)', overflow: 'hidden', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                            {/* Header */}
                            <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(99,102,241,0.05), rgba(139,92,246,0.05))' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                        <ShoppingCart size={20} />
                                    </div>
                                    <div>
                                        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, fontFamily: 'monospace' }}>{viewOrder.invoice_number || `WO-${viewOrder.id.slice(0, 8).toUpperCase()}`}</h2>
                                        <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '2px 0 0 0' }}>{viewOrder.customer_name}{viewOrder.customer_phone ? ` · ${viewOrder.customer_phone}` : ''}</p>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', backgroundColor: orderStatusConfig(viewOrder.status).bg, color: orderStatusConfig(viewOrder.status).color }}>{viewOrder.status || 'Open'}</span>
                                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', backgroundColor: pc.bg, color: pc.color }}>{viewOrder.payment_status || 'Unpaid'}</span>
                                    <button onClick={() => setViewOrder(null)} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <X size={18} />
                                    </button>
                                </div>
                            </div>

                            {/* Body */}
                            <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {/* Info grid */}
                                <div style={{ ...sectionCard, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px' }}>
                                    <WDetail label="Order Date" value={viewOrder.order_date ? new Date(viewOrder.order_date).toLocaleDateString('en-GB').replace(/\//g, '-') : '—'} />
                                    <WDetail label="Due Date" value={viewOrder.due_date ? new Date(viewOrder.due_date).toLocaleDateString('en-GB').replace(/\//g, '-') : '—'} />
                                    <WDetail label="From Warehouse" value={whName} />
                                    <WDetail label="Created By" value={viewOrder.created_by || '—'} />
                                    {viewOrder.notes && <WDetail label="Notes" value={viewOrder.notes} span />}
                                </div>

                                {/* Line items */}
                                <div style={sectionCard}>
                                    <h4 style={{ ...sectionHeading, marginBottom: '14px' }}>
                                        <Package size={15} /> Line Items
                                        <span style={{ background: 'var(--color-primary)', color: 'white', padding: '1px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, marginLeft: '4px' }}>{viewOrder.items?.length || 0}</span>
                                    </h4>
                                    <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ background: 'var(--color-bg)' }}>
                                                    <th style={liTh(36)}>#</th>
                                                    <th style={{ ...liTh(), textAlign: 'left' }}>Product</th>
                                                    <th style={{ ...liTh(80), textAlign: 'right' }}>Qty</th>
                                                    <th style={{ ...liTh(110), textAlign: 'right' }}>Unit Price</th>
                                                    <th style={{ ...liTh(110), textAlign: 'right' }}>Subtotal</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(viewOrder.items || []).map((item, idx) => (
                                                    <tr key={item.id || idx} style={{ borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined }}>
                                                        <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                                                        <td style={{ padding: '10px 12px', fontSize: '13px', fontWeight: 500 }}>{item.product_name || '—'}</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>{item.quantity}</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px' }}>{fmt(item.unit_price || 0)}</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>{fmt((item.quantity || 0) * (item.unit_price || 0))}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Payments */}
                                <div style={sectionCard}>
                                    <h4 style={{ ...sectionHeading, marginBottom: '14px' }}>
                                        <DollarSign size={15} /> Payment History
                                        <span style={{ background: '#10b981', color: 'white', padding: '1px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, marginLeft: '4px' }}>{payments.length}</span>
                                    </h4>
                                    {payments.length === 0 ? (
                                        <div style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No payments recorded yet.</div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {payments.map(p => (
                                                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '10px 14px' }}>
                                                    <div>
                                                        <div style={{ fontSize: '13px', fontWeight: 600 }}>{p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-GB').replace(/\//g, '-') : '—'}</div>
                                                        <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>{[p.payment_method, p.notes].filter(Boolean).join(' · ') || '—'}</div>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#10b981' }}>{fmt(Number(p.amount) || 0)}</div>
                                                        <button onClick={() => handleDeleteViewPayment(p)} title="Delete Payment" style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px' }}>
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Footer */}
                            <div style={{ padding: '18px 28px', borderTop: '2px solid var(--color-border)', background: 'linear-gradient(135deg, rgba(99,102,241,0.04), rgba(139,92,246,0.04))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                                    <div><span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Total </span><span style={{ fontSize: '18px', fontWeight: 800 }}>{fmt(viewOrder.total_amount || 0)}</span></div>
                                    <div><span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Paid </span><span style={{ fontSize: '18px', fontWeight: 800, color: '#10b981' }}>{fmt(paid)}</span></div>
                                    <div><span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Balance </span><span style={{ fontSize: '18px', fontWeight: 800, color: balance > 0.005 ? '#ef4444' : '#10b981' }}>{fmt(balance)}</span></div>
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    {viewOrder.status !== 'Cancelled' && balance > 0.005 && (
                                        <button className="primary-button" onClick={() => { const o = viewOrder; setViewOrder(null); openPay(o); }} style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <DollarSign size={16} /> Record Payment
                                        </button>
                                    )}
                                    <button className="secondary-button" onClick={() => handleCopyOrder(viewOrder)} style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Copy size={15} /> Copy Details
                                    </button>
                                    <button className="secondary-button" onClick={() => setViewOrder(null)} style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600 }}>Close</button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Payment modal — styled like the Purchase Order payment popup */}
            {payOrder && (() => {
                const remaining = (payOrder.total_amount || 0) - (payOrder.amount_paid || 0);
                return (
                    <div style={{ ...modalOverlay, zIndex: 10000 }} onClick={() => setPayOrder(null)}>
                        <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: '24px', width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.25)', overflow: 'hidden', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                            {/* Header */}
                            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(16,185,129,0.05), rgba(52,211,153,0.05))' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #10b981, #34d399)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                        <DollarSign size={18} />
                                    </div>
                                    <div>
                                        <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Record Payment</h2>
                                        <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '1px 0 0 0' }}>{payOrder.customer_name} · {payOrder.invoice_number || `WO-${payOrder.id.slice(0, 8).toUpperCase()}`}</p>
                                    </div>
                                </div>
                                <button onClick={() => setPayOrder(null)} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <X size={18} />
                                </button>
                            </div>

                            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {remaining > 0 && (
                                    <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)', borderRadius: '12px', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Remaining Balance</span>
                                        <span style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>{fmt(remaining)}</span>
                                    </div>
                                )}

                                <div>
                                    <label style={fieldLabel}>Amount to Pay *</label>
                                    <input type="number" style={{ ...fieldInput, fontSize: '16px', fontWeight: 600 }} value={payAmount} onChange={e => setPayAmount(e.target.value === '' ? '' : parseFloat(e.target.value))} min="0" step="0.01" />
                                    {remaining > 0 && (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '10px' }}>
                                            {[
                                                { label: 'Full', pct: 1, color: '#10b981' },
                                                { label: '75%', pct: 0.75, color: '#3b82f6' },
                                                { label: '50%', pct: 0.5, color: '#f59e0b' },
                                                { label: '25%', pct: 0.25, color: '#8b5cf6' },
                                            ].map(btn => {
                                                const val = Math.round(remaining * btn.pct * 100) / 100;
                                                const active = Number(payAmount) === val;
                                                return (
                                                    <button key={btn.label} onClick={() => setPayAmount(val)} style={{ padding: '8px 6px', fontSize: '12px', fontWeight: 700, border: '1px solid var(--color-border)', borderRadius: '8px', background: active ? btn.color : 'var(--color-bg)', color: active ? 'white' : btn.color, cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                                        <span>{btn.label}</span>
                                                        <span style={{ fontSize: '10px', opacity: 0.8 }}>{fmt(val)}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                                    <div>
                                        <label style={fieldLabel}>Payment Date *</label>
                                        <input type="date" style={fieldInput} value={payDate} onChange={e => setPayDate(e.target.value)} />
                                    </div>
                                    <div>
                                        <label style={fieldLabel}>Method</label>
                                        <select style={fieldInput} value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                                            <option>Cash</option><option>Bank Transfer</option><option>Credit Card</option><option>Cheque</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label style={fieldLabel}>Notes</label>
                                    <textarea style={{ ...fieldInput, minHeight: '60px', resize: 'vertical' }} value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="Optional payment notes..." />
                                </div>
                            </div>

                            {/* Footer */}
                            <div style={{ padding: '18px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: 'rgba(0,0,0,0.01)' }}>
                                <button className="secondary-button" onClick={() => setPayOrder(null)} style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600 }}>Cancel</button>
                                <button className="primary-button" onClick={submitPay} disabled={saving || !payAmount || Number(payAmount) <= 0} style={{ padding: '10px 24px', borderRadius: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <CheckCircle2 size={16} /> {saving ? 'Saving…' : 'Record Payment'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

const SummaryCard: React.FC<{ icon: React.ComponentType<{ size?: number }>; gradient: string; label: string; value: string; valueColor?: string }> = ({ icon: Icon, gradient, label, value, valueColor }) => (
    <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px' }}>
        <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}><Icon size={20} /></div>
        <div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: valueColor }}>{value}</div>
        </div>
    </div>
);

const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border)' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px', whiteSpace: 'nowrap' };

// Purchase-Order-style modal styles.
const modalOverlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' };
const sectionCard: React.CSSProperties = { background: 'var(--color-bg)', padding: '20px', borderRadius: '14px', border: '1px solid var(--color-border)' };
const sectionHeading: React.CSSProperties = { fontSize: '13px', fontWeight: 700, marginBottom: '16px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const fieldLabel: React.CSSProperties = { display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' };
const fieldInput: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' };
const liTh = (width?: number): React.CSSProperties => ({ padding: '10px 12px', textAlign: 'center', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', width: width ? `${width}px` : undefined, borderBottom: '1px solid var(--color-border)' });

// Small labelled value for the View Details modal.
const WDetail: React.FC<{ label: string; value: React.ReactNode; span?: boolean }> = ({ label, value, span }) => (
    <div style={span ? { gridColumn: '1 / -1' } : undefined}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>{label}</div>
        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}>{value}</div>
    </div>
);

export default WholesaleOrdersPage;
