import React, { useState, useMemo, useEffect } from 'react';
import { Search, Layers, ArrowDown, Boxes, AlertTriangle, ArchiveRestore } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { supabase } from '../lib/supabase';
import { useMobile } from '../hooks/useMobile';
import StatsCard from '../components/StatsCard';
import DateRangePicker from '../components/DateRangePicker';
import type { Sale } from '../types';

const ReturnsRestocks: React.FC = () => {
    const { restockOrder, bulkRestockOrders, updateOrder, salesUpdatedAt } = useStore();
    const isMobile = useMobile();

    // Historical Orders State
    const [returnedOrders, setReturnedOrders] = useState<Sale[]>([]);
    const [returnedSearchTerm, setReturnedSearchTerm] = useState('');
    const [restockedHistory, setRestockedHistory] = useState<Sale[]>([]);
    
    // Selection State
    const [selectedReturnedOrderIds, setSelectedReturnedOrderIds] = useState<Set<string>>(new Set());
    const [isRestocking, setIsRestocking] = useState(false);

    // Filter State
    const [dateRange, setDateRange] = useState({ start: '', end: '' });

    const fetchHistoricalOrders = async () => {
        try {
            // Fetch Returned Orders
            let retQuery = supabase
                .from('sales')
                .select('*, items:sale_items(*)')
                .eq('shipping_status', 'Returned')
                .order('date', { ascending: false });

            // Fetch Restocked History
            let resQuery = supabase
                .from('sales')
                .select('*, items:sale_items(*)')
                .eq('shipping_status', 'ReStock')
                .order('date', { ascending: false });

            if (dateRange.start) {
                retQuery = retQuery.gte('date', dateRange.start + 'T00:00:00');
                resQuery = resQuery.gte('date', dateRange.start + 'T00:00:00');
            }
            if (dateRange.end) {
                retQuery = retQuery.lte('date', dateRange.end + 'T23:59:59.999Z');
                resQuery = resQuery.lte('date', dateRange.end + 'T23:59:59.999Z');
            } else {
                resQuery = resQuery.limit(100);
            }

            const [retRes, resRes] = await Promise.all([retQuery, resQuery]);
            if (retRes.error) throw retRes.error;
            if (resRes.error) throw resRes.error;

            const retData = retRes.data;
            const resData = resRes.data;

            const mapToSale = (dbRow: any): Sale => ({
                ...dbRow,
                paymentMethod: dbRow.payment_method,
                paymentStatus: dbRow.payment_status,
                customerCare: dbRow.customer_care,
                amountReceived: dbRow.amount_received,
                settleDate: dbRow.settle_date,
                orderStatus: dbRow.order_status,
                shipping: {
                    company: dbRow.shipping_company,
                    trackingNumber: dbRow.tracking_number,
                    status: dbRow.shipping_status,
                    cost: 0
                },
                customer: dbRow.customer_snapshot || {}
            });

            setReturnedOrders((retData || []).map(mapToSale));
            setRestockedHistory((resData || []).map(mapToSale));
        } catch (err) {
            console.error("Failed to fetch historical orders:", err);
        }
    };

    useEffect(() => {
        fetchHistoricalOrders();
    }, [salesUpdatedAt, dateRange]);

    const toggleReturnedOrderSelection = (id: string) => {
        const newSet = new Set(selectedReturnedOrderIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedReturnedOrderIds(newSet);
    };

    const filteredReturnedOrders = useMemo(() => {
        if (!returnedSearchTerm.trim()) return returnedOrders;
        const query = returnedSearchTerm.trim().toLowerCase();
        return returnedOrders.filter(order => 
            order.id.toLowerCase().includes(query) || 
            (order.customer?.name || '').toLowerCase().includes(query) ||
            String(order.customer?.phone || '').toLowerCase().includes(query) ||
            order.items.some(item => item.name.toLowerCase().includes(query))
        );
    }, [returnedOrders, returnedSearchTerm]);

    const toggleSelectAllReturnedOrders = () => {
        if (selectedReturnedOrderIds.size === filteredReturnedOrders.length && filteredReturnedOrders.length > 0) {
            setSelectedReturnedOrderIds(new Set());
        } else {
            setSelectedReturnedOrderIds(new Set(filteredReturnedOrders.map(o => o.id)));
        }
    };

    const handleBulkRestock = async () => {
        if (selectedReturnedOrderIds.size === 0) return;
        if (!confirm(`Are you sure you want to restock ${selectedReturnedOrderIds.size} orders?`)) return;
        
        setIsRestocking(true);
        try {
            await bulkRestockOrders(Array.from(selectedReturnedOrderIds));
            setSelectedReturnedOrderIds(new Set());
            alert('Successfully Added Product back to Stock');
            await fetchHistoricalOrders();
        } catch (error: any) {
             console.error("Bulk restock failed:", error);
             alert("Failed to restock some orders: " + error.message);
        } finally {
            setIsRestocking(false);
        }
    };

    const returnedItemsCount = returnedOrders.reduce((sum, order) => sum + order.items.reduce((s, item) => s + item.quantity, 0), 0);
    const restockedItemsCount = restockedHistory.reduce((sum, order) => sum + order.items.reduce((s, item) => s + item.quantity, 0), 0);

    return (
        <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'flex-end', marginBottom: '24px', gap: '16px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 8px 0', color: 'var(--color-primary)' }}>Returns & Restocks</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>Manage returned orders and restock history.</p>
                </div>
                <div style={{ width: isMobile ? '100%' : 'auto' }}>
                    <DateRangePicker 
                        value={dateRange} 
                        onChange={setDateRange} 
                        compact={!isMobile} 
                    />
                </div>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <StatsCard title="Pending Returns" value={returnedOrders.length} icon={AlertTriangle} color="#DC2626" trend={`${returnedItemsCount} items waiting`} />
                <StatsCard title="Restocked Orders" value={restockedHistory.length} icon={ArchiveRestore} color="#2563EB" trend={`${restockedItemsCount} items restocked`} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '24px', height: isMobile ? 'auto' : 'calc(100vh - 300px)' }}>
                {/* ReStock Table (Returned Orders) */}
                <div className="glass-panel" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', border: '1px solid #FCA5A5', minHeight: isMobile ? '400px' : 'auto' }}>
                    <h3 style={{ padding: '16px 20px', borderBottom: '1px solid #FCA5A5', margin: 0, fontSize: '15px', fontWeight: 600, color: '#DC2626', background: '#FEF2F2', display: 'flex', alignItems: 'center', gap: '8px', position: 'sticky', top: 0, zIndex: 10 }}>
                        <AlertTriangle size={16} /> Returned Orders
                        {selectedReturnedOrderIds.size > 0 && (
                            <button 
                                onClick={handleBulkRestock}
                                disabled={isRestocking}
                                style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: '11px', backgroundColor: '#DC2626', color: 'white', border: 'none', borderRadius: '4px', cursor: isRestocking ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', opacity: isRestocking ? 0.7 : 1 }}
                            >
                                <ArrowDown size={12} />
                                {isRestocking ? 'Restocking...' : `Restock Selected (${selectedReturnedOrderIds.size})`}
                            </button>
                        )}
                    </h3>
                    {returnedOrders.length > 0 && (
                        <div style={{ padding: '8px 16px', background: '#FEF2F2', borderBottom: '1px solid #FCA5A5' }}>
                            <div style={{ position: 'relative' }}>
                                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#DC2626' }} />
                                <input
                                    type="text"
                                    placeholder="Search by ID, Customer, Phone, Item..."
                                    value={returnedSearchTerm}
                                    onChange={(e) => setReturnedSearchTerm(e.target.value)}
                                    style={{ width: '100%', paddingLeft: '32px', paddingRight: '12px', paddingTop: '6px', paddingBottom: '6px', border: '1px solid #FCA5A5', borderRadius: '6px', fontSize: '12px', outline: 'none', background: 'white' }}
                                />
                            </div>
                        </div>
                    )}
                    {filteredReturnedOrders.length === 0 ? (
                        <div style={{ padding: '32px', textAlign: 'center', color: '#059669', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Boxes size={20} />
                            </div>
                            <p style={{ fontSize: '13px', fontWeight: 500 }}>
                                {returnedOrders.length === 0 ? 'No returned orders pending restock.' : 'No matching orders found.'}
                            </p>
                        </div>
                    ) : (
                        <table className="spreadsheet-table">
                            <thead style={{ background: '#FEF2F2' }}>
                                <tr>
                                    <th style={{ width: '40px', textAlign: 'center' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={filteredReturnedOrders.length > 0 && selectedReturnedOrderIds.size === filteredReturnedOrders.length}
                                            onChange={toggleSelectAllReturnedOrders}
                                            style={{ cursor: 'pointer' }}
                                        />
                                    </th>
                                    <th>Date</th>
                                    <th>Order / Customer</th>
                                    <th>Phone</th>
                                    <th>Items</th>
                                    <th style={{ textAlign: 'right' }}>Total</th>
                                    <th>Shipping Co</th>
                                    <th style={{ textAlign: 'right', width: '50px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredReturnedOrders.map(order => (
                                    <tr key={order.id} style={{ background: '#FEF2F2' }} className={selectedReturnedOrderIds.has(order.id) ? 'selected' : ''}>
                                        <td style={{ textAlign: 'center' }}>
                                            <input 
                                                type="checkbox" 
                                                checked={selectedReturnedOrderIds.has(order.id)}
                                                onChange={() => toggleReturnedOrderSelection(order.id)}
                                                style={{ cursor: 'pointer' }}
                                            />
                                        </td>
                                        <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                                            {new Date(order.date).toLocaleDateString()}
                                        </td>
                                        <td style={{ whiteSpace: 'normal' }}>
                                            <div style={{ fontWeight: 600, fontSize: '13px' }}>#{order.id.slice(0, 8)}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{order.customer?.name || 'Unknown'}</div>
                                        </td>
                                        <td style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                                            {order.customer?.phone || '-'}
                                        </td>
                                        <td style={{ fontSize: '12px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                {order.items.map((item, idx) => (
                                                    <span key={idx}>
                                                        {item.name} <span style={{ color: '#DC2626', fontWeight: 600 }}>(x{item.quantity})</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>
                                            ${order.total?.toLocaleString() || '0'}
                                        </td>
                                        <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                            {order.shipping?.company || '-'}
                                        </td>


                                        <td style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                                            <button
                                                onClick={async () => {
                                                    if (confirm('Restock items from this order?')) {
                                                        try {
                                                            await updateOrder(order.id, {
                                                                paymentStatus: 'Cancel',
                                                                shipping: { ...order.shipping, status: 'ReStock' } as any
                                                            });
                                                            await restockOrder(order.id);
                                                            alert('Successfully Added Product back to Stock');
                                                            await fetchHistoricalOrders();
                                                        } catch (error: any) {
                                                            console.error("Restock failed:", error);
                                                            alert("Failed to restock: " + error.message);
                                                        }
                                                    }
                                                }}
                                                className="primary-button"
                                                title="Restock Items"
                                                style={{ padding: '6px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                                            >
                                                <ArrowDown size={14} /> Restock
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Restocked History Table */}
                <div className="glass-panel" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', border: '1px solid #3B82F6', flex: 1 }}>
                    <h3 style={{ padding: '12px 16px', borderBottom: '1px solid #3B82F6', margin: 0, fontSize: '14px', fontWeight: 600, color: '#2563EB', background: '#EFF6FF', display: 'flex', alignItems: 'center', gap: '8px', position: 'sticky', top: 0, zIndex: 10 }}>
                        <Layers size={16} /> Restocked History
                    </h3>
                    {restockedHistory.length === 0 ? (
                        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                            <p style={{ fontSize: '13px', fontWeight: 500 }}>No restocked orders found.</p>
                        </div>
                    ) : (
                        <table className="spreadsheet-table">
                            <thead style={{ background: '#EFF6FF' }}>
                                <tr>
                                    <th>Date</th>
                                    <th>Order / Customer</th>
                                    <th>Phone</th>
                                    <th>Items Restocked</th>
                                    <th style={{ textAlign: 'right' }}>Total</th>
                                    <th>Shipping Co</th>
                                </tr>
                            </thead>
                            <tbody>
                                {restockedHistory.map(order => (
                                    <tr key={order.id} style={{ background: '#EFF6FF' }}>
                                        <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                                            {new Date(order.date).toLocaleDateString()}
                                        </td>
                                        <td style={{ whiteSpace: 'normal' }}>
                                            <div style={{ fontWeight: 600, fontSize: '13px' }}>#{order.id.slice(0, 8)}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{order.customer?.name || 'Unknown'}</div>
                                        </td>
                                        <td style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                                            {order.customer?.phone || '-'}
                                        </td>
                                        <td style={{ fontSize: '12px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                {order.items.map((item, idx) => (
                                                    <span key={idx}>
                                                        {item.name} <span style={{ color: '#2563EB', fontWeight: 600 }}>(x{item.quantity})</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td style={{ textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>
                                            ${order.total?.toLocaleString() || '0'}
                                        </td>
                                        <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                            {order.shipping?.company || '-'}
                                        </td>

                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ReturnsRestocks;
