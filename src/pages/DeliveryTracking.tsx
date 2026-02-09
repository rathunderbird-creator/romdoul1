import React, { useState, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { Search, X, Settings, Truck, Clock, Package, ChevronLeft, ChevronRight, Printer, Edit, Eye } from 'lucide-react';
import type { Sale } from '../types';
import { ReceiptModal, StatusBadge, DateRangePicker } from '../components';

const DeliveryTracking: React.FC = () => {
    const { sales, updateOrderStatus, updateOrder } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Delivery Tracking</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage shipments and tracking</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Shipped'>('All');

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
        { id: 'shippingCo', label: 'Shipping Co.' },
        { id: 'tracking', label: 'Tracking ID' },
        { id: 'deliveryMan', label: 'Delivery Man' },
        { id: 'status', label: 'Ship Status' },
        { id: 'cost', label: 'Cost' },
        { id: 'remark', label: 'Remark' },
    ];
    // Default visible
    const [visibleColumns, setVisibleColumns] = useState<string[]>([
        'actions', 'date', 'customer', 'phone', 'address', 'items', 'shippingCo', 'tracking', 'deliveryMan', 'status', 'cost', 'remark'
    ]);

    const [formData, setFormData] = useState({
        company: '',
        trackingNumber: '',
        cost: 0,
        staffName: '',
        status: 'Pending' as 'Pending' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned'
    });


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

    // Filter Logic:
    // Only show orders where Shipping Status is 'Pending' or 'Shipped'
    const trackingOrders = useMemo(() => {
        return sales.filter(order => {
            // PRIMARY FILTER: Must be Pending or Shipped
            const currentStatus = order.shipping?.status || 'Pending';
            if (currentStatus === 'Delivered' || currentStatus === 'Cancelled') return false;

            const lowerTerm = searchTerm.toLowerCase();
            const matchesSearch =
                order.customer?.name.toLowerCase().includes(lowerTerm) ||
                order.id.toLowerCase().includes(lowerTerm) ||
                (order.customer?.phone || '').includes(lowerTerm) ||
                (order.customer?.address || '').toLowerCase().includes(lowerTerm) ||
                (order.customer?.city || '').toLowerCase().includes(lowerTerm) ||
                (order.customer?.page || '').toLowerCase().includes(lowerTerm) ||
                order.items.some(item => item.name.toLowerCase().includes(lowerTerm) || (item.model && item.model.toLowerCase().includes(lowerTerm))) ||
                (order.shipping?.trackingNumber || '').toLowerCase().includes(lowerTerm) ||
                (order.shipping?.company || '').toLowerCase().includes(lowerTerm) ||
                (order.shipping?.staffName || '').toLowerCase().includes(lowerTerm) ||
                (order.shipping?.cost || 0).toString().includes(lowerTerm) ||
                (order.remark || '').toLowerCase().includes(lowerTerm);

            const matchesStatus = statusFilter === 'All' || currentStatus === statusFilter;

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
        const pendingCount = trackingOrders.filter(o => (o.shipping?.status || 'Pending') === 'Pending').length;
        const shippedCount = trackingOrders.filter(o => o.shipping?.status === 'Shipped').length;
        const totalItems = trackingOrders.length;
        const totalCost = trackingOrders.reduce((sum, order) => sum + (order.shipping?.cost || 0), 0);

        return {
            pendingCount,
            shippedCount,
            totalItems,
            totalCost
        };
    }, [trackingOrders]);



    const handleUpdateShipping = () => {
        if (!selectedOrder) return;

        // Update shipping info
        // We need to use updateOrder to update the shipping object entirely or careful partial update
        // But StoreContext has updateOrderStatus separately. Let's use updateOrder for full shipping object.
        const updatedShipping = {
            company: formData.company,
            trackingNumber: formData.trackingNumber,
            status: formData.status,
            cost: formData.cost,
            staffName: formData.staffName
        };

        updateOrder(selectedOrder.id, { shipping: updatedShipping });
        showToast('Shipping details updated', 'success');
        setIsEditModalOpen(false);
    };

    const handleOpenEdit = (order: Sale) => {
        setSelectedOrder(order);
        setFormData({
            company: order.shipping?.company || '',
            trackingNumber: order.shipping?.trackingNumber || '',
            cost: order.shipping?.cost || 0,
            staffName: order.shipping?.staffName || '',
            status: order.shipping?.status || 'Pending'
        });
        setIsEditModalOpen(true);
    };



    const StatusStepper = ({ currentStatus }: { currentStatus: string }) => {
        const steps = ['Pending', 'Shipped', 'Delivered'];
        const currentIdx = steps.indexOf(currentStatus);
        const isCancelled = currentStatus === 'Cancelled';

        if (isCancelled) {
            return (
                <div style={{ padding: '24px', background: '#FEF2F2', borderRadius: '12px', border: '1px solid #FECACA', display: 'flex', alignItems: 'center', gap: '12px', color: '#DC2626' }}>
                    <div style={{ padding: '8px', background: 'white', borderRadius: '50%' }}><X size={24} /></div>
                    <div>
                        <h4 style={{ fontWeight: 'bold' }}>Order Cancelled</h4>
                        <p style={{ fontSize: '13px', opacity: 0.8 }}>This shipment has been cancelled.</p>
                    </div>
                </div>
            );
        }

        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', marginBottom: '12px', marginTop: '12px' }}>
                {/* Connecting Line */}
                <div style={{ position: 'absolute', left: '0', right: '0', top: '16px', height: '4px', background: '#F3F4F6', zIndex: 0 }}>
                    <div style={{
                        height: '100%',
                        background: 'var(--color-primary)',
                        width: `${(currentIdx / (steps.length - 1)) * 100}% `,
                        transition: 'width 0.3s ease'
                    }} />
                </div>

                {steps.map((step, idx) => {
                    const isCompleted = idx <= currentIdx;
                    const isCurrent = idx === currentIdx;
                    return (
                        <div key={step} style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                                width: '36px', height: '36px', borderRadius: '50%',
                                background: isCompleted ? 'var(--color-primary)' : '#F3F4F6',
                                border: isCurrent ? '4px solid var(--color-primary-light)' : '4px solid white',
                                color: isCompleted ? 'white' : '#9CA3AF',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.3s ease',
                                boxShadow: isCurrent ? '0 0 0 2px var(--color-primary)' : 'none'
                            }}>
                                {idx === 0 && <Clock size={16} />}
                                {idx === 1 && <Truck size={16} />}
                                {idx === 2 && <Package size={16} />}
                            </div>
                            <span style={{
                                fontSize: '13px',
                                fontWeight: isCurrent ? 700 : 500,
                                color: isCompleted ? 'var(--color-text-main)' : 'var(--color-text-muted)'
                            }}>{step}</span>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div>




            {/* Filters */}
            <div className="glass-panel" style={{ marginBottom: '12px', padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', position: 'relative', zIndex: 50 }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                    <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                    <input
                        type="text"
                        placeholder="Search customer, phone, tracking..."
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
                        <option value="Pending" style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>Pending</option>
                        <option value="Shipped" style={{ backgroundColor: '#DBEAFE', color: '#2563EB' }}>Shipped</option>
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
            <div className="glass-panel" style={{ overflow: 'visible', maxHeight: 'calc(100vh - 260px)' }}> {/* changed overflow to visible for dropdowns if needed, or better keep auto but manage dropdown z-index/portal */}
                {/* Reverting to auto for scrolling, custom dropdown handles inline */}
                <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
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
                                {visibleColumns.includes('shippingCo') && <th>Shipping Co.</th>}
                                {visibleColumns.includes('tracking') && <th>Tracking ID</th>}
                                {visibleColumns.includes('deliveryMan') && <th>Delivery Man</th>}
                                {visibleColumns.includes('status') && <th>Ship Status</th>}
                                {visibleColumns.includes('cost') && <th>Cost</th>}
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
                                                <button onClick={() => handleOpenEdit(order)} className="icon-button" title="Edit Shipping" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
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
                                            {order.items.map(i => `${i.name} x${i.quantity} `).join(', ')}
                                        </div>
                                    </td>}
                                    {visibleColumns.includes('shippingCo') && <td>{order.shipping?.company || '-'}</td>}
                                    {visibleColumns.includes('tracking') && <td style={{ fontFamily: 'monospace' }}>
                                        {order.shipping?.trackingNumber ? (
                                            <span style={{ background: '#F3F4F6', padding: '2px 6px', borderRadius: '4px' }}>{order.shipping.trackingNumber}</span>
                                        ) : '-'}
                                    </td>}
                                    {visibleColumns.includes('deliveryMan') && <td>{order.shipping?.staffName || '-'}</td>}
                                    {visibleColumns.includes('status') && <td>
                                        <StatusBadge
                                            status={order.shipping?.status || 'Pending'}
                                            onChange={(newStatus) => updateOrderStatus(order.id, newStatus as 'Pending' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned')}
                                        />
                                    </td>}
                                    {visibleColumns.includes('cost') && <td style={{ textAlign: 'right' }}>${(order.shipping?.cost || 0).toFixed(2)}</td>}
                                    {visibleColumns.includes('remark') && <td>{order.remark || '-'}</td>}
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                {visibleColumns.map((colId, index) => {
                                    if (colId === 'cost') return <td key={colId} style={{ fontWeight: 'bold', textAlign: 'right', color: 'var(--color-red)', padding: '6px 10px', fontSize: '12px' }}>${stats.totalCost.toFixed(2)}</td>;
                                    if (index === 0) return <td key={colId} style={{ fontWeight: 'bold', padding: '6px 10px', fontSize: '12px' }}>Total ({stats.totalItems})</td>;
                                    return <td key={colId}></td>;
                                })}
                            </tr>
                        </tfoot>
                    </table>
                </div>
                {trackingOrders.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No Pending or Shipped orders found.</div>}
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

            {/* Edit Shipping Modal */}
            {
                isEditModalOpen && selectedOrder && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                        <div className="glass-panel" style={{ width: '500px', padding: '32px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Update Shipping</h2>
                                <button onClick={() => setIsEditModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={24} /></button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Shipping Co.</label>
                                        <input type="text" className="search-input" style={{ width: '100%' }} value={formData.company} onChange={e => setFormData({ ...formData, company: e.target.value })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Tracking Number</label>
                                        <input type="text" className="search-input" style={{ width: '100%' }} value={formData.trackingNumber} onChange={e => setFormData({ ...formData, trackingNumber: e.target.value })} />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Delivery Man</label>
                                        <input type="text" className="search-input" style={{ width: '100%' }} value={formData.staffName} onChange={e => setFormData({ ...formData, staffName: e.target.value })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Shipping Cost ($)</label>
                                        <input type="number" className="search-input" style={{ width: '100%' }} value={formData.cost} onChange={e => setFormData({ ...formData, cost: Number(e.target.value) })} />
                                    </div>
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Status</label>
                                    <select className="search-input" style={{ width: '100%' }} value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value as 'Pending' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned' })}>
                                        <option value="Pending">Pending</option>
                                        <option value="Shipped">Shipped</option>
                                        <option value="Delivered">Delivered</option>
                                        <option value="Cancelled">Cancelled</option>
                                    </select>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                                    <button onClick={() => setIsEditModalOpen(false)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                    <button onClick={handleUpdateShipping} className="primary-button" style={{ padding: '8px 24px' }}>Save Changes</button>
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
                                <div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Tracking Order</div>
                                    <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>#{selectedOrder.id.slice(-6)}</h2>
                                </div>
                                <button onClick={() => setIsViewModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={24} /></button>
                            </div>

                            <StatusStepper currentStatus={selectedOrder.shipping?.status || 'Pending'} />

                            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '24px' }}>
                                <div>
                                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Truck size={18} /> Shipment Details
                                    </h3>
                                    <div style={{ background: 'var(--color-surface-hover)', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                            <div>
                                                <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>Tracking Number</label>
                                                <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>{selectedOrder.shipping?.trackingNumber || 'N/A'}</div>
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>Shipping Co.</label>
                                                <div>{selectedOrder.shipping?.company || 'N/A'}</div>
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>Delivery Staff</label>
                                                <div>{selectedOrder.shipping?.staffName || 'Unassigned'}</div>
                                            </div>
                                            <div>
                                                <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>Est. Cost</label>
                                                <div>${(selectedOrder.shipping?.cost || 0).toFixed(2)}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Customer</h3>
                                    <div style={{ marginBottom: '16px' }}>
                                        <div style={{ fontWeight: 600 }}>{selectedOrder.customer?.name}</div>
                                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{selectedOrder.customer?.phone}</div>
                                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>{selectedOrder.customer?.address}</div>
                                    </div>
                                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>Items</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {selectedOrder.items.map((item, idx) => (
                                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                                <span>{item.name} <span style={{ color: 'var(--color-text-muted)' }}>x{item.quantity}</span></span>
                                                <span>${(item.price * item.quantity).toFixed(2)}</span>
                                            </div>
                                        ))}
                                        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '8px', marginTop: '8px', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                                            <span>Total</span>
                                            <span>${selectedOrder.total.toFixed(2)}</span>
                                        </div>
                                    </div>
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

export default DeliveryTracking;
