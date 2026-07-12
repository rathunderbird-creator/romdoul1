import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../context/StoreContext';
import { RefreshCw, ArrowLeft, RefreshCcw, Search, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHeader } from '../context/HeaderContext';
import { useToast } from '../context/ToastContext';
import { StatusBadge } from '../components';
import PaymentStatusBadge from '../components/PaymentStatusBadge';
import { getOperatorForPhone } from '../utils/telecom';
import { getPaymentLogo, getPaymentColor } from '../utils/payment';
import { getShippingLogo } from '../utils/shipping';
import { getShippingCoColor } from '../utils/orderUtils';
import { mapSaleEntity } from '../utils/mapper';
import type { Sale } from '../types';

const getStatusBorderColor = (s: string) => {
    switch (s) {
        case 'Pending': return '#D97706';
        case 'Confirmed': return '#0369A1';
        case 'Shipped': return '#2563EB';
        case 'Delivered': return '#059669';
        case 'Cancelled': return '#DC2626';
        case 'Returned': return '#DC2626';
        case 'ReStock': return '#7E22CE';
        case 'Ordered': return '#111827';
        default: return '#4B5563';
    }
};

export const DeletedOrdersContent: React.FC<{ isModal?: boolean }> = ({ isModal }) => {

    const [mappedOrders, setMappedOrders] = useState<(Sale & { deleted_at: string })[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const PAGE_SIZE = 50;

    // Column resize state
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('deleted_orders_column_widths');
        return saved ? JSON.parse(saved) : {};
    });
    const [resizingCol, setResizingCol] = useState<string | null>(null);
    const resizeRef = React.useRef<{ startX: number; startWidth: number; colId: string } | null>(null);

    const { restoreOrders } = useStore();
    const navigate = useNavigate();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();


    React.useEffect(() => {
        if (isModal) return;
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => navigate('/orders')}>
                        <ArrowLeft size={18} color="var(--color-text-secondary)" />
                        <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px', color: 'var(--color-text-main)' }}>Deleted Orders</h1>
                    </div>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>View and restore deleted orders</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, navigate, isModal]);

    const fetchDeletedOrders = async () => {
        setIsLoading(true);
        try {
            // Fetch deleted orders with their items
            const { data: orders, error: ordersErr } = await supabase
                .from('deleted_orders')
                .select('*')
                .order('deleted_at', { ascending: false });
            if (ordersErr) throw ordersErr;

            const orderIds = (orders || []).map(o => o.id);
            let items: any[] = [];
            if (orderIds.length > 0) {
                const { data: itemsData, error: itemsErr } = await supabase
                    .from('deleted_sale_items')
                    .select('*')
                    .in('sale_id', orderIds);
                if (itemsErr) throw itemsErr;
                items = itemsData || [];
            }

            // Attach items to each order and map through mapSaleEntity
            const mapped = (orders || []).map(order => {
                const orderItems = items.filter(i => i.sale_id === order.id);
                const saleEntity = mapSaleEntity({ ...order, items: orderItems });
                return { ...saleEntity, deleted_at: order.deleted_at };
            });

            setMappedOrders(mapped);
        } catch (err: any) {
            console.error('Error fetching deleted orders:', err);
            showToast('Failed to load deleted orders', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchDeletedOrders();
    }, []);

    const handleRestore = async (ids: string[]) => {
        if (!window.confirm(`Are you sure you want to restore ${ids.length} order(s)?`)) return;
        try {
            await restoreOrders(ids);
            showToast(`${ids.length} order(s) restored successfully`, 'success');
            setSelectedIds(new Set());
            fetchDeletedOrders();
        } catch (err: any) {
            showToast('Failed to restore order(s)', 'error');
        }
    };

    const handlePermanentDelete = async (ids: string[]) => {
        if (!window.confirm(`Permanently delete ${ids.length} order(s)? This cannot be undone.`)) return;
        try {
            for (const id of ids) {
                await supabase.from('deleted_sale_items').delete().eq('sale_id', id);
                await supabase.from('deleted_orders').delete().eq('id', id);
            }
            showToast(`${ids.length} order(s) permanently deleted`, 'success');
            setSelectedIds(new Set());
            fetchDeletedOrders();
        } catch (err: any) {
            showToast('Failed to delete order(s)', 'error');
        }
    };

    // Search filter
    const filteredOrders = useMemo(() => {
        if (!searchTerm.trim()) return mappedOrders;
        const terms = searchTerm.toLowerCase().split(/[\s,]+/).filter(Boolean);
        return mappedOrders.filter(order => {
            const searchable = [
                order.customer?.name,
                order.customer?.phone,
                order.customer?.address,
                order.salesman,
                order.remark,
                order.shipping?.trackingNumber,
                order.shipping?.company,
                order.total.toString(),
                order.id
            ].filter(Boolean).join(' ').toLowerCase();
            return terms.every(term => searchable.includes(term));
        });
    }, [mappedOrders, searchTerm]);

    // Pagination
    const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE);
    const paginatedOrders = filteredOrders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const toggleSelection = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredOrders.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredOrders.map(o => o.id)));
        }
    };

    const columns = [
        { id: 'date', label: 'Date', width: 100 },
        { id: 'deletedAt', label: 'Deleted At', width: 160 },
        { id: 'customer', label: 'Customer', width: 140 },
        { id: 'phone', label: 'Phone', width: 130 },
        { id: 'address', label: 'Address', width: 150 },
        { id: 'page', label: 'Page Name', width: 100 },
        { id: 'salesman', label: 'Salesman', width: 100 },
        { id: 'items', label: 'Products', width: 200 },
        { id: 'total', label: 'Total', width: 90 },
        { id: 'payBy', label: 'Pay By', width: 100 },
        { id: 'status', label: 'Order Status', width: 130 },
        { id: 'payStatus', label: 'Pay Status', width: 130 },
        { id: 'shippingCo', label: 'Shipping Co', width: 120 },
        { id: 'remark', label: 'Remark', width: 150 },
        { id: 'tracking', label: 'Tracking ID', width: 130 },
        { id: 'actions', label: 'Actions', width: 120 },
    ];

    // Persist column widths
    useEffect(() => {
        localStorage.setItem('deleted_orders_column_widths', JSON.stringify(columnWidths));
    }, [columnWidths]);

    // Resize handlers
    const startResize = (e: React.MouseEvent, colId: string) => {
        e.preventDefault();
        e.stopPropagation();
        const currentWidth = columnWidths[colId] || (e.currentTarget.parentElement?.getBoundingClientRect().width ?? 150);
        resizeRef.current = { startX: e.clientX, startWidth: currentWidth, colId };
        setResizingCol(colId);
        document.addEventListener('mousemove', handleGlobalMouseMove);
        document.addEventListener('mouseup', handleGlobalMouseUp);
        document.body.style.cursor = 'col-resize';
    };

    const handleGlobalMouseMove = React.useCallback((e: MouseEvent) => {
        if (!resizeRef.current) return;
        const { startX, startWidth, colId } = resizeRef.current;
        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);
        document.documentElement.style.setProperty(`--del-col-${colId}-width`, `${newWidth}px`);
    }, []);

    const handleGlobalMouseUp = React.useCallback((e: MouseEvent) => {
        if (!resizeRef.current) return;
        const { startX, startWidth, colId } = resizeRef.current;
        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);
        setColumnWidths(prev => ({ ...prev, [colId]: newWidth }));
        document.documentElement.style.removeProperty(`--del-col-${colId}-width`);
        resizeRef.current = null;
        setResizingCol(null);
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
        document.body.style.cursor = '';
    }, [handleGlobalMouseMove]);

    const autoFitColumn = (colId: string) => {
        const table = document.querySelector('.deleted-orders-table') as HTMLTableElement;
        if (!table) return;
        const colIndex = columns.findIndex(c => c.id === colId);
        if (colIndex === -1) return;
        const cellIndex = colIndex + 1;
        const measurer = document.createElement('div');
        measurer.style.cssText = 'position:absolute;visibility:hidden;height:auto;width:auto;white-space:nowrap;padding:0 12px;font-size:13px;font-family:inherit;';
        document.body.appendChild(measurer);
        let maxWidth = 40;
        const headerCell = table.tHead?.rows[0]?.cells[cellIndex];
        if (headerCell) {
            measurer.style.fontWeight = '600';
            measurer.textContent = (headerCell.textContent || '').trim();
            maxWidth = Math.max(maxWidth, measurer.scrollWidth + 40);
            measurer.style.fontWeight = '';
        }
        const rows = table.tBodies[0]?.rows;
        if (rows) {
            for (let i = 0; i < rows.length; i++) {
                const cell = rows[i]?.cells[cellIndex];
                if (cell) {
                    measurer.textContent = (cell.textContent || '').trim();
                    maxWidth = Math.max(maxWidth, measurer.scrollWidth);
                }
            }
        }
        document.body.removeChild(measurer);
        setColumnWidths(prev => ({ ...prev, [colId]: Math.min(Math.max(maxWidth, 40), 600) }));
    };

    const autoFitAllColumns = () => {
        const table = document.querySelector('.deleted-orders-table') as HTMLTableElement;
        if (!table) return;
        const measurer = document.createElement('div');
        measurer.style.cssText = 'position:absolute;visibility:hidden;height:auto;width:auto;white-space:nowrap;padding:0 12px;font-size:13px;font-family:inherit;';
        document.body.appendChild(measurer);
        const newWidths = { ...columnWidths };
        columns.forEach((col, colIndex) => {
            const cellIndex = colIndex + 1;
            let maxWidth = 40;
            const headerCell = table.tHead?.rows[0]?.cells[cellIndex];
            if (headerCell) {
                measurer.style.fontWeight = '600';
                measurer.textContent = (headerCell.textContent || '').trim();
                maxWidth = Math.max(maxWidth, measurer.scrollWidth + 40);
                measurer.style.fontWeight = '';
            }
            const rows = table.tBodies[0]?.rows;
            if (rows) {
                for (let i = 0; i < rows.length; i++) {
                    const cell = rows[i]?.cells[cellIndex];
                    if (cell) {
                        measurer.textContent = (cell.textContent || '').trim();
                        maxWidth = Math.max(maxWidth, measurer.scrollWidth);
                    }
                }
            }
            newWidths[col.id] = Math.min(Math.max(maxWidth, 40), 600);
        });
        document.body.removeChild(measurer);
        setColumnWidths(newWidths);
    };

    const getColWidth = (colId: string, defaultWidth: number) => {
        const w = columnWidths[colId];
        return `var(--del-col-${colId}-width, ${w ? `${w}px` : `${defaultWidth}px`})`;
    };

    return (
        <div>
            {/* Filter Bar */}
            <div className="glass-panel" style={{ marginBottom: '12px', padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                {/* Search */}
                <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                    <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                    <input
                        type="text"
                        placeholder="Search deleted orders..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="search-input"
                        style={{ paddingLeft: '36px', width: '100%', height: '40px', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                    />
                </div>

                {/* Bulk Actions */}
                {selectedIds.size > 0 && (
                    <>
                        <button
                            onClick={() => handleRestore(Array.from(selectedIds))}
                            style={{
                                padding: '0 16px', height: '40px', borderRadius: '8px',
                                background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
                                color: 'white', border: 'none', cursor: 'pointer',
                                fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px',
                                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)',
                                transition: 'all 0.2s'
                            }}
                        >
                            <RefreshCcw size={16} /> Restore ({selectedIds.size})
                        </button>
                        <button
                            onClick={() => handlePermanentDelete(Array.from(selectedIds))}
                            style={{
                                padding: '0 16px', height: '40px', borderRadius: '8px',
                                background: '#FEE2E2',
                                color: '#DC2626', border: 'none', cursor: 'pointer',
                                fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px',
                                transition: 'all 0.2s'
                            }}
                        >
                            <Trash2 size={16} /> Delete Forever ({selectedIds.size})
                        </button>
                    </>
                )}

                {/* Refresh */}
                <button
                    disabled={isLoading}
                    onClick={() => {
                        const btn = document.getElementById('refresh-deleted-btn');
                        if (btn) btn.style.animation = 'spin 1s linear infinite';
                        fetchDeletedOrders().finally(() => {
                            if (btn) btn.style.animation = 'none';
                        });
                    }}
                    style={{
                        padding: '10px', borderRadius: '8px',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)',
                        color: 'var(--color-text-secondary)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    title="Refresh"
                >
                    <RefreshCw id="refresh-deleted-btn" size={18} />
                </button>
                <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
            </div>

            {/* Table */}
            <div style={{
                overflowX: 'auto',
                overflowY: 'auto',
                maxHeight: 'calc(100vh - 200px)',
            }}>
                <table
                    className="spreadsheet-table deleted-orders-table"
                    style={{
                        minWidth: '100%',
                        whiteSpace: 'nowrap',
                        tableLayout: 'fixed',
                        borderCollapse: 'separate',
                        borderSpacing: 0,
                        ['--table-font-size' as any]: '13px',
                        ['--table-padding' as any]: '8px 6px',
                    }}
                >
                    <thead>
                        <tr>
                            <th style={{ width: '40px', padding: '10px 12px', position: 'sticky', left: 0, top: 0, zIndex: 40, background: '#e5e7eb' }}>
                                <input
                                    type="checkbox"
                                    checked={filteredOrders.length > 0 && selectedIds.size === filteredOrders.length}
                                    onChange={toggleSelectAll}
                                    style={{ cursor: 'pointer' }}
                                />
                                <div
                                    onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); autoFitAllColumns(); }}
                                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '10px', cursor: 'col-resize', background: 'transparent', zIndex: 25, transform: 'translateX(50%)' }}
                                    className="resize-handle"
                                    title="Double click to auto-fit all columns"
                                />
                            </th>
                            {columns.map(col => (
                                <th
                                    key={col.id}
                                    style={{
                                        width: getColWidth(col.id, col.width),
                                        minWidth: getColWidth(col.id, col.width),
                                        overflow: 'hidden',
                                        borderRight: resizingCol === col.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                        transition: 'border-color 0.1s',
                                        padding: 0,
                                        position: 'sticky',
                                        top: 0,
                                        zIndex: 30,
                                        background: '#e5e7eb',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                                    </div>
                                    <div
                                        onMouseDown={(e) => startResize(e, col.id)}
                                        onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); autoFitColumn(col.id); }}
                                        style={{
                                            position: 'absolute', right: 0, top: 0, bottom: 0, width: '10px',
                                            cursor: 'col-resize', background: 'transparent', zIndex: 25, transform: 'translateX(50%)'
                                        }}
                                        className="resize-handle"
                                    />
                                </th>
                            ))}
                            <th style={{ width: '100%', minWidth: 'auto', background: '#e5e7eb', borderBottom: '1px solid var(--color-border)' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr>
                                <td colSpan={columns.length + 2} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>
                                    Loading deleted orders...
                                </td>
                            </tr>
                        ) : paginatedOrders.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length + 2} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>
                                    No deleted orders found.
                                </td>
                            </tr>
                        ) : (
                            paginatedOrders.map((order) => {
                                const isSelected = selectedIds.has(order.id);

                                const cellStyle: React.CSSProperties = {
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    fontSize: 'var(--table-font-size, 13px)',
                                    padding: 'var(--table-padding, 8px 6px)',
                                };

                                return (
                                    <tr
                                        key={order.id}
                                        style={{
                                            background: isSelected ? '#EFF6FF' : undefined,
                                            transition: 'background 0.1s'
                                        }}
                                    >
                                        <td style={{
                                            textAlign: 'center',
                                            position: 'sticky',
                                            left: 0,
                                            zIndex: 15,
                                            borderLeft: `2px solid ${getStatusBorderColor(order.shipping?.status || 'Pending')}`,
                                            background: isSelected ? '#EFF6FF' : 'white'
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleSelection(order.id)}
                                                style={{ cursor: 'pointer' }}
                                            />
                                        </td>

                                        {/* Date */}
                                        <td style={cellStyle}>{new Date(order.date).toLocaleDateString()}</td>

                                        {/* Deleted At */}
                                        <td style={{ ...cellStyle, fontSize: '11px', color: '#DC2626' }}>
                                            {new Date(order.deleted_at).toLocaleString()}
                                        </td>

                                        {/* Customer */}
                                        <td style={{ ...cellStyle, fontWeight: 500 }}>{order.customer?.name || '-'}</td>

                                        {/* Phone */}
                                        <td style={cellStyle}>
                                            {(() => {
                                                const operator = getOperatorForPhone(order.customer?.phone);
                                                return (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        {operator && <img src={operator.logo} alt={operator.name} style={{ width: '16px', height: '16px', objectFit: 'contain', borderRadius: '2px' }} title={operator.name} />}
                                                        <span>{order.customer?.phone || '-'}</span>
                                                    </div>
                                                );
                                            })()}
                                        </td>

                                        {/* Address */}
                                        <td style={cellStyle}>{order.customer?.address || '-'}</td>

                                        {/* Page */}
                                        <td style={cellStyle}>{order.customer?.page || '-'}</td>

                                        {/* Salesman */}
                                        <td style={cellStyle}>{order.salesman || '-'}</td>

                                        {/* Products */}
                                        <td style={cellStyle}>
                                            <div style={{ fontSize: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {order.items.map(i => `${i.name} x${i.quantity}`).join(', ') || '-'}
                                            </div>
                                        </td>

                                        {/* Total */}
                                        <td style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'right' }}>${order.total.toFixed(2)}</td>

                                        {/* Pay By */}
                                        <td style={cellStyle}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                {order.paymentMethod && getPaymentLogo(order.paymentMethod) && (
                                                    <img src={getPaymentLogo(order.paymentMethod)!} alt="payby logo" style={{ width: '14px', height: '14px', borderRadius: '2px', objectFit: 'contain' }} />
                                                )}
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: getPaymentColor(order.paymentMethod) }}>{order.paymentMethod || '-'}</span>
                                            </div>
                                        </td>

                                        {/* Order Status */}
                                        <td style={{ ...cellStyle, overflow: 'visible' }}>
                                            <StatusBadge
                                                status={order.shipping?.status || 'Pending'}
                                                readOnly={true}
                                            />
                                        </td>

                                        {/* Pay Status */}
                                        <td style={{ ...cellStyle, overflow: 'visible' }}>
                                            <PaymentStatusBadge
                                                status={order.paymentStatus || 'Unpaid'}
                                                readOnly={true}
                                                disabledOptions={[]}
                                            />
                                        </td>

                                        {/* Shipping Co */}
                                        <td style={{ ...cellStyle, color: getShippingCoColor(order.shipping?.company || '') }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                {order.shipping?.company && getShippingLogo(order.shipping.company) && (
                                                    <img src={getShippingLogo(order.shipping.company)!} alt="shipping logo" style={{ width: '14px', height: '14px', borderRadius: '50%', objectFit: 'cover' }} />
                                                )}
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{order.shipping?.company || '-'}</span>
                                            </div>
                                        </td>

                                        {/* Remark */}
                                        <td style={{ ...cellStyle, fontFamily: 'Battambang' }}>{order.remark || '-'}</td>

                                        {/* Tracking */}
                                        <td style={{ ...cellStyle, fontFamily: 'monospace' }}>{order.shipping?.trackingNumber || '-'}</td>

                                        {/* Actions */}
                                        <td style={{ ...cellStyle, overflow: 'visible' }}>
                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                <button
                                                    onClick={() => handleRestore([order.id])}
                                                    style={{
                                                        padding: '4px 10px', borderRadius: '6px',
                                                        background: '#DBEAFE', color: '#2563EB',
                                                        border: 'none', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', gap: '4px',
                                                        fontWeight: 600, fontSize: '12px',
                                                        transition: 'all 0.2s'
                                                    }}
                                                    title="Restore Order"
                                                >
                                                    <RefreshCcw size={13} /> Restore
                                                </button>
                                                <button
                                                    onClick={() => handlePermanentDelete([order.id])}
                                                    style={{
                                                        padding: '4px 8px', borderRadius: '6px',
                                                        background: '#FEE2E2', color: '#DC2626',
                                                        border: 'none', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center',
                                                        transition: 'all 0.2s'
                                                    }}
                                                    title="Delete Forever"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </td>

                                        <td style={{ width: '100%', minWidth: 'auto' }}></td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination & Summary Footer */}
            <div className="glass-panel" style={{
                marginTop: '12px', padding: '12px 16px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px'
            }}>
                <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                    Showing {filteredOrders.length === 0 ? 0 : ((currentPage - 1) * PAGE_SIZE + 1)}–{Math.min(currentPage * PAGE_SIZE, filteredOrders.length)} of {filteredOrders.length} deleted orders
                    {selectedIds.size > 0 && <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}> · {selectedIds.size} selected</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage(p => p - 1)}
                        style={{
                            padding: '6px 12px', borderRadius: '6px',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)',
                            cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                            opacity: currentPage <= 1 ? 0.5 : 1,
                            display: 'flex', alignItems: 'center'
                        }}
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span style={{ fontSize: '13px', fontWeight: 500 }}>
                        {currentPage} / {totalPages || 1}
                    </span>
                    <button
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage(p => p + 1)}
                        style={{
                            padding: '6px 12px', borderRadius: '6px',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)',
                            cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
                            opacity: currentPage >= totalPages ? 0.5 : 1,
                            display: 'flex', alignItems: 'center'
                        }}
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};

const DeletedOrders: React.FC = () => <DeletedOrdersContent />;

export default DeletedOrders;
