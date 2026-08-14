import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, FileText, CheckCircle2, Clock, FileSignature, AlertCircle, X, Search, Trash2, Edit, DollarSign, Package, ShoppingCart, AlertTriangle, ArrowUp, ArrowDown, ChevronsUpDown, PackageCheck } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useProcurement } from '../../hooks/useProcurement';
import { useToast } from '../../context/ToastContext';
import type { PurchaseOrderItem, PurchaseOrder } from '../../types';

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

const getStatusConfig = (status: string) => {
    switch (status) {
        case 'Draft': return { color: '#6b7280', bg: 'rgba(107, 114, 128, 0.1)', icon: FileSignature };
        case 'Sent': return { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', icon: Clock };
        case 'Received': return { color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', icon: CheckCircle2 };
        case 'Cancelled': return { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', icon: AlertCircle };
        default: return { color: '#6b7280', bg: 'rgba(107, 114, 128, 0.1)', icon: FileText };
    }
};

const getPaymentConfig = (status: string) => {
    switch (status) {
        case 'Paid': return { color: '#10b981', bg: 'rgba(16, 185, 129, 0.08)' };
        case 'Partial': return { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)' };
        default: return { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)' };
    }
};

type StatusFilter = 'All' | 'Draft' | 'Sent' | 'Received' | 'Cancelled';
type PaymentFilter = 'All' | 'Unpaid' | 'Partial' | 'Paid';

const PurchaseOrdersPage = () => {
    const { setHeaderContent } = useHeader();
    const { products, addStock } = useStore();
    const { showToast } = useToast();
    const { purchaseOrders, suppliers, isLoading, fetchPurchaseOrders, fetchSuppliers, savePurchaseOrder, deletePurchaseOrder, recordSupplierPayment } = useProcurement();
    const [receivingId, setReceivingId] = useState<string | null>(null);
    const receivingRef = useRef<Set<string>>(new Set());

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
    const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('All');

    // Form state
    const [editingPOId, setEditingPOId] = useState<string | null>(null);
    const [supplierId, setSupplierId] = useState('');
    const [orderDate, setOrderDate] = useState(() => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
    const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [paymentDueDate, setPaymentDueDate] = useState('');
    const [status, setStatus] = useState<'Draft' | 'Sent' | 'Received' | 'Cancelled'>('Draft');
    const [notes, setNotes] = useState('');
    const [lines, setLines] = useState<Partial<PurchaseOrderItem>[]>([
        { product_id: '', quantity: 1, unit_price: 0 }
    ]);
    
    // Payment Modal State
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [payingPOId, setPayingPOId] = useState('');
    const [payingSupplierId, setPayingSupplierId] = useState('');
    const [payingPORemaining, setPayingPORemaining] = useState<number>(0);
    const [paymentAmount, setPaymentAmount] = useState<number | ''>('');
    const [paymentMethod, setPaymentMethod] = useState('Bank Transfer');
    const [paymentDate, setPaymentDate] = useState(() => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
    const [paymentNotes, setPaymentNotes] = useState('');

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Purchase Orders</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage stock reordering and supplier POs</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchPurchaseOrders();
        fetchSuppliers();
    }, [fetchPurchaseOrders, fetchSuppliers]);

    const activeSuppliers = useMemo(() => suppliers.filter(s => s.is_active), [suppliers]);

    // Summary stats
    const summaryStats = useMemo(() => {
        const totalPOs = purchaseOrders.length;
        const totalValue = purchaseOrders.reduce((sum, po) => sum + (po.total_amount || 0), 0);
        const totalPaid = purchaseOrders.reduce((sum, po) => sum + (po.amount_paid || 0), 0);
        const unpaidCount = purchaseOrders.filter(po => po.payment_status !== 'Paid').length;
        const overdueCount = purchaseOrders.filter(po => 
            po.payment_status !== 'Paid' && po.payment_due_date && new Date(po.payment_due_date) < new Date()
        ).length;
        return { totalPOs, totalValue, totalPaid, outstanding: totalValue - totalPaid, unpaidCount, overdueCount };
    }, [purchaseOrders]);

    // Status counts for filter tabs
    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = { All: purchaseOrders.length, Draft: 0, Sent: 0, Received: 0, Cancelled: 0 };
        purchaseOrders.forEach(po => { if (counts[po.status] !== undefined) counts[po.status]++; });
        return counts;
    }, [purchaseOrders]);

    const handleOpenModal = () => {
        setEditingPOId(null);
        setSupplierId('');
        setOrderDate(new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
        setExpectedDeliveryDate('');
        setInvoiceNumber('');
        setPaymentDueDate('');
        setStatus('Draft');
        setNotes('');
        setLines([{ product_id: '', quantity: 1, unit_price: 0 }]);
        setIsModalOpen(true);
    };

    const handleEditPO = (po: any) => {
        setEditingPOId(po.id);
        setSupplierId(po.supplier_id);
        setOrderDate(po.order_date ? po.order_date.split('T')[0] : '');
        setExpectedDeliveryDate(po.expected_delivery_date ? po.expected_delivery_date.split('T')[0] : '');
        setInvoiceNumber(po.invoice_number || '');
        setPaymentDueDate(po.payment_due_date ? po.payment_due_date.split('T')[0] : '');
        setStatus(po.status || 'Draft');
        setNotes(po.notes || '');
        if (po.items && po.items.length > 0) {
            setLines(po.items.map((i: any) => ({
                product_id: i.product_id,
                quantity: i.quantity,
                unit_price: i.unit_price
            })));
        } else {
            setLines([{ product_id: '', quantity: 1, unit_price: 0 }]);
        }
        setIsModalOpen(true);
    };

    const handleDeletePO = async (id: string) => {
        if (window.confirm('Are you sure you want to delete this purchase order?')) {
            await deletePurchaseOrder(id);
        }
    };

    // Receive a PO straight from the table: add each item to stock and mark it Received.
    const handleReceivePO = async (po: any) => {
        if (receivingRef.current.has(po.id)) return;
        if (!window.confirm(`Receive PO-${po.id.substring(0, 8).toUpperCase()} into stock?`)) return;
        receivingRef.current.add(po.id);
        setReceivingId(po.id);
        try {
            if (po.items && po.items.length > 0) {
                for (const item of po.items) {
                    if (item.product_id) {
                        await addStock(item.product_id, item.quantity, item.unit_price, `Received from PO-${po.id.substring(0, 8)}`, po.supplier?.name || '');
                    }
                }
            }
            await savePurchaseOrder({ ...po, status: 'Received' }, po.items || []);
            showToast(`PO-${po.id.substring(0, 8).toUpperCase()} received into stock`, 'success');
            fetchPurchaseOrders(true);
        } catch (error: any) {
            showToast('Error receiving PO: ' + (error?.message || ''), 'error');
        } finally {
            receivingRef.current.delete(po.id);
            setReceivingId(null);
        }
    };

    const addLine = () => {
        setLines([...lines, { product_id: '', quantity: 1, unit_price: 0 }]);
    };

    const removeLine = (index: number) => {
        setLines(lines.filter((_, i) => i !== index));
    };

    const updateLine = (index: number, field: keyof PurchaseOrderItem, value: any) => {
        const newLines = [...lines];
        newLines[index] = { ...newLines[index], [field]: value };
        if (field === 'product_id' && newLines[index].unit_price === 0) {
            const product = products.find(p => p.id === value);
            if (product) {
                newLines[index].unit_price = product.purchaseCost || 0;
            }
        }
        setLines(newLines);
    };

    const totalAmount = lines.reduce((sum, line) => sum + ((line.quantity || 0) * (line.unit_price || 0)), 0);
    const isFormValid = supplierId && lines.every(l => l.product_id && l.quantity && l.quantity > 0);

    const handleSave = async () => {
        if (!isFormValid) return;
        try {
            await savePurchaseOrder(
                { 
                    id: editingPOId || undefined,
                    supplier_id: supplierId, 
                    order_date: orderDate, 
                    expected_delivery_date: expectedDeliveryDate || undefined,
                    invoice_number: invoiceNumber || undefined,
                    payment_due_date: paymentDueDate || undefined,
                    status,
                    total_amount: totalAmount,
                    notes: notes || undefined
                },
                lines
            );
            setIsModalOpen(false);
        } catch (error) {
            // Error handled in hook
        }
    };

    const handleOpenPaymentModal = (po: any) => {
        setPayingPOId(po.id);
        setPayingSupplierId(po.supplier_id);
        const remaining = (po.total_amount || 0) - (po.amount_paid || 0);
        setPayingPORemaining(remaining > 0 ? remaining : 0);
        setPaymentAmount(remaining > 0 ? remaining : 0);
        setPaymentMethod('Bank Transfer');
        setPaymentDate(new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
        setPaymentNotes('');
        setIsPaymentModalOpen(true);
    };

    const handleSavePayment = async () => {
        if (!paymentAmount) return;
        try {
            await recordSupplierPayment(payingPOId, payingSupplierId, Number(paymentAmount), paymentMethod, paymentNotes);
            setIsPaymentModalOpen(false);
        } catch (error) {
            // Error handled in hook
        }
    };

    // Filter Logic
    const filteredPOs = useMemo(() => {
        return purchaseOrders.filter(po => {
            // Status filter
            if (statusFilter !== 'All' && po.status !== statusFilter) return false;
            // Payment filter
            if (paymentFilter !== 'All' && (po.payment_status || 'Unpaid') !== paymentFilter) return false;
            // Search
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                return po.id.toLowerCase().includes(q) || 
                       po.supplier?.name?.toLowerCase().includes(q) ||
                       (po.invoice_number || '').toLowerCase().includes(q);
            }
            return true;
        });
    }, [purchaseOrders, searchQuery, statusFilter, paymentFilter]);

    const thStyle: React.CSSProperties = { padding: '14px 16px', fontWeight: 600, fontSize: '12px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textTransform: 'uppercase', letterSpacing: '0.5px' };

    // --- Sorting ---
    type SortKey = 'po' | 'supplier' | 'order_date' | 'expected' | 'invoice' | 'due_date' | 'items' | 'total' | 'status' | 'payment';
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>(null);

    const handleSort = (key: SortKey) => {
        setSortConfig(prev =>
            prev?.key === key
                ? (prev.direction === 'asc' ? { key, direction: 'desc' } : null) // third click clears
                : { key, direction: 'asc' }
        );
    };

    // Values to compare per column. Dates become timestamps and money/counts stay
    // numeric so they sort by magnitude rather than as text ("$9" before "$10").
    const sortValue = (po: PurchaseOrder, key: SortKey): string | number => {
        switch (key) {
            case 'po': return po.id.toLowerCase();
            case 'supplier': return (po.supplier?.name || '').toLowerCase();
            case 'order_date': return new Date(po.order_date).getTime() || 0;
            case 'expected': return po.expected_delivery_date ? new Date(po.expected_delivery_date).getTime() : 0;
            case 'invoice': return (po.invoice_number || '').toLowerCase();
            case 'due_date': return po.payment_due_date ? new Date(po.payment_due_date).getTime() : 0;
            case 'items': return po.items?.length || 0;
            case 'total': return po.total_amount || 0;
            case 'status': return (po.status || '').toLowerCase();
            case 'payment': return (po.payment_status || 'Unpaid').toLowerCase();
            default: return '';
        }
    };

    const sortedPOs = useMemo(() => {
        if (!sortConfig) return filteredPOs;
        const dir = sortConfig.direction === 'asc' ? 1 : -1;
        // Copy first — sort mutates, and filteredPOs is memoised upstream.
        return [...filteredPOs].sort((a, b) => {
            const av = sortValue(a, sortConfig.key);
            const bv = sortValue(b, sortConfig.key);
            if (av === bv) return 0;
            return (av < bv ? -1 : 1) * dir;
        });
    }, [filteredPOs, sortConfig]);

    // --- Column resizing ---
    const PO_COLUMNS: Array<{ key: SortKey | 'actions'; label: string; align: 'left' | 'center' | 'right'; width: number; sortable: boolean }> = [
        { key: 'po', label: 'PO #', align: 'left', width: 130, sortable: true },
        { key: 'supplier', label: 'Supplier', align: 'left', width: 160, sortable: true },
        { key: 'order_date', label: 'Date', align: 'left', width: 110, sortable: true },
        { key: 'expected', label: 'Expected', align: 'left', width: 110, sortable: true },
        { key: 'invoice', label: 'Invoice #', align: 'left', width: 130, sortable: true },
        { key: 'due_date', label: 'Due Date', align: 'left', width: 110, sortable: true },
        { key: 'items', label: 'Items', align: 'center', width: 80, sortable: true },
        { key: 'total', label: 'Total', align: 'right', width: 110, sortable: true },
        { key: 'status', label: 'Status', align: 'center', width: 120, sortable: true },
        { key: 'payment', label: 'Payment', align: 'center', width: 140, sortable: true },
        { key: 'actions', label: 'Actions', align: 'center', width: 120, sortable: false },
    ];

    const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
        try {
            const saved = localStorage.getItem('po-col-widths');
            if (saved) return JSON.parse(saved);
        } catch { /* ignore malformed value */ }
        return Object.fromEntries(PO_COLUMNS.map(c => [c.key, c.width]));
    });

    // Drag state lives in a ref: it changes on every mousemove and must not re-render.
    const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

    const handleResizeStart = (e: React.MouseEvent, key: string) => {
        e.preventDefault();
        e.stopPropagation(); // don't trigger the header's sort click
        resizingRef.current = { key, startX: e.clientX, startWidth: colWidths[key] ?? 120 };

        const onMove = (ev: MouseEvent) => {
            const r = resizingRef.current;
            if (!r) return;
            const next = Math.max(60, r.startWidth + (ev.clientX - r.startX));
            setColWidths(prev => ({ ...prev, [r.key]: next }));
        };
        const onUp = () => {
            resizingRef.current = null;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            setColWidths(prev => {
                try { localStorage.setItem('po-col-widths', JSON.stringify(prev)); } catch { /* quota */ }
                return prev;
            });
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    return (
        <div className="page-container fade-in">
            {/* Summary Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}>
                        <ShoppingCart size={20} />
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Total POs</div>
                        <div style={{ fontSize: '22px', fontWeight: 700 }}>{summaryStats.totalPOs}</div>
                    </div>
                </div>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'linear-gradient(135deg, #3b82f6, #60a5fa)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}>
                        <Package size={20} />
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Total Value</div>
                        <div style={{ fontSize: '22px', fontWeight: 700 }}>{formatCurrency(summaryStats.totalValue)}</div>
                    </div>
                </div>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'linear-gradient(135deg, #ef4444, #f87171)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}>
                        <DollarSign size={20} />
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Outstanding</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: summaryStats.outstanding > 0 ? '#ef4444' : '#10b981' }}>{formatCurrency(summaryStats.outstanding)}</div>
                    </div>
                </div>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'linear-gradient(135deg, #f59e0b, #fbbf24)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}>
                        <AlertTriangle size={20} />
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Overdue</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: summaryStats.overdueCount > 0 ? '#ef4444' : 'var(--color-text)' }}>{summaryStats.overdueCount}</div>
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    {/* Status filter tabs */}
                    <div style={{ display: 'flex', background: 'var(--color-surface)', borderRadius: '10px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                        {(['All', 'Draft', 'Sent', 'Received', 'Cancelled'] as StatusFilter[]).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setStatusFilter(tab)}
                                style={{
                                    padding: '7px 14px',
                                    border: 'none',
                                    background: statusFilter === tab ? 'var(--color-primary)' : 'transparent',
                                    color: statusFilter === tab ? 'white' : 'var(--color-text-secondary)',
                                    fontWeight: 600,
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                }}
                            >
                                {tab}
                                <span style={{
                                    background: statusFilter === tab ? 'rgba(255,255,255,0.25)' : 'var(--color-bg)',
                                    padding: '1px 7px',
                                    borderRadius: '12px',
                                    fontSize: '10px',
                                    fontWeight: 700,
                                }}>{statusCounts[tab] || 0}</span>
                            </button>
                        ))}
                    </div>

                    {/* Payment filter */}
                    <select
                        value={paymentFilter}
                        onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
                        style={{
                            padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                        }}
                    >
                        <option value="All">All Payments</option>
                        <option value="Unpaid">Unpaid</option>
                        <option value="Partial">Partial</option>
                        <option value="Paid">Paid</option>
                    </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ position: 'relative', width: '260px' }}>
                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input 
                            type="text" 
                            className="input-field"
                            placeholder="Search PO, supplier, invoice..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ width: '100%', padding: '9px 10px 9px 36px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px' }}
                        />
                    </div>
                    <button 
                        className="primary-button" 
                        onClick={handleOpenModal}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '10px', fontWeight: 600, boxShadow: 'var(--shadow-sm)', whiteSpace: 'nowrap' }}
                    >
                        <Plus size={18} /> New PO
                    </button>
                </div>
            </div>

            {/* Table */}
            {isLoading ? (
                <div style={{ textAlign: 'center', padding: '60px', color: 'var(--color-text-secondary)' }}>
                    <div className="loader" style={{ margin: '0 auto 16px', width: '32px', height: '32px' }}></div>
                    Loading orders...
                </div>
            ) : filteredPOs.length === 0 ? (
                <div className="glass-panel" style={{ textAlign: 'center', padding: '60px', borderRadius: '16px' }}>
                    <FileText size={48} color="var(--color-text-muted)" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '8px' }}>No Purchase Orders Found</h3>
                    <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                        {searchQuery || statusFilter !== 'All' || paymentFilter !== 'All' ? 'Try adjusting your filters.' : 'Create your first purchase order to get started.'}
                    </p>
                </div>
            ) : (
                <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                    <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', border: 'none' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                                {PO_COLUMNS.map(col => {
                                    const isSorted = sortConfig?.key === col.key;
                                    const width = colWidths[col.key] ?? col.width;
                                    return (
                                        <th
                                            key={col.key}
                                            onClick={col.sortable ? () => handleSort(col.key as SortKey) : undefined}
                                            title={col.sortable ? 'Click to sort — drag the edge to resize' : undefined}
                                            style={{
                                                ...thStyle,
                                                textAlign: col.align,
                                                width: `${width}px`,
                                                minWidth: `${width}px`,
                                                position: 'relative',
                                                cursor: col.sortable ? 'pointer' : 'default',
                                                userSelect: 'none',
                                                color: isSorted ? 'var(--color-primary)' : thStyle.color,
                                            }}
                                        >
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', verticalAlign: 'middle' }}>
                                                {col.label}
                                                {col.sortable && (
                                                    isSorted
                                                        ? (sortConfig!.direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)
                                                        : <ChevronsUpDown size={13} style={{ opacity: 0.25 }} />
                                                )}
                                            </span>
                                            {/* Grab handle straddling the column edge. mousedown stops
                                                propagation so starting a drag doesn't also sort. */}
                                            <span
                                                onMouseDown={(e) => handleResizeStart(e, col.key)}
                                                onClick={(e) => e.stopPropagation()}
                                                style={{
                                                    position: 'absolute', top: 0, right: 0, bottom: 0,
                                                    width: '8px', transform: 'translateX(50%)',
                                                    cursor: 'col-resize', zIndex: 2,
                                                }}
                                            />
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedPOs.map((po, idx) => {
                                const statusCfg = getStatusConfig(po.status);
                                const payCfg = getPaymentConfig(po.payment_status || 'Unpaid');
                                const isOverdue = po.payment_status !== 'Paid' && po.payment_due_date && new Date(po.payment_due_date) < new Date();
                                const paidPercent = po.total_amount > 0 ? Math.min(100, Math.round(((po.amount_paid || 0) / po.total_amount) * 100)) : 0;
                                return (
                                    <tr key={po.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease', background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : undefined }} className="hover-highlight">
                                        <td style={{ padding: '14px 16px', fontSize: '13px', fontWeight: 700, color: 'var(--color-text)', fontFamily: 'monospace' }}>
                                            PO-{po.id.substring(0, 8).toUpperCase()}
                                        </td>
                                        <td style={{ padding: '14px 16px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}>
                                            {po.supplier?.name || '—'}
                                        </td>
                                        <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                            {new Date(po.order_date).toLocaleDateString('en-GB').replace(/\//g, '-')}
                                        </td>
                                        <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                            {po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString('en-GB').replace(/\//g, '-') : '—'}
                                        </td>
                                        <td style={{ padding: '14px 16px', fontSize: '13px', color: po.invoice_number ? 'var(--color-text)' : 'var(--color-text-muted)', fontFamily: po.invoice_number ? 'monospace' : undefined, fontWeight: po.invoice_number ? 500 : 400 }}>
                                            {po.invoice_number || '—'}
                                        </td>
                                        <td style={{ padding: '14px 16px', fontSize: '13px' }}>
                                            {po.payment_due_date ? (
                                                <span style={{ color: isOverdue ? '#ef4444' : 'var(--color-text-secondary)', fontWeight: isOverdue ? 600 : 400 }}>
                                                    {new Date(po.payment_due_date).toLocaleDateString('en-GB').replace(/\//g, '-')}
                                                    {isOverdue && <span style={{ fontSize: '10px', marginLeft: '4px' }}>⚠</span>}
                                                </span>
                                            ) : '—'}
                                        </td>
                                        <td style={{ padding: '14px 16px', fontSize: '13px', textAlign: 'center', fontWeight: 600, color: 'var(--color-text)' }}>
                                            {po.items?.reduce((sum: number, i: any) => sum + i.quantity, 0) || 0}
                                        </td>
                                        <td style={{ padding: '14px 16px', fontSize: '14px', fontWeight: 700, color: 'var(--color-text)', textAlign: 'right' }}>
                                            {formatCurrency(po.total_amount)}
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                            <span style={{ 
                                                display: 'inline-block', padding: '3px 10px', borderRadius: '20px', 
                                                fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                                                backgroundColor: statusCfg.bg, color: statusCfg.color,
                                            }}>
                                                {po.status}
                                            </span>
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                            <div>
                                                <span style={{ 
                                                    display: 'inline-block', padding: '3px 10px', borderRadius: '20px', 
                                                    fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                                                    backgroundColor: payCfg.bg, color: payCfg.color,
                                                }}>
                                                    {po.payment_status || 'Unpaid'}
                                                </span>
                                                {paidPercent > 0 && paidPercent < 100 && (
                                                    <div style={{ marginTop: '6px' }}>
                                                        <div style={{ width: '60px', height: '4px', borderRadius: '2px', background: 'var(--color-border)', margin: '0 auto', overflow: 'hidden' }}>
                                                            <div style={{ width: `${paidPercent}%`, height: '100%', background: '#f59e0b', borderRadius: '2px' }} />
                                                        </div>
                                                        <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>{paidPercent}%</div>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                                {po.status !== 'Received' && po.status !== 'Cancelled' && (
                                                    <button
                                                        onClick={() => handleReceivePO(po)}
                                                        disabled={receivingId === po.id}
                                                        style={{ background: 'rgba(16,185,129,0.12)', border: 'none', cursor: receivingId === po.id ? 'not-allowed' : 'pointer', color: '#059669', padding: '6px', borderRadius: '6px', transition: 'all 0.2s', opacity: receivingId === po.id ? 0.6 : 1 }}
                                                        title="Receive into stock"
                                                    >
                                                        <PackageCheck size={15} />
                                                    </button>
                                                )}
                                                {po.payment_status !== 'Paid' && (
                                                    <button
                                                        onClick={() => handleOpenPaymentModal(po)}
                                                        style={{ background: 'rgba(16,185,129,0.08)', border: 'none', cursor: 'pointer', color: '#10b981', padding: '6px', borderRadius: '6px', transition: 'all 0.2s' }}
                                                        title="Record Payment"
                                                    >
                                                        <DollarSign size={15} />
                                                    </button>
                                                )}
                                                <button 
                                                    onClick={() => handleEditPO(po)}
                                                    style={{ background: 'rgba(59,130,246,0.08)', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: '6px', borderRadius: '6px', transition: 'all 0.2s' }}
                                                    title="Edit"
                                                >
                                                    <Edit size={15} />
                                                </button>
                                                <button 
                                                    onClick={() => handleDeletePO(po.id)}
                                                    style={{ background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '6px', borderRadius: '6px', transition: 'all 0.2s' }}
                                                    title="Delete"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* PO Form Modal */}
            {isModalOpen && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 9999,
                    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px'
                }}>
                    <div style={{
                        background: '#ffffff',
                        borderRadius: '24px',
                        width: '100%',
                        maxWidth: '940px',
                        maxHeight: '92vh',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
                        overflow: 'hidden',
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                    }}>
                        {/* Modal Header */}
                        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(99,102,241,0.04), rgba(139,92,246,0.04))' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                    <FileText size={20} />
                                </div>
                                <div>
                                    <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
                                        {editingPOId ? 'Edit Purchase Order' : 'New Purchase Order'}
                                    </h2>
                                    <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '2px 0 0 0' }}>Fill in order details and add line items</p>
                                </div>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                                <X size={18} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            
                            {/* Section: Order Information */}
                            <div style={{ background: 'var(--color-bg)', padding: '20px', borderRadius: '14px', border: '1px solid var(--color-border)' }}>
                                <h4 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '16px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    <ShoppingCart size={15} /> Order Information
                                </h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Supplier *</label>
                                        <select 
                                            className="input-field" 
                                            style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: '#ffffff' }}
                                            value={supplierId}
                                            onChange={(e) => setSupplierId(e.target.value)}
                                        >
                                            <option value="">Select Supplier</option>
                                            {activeSuppliers.map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Status</label>
                                        <select 
                                            className="input-field" 
                                            style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: '#ffffff' }}
                                            value={status}
                                            onChange={(e) => setStatus(e.target.value as any)}
                                        >
                                            <option value="Draft">Draft</option>
                                            <option value="Sent">Sent</option>
                                            <option value="Received">Received</option>
                                            <option value="Cancelled">Cancelled</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Section: Schedule & Dates */}
                            <div style={{ background: 'var(--color-bg)', padding: '20px', borderRadius: '14px', border: '1px solid var(--color-border)' }}>
                                <h4 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '16px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    <Clock size={15} /> Schedule & Dates
                                </h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Order Date *</label>
                                        <input type="date" className="input-field" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: '#ffffff' }} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Expected Delivery</label>
                                        <input type="date" className="input-field" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: '#ffffff' }} value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Payment Due Date</label>
                                        <input type="date" className="input-field" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: '#ffffff' }} value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
                                    </div>
                                </div>
                            </div>

                            {/* Section: Reference & Notes */}
                            <div style={{ background: 'var(--color-bg)', padding: '20px', borderRadius: '14px', border: '1px solid var(--color-border)' }}>
                                <h4 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '16px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    <FileSignature size={15} /> Reference & Notes
                                </h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Invoice Number</label>
                                        <input type="text" className="input-field" placeholder="e.g. INV-2026-001" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: '#ffffff', fontFamily: 'monospace' }} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Notes</label>
                                        <input type="text" className="input-field" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: '#ffffff' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." />
                                    </div>
                                </div>
                            </div>

                            {/* Section: Line Items */}
                            <div style={{ background: 'var(--color-bg)', padding: '20px', borderRadius: '14px', border: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                    <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
                                        <Package size={15} /> Line Items
                                        <span style={{ background: 'var(--color-primary)', color: 'white', padding: '1px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700, marginLeft: '4px' }}>{lines.length}</span>
                                    </h4>
                                    <button 
                                        className="primary-button" 
                                        onClick={addLine} 
                                        style={{ padding: '7px 14px', fontSize: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}
                                    >
                                        <Plus size={14} /> Add Product
                                    </button>
                                </div>
                                <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--color-border)', background: '#ffffff' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ background: 'rgba(0,0,0,0.025)' }}>
                                                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', width: '36px', borderBottom: '1px solid var(--color-border)' }}>#</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--color-border)' }}>Product</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'right', width: '80px', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--color-border)' }}>Qty</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'right', width: '120px', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--color-border)' }}>Unit Cost</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'right', width: '120px', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--color-border)' }}>Subtotal</th>
                                                <th style={{ padding: '10px 12px', width: '40px', borderBottom: '1px solid var(--color-border)' }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {lines.map((line, index) => (
                                                <tr key={index} style={{ borderBottom: index < lines.length - 1 ? '1px solid var(--color-border)' : undefined, background: index % 2 === 1 ? 'rgba(0,0,0,0.01)' : undefined }}>
                                                    <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{index + 1}</td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <select className="input-field" style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', fontSize: '13px', border: '1px solid var(--color-border)' }} value={line.product_id} onChange={(e) => updateLine(index, 'product_id', e.target.value)}>
                                                            <option value="">Select product...</option>
                                                            {products.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                                                        </select>
                                                    </td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <input type="number" className="input-field" style={{ width: '100%', padding: '8px 10px', textAlign: 'right', borderRadius: '8px', fontSize: '13px', border: '1px solid var(--color-border)' }} value={line.quantity || ''} min="1" onChange={(e) => updateLine(index, 'quantity', parseInt(e.target.value) || 0)} />
                                                    </td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <input type="number" className="input-field" style={{ width: '100%', padding: '8px 10px', textAlign: 'right', borderRadius: '8px', fontSize: '13px', border: '1px solid var(--color-border)' }} value={line.unit_price === 0 && line.product_id === '' ? '' : line.unit_price} min="0" step="0.01" onChange={(e) => updateLine(index, 'unit_price', parseFloat(e.target.value) || 0)} />
                                                    </td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>
                                                        {formatCurrency((line.quantity || 0) * (line.unit_price || 0))}
                                                    </td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                                        <button 
                                                            onClick={() => removeLine(index)} 
                                                            disabled={lines.length <= 1} 
                                                            style={{ 
                                                                background: lines.length > 1 ? 'rgba(239,68,68,0.08)' : 'transparent', 
                                                                border: 'none', 
                                                                cursor: lines.length > 1 ? 'pointer' : 'not-allowed', 
                                                                color: lines.length > 1 ? '#ef4444' : 'var(--color-text-muted)', 
                                                                padding: '5px', borderRadius: '6px', transition: 'all 0.2s',
                                                            }}
                                                        >
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

                        {/* Modal Footer */}
                        <div style={{ padding: '18px 28px', borderTop: '2px solid var(--color-border)', background: 'linear-gradient(135deg, rgba(99,102,241,0.03), rgba(139,92,246,0.03))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Order Total</span>
                                <span style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-primary)', letterSpacing: '-0.5px' }}>{formatCurrency(totalAmount)}</span>
                                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', background: 'var(--color-bg)', padding: '3px 10px', borderRadius: '12px', fontWeight: 600 }}>{lines.length} item{lines.length !== 1 ? 's' : ''}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600, fontSize: '14px' }}>Cancel</button>
                                <button className="primary-button" onClick={handleSave} disabled={!isFormValid} style={{ padding: '10px 24px', borderRadius: '10px', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <CheckCircle2 size={16} /> {editingPOId ? 'Update Order' : 'Create Order'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Payment Modal */}
            {isPaymentModalOpen && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px'
                }}>
                    <div style={{
                        background: '#ffffff',
                        borderRadius: '24px',
                        width: '100%',
                        maxWidth: '520px',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
                        overflow: 'hidden',
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                    }}>
                        {/* Payment Header */}
                        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(16,185,129,0.04), rgba(52,211,153,0.04))' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #10b981, #34d399)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                    <DollarSign size={18} />
                                </div>
                                <div>
                                    <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>Record Payment</h2>
                                    <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '1px 0 0 0' }}>Supplier payment recording</p>
                                </div>
                            </div>
                            <button onClick={() => setIsPaymentModalOpen(false)} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* Remaining Balance Display */}
                            {payingPORemaining > 0 && (
                                <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)', borderRadius: '12px', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Remaining Balance</span>
                                    <span style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>{formatCurrency(payingPORemaining)}</span>
                                </div>
                            )}

                            {/* Amount Input */}
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Amount to Pay *</label>
                                <input type="number" className="input-field" style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', fontSize: '16px', fontWeight: 600, border: '1px solid var(--color-border)' }} value={paymentAmount} onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || '')} min="0" step="0.01" />
                                {payingPORemaining > 0 && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '10px' }}>
                                        {[
                                            { label: 'Full', pct: 1, color: '#10b981' },
                                            { label: '75%', pct: 0.75, color: '#3b82f6' },
                                            { label: '50%', pct: 0.5, color: '#f59e0b' },
                                            { label: '25%', pct: 0.25, color: '#8b5cf6' },
                                        ].map(btn => (
                                            <button 
                                                key={btn.label}
                                                onClick={() => setPaymentAmount(Math.round(payingPORemaining * btn.pct * 100) / 100)} 
                                                style={{ 
                                                    padding: '8px 6px', fontSize: '12px', fontWeight: 700, border: '1px solid var(--color-border)', borderRadius: '8px',
                                                    background: Number(paymentAmount) === Math.round(payingPORemaining * btn.pct * 100) / 100 ? btn.color : 'var(--color-bg)',
                                                    color: Number(paymentAmount) === Math.round(payingPORemaining * btn.pct * 100) / 100 ? 'white' : btn.color,
                                                    cursor: 'pointer', transition: 'all 0.2s',
                                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                                                }}
                                            >
                                                <span>{btn.label}</span>
                                                <span style={{ fontSize: '10px', opacity: 0.8 }}>{formatCurrency(Math.round(payingPORemaining * btn.pct * 100) / 100)}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Date & Method */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Payment Date *</label>
                                    <input type="date" className="input-field" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)' }} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Method</label>
                                    <select className="input-field" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)' }} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                                        <option value="Cash">Cash</option>
                                        <option value="Bank Transfer">Bank Transfer</option>
                                        <option value="On Credit">On Credit</option>
                                    </select>
                                </div>
                            </div>

                            {/* Notes */}
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Notes</label>
                                <textarea className="input-field" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', minHeight: '60px', fontSize: '14px', border: '1px solid var(--color-border)', resize: 'vertical' }} value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Optional payment notes..." />
                            </div>
                        </div>

                        {/* Payment Footer */}
                        <div style={{ padding: '18px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: 'rgba(0,0,0,0.01)' }}>
                            <button className="secondary-button" onClick={() => setIsPaymentModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600 }}>Cancel</button>
                            <button className="primary-button" onClick={handleSavePayment} disabled={!paymentAmount || paymentAmount <= 0} style={{ padding: '10px 24px', borderRadius: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <CheckCircle2 size={16} /> Record Payment
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            <style>
                {`
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px) scale(0.98); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                `}
            </style>
        </div>
    );
};

export default PurchaseOrdersPage;
