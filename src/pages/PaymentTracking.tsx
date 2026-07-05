import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useNavigate } from 'react-router-dom';
import { Search, X, Settings, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, RefreshCw, FileText, Wallet, Copy, Edit, Trash2 } from 'lucide-react';
import type { Sale } from '../types';
import { PaymentStatusBadge, DateRangePicker, StatusBadge, SettlePaymentModal, POSInterface, BulkEditModal } from '../components';
import { supabase } from '../lib/supabase';
import { mapSaleEntity } from '../utils/mapper';
import { useClickOutside } from '../hooks/useClickOutside';
import { getShippingCoColor, generateOrderCopyText } from '../utils/orderUtils';
import { getOperatorForPhone } from '../utils/telecom';
import { getPaymentLogo, getPaymentColor } from '../utils/payment';
import { getShippingLogo } from '../utils/shipping';
import ReportModal from '../components/ReportModal';
import Modal from '../components/Modal';
import IncomeExpense from './IncomeExpense';

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

const PaymentTracking: React.FC = () => {
    const { updateOrder, updateOrders, updateOrderStatus, restockOrder, salesUpdatedAt, currentUser, users, shippingCompanies, customerCare, refreshData, deleteOrders } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const navigate = useNavigate();

    const [isReportOpen, setIsReportOpen] = useState(false);
    const [isIncomeModalOpen, setIsIncomeModalOpen] = useState(false);

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Payment Tracking</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Track payments and settlements</p>
                </div>
            ),
            actions: (
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => setIsIncomeModalOpen(true)}
                        style={{
                            padding: '8px 20px',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'linear-gradient(135deg, #10B981, #059669)',
                            color: 'white',
                            fontWeight: 600,
                            fontSize: '13px',
                            cursor: 'pointer',
                            border: 'none',
                            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)'; }}
                    >
                        <Wallet size={16} />
                        Check Income
                    </button>
                    <button
                        onClick={() => setIsReportOpen(true)}
                        style={{
                            padding: '8px 20px',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                            color: 'white',
                            fontWeight: 600,
                            fontSize: '13px',
                            cursor: 'pointer',
                            border: 'none',
                            boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.4)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(99, 102, 241, 0.3)'; }}
                    >
                        <FileText size={16} />
                        Check Payment Tracking Report
                    </button>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, navigate]);

    const [searchTerm, setSearchTerm] = useState('');
    const [settleDateRange, setSettleDateRange] = useState({ start: '', end: '' });
    const [orderDateRange, setOrderDateRange] = useState({ start: '', end: '' });
    const [statusFilter, setStatusFilter] = useState<'All' | 'Unpaid' | 'Paid' | 'Get File' | 'Cancel'>(() => {
        return (localStorage.getItem('payment_statusFilter') as any) || 'All';
    });
    const [salesmanFilter, setSalesmanFilter] = useState<string>(() => {
        return localStorage.getItem('payment_salesmanFilter') || 'All';
    });
    const [shippingCoFilter, setShippingCoFilter] = useState<string[]>(() => {
        const saved = localStorage.getItem('payment_shippingCoFilter');
        return saved ? JSON.parse(saved) : [];
    });
    const [customerCareFilter, setCustomerCareFilter] = useState<string>(() => {
        return localStorage.getItem('payment_customerCareFilter') || 'All';
    });

    useEffect(() => { localStorage.setItem('payment_statusFilter', statusFilter); }, [statusFilter]);
    useEffect(() => { localStorage.setItem('payment_salesmanFilter', salesmanFilter); }, [salesmanFilter]);
    useEffect(() => { localStorage.setItem('payment_shippingCoFilter', JSON.stringify(shippingCoFilter)); }, [shippingCoFilter]);
    useEffect(() => { localStorage.setItem('payment_customerCareFilter', customerCareFilter); }, [customerCareFilter]);

    const [isSalesmanOpen, setIsSalesmanOpen] = useState(false);
    const [isShippingCoOpen, setIsShippingCoOpen] = useState(false);
    const [isCustomerCareOpen, setIsCustomerCareOpen] = useState(false);
    const salesmanFilterRef = useClickOutside<HTMLDivElement>(() => setIsSalesmanOpen(false));
    const shippingCoFilterRef = useClickOutside<HTMLDivElement>(() => setIsShippingCoOpen(false));
    const customerCareFilterRef = useClickOutside<HTMLDivElement>(() => setIsCustomerCareOpen(false));
    const filterShippingCompanies = useMemo(() => {
        return ['អ្នកដឹក', ...shippingCompanies];
    }, [shippingCompanies]);
    const isMobile = window.innerWidth <= 768;

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        } else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            setSortConfig(null);
            return;
        }
        setSortConfig({ key, direction });
    };

    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

    const toggleSelection = (id: string, e?: React.MouseEvent) => {
        if (e && e.shiftKey && lastSelectedId) {
            const currentIndex = paginatedOrders.findIndex(o => o.id === id);
            const lastIndex = paginatedOrders.findIndex(o => o.id === lastSelectedId);

            if (currentIndex !== -1 && lastIndex !== -1) {
                const start = Math.min(currentIndex, lastIndex);
                const end = Math.max(currentIndex, lastIndex);
                const idsToSelect = paginatedOrders.slice(start, end + 1).map(o => o.id);
                
                const newSet = new Set(selectedIds);
                const isSelecting = !newSet.has(id);

                idsToSelect.forEach(itemId => {
                    if (isSelecting) {
                        newSet.add(itemId);
                    } else {
                        newSet.delete(itemId);
                    }
                });
                
                setSelectedIds(newSet);
                setLastSelectedId(id);
                return;
            }
        }

        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
        setLastSelectedId(id);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === trackingOrders.length && trackingOrders.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(trackingOrders.map(o => o.id)));
        }
    };

    const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);

    const handleBulkEdit = async (field: 'date' | 'status' | 'paymentStatus' | 'settleDate', value: any) => {
        if (selectedIds.size === 0) return;

        try {
            let ids = Array.from(selectedIds);
            const updates: Partial<Sale> = {};

            if (field === 'date') {
                updates.date = new Date(value).toISOString();
                await updateOrders(ids, updates);
            } else if (field === 'settleDate') {
                updates.settleDate = new Date(value).toISOString();
                await updateOrders(ids, updates);
            } else if (field === 'status') {
                updates.shipping = { status: value } as any;
                await updateOrders(ids, updates);
            } else if (field === 'paymentStatus') {
                const now = new Date().toISOString();
                const promises = ids.map(id => {
                    const order = serverOrders.find(s => s.id === id);
                    if (!order) return Promise.resolve();
                    
                    const individualUpdates: Partial<Sale> = { paymentStatus: value };
                    
                    if (value === 'Paid' || value === 'Settled' || value === 'Get File') {
                        individualUpdates.amountReceived = order.total;
                        individualUpdates.settleDate = now;
                    } else if (value === 'Cancel' || value === 'Unpaid') {
                        individualUpdates.amountReceived = 0;
                        individualUpdates.settleDate = null as any;
                    }
                    
                    return updateOrder(id, individualUpdates);
                });
                await Promise.all(promises);
            }

            setSelectedIds(new Set());
            setIsBulkEditOpen(false);
            showToast(`Successfully updated ${ids.length} orders`, 'success');
        } catch (error) {
            console.error('Bulk edit error:', error);
            showToast('Failed to update orders', 'error');
        }
    };

    const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isEditOrderModalOpen, setIsEditOrderModalOpen] = useState(false);

    const handleCopyOrder = (order: Sale) => {
        const textToCopy = generateOrderCopyText(order, []);
        navigator.clipboard.writeText(textToCopy);
        showToast('Order info copied!', 'success');
    };

    const handleOpenEdit = (order: Sale) => {
        setSelectedOrder(order);
        setIsEditOrderModalOpen(true);
    };

    const handleCloseEdit = () => {
        setSelectedOrder(null);
        setIsEditOrderModalOpen(false);
    };

    // Column Visibility
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const allColumns = [
        { id: 'actions', label: 'Actions' },
        { id: 'date', label: 'Order Date' },
        { id: 'settleDate', label: 'Settle Date' },
        { id: 'customer', label: 'Customer' },
        { id: 'phone', label: 'Phone' },
        { id: 'address', label: 'Address' },
        { id: 'salesman', label: 'Salesman' },
        { id: 'items', label: 'Products' },
        { id: 'total', label: 'Total' },
        { id: 'shippingCo', label: 'Shipping Co' },
        { id: 'trackingId', label: 'Tracking ID' },
        { id: 'payBy', label: 'Pay By' },
        { id: 'received', label: 'Received' },
        { id: 'remaining', label: 'Remaining' },
        { id: 'orderStatus', label: 'Order Status' },
        { id: 'status', label: 'Pay Status' },
        { id: 'remark', label: 'Remark' },
    ];
    // Default visible
    const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
        const saved = localStorage.getItem('payment_visibleColumns');
        if (saved) {
            try { return JSON.parse(saved); } catch (e) {}
        }
        return [
            'actions', 'date', 'settleDate', 'customer', 'phone', 'address', 'salesman', 'items', 'total', 'shippingCo', 'trackingId', 'payBy', 'received', 'remaining', 'orderStatus', 'status', 'remark'
        ];
    });

    React.useEffect(() => {
        localStorage.setItem('payment_visibleColumns', JSON.stringify(visibleColumns));
    }, [visibleColumns]);

    // Column widths and resize state
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('payment_column_widths');
        return saved ? JSON.parse(saved) : {
            actions: 60,
            date: 110,
            settleDate: 110,
            customer: 140,
            phone: 110,
            address: 200,
            salesman: 100,
            items: 200,
            total: 90,
            shippingCo: 110,
            trackingId: 120,
            payBy: 90,
            received: 90,
            remaining: 90,
            orderStatus: 130,
            status: 120,
            remark: 150
        };
    });

    React.useEffect(() => {
        localStorage.setItem('payment_column_widths', JSON.stringify(columnWidths));
    }, [columnWidths]);

    const [resizingCol, setResizingCol] = useState<string | null>(null);
    const resizeRef = React.useRef<{ startX: number; startWidth: number; colId: string } | null>(null);

    const handleGlobalMouseMove = React.useCallback((e: MouseEvent) => {
        if (!resizeRef.current) return;
        const { startX, startWidth, colId } = resizeRef.current;
        const diff = e.clientX - startX;
        const newWidth = Math.max(15, startWidth + diff);
        document.documentElement.style.setProperty(`--col-payment-${colId}-width`, `${newWidth}px`);
    }, []);

    const handleGlobalMouseUp = React.useCallback((e: MouseEvent) => {
        if (!resizeRef.current) return;
        const { startX, startWidth, colId } = resizeRef.current;
        const diff = e.clientX - startX;
        const newWidth = Math.max(15, startWidth + diff);

        setColumnWidths(prev => ({ ...prev, [colId]: newWidth }));
        document.documentElement.style.removeProperty(`--col-payment-${colId}-width`);

        resizeRef.current = null;
        setResizingCol(null);
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
        document.body.style.cursor = '';
    }, [handleGlobalMouseMove]);

    const startResize = (e: React.MouseEvent, colId: string) => {
        e.preventDefault();
        e.stopPropagation();
        const currentWidth = columnWidths[colId] || 150;
        resizeRef.current = { startX: e.clientX, startWidth: currentWidth, colId };
        setResizingCol(colId);
        document.addEventListener('mousemove', handleGlobalMouseMove);
        document.addEventListener('mouseup', handleGlobalMouseUp);
        document.body.style.cursor = 'col-resize';
    };

    React.useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleGlobalMouseMove);
            document.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [handleGlobalMouseMove, handleGlobalMouseUp]);

    const autoFitColumn = (colId: string) => {
        const table = document.querySelector('.spreadsheet-table') as HTMLTableElement;
        if (!table) return;

        const visibleCols = allColumns.filter(c => visibleColumns.includes(c.id));
        const colIndex = visibleCols.findIndex(c => c.id === colId);
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
            maxWidth = Math.max(maxWidth, measurer.scrollWidth + 28);
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
        const finalWidth = Math.min(Math.max(maxWidth, 40), 600);

        if (resizeRef.current && resizeRef.current.colId === colId) {
            document.documentElement.style.removeProperty(`--col-payment-${colId}-width`);
            resizeRef.current = null;
            setResizingCol(null);
            document.removeEventListener('mousemove', handleGlobalMouseMove);
            document.removeEventListener('mouseup', handleGlobalMouseUp);
            document.body.style.cursor = '';
        }

        setColumnWidths(prev => ({ ...prev, [colId]: finalWidth }));
    };

    const autoFitAllColumns = () => {
        const table = document.querySelector('.spreadsheet-table') as HTMLTableElement;
        if (!table) return;

        const visibleCols = allColumns.filter(c => visibleColumns.includes(c.id));
        
        const measurer = document.createElement('div');
        measurer.style.cssText = 'position:absolute;visibility:hidden;height:auto;width:auto;white-space:nowrap;padding:0 12px;font-size:13px;font-family:inherit;';
        document.body.appendChild(measurer);

        const newWidths = { ...columnWidths };

        visibleCols.forEach((col, colIndex) => {
            const cellIndex = colIndex + 1; // +1 for checkbox column
            let maxWidth = 40;

            const headerCell = table.tHead?.rows[0]?.cells[cellIndex];
            if (headerCell) {
                measurer.style.fontWeight = '600';
                measurer.textContent = (headerCell.textContent || '').trim();
                maxWidth = Math.max(maxWidth, measurer.scrollWidth + 28);
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

    const [formData, setFormData] = useState({
        amountReceived: 0,
        settleDate: '',
        paymentStatus: 'Paid' as 'Unpaid' | 'Paid' | 'Get File' | 'Cancel'
    });

    // Select Payment Method Modal State
    const [isPaymentMethodModalOpen, setIsPaymentMethodModalOpen] = useState(false);
    const [paymentMethodTargetOrder, setPaymentMethodTargetOrder] = useState<Sale | null>(null);

    // Server-side fetching (same pattern as Orders Management)
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(200);
    const [totalCount, setTotalCount] = useState(0);
    const [serverOrders, setServerOrders] = useState<Sale[]>([]);
    const [, setIsLoadingOrders] = useState(false);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, statusFilter, salesmanFilter, shippingCoFilter, customerCareFilter, settleDateRange, orderDateRange, itemsPerPage, sortConfig]);

    const fetchOrders = React.useCallback(async () => {
        setIsLoadingOrders(true);
        try {
            let query = supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)', { count: 'exact' });

            // Payment status filter
            if (statusFilter !== 'All') {
                query = query.eq('payment_status', statusFilter);
            }

            // Salesman filter
            const isSalesman = currentUser?.roleId === 'salesman';
            const effectiveSalesmanFilter = (isSalesman && salesmanFilter === 'All') ? (currentUser?.name || 'All') : salesmanFilter;
            if (effectiveSalesmanFilter !== 'All') {
                query = query.eq('salesman', effectiveSalesmanFilter);
            }

            // Shipping Co filter
            if (shippingCoFilter.length > 0) {
                query = query.in('shipping_company', shippingCoFilter);
            }

            // Customer Care filter
            if (customerCareFilter !== 'All') {
                query = query.eq('customer_care', customerCareFilter);
            }

            // Settle Date range filter
            if (settleDateRange.start) {
                const start = new Date(settleDateRange.start);
                start.setHours(0, 0, 0, 0);
                query = query.gte('settle_date', start.toISOString());
            }
            if (settleDateRange.end) {
                const end = new Date(settleDateRange.end);
                end.setHours(23, 59, 59, 999);
                query = query.lte('settle_date', end.toISOString());
            }

            // Order Date range filter
            if (orderDateRange.start) {
                const start = new Date(orderDateRange.start);
                start.setHours(0, 0, 0, 0);
                query = query.gte('date', start.toISOString());
            }
            if (orderDateRange.end) {
                const end = new Date(orderDateRange.end);
                end.setHours(23, 59, 59, 999);
                query = query.lte('date', end.toISOString());
            }

            // Search term
            if (searchTerm.trim()) {
                const trimmedTerm = searchTerm.trim();
                const isExact = trimmedTerm.startsWith('"') && trimmedTerm.endsWith('"');
                const phrase = isExact ? trimmedTerm.slice(1, -1) : trimmedTerm;
                const terms = isExact ? (phrase ? [phrase] : []) : phrase.split(/[\s,]+/).filter(t => t.trim().length > 0);

                if (terms.length > 0) {
                    const isBulk = terms.length > 10;

                    let matchingSaleIds: string[] = [];

                    if (!isBulk) {
                        let itemQuery = supabase
                            .from('sale_items')
                            .select('sale_id, sales!inner(date, payment_status)');

                        const itemOrFilters = terms.map(t => {
                            const escaped = t.toLowerCase().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                            return isExact ? `name.ilike."${escaped}"` : `name.ilike."%${escaped}%"`;
                        }).join(',');
                        itemQuery = itemQuery.or(itemOrFilters);

                        if (statusFilter !== 'All') {
                            itemQuery = itemQuery.eq('sales.payment_status', statusFilter);
                        }
                        if (effectiveSalesmanFilter !== 'All') {
                            itemQuery = itemQuery.eq('sales.salesman', effectiveSalesmanFilter);
                        }
                        if (shippingCoFilter.length > 0) {
                            itemQuery = itemQuery.in('sales.shipping_company', shippingCoFilter);
                        }
                        if (customerCareFilter !== 'All') {
                            itemQuery = itemQuery.eq('sales.customer_care', customerCareFilter);
                        }
                        if (settleDateRange.start) {
                            const start = new Date(settleDateRange.start);
                            start.setHours(0, 0, 0, 0);
                            itemQuery = itemQuery.gte('sales.settle_date', start.toISOString());
                        }
                        if (settleDateRange.end) {
                            const end = new Date(settleDateRange.end);
                            end.setHours(23, 59, 59, 999);
                            itemQuery = itemQuery.lte('sales.settle_date', end.toISOString());
                        }
                        if (orderDateRange.start) {
                            const start = new Date(orderDateRange.start);
                            start.setHours(0, 0, 0, 0);
                            itemQuery = itemQuery.gte('sales.date', start.toISOString());
                        }
                        if (orderDateRange.end) {
                            const end = new Date(orderDateRange.end);
                            end.setHours(23, 59, 59, 999);
                            itemQuery = itemQuery.lte('sales.date', end.toISOString());
                        }

                        itemQuery = itemQuery.order('sale_id', { ascending: false }).limit(200);

                        const { data: itemMatches } = await itemQuery;

                        if (itemMatches && itemMatches.length > 0) {
                            matchingSaleIds = Array.from(new Set(itemMatches.map((m: any) => m.sale_id)));
                        }
                    }

                    if (isBulk) {
                        const inList = terms.map(t => `"${t.replace(/"/g, '""')}"`).join(',');
                        query = query.or(`id.in.(${inList}),tracking_number.in.(${inList}),customer_snapshot->>phone.in.(${inList})`);
                    } else {
                        let finalOrFilters: string[] = [];

                        for (const term of terms) {
                            const escapedTerm = term.toLowerCase().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                            const matchStr = isExact ? `"${escapedTerm}"` : `"%${escapedTerm}%"`;
                            finalOrFilters.push(`id.ilike.${matchStr},remark.ilike.${matchStr},payment_method.ilike.${matchStr},tracking_number.ilike.${matchStr},customer_snapshot->>name.ilike.${matchStr},customer_snapshot->>phone.ilike.${matchStr},customer_snapshot->>city.ilike.${matchStr}`);
                        }

                        let orFilter = finalOrFilters.join(',');

                        if (matchingSaleIds.length > 0) {
                            orFilter += `,id.in.(${matchingSaleIds.join(',')})`;
                        }

                        query = query.or(orFilter);
                    }
                }
            }

            // Sort
            if (sortConfig) {
                const columnMap: Record<string, string> = {
                    settleDate: 'settle_date',
                    date: 'date',
                    customer: 'customer_id',
                    salesman: 'salesman',
                    shippingCo: 'shipping_company',
                    payBy: 'payment_method',
                    received: 'amount_received',
                    remaining: 'amount_received',
                    status: 'payment_status',
                    remark: 'remark',
                    total: 'total_amount'
                };
                const dbCol = columnMap[sortConfig.key];
                if (dbCol) {
                    query = query.order(dbCol, { ascending: sortConfig.direction === 'asc' });
                } else {
                    query = query.order('date', { ascending: false });
                }
            } else {
                query = query.order('date', { ascending: false });
            }

            // Pagination
            const from = (currentPage - 1) * itemsPerPage;
            const to = from + itemsPerPage - 1;
            query = query.range(from, to);

            const { data, count, error } = await query;
            if (error) throw error;

            setTotalCount(count || 0);
            const mapped = (data || []).map(mapSaleEntity);
            setServerOrders(mapped);
        } catch (err) {
            console.error("Fetch payment orders failed", err);
        } finally {
            setIsLoadingOrders(false);
        }
    }, [statusFilter, salesmanFilter, shippingCoFilter, customerCareFilter, settleDateRange, orderDateRange, searchTerm, currentPage, itemsPerPage, salesUpdatedAt, currentUser, sortConfig]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    // Derived state
    const trackingOrders = serverOrders;
    const paginatedOrders = serverOrders;

    // Calculate Totals for the current page
    const stats = useMemo(() => {
        const totalOrders = totalCount;
        const totalRevenue = trackingOrders.reduce((sum, order) => sum + order.total, 0);
        const totalReceived = trackingOrders.reduce((sum, order) => sum + (order.amountReceived || (order.paymentStatus === 'Paid' ? order.total : 0)), 0);
        const totalOutstanding = totalRevenue - totalReceived;

        return {
            totalOrders,
            totalRevenue,
            totalReceived,
            totalOutstanding
        };
    }, [trackingOrders, totalCount]);



    const handleUpdatePayment = () => {
        if (!selectedOrder) return;
        updateOrder(selectedOrder.id, {
            amountReceived: formData.amountReceived,
            settleDate: formData.settleDate,
            paymentStatus: formData.paymentStatus,
            ...(formData.paymentStatus === 'Paid' && selectedOrder.shipping?.status !== 'Delivered' ? { shipping: { ...(selectedOrder.shipping || {}), company: selectedOrder.shipping?.company || '', trackingNumber: selectedOrder.shipping?.trackingNumber || '', cost: selectedOrder.shipping?.cost || 0, status: 'Shipped' as 'Shipped' } } : {})
        });
        showToast('Payment details updated', 'success');
        setIsEditModalOpen(false);
    };





    const hasActiveFilters = searchTerm !== '' || statusFilter !== 'All' || salesmanFilter !== 'All' || shippingCoFilter.length > 0 || customerCareFilter !== 'All' || settleDateRange.start !== '' || settleDateRange.end !== '' || orderDateRange.start !== '' || orderDateRange.end !== '';

    const getRowClass = (order: Sale) => {
        if (selectedIds.has(order.id)) return 'selected';

        // Priority 1: Shipping Status = ReStock
        if (order.shipping?.status === 'ReStock') return 'restock-row';

        // Priority 2: Payment Status = Cancel
        if (order.paymentStatus === 'Cancel') return 'returned-row';

        // Priority 2: Shipping Status
        const shippingStatus = order.shipping?.status;
        if (shippingStatus === 'Ordered') return 'ordered-row';
        if (shippingStatus === 'Confirmed') return 'confirmed-row';
        if (shippingStatus === 'Pending') return 'pending-row';
        if (shippingStatus === 'Shipped') return 'shipped-row';
        if (shippingStatus === 'Delivered') return 'delivered-row';
        if (shippingStatus === 'Returned') return 'returned-row';

        // Secondary: Payment Status
        if (order.paymentStatus === 'Paid') return 'paid-settled-row';

        return '';
    };

    return (
        <div className="payment-tracking-container" style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>




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

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Order Date:</span>
                    <DateRangePicker value={orderDateRange} onChange={setOrderDateRange} />
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Settle Date:</span>
                    <DateRangePicker value={settleDateRange} onChange={setSettleDateRange} />
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <div ref={salesmanFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                        <button
                            onClick={() => { setIsSalesmanOpen(!isSalesmanOpen); setIsShippingCoOpen(false); setIsCustomerCareOpen(false); }}
                            className="search-input"
                            style={{
                                minWidth: '160px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'var(--color-surface)',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '13px', color: salesmanFilter === 'All' ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                    {salesmanFilter === 'All' ? (currentUser?.roleId === 'salesman' ? currentUser.name : 'All Salesmen') : salesmanFilter}
                                </span>
                            </div>
                            <ChevronDown size={14} color="var(--color-text-secondary)" />
                        </button>

                        {isSalesmanOpen && (
                            <div className="glass-panel" style={{
                                background: '#ffffff',
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                marginTop: '4px',
                                padding: '8px',
                                minWidth: '100%',
                                zIndex: 100,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                maxHeight: '300px',
                                overflowY: 'auto'
                            }}>
                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px',
                                    borderRadius: '6px', cursor: 'pointer',
                                    backgroundColor: salesmanFilter === 'All' ? 'var(--color-bg)' : 'transparent'
                                }}
                                    onClick={() => { setSalesmanFilter('All'); setIsSalesmanOpen(false); }}
                                >
                                    <span style={{ fontSize: '13px' }}>{currentUser?.roleId === 'salesman' ? currentUser.name : 'All Salesmen'}</span>
                                </label>
                                {currentUser?.roleId !== 'salesman' && users.filter(u => u.roleId !== 'admin').map(s => (
                                    <label key={s.id} style={{
                                        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px',
                                        borderRadius: '6px', cursor: 'pointer',
                                        backgroundColor: salesmanFilter === s.name ? 'var(--color-bg)' : 'transparent'
                                    }}
                                        onClick={() => { setSalesmanFilter(s.name); setIsSalesmanOpen(false); }}
                                    >
                                        <span style={{ fontSize: '13px' }}>{s.name}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <div ref={customerCareFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                        <button
                            onClick={() => { setIsCustomerCareOpen(!isCustomerCareOpen); setIsSalesmanOpen(false); setIsShippingCoOpen(false); }}
                            className="search-input"
                            style={{
                                minWidth: '160px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'var(--color-surface)',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '13px', color: customerCareFilter === 'All' ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                    {customerCareFilter === 'All' ? 'Customer Care' : customerCareFilter}
                                </span>
                            </div>
                            <ChevronDown size={14} color="var(--color-text-secondary)" />
                        </button>

                        {isCustomerCareOpen && (
                            <div className="glass-panel" style={{
                                background: '#ffffff',
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                marginTop: '4px',
                                padding: '8px',
                                minWidth: '100%',
                                zIndex: 100,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                maxHeight: '300px',
                                overflowY: 'auto'
                            }}>
                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px',
                                    borderRadius: '6px', cursor: 'pointer',
                                    backgroundColor: customerCareFilter === 'All' ? 'var(--color-bg)' : 'transparent'
                                }}
                                    onClick={() => { setCustomerCareFilter('All'); setIsCustomerCareOpen(false); }}
                                >
                                    <span style={{ fontSize: '13px' }}>All Customer Care</span>
                                </label>
                                {(customerCare || []).map(cc => (
                                    <label key={cc} style={{
                                        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px',
                                        borderRadius: '6px', cursor: 'pointer',
                                        backgroundColor: customerCareFilter === cc ? 'var(--color-bg)' : 'transparent'
                                    }}
                                        onClick={() => { setCustomerCareFilter(cc); setIsCustomerCareOpen(false); }}
                                    >
                                        <span style={{ fontSize: '13px' }}>{cc}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <div ref={shippingCoFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                        <button
                            onClick={() => { setIsShippingCoOpen(!isShippingCoOpen); setIsSalesmanOpen(false); setIsCustomerCareOpen(false); }}
                            className="search-input"
                            style={{
                                minWidth: '160px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'var(--color-surface)',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 500, color: shippingCoFilter.length === 0 ? '#000000' : '#000000' }}>
                                    {shippingCoFilter.length === 0 ? 'Shipping Co' : `Shipping (${shippingCoFilter.length})`}
                                </span>
                            </div>
                            <ChevronDown size={14} color="var(--color-text-secondary)" />
                        </button>
                        {isShippingCoOpen && (
                            <div className="glass-panel" style={{
                                background: '#ffffff',
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                marginTop: '4px',
                                padding: '8px',
                                minWidth: '100%',
                                zIndex: 100,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                maxHeight: '300px',
                                overflowY: 'auto'
                            }}>
                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px',
                                    borderRadius: '6px', cursor: 'pointer',
                                    backgroundColor: shippingCoFilter.length === filterShippingCompanies.length ? 'var(--color-bg)' : 'transparent'
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={shippingCoFilter.length === filterShippingCompanies.length && filterShippingCompanies.length > 0}
                                        onChange={(e) => {
                                            if (e.target.checked) setShippingCoFilter([...filterShippingCompanies]);
                                            else setShippingCoFilter([]);
                                        }}
                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                    />
                                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#000000' }}>Select All</span>
                                </label>
                                {filterShippingCompanies.map(co => (
                                    <label key={co} style={{
                                        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px',
                                        borderRadius: '6px', cursor: 'pointer',
                                        backgroundColor: shippingCoFilter.includes(co) ? 'var(--color-bg)' : 'transparent'
                                    }}>
                                        <input
                                            type="checkbox"
                                            checked={shippingCoFilter.includes(co)}
                                            onChange={(e) => {
                                                if (e.target.checked) setShippingCoFilter([...shippingCoFilter, co]);
                                                else setShippingCoFilter(shippingCoFilter.filter(s => s !== co));
                                            }}
                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                        />
                                        {getShippingLogo(co) && (
                                            <img src={getShippingLogo(co)!} alt="logo" style={{ width: '14px', height: '14px', borderRadius: '50%', objectFit: 'cover' }} />
                                        )}
                                        <span style={{ fontSize: "13px", color: getShippingCoColor(co) }}>{co}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as any)}
                        className="search-input"
                        style={{ width: '130px' }}
                    >
                        <option value="All">All Payment Status</option>
                        <option value="Paid" style={{ backgroundColor: '#D1FAE5', color: '#059669' }}>Paid</option>
                        <option value="Get File" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>Get File</option>
                        <option value="Unpaid" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>Unpaid</option>
                        <option value="Cancel" style={{ backgroundColor: '#FEF2F2', color: '#991B1B' }}>Cancel</option>
                    </select>

                    <button
                        onClick={() => {
                            setSearchTerm('');
                            setStatusFilter('All');
                            setSalesmanFilter('All');
                            setShippingCoFilter([]);
                            setCustomerCareFilter('All');
                            setSettleDateRange({ start: '', end: '' });
                            setOrderDateRange({ start: '', end: '' });
                        }}
                        style={{
                            padding: '10px 16px', borderRadius: '8px', 
                            border: hasActiveFilters ? 'none' : '1px solid var(--color-border)',
                            background: hasActiveFilters ? '#EF4444' : 'var(--color-surface)', 
                            color: hasActiveFilters ? '#ffffff' : 'var(--color-text-secondary)', 
                            cursor: 'pointer',
                            fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px',
                            transition: 'all 0.2s ease'
                        }}
                        title="Clear Filters"
                    >
                        <X size={16} /> Clear
                    </button>
                </div>

                <button
                    onClick={() => {
                        refreshData(true);
                        const btn = document.getElementById('payment-refresh-btn');
                        if (btn) {
                            btn.style.animation = 'spin 1s linear';
                            setTimeout(() => btn.style.animation = '', 1000);
                        }
                    }}
                    title="Refresh Data"
                    style={{
                        padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)', color: 'var(--color-text-main)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                >
                    <RefreshCw id="payment-refresh-btn" size={18} />
                </button>
                <style>{`
                    @keyframes spin { 
                        100% { transform: rotate(360deg); } 
                    }
                `}</style>

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
            <div className="glass-panel" style={{ overflow: 'visible', maxHeight: 'calc(100vh - 260px)' }}>
                <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
                <table
                    className="spreadsheet-table"
                    style={{
                        minWidth: '100%',
                        whiteSpace: 'nowrap',
                        borderCollapse: 'separate',
                        borderSpacing: 0,
                        fontSize: '13px',
                        tableLayout: 'fixed'
                    }}
                >
                    <thead>
                        <tr>
                            <th style={{ width: '40px', textAlign: 'center', background: '#e5e7eb', position: 'sticky', left: 0, top: 0, zIndex: 40 }} className="sticky-col-first">
                                <input
                                    type="checkbox"
                                    checked={trackingOrders.length > 0 && selectedIds.size === trackingOrders.length}
                                    onChange={toggleSelectAll}
                                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                />
                                <div
                                    onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); autoFitAllColumns(); }}
                                    style={{
                                        position: 'absolute', right: 0, top: 0, bottom: 0, width: '10px',
                                        cursor: 'col-resize', background: 'transparent', zIndex: 25, transform: 'translateX(50%)'
                                    }}
                                    className="resize-handle"
                                    title="Double click to auto-fit all columns"
                                />
                            </th>
                            {allColumns.filter(col => visibleColumns.includes(col.id)).map((col) => {
                                const colId = col.id;
                                const width = columnWidths[colId] || 150;
                                
                                return (
                                    <th
                                        key={colId}
                                        style={{
                                            width: `var(--col-payment-${colId}-width, ${width}px)`,
                                            minWidth: `var(--col-payment-${colId}-width, ${width}px)`,
                                            overflow: 'visible',
                                            borderRight: resizingCol === colId ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                            transition: 'border-color 0.1s',
                                            padding: 0,
                                            position: 'sticky',
                                            zIndex: 30,
                                            background: '#e5e7eb',
                                            boxShadow: 'none',
                                            top: 0
                                        }}
                                    >
                                        <div 
                                            onClick={() => handleSort(colId)}
                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: '100%', userSelect: 'none', padding: 'var(--table-padding, 5px 6px)', cursor: 'pointer' }}
                                        >
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{col.label}</span>
                                            {sortConfig?.key === colId && (
                                                sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                            )}
                                        </div>
                                        <div
                                            onMouseDown={(e) => startResize(e, colId)}
                                            onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); autoFitColumn(colId); }}
                                            style={{
                                                position: 'absolute',
                                                right: 0,
                                                top: 0,
                                                bottom: 0,
                                                width: '10px',
                                                cursor: 'col-resize',
                                                background: 'transparent',
                                                zIndex: 25,
                                                transform: 'translateX(50%)'
                                            }}
                                            className="resize-handle"
                                        />
                                    </th>
                                );
                            })}
                            <th style={{ width: '100%', minWidth: 'auto', background: '#e5e7eb', borderBottom: '1px solid var(--color-border)' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedOrders.map((order) => (
                            <tr key={order.id} className={getRowClass(order)}>
                                <td style={{ width: '40px', textAlign: 'center', position: 'sticky', left: 0, zIndex: 15, borderLeft: order.paymentStatus === 'Cancel' ? '2px solid #991B1B' : (order.shipping?.status === 'Ordered' ? '2px solid transparent' : `2px solid ${getStatusBorderColor(order.shipping?.status || 'Pending')}`) }} className="sticky-col-first">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(order.id)}
                                        onClick={(e) => toggleSelection(order.id, e)}
                                        onChange={() => {}}
                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                    />
                                </td>
                                {visibleColumns.includes('actions') && (
                                    <td style={{ width: `var(--col-payment-actions-width, ${columnWidths.actions || 60}px)`, textAlign: 'center' }}>
                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                            <button onClick={(e) => { e.stopPropagation(); handleCopyOrder(order); }} className="icon-button" title="Copy Details" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                <Copy size={16} color="var(--color-text-secondary)" />
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); handleOpenEdit(order); }} className="icon-button" title="Edit Order" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                <Edit size={16} color="var(--color-text-secondary)" />
                                            </button>
                                        </div>
                                    </td>
                                )}
                                {visibleColumns.includes('date') && <td style={{ width: `var(--col-payment-date-width, ${columnWidths.date}px)` }}>{new Date(order.date).toLocaleDateString()}</td>}
                                {visibleColumns.includes('settleDate') && <td style={{ width: `var(--col-payment-settleDate-width, ${columnWidths.settleDate}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.settleDate ? new Date(order.settleDate).toLocaleDateString() : ''}>{order.settleDate ? new Date(order.settleDate).toLocaleDateString() : '-'}</td>}
                                {visibleColumns.includes('customer') && <td style={{ fontWeight: 500, width: `var(--col-payment-customer-width, ${columnWidths.customer}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.customer?.name}>{order.customer?.name}</td>}
                                {visibleColumns.includes('phone') && (() => {
                                    const operator = getOperatorForPhone(order.customer?.phone);
                                    return (
                                        <td style={{ color: 'var(--color-text-secondary)', width: `var(--col-payment-phone-width, ${columnWidths.phone}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.customer?.phone}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {operator && <img src={operator.logo} alt={operator.name} style={{ width: '16px', height: '16px', objectFit: 'contain', borderRadius: '2px' }} title={operator.name} />}
                                                <span>{order.customer?.phone || '-'}</span>
                                            </div>
                                        </td>
                                    );
                                })()}
                                {visibleColumns.includes('address') && <td style={{ color: 'var(--color-text-secondary)', width: `var(--col-payment-address-width, ${columnWidths.address}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.customer?.address || ''}>{order.customer?.address || '-'}</td>}
                                {visibleColumns.includes('salesman') && <td style={{ color: 'var(--color-text-main)', width: `var(--col-payment-salesman-width, ${columnWidths.salesman}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.salesman || ''}>{order.salesman || '-'}</td>}
                                {visibleColumns.includes('items') && <td style={{ width: `var(--col-payment-items-width, ${columnWidths.items}px)` }}>
                                    <div style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={order.items.map(i => `${i.name} x${i.quantity}`).join(', ')}>
                                        {order.items.map(i => `${i.name} x${i.quantity}`).join(', ')}
                                    </div>
                                </td>}
                                {visibleColumns.includes('total') && <td style={{ fontWeight: 'bold', textAlign: 'right', width: `var(--col-payment-total-width, ${columnWidths.total}px)` }}>${order.total.toFixed(2)}</td>}
                                {visibleColumns.includes('shippingCo') && <td style={{ color: getShippingCoColor(order.shipping?.company || ''), width: `var(--col-payment-shippingCo-width, ${columnWidths.shippingCo}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.shipping?.company || ''}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        {order.shipping?.company && getShippingLogo(order.shipping.company) && (
                                            <img src={getShippingLogo(order.shipping.company)!} alt="shipping logo" style={{ width: '14px', height: '14px', borderRadius: '50%', objectFit: 'cover' }} />
                                        )}
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{order.shipping?.company || '-'}</span>
                                    </div>
                                </td>}
                                {visibleColumns.includes('trackingId') && <td style={{ color: 'var(--color-text-main)', width: `var(--col-payment-trackingId-width, ${columnWidths.trackingId}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.shipping?.trackingNumber || ''}>
                                    {order.shipping?.trackingNumber || '-'}
                                </td>}
                                {visibleColumns.includes('payBy') && <td style={{ width: `var(--col-payment-payBy-width, ${columnWidths.payBy}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.paymentMethod}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        {order.paymentMethod && getPaymentLogo(order.paymentMethod) && (
                                            <img src={getPaymentLogo(order.paymentMethod)!} alt="payby logo" style={{ width: '14px', height: '14px', borderRadius: '2px', objectFit: 'contain' }} />
                                        )}
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: getPaymentColor(order.paymentMethod) }}>{order.paymentMethod || '-'}</span>
                                    </div>
                                </td>}
                                {visibleColumns.includes('received') && <td style={{ textAlign: 'right', width: `var(--col-payment-received-width, ${columnWidths.received}px)`, color: '#2563EB', fontWeight: 600 }}>${(order.amountReceived || order.total).toFixed(2)}</td>}
                                {visibleColumns.includes('remaining') && <td style={{ color: '#059669', fontWeight: 600, textAlign: 'right', width: `var(--col-payment-remaining-width, ${columnWidths.remaining}px)` }}>
                                    ${(order.total - (order.amountReceived || (order.paymentStatus === 'Paid' ? order.total : 0))).toFixed(2)}
                                </td>}
                                {visibleColumns.includes('orderStatus') && <td style={{ width: `var(--col-payment-orderStatus-width, ${columnWidths.orderStatus}px)`, padding: '8px' }}>
                                    <StatusBadge
                                        status={order.shipping?.status || 'Pending'}
                                        readOnly={order.paymentStatus === 'Cancel' || order.shipping?.status === 'ReStock' || order.shipping?.status === 'Delivered'}
                                        disabledOptions={
                                            (order.shipping?.status === 'Shipped')
                                                ? ['Ordered', 'Pending', 'Confirmed']
                                                : ['Delivered', 'Returned']
                                        }
                                        onChange={(newStatus: string) => {
                                            updateOrderStatus(order.id, newStatus as any);
                                            if (newStatus === 'ReStock') {
                                                updateOrder(order.id, { paymentStatus: 'Cancel' });
                                                restockOrder(order.id);
                                            } else if (newStatus === 'Returned') {
                                                updateOrder(order.id, { paymentStatus: 'Cancel' });
                                            }
                                        }}
                                    />
                                </td>}
                                {visibleColumns.includes('status') && <td style={{ width: `var(--col-payment-status-width, ${columnWidths.status}px)` }}>
                                    <PaymentStatusBadge
                                        status={order.paymentStatus || 'Paid'}
                                        onChange={(newStatus) => {
                                            if (newStatus === 'Paid') {
                                                setPaymentMethodTargetOrder(order);
                                                setIsPaymentMethodModalOpen(true);
                                                return;
                                            }
                                            updateOrder(order.id, { paymentStatus: newStatus as 'Unpaid' | 'Paid' | 'Get File' | 'Cancel' })
                                        }}
                                        readOnly={order.paymentStatus === 'Paid' || order.paymentStatus === 'Cancel'}
                                    />
                                </td>}
                                {visibleColumns.includes('remark') && <td style={{ width: `var(--col-payment-remark-width, ${columnWidths.remark}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.remark || ''}>{order.remark || '-'}</td>}
                                <td style={{ width: '100%', minWidth: 'auto' }}></td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td className="sticky-col-first" style={{ width: '40px', background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)' }}></td>
                            {allColumns.filter(col => visibleColumns.includes(col.id)).map((col, index) => {
                                const colId = col.id;
                                const width = columnWidths[colId] || 150;
                                const style: React.CSSProperties = {
                                    width: `var(--col-payment-${colId}-width, ${width}px)`,
                                    background: 'var(--color-bg)',
                                    borderTop: '2px solid var(--color-border)',
                                    padding: 'var(--table-padding, 5px 6px)',
                                    fontSize: '12px'
                                };
                                
                                if (colId === 'total') return (
                                    <td key={colId} style={{ ...style, fontWeight: 'bold', textAlign: 'right' }}>
                                        ${stats.totalRevenue.toFixed(2)}
                                    </td>
                                );
                                if (colId === 'received') return (
                                    <td key={colId} style={{ ...style, fontWeight: 'bold', textAlign: 'right', color: '#2563EB' }}>
                                        ${stats.totalReceived.toFixed(2)}
                                    </td>
                                );
                                if (colId === 'remaining') return (
                                    <td key={colId} style={{ ...style, fontWeight: 'bold', textAlign: 'right', color: '#059669' }}>
                                        ${stats.totalOutstanding.toFixed(2)}
                                    </td>
                                );
                                if (index === 0) return (
                                    <td key={colId} style={{ ...style, fontWeight: 'bold' }}>
                                        Total ({stats.totalOrders})
                                    </td>
                                );
                                return <td key={colId} style={style}></td>;
                            })}
                            <td style={{ width: '100%', minWidth: 'auto', background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)' }}></td>
                        </tr>
                    </tfoot>
                </table>
                </div>
            {totalCount === 0 && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No payments found.</div>}
            </div>

            {totalCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', padding: '0', position: 'relative' }}>
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                        Showing {Math.min((currentPage - 1) * itemsPerPage + 1, totalCount)} to {Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount} entries
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
                                <option value={100}>100</option>
                                <option value={200}>200</option>
                                <option value={300}>300</option>
                                <option value={500}>500</option>
                                <option value={1000}>1000</option>
                                <option value={3000}>3000</option>
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
                                Page <span style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>{currentPage}</span> of {Math.max(1, Math.ceil(totalCount / itemsPerPage))}
                            </span>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(Math.ceil(totalCount / itemsPerPage), p + 1))}
                                disabled={currentPage >= Math.ceil(totalCount / itemsPerPage)}
                                style={{
                                    padding: '6px', borderRadius: '6px', border: '1px solid var(--color-border)',
                                    background: currentPage >= Math.ceil(totalCount / itemsPerPage) ? 'var(--color-bg)' : 'var(--color-surface)',
                                    color: currentPage >= Math.ceil(totalCount / itemsPerPage) ? 'var(--color-text-muted)' : 'var(--color-text-main)',
                                    cursor: currentPage >= Math.ceil(totalCount / itemsPerPage) ? 'not-allowed' : 'pointer',
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
                                    <select className="search-input" style={{ width: '100%' }} value={formData.paymentStatus} onChange={e => setFormData({ ...formData, paymentStatus: e.target.value as 'Unpaid' | 'Paid' | 'Get File' | 'Cancel' })} disabled={selectedOrder?.paymentStatus === 'Paid' || selectedOrder?.paymentStatus === 'Cancel'}>
                                        <option value="Unpaid">Unpaid</option>
                                        <option value="Paid">Paid</option>
                                        <option value="Get File">Get File</option>
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

            {/* Edit Order Modal */}
            <Modal
                isOpen={isEditOrderModalOpen}
                onClose={handleCloseEdit}
                title="Edit Order"
                width="1200px"
                fullScreen
                bodyPadding="0"
                bodyOverflowY="hidden"
            >
                {selectedOrder && (
                    <POSInterface
                        orderToEdit={selectedOrder}
                        onCancelEdit={handleCloseEdit}
                    />
                )}
            </Modal>

            {/* Bulk Actions Bar */}
            {
                selectedIds.size > 0 && (
                    <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'var(--color-surface)', padding: '16px 24px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '16px', zIndex: 100, border: '1px solid var(--color-border)' }}>
                        <span style={{ fontWeight: 600 }}>{selectedIds.size} selected</span>
                        <div style={{ height: '24px', width: '1px', background: 'var(--color-border)' }} />
                        <button onClick={() => setIsBulkEditOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'var(--color-primary)', color: 'white', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                            <Edit size={18} /> Edit
                        </button>
                        {currentUser?.roleId === 'admin' && (
                            <button 
                                onClick={async () => {
                                    if (window.confirm(`Are you sure you want to delete ${selectedIds.size} selected orders?`)) {
                                        try {
                                            await deleteOrders(Array.from(selectedIds));
                                            setSelectedIds(new Set());
                                            showToast(`Deleted ${selectedIds.size} orders`, 'success');
                                        } catch (error) {
                                            console.error('Failed to delete orders:', error);
                                            showToast('Failed to delete orders', 'error');
                                        }
                                    }
                                }} 
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'var(--color-red)', color: 'white', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                            >
                                <Trash2 size={18} /> Delete
                            </button>
                        )}
                    </div>
                )
            }

            <BulkEditModal
                isOpen={isBulkEditOpen}
                onClose={() => setIsBulkEditOpen(false)}
                onApply={handleBulkEdit}
                count={selectedIds.size}
            />

            {/* Settle Payment Modal */}
            {paymentMethodTargetOrder && (
                <SettlePaymentModal
                    isOpen={isPaymentMethodModalOpen}
                    onClose={() => { setIsPaymentMethodModalOpen(false); setPaymentMethodTargetOrder(null); }}
                    initialMethod={paymentMethodTargetOrder.paymentMethod || undefined}
                    initialDate={paymentMethodTargetOrder.settleDate || undefined}
                    onConfirm={({ paymentMethod, settleDate }) => {
                        const updates: any = { paymentStatus: 'Paid', paymentMethod, settleDate };
                        updates.amountReceived = paymentMethodTargetOrder.total;
                        if (paymentMethodTargetOrder.shipping?.status !== 'Delivered') {
                            updates.shipping = { ...(paymentMethodTargetOrder.shipping || {}), company: paymentMethodTargetOrder.shipping?.company || '', trackingNumber: paymentMethodTargetOrder.shipping?.trackingNumber || '', cost: paymentMethodTargetOrder.shipping?.cost || 0, status: 'Shipped' };
                        }
                        updateOrder(paymentMethodTargetOrder.id, updates);
                    }}
                />
            )}

            {/* Report Modal */}
            <ReportModal
                isOpen={isReportOpen}
                onClose={() => setIsReportOpen(false)}
            />

            {/* Income Expense Modal */}
            <Modal
                isOpen={isIncomeModalOpen}
                onClose={() => setIsIncomeModalOpen(false)}
                title="Income & Expense"
                width="1200px"
                height="90vh"
                bodyPadding="0"
                bodyOverflowY="auto"
            >
                <IncomeExpense isModal />
            </Modal>
        </div >
    );
};

export default PaymentTracking;
