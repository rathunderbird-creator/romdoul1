import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { Search, X, Settings, Truck, Clock, Package, ChevronLeft, ChevronRight, Printer, Edit, Eye, ClipboardList, CheckCircle, ChevronDown, ChevronUp, RefreshCw, Phone, MessageCircle } from 'lucide-react';
import type { Sale } from '../types';
import { ReceiptModal, StatusBadge, DateRangePicker, Modal } from '../components';
import { getShippingCoColor } from '../utils/orderUtils';
import { useClickOutside } from '../hooks/useClickOutside';
import { sendTelegramTestMessage, sendTelegramOrderNotification } from '../utils/telegram';
import { supabase } from '../lib/supabase';
import { mapSaleEntity } from '../utils/mapper';

const FollowUpButton = ({ orderId, status, isAdmin, onCall }: { orderId: string, status: string, isAdmin: boolean, onCall?: () => void }) => {
    const [lastFollowUp, setLastFollowUp] = useState<string>(() => localStorage.getItem(`followUp_${orderId}`) || '');
    
    const isPermanentlyDisabled = status === 'Delivered' || status === 'Returned';
    
    const isCalledToday = useMemo(() => {
        if (!lastFollowUp) return false;
        const lastDate = new Date(lastFollowUp);
        const today = new Date();
        return lastDate.toDateString() === today.toDateString();
    }, [lastFollowUp]);

    const isDisabled = isPermanentlyDisabled || isCalledToday;

    const handleCall = () => {
        if (isDisabled) return;
        const now = new Date().toISOString();
        localStorage.setItem(`followUp_${orderId}`, now);
        setLastFollowUp(now);
        if (onCall) onCall();
    };

    const handleReset = (e: React.MouseEvent) => {
        e.stopPropagation();
        localStorage.removeItem(`followUp_${orderId}`);
        setLastFollowUp('');
    };

    return (
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', width: '100%' }}>
            <button
                onClick={handleCall}
                disabled={isDisabled}
                style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: 'none',
                    background: isDisabled ? '#E5E7EB' : '#2563EB',
                    color: isDisabled ? '#9CA3AF' : '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.2s ease',
                    width: '100%',
                    justifyContent: 'center'
                }}
            >
                <Phone size={12} />
                {isCalledToday && !isPermanentlyDisabled ? 'Called' : 'Call'}
            </button>
            {isAdmin && isDisabled && (
                <button 
                    onClick={handleReset} 
                    style={{ 
                        background: '#F3F4F6', 
                        border: 'none', 
                        cursor: 'pointer', 
                        padding: '4px', 
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease'
                    }} 
                    title="Re-enable Call Button"
                    onMouseOver={(e) => e.currentTarget.style.background = '#E5E7EB'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#F3F4F6'}
                >
                    <RefreshCw size={12} color="#6B7280" />
                </button>
            )}
        </div>
    );
};

const EditableRemark = ({ order, updateOrder }: { order: Sale, updateOrder: (id: string, updates: Partial<Sale>) => void }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(order.remark || '');

    useEffect(() => {
        setValue(order.remark || '');
    }, [order.remark]);

    const handleBlur = () => {
        setIsEditing(false);
        if (value !== (order.remark || '')) {
            updateOrder(order.id, { remark: value });
        }
    };

    if (isEditing) {
        return (
            <input
                autoFocus
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        handleBlur();
                    }
                }}
                style={{
                    width: '100%',
                    padding: '2px 4px',
                    border: '1px solid var(--color-primary)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    outline: 'none',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text-main)'
                }}
                onClick={(e) => e.stopPropagation()}
            />
        );
    }

    return (
        <div 
            onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
            style={{ 
                minHeight: '20px', 
                cursor: 'text', 
                width: '100%', 
                display: 'block', 
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis' 
            }}
            title={order.remark || 'Click to add remark'}
        >
            {order.remark || <span style={{ color: 'var(--color-text-secondary)' }}>-</span>}
        </div>
    );
};

const DeliveryTracking: React.FC = () => {
    const { sales, salesUpdatedAt, updateOrderStatus, updateOrder, users, currentUser, shippingCompanies, customerCare, refreshData, telegramBotToken, telegramChatId, updateStoreProfile } = useStore();
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
    const [orderDateRange, setOrderDateRange] = useState({ start: '', end: '' });
    const [statusFilter, setStatusFilter] = useState<string[]>(() => {
        const saved = localStorage.getItem('delivery_statusFilter');
        return saved ? JSON.parse(saved) : [];
    });
    useEffect(() => { localStorage.setItem('delivery_statusFilter', JSON.stringify(statusFilter)); }, [statusFilter]);
    const [paymentStatusFilter, setPaymentStatusFilter] = useState<'All' | 'Paid' | 'Get File' | 'Unpaid' | 'Cancel'>('All');

    const [salesmanFilter, setSalesmanFilter] = useState<string>(() => {
        return localStorage.getItem('delivery_salesmanFilter') || 'All';
    });
    const [shippingCoFilter, setShippingCoFilter] = useState<string[]>(() => {
        const saved = localStorage.getItem('delivery_shippingCoFilter');
        return saved ? JSON.parse(saved) : [];
    });
    const [customerCareFilter, setCustomerCareFilter] = useState<string>(() => {
        return localStorage.getItem('delivery_customerCareFilter') || 'All';
    });

    useEffect(() => { localStorage.setItem('delivery_salesmanFilter', salesmanFilter); }, [salesmanFilter]);
    useEffect(() => { localStorage.setItem('delivery_shippingCoFilter', JSON.stringify(shippingCoFilter)); }, [shippingCoFilter]);
    useEffect(() => { localStorage.setItem('delivery_customerCareFilter', customerCareFilter); }, [customerCareFilter]);

    const [isSalesmanOpen, setIsSalesmanOpen] = useState(false);
    const [isShippingCoOpen, setIsShippingCoOpen] = useState(false);
    const [isCustomerCareOpen, setIsCustomerCareOpen] = useState(false);
    const [isStatusFilterOpen, setIsStatusFilterOpen] = useState(false);
    const salesmanFilterRef = useClickOutside<HTMLDivElement>(() => setIsSalesmanOpen(false));
    const shippingCoFilterRef = useClickOutside<HTMLDivElement>(() => setIsShippingCoOpen(false));
    const customerCareFilterRef = useClickOutside<HTMLDivElement>(() => setIsCustomerCareOpen(false));
    const statusFilterRef = useClickOutside<HTMLDivElement>(() => setIsStatusFilterOpen(false));
    const filterShippingCompanies = useMemo(() => {
        return ['អ្នកដឹក', ...shippingCompanies];
    }, [shippingCompanies]);
    const isMobile = window.innerWidth <= 768;

    const hasActiveFilters = searchTerm !== '' ||
        statusFilter.length > 0 ||
        paymentStatusFilter !== 'All' ||
        salesmanFilter !== 'All' ||
        shippingCoFilter.length > 0 ||
        customerCareFilter !== 'All' ||
        orderDateRange.start !== '';

    const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null);
    const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    // Telegram Settings
    const [showTelegramSettings, setShowTelegramSettings] = useState(false);
    const [tempBotToken, setTempBotToken] = useState(telegramBotToken || '');
    const [tempChatId, setTempChatId] = useState(telegramChatId || '');

    useEffect(() => {
        setTempBotToken(telegramBotToken || '');
        setTempChatId(telegramChatId || '');
    }, [telegramBotToken, telegramChatId, showTelegramSettings]);

    const handleSaveTelegramConfig = () => {
        updateStoreProfile({
            telegramBotToken: tempBotToken,
            telegramChatId: tempChatId
        });
        showToast('Telegram configuration saved!', 'success');
        setShowTelegramSettings(false);
    };

    const handleTestTelegram = async () => {
        if (!tempBotToken || !tempChatId) {
            showToast('Please enter both Bot Token and Group Chat ID', 'error');
            return;
        }
        try {
            await sendTelegramTestMessage(tempBotToken, tempChatId);
            showToast('Test message sent successfully!', 'success');
        } catch (error: any) {
            showToast(`Failed to send test message: ${error.message}`, 'error');
        }
    };

    const handleFollowUpCall = async (order: Sale) => {
        if (!telegramBotToken || !telegramChatId) return;
        const sequenceNumber = sales.findIndex(s => s.id === order.id) + 1;
        try {
            await sendTelegramOrderNotification(telegramBotToken, telegramChatId, order, sequenceNumber);
            showToast('Follow up notification sent to Telegram', 'success');
        } catch (error: any) {
            showToast(`Failed to send Telegram message: ${error.message}`, 'error');
        }
    };

    // Column Visibility
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const allColumns = [
        { id: 'actions', label: 'Actions' },
        { id: 'date', label: 'Order Date' },
        { id: 'customer', label: 'Customer' },
        { id: 'phone', label: 'Phone' },
        { id: 'address', label: 'Address' },
        { id: 'items', label: 'Products' },
        { id: 'shippingCo', label: 'Shipping Co.' },
        { id: 'tracking', label: 'Tracking ID' },
        { id: 'deliveryMan', label: 'Delivery Man' },
        { id: 'status', label: 'Ship Status' },
        { id: 'cost', label: 'Cost' },
        { id: 'followUp', label: 'Follow Up' },
        { id: 'remark', label: 'Remark' },
    ];
    // Default visible
    const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
        const saved = localStorage.getItem('delivery_visibleColumns');
        if (saved) {
            try { 
                const parsed = JSON.parse(saved);
                if (!parsed.includes('followUp')) {
                    const remarkIdx = parsed.indexOf('remark');
                    if (remarkIdx !== -1) parsed.splice(remarkIdx, 0, 'followUp');
                    else parsed.push('followUp');
                    localStorage.setItem('delivery_visibleColumns', JSON.stringify(parsed));
                }
                return parsed;
            } catch (e) {}
        }
        return [
            'actions', 'date', 'customer', 'phone', 'address', 'items', 'shippingCo', 'tracking', 'deliveryMan', 'status', 'cost', 'followUp', 'remark'
        ];
    });

    React.useEffect(() => {
        localStorage.setItem('delivery_visibleColumns', JSON.stringify(visibleColumns));
    }, [visibleColumns]);

    const [formData, setFormData] = useState({
        company: '',
        trackingNumber: '',
        cost: 0,
        staffName: '',
        status: 'Pending' as 'Ordered' | 'Pending' | 'Confirmed' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned' | 'ReStock'
    });


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

    // Column widths and resize state
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('delivery_column_widths');
        return saved ? JSON.parse(saved) : {
            actions: 120,
            date: 110,
            customer: 140,
            phone: 110,
            address: 200,
            items: 200,
            shippingCo: 110,
            tracking: 130,
            deliveryMan: 120,
            status: 130,
            cost: 90,
            remark: 150
        };
    });

    React.useEffect(() => {
        localStorage.setItem('delivery_column_widths', JSON.stringify(columnWidths));
    }, [columnWidths]);

    const [resizingCol, setResizingCol] = useState<string | null>(null);
    const resizeRef = React.useRef<{ startX: number; startWidth: number; colId: string } | null>(null);

    const handleGlobalMouseMove = React.useCallback((e: MouseEvent) => {
        if (!resizeRef.current) return;
        const { startX, startWidth, colId } = resizeRef.current;
        const diff = e.clientX - startX;
        const newWidth = Math.max(15, startWidth + diff);
        document.documentElement.style.setProperty(`--col-delivery-${colId}-width`, `${newWidth}px`);
    }, []);

    const handleGlobalMouseUp = React.useCallback((e: MouseEvent) => {
        if (!resizeRef.current) return;
        const { startX, startWidth, colId } = resizeRef.current;
        const diff = e.clientX - startX;
        const newWidth = Math.max(15, startWidth + diff);

        setColumnWidths(prev => ({ ...prev, [colId]: newWidth }));
        document.documentElement.style.removeProperty(`--col-delivery-${colId}-width`);

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
        const cellIndex = colIndex + 1; // +1 for checkbox column

        const measurer = document.createElement('div');
        measurer.style.cssText = 'position:absolute;visibility:hidden;height:auto;width:auto;white-space:nowrap;padding:0 12px;font-size:13px;font-family:inherit;';
        document.body.appendChild(measurer);

        let maxWidth = 40;

        // Measure header
        const headerCell = table.tHead?.rows[0]?.cells[cellIndex];
        if (headerCell) {
            measurer.style.fontWeight = '600';
            measurer.textContent = (headerCell.textContent || '').trim();
            maxWidth = Math.max(maxWidth, measurer.scrollWidth + 28);
            measurer.style.fontWeight = '';
        }

        // Measure body cells
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
            document.documentElement.style.removeProperty(`--col-delivery-${colId}-width`);
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

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(200);

    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, statusFilter, paymentStatusFilter, orderDateRange, salesmanFilter, customerCareFilter, shippingCoFilter, itemsPerPage, sortConfig]);

    // Server-side fetching
    const [totalCount, setTotalCount] = useState(0);
    const [serverOrders, setServerOrders] = useState<Sale[]>([]);
    const [isLoadingOrders, setIsLoadingOrders] = useState(false);

    const fetchOrders = React.useCallback(async () => {
        setIsLoadingOrders(true);
        try {
            let query = supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)', { count: 'exact' });

            // Shipping status filter
            if (statusFilter.length > 0) {
                query = query.in('shipping_status', statusFilter);
            } else {
                query = query.not('shipping_status', 'in', '("Delivered","Cancelled")');
            }

            // Payment status filter
            if (paymentStatusFilter !== 'All') {
                query = query.eq('payment_status', paymentStatusFilter);
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
                        let itemQuery = supabase.from('sale_items').select('sale_id, sales!inner(date, payment_status, shipping_status)');
                        const itemOrFilters = terms.map(t => {
                            const escaped = t.toLowerCase().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                            return isExact ? `name.ilike."${escaped}"` : `name.ilike."%${escaped}%"`;
                        }).join(',');
                        itemQuery = itemQuery.or(itemOrFilters);

                        if (statusFilter.length > 0) {
                            itemQuery = itemQuery.in('sales.shipping_status', statusFilter);
                        } else {
                            itemQuery = itemQuery.not('sales.shipping_status', 'in', '("Delivered","Cancelled")');
                        }
                        if (paymentStatusFilter !== 'All') itemQuery = itemQuery.eq('sales.payment_status', paymentStatusFilter);
                        if (effectiveSalesmanFilter !== 'All') itemQuery = itemQuery.eq('sales.salesman', effectiveSalesmanFilter);
                        if (shippingCoFilter.length > 0) itemQuery = itemQuery.in('sales.shipping_company', shippingCoFilter);
                        if (customerCareFilter !== 'All') itemQuery = itemQuery.eq('sales.customer_care', customerCareFilter);
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
                            finalOrFilters.push(`id.ilike.${matchStr},remark.ilike.${matchStr},tracking_number.ilike.${matchStr},customer_snapshot->>name.ilike.${matchStr},customer_snapshot->>phone.ilike.${matchStr},customer_snapshot->>city.ilike.${matchStr}`);
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
                    date: 'date',
                    customer: 'customer_id',
                    phone: 'customer_id',
                    address: 'customer_id',
                    shippingCo: 'shipping_company',
                    tracking: 'tracking_number',
                    deliveryMan: 'shipping_staff',
                    status: 'shipping_status',
                    cost: 'shipping_cost',
                    remark: 'remark'
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
            console.error("Fetch delivery tracking failed", err);
        } finally {
            setIsLoadingOrders(false);
        }
    }, [statusFilter, paymentStatusFilter, salesmanFilter, shippingCoFilter, customerCareFilter, orderDateRange, searchTerm, currentPage, itemsPerPage, salesUpdatedAt, currentUser, sortConfig]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    const trackingOrders = serverOrders;
    const paginatedOrders = serverOrders;

    // Calculate Totals for the current page
    const stats = useMemo(() => {
        const pendingCount = trackingOrders.filter(o => (o.shipping?.status || 'Pending') === 'Pending').length;
        const shippedCount = trackingOrders.filter(o => o.shipping?.status === 'Shipped').length;
        const totalItems = totalCount;
        const totalCost = trackingOrders.reduce((sum, order) => sum + (order.shipping?.cost || 0), 0);
        const statusCounts = trackingOrders.reduce((acc, order) => {
            const status = order.shipping?.status || 'Pending';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        const payStatusCounts = trackingOrders.reduce((acc, order) => {
            const status = order.paymentStatus || 'Unpaid';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return {
            pendingCount,
            shippedCount,
            totalItems,
            totalCost,
            statusCounts,
            payStatusCounts
        };
    }, [trackingOrders, totalCount]);



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
            status: (order.shipping?.status || 'Pending') as 'Ordered' | 'Pending' | 'Confirmed' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned' | 'ReStock'
        });
        setIsEditModalOpen(true);
    };



    const StatusStepper = ({ currentStatus }: { currentStatus: string }) => {
        const steps = ['Ordered', 'Pending', 'Confirmed', 'Shipped', 'Delivered'];
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
                                {idx === 0 && <ClipboardList size={16} />}
                                {idx === 1 && <Clock size={16} />}
                                {idx === 2 && <CheckCircle size={16} />}
                                {idx === 3 && <Truck size={16} />}
                                {idx === 4 && <Package size={16} />}
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

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Order Date:</span>
                    <DateRangePicker value={orderDateRange} onChange={setOrderDateRange} />
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <div ref={salesmanFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                        <button
                            onClick={() => { setIsSalesmanOpen(!isSalesmanOpen); setIsShippingCoOpen(false); setIsCustomerCareOpen(false); setIsStatusFilterOpen(false); }}
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
                            onClick={() => { setIsCustomerCareOpen(!isCustomerCareOpen); setIsSalesmanOpen(false); setIsShippingCoOpen(false); setIsStatusFilterOpen(false); }}
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
                            onClick={() => { setIsShippingCoOpen(!isShippingCoOpen); setIsSalesmanOpen(false); setIsCustomerCareOpen(false); setIsStatusFilterOpen(false); }}
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
                                        <span style={{ fontSize: "13px", color: getShippingCoColor(co) }}>{co}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <div ref={statusFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                        <button
                            onClick={() => { setIsStatusFilterOpen(!isStatusFilterOpen); setIsSalesmanOpen(false); setIsCustomerCareOpen(false); setIsShippingCoOpen(false); }}
                            className="search-input"
                            style={{
                                minWidth: '130px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'var(--color-surface)',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 500, color: statusFilter.length === 0 ? '#000000' : '#000000' }}>
                                    {statusFilter.length === 0 ? 'All Shipping' : `Shipping (${statusFilter.length})`}
                                </span>
                            </div>
                            <ChevronDown size={14} color="var(--color-text-secondary)" />
                        </button>
                        {isStatusFilterOpen && (
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
                                    backgroundColor: statusFilter.length === 8 ? 'var(--color-bg)' : 'transparent'
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={statusFilter.length === 8}
                                        onChange={(e) => {
                                            if (e.target.checked) setStatusFilter(['Ordered', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled']);
                                            else setStatusFilter([]);
                                        }}
                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                    />
                                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#000000' }}>Select All</span>
                                </label>
                                {['Ordered', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled'].map(s => {
                                    const getStatusColors = (status: string) => {
                                        switch (status) {
                                            case 'Pending': return { bg: '#FEF3C7', color: '#D97706' };
                                            case 'Confirmed': return { bg: '#E0F2FE', color: '#0369A1' };
                                            case 'Shipped': return { bg: '#DBEAFE', color: '#2563EB' };
                                            case 'Delivered': return { bg: '#D1FAE5', color: '#059669' };
                                            case 'Cancelled': return { bg: '#FEE2E2', color: '#DC2626' };
                                            case 'Returned': return { bg: '#F3F4F6', color: '#DC2626' };
                                            case 'ReStock': return { bg: '#E9D5FF', color: '#7E22CE' };
                                            case 'Ordered': return { bg: '#F3F4F6', color: '#111827' };
                                            default: return { bg: '#F3F4F6', color: '#4B5563' };
                                        }
                                    };
                                    const colors = getStatusColors(s);
                                    return (
                                        <label key={s} style={{
                                            display: 'flex', alignItems: 'center', gap: '8px', padding: '8px',
                                            borderRadius: '6px', cursor: 'pointer',
                                            backgroundColor: statusFilter.includes(s) ? 'var(--color-bg)' : 'transparent'
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={statusFilter.includes(s)}
                                                onChange={(e) => {
                                                    if (e.target.checked) setStatusFilter([...statusFilter, s]);
                                                    else setStatusFilter(statusFilter.filter(x => x !== s));
                                                }}
                                                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                            />
                                            <span style={{ fontSize: "13px", padding: '2px 6px', borderRadius: '4px', background: colors.bg, color: colors.color }}>{s}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <select
                        value={paymentStatusFilter}
                        onChange={e => setPaymentStatusFilter(e.target.value as any)}
                        className="search-input"
                        style={{ width: '130px' }}
                    >
                        <option value="All">All Payment</option>
                        <option value="Paid" style={{ backgroundColor: '#D1FAE5', color: '#059669' }}>Paid</option>
                        <option value="Get File" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>Get File</option>
                        <option value="Unpaid" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>Unpaid</option>
                        <option value="Cancel" style={{ backgroundColor: '#FEF2F2', color: '#991B1B' }}>Cancel</option>
                    </select>

                    <button
                        onClick={() => {
                            setSearchTerm('');
                            setStatusFilter([]);
                            setPaymentStatusFilter('All');
                            setSalesmanFilter('All');
                            setShippingCoFilter([]);
                            setCustomerCareFilter('All');
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
                        const btn = document.getElementById('delivery-refresh-btn');
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
                    <RefreshCw id="delivery-refresh-btn" size={18} />
                </button>

                {currentUser?.roleId === 'admin' && (
                    <button
                        onClick={() => setShowTelegramSettings(true)}
                        title="Telegram Settings"
                        style={{
                            padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: '#0088cc', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}
                    >
                        <MessageCircle size={18} />
                    </button>
                )}
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
            <div className="glass-panel" style={{ overflow: 'visible', maxHeight: 'calc(100vh - 260px)' }}> {/* changed overflow to visible for dropdowns if needed, or better keep auto but manage dropdown z-index/portal */}
                {/* Reverting to auto for scrolling, custom dropdown handles inline */}
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
                                                width: `var(--col-delivery-${colId}-width, ${width}px)`,
                                                minWidth: `var(--col-delivery-${colId}-width, ${width}px)`,
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
                                <tr key={order.id} className={selectedIds.has(order.id) ? 'selected' : ''}>
                                    <td style={{ width: '40px', textAlign: 'center' }} className="sticky-col-first">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(order.id)}
                                            onChange={() => toggleSelection(order.id)}
                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                        />
                                    </td>
                                    {visibleColumns.includes('actions') &&
                                        <td style={{ width: `var(--col-delivery-actions-width, ${columnWidths.actions}px)` }} className="sticky-col-second">
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button 
                                                    onClick={() => setReceiptSale(order)} 
                                                    className="icon-button" 
                                                    title={['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '') ? "Print Receipt" : "Print disabled (Status must be Confirmed, Shipped, or Delivered)"}
                                                    disabled={!['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '')}
                                                    style={{ 
                                                        padding: '4px', 
                                                        background: 'transparent', 
                                                        border: 'none', 
                                                        cursor: ['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '') ? 'pointer' : 'not-allowed',
                                                        opacity: ['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '') ? 1 : 0.4
                                                    }}
                                                >
                                                    <Printer size={16} color={['Confirmed', 'Shipped', 'Delivered'].includes(order.shipping?.status || '') ? (order.isPrinted ? "#2563EB" : "#DC2626") : "#ccc"} />
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
                                    {visibleColumns.includes('date') && <td style={{ width: `var(--col-delivery-date-width, ${columnWidths.date}px)` }}>{new Date(order.date).toLocaleDateString()}</td>}
                                    {visibleColumns.includes('customer') && <td style={{ fontWeight: 500, width: `var(--col-delivery-customer-width, ${columnWidths.customer}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.customer?.name}>{order.customer?.name}</td>}
                                    {visibleColumns.includes('phone') && <td style={{ color: 'var(--color-text-secondary)', width: `var(--col-delivery-phone-width, ${columnWidths.phone}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.customer?.phone}>{order.customer?.phone}</td>}
                                    {visibleColumns.includes('address') && <td style={{ color: 'var(--color-text-secondary)', width: `var(--col-delivery-address-width, ${columnWidths.address}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.customer?.address || ''}>{order.customer?.address || '-'}</td>}
                                    {visibleColumns.includes('items') && <td style={{ width: `var(--col-delivery-items-width, ${columnWidths.items}px)` }}>
                                        <div style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={order.items.map(i => `${i.name} x${i.quantity}`).join(', ')}>
                                            {order.items.map(i => `${i.name} x${i.quantity}`).join(', ')}
                                        </div>
                                    </td>}
                                    {visibleColumns.includes('shippingCo') && <td style={{ color: getShippingCoColor(order.shipping?.company || ''), width: `var(--col-delivery-shippingCo-width, ${columnWidths.shippingCo}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.shipping?.company || ''}>{order.shipping?.company || '-'}</td>}
                                    {visibleColumns.includes('tracking') && <td style={{ fontFamily: 'monospace', width: `var(--col-delivery-tracking-width, ${columnWidths.tracking}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.shipping?.trackingNumber || ''}>
                                        {order.shipping?.trackingNumber ? (
                                            <span style={{ background: '#F3F4F6', padding: '2px 6px', borderRadius: '4px' }}>{order.shipping.trackingNumber}</span>
                                        ) : '-'}
                                    </td>}
                                    {visibleColumns.includes('deliveryMan') && <td style={{ width: `var(--col-delivery-deliveryMan-width, ${columnWidths.deliveryMan}px)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.shipping?.staffName || ''}>{order.shipping?.staffName || '-'}</td>}
                                    {visibleColumns.includes('status') && <td style={{ width: `var(--col-delivery-status-width, ${columnWidths.status}px)` }}>
                                        <StatusBadge
                                            status={order.shipping?.status || 'Pending'}
                                            onChange={(newStatus) => updateOrderStatus(order.id, newStatus as 'Pending' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned' | 'ReStock')}
                                        />
                                    </td>}
                                    {visibleColumns.includes('cost') && <td style={{ textAlign: 'right', width: `var(--col-delivery-cost-width, ${columnWidths.cost}px)` }}>${(order.shipping?.cost || 0).toFixed(2)}</td>}
                                    {visibleColumns.includes('followUp') && <td style={{ width: `var(--col-delivery-followUp-width, ${columnWidths.followUp}px)` }}>
                                        <FollowUpButton orderId={order.id} status={order.shipping?.status || 'Pending'} isAdmin={currentUser?.roleId === 'admin'} onCall={() => handleFollowUpCall(order)} />
                                    </td>}
                                    {visibleColumns.includes('remark') && <td style={{ width: `var(--col-delivery-remark-width, ${columnWidths.remark}px)` }}>
                                        <EditableRemark order={order} updateOrder={updateOrder} />
                                    </td>}
                                    <td style={{ width: '100%', minWidth: 'auto' }}></td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td className="sticky-col-first" style={{ width: '40px', background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)' }}></td>
                                {visibleColumns.map((colId, index) => {
                                    const width = columnWidths[colId] || 150;
                                    const style = {
                                        width: `var(--col-delivery-${colId}-width, ${width}px)`,
                                        background: 'var(--color-bg)',
                                        borderTop: '2px solid var(--color-border)',
                                        padding: 'var(--table-padding, 5px 6px)',
                                        fontSize: '12px'
                                    };
                                    
                                    if (colId === 'cost') return (
                                        <td key={colId} style={{ ...style, fontWeight: 'bold', textAlign: 'right', color: 'var(--color-red)' }}>
                                            ${stats.totalCost.toFixed(2)}
                                        </td>
                                    );
                                    if (index === 0) return (
                                        <td key={colId} style={{ ...style, fontWeight: 'bold' }}>
                                            Total ({stats.totalItems})
                                        </td>
                                    );
                                    return <td key={colId} style={style}></td>;
                                })}
                                <td style={{ width: '100%', minWidth: 'auto', background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)' }}></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                {totalCount === 0 && !isLoadingOrders && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No shipments found.</div>}
            </div>

            {totalCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', padding: '0', position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                            Showing {Math.min((currentPage - 1) * itemsPerPage + 1, totalCount)} to {Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount} entries
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap', alignItems: 'center' }}>
                            {(() => {
                                const statuses = ['Ordered', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled'];
                                const getStatusColors = (s: string) => {
                                    switch (s) {
                                        case 'Pending': return { bg: '#FEF3C7', color: '#D97706' };
                                        case 'Confirmed': return { bg: '#E0F2FE', color: '#0369A1' };
                                        case 'Shipped': return { bg: '#DBEAFE', color: '#2563EB' };
                                        case 'Delivered': return { bg: '#D1FAE5', color: '#059669' };
                                        case 'Cancelled': return { bg: '#FEE2E2', color: '#DC2626' };
                                        case 'Returned': return { bg: '#F3F4F6', color: '#DC2626' };
                                        case 'ReStock': return { bg: '#E9D5FF', color: '#7E22CE' };
                                        case 'Ordered': return { bg: '#F3F4F6', color: '#111827' };
                                        default: return { bg: '#F3F4F6', color: '#4B5563' };
                                    }
                                };
                                return statuses.map(status => {
                                    const count = stats.statusCounts[status] || 0;
                                    if (count === 0) return null;
                                    const colors = getStatusColors(status);
                                    return (
                                        <span key={status} style={{
                                            backgroundColor: colors.bg,
                                            color: colors.color,
                                            padding: '1px 5px',
                                            borderRadius: '4px',
                                            fontSize: '10px',
                                            fontWeight: 600,
                                            whiteSpace: 'nowrap',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '2px'
                                        }}>
                                            {status}: <strong style={{ fontSize: '11px' }}>{count}</strong>
                                        </span>
                                    );
                                });
                            })()}
                        </div>
                        {Object.values(stats.payStatusCounts).some(c => c > 0) && (
                            <>
                                <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--color-border)' }} />
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap', alignItems: 'center' }}>
                                    {(() => {
                                        const payStatuses = ['Unpaid', 'Get File', 'Paid', 'Cancel', 'Settled', 'Not Settle', 'Pending'];
                                        const getPayStatusColors = (s: string) => {
                                            switch (s) {
                                                case 'Paid': return { bg: '#D1FAE5', color: '#059669' };
                                                case 'Get File': return { bg: '#DBEAFE', color: '#1D4ED8' };
                                                case 'Unpaid': return { bg: '#FEE2E2', color: '#DC2626' };
                                                case 'Settled': return { bg: '#E0E7FF', color: '#4F46E5' };
                                                case 'Not Settle': return { bg: '#FEE2E2', color: '#DC2626' };
                                                case 'Cancel': return { bg: '#FEF2F2', color: '#991B1B' };
                                                case 'Pending': return { bg: '#FEF3C7', color: '#D97706' };
                                                default: return { bg: '#F3F4F6', color: '#4B5563' };
                                            }
                                        };
                                        return payStatuses.map(status => {
                                            const count = stats.payStatusCounts[status] || 0;
                                            if (count === 0) return null;
                                            const colors = getPayStatusColors(status);
                                            return (
                                                <span key={status} style={{
                                                    backgroundColor: colors.bg,
                                                    color: colors.color,
                                                    padding: '1px 5px',
                                                    borderRadius: '4px',
                                                    fontSize: '10px',
                                                    fontWeight: 600,
                                                    whiteSpace: 'nowrap',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '2px'
                                                }}>
                                                    {status}: <strong style={{ fontSize: '11px' }}>{count}</strong>
                                                </span>
                                            );
                                        });
                                    })()}
                                </div>
                            </>
                        )}
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
                                    <select className="search-input" style={{ width: '100%' }} value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value as 'Ordered' | 'Pending' | 'Confirmed' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned' | 'ReStock' })}>
                                        <option value="Ordered">Ordered</option>
                                        <option value="Pending">Pending</option>
                                        <option value="Confirmed">Confirmed</option>
                                        <option value="Shipped">Shipped</option>
                                        <option value="Delivered">Delivered</option>
                                        <option value="Cancelled">Cancelled</option>
                                        <option value="Returned">Returned</option>
                                        <option value="ReStock">ReStock</option>
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

            {/* Telegram Settings Modal */}
            {showTelegramSettings && (
                <Modal isOpen={showTelegramSettings} onClose={() => setShowTelegramSettings(false)} title="Telegram Bot Settings">
                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '5px' }}>
                                Bot Token
                            </label>
                            <input
                                type="text"
                                value={tempBotToken}
                                onChange={(e) => setTempBotToken(e.target.value)}
                                className="search-input"
                                placeholder="1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                                style={{ width: '100%', padding: '10px' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '5px' }}>
                                Group Chat ID
                            </label>
                            <input
                                type="text"
                                value={tempChatId}
                                onChange={(e) => setTempChatId(e.target.value)}
                                className="search-input"
                                placeholder="-1001234567890"
                                style={{ width: '100%', padding: '10px' }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                            <button
                                onClick={handleTestTelegram}
                                style={{
                                    padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--color-border)',
                                    background: 'var(--color-bg)', color: 'var(--color-text-main)', cursor: 'pointer', fontWeight: 500,
                                    marginRight: 'auto'
                                }}
                            >
                                Test Message
                            </button>
                            <button
                                onClick={() => setShowTelegramSettings(false)}
                                style={{
                                    padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--color-border)',
                                    background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer', fontWeight: 500
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveTelegramConfig}
                                style={{
                                    padding: '8px 16px', borderRadius: '6px', border: 'none',
                                    background: 'var(--color-primary)', color: 'white', cursor: 'pointer', fontWeight: 500
                                }}
                            >
                                Save Settings
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </div >
    );
};

export default DeliveryTracking;
