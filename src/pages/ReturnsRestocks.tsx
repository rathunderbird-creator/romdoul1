import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Search, Layers, ArrowDown, Boxes, AlertTriangle, ArchiveRestore } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { supabase } from '../lib/supabase';
import { useMobile } from '../hooks/useMobile';
import StatsCard from '../components/StatsCard';
import DateRangePicker from '../components/DateRangePicker';
import type { Sale } from '../types';
import { getShippingCoColor } from '../utils/orderUtils';
import { useLanguage } from '../context/LanguageContext';
import { fill } from '../i18n/translate';

const ReturnsRestocks: React.FC = () => {
    const { bulkRestockOrders, salesUpdatedAt } = useStore();
    const isMobile = useMobile();
    const { t } = useLanguage();
    // Text under ui.orderFlow; the English text is the fallback for a missing key.
    const tx = useCallback((key: string, en: string, vars?: Record<string, string | number>) => {
        const k = `ui.orderFlow.${key}`;
        const v = t(k);
        return fill(v !== k ? v : en, vars);
    }, [t]);

    // Historical Orders State
    const [returnedOrders, setReturnedOrders] = useState<Sale[]>([]);
    const [returnedSearchTerm, setReturnedSearchTerm] = useState('');
    const [restockedHistory, setRestockedHistory] = useState<Sale[]>([]);
    const [restockedSearchTerm, setRestockedSearchTerm] = useState('');
    
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

    const filteredRestockedHistory = useMemo(() => {
        if (!restockedSearchTerm.trim()) return restockedHistory;
        const query = restockedSearchTerm.trim().toLowerCase();
        return restockedHistory.filter(order => 
            order.id.toLowerCase().includes(query) || 
            (order.customer?.name || '').toLowerCase().includes(query) ||
            String(order.customer?.phone || '').toLowerCase().includes(query) ||
            order.items.some(item => item.name.toLowerCase().includes(query))
        );
    }, [restockedHistory, restockedSearchTerm]);

    const toggleSelectAllReturnedOrders = () => {
        if (selectedReturnedOrderIds.size === filteredReturnedOrders.length && filteredReturnedOrders.length > 0) {
            setSelectedReturnedOrderIds(new Set());
        } else {
            setSelectedReturnedOrderIds(new Set(filteredReturnedOrders.map(o => o.id)));
        }
    };

    const handleBulkRestock = async () => {
        if (selectedReturnedOrderIds.size === 0) return;
        if (!confirm(tx('returns.confirmBulk', 'Are you sure you want to restock {n} orders?', { n: selectedReturnedOrderIds.size }))) return;
        
        setIsRestocking(true);
        try {
            const requested = selectedReturnedOrderIds.size;
            const restocked = await bulkRestockOrders(Array.from(selectedReturnedOrderIds));
            setSelectedReturnedOrderIds(new Set());
            alert(restocked === requested
                ? tx('returns.success', 'Successfully Added Product back to Stock')
                : tx('returns.partial', 'Added {done} of {n} orders back to stock. The others are no longer Returning (already restocked or changed by someone else).', { done: restocked, n: requested }));
            await fetchHistoricalOrders();
        } catch (error: any) {
             console.error("Bulk restock failed:", error);
             alert(tx('returns.bulkFailed', 'Failed to restock some orders: ') + error.message);
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
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 8px 0', color: 'var(--color-primary)' }}>{tx('returns.title', 'Returns & Restocks')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>{tx('returns.subtitle', 'Manage returned orders and restock history.')}</p>
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
                <StatsCard title={tx('returns.pendingReturns', 'Pending Returns')} value={returnedOrders.length} icon={AlertTriangle} color="#DC2626" trend={tx('returns.itemsWaiting', '{n} items waiting', { n: returnedItemsCount })} />
                <StatsCard title={tx('returns.restockedOrders', 'Restocked Orders')} value={restockedHistory.length} icon={ArchiveRestore} color="#2563EB" trend={tx('returns.itemsRestocked', '{n} items restocked', { n: restockedItemsCount })} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '24px', height: isMobile ? 'auto' : 'calc(var(--vh-full) - 300px)' }}>
                {/* ReStock Table (Returned Orders) */}
                <div className="glass-panel" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', border: '1px solid #FCA5A5', minHeight: isMobile ? '400px' : 'auto' }}>
                    <h3 style={{ padding: '16px 20px', borderBottom: '1px solid #FCA5A5', margin: 0, fontSize: '15px', fontWeight: 600, color: '#DC2626', background: '#FEF2F2', display: 'flex', alignItems: 'center', gap: '8px', position: 'sticky', top: 0, zIndex: 10 }}>
                        <AlertTriangle size={16} /> {tx('returns.returningOrders', 'Returning Orders')}
                        {selectedReturnedOrderIds.size > 0 && (
                            <button 
                                onClick={handleBulkRestock}
                                disabled={isRestocking}
                                style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: '11px', backgroundColor: '#DC2626', color: 'white', border: 'none', borderRadius: '4px', cursor: isRestocking ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', opacity: isRestocking ? 0.7 : 1 }}
                            >
                                <ArrowDown size={12} />
                                {isRestocking ? tx('returns.restocking', 'Restocking...') : tx('returns.restockSelected', 'Restock Selected ({n})', { n: selectedReturnedOrderIds.size })}
                            </button>
                        )}
                    </h3>
                    {returnedOrders.length > 0 && (
                        <div style={{ padding: '8px 16px', background: '#FEF2F2', borderBottom: '1px solid #FCA5A5' }}>
                            <div style={{ position: 'relative' }}>
                                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#DC2626' }} />
                                <input
                                    type="text"
                                    placeholder={tx('returns.search', 'Search by ID, Customer, Phone, Item...')}
                                    value={returnedSearchTerm}
                                    onChange={(e) => setReturnedSearchTerm(e.target.value)}
                                    style={{ width: '100%', paddingLeft: '32px', paddingRight: '12px', paddingTop: '6px', paddingBottom: '6px', border: '1px solid #FCA5A5', borderRadius: '6px', fontSize: '12px', outline: 'none', background: 'var(--color-surface)' }}
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
                                {returnedOrders.length === 0 ? tx('returns.emptyReturned', 'No returned orders pending restock.') : tx('returns.noMatch', 'No matching orders found.')}
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
                                    <th>{tx('returns.col.date', 'Date')}</th>
                                    <th>{tx('returns.col.orderCustomer', 'Order / Customer')}</th>
                                    <th>{tx('returns.col.phone', 'Phone')}</th>
                                    <th>{tx('returns.col.items', 'Items')}</th>
                                    <th style={{ textAlign: 'right' }}>{tx('returns.col.total', 'Total')}</th>
                                    <th>{tx('returns.col.shippingCo', 'Shipping Co')}</th>
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
                                            <div style={{ fontWeight: 600, fontSize: '13px' }}>#{order.id.slice(-6)}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{order.customer?.name || tx('om2.unknown', 'Unknown')}</div>
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
                                        <td style={{ fontSize: '12px', color: getShippingCoColor(order.shipping?.company || '') }}>
                                            {order.shipping?.company || '-'}
                                        </td>


                                        <td style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                                            <button
                                                onClick={async () => {
                                                    if (confirm(tx('returns.confirmOne', 'Restock items from this order?'))) {
                                                        try {
                                                            // The same Restock flow as the bulk button: only a Returned order, stock and
                                                            // the return record, payment Cancel (PdFee kept) and income cleanup.
                                                            const restocked = await bulkRestockOrders([order.id]);
                                                            alert(restocked > 0 ? tx('returns.success', 'Successfully Added Product back to Stock') : tx('returns.noLongerReturning', 'This order is no longer Returning (already restocked or changed by someone else), so nothing was added.'));
                                                            await fetchHistoricalOrders();
                                                        } catch (error: any) {
                                                            console.error("Restock failed:", error);
                                                            alert(tx('returns.failed', 'Failed to restock: ') + error.message);
                                                        }
                                                    }
                                                }}
                                                className="primary-button"
                                                title={tx('returns.restockItems', 'Restock Items')}
                                                style={{ padding: '6px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                                            >
                                                <ArrowDown size={14} /> {tx('returns.restock', 'Restock')}
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
                        <Layers size={16} /> {tx('returns.history', 'Restocked History')}
                    </h3>
                    {restockedHistory.length > 0 && (
                        <div style={{ padding: '8px 16px', background: '#EFF6FF', borderBottom: '1px solid #BFDBFE' }}>
                            <div style={{ position: 'relative' }}>
                                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#2563EB' }} />
                                <input
                                    type="text"
                                    placeholder={tx('returns.search', 'Search by ID, Customer, Phone, Item...')}
                                    value={restockedSearchTerm}
                                    onChange={(e) => setRestockedSearchTerm(e.target.value)}
                                    style={{ width: '100%', paddingLeft: '32px', paddingRight: '12px', paddingTop: '6px', paddingBottom: '6px', border: '1px solid #BFDBFE', borderRadius: '6px', fontSize: '12px', outline: 'none', background: 'var(--color-surface)' }}
                                />
                            </div>
                        </div>
                    )}
                    {filteredRestockedHistory.length === 0 ? (
                        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                            <p style={{ fontSize: '13px', fontWeight: 500 }}>
                                {restockedHistory.length === 0 ? tx('returns.emptyHistory', 'No restocked orders found.') : tx('returns.noMatch', 'No matching orders found.')}
                            </p>
                        </div>
                    ) : (
                        <table className="spreadsheet-table">
                            <thead style={{ background: '#EFF6FF' }}>
                                <tr>
                                    <th>{tx('returns.col.date', 'Date')}</th>
                                    <th>{tx('returns.col.orderCustomer', 'Order / Customer')}</th>
                                    <th>{tx('returns.col.phone', 'Phone')}</th>
                                    <th>{tx('returns.col.itemsRestocked', 'Items Restocked')}</th>
                                    <th style={{ textAlign: 'right' }}>{tx('returns.col.total', 'Total')}</th>
                                    <th>{tx('returns.col.shippingCo', 'Shipping Co')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRestockedHistory.map(order => (
                                    <tr key={order.id} style={{ background: '#EFF6FF' }}>
                                        <td style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                                            {new Date(order.date).toLocaleDateString()}
                                        </td>
                                        <td style={{ whiteSpace: 'normal' }}>
                                            <div style={{ fontWeight: 600, fontSize: '13px' }}>#{order.id.slice(-6)}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{order.customer?.name || tx('om2.unknown', 'Unknown')}</div>
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
                                        <td style={{ fontSize: '12px', color: getShippingCoColor(order.shipping?.company || '') }}>
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
