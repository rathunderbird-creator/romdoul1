import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PackageCheck, Search, CheckCircle2 } from 'lucide-react';
import { useProcurement } from '../../hooks/useProcurement';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';

const ReceivingPage: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const { purchaseOrders, fetchPurchaseOrders, savePurchaseOrder, isLoading } = useProcurement();
    const { addStock } = useStore();
    const { showToast } = useToast();
    const [receivingId, setReceivingId] = useState<string | null>(null);

    useEffect(() => {
        fetchPurchaseOrders();
    }, [fetchPurchaseOrders]);

    const pendingPOs = useMemo(() => {
        return purchaseOrders.filter(po => 
            (po.status !== 'Received' && po.status !== 'Cancelled') &&
            (
                po.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                po.supplier?.name?.toLowerCase().includes(searchTerm.toLowerCase())
            )
        );
    }, [purchaseOrders, searchTerm]);

    const processingIds = useRef<Set<string>>(new Set());

    const handleReceive = async (po: any) => {
        if (processingIds.current.has(po.id)) return;
        processingIds.current.add(po.id);
        setReceivingId(po.id);
        try {
            // 1. Add stock for each item
            if (po.items && po.items.length > 0) {
                for (const item of po.items) {
                    if (item.product_id) {
                        await addStock(item.product_id, item.quantity, item.unit_price, `Received from PO-${po.id.substring(0,8)}`, po.supplier?.name || '');
                    }
                }
            }
            
            // 2. Update PO status
            await savePurchaseOrder({ ...po, status: 'Received' }, po.items || []);
            
            showToast(`PO-${po.id.substring(0,8).toUpperCase()} received successfully!`, 'success');
            fetchPurchaseOrders(true);
        } catch (error: any) {
            showToast('Error receiving PO: ' + error.message, 'error');
        } finally {
            processingIds.current.delete(po.id);
            setReceivingId(null);
        }
    };

    return (
        <div className="page-container fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--color-text-main)' }}>
                        <PackageCheck size={32} color="#6366f1" />
                        Receiving
                    </h1>
                    <p style={{ color: 'var(--color-text-secondary)', marginTop: '6px', fontSize: '15px' }}>
                        Track and receive items from purchase orders
                    </p>
                </div>
            </div>

            <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                <div style={{ padding: '20px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: '1 1 300px' }}>
                        <Search size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input
                            type="text"
                            placeholder="Search purchase orders..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '12px 16px 12px 44px',
                                borderRadius: '8px',
                                border: '1px solid var(--color-border)',
                                background: '#ffffff',
                                fontSize: '14px',
                                outline: 'none'
                            }}
                        />
                    </div>
                </div>

                {isLoading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading...</div>
                ) : pendingPOs.length === 0 ? (
                    <div style={{ padding: '80px 20px', textAlign: 'center' }}>
                        <PackageCheck size={64} style={{ opacity: 0.2, marginBottom: '20px', margin: '0 auto', color: 'var(--color-text-muted)' }} />
                        <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text-main)' }}>No items to receive</h3>
                        <p style={{ fontSize: '14px', marginTop: '8px', color: 'var(--color-text-secondary)' }}>There are no pending purchase orders.</p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>
                                    <th style={{ padding: '16px', fontWeight: 600 }}>PO Number</th>
                                    <th style={{ padding: '16px', fontWeight: 600 }}>Supplier</th>
                                    <th style={{ padding: '16px', fontWeight: 600 }}>Order Date</th>
                                    <th style={{ padding: '16px', fontWeight: 600 }}>Expected</th>
                                    <th style={{ padding: '16px', fontWeight: 600 }}>Items</th>
                                    <th style={{ padding: '16px', fontWeight: 600, textAlign: 'right' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pendingPOs.map(po => (
                                    <tr key={po.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '16px', fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                                            PO-{po.id.substring(0, 8).toUpperCase()}
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                                            {po.supplier?.name || 'Unknown'}
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                                            {po.order_date ? new Date(po.order_date).toLocaleDateString() : '-'}
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                                            {po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString() : '-'}
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                                            {po.items?.reduce((sum: number, item: any) => sum + item.quantity, 0) || 0} pcs
                                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: '8px' }}>({po.items?.length || 0} products)</span>
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            <button 
                                                onClick={() => handleReceive(po)}
                                                disabled={receivingId === po.id}
                                                style={{ 
                                                    background: '#10B981', 
                                                    color: '#ffffff', 
                                                    border: 'none', 
                                                    borderRadius: '6px', 
                                                    padding: '8px 16px', 
                                                    fontSize: '13px', 
                                                    fontWeight: 600, 
                                                    display: 'inline-flex', 
                                                    alignItems: 'center', 
                                                    gap: '8px', 
                                                    cursor: receivingId === po.id ? 'not-allowed' : 'pointer',
                                                    opacity: receivingId === po.id ? 0.7 : 1
                                                }}
                                            >
                                                {receivingId === po.id ? 'Receiving...' : (
                                                    <>
                                                        <CheckCircle2 size={16} />
                                                        Receive All
                                                    </>
                                                )}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReceivingPage;
