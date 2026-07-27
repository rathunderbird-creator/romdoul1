import { useState, useEffect, useMemo } from 'react';
import { Plus, Calendar, Package, FileText, Download } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { Modal } from '../../components';
import { useProcurement } from '../../hooks/useProcurement';
import type { PurchaseOrderItem } from '../../types';

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

const getStatusColor = (status: string) => {
    switch (status) {
        case 'Draft': return 'var(--color-text-secondary)';
        case 'Sent': return 'var(--color-blue)';
        case 'Received': return 'var(--color-green)';
        case 'Cancelled': return 'var(--color-red)';
        default: return 'var(--color-text-secondary)';
    }
};

const PurchaseOrdersPage = () => {
    const { setHeaderContent } = useHeader();
    const { products } = useStore();
    const { purchaseOrders, suppliers, isLoading, fetchPurchaseOrders, fetchSuppliers, savePurchaseOrder } = useProcurement();

    const [isModalOpen, setIsModalOpen] = useState(false);
    
    // Form state
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
        setSupplierId('');
        setOrderDate(new Date().toISOString().split('T')[0]);
        setExpectedDeliveryDate('');
        setStatus('Draft');
        setNotes('');
        setLines([{ product_id: '', quantity: 1, unit_price: 0 }]);
        setIsModalOpen(true);
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

    return (
        <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Purchase Orders</h2>
                <button 
                    className="primary-button" 
                    onClick={handleOpenModal}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '8px' }}
                >
                    <Plus size={18} /> Create PO
                </button>
            </div>

            <div className="glass-panel" style={{ borderRadius: '12px', padding: '24px' }}>
                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>Loading...</div>
                ) : purchaseOrders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>No purchase orders found</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {purchaseOrders.map(po => (
                            <div key={po.id} style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                                            <div style={{ fontWeight: 600, fontSize: '16px' }}>PO: {po.id.substring(0, 8).toUpperCase()}</div>
                                            <span style={{ 
                                                padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 500,
                                                backgroundColor: `${getStatusColor(po.status)}20`,
                                                color: getStatusColor(po.status)
                                            }}>
                                                {po.status}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Package size={14}/> Supplier: <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{po.supplier?.name}</span>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: 700, fontSize: '18px', color: 'var(--color-text)' }}>{formatCurrency(po.total_amount)}</div>
                                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end', marginTop: '4px' }}>
                                            <Calendar size={12}/> {new Date(po.order_date).toLocaleDateString()}
                                        </div>
                                    </div>
                                </div>
                                
                                {po.notes && (
                                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', padding: '8px', backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: '6px' }}>
                                        <FileText size={12} style={{ display: 'inline', marginRight: '4px' }}/> {po.notes}
                                    </div>
                                )}

                                <div style={{ marginTop: '8px', borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '8px', textTransform: 'uppercase' }}>Line Items</div>
                                    <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                                        <tbody>
                                            {po.items?.map((item, idx) => (
                                                <tr key={item.id || idx}>
                                                    <td style={{ padding: '4px 0' }}>{item.quantity}x {item.product?.name || 'Unknown Product'}</td>
                                                    <td style={{ padding: '4px 0', textAlign: 'right', color: 'var(--color-text-secondary)' }}>@ {formatCurrency(item.unit_price)}</td>
                                                    <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 500 }}>{formatCurrency(item.quantity * item.unit_price)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                                    <button className="secondary-button" style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Download size={14}/> Download PDF
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Modal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                title="Create Purchase Order"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 0', minWidth: '500px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Supplier *</label>
                            <select 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px' }}
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
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Status</label>
                            <select 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px' }}
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
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Order Date *</label>
                            <input 
                                type="date" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px' }}
                                value={orderDate} 
                                onChange={(e) => setOrderDate(e.target.value)} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Expected Delivery</label>
                            <input 
                                type="date" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px' }}
                                value={expectedDeliveryDate} 
                                onChange={(e) => setExpectedDeliveryDate(e.target.value)} 
                            />
                        </div>
                    </div>

                    <div style={{ marginTop: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <label style={{ fontWeight: 500 }}>Products</label>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                                    <th style={{ padding: '8px 4px', textAlign: 'left' }}>Product</th>
                                    <th style={{ padding: '8px 4px', textAlign: 'right', width: '80px' }}>Qty</th>
                                    <th style={{ padding: '8px 4px', textAlign: 'right', width: '100px' }}>Unit Cost</th>
                                    <th style={{ padding: '8px 4px', textAlign: 'right', width: '100px' }}>Total</th>
                                    <th style={{ padding: '8px 4px', width: '30px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((line, index) => (
                                    <tr key={index}>
                                        <td style={{ padding: '4px' }}>
                                            <select 
                                                className="input-field" 
                                                style={{ width: '100%', padding: '8px', fontSize: '13px' }}
                                                value={line.product_id}
                                                onChange={(e) => updateLine(index, 'product_id', e.target.value)}
                                            >
                                                <option value="">Select...</option>
                                                {products.map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td style={{ padding: '4px' }}>
                                            <input 
                                                type="number" 
                                                className="input-field" 
                                                style={{ width: '100%', padding: '8px', textAlign: 'right', fontSize: '13px' }}
                                                value={line.quantity || ''}
                                                min="1"
                                                onChange={(e) => updateLine(index, 'quantity', parseInt(e.target.value) || 0)}
                                            />
                                        </td>
                                        <td style={{ padding: '4px' }}>
                                            <input 
                                                type="number" 
                                                className="input-field" 
                                                style={{ width: '100%', padding: '8px', textAlign: 'right', fontSize: '13px' }}
                                                value={line.unit_price === 0 && line.product_id === '' ? '' : line.unit_price}
                                                min="0"
                                                step="0.01"
                                                onChange={(e) => updateLine(index, 'unit_price', parseFloat(e.target.value) || 0)}
                                            />
                                        </td>
                                        <td style={{ padding: '4px', textAlign: 'right', fontSize: '13px', fontWeight: 500 }}>
                                            {formatCurrency((line.quantity || 0) * (line.unit_price || 0))}
                                        </td>
                                        <td style={{ padding: '4px', textAlign: 'center' }}>
                                            <button 
                                                onClick={() => removeLine(index)} 
                                                disabled={lines.length <= 1}
                                                style={{ 
                                                    background: 'none', border: 'none', cursor: lines.length > 1 ? 'pointer' : 'not-allowed', 
                                                    color: lines.length > 1 ? 'var(--color-red)' : 'var(--color-text-muted)',
                                                    padding: '4px'
                                                }}
                                            >
                                                &times;
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <button 
                            className="secondary-button" 
                            onClick={addLine}
                            style={{ marginTop: '8px', padding: '6px 12px', fontSize: '12px', borderRadius: '6px' }}
                        >
                            + Add Product
                        </button>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Notes / Instructions</label>
                        <textarea 
                            className="input-field" 
                            style={{ width: '100%', padding: '10px', minHeight: '60px' }}
                            value={notes} 
                            onChange={(e) => setNotes(e.target.value)} 
                            placeholder="Optional notes for supplier..."
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '16px', background: 'rgba(0,0,0,0.02)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>Total Amount</div>
                        <div style={{ fontWeight: 'bold', fontSize: '20px', color: 'var(--color-blue)' }}>{formatCurrency(totalAmount)}</div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 16px', borderRadius: '8px' }}>Cancel</button>
                        <button 
                            className="primary-button" 
                            onClick={handleSave} 
                            disabled={!isFormValid}
                            style={{ padding: '10px 16px', borderRadius: '8px' }}
                        >
                            Save Order
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default PurchaseOrdersPage;
