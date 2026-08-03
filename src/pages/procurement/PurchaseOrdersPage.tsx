import { useState, useEffect, useMemo } from 'react';
import { Plus, FileText, CheckCircle2, Clock, FileSignature, AlertCircle, X, Search, Trash2, Edit } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
// Removed unused Modal import
import { useProcurement } from '../../hooks/useProcurement';
import type { PurchaseOrderItem } from '../../types';

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

const getStatusConfig = (status: string) => {
    switch (status) {
        case 'Draft': return { color: 'var(--color-text-secondary)', bg: 'rgba(156, 163, 175, 0.1)', icon: FileSignature };
        case 'Sent': return { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', icon: Clock };
        case 'Received': return { color: 'var(--color-success)', bg: 'rgba(34, 197, 94, 0.1)', icon: CheckCircle2 };
        case 'Cancelled': return { color: 'var(--color-danger)', bg: 'rgba(239, 68, 68, 0.1)', icon: AlertCircle };
        default: return { color: 'var(--color-text-secondary)', bg: 'rgba(156, 163, 175, 0.1)', icon: FileText };
    }
};

const PurchaseOrdersPage = () => {
    const { setHeaderContent } = useHeader();
    const { products } = useStore();
    const { purchaseOrders, suppliers, isLoading, fetchPurchaseOrders, fetchSuppliers, savePurchaseOrder, deletePurchaseOrder } = useProcurement();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    
    // Form state
    const [editingPOId, setEditingPOId] = useState<string | null>(null);
    const [supplierId, setSupplierId] = useState('');
    const [orderDate, setOrderDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
    const [status, setStatus] = useState<'Draft' | 'Sent' | 'Received' | 'Cancelled'>('Draft');
    const [notes, setNotes] = useState('');
    const [lines, setLines] = useState<Partial<PurchaseOrderItem>[]>([
        { product_id: '', quantity: 1, unit_price: 0 }
    ]);

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

    const handleOpenModal = () => {
        setEditingPOId(null);
        setSupplierId('');
        setOrderDate(new Date().toISOString().split('T')[0]);
        setExpectedDeliveryDate('');
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


    const addLine = () => {
        setLines([...lines, { product_id: '', quantity: 1, unit_price: 0 }]);
    };

    const removeLine = (index: number) => {
        setLines(lines.filter((_, i) => i !== index));
    };

    const updateLine = (index: number, field: keyof PurchaseOrderItem, value: any) => {
        const newLines = [...lines];
        newLines[index] = { ...newLines[index], [field]: value };
        
        // Auto-fill unit price if product is selected and price is 0
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
                    status,
                    total_amount: totalAmount,
                    notes
                },
                lines
            );
            setIsModalOpen(false);
        } catch (error) {
            // Error handled in hook
        }
    };

    // Filter Logic
    const filteredPOs = useMemo(() => {
        return purchaseOrders.filter(po => {
            return po.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
                   po.supplier?.name?.toLowerCase().includes(searchQuery.toLowerCase());
        });
    }, [purchaseOrders, searchQuery]);


    return (
        <div className="page-container fade-in">
            {/* Header Area */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--color-primary)' }}>
                        <FileText size={32} />
                        Purchase Orders
                    </h1>
                </div>
                <button 
                    className="primary-button" 
                    onClick={handleOpenModal}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', borderRadius: '12px', fontWeight: 600, boxShadow: '0 4px 12px rgba(var(--color-primary-rgb), 0.3)' }}
                >
                    <Plus size={18} /> New Purchase Order
                </button>
            </div>

            {/* Simple Search Bar */}
            <div style={{ marginBottom: '24px' }}>
                <div style={{ position: 'relative', width: '100%', background: 'var(--color-surface)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                    <Search size={18} color="var(--color-text-muted)" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input 
                        type="text" 
                        placeholder="Search PO number or supplier..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ width: '100%', padding: '12px 16px 12px 44px', background: 'transparent', border: 'none', outline: 'none', fontSize: '14px', color: 'var(--color-text)' }}
                    />
                </div>
            </div>

            {/* List Table */}
            {isLoading ? (
                <div style={{ textAlign: 'center', padding: '60px', color: 'var(--color-text-secondary)' }}>
                    <div className="loader" style={{ margin: '0 auto 16px', width: '32px', height: '32px' }}></div>
                    Loading orders...
                </div>
            ) : filteredPOs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', background: 'var(--color-surface)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                    <FileText size={48} color="var(--color-text-muted)" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)' }}>No Purchase Orders Found</h3>
                </div>
            ) : (
                <div style={{ overflowX: 'auto', background: 'var(--color-surface)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600 }}>PO #</th>
                                <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600 }}>Supplier</th>
                                <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600 }}>Date</th>
                                <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600 }}>Expected Date</th>
                                <th style={{ padding: '16px', textAlign: 'center', fontWeight: 600 }}>Items</th>
                                <th style={{ padding: '16px', textAlign: 'right', fontWeight: 600 }}>Total</th>
                                <th style={{ padding: '16px', textAlign: 'center', fontWeight: 600 }}>Status</th>
                                <th style={{ padding: '16px', textAlign: 'center', fontWeight: 600 }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredPOs.map(po => {
                                const statusCfg = getStatusConfig(po.status);
                                return (
                                    <tr key={po.id} style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-background)' }}>
                                        <td style={{ padding: '16px', fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>
                                            PO-{po.id.substring(0, 8).toUpperCase()}
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                                            {po.supplier?.name}
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                                            {new Date(po.order_date).toLocaleDateString()}
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                                            {po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString() : '-'}
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '14px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                                            {po.items?.reduce((sum, i) => sum + i.quantity, 0)}
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '14px', fontWeight: 700, color: 'var(--color-text)', textAlign: 'right' }}>
                                            {formatCurrency(po.total_amount)}
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'center' }}>
                                            <span style={{ 
                                                display: 'inline-block',
                                                padding: '4px 12px', 
                                                borderRadius: '16px', 
                                                fontSize: '11px', 
                                                fontWeight: 700,
                                                textTransform: 'uppercase',
                                                backgroundColor: statusCfg.bg,
                                                color: statusCfg.color,
                                            }}>
                                                {po.status}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'center' }}>
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                                <button 
                                                    onClick={() => handleEditPO(po)}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: '4px' }}
                                                    title="Edit Purchase Order"
                                                >
                                                    <Edit size={18} />
                                                </button>
                                                <button 
                                                    onClick={() => handleDeletePO(po.id)}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', padding: '4px' }}
                                                    title="Delete Purchase Order"
                                                >
                                                    <Trash2 size={18} />
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

            {/* Premium Redesigned Modal Form */}
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
                        maxWidth: '900px',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
                        overflow: 'hidden',
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                    }}>
                        {/* Modal Header */}
                        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff' }}>
                            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
                                {editingPOId ? 'Edit Purchase Order' : 'Create Purchase Order'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px' }}>Supplier *</label>
                                    <select 
                                        className="input-field" 
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', fontSize: '14px' }}
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
                                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px' }}>Status</label>
                                    <select 
                                        className="input-field" 
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', fontSize: '14px' }}
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
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px' }}>Order Date *</label>
                                    <input 
                                        type="date" 
                                        className="input-field" 
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', fontSize: '14px' }}
                                        value={orderDate} 
                                        onChange={(e) => setOrderDate(e.target.value)} 
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px' }}>Expected Delivery</label>
                                    <input 
                                        type="date" 
                                        className="input-field" 
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', fontSize: '14px' }}
                                        value={expectedDeliveryDate} 
                                        onChange={(e) => setExpectedDeliveryDate(e.target.value)} 
                                    />
                                </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px' }}>Notes</label>
                                <textarea 
                                    className="input-field" 
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', minHeight: '60px', fontSize: '14px' }}
                                    value={notes} 
                                    onChange={(e) => setNotes(e.target.value)} 
                                />
                            </div>

                            <div style={{ marginTop: '8px', borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                    <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Line Items</h3>
                                    <button 
                                        className="secondary-button" 
                                        onClick={addLine}
                                        style={{ padding: '6px 12px', fontSize: '13px', borderRadius: '6px' }}
                                    >
                                        + Add Product
                                    </button>
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--color-border)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                            <th style={{ padding: '8px', textAlign: 'left' }}>Product</th>
                                            <th style={{ padding: '8px', textAlign: 'right', width: '80px' }}>Qty</th>
                                            <th style={{ padding: '8px', textAlign: 'right', width: '120px' }}>Unit Cost</th>
                                            <th style={{ padding: '8px', textAlign: 'right', width: '120px' }}>Total</th>
                                            <th style={{ padding: '8px', width: '40px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lines.map((line, index) => (
                                            <tr key={index} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <td style={{ padding: '8px' }}>
                                                    <select 
                                                        className="input-field" 
                                                        style={{ width: '100%', padding: '8px', borderRadius: '6px', fontSize: '13px' }}
                                                        value={line.product_id}
                                                        onChange={(e) => updateLine(index, 'product_id', e.target.value)}
                                                    >
                                                        <option value="">Select...</option>
                                                        {products.map(p => (
                                                            <option key={p.id} value={p.id}>{p.name}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td style={{ padding: '8px' }}>
                                                    <input 
                                                        type="number" 
                                                        className="input-field" 
                                                        style={{ width: '100%', padding: '8px', textAlign: 'right', borderRadius: '6px', fontSize: '13px' }}
                                                        value={line.quantity || ''}
                                                        min="1"
                                                        onChange={(e) => updateLine(index, 'quantity', parseInt(e.target.value) || 0)}
                                                    />
                                                </td>
                                                <td style={{ padding: '8px' }}>
                                                    <input 
                                                        type="number" 
                                                        className="input-field" 
                                                        style={{ width: '100%', padding: '8px', textAlign: 'right', borderRadius: '6px', fontSize: '13px' }}
                                                        value={line.unit_price === 0 && line.product_id === '' ? '' : line.unit_price}
                                                        min="0" step="0.01"
                                                        onChange={(e) => updateLine(index, 'unit_price', parseFloat(e.target.value) || 0)}
                                                    />
                                                </td>
                                                <td style={{ padding: '8px', textAlign: 'right', fontSize: '14px', fontWeight: 500 }}>
                                                    {formatCurrency((line.quantity || 0) * (line.unit_price || 0))}
                                                </td>
                                                <td style={{ padding: '8px', textAlign: 'center' }}>
                                                    <button 
                                                        onClick={() => removeLine(index)} 
                                                        disabled={lines.length <= 1}
                                                        style={{ 
                                                            background: 'none', border: 'none', cursor: lines.length > 1 ? 'pointer' : 'not-allowed', 
                                                            color: lines.length > 1 ? 'var(--color-danger)' : 'var(--color-text-muted)',
                                                            padding: '4px'
                                                        }}
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div style={{ padding: '20px 24px', borderTop: '1px solid var(--color-border)', background: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontSize: '16px', fontWeight: 600 }}>
                                Total: <span style={{ color: 'var(--color-primary)', fontSize: '20px', marginLeft: '8px' }}>{formatCurrency(totalAmount)}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 16px', borderRadius: '8px', fontWeight: 500 }}>
                                    Cancel
                                </button>
                                <button 
                                    className="primary-button" 
                                    onClick={handleSave} 
                                    disabled={!isFormValid}
                                    style={{ padding: '10px 16px', borderRadius: '8px', fontWeight: 500 }}
                                >
                                    Save Order
                                </button>
                            </div>
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
