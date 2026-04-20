import React, { useState, useMemo, useEffect } from 'react';
import { ArrowDown, Search, Package, TrendingUp, Calendar, Plus, X, DollarSign, Edit2, Trash2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { supabase } from '../lib/supabase';
import { dispatchActivity } from '../utils/activityLogger';
import StatsCard from '../components/StatsCard';
import DateRangePicker from '../components/DateRangePicker';
import Modal from '../components/Modal';

interface StockInRecord {
    id: string;
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    source: string;
    note: string;
    shipping_co: string;
    customer_name: string;
    customer_phone: string;
    movement_date: string;
    created_at: string;
    created_by: string;
}

const StockIn: React.FC = () => {
    const { products, updateProduct, currentUser, shippingCompanies } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();

    const isAdmin = currentUser?.roleId === 'admin';

    const [records, setRecords] = useState<StockInRecord[]>([]);
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Form state
    const [showForm, setShowForm] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState('');
    const [quantity, setQuantity] = useState<number | string>('');
    const [unitPrice, setUnitPrice] = useState<number | string>('');
    const [source, setSource] = useState('');
    const [note, setNote] = useState('');
    const [shippingCo, setShippingCo] = useState('');
    const [movementDate, setMovementDate] = useState(new Date().toISOString().slice(0, 10));
    const [productSearch, setProductSearch] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');

    // Edit modal state
    const [editRecord, setEditRecord] = useState<StockInRecord | null>(null);
    const [editQuantity, setEditQuantity] = useState<number | string>('');
    const [editUnitPrice, setEditUnitPrice] = useState<number | string>('');
    const [editSource, setEditSource] = useState('');
    const [editNote, setEditNote] = useState('');
    const [editShippingCo, setEditShippingCo] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editCustomerName, setEditCustomerName] = useState('');
    const [editCustomerPhone, setEditCustomerPhone] = useState('');

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Stock-In</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Track inventory additions</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    // Fetch stock-in records
    const fetchRecords = async () => {
        setIsLoading(true);
        try {
            let query = supabase
                .from('stock_movements')
                .select('*')
                .eq('type', 'in')
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
            setRecords((data || []) as StockInRecord[]);
        } catch (err) {
            console.error('Failed to fetch stock-in records:', err);
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
            (r.source || '').toLowerCase().includes(q) ||
            (r.shipping_co || '').toLowerCase().includes(q) ||
            (r.note || '').toLowerCase().includes(q) ||
            (r.customer_name || '').toLowerCase().includes(q) ||
            (r.customer_phone || '').toLowerCase().includes(q)
        );
    }, [records, searchTerm]);

    const totalQuantityIn = useMemo(() => filteredRecords.reduce((sum, r) => sum + r.quantity, 0), [filteredRecords]);
    const totalCost = useMemo(() => filteredRecords.reduce((sum, r) => sum + (r.unit_price * r.quantity), 0), [filteredRecords]);

    const filteredProducts = useMemo(() => {
        if (!productSearch.trim()) return products.slice(0, 20);
        const q = productSearch.trim().toLowerCase();
        return products.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.model || '').toLowerCase().includes(q)
        ).slice(0, 20);
    }, [products, productSearch]);

    const clearFilters = () => {
        setDateRange({ start: '', end: '' });
        setSearchTerm('');
    };

    const hasActiveFilters = dateRange.start || dateRange.end || searchTerm;

    const handleStockIn = async () => {
        if (!selectedProductId || !quantity || Number(quantity) <= 0) {
            showToast('Please select a product and enter a valid quantity', 'error');
            return;
        }

        const product = products.find(p => p.id === selectedProductId);
        if (!product) {
            showToast('Product not found', 'error');
            return;
        }

        try {
            const newStock = product.stock + Number(quantity);
            await updateProduct(product.id, { stock: newStock });

            // Log the stock movement
            const { error } = await supabase.from('stock_movements').insert({
                product_id: product.id,
                product_name: product.name,
                type: 'in',
                quantity: Number(quantity),
                unit_price: Number(unitPrice) || 0,
                source: source.trim(),
                note: note.trim(),
                shipping_co: shippingCo.trim(),
                customer_name: customerName.trim(),
                customer_phone: customerPhone.trim(),
                movement_date: movementDate,
                created_by: currentUser?.id || 'unknown'
            });

            if (error) {
                console.error('Failed to log stock movement:', error);
                throw new Error(error.message);
            }

            showToast(`Added ${quantity} units of ${product.name}. New stock: ${newStock}`, 'success');
            dispatchActivity({ action: 'stock_in', description: `Stock-In: ${quantity} × ${product.name}`, userId: currentUser?.id, userName: currentUser?.name, metadata: { productId: product.id, quantity: Number(quantity) } });
            setSelectedProductId('');
            setQuantity('');
            setUnitPrice('');
            setSource('');
            setNote('');
            setShippingCo('');
            setCustomerName('');
            setCustomerPhone('');
            setMovementDate(new Date().toISOString().slice(0, 10));
            setProductSearch('');
            setShowForm(false);
            fetchRecords();
        } catch (err: any) {
            showToast('Failed to add stock: ' + err.message, 'error');
        }
    };

    const openEditModal = (record: StockInRecord) => {
        setEditRecord(record);
        setEditQuantity(record.quantity);
        setEditUnitPrice(record.unit_price || '');
        setEditSource(record.source || '');
        setEditNote(record.note || '');
        setEditShippingCo(record.shipping_co || '');
        setEditDate(record.movement_date);
        setEditCustomerName(record.customer_name || '');
        setEditCustomerPhone(record.customer_phone || '');
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
                unit_price: Number(editUnitPrice) || 0,
                source: editSource.trim(),
                note: editNote.trim(),
                shipping_co: editShippingCo.trim(),
                customer_name: editCustomerName.trim(),
                customer_phone: editCustomerPhone.trim(),
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

    const handleDelete = async (record: StockInRecord) => {
        if (!confirm(`Delete stock-in record for "${record.product_name}" (${record.quantity} units)?`)) return;

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

    const inputStyle: React.CSSProperties = { width: '100%', height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '14px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)' };

    return (
        <div style={{ padding: '24px' }}>
            {/* Header */}
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'flex-end', marginBottom: '24px', gap: '16px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 8px 0', color: '#10B981' }}>Stock-In</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>Record and track all inventory arrivals and additions.</p>
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
                        style={{ height: '42px', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', background: '#10B981' }}
                    >
                        <Plus size={18} /> New Stock-In
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <StatsCard title="Total Records" value={filteredRecords.length} icon={Calendar} color="#3B82F6" trend={dateRange.start ? `Filtered by date` : 'All time'} />
                <StatsCard title="Total Units Added" value={totalQuantityIn.toLocaleString()} icon={TrendingUp} color="#10B981" trend={`Across ${filteredRecords.length} entries`} />
                <StatsCard title="Total Cost" value={`$${totalCost.toLocaleString()}`} icon={DollarSign} color="#F59E0B" trend="Purchase cost of stock-in" />
            </div>

            {/* Stock-In Form */}
            {showForm && (
                <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px', border: '1px solid #10B981' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#10B981', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <ArrowDown size={18} /> Record New Stock-In
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
                                                onClick={() => { setSelectedProductId(p.id); setProductSearch(p.name); setUnitPrice(p.price); }}
                                                style={{ padding: '10px 12px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                                className="sidebar-item"
                                            >
                                                <div>
                                                    <div style={{ fontWeight: 500 }}>{p.name}</div>
                                                    {p.model && <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{p.model}</div>}
                                                </div>
                                                <span style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>Stock: {p.stock}</span>
                                            </div>
                                        ))}
                                        {filteredProducts.length === 0 && (
                                            <div style={{ padding: '12px', color: 'var(--color-text-muted)', fontSize: '13px', textAlign: 'center' }}>No products found</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Quantity */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Quantity *</label>
                            <input
                                type="number"
                                min="1"
                                placeholder="Enter quantity"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                style={inputStyle}
                            />
                        </div>

                        {/* Unit Price */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Unit Price ($)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Cost per unit"
                                value={unitPrice}
                                onChange={(e) => setUnitPrice(e.target.value)}
                                style={inputStyle}
                            />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
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

                        {/* Customer */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Customer</label>
                            <input
                                type="text"
                                placeholder="Customer name"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                style={inputStyle}
                            />
                        </div>

                        {/* Phone */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Phone</label>
                            <input
                                type="text"
                                placeholder="Phone number"
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                style={inputStyle}
                            />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                        {/* Shipping Co */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Shipping Co</label>
                            <input
                                type="text"
                                list="shipping-companies-in"
                                placeholder="e.g., J&T, VET"
                                value={shippingCo}
                                onChange={(e) => setShippingCo(e.target.value)}
                                style={inputStyle}
                            />
                            <datalist id="shipping-companies-in">
                                {shippingCompanies?.map(c => <option key={c} value={c} />)}
                            </datalist>
                        </div>

                        {/* Source / Where from */}
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Source / Supplier</label>
                            <input
                                type="text"
                                placeholder="e.g., Samsung KH, Local Supplier"
                                value={source}
                                onChange={(e) => setSource(e.target.value)}
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

                    {/* Summary & Submit */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid var(--color-border)' }}>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            {selectedProductId && quantity ? (
                                <span>Total cost: <strong style={{ color: '#10B981' }}>${((Number(unitPrice) || 0) * Number(quantity)).toLocaleString()}</strong></span>
                            ) : (
                                <span>Select a product and enter quantity</span>
                            )}
                        </div>
                        <button
                            onClick={handleStockIn}
                            disabled={!selectedProductId || !quantity}
                            className="primary-button"
                            style={{ height: '40px', padding: '0 32px', whiteSpace: 'nowrap', background: !selectedProductId || !quantity ? 'var(--color-text-muted)' : '#10B981' }}
                        >
                            Record Stock-In
                        </button>
                    </div>
                </div>
            )}

            {/* Records Table */}
            <div className="glass-panel" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--color-surface)', zIndex: 10, gap: '12px' }}>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#10B981', whiteSpace: 'nowrap' }}>
                        <ArrowDown size={16} /> Stock-In History ({filteredRecords.length})
                    </h3>
                    <div style={{ position: 'relative', maxWidth: '300px', flex: 1 }}>
                        <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input
                            type="text"
                            placeholder="Search by product, source, note..."
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
                        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Package size={24} color="#10B981" />
                        </div>
                        <p style={{ fontSize: '13px', fontWeight: 500 }}>No stock-in records found.</p>
                        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Click "New Stock-In" to record inventory arrivals.</p>
                    </div>
                ) : (
                    <table className="spreadsheet-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Product</th>
                                <th style={{ textAlign: 'center' }}>Qty</th>
                                <th style={{ textAlign: 'right' }}>Unit Price</th>
                                <th style={{ textAlign: 'right' }}>Total</th>
                                <th>Customer</th>
                                <th>Phone</th>
                                <th>Source / Supplier</th>
                                <th>Shipping Co</th>
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
                                        <span style={{ color: '#10B981', fontWeight: 700, fontSize: '14px' }}>+{record.quantity}</span>
                                    </td>
                                    <td style={{ textAlign: 'right', fontSize: '13px' }}>
                                        {record.unit_price ? `$${Number(record.unit_price).toLocaleString()}` : '-'}
                                    </td>
                                    <td style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>
                                        {record.unit_price ? `$${(Number(record.unit_price) * record.quantity).toLocaleString()}` : '-'}
                                    </td>
                                    <td style={{ fontSize: '12px', color: 'var(--color-text-main)', fontWeight: 500 }}>
                                        {record.customer_name || '-'}
                                    </td>
                                    <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                        {record.customer_phone || '-'}
                                    </td>
                                    <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                        {record.source || '-'}
                                    </td>
                                    <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                        {record.shipping_co || '-'}
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
                title={`Edit Stock-In: ${editRecord?.product_name || ''}`}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Quantity</label>
                        <input type="number" min="1" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Unit Price ($)</label>
                        <input type="number" min="0" step="0.01" value={editUnitPrice} onChange={(e) => setEditUnitPrice(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Source / Supplier</label>
                        <input type="text" value={editSource} onChange={(e) => setEditSource(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Shipping Co</label>
                        <input type="text" list="shipping-companies-edit-in" value={editShippingCo} onChange={(e) => setEditShippingCo(e.target.value)} style={inputStyle} />
                        <datalist id="shipping-companies-edit-in">
                            {shippingCompanies?.map(c => <option key={c} value={c} />)}
                        </datalist>
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Customer</label>
                        <input type="text" value={editCustomerName} onChange={(e) => setEditCustomerName(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Phone</label>
                        <input type="text" value={editCustomerPhone} onChange={(e) => setEditCustomerPhone(e.target.value)} style={inputStyle} />
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
                        <button onClick={handleEditSave} className="primary-button" style={{ padding: '8px 20px', borderRadius: '8px', background: '#10B981' }}>Save Changes</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default StockIn;
