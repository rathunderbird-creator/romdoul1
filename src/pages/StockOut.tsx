import React, { useState, useMemo, useEffect } from 'react';
import { ArrowUp, Search, Package, TrendingDown, Calendar, Minus, X, Truck, Edit2, Trash2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { supabase } from '../lib/supabase';
import { dispatchActivity } from '../utils/activityLogger';
import StatsCard from '../components/StatsCard';
import DateRangePicker from '../components/DateRangePicker';
import Modal from '../components/Modal';

interface StockOutRecord {
    id: string;
    product_id: string;
    product_name: string;
    quantity: number;
    reason: string;
    reference_id: string;
    note: string;
    shipping_co: string;
    movement_date: string;
    created_at: string;
    created_by: string;
}

const REASON_OPTIONS = [
    'Shipped',
    'Delivered',
    'Damaged',
    'Warranty Return',
    'Sample / Demo',
    'Lost',
    'Expired',
    'Other'
];

const StockOut: React.FC = () => {
    const { products, updateProduct, currentUser, shippingCompanies } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();

    const isAdmin = currentUser?.roleId === 'admin';

    const [records, setRecords] = useState<StockOutRecord[]>([]);
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Form state
    const [showForm, setShowForm] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState('');
    const [quantity, setQuantity] = useState<number | string>('');
    const [reason, setReason] = useState('Shipped');
    const [referenceId, setReferenceId] = useState('');
    const [note, setNote] = useState('');
    const [shippingCo, setShippingCo] = useState('');
    const [movementDate, setMovementDate] = useState(new Date().toISOString().slice(0, 10));
    const [productSearch, setProductSearch] = useState('');

    // Edit modal state
    const [editRecord, setEditRecord] = useState<StockOutRecord | null>(null);
    const [editQuantity, setEditQuantity] = useState<number | string>('');
    const [editReason, setEditReason] = useState('');
    const [editReferenceId, setEditReferenceId] = useState('');
    const [editNote, setEditNote] = useState('');
    const [editShippingCo, setEditShippingCo] = useState('');
    const [editDate, setEditDate] = useState('');

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Stock-Out</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Track inventory removals</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    // Fetch stock-out records
    const fetchRecords = async () => {
        setIsLoading(true);
        try {
            let query = supabase
                .from('stock_movements')
                .select('*')
                .eq('type', 'out')
                .order('movement_date', { ascending: false })
                .order('created_at', { ascending: false });

            if (dateRange.start) {
                query = query.gte('movement_date', dateRange.start);
            }
            if (dateRange.end) {
                query = query.lte('movement_date', dateRange.end);
            }
            if (!dateRange.start && !dateRange.end) {
                query = query.limit(200);
            }

            const { data, error } = await query;
            if (error) throw error;
            setRecords((data || []) as StockOutRecord[]);
        } catch (err) {
            console.error('Failed to fetch stock-out records:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRecords();
    }, [dateRange]);

    const filteredRecords = useMemo(() => {
        if (!searchTerm.trim()) return records;
        const q = searchTerm.trim().toLowerCase();
        return records.filter(r =>
            r.product_name.toLowerCase().includes(q) ||
            (r.reason || '').toLowerCase().includes(q) ||
            (r.reference_id || '').toLowerCase().includes(q) ||
            (r.shipping_co || '').toLowerCase().includes(q) ||
            (r.note || '').toLowerCase().includes(q)
        );
    }, [records, searchTerm]);

    const totalQuantityOut = useMemo(() => filteredRecords.reduce((sum, r) => sum + r.quantity, 0), [filteredRecords]);

    // Group by reason for stats
    const shippedCount = useMemo(() => filteredRecords.filter(r => r.reason === 'Shipped' || r.reason === 'Delivered').reduce((sum, r) => sum + r.quantity, 0), [filteredRecords]);

    const filteredProducts = useMemo(() => {
        if (!productSearch.trim()) return products.filter(p => p.stock > 0).slice(0, 20);
        const q = productSearch.trim().toLowerCase();
        return products.filter(p =>
            (p.name.toLowerCase().includes(q) ||
            (p.model || '').toLowerCase().includes(q)) && p.stock > 0
        ).slice(0, 20);
    }, [products, productSearch]);

    const selectedProduct = products.find(p => p.id === selectedProductId);

    const clearFilters = () => {
        setDateRange({ start: '', end: '' });
        setSearchTerm('');
    };

    const hasActiveFilters = dateRange.start || dateRange.end || searchTerm;

    const handleStockOut = async () => {
        if (!selectedProductId || !quantity || Number(quantity) <= 0) {
            showToast('Please select a product and enter a valid quantity', 'error');
            return;
        }

        const product = products.find(p => p.id === selectedProductId);
        if (!product) {
            showToast('Product not found', 'error');
            return;
        }

        if (Number(quantity) > product.stock) {
            showToast(`Cannot remove ${quantity} units. Only ${product.stock} in stock.`, 'error');
            return;
        }

        try {
            const newStock = product.stock - Number(quantity);
            await updateProduct(product.id, { stock: newStock });

            // Log the stock movement
            const { error } = await supabase.from('stock_movements').insert({
                product_id: product.id,
                product_name: product.name,
                type: 'out',
                quantity: Number(quantity),
                reason: reason,
                reference_id: referenceId.trim(),
                note: note.trim(),
                shipping_co: shippingCo.trim(),
                movement_date: movementDate,
                created_by: currentUser?.id || 'unknown'
            });

            if (error) {
                console.error('Failed to log stock movement:', error);
            }

            showToast(`Removed ${quantity} units from ${product.name}. New stock: ${newStock}`, 'success');
            dispatchActivity({ action: 'stock_out', description: `Stock-Out: ${quantity} × ${product.name}`, userId: currentUser?.id, userName: currentUser?.name, metadata: { productId: product.id, quantity: Number(quantity) } });
            setSelectedProductId('');
            setQuantity('');
            setReason('Shipped');
            setReferenceId('');
            setNote('');
            setShippingCo('');
            setMovementDate(new Date().toISOString().slice(0, 10));
            setProductSearch('');
            setShowForm(false);
            fetchRecords();
        } catch (err: any) {
            showToast('Failed to remove stock: ' + err.message, 'error');
        }
    };

    const openEditModal = (record: StockOutRecord) => {
        setEditRecord(record);
        setEditQuantity(record.quantity);
        setEditReason(record.reason || 'Other');
        setEditReferenceId(record.reference_id || '');
        setEditNote(record.note || '');
        setEditShippingCo(record.shipping_co || '');
        setEditDate(record.movement_date);
    };

    const handleEditSave = async () => {
        if (!editRecord) return;
        if (!editQuantity || Number(editQuantity) <= 0) {
            showToast('Please enter a valid quantity', 'error');
            return;
        }

        try {
            const updatedFields = {
                quantity: Number(editQuantity),
                reason: editReason,
                reference_id: editReferenceId.trim(),
                note: editNote.trim(),
                shipping_co: editShippingCo.trim(),
                movement_date: editDate
            };

            const { error } = await supabase
                .from('stock_movements')
                .update(updatedFields)
                .eq('id', editRecord.id);

            if (error) throw error;

            // Optimistic local update
            setRecords(prev => prev.map(r => r.id === editRecord.id ? { ...r, ...updatedFields } : r));
            showToast('Record updated successfully', 'success');
            setEditRecord(null);
        } catch (err: any) {
            showToast('Failed to update record: ' + err.message, 'error');
        }
    };

    const handleDelete = async (record: StockOutRecord) => {
        if (!confirm(`Delete stock-out record for "${record.product_name}" (${record.quantity} units)?`)) return;

        try {
            // Optimistic removal from local state
            setRecords(prev => prev.filter(r => r.id !== record.id));

            const { error } = await supabase.from('stock_movements').delete().eq('id', record.id);
            if (error) {
                // Revert on failure
                fetchRecords();
                throw error;
            }

            showToast('Record deleted', 'success');
        } catch (err: any) {
            showToast('Failed to delete record: ' + err.message, 'error');
        }
    };

    const getReasonBadge = (reason: string) => {
        const colors: Record<string, { bg: string; text: string }> = {
            'Shipped': { bg: '#DBEAFE', text: '#2563EB' },
            'Delivered': { bg: '#D1FAE5', text: '#059669' },
            'Damaged': { bg: '#FEE2E2', text: '#DC2626' },
            'Warranty Return': { bg: '#FEF3C7', text: '#D97706' },
            'Sample / Demo': { bg: '#E0E7FF', text: '#4F46E5' },
            'Lost': { bg: '#FCE7F3', text: '#DB2777' },
            'Expired': { bg: '#F3E8FF', text: '#7C3AED' },
            'Other': { bg: '#F3F4F6', text: '#6B7280' }
        };
        const c = colors[reason] || colors['Other'];
        return (
            <span style={{ padding: '2px 8px', borderRadius: '12px', background: c.bg, color: c.text, fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {reason}
            </span>
        );
    };

    const inputStyle: React.CSSProperties = { width: '100%', height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '14px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)' };

    return (
        <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'flex-end', marginBottom: '24px', gap: '16px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 8px 0', color: '#EF4444' }}>Stock-Out</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>Track products that left inventory (shipped, delivered, damaged, etc.).</p>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
                    <DateRangePicker value={dateRange} onChange={setDateRange} compact={!isMobile} />
                    {hasActiveFilters && (
                        <button
                            onClick={clearFilters}
                            className="secondary-button"
                            style={{ height: '42px', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#EF4444', borderColor: '#EF4444' }}
                        >
                            <X size={14} /> Clear
                        </button>
                    )}
                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="primary-button"
                        style={{ height: '42px', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', background: '#EF4444' }}
                    >
                        <Minus size={18} /> New Stock-Out
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <StatsCard title="Total Records" value={filteredRecords.length} icon={Calendar} color="#3B82F6" trend={dateRange.start ? `Filtered by date` : 'All time'} />
                <StatsCard title="Total Units Out" value={totalQuantityOut.toLocaleString()} icon={TrendingDown} color="#EF4444" trend={`Across ${filteredRecords.length} entries`} />
                <StatsCard title="Shipped / Delivered" value={shippedCount.toLocaleString()} icon={Truck} color="#10B981" trend="Units shipped or delivered" />
            </div>

            {/* Stock-Out Form */}
            {showForm && (
                <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px', border: '1px solid #EF4444' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#EF4444', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <ArrowUp size={18} /> Record Stock-Out
                        </h3>
                        <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                            <X size={20} />
                        </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                        {/* Product Search */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Product *</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="text"
                                    placeholder="Search products..."
                                    value={productSearch}
                                    onChange={(e) => { setProductSearch(e.target.value); setSelectedProductId(''); }}
                                    className="search-input"
                                    style={{ width: '100%', height: '40px', paddingLeft: '12px' }}
                                />
                                {productSearch && !selectedProductId && (
                                    <div className="glass-panel" style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '200px', overflowY: 'auto', zIndex: 50, marginTop: '4px', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
                                        {filteredProducts.map(p => (
                                            <div
                                                key={p.id}
                                                onClick={() => { setSelectedProductId(p.id); setProductSearch(p.name); }}
                                                style={{ padding: '10px 12px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                                className="sidebar-item"
                                            >
                                                <div>
                                                    <div style={{ fontWeight: 500 }}>{p.name}</div>
                                                    {p.model && <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{p.model}</div>}
                                                </div>
                                                <span style={{ color: p.stock < 5 ? '#EF4444' : 'var(--color-text-muted)', fontSize: '11px', fontWeight: p.stock < 5 ? 700 : 400 }}>Stock: {p.stock}</span>
                                            </div>
                                        ))}
                                        {filteredProducts.length === 0 && (
                                            <div style={{ padding: '12px', color: 'var(--color-text-muted)', fontSize: '13px', textAlign: 'center' }}>No products with stock found</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Quantity */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>
                                Quantity * {selectedProduct && <span style={{ color: '#EF4444', fontWeight: 400 }}>(available: {selectedProduct.stock})</span>}
                            </label>
                            <input
                                type="number"
                                min="1"
                                max={selectedProduct?.stock || 99999}
                                placeholder="Enter quantity"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                style={inputStyle}
                            />
                        </div>

                        {/* Reason */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Reason *</label>
                            <select
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                style={{ ...inputStyle, appearance: 'none' as any }}
                            >
                                {REASON_OPTIONS.map(r => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                        {/* Date */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Date</label>
                            <input
                                type="date"
                                value={movementDate}
                                onChange={(e) => setMovementDate(e.target.value)}
                                style={inputStyle}
                            />
                        </div>

                        {/* Shipping Co */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Shipping Co</label>
                            <input
                                type="text"
                                list="shipping-companies"
                                placeholder="e.g., J&T, VET"
                                value={shippingCo}
                                onChange={(e) => setShippingCo(e.target.value)}
                                style={inputStyle}
                            />
                            <datalist id="shipping-companies">
                                {shippingCompanies?.map(c => <option key={c} value={c} />)}
                            </datalist>
                        </div>

                        {/* Reference ID */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Reference / Order ID</label>
                            <input
                                type="text"
                                placeholder="e.g., ORD-12345"
                                value={referenceId}
                                onChange={(e) => setReferenceId(e.target.value)}
                                style={inputStyle}
                            />
                        </div>

                        {/* Note */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Note</label>
                            <input
                                type="text"
                                placeholder="Additional notes..."
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                style={inputStyle}
                            />
                        </div>
                    </div>

                    {/* Submit */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '12px', borderTop: '1px solid var(--color-border)' }}>
                        <button
                            onClick={handleStockOut}
                            disabled={!selectedProductId || !quantity}
                            className="primary-button"
                            style={{ height: '40px', padding: '0 32px', whiteSpace: 'nowrap', background: !selectedProductId || !quantity ? 'var(--color-text-muted)' : '#EF4444' }}
                        >
                            Record Stock-Out
                        </button>
                    </div>
                </div>
            )}

            {/* Records Table */}
            <div className="glass-panel" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--color-surface)', zIndex: 10, gap: '12px' }}>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#EF4444', whiteSpace: 'nowrap' }}>
                        <ArrowUp size={16} /> Stock-Out History ({filteredRecords.length})
                    </h3>
                    <div style={{ position: 'relative', maxWidth: '300px', flex: 1 }}>
                        <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input
                            type="text"
                            placeholder="Search by product, reason, reference..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ width: '100%', paddingLeft: '32px', paddingRight: '12px', paddingTop: '6px', paddingBottom: '6px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                </div>
                {isLoading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>
                ) : filteredRecords.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Package size={24} color="#EF4444" />
                        </div>
                        <p style={{ fontSize: '13px', fontWeight: 500 }}>No stock-out records found.</p>
                        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Click "New Stock-Out" to record inventory removals.</p>
                    </div>
                ) : (
                    <table className="spreadsheet-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Product</th>
                                <th style={{ textAlign: 'center' }}>Qty</th>
                                <th>Reason</th>
                                <th>Shipping Co</th>
                                <th>Reference</th>
                                <th>Note</th>
                                {isAdmin && <th style={{ textAlign: 'center' }}>Actions</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredRecords.map(record => (
                                <tr key={record.id}>
                                    <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                                        {new Date(record.movement_date + 'T00:00:00').toLocaleDateString()}
                                    </td>
                                    <td style={{ fontWeight: 600, fontSize: '13px' }}>{record.product_name}</td>
                                    <td style={{ textAlign: 'center' }}>
                                        <span style={{ color: '#EF4444', fontWeight: 700, fontSize: '14px' }}>-{record.quantity}</span>
                                    </td>
                                    <td>{getReasonBadge(record.reason || 'Other')}</td>
                                    <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                        {record.shipping_co || '-'}
                                    </td>
                                    <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                                        {record.reference_id || '-'}
                                    </td>
                                    <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{record.note || '-'}</td>
                                    {isAdmin && (
                                        <td style={{ textAlign: 'center' }}>
                                            <div style={{ display: 'flex', justifyContent: 'center', gap: '4px' }}>
                                                <button
                                                    onClick={() => openEditModal(record)}
                                                    className="icon-button"
                                                    title="Edit"
                                                    style={{ padding: '4px', color: 'var(--color-primary)' }}
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(record)}
                                                    className="icon-button"
                                                    title="Delete"
                                                    style={{ padding: '4px', color: '#EF4444' }}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Edit Modal */}
            <Modal
                isOpen={!!editRecord}
                onClose={() => setEditRecord(null)}
                title={`Edit Stock-Out: ${editRecord?.product_name || ''}`}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Quantity</label>
                        <input type="number" min="1" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Reason</label>
                        <select value={editReason} onChange={(e) => setEditReason(e.target.value)} style={{ ...inputStyle, appearance: 'none' as any }}>
                            {REASON_OPTIONS.map(r => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Reference / Order ID</label>
                        <input type="text" value={editReferenceId} onChange={(e) => setEditReferenceId(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Shipping Co</label>
                        <input type="text" list="shipping-companies-edit" value={editShippingCo} onChange={(e) => setEditShippingCo(e.target.value)} style={inputStyle} />
                        <datalist id="shipping-companies-edit">
                            {shippingCompanies?.map(c => <option key={c} value={c} />)}
                        </datalist>
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Note</label>
                        <input type="text" value={editNote} onChange={(e) => setEditNote(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Date</label>
                        <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={inputStyle} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '8px', borderTop: '1px solid var(--color-border)' }}>
                        <button onClick={() => setEditRecord(null)} className="secondary-button" style={{ padding: '8px 20px', borderRadius: '8px' }}>Cancel</button>
                        <button onClick={handleEditSave} className="primary-button" style={{ padding: '8px 20px', borderRadius: '8px', background: '#EF4444' }}>Save Changes</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default StockOut;
