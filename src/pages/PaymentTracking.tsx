import React, { useState, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { Search, X, Settings, ChevronLeft, ChevronRight, Printer, Edit, Eye } from 'lucide-react';
import type { Sale } from '../types';
import { PaymentStatusBadge, DateRangePicker, ReceiptModal } from '../components';
const PaymentTracking: React.FC = () => {
    const { sales, updateOrder } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Payment Tracking</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Track payments and settlements</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [statusFilter, setStatusFilter] = useState<'All' | 'Paid' | 'Unpaid' | 'Settle' | 'Not Settle' | 'Cancel'>('All');

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === trackingOrders.length && trackingOrders.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(trackingOrders.map(o => o.id)));
        }
    };

    const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null);
    const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    // Column Visibility
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const allColumns = [
        { id: 'actions', label: 'Actions' },
        { id: 'date', label: 'Date' },
        { id: 'customer', label: 'Customer' },
        { id: 'phone', label: 'Phone' },
        { id: 'address', label: 'Address' },
        { id: 'items', label: 'Products' },
        { id: 'total', label: 'Total' },
        { id: 'payBy', label: 'Pay By' },
        { id: 'received', label: 'Received' },
        { id: 'remaining', label: 'Remaining' },
        { id: 'status', label: 'Pay Status' },
        { id: 'settleDate', label: 'Settle Date' },
        { id: 'remark', label: 'Remark' },
    ];
    // Default visible
    const [visibleColumns, setVisibleColumns] = useState<string[]>([
        'actions', 'date', 'customer', 'phone', 'address', 'items', 'total', 'payBy', 'received', 'remaining', 'status', 'settleDate', 'remark'
    ]);

    const [formData, setFormData] = useState({
        amountReceived: 0,
        settleDate: '',
        paymentStatus: 'Paid' as 'Paid' | 'Unpaid' | 'Settle' | 'Not Settle' | 'Cancel'
    });


    // Filter Logic:
    // Only show orders where Shipping Status is 'Delivered'
    const trackingOrders = useMemo(() => {
        return sales.filter(order => {
            // PRIMARY FILTER: Must be Delivered
            if (order.shipping?.status !== 'Delivered') return false;

            const lowerTerm = searchTerm.toLowerCase();
            const matchesSearch =
                order.customer?.name.toLowerCase().includes(lowerTerm) ||
                order.id.toLowerCase().includes(lowerTerm) ||
                (order.customer?.phone || '').includes(lowerTerm) ||
                (order.customer?.address || '').toLowerCase().includes(lowerTerm) ||
                (order.customer?.city || '').toLowerCase().includes(lowerTerm) ||
                (order.customer?.page || '').toLowerCase().includes(lowerTerm) ||
                order.items.some(item => item.name.toLowerCase().includes(lowerTerm) || (item.model && item.model.toLowerCase().includes(lowerTerm))) ||
                order.total.toString().includes(lowerTerm) ||
                (order.amountReceived || 0).toString().includes(lowerTerm) ||
                ((order.total - (order.amountReceived || 0)).toString()).includes(lowerTerm) ||
                order.paymentMethod.toLowerCase().includes(lowerTerm) ||
                (order.remark || '').toLowerCase().includes(lowerTerm);

            const matchesStatus = statusFilter === 'All' || order.paymentStatus === statusFilter;

            let matchesDate = true;
            if (dateRange.start && dateRange.end) {
                const orderDate = new Date(order.date);
                const start = new Date(dateRange.start);
                const end = new Date(dateRange.end);
                end.setHours(23, 59, 59, 999);
                matchesDate = orderDate >= start && orderDate <= end;
            }

            return matchesSearch && matchesStatus && matchesDate;
        });
    }, [sales, searchTerm, statusFilter, dateRange]);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(50);

    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, statusFilter, dateRange, itemsPerPage]);

    const paginatedOrders = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return trackingOrders.slice(start, start + itemsPerPage);
    }, [trackingOrders, currentPage, itemsPerPage]);

    // Calculate Totals
    const stats = useMemo(() => {
        const totalOrders = trackingOrders.length;
        const totalRevenue = trackingOrders.reduce((sum, order) => sum + order.total, 0);
        const totalReceived = trackingOrders.reduce((sum, order) => sum + (order.amountReceived || (order.paymentStatus === 'Paid' ? order.total : 0)), 0);
        const totalOutstanding = totalRevenue - totalReceived;

        return {
            totalOrders,
            totalRevenue,
            totalReceived,
            totalOutstanding
        };
    }, [trackingOrders]);



    const handleUpdatePayment = () => {
        if (!selectedOrder) return;
        updateOrder(selectedOrder.id, {
            amountReceived: formData.amountReceived,
            settleDate: formData.settleDate,
            paymentStatus: formData.paymentStatus
        });
        showToast('Payment details updated', 'success');
        setIsEditModalOpen(false);
    };

    const handleOpenEdit = (order: Sale) => {
        setSelectedOrder(order);
        setFormData({
            amountReceived: order.amountReceived || 0,
            settleDate: order.settleDate || '',
            paymentStatus: order.paymentStatus || 'Paid'
        });
        setIsEditModalOpen(true);
    };



    return (
        <div>




            {/* Filters */}
            <div className="glass-panel" style={{ marginBottom: '12px', padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', position: 'relative', zIndex: 50 }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                    <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                    <input
                        type="text"
                        placeholder="Search customer, phone..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="search-input"
                        style={{ paddingLeft: '36px' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as any)}
                        className="search-input"
                        style={{ width: '130px' }}
                    >
                        <option value="All">All Status</option>
                        <option value="Paid" style={{ backgroundColor: '#D1FAE5', color: '#059669' }}>Paid</option>
                        <option value="Unpaid" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>Unpaid</option>
                        <option value="Partial" style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>Partial</option>
                        <option value="Settle" style={{ backgroundColor: '#E0E7FF', color: '#4F46E5' }}>Settle</option>
                        <option value="Not Settle" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>Not Settle</option>
                    </select>
                    <DateRangePicker value={dateRange} onChange={setDateRange} />

                    <button
                        onClick={() => {
                            setSearchTerm('');
                            setStatusFilter('All');
                            setDateRange({ start: '', end: '' });
                        }}
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-secondary)', cursor: 'pointer',
                            fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px'
                        }}
                        title="Clear Filters"
                    >
                        <X size={16} /> Clear
                    </button>
                </div>

                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setShowColumnMenu(!showColumnMenu)}
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px'
                        }}
                    >
                        <Settings size={18} />
                        Columns
                    </button>
                    {showColumnMenu && (
                        <div className="glass-panel" style={{
                            position: 'absolute', top: '100%', right: 0, marginTop: '8px',
                            padding: '16px', width: '200px', zIndex: 100, maxHeight: '300px', overflowY: 'auto',
                            display: 'flex', flexDirection: 'column', gap: '8px'
                        }}>
                            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Toggle Columns</h4>
                            {allColumns.map(col => (
                                <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={visibleColumns.includes(col.id)}
                                        onChange={() => {
                                            if (visibleColumns.includes(col.id)) {
                                                setVisibleColumns(visibleColumns.filter(c => c !== col.id));
                                            } else {
                                                setVisibleColumns([...visibleColumns, col.id]);
                                            }
                                        }}
                                    />
                                    {col.label}
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="glass-panel" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
                <table className="spreadsheet-table">
                    <thead>
                        <tr>
                            <th style={{ width: '40px', textAlign: 'center' }} className="sticky-col-first">
                                <input
                                    type="checkbox"
                                    checked={trackingOrders.length > 0 && selectedIds.size === trackingOrders.length}
                                    onChange={toggleSelectAll}
                                    style={{ cursor: 'pointer' }}
                                />
                            </th>
                            {visibleColumns.includes('actions') && <th className="sticky-col-second">Actions</th>}
                            {visibleColumns.includes('date') && <th>Date</th>}
                            {visibleColumns.includes('customer') && <th>Customer</th>}
                            {visibleColumns.includes('phone') && <th>Phone</th>}
                            {visibleColumns.includes('address') && <th>Address</th>}
                            {visibleColumns.includes('items') && <th>Products</th>}
                            {visibleColumns.includes('total') && <th>Total</th>}
                            {visibleColumns.includes('payBy') && <th>Pay By</th>}
                            {visibleColumns.includes('received') && <th>Received</th>}
                            {visibleColumns.includes('remaining') && <th>Remaining</th>}
                            {visibleColumns.includes('status') && <th>Status</th>}
                            {visibleColumns.includes('settleDate') && <th>Settle Date</th>}
                            {visibleColumns.includes('remark') && <th>Remark</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedOrders.map((order) => (
                            <tr key={order.id} className={selectedIds.has(order.id) ? 'selected' : ''}>
                                <td style={{ textAlign: 'center' }} className="sticky-col-first">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(order.id)}
                                        onChange={() => toggleSelection(order.id)}
                                        style={{ cursor: 'pointer' }}
                                    />
                                </td>
                                {visibleColumns.includes('actions') &&
                                    <td className="sticky-col-second">
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button onClick={() => setReceiptSale(order)} className="icon-button" title="Print Receipt" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                <Printer size={16} color="var(--color-text-secondary)" />
                                            </button>
                                            <button onClick={() => { setSelectedOrder(order); setIsViewModalOpen(true); }} className="icon-button" title="View Details" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                <Eye size={16} color="var(--color-text-secondary)" />
                                            </button>
                                            <button onClick={() => handleOpenEdit(order)} className="icon-button" title="Edit Payment" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                <Edit size={16} color="var(--color-text-secondary)" />
                                            </button>
                                        </div>
                                    </td>
                                }
                                {visibleColumns.includes('date') && <td>{new Date(order.date).toLocaleDateString()}</td>}
                                {visibleColumns.includes('customer') && <td style={{ fontWeight: 500 }}>{order.customer?.name}</td>}
                                {visibleColumns.includes('phone') && <td style={{ color: 'var(--color-text-secondary)' }}>{order.customer?.phone}</td>}
                                {visibleColumns.includes('address') && <td style={{ color: 'var(--color-text-secondary)' }}>{order.customer?.address || '-'}</td>}
                                {visibleColumns.includes('items') && <td>
                                    <div style={{ fontSize: '12px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {order.items.map(i => `${i.name} x${i.quantity}`).join(', ')}
                                    </div>
                                </td>}
                                {visibleColumns.includes('total') && <td style={{ fontWeight: 'bold', textAlign: 'right' }}>${order.total.toFixed(2)}</td>}
                                {visibleColumns.includes('payBy') && <td>{order.paymentMethod}</td>}
                                {visibleColumns.includes('received') && <td style={{ textAlign: 'right' }}>${(order.amountReceived || order.total).toFixed(2)}</td>}
                                {visibleColumns.includes('remaining') && <td style={{ color: (order.total - (order.amountReceived || 0)) > 0 ? '#DC2626' : '#059669', fontWeight: 600, textAlign: 'right' }}>
                                    ${(order.total - (order.amountReceived || (order.paymentStatus === 'Paid' ? order.total : 0))).toFixed(2)}
                                </td>}
                                {visibleColumns.includes('status') && <td>
                                    <PaymentStatusBadge
                                        status={order.paymentStatus || 'Paid'}
                                        onChange={(newStatus) => updateOrder(order.id, { paymentStatus: newStatus as 'Paid' | 'Unpaid' | 'Settle' | 'Not Settle' | 'Cancel' })}
                                    />
                                </td>}
                                {visibleColumns.includes('settleDate') && <td>{order.settleDate || '-'}</td>}
                                {visibleColumns.includes('remark') && <td>{order.remark || '-'}</td>}
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            {visibleColumns.map((colId, index) => {
                                if (colId === 'total') return <td key={colId} style={{ fontWeight: 'bold', textAlign: 'right', padding: '6px 10px', fontSize: '12px' }}>${stats.totalRevenue.toFixed(2)}</td>;
                                if (colId === 'received') return <td key={colId} style={{ fontWeight: '700', color: 'var(--color-green)', textAlign: 'right', padding: '6px 10px', fontSize: '12px' }}>${stats.totalReceived.toFixed(2)}</td>;
                                if (colId === 'remaining') return <td key={colId} style={{ fontWeight: '700', color: stats.totalOutstanding > 0 ? 'var(--color-red)' : 'var(--color-green)', textAlign: 'right', padding: '6px 10px', fontSize: '12px' }}>${stats.totalOutstanding.toFixed(2)}</td>;
                                if (index === 0) return <td key={colId} style={{ fontWeight: 'bold', padding: '6px 10px', fontSize: '12px' }}>Total ({stats.totalOrders})</td>;
                                return <td key={colId}></td>;
                            })}
                        </tr>
                    </tfoot>
                </table>
                {trackingOrders.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No Delivered orders found.</div>}
            </div>

            {trackingOrders.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', padding: '0', position: 'relative' }}>
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                        Showing {Math.min((currentPage - 1) * itemsPerPage + 1, trackingOrders.length)} to {Math.min(currentPage * itemsPerPage, trackingOrders.length)} of {trackingOrders.length} entries
                    </div>



                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            <span>Rows per page:</span>
                            <select
                                value={itemsPerPage}
                                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                                style={{
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--color-border)',
                                    background: 'var(--color-surface)',
                                    color: 'var(--color-text-main)',
                                    fontSize: '13px',
                                    outline: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value={10}>10</option>
                                <option value={20}>20</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                            </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                style={{
                                    padding: '6px', borderRadius: '6px', border: '1px solid var(--color-border)',
                                    background: currentPage === 1 ? 'var(--color-bg)' : 'var(--color-surface)',
                                    color: currentPage === 1 ? 'var(--color-text-muted)' : 'var(--color-text-main)',
                                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                                Page <span style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>{currentPage}</span> of {Math.ceil(trackingOrders.length / itemsPerPage)}
                            </span>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(Math.ceil(trackingOrders.length / itemsPerPage), p + 1))}
                                disabled={currentPage === Math.ceil(trackingOrders.length / itemsPerPage)}
                                style={{
                                    padding: '6px', borderRadius: '6px', border: '1px solid var(--color-border)',
                                    background: currentPage === Math.ceil(trackingOrders.length / itemsPerPage) ? 'var(--color-bg)' : 'var(--color-surface)',
                                    color: currentPage === Math.ceil(trackingOrders.length / itemsPerPage) ? 'var(--color-text-muted)' : 'var(--color-text-main)',
                                    cursor: currentPage === Math.ceil(trackingOrders.length / itemsPerPage) ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Payment Modal */}
            {
                isEditModalOpen && selectedOrder && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                        <div className="glass-panel" style={{ width: '400px', padding: '32px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Update Payment</h2>
                                <button onClick={() => setIsEditModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={24} /></button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Amount Received ($)</label>
                                    <input type="number" className="search-input" style={{ width: '100%' }} value={formData.amountReceived} onChange={e => setFormData({ ...formData, amountReceived: Number(e.target.value) })} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Settle Date</label>
                                    <input type="date" className="search-input" style={{ width: '100%' }} value={formData.settleDate} onChange={e => setFormData({ ...formData, settleDate: e.target.value })} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Status</label>
                                    <select className="search-input" style={{ width: '100%' }} value={formData.paymentStatus} onChange={e => setFormData({ ...formData, paymentStatus: e.target.value as 'Paid' | 'Unpaid' | 'Settle' | 'Not Settle' | 'Cancel' })}>
                                        <option value="Paid">Paid</option>
                                        <option value="Unpaid">Unpaid</option>
                                        <option value="Settle">Settle</option>
                                        <option value="Not Settle">Not Settle</option>
                                        <option value="Cancel">Cancel</option>
                                    </select>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                                    <button onClick={() => setIsEditModalOpen(false)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                    <button onClick={handleUpdatePayment} className="primary-button" style={{ padding: '8px 24px' }}>Save</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* View Order Modal */}
            {
                isViewModalOpen && selectedOrder && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                        <div className="glass-panel" style={{ width: '600px', padding: '32px', maxHeight: '90vh', overflowY: 'auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Order Details</h2>
                                <button onClick={() => setIsViewModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={24} /></button>
                            </div>
                            {/* Simple view details */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                                <div>
                                    <strong>Customer:</strong> {selectedOrder.customer?.name} <br />
                                    {selectedOrder.customer?.phone} <br />
                                    {selectedOrder.customer?.address}
                                </div>
                                <div>
                                    <strong>Order Info:</strong> <br />
                                    ID: {selectedOrder.id} <br />
                                    Total: ${selectedOrder.total.toFixed(2)}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Receipt Modal */}
            {
                receiptSale && (
                    <ReceiptModal
                        sale={receiptSale}
                        onClose={() => setReceiptSale(null)}
                    />
                )
            }
        </div >
    );
};

export default PaymentTracking;
