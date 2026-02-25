
import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, Search, Filter, X, ChevronLeft, ChevronRight, ChevronDown, Edit, Trash2, ArrowUp, ArrowDown, Upload, Eye, User, Copy, ExternalLink, Package, Truck, CreditCard, List, Store, Settings, Printer, Clock, CheckCircle, RefreshCw, ChevronsUpDown } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { getOperatorForPhone } from '../utils/telecom';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { POSInterface, StatusBadge, ReceiptModal, DateRangePicker, MobileOrderCard, BulkEditModal, Modal } from '../components';
import PaymentStatusBadge from '../components/PaymentStatusBadge';
import DataImportModal from '../components/DataImportModal';
import { generateOrderCopyText } from '../utils/orderUtils';
import { useClickOutside } from '../hooks/useClickOutside';
import { supabase } from '../lib/supabase';
import { mapSaleEntity } from '../utils/mapper';
import * as XLSX from 'xlsx';
import type { Sale } from '../types';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type SortConfig = {
    key: string;
    direction: 'asc' | 'desc';
} | null;

const SortableRow = ({ id, children, className, style, onClick, ...props }: any) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });

    const styleWithTransform = {
        ...style,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        position: 'relative',
        zIndex: isDragging ? 10 : 1, // Ensure dragging item is above others
        // If we want detailed customization, we can pass handle props to children
    };

    // We attach attributes/listeners to the whole row for now.
    // If strict handle is needed, we would need to pass `listeners` to a handle component.
    // Given "freely", whole row is likely expected.
    return (
        <tr
            ref={setNodeRef}
            style={styleWithTransform}
            className={className}
            onClick={onClick}
            {...attributes}
            {...(props.isRowMovable ? listeners : {})}
            {...props}
        >
            {children}
        </tr>
    );
};

const ShippingModalComponent: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    order: Sale | null;
}> = ({ isOpen, onClose, order }) => {
    const { shippingCompanies, customerCare, updateOrder, updateOrderStatus } = useStore();
    const { showToast } = useToast();

    const [selectedCompany, setSelectedCompany] = useState<string>('');
    const [shippingRemark, setShippingRemark] = useState<string>('');
    const [shippingAddress, setShippingAddress] = useState<string>('');
    const [shippingCustomerCare, setShippingCustomerCare] = useState<string>('');

    useEffect(() => {
        if (isOpen && order) {
            setSelectedCompany(order.shipping?.company || shippingCompanies[0] || '');
            setShippingRemark(order.remark || '');
            setShippingAddress(order.customer?.address || '');
            setShippingCustomerCare(order.customerCare || '');
        }
    }, [isOpen, order, shippingCompanies]);

    if (!order) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Select Shipping Company">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    Please select the shipping company for this order before changing its status to Shipped.
                </p>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Shipping Company <span style={{ color: 'red' }}>*</span></label>
                    <select
                        value={selectedCompany}
                        onChange={(e) => setSelectedCompany(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    >
                        <option value="" disabled>Select a company</option>
                        {shippingCompanies.map(company => (
                            <option key={company} value={company}>{company}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Remark</label>
                    <input
                        type="text"
                        placeholder="Add an optional remark..."
                        value={shippingRemark}
                        onChange={(e) => setShippingRemark(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Address</label>
                    <input
                        type="text"
                        placeholder="Shipping address..."
                        value={shippingAddress}
                        onChange={(e) => setShippingAddress(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Customer Care</label>
                    <select
                        value={shippingCustomerCare}
                        onChange={(e) => setShippingCustomerCare(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    >
                        <option value="" disabled>Select Customer Care</option>
                        {(customerCare || []).map((cc: string) => (
                            <option key={cc} value={cc}>{cc}</option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer',
                            fontSize: '14px', fontWeight: 500
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={async () => {
                            if (!selectedCompany) {
                                showToast('Please select a shipping company', 'error');
                                return;
                            }
                            try {
                                const updates: Partial<Sale> = {};
                                if (shippingRemark !== (order.remark || '')) updates.remark = shippingRemark;
                                if (shippingCustomerCare !== (order.customerCare || '')) updates.customerCare = shippingCustomerCare;
                                if (shippingAddress !== (order.customer?.address || '')) {
                                    updates.customer = { ...order.customer, address: shippingAddress } as any;
                                }

                                if (Object.keys(updates).length > 0) {
                                    await updateOrder(order.id, updates);
                                }
                                await updateOrderStatus(order.id, 'Shipped', order.shipping?.trackingNumber, selectedCompany);
                                showToast('Order marked as shipped', 'success');
                            } catch (e: any) {
                                console.error('Failed to update shipping status:', e);
                                showToast('Update failed. Please try again.', 'error');
                            } finally {
                                onClose();
                            }
                        }}
                        disabled={!selectedCompany}
                        className="primary-button"
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: 'none',
                            background: selectedCompany ? 'var(--color-primary)' : 'var(--color-border)',
                            color: 'white', cursor: selectedCompany ? 'pointer' : 'not-allowed',
                            fontSize: '14px', fontWeight: 500
                        }}
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </Modal>
    );
};

const PendingRemarkModalComponent: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    order: Sale | null;
}> = ({ isOpen, onClose, order }) => {
    const { updateOrder, updateOrderStatus } = useStore();
    const { showToast } = useToast();

    const [remark, setRemark] = useState<string>('');

    useEffect(() => {
        if (isOpen && order) {
            setRemark(order.remark || '');
        }
    }, [isOpen, order]);

    if (!order) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Update Pending Remark">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    Add or update the remark for this pending order before confirming.
                </p>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Remark</label>
                    <input
                        type="text"
                        placeholder="Add remark..."
                        value={remark}
                        onChange={(e) => setRemark(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none'
                        }}
                    />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer',
                            fontSize: '14px', fontWeight: 500
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={async () => {
                            try {
                                if (remark !== (order.remark || '')) {
                                    await updateOrder(order.id, { remark });
                                }
                                await updateOrderStatus(order.id, 'Pending');
                                showToast('Order marked as Pending', 'success');
                            } catch (e: any) {
                                console.error('Failed to update pending status:', e);
                                showToast('Update failed. Please try again.', 'error');
                            } finally {
                                onClose();
                            }
                        }}
                        className="primary-button"
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: 'none',
                            background: 'var(--color-primary)',
                            color: 'white', cursor: 'pointer',
                            fontSize: '14px', fontWeight: 500
                        }}
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </Modal>
    );
};

const Orders: React.FC = () => {
    console.log('Orders render');
    // (Move refs below state declarations)
    const { sales, updateOrderStatus, updateOrder, updateOrders, deleteOrders, editingOrder, setEditingOrder, pinnedOrderColumns, toggleOrderColumnPin, importOrders, restockOrder, hasPermission, users, shippingCompanies, refreshData, currentUser, reorderRows, salesUpdatedAt, loadMoreOrders, hasMoreOrders, isLoadingMore } = useStore();

    const isAdmin = currentUser?.roleId === 'admin';
    const canEdit = hasPermission('manage_orders');
    const canManage = hasPermission('manage_orders');

    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();

    // Tabs & View State
    const [activeTab, setActiveTab] = useState<'list' | 'pos'>(() => {
        return hasPermission('view_orders') ? 'list' : 'pos';
    });

    console.log('Orders Debug:', {
        currentUser,
        roleId: currentUser?.roleId,
        canCreate: hasPermission('create_orders'),
        canView: hasPermission('view_orders'),
        activeTab
    });

    // Update Header Content
    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Orders Management</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage and track all customer orders</p>
                </div>
            ),
            actions: (
                <div style={{ display: 'flex', background: 'var(--color-surface)', padding: '4px', borderRadius: '12px', border: '1px solid var(--color-border)', width: isMobile ? '100%' : 'auto' }}>
                    {hasPermission('view_orders') && (
                        <button
                            onClick={() => setActiveTab('list')}
                            style={{
                                padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', flex: isMobile ? 1 : 'initial',
                                background: activeTab === 'list' ? 'var(--color-primary)' : 'transparent',
                                color: activeTab === 'list' ? 'white' : 'var(--color-text-secondary)',
                                fontWeight: 500, cursor: 'pointer', border: 'none'
                            }}
                        >
                            <List size={18} /> Order List
                        </button>
                    )}
                    {hasPermission('create_orders') && (
                        <button
                            onClick={() => setActiveTab('pos')}
                            style={{
                                padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', flex: isMobile ? 1 : 'initial',
                                background: activeTab === 'pos' ? 'var(--color-primary)' : 'transparent',
                                color: activeTab === 'pos' ? 'white' : 'var(--color-text-secondary)',
                                fontWeight: 500, cursor: 'pointer', border: 'none'
                            }}
                        >
                            <Store size={18} /> POS
                        </button>
                    )}
                </div>
            )
        });

        return () => setHeaderContent(null);
    }, [setHeaderContent, activeTab, hasPermission, isMobile]); // Added hasPermission dependency

    // Filters with Persistence
    const [statusFilter, setStatusFilter] = useState<string[]>(() => {
        const saved = localStorage.getItem('orders_statusFilter');
        if (!saved || saved === 'All') return [];
        try {
            return JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse status filter:', e);
            return [];
        }
    });
    const [isStatusFilterOpen, setIsStatusFilterOpen] = useState(false);

    const [salesmanFilter, setSalesmanFilter] = useState<string>(() =>
        localStorage.getItem('orders_salesmanFilter') || 'All'
    );
    const [isSalesmanOpen, setIsSalesmanOpen] = useState(false);
    const [payStatusFilter, setPayStatusFilter] = useState<string[]>(() =>
        JSON.parse(localStorage.getItem('orders_payStatusFilter') || '[]')
    );
    const [isPayStatusOpen, setIsPayStatusOpen] = useState(false);

    const [shippingCoFilter, setShippingCoFilter] = useState<string[]>(() =>
        JSON.parse(localStorage.getItem('orders_shippingCoFilter') || '[]')
    );
    const [isShippingCoOpen, setIsShippingCoOpen] = useState(false);

    const [dateRange, setDateRange] = useState(() =>
        JSON.parse(localStorage.getItem('orders_dateRange') || '{"start": "", "end": ""}')
    );
    const [searchTerm, setSearchTerm] = useState(() =>
        localStorage.getItem('orders_searchTerm') || ''
    );

    const [showFilters, setShowFilters] = useState(false);

    // Shipping Modal State
    const [isShippingModalOpen, setIsShippingModalOpen] = useState(false);
    const [shippingOrderToUpdate, setShippingOrderToUpdate] = useState<Sale | null>(null);

    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        if (location.state && (location.state as any).editOrderId) {
            const editId = (location.state as any).editOrderId;
            const orderToEdit = sales.find(s => s.id === editId);
            if (orderToEdit) {
                setEditingOrder(orderToEdit);
                setActiveTab('pos');
                navigate(location.pathname, { replace: true, state: {} });
            }
        }
    }, [location.state, sales, navigate, location.pathname]);

    // Persist Filters
    useEffect(() => { localStorage.setItem('orders_statusFilter', JSON.stringify(statusFilter)); }, [statusFilter]);
    useEffect(() => { localStorage.setItem('orders_salesmanFilter', salesmanFilter); }, [salesmanFilter]);
    useEffect(() => { localStorage.setItem('orders_payStatusFilter', JSON.stringify(payStatusFilter)); }, [payStatusFilter]);
    useEffect(() => { localStorage.setItem('orders_shippingCoFilter', JSON.stringify(shippingCoFilter)); }, [shippingCoFilter]);
    useEffect(() => { localStorage.setItem('orders_dateRange', JSON.stringify(dateRange)); }, [dateRange]);
    useEffect(() => { localStorage.setItem('orders_searchTerm', searchTerm); }, [searchTerm]);

    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'date', direction: 'desc' });

    const [isRowMovable, setIsRowMovable] = useState(() => {
        const saved = localStorage.getItem('orders_isRowMovable');
        return saved ? JSON.parse(saved) : true;
    });

    useEffect(() => {
        localStorage.setItem('orders_isRowMovable', JSON.stringify(isRowMovable));
    }, [isRowMovable]);

    // Modals State
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [showTools, setShowTools] = useState(false);
    // editingOrder is from store

    const handleImportOrders = async (data: any[]) => {
        try {
            await importOrders(data);
            setIsImportModalOpen(false);
            showToast('Orders imported successfully', 'success');
            await fetchOrders();
        } catch (error: any) {
            console.error("Import failed:", error);
            showToast(`Failed to import orders: ${error.message || error}`, 'error');
        }
    };
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null);
    const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
    const [receiptSale, setReceiptSale] = useState<Sale | null>(null);

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

    // Mobile Expansion State
    const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());

    const toggleOrderExpansion = (id: string) => {
        const newExpanded = new Set(expandedOrderIds);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedOrderIds(newExpanded);
    };

    const toggleSelection = (id: string, event?: React.MouseEvent) => {
        const newSelected = new Set(selectedIds);

        if (event?.shiftKey && lastSelectedId) {
            const lastIndex = paginatedOrders.findIndex(o => o.id === lastSelectedId);
            const currentIndex = paginatedOrders.findIndex(o => o.id === id);

            if (lastIndex !== -1 && currentIndex !== -1) {
                const start = Math.min(lastIndex, currentIndex);
                const end = Math.max(lastIndex, currentIndex);

                const rangeOrders = paginatedOrders.slice(start, end + 1);

                // Add the range to the existing selection
                rangeOrders.forEach(o => newSelected.add(o.id));
            }
        } else {
            if (newSelected.has(id)) {
                newSelected.delete(id);
            } else {
                newSelected.add(id);
            }
            setLastSelectedId(id);
        }

        setSelectedIds(newSelected);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredOrders.length && filteredOrders.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredOrders.map(o => o.id)));
        }
    };

    const handleBulkDelete = async () => {
        if (confirm(`Are you sure you want to delete ${selectedIds.size} orders ? `)) {
            await deleteOrders(Array.from(selectedIds));
            setSelectedIds(new Set());
            showToast('Orders deleted successfully', 'success');
            await fetchOrders();
        }
    };

    // Column Visibility and Pinning
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const allColumnsDef = [
        { id: 'actions', label: 'Actions' },
        { id: 'date', label: 'Date' },
        { id: 'customer', label: 'Customer' },
        { id: 'phone', label: 'Phone' },
        { id: 'address', label: 'Address' },
        { id: 'page', label: 'Page Name' },
        { id: 'salesman', label: 'Salesman' },
        { id: 'customerCare', label: 'Customer Care' },
        { id: 'items', label: 'Products' },
        { id: 'total', label: 'Total' },
        { id: 'payBy', label: 'Pay By' },
        { id: 'balance', label: 'Balance' },
        { id: 'status', label: 'Order Status' },
        { id: 'received', label: 'Received' },
        { id: 'payStatus', label: 'Pay Status' },
        { id: 'shippingCo', label: 'Shipping Co' },
        { id: 'remark', label: 'Remark' },
        { id: 'tracking', label: 'Tracking ID' },
        { id: 'settleDate', label: 'Settled/Paid Date' },
        { id: 'lastEdit', label: 'Last Edit' },
    ];

    // Default visible columns
    const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
        const saved = localStorage.getItem('orders_visibleColumns');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error('Failed to parse visible columns:', e);
            }
        }
        return [
            'actions', 'date', 'customer', 'phone', 'address', 'page', 'salesman', 'customerCare', 'items', 'total', 'payBy',
            'balance', 'status', 'received', 'payStatus', 'shippingCo', 'remark', 'tracking', 'settleDate', 'lastEdit'
        ];
    });

    // Persist Visible Columns
    useEffect(() => {
        localStorage.setItem('orders_visibleColumns', JSON.stringify(visibleColumns));
    }, [visibleColumns]);

    // Derived Columns with Pinning Logic
    const allColumns = useMemo(() => {
        const pinned = pinnedOrderColumns || [];
        // Sort so pinned columns come first, in the order they were pinned
        return [...allColumnsDef].sort((a, b) => {
            const indexA = pinned.indexOf(a.id);
            const indexB = pinned.indexOf(b.id);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0; // Maintain original order for unpinned
        });
    }, [pinnedOrderColumns]);


    // Resizing State
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('pos_column_widths');
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => {
        localStorage.setItem('pos_column_widths', JSON.stringify(columnWidths));
    }, [columnWidths]);
    const [resizingCol, setResizingCol] = useState<string | null>(null);
    const resizeRef = React.useRef<{ startX: number; startWidth: number; colId: string } | null>(null);

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
        // Fast DOM update avoiding React re-render of 100 rows
        document.documentElement.style.setProperty(`--col-${colId}-width`, `${newWidth}px`);
    }, []);

    const handleGlobalMouseUp = React.useCallback((e: MouseEvent) => {
        if (!resizeRef.current) return;
        const { startX, startWidth, colId } = resizeRef.current;
        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);

        // Save to state/localStorage only on mouse up
        setColumnWidths(prev => ({ ...prev, [colId]: newWidth }));

        // Clean up CSS var so React state takes over
        document.documentElement.style.removeProperty(`--col-${colId}-width`);

        resizeRef.current = null;
        setResizingCol(null);
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
        document.body.style.cursor = '';
    }, [handleGlobalMouseMove]);

    // Appearance State
    const [showAppearanceMenu, setShowAppearanceMenu] = useState(false);

    // Pending Modal State
    const [isPendingRemarkModalOpen, setIsPendingRemarkModalOpen] = useState(false);
    const [pendingOrderToUpdate, setPendingOrderToUpdate] = useState<Sale | null>(null);

    const [tableSettings, setTableSettings] = useState<{ fontSize: number; padding: number; height: string }>(() => {
        const saved = localStorage.getItem('pos_table_settings');
        return saved ? JSON.parse(saved) : { fontSize: 12, padding: 8, height: 'auto' };
    });

    useEffect(() => {
        localStorage.setItem('pos_table_settings', JSON.stringify(tableSettings));
    }, [tableSettings]);

    // -- Click Outside Refs --
    const statusFilterRef = useClickOutside<HTMLDivElement>(() => setIsStatusFilterOpen(false));
    const salesmanFilterRef = useClickOutside<HTMLDivElement>(() => setIsSalesmanOpen(false));
    const payStatusFilterRef = useClickOutside<HTMLDivElement>(() => setIsPayStatusOpen(false));
    const shippingCoFilterRef = useClickOutside<HTMLDivElement>(() => setIsShippingCoOpen(false));
    const appearanceMenuRef = useClickOutside<HTMLDivElement>(() => setShowAppearanceMenu(false));
    const columnMenuRef = useClickOutside<HTMLDivElement>(() => setShowColumnMenu(false));
    const toolsMenuRef = useClickOutside<HTMLDivElement>(() => setShowTools(false));

    // Cleanup on unmount
    React.useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleGlobalMouseMove);
            document.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [handleGlobalMouseMove, handleGlobalMouseUp]);


    // Derived State (filteredOrders, paginatedOrders, stats) -> kept same essentially
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(100);
    const [totalCount, setTotalCount] = useState(0);

    const [serverOrders, setServerOrders] = useState<Sale[]>([]);
    const [isLoadingOrders, setIsLoadingOrders] = useState(false);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, salesmanFilter, payStatusFilter, shippingCoFilter, dateRange, searchTerm, itemsPerPage]);

    const fetchOrders = React.useCallback(async () => {
        setIsLoadingOrders(true);
        try {
            let query = supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)', { count: 'exact' });

            if (statusFilter.length > 0) {
                query = query.in('shipping_status', statusFilter);
            } else {
                query = query.neq('shipping_status', 'ReStock');
            }

            const isSalesman = currentUser?.roleId === 'salesman';
            const effectiveSalesmanFilter = (isSalesman && salesmanFilter === 'All') ? (currentUser?.name || 'All') : salesmanFilter;

            if (effectiveSalesmanFilter !== 'All') {
                query = query.eq('salesman', effectiveSalesmanFilter);
            }

            if (payStatusFilter.length > 0) {
                query = query.in('payment_status', payStatusFilter);
            }

            if (shippingCoFilter.length > 0) {
                query = query.in('shipping_company', shippingCoFilter);
            }

            if (dateRange.start) {
                const start = new Date(dateRange.start);
                start.setHours(0, 0, 0, 0);
                query = query.gte('date', start.toISOString());
            }
            if (dateRange.end) {
                const end = new Date(dateRange.end);
                end.setHours(23, 59, 59, 999);
                query = query.lte('date', end.toISOString());
            }

            if (searchTerm.trim()) {
                const term = searchTerm.toLowerCase().trim();
                // PostgREST fully supports OR across standard columns and JSONB paths.
                query = query.or(`id.ilike.%${term}%,salesman.ilike.%${term}%,remark.ilike.%${term}%,customer_care.ilike.%${term}%,shipping_company.ilike.%${term}%,tracking_number.ilike.%${term}%,payment_method.ilike.%${term}%,customer_snapshot->>name.ilike.%${term}%,customer_snapshot->>phone.ilike.%${term}%,customer_snapshot->>city.ilike.%${term}%`);
            }

            let dbSortCol = 'date';
            if (sortConfig) {
                const map: Record<string, string> = {
                    'date': 'date',
                    'total': 'total',
                    'balance': 'total',
                    'payBy': 'payment_method',
                    'shippingCo': 'shipping_company',
                    'tracking': 'tracking_number',
                    'status': 'shipping_status',
                    'payStatus': 'payment_status',
                    'remark': 'remark',
                    'settleDate': 'settle_date'
                };
                dbSortCol = map[sortConfig.key] || 'date';
            }
            query = query.order(dbSortCol, { ascending: sortConfig?.direction === 'asc' });

            const from = (currentPage - 1) * itemsPerPage;
            const to = from + itemsPerPage - 1;
            query = query.range(from, to);

            const { data, count, error } = await query;
            if (error) throw error;

            setTotalCount(count || 0);

            const mapped = (data || []).map(mapSaleEntity);
            setServerOrders(mapped);
        } catch (err) {
            console.error("Fetch orders failed", err);
        } finally {
            setIsLoadingOrders(false);
        }
    }, [statusFilter, salesmanFilter, payStatusFilter, shippingCoFilter, dateRange, searchTerm, sortConfig, currentPage, itemsPerPage, currentUser, salesUpdatedAt]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    // Derived states based on the SINGLE PAGE of fetched items
    const filteredOrders = serverOrders;

    const duplicateOrderIds = useMemo(() => {
        const exactMatches = new Map<string, string[]>();
        serverOrders.forEach(order => {
            const dateStr = new Date(order.date).toLocaleDateString();
            const itemsStr = order.items.map(i => `${i.name}_${i.quantity}`).sort().join('|');
            const customerName = String(order.customer?.name || '').trim().toLowerCase();
            const customerPhone = String(order.customer?.phone || '').trim();
            const key = `${customerName}_${customerPhone}_${order.total}_${dateStr}_${itemsStr}`;

            if (!exactMatches.has(key)) {
                exactMatches.set(key, []);
            }
            exactMatches.get(key)!.push(order.id);
        });

        const duplicates = new Set<string>();
        exactMatches.forEach(ids => {
            if (ids.length > 1) {
                ids.forEach(id => duplicates.add(id));
            }
        });
        return duplicates;
    }, [serverOrders]);

    const getRowClass = (order: Sale) => {
        if (selectedIds.has(order.id)) return 'selected';
        if (duplicateOrderIds.has(order.id)) return 'duplicate-row';

        // Priority 1: Payment Status = Cancel
        if (order.paymentStatus === 'Cancel') return 'returned-row';

        // Priority 2: Shipping Status
        const shippingStatus = order.shipping?.status;
        if (shippingStatus === 'Ordered') return 'ordered-row';
        if (shippingStatus === 'Pending') return 'pending-row';
        if (shippingStatus === 'Shipped') return 'shipped-row';
        if (shippingStatus === 'Delivered') return 'delivered-row';
        if (shippingStatus === 'Returned') return 'returned-row';
        if (shippingStatus === 'ReStock') return 'restock-row';

        // Secondary: Payment Status
        if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Settled') return 'paid-settled-row';

        return '';
    };

    const getRowBackgroundColor = (order: Sale, isSelected: boolean) => {
        if (isSelected) return 'var(--color-primary-light)';
        if (duplicateOrderIds.has(order.id)) return '#6B21A8';

        // Priority 1: Payment Status = Cancel
        if (order.paymentStatus === 'Cancel') return '#FCA5A5'; // Red 300

        // Priority 2: Shipping Status
        const shippingStatus = order.shipping?.status;
        if (shippingStatus === 'Ordered') return 'white';
        if (shippingStatus === 'Pending') return '#FFFBEB';
        if (shippingStatus === 'Shipped') return '#EFF6FF';
        if (shippingStatus === 'Delivered') return '#ECFDF5';
        if (shippingStatus === 'Returned') return '#FCA5A5';
        if (shippingStatus === 'ReStock') return '#F5F3FF';
        if (shippingStatus === 'Cancelled') return '#FCA5A5';
        return 'white';
    };



    const paginatedOrders = serverOrders;

    const stats = useMemo(() => {
        const totalOrders = totalCount;
        const totalRevenue = filteredOrders.reduce((sum, order) => sum + order.total, 0);
        const totalReceived = filteredOrders.reduce((sum, order) => sum + (order.amountReceived || (order.paymentStatus === 'Paid' ? order.total : 0)), 0);
        const totalOutstanding = totalRevenue - totalReceived;
        return { totalOrders, totalRevenue, totalReceived, totalOutstanding };
    }, [filteredOrders, totalCount]);

    // Drag and Drop Logic
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (!over || active.id === over.id) return;

        const activeIdStr = String(active.id);
        const overIdStr = String(over.id);

        let idsToMove = [activeIdStr];

        if (selectedIds.has(activeIdStr)) {
            idsToMove = Array.from(selectedIds);
        }

        reorderRows(idsToMove, overIdStr, activeIdStr);
    };

    const handleOpenAdd = () => {
        setEditingOrder(null);
        setActiveTab('pos');
    };

    const handleOpenEdit = (order: Sale) => {
        setEditingOrder(order);
        setActiveTab('pos');
    };

    // Helper to calculate sticky left offset
    const getStickyLeft = (colId: string) => {
        const pinned = pinnedOrderColumns || [];
        const index = pinned.indexOf(colId);
        if (index === -1) return undefined;

        // Base offset for the first checkbox column
        let left = 40;

        // Add widths of preceding pinned columns
        for (let i = 0; i < index; i++) {
            const pid = pinned[i];
            // If a pinned column is hidden, it shouldn't contribute to offset?
            // Assuming pinned columns are visible for now, or check visibleColumns
            if (visibleColumns.includes(pid)) {
                left += (columnWidths[pid] || 150);
            }
        }
        return left;
    };

    const handleExportExcel = () => {
        const selectedOrders = filteredOrders.filter(order => selectedIds.has(order.id));

        if (selectedOrders.length === 0) {
            showToast('No orders selected to export', 'error');
            return;
        }

        const data = selectedOrders.map(order => ({
            'Order ID': order.id,
            'Date': new Date(order.date).toLocaleDateString(),
            'Customer': order.customer?.name || 'N/A',
            'Phone': order.customer?.phone || 'N/A',
            'Address': order.customer?.address || 'N/A',
            'City': order.customer?.city || 'N/A',
            'Page': order.customer?.page || 'N/A',
            'Platform': order.customer?.platform || 'N/A',
            'Salesman': order.salesman || 'N/A',
            'Customer Care': order.customerCare || 'N/A',
            'Items': order.items.map(i => `${i.name} (${i.quantity})`).join(', '),
            'Total Amount': order.total,
            'Payment Method': order.paymentMethod,
            'Payment Status': order.paymentStatus || 'Paid',
            'Settle Date': order.settleDate ? new Date(order.settleDate).toLocaleDateString() : 'N/A',
            'Shipping Company': order.shipping?.company || 'N/A',
            'Shipping Status': order.shipping?.status || 'Pending',
            'Tracking Number': order.shipping?.trackingNumber || 'N/A',
            'Remarks': order.remark || ''
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);

        // Auto-width for columns
        const colWidths = [
            { wch: 20 }, // Order ID
            { wch: 12 }, // Date
            { wch: 20 }, // Customer
            { wch: 15 }, // Phone
            { wch: 30 }, // Address
            { wch: 15 }, // City
            { wch: 15 }, // Page
            { wch: 15 }, // Platform
            { wch: 15 }, // Salesman
            { wch: 15 }, // Customer Care
            { wch: 40 }, // Items
            { wch: 12 }, // Total
            { wch: 15 }, // Method
            { wch: 15 }, // Pay Status
            { wch: 15 }, // Settle Date
            { wch: 20 }, // Ship Company
            { wch: 15 }, // Ship Status
            { wch: 20 }, // Tracking
            { wch: 30 }  // Remarks
        ];
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, "Orders");

        // Generate filename with current date
        const dateStr = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `Selected_Orders_Export_${dateStr}.xlsx`);

        showToast(`Exported ${selectedOrders.length} orders to Excel`, 'success');
    };

    const handleDelete = async () => {
        if (selectedIds.size === 0) return;

        if (window.confirm(`Are you sure you want to delete ${selectedIds.size} orders? \n\nIMPORTANT: The items in these orders will be returned to the product stock.`)) {
            try {
                await deleteOrders(Array.from(selectedIds));
                setSelectedIds(new Set());
                showToast('Orders deleted and stock restored', 'success');
                await fetchOrders();
            } catch (error) {
                console.error('Failed to delete orders:', error);
                showToast('Failed to delete orders', 'error');
            }
        }
    };

    const handleBulkEdit = async (field: 'date' | 'status' | 'paymentStatus', value: any) => {
        if (selectedIds.size === 0) return;

        try {
            const ids = Array.from(selectedIds);
            const updates: Partial<Sale> = {};

            if (field === 'date') {
                updates.date = new Date(value).toISOString();
            } else if (field === 'status') {
                // For Status, we need to update shipping.status
                // We'll pass it as { shipping: { status: value } } and let store handle merge
                // BUT current updateOrders implementation does merge shipping if provided.
                // However, shipping property in Sale is 'shipping', inside it is 'status'.
                // If we pass { shipping: { status: 'Shipped' } }, we need to be carefully not to overwrite other shipping fields if the store doesn't handle partial deep merge.
                // My implementation of updateOrders DOES handle deep merge for shipping.
                updates.shipping = { status: value } as any;

                // If status is Delivered, we might want to auto-set payment status?
                // The individual updateOrderStatus does this.
                // For bulk, let's keep it simple or mimic logic? 
                // "Refining Date Picker" -> "Bulk Edit Orders".
                // Let's stick to simple field update for now as user requested "Edit Date, Order Status, Pay Status".
            } else if (field === 'paymentStatus') {
                updates.paymentStatus = value;
                if (value === 'Paid' || value === 'Settled') {
                    updates.amountReceived = 0; // Or keep as is? Usually Paid implies full amount.
                    // Let's NOT clear amountReceived for bulk unless we know.
                    // But if it was Unpaid, amount might be 0.
                    // Let's just update the status tag for now.
                }
            }

            await updateOrders(ids, updates);

            showToast(`Updated ${ids.length} orders`, 'success');
            setSelectedIds(new Set()); // Clear selection
            await fetchOrders();
        } catch (error) {
            console.error('Bulk edit failed:', error);
            showToast('Failed to update orders', 'error');
        }
    };



    // Render Helpers
    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const SortIcon = ({ columnKey }: { columnKey: string }) => {
        if (sortConfig?.key !== columnKey) return <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />;
        return sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    };

    // UI Helpers & Components

    // Legacy helper for Modal (can eventually reuse above logic properly)
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'Pending': return <span style={{ background: '#FEF3C7', color: '#D97706', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> Pending</span>;
            case 'Shipped': return <span style={{ background: '#DBEAFE', color: '#2563EB', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><Truck size={12} /> Shipped</span>;
            case 'Delivered': return <span style={{ background: '#D1FAE5', color: '#059669', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={12} /> Delivered</span>;
            case 'Cancelled': return <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}><X size={12} /> Cancelled</span>;
            default: return <span>{status}</span>;
        }
    };

    const handleCopyOrder = (order: Sale) => {
        const text = generateOrderCopyText(order, sales);

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => showToast('Order details copied to clipboard', 'success'))
                .catch((err) => {
                    console.error('Clipboard write failed:', err);
                    fallbackCopyTextToClipboard(text);
                });
        } else {
            fallbackCopyTextToClipboard(text);
        }
    };

    const fallbackCopyTextToClipboard = (text: string) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;

        // Ensure strictly accessible for selection but minimally visible
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.width = '2em';
        textArea.style.height = '2em';
        textArea.style.padding = '0';
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';
        textArea.style.background = 'transparent';

        // Using very low opacity instead of 0, as some browsers ignore opacity:0 selection
        textArea.style.opacity = '0.01';

        document.body.appendChild(textArea);

        if (navigator.userAgent.match(/ipad|iphone/i)) {
            // iOS needs contentEditable
            textArea.contentEditable = 'true';
            textArea.readOnly = false;
        } else {
            textArea.focus();
        }

        // Just use select() and setSelectionRange, creating a range on a textarea value does not work via selectNodeContents
        textArea.select();
        textArea.setSelectionRange(0, 999999); // Universal

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showToast('Order details copied to clipboard', 'success');
            } else {
                showToast('Copy failed. Please copy manually.', 'error');
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            showToast('Copy error', 'error');
        }

        document.body.removeChild(textArea);
    };

    const hasFilters = statusFilter.length > 0 || salesmanFilter !== 'All' || searchTerm !== '' || payStatusFilter.length > 0 || shippingCoFilter.length > 0 || (dateRange.start && dateRange.end);

    return (
        <div>
            {/* Header */}
            {/* Header Moved to Global Header */}

            {activeTab === 'list' ? (
                <>


                    {/* Filters Bar */}
                    <div className="glass-panel" style={{ marginBottom: '12px', padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', position: 'relative', zIndex: 50 }}>


                        {/* Search and DatePicker Row */}
                        <div style={{
                            display: 'flex',
                            gap: '12px',
                            alignItems: 'center',
                            width: '100%',
                            flex: 1,
                            minWidth: isMobile ? 'auto' : '300px'
                        }}>
                            <div style={{ position: 'relative', flex: 1 }}>
                                <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="search-input"
                                    style={{ paddingLeft: '36px', width: '100%', height: '40px', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                                />
                            </div>
                            {canEdit && selectedIds.size > 0 && (
                                <button
                                    onClick={() => setIsBulkEditOpen(true)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '0 16px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-primary)',
                                        background: 'var(--color-surface)',
                                        color: 'var(--color-primary)',
                                        cursor: 'pointer',
                                        fontWeight: 500,
                                        transition: 'all 0.2s',
                                        height: '40px',
                                        whiteSpace: 'nowrap'
                                    }}
                                    title="Bulk Edit Selected Orders"
                                >
                                    <Edit size={18} />
                                    Bulk Edit {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                                </button>
                            )}
                            <div style={{ width: 'auto' }}>
                                <DateRangePicker
                                    value={dateRange}
                                    onChange={setDateRange}
                                    style={{ width: '100%' }}
                                    compact={isMobile}
                                />
                            </div>
                            {isMobile && (
                                <button
                                    onClick={() => setShowFilters(!showFilters)}
                                    style={{
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        background: showFilters ? 'var(--color-primary)' : 'var(--color-surface)',
                                        color: showFilters ? 'white' : 'var(--color-text-secondary)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    title="Toggle Filters"
                                >
                                    <Filter size={18} />
                                </button>
                            )}
                            <button
                                disabled={isLoadingOrders}
                                onClick={() => {
                                    const btn = document.getElementById('orders-refresh-btn');
                                    if (btn) btn.style.animation = 'spin 1s linear infinite';
                                    Promise.all([
                                        refreshData(true),
                                        fetchOrders()
                                    ]).finally(() => {
                                        if (btn) btn.style.animation = 'none';
                                        showToast('Data refreshed', 'success');
                                    });
                                }}
                                style={{
                                    padding: '10px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    background: 'var(--color-surface)',
                                    color: 'var(--color-text-secondary)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                                title="Refresh Orders"
                            >
                                <RefreshCw id="orders-refresh-btn" size={18} />
                            </button>
                            <style>{`
                                @keyframes spin { 
                                    100% { -webkit-transform: rotate(360deg); transform:rotate(360deg); } 
                                }
                            `}</style>
                        </div>
                        {(!isMobile || showFilters) && (
                            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
                                <div style={{ width: isMobile ? 'auto' : 'auto' }}>
                                    {/* DateRangePicker removed from old location */}
                                </div>
                                <div ref={salesmanFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                                    <button
                                        onClick={() => setIsSalesmanOpen(!isSalesmanOpen)}
                                        className="search-input"
                                        style={{
                                            minWidth: '160px',
                                            width: isMobile ? '100%' : 'auto',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            cursor: 'pointer',
                                            paddingRight: '12px',
                                            background: 'white',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <User size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: salesmanFilter === 'All' ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {salesmanFilter === 'All' ? (currentUser?.roleId === 'salesman' ? currentUser.name : 'All Salesmen') : salesmanFilter}
                                            </span>
                                        </div>
                                        <ChevronDown size={14} color="var(--color-text-secondary)" />
                                    </button>

                                    {isSalesmanOpen && (
                                        <>

                                            <div className="glass-panel" style={{
                                                position: 'absolute',
                                                top: '100%',
                                                left: 0,
                                                marginTop: '4px',
                                                width: '200px',
                                                padding: '8px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '2px',
                                                zIndex: 100,
                                                background: 'white',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                <label style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '8px 12px',
                                                    cursor: 'pointer',
                                                    borderRadius: '6px',
                                                    transition: 'background 0.2s',
                                                    backgroundColor: salesmanFilter === 'All' ? 'var(--color-bg)' : 'transparent'
                                                }}
                                                    onClick={() => { setSalesmanFilter('All'); setIsSalesmanOpen(false); }}
                                                >
                                                    <span style={{ fontSize: '13px' }}>{currentUser?.roleId === 'salesman' ? currentUser.name : 'All Salesmen'}</span>
                                                </label>
                                                {currentUser?.roleId !== 'salesman' && users.filter(u => u.roleId !== 'admin').map(s => (
                                                    <label key={s.id} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '8px 12px',
                                                        cursor: 'pointer',
                                                        borderRadius: '6px',
                                                        transition: 'background 0.2s',
                                                        backgroundColor: salesmanFilter === s.name ? 'var(--color-bg)' : 'transparent'
                                                    }}
                                                        onClick={() => { setSalesmanFilter(s.name); setIsSalesmanOpen(false); }}
                                                    >
                                                        <span style={{ fontSize: '13px' }}>{s.name}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>



                                <div ref={statusFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                                    <button
                                        onClick={() => setIsStatusFilterOpen(!isStatusFilterOpen)}
                                        className="search-input"
                                        style={{
                                            minWidth: '160px',
                                            width: isMobile ? '100%' : 'auto',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            cursor: 'pointer',
                                            paddingRight: '12px',
                                            background: 'white',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Package size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: statusFilter.length === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {statusFilter.length === 0 ? 'All Order Status' : `${statusFilter.length} Selected`}
                                            </span>
                                        </div>
                                        <ChevronDown size={14} color="var(--color-text-secondary)" />
                                    </button>

                                    {isStatusFilterOpen && (
                                        <>

                                            <div className="glass-panel" style={{
                                                position: 'absolute',
                                                top: '100%',
                                                left: 0,
                                                marginTop: '4px',
                                                width: '200px',
                                                padding: '8px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '2px',
                                                zIndex: 100,
                                                background: 'white',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                <label style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '8px 12px',
                                                    cursor: 'pointer',
                                                    borderRadius: '6px',
                                                    borderBottom: '1px solid var(--color-border)',
                                                    marginBottom: '4px'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={statusFilter.length === 5}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setStatusFilter(['Ordered', 'Pending', 'Shipped', 'Delivered', 'Returned']);
                                                            } else {
                                                                setStatusFilter([]);
                                                            }
                                                        }}
                                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                    />
                                                    <span style={{ fontSize: '13px', fontWeight: 500 }}>Select All</span>
                                                </label>
                                                {['Ordered', 'Pending', 'Shipped', 'Delivered', 'Returned'].map(status => (
                                                    <label key={status} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '8px 12px',
                                                        cursor: 'pointer',
                                                        borderRadius: '6px',
                                                        transition: 'background 0.2s',
                                                        backgroundColor: statusFilter.includes(status) ? 'var(--color-bg)' : 'transparent'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={statusFilter.includes(status)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setStatusFilter([...statusFilter, status]);
                                                                else setStatusFilter(statusFilter.filter(s => s !== status));
                                                            }}
                                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                        />
                                                        <span style={{ fontSize: '13px' }}>{status}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>



                                <div ref={payStatusFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                                    <button
                                        onClick={() => setIsPayStatusOpen(!isPayStatusOpen)}
                                        className="search-input"
                                        style={{
                                            minWidth: '160px',
                                            width: isMobile ? '100%' : 'auto',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            cursor: 'pointer',
                                            paddingRight: '12px',
                                            background: 'white',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <CreditCard size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: payStatusFilter.length === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {payStatusFilter.length === 0 ? 'All Pay Status' : `${payStatusFilter.length} Selected`}
                                            </span>
                                        </div>
                                        <ChevronDown size={14} color="var(--color-text-secondary)" />
                                    </button>

                                    {isPayStatusOpen && (
                                        <>

                                            <div className="glass-panel" style={{
                                                position: 'absolute',
                                                top: '100%',
                                                left: 0,
                                                marginTop: '4px',
                                                width: '200px',
                                                padding: '8px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '2px',
                                                zIndex: 100,
                                                background: 'white',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                <label style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '8px 12px',
                                                    cursor: 'pointer',
                                                    borderRadius: '6px',
                                                    borderBottom: '1px solid var(--color-border)',
                                                    marginBottom: '4px'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={payStatusFilter.length === 6}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setPayStatusFilter(['Pending', 'Paid', 'Unpaid', 'Settled', 'Not Settle', 'Cancel']);
                                                            } else {
                                                                setPayStatusFilter([]);
                                                            }
                                                        }}
                                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                    />
                                                    <span style={{ fontSize: '13px', fontWeight: 500 }}>Select All</span>
                                                </label>
                                                {['Pending', 'Paid', 'Unpaid', 'Settled', 'Not Settle', 'Cancel'].map(status => (
                                                    <label key={status} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '8px 12px',
                                                        cursor: 'pointer',
                                                        borderRadius: '6px',
                                                        transition: 'background 0.2s',
                                                        backgroundColor: payStatusFilter.includes(status) ? 'var(--color-bg)' : 'transparent'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={payStatusFilter.includes(status)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setPayStatusFilter([...payStatusFilter, status]);
                                                                else setPayStatusFilter(payStatusFilter.filter(s => s !== status));
                                                            }}
                                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                        />
                                                        <span style={{ fontSize: '13px' }}>{status}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* Shipping Co Filter */}
                                <div ref={shippingCoFilterRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                                    <button
                                        onClick={() => { setIsShippingCoOpen(!isShippingCoOpen); setIsStatusFilterOpen(false); setIsPayStatusOpen(false); }}
                                        className="search-input"
                                        style={{
                                            minWidth: '160px',
                                            width: isMobile ? '100%' : 'auto',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            cursor: 'pointer',
                                            paddingRight: '12px',
                                            background: 'white',
                                            height: '40px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Truck size={16} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', fontWeight: 500, color: shippingCoFilter.length === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-main)' }}>
                                                {shippingCoFilter.length === 0 ? 'Shipping Co' : `Shipping (${shippingCoFilter.length})`}
                                            </span>
                                        </div>
                                        <ChevronDown size={14} color="var(--color-text-secondary)" />
                                    </button>
                                    {isShippingCoOpen && (
                                        <>

                                            <div className="glass-panel" style={{
                                                position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                                padding: '8px', width: '220px', zIndex: 100,
                                                display: 'flex', flexDirection: 'column', gap: '2px',
                                                background: 'white',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                {shippingCompanies.length > 0 && (
                                                    <label style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '8px 12px',
                                                        cursor: 'pointer',
                                                        borderRadius: '6px',
                                                        borderBottom: '1px solid var(--color-border)',
                                                        marginBottom: '4px'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={shippingCoFilter.length === shippingCompanies.length && shippingCompanies.length > 0}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setShippingCoFilter([...shippingCompanies]);
                                                                else setShippingCoFilter([]);
                                                            }}
                                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                        />
                                                        <span style={{ fontSize: '13px', fontWeight: 500 }}>Select All</span>
                                                    </label>
                                                )}
                                                {shippingCompanies.map(co => (
                                                    <label key={co} style={{
                                                        display: 'flex', alignItems: 'center', gap: '10px',
                                                        padding: '8px 12px', cursor: 'pointer', borderRadius: '6px',
                                                        transition: 'background 0.2s',
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
                                                        <span style={{ fontSize: '13px' }}>{co}</span>
                                                    </label>
                                                ))}
                                                {shippingCompanies.length === 0 && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', padding: '8px' }}>No shipping companies found.</div>}
                                            </div>
                                        </>
                                    )}
                                </div>



                                <button
                                    onClick={() => {
                                        setSearchTerm('');
                                        setStatusFilter([]);
                                        setSalesmanFilter('All');
                                        setPayStatusFilter([]);
                                        setShippingCoFilter([]);


                                        setDateRange({ start: '', end: '' });
                                    }}
                                    disabled={!hasFilters}
                                    style={{
                                        padding: '10px 16px', borderRadius: '8px',
                                        border: hasFilters ? '1px solid #FECACA' : '1px solid var(--color-border)',
                                        background: hasFilters ? '#FEE2E2' : 'var(--color-surface)',
                                        color: hasFilters ? '#DC2626' : 'var(--color-text-secondary)',
                                        cursor: hasFilters ? 'pointer' : 'not-allowed',
                                        opacity: hasFilters ? 1 : 0.5,
                                        fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px',
                                        transition: 'all 0.2s',
                                        width: isMobile ? '100%' : 'auto',
                                        justifyContent: 'center',
                                        height: '40px'
                                    }}
                                    title="Clear All Filters"
                                >
                                    <X size={16} /> Clear
                                </button>

                                {!isMobile && (
                                    <div ref={toolsMenuRef} style={{ position: 'relative', width: isMobile ? '100%' : 'auto' }}>
                                        <button
                                            onClick={() => setShowTools(!showTools)}
                                            style={{
                                                padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--color-border)',
                                                background: showTools ? 'var(--color-primary)' : 'var(--color-surface)',
                                                color: showTools ? 'white' : 'var(--color-text-main)',
                                                cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', gap: '8px',
                                                width: '100%', justifyContent: 'center', height: '40px',
                                                transition: 'all 0.2s'
                                            }}
                                            title="Toggle Tools"
                                        >
                                            <Settings size={18} />
                                            <span style={{ fontSize: '13px', fontWeight: 500 }}>Tools</span>
                                            <ChevronDown size={14} style={{ transform: showTools ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                                        </button>

                                        {showTools && (
                                            <div className="glass-panel" style={{
                                                position: 'absolute', top: '100%', right: 0, marginTop: '4px',
                                                padding: '8px', width: '220px', zIndex: 100,
                                                display: 'flex', flexDirection: 'column', gap: '4px',
                                                background: 'white',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                                            }}>
                                                <div ref={appearanceMenuRef} style={{ position: 'relative', width: '100%' }}>
                                                    <button
                                                        onClick={() => { setShowAppearanceMenu(!showAppearanceMenu); setShowColumnMenu(false); }}
                                                        style={{
                                                            padding: '8px 12px', borderRadius: '6px', border: 'none',
                                                            background: showAppearanceMenu ? 'var(--color-bg)' : 'transparent',
                                                            color: 'var(--color-text-main)', cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: '8px',
                                                            width: '100%', textAlign: 'left', fontSize: '13px',
                                                            transition: 'background 0.2s'
                                                        }}
                                                    >
                                                        <Eye size={16} color="var(--color-primary)" />
                                                        <span style={{ flex: 1, textAlign: 'left' }}>Appearance</span>
                                                        <ChevronRight size={14} color="var(--color-text-secondary)" />
                                                    </button>
                                                    {showAppearanceMenu && (
                                                        <div className="glass-panel" style={{
                                                            position: 'absolute', top: 0, right: '100%', marginRight: '8px',
                                                            padding: '16px', width: '250px', zIndex: 101, maxHeight: '300px', overflowY: 'auto',
                                                            display: 'flex', flexDirection: 'column', gap: '12px', background: 'white',
                                                            boxShadow: '-4px 4px 20px rgba(0,0,0,0.1)'
                                                        }}>
                                                            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Table Settings</h4>
                                                            <div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                                    <label style={{ fontSize: '13px' }}>Font Size</label>
                                                                    <span style={{ fontSize: '12px', color: 'gray' }}>{tableSettings.fontSize}px</span>
                                                                </div>
                                                                <input
                                                                    type="range" min="9" max="16" value={tableSettings.fontSize}
                                                                    onChange={(e) => setTableSettings({ ...tableSettings, fontSize: parseInt(e.target.value) })}
                                                                    style={{ width: '100%' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                                    <label style={{ fontSize: '13px' }}>Row Padding</label>
                                                                    <span style={{ fontSize: '12px', color: 'gray' }}>{tableSettings.padding}px</span>
                                                                </div>
                                                                <input
                                                                    type="range" min="0" max="20" step="1" value={tableSettings.padding}
                                                                    onChange={(e) => setTableSettings({ ...tableSettings, padding: parseInt(e.target.value) })}
                                                                    style={{ width: '100%' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ fontSize: '13px', display: 'block', marginBottom: '4px' }}>Row Height</label>
                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                    <button
                                                                        onClick={() => setTableSettings({ ...tableSettings, height: 'auto' })}
                                                                        style={{
                                                                            flex: 1, padding: '6px', fontSize: '12px',
                                                                            background: tableSettings.height === 'auto' ? 'var(--color-primary)' : 'var(--color-bg)',
                                                                            color: tableSettings.height === 'auto' ? 'white' : 'var(--color-text-main)',
                                                                            borderRadius: '4px', border: 'none', cursor: 'pointer'
                                                                        }}
                                                                    >
                                                                        Auto
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setTableSettings({ ...tableSettings, height: '44px' })}
                                                                        style={{
                                                                            flex: 1, padding: '6px', fontSize: '12px',
                                                                            background: tableSettings.height === '44px' ? 'var(--color-primary)' : 'var(--color-bg)',
                                                                            color: tableSettings.height === '44px' ? 'white' : 'var(--color-text-main)',
                                                                            borderRadius: '4px', border: 'none', cursor: 'pointer'
                                                                        }}
                                                                    >
                                                                        Fixed
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                <button
                                                    onClick={() => { setIsRowMovable(!isRowMovable); setShowTools(false); }}
                                                    style={{
                                                        padding: '8px 12px', borderRadius: '6px', border: 'none',
                                                        background: isRowMovable ? 'var(--color-primary-light)' : 'transparent',
                                                        color: isRowMovable ? 'var(--color-primary)' : 'var(--color-text-main)', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', gap: '8px',
                                                        width: '100%', textAlign: 'left', fontSize: '13px',
                                                        transition: 'background 0.2s', marginTop: '4px'
                                                    }}
                                                >
                                                    <ChevronsUpDown size={16} color={isRowMovable ? 'var(--color-primary)' : 'var(--color-text-secondary)'} />
                                                    {isRowMovable ? 'Disable Row Movable' : 'Enable Row Movable'}
                                                </button>

                                                <div ref={columnMenuRef} style={{ position: 'relative', width: '100%' }}>
                                                    <button
                                                        onClick={() => { setShowColumnMenu(!showColumnMenu); setShowAppearanceMenu(false); }}
                                                        style={{
                                                            padding: '8px 12px', borderRadius: '6px', border: 'none',
                                                            background: showColumnMenu ? 'var(--color-bg)' : 'transparent',
                                                            color: 'var(--color-text-main)', cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: '8px',
                                                            width: '100%', textAlign: 'left', fontSize: '13px',
                                                            transition: 'background 0.2s'
                                                        }}
                                                    >
                                                        <List size={16} color="var(--color-primary)" />
                                                        <span style={{ flex: 1, textAlign: 'left' }}>Columns</span>
                                                        <ChevronRight size={14} color="var(--color-text-secondary)" />
                                                    </button>
                                                    {showColumnMenu && (
                                                        <div className="glass-panel" style={{
                                                            position: 'absolute', top: 0, right: '100%', marginRight: '8px',
                                                            padding: '16px', width: '200px', zIndex: 101, maxHeight: '300px', overflowY: 'auto',
                                                            display: 'flex', flexDirection: 'column', gap: '8px', background: 'white',
                                                            boxShadow: '-4px 4px 20px rgba(0,0,0,0.1)'
                                                        }}>
                                                            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Toggle Columns</h4>
                                                            {allColumnsDef.map(col => (
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

                                                <button
                                                    onClick={handleExportExcel}
                                                    disabled={selectedIds.size === 0}
                                                    style={{
                                                        padding: '8px 12px', borderRadius: '6px', border: 'none',
                                                        background: 'transparent',
                                                        color: selectedIds.size > 0 ? 'var(--color-text-main)' : 'var(--color-text-secondary)',
                                                        cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
                                                        display: 'flex', alignItems: 'center', gap: '8px',
                                                        width: '100%', textAlign: 'left', fontSize: '13px',
                                                        transition: 'background 0.2s', opacity: selectedIds.size > 0 ? 1 : 0.5
                                                    }}
                                                >
                                                    <Upload size={16} color={selectedIds.size > 0 ? '#10B981' : "var(--color-text-secondary)"} style={{ transform: 'rotate(180deg)' }} />
                                                    Export {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                                                </button>

                                                {canEdit && (
                                                    <button
                                                        onClick={() => { setIsImportModalOpen(true); setShowTools(false); }}
                                                        style={{
                                                            padding: '8px 12px', borderRadius: '6px', border: 'none',
                                                            background: 'transparent',
                                                            color: 'var(--color-text-main)', cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: '8px',
                                                            width: '100%', textAlign: 'left', fontSize: '13px',
                                                            transition: 'background 0.2s'
                                                        }}
                                                    >
                                                        <Upload size={16} color="var(--color-primary)" />
                                                        Import
                                                    </button>
                                                )}

                                                {isAdmin && selectedIds.size > 0 && (
                                                    <button
                                                        onClick={() => { handleDelete(); setShowTools(false); }}
                                                        style={{
                                                            padding: '8px 12px', borderRadius: '6px', border: 'none',
                                                            background: '#FEE2E2',
                                                            color: '#DC2626', cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: '8px',
                                                            width: '100%', textAlign: 'left', fontSize: '13px',
                                                            transition: 'background 0.2s', marginTop: '4px'
                                                        }}
                                                    >
                                                        <Trash2 size={16} color="#DC2626" />
                                                        Delete {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {
                                    hasPermission('create_orders') && !isMobile && (
                                        <button onClick={handleOpenAdd} className="primary-button" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', width: isMobile ? '100%' : 'auto', justifyContent: 'center' }}>
                                            <Plus size={18} /> New Order
                                        </button>
                                    )
                                }
                            </div>
                        )}
                    </div >

                    {/* Table or Mobile List */}
                    <div style={{
                        overflowX: 'auto',
                        overflowY: isMobile ? 'visible' : 'auto',
                        maxHeight: isMobile ? 'none' : 'calc(100vh - 200px)',
                        paddingBottom: '0'
                    }}>
                        {isMobile ? (
                            <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: '80px' }}>
                                {paginatedOrders.map(order => (
                                    <MobileOrderCard
                                        key={order.id}
                                        order={order}
                                        isSelected={selectedIds.has(order.id)}
                                        onToggleSelect={() => toggleSelection(order.id)}
                                        isExpanded={expandedOrderIds.has(order.id)}
                                        onToggleExpand={() => toggleOrderExpansion(order.id)}
                                        onEdit={(o) => handleOpenEdit(o)}
                                        onView={(o) => { setSelectedOrder(o); setIsViewModalOpen(true); }}
                                        onPrint={(o) => setReceiptSale(o)}
                                        onCopy={(o) => handleCopyOrder(o)}
                                        onUpdateStatus={(id, status) => {
                                            updateOrderStatus(id, status);
                                            if (status === 'Delivered') {
                                                const newPaymentStatus = order.paymentMethod === 'COD' ? 'Unpaid' : 'Unpaid';
                                                updateOrder(id, { paymentStatus: newPaymentStatus });
                                            } else if (status === 'ReStock') {
                                                updateOrder(id, { paymentStatus: 'Cancel' });
                                                restockOrder(id);
                                            } else if (status === 'Returned') {
                                                updateOrder(id, { paymentStatus: 'Cancel' });
                                            }
                                        }}
                                        onUpdatePaymentStatus={(id, status) => {
                                            const updates: any = { paymentStatus: status };
                                            if (status === 'Paid' || status === 'Settled') {
                                                updates.amountReceived = order.total;
                                                updates.settleDate = new Date().toISOString();
                                            } else if (status === 'Cancel') {
                                                updates.amountReceived = 0;
                                                updates.settleDate = null;
                                                // Auto-set Order Status to Returned ONLY if 'Shipped' or 'Delivered'
                                                const currentStatus = order.shipping?.status || 'Pending';
                                                if (order.shipping && (currentStatus === 'Shipped' || currentStatus === 'Delivered')) {
                                                    updates.shipping = { ...order.shipping, status: 'Returned' };
                                                }
                                            } else {
                                                updates.amountReceived = 0;
                                                updates.settleDate = null;
                                            }
                                            updateOrder(id, updates);
                                        }}
                                        canEdit={canEdit}
                                    />
                                ))}
                                {paginatedOrders.length === 0 && (
                                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No orders found.</div>
                                )}

                                {/* Mobile Summary Footer */}
                                <div style={{
                                    position: 'fixed',
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    background: 'white',
                                    borderTop: '1px solid var(--color-border)',
                                    padding: '16px',
                                    zIndex: 100,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    boxShadow: '0 -4px 6px -1px rgba(0, 0, 0, 0.1)'
                                }}>
                                    <div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Total Orders</div>
                                        <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{filteredOrders.length}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Total Amount</div>
                                        <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--color-primary)' }}>
                                            ${filteredOrders.reduce((sum, order) => sum + order.total, 0).toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <table
                                    className="spreadsheet-table"
                                    style={{
                                        minWidth: '100%',
                                        whiteSpace: 'nowrap',
                                        tableLayout: 'fixed',
                                        borderCollapse: 'separate',
                                        borderSpacing: 0,
                                        // Apply CSS Variables
                                        ['--table-font-size' as any]: `${tableSettings.fontSize}px`,
                                        ['--table-padding' as any]: `${tableSettings.padding}px 8px`, // Reduced side padding too
                                        ['--table-row-height' as any]: tableSettings.height === 'auto' ? 'auto' : tableSettings.height
                                    }}>
                                    <thead>
                                        <tr>
                                            <th style={{ width: '40px', padding: '10px 12px', position: 'sticky', left: 0, top: 0, zIndex: 40, background: '#F9FAFB' }} className="sticky-col-first">
                                                {isAdmin && (
                                                    <input
                                                        type="checkbox"
                                                        checked={filteredOrders.length > 0 && selectedIds.size === filteredOrders.length}
                                                        onChange={toggleSelectAll}
                                                        style={{ cursor: 'pointer' }}
                                                    />
                                                )}
                                            </th>
                                            {allColumns.filter(col => visibleColumns.includes(col.id)).map((col) => {
                                                const colId = col.id;
                                                const colDef = col;
                                                const width = columnWidths[colId];
                                                const isPinned = (pinnedOrderColumns || []).includes(colId);
                                                const stickyLeft = getStickyLeft(colId);

                                                return (
                                                    <th
                                                        key={colId}
                                                        style={{
                                                            width: `var(--col-${colId}-width, ${width ? `${width}px` : '150px'})`,
                                                            minWidth: `var(--col-${colId}-width, ${width ? `${width}px` : '150px'})`,
                                                            overflow: 'visible',
                                                            borderRight: resizingCol === colId ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                            transition: 'border-color 0.1s',
                                                            padding: 0,
                                                            position: 'sticky',
                                                            left: isPinned ? stickyLeft : undefined,
                                                            zIndex: isPinned ? 40 : 30,
                                                            background: '#F9FAFB',
                                                            boxShadow: isPinned ? '2px 0 5px rgba(0,0,0,0.05)' : 'none',
                                                            top: 0
                                                        }}
                                                    >
                                                        <div
                                                            onClick={() => handleSort(colId)}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'space-between',
                                                                height: '100%',
                                                                padding: 'var(--table-padding, 8px 12px)',
                                                                overflow: 'hidden',
                                                                width: '100%',
                                                                cursor: 'pointer',
                                                                userSelect: 'none'
                                                            }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{colDef?.label || colId}</span>
                                                                <SortIcon columnKey={colId} />
                                                            </div>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleOrderColumnPin(colId);
                                                                }}
                                                                style={{
                                                                    background: 'transparent',
                                                                    border: 'none',
                                                                    cursor: 'pointer',
                                                                    padding: '2px',
                                                                    marginLeft: '4px',
                                                                    opacity: isPinned ? 1 : 0.3,
                                                                    transition: 'opacity 0.2s',
                                                                    display: 'flex', alignItems: 'center'
                                                                }}
                                                                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                                                onMouseLeave={(e) => e.currentTarget.style.opacity = isPinned ? '1' : '0.3'}
                                                                title={isPinned ? "Unpin Column" : "Pin Column"}
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill={isPinned ? "var(--color-primary)" : "none"} stroke={isPinned ? "var(--color-primary)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <line x1="12" y1="17" x2="12" y2="22"></line>
                                                                    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
                                                                </svg>
                                                            </button>
                                                        </div>
                                                        <div
                                                            onMouseDown={(e) => startResize(e, colId)}
                                                            style={{
                                                                position: 'absolute',
                                                                right: 0,
                                                                top: 0,
                                                                bottom: 0,
                                                                width: '10px',
                                                                cursor: 'col-resize',
                                                                background: 'transparent',
                                                                zIndex: 25,
                                                                transform: 'translateX(50%)' // Center on the border line
                                                            }}
                                                            className="resize-handle"
                                                        />
                                                    </th>
                                                );
                                            })}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                            <SortableContext items={paginatedOrders.map(o => o.id)} strategy={verticalListSortingStrategy}>
                                                {paginatedOrders.map((order) => {

                                                    const isSelected = selectedIds.has(order.id);
                                                    const rowClass = getRowClass(order);

                                                    // Helper to get background color for sticky columns based on row class
                                                    // We use the helper defined outside


                                                    return (
                                                        <SortableRow key={order.id} id={order.id} className={rowClass} isRowMovable={isRowMovable}>
                                                            <td style={{ textAlign: 'center', position: 'sticky', left: 0, zIndex: 15 }} className="sticky-col-first">
                                                                {isAdmin && (
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={selectedIds.has(order.id)}
                                                                        onChange={(e) => toggleSelection(order.id, e.nativeEvent as unknown as React.MouseEvent)}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        style={{ cursor: 'pointer' }}
                                                                    />
                                                                )}
                                                            </td>
                                                            {allColumns.filter(col => visibleColumns.includes(col.id)).map(col => {
                                                                const colId = col.id;
                                                                const isPinned = (pinnedOrderColumns || []).includes(colId);
                                                                const stickyLeft = getStickyLeft(colId);

                                                                const cellStyle: React.CSSProperties = {
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis',
                                                                    maxWidth: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                                    width: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                                    position: isPinned ? 'sticky' : undefined,
                                                                    left: isPinned ? stickyLeft : undefined,
                                                                    zIndex: isPinned ? 15 : 1,
                                                                    // Sticky columns need explicit background to cover scrolled content
                                                                    backgroundColor: isPinned ? getRowBackgroundColor(order, isSelected) : undefined,
                                                                    boxShadow: isPinned ? '2px 0 5px rgba(0,0,0,0.05)' : 'none'
                                                                };

                                                                switch (colId) {
                                                                    case 'actions':
                                                                        return (
                                                                            <td key={colId} style={{ ...cellStyle, width: '100px', minWidth: '100px' }}>
                                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                                    <button onClick={(e) => { e.stopPropagation(); setReceiptSale(order); }} className="icon-button" title="Print Receipt" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                                                        <Printer size={16} color="var(--color-text-secondary)" />
                                                                                    </button>
                                                                                    <button onClick={(e) => { e.stopPropagation(); handleCopyOrder(order); }} className="icon-button" title="Copy Details" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                                                        <Copy size={16} color="var(--color-text-secondary)" />
                                                                                    </button>
                                                                                    <button onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); setIsViewModalOpen(true); }} className="icon-button" title="View Details" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                                                        <Eye size={16} color="var(--color-text-secondary)" />
                                                                                    </button>
                                                                                    {hasPermission('manage_orders') && (
                                                                                        <button onClick={(e) => { e.stopPropagation(); handleOpenEdit(order); }} className="icon-button" title="Edit Order" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                                                            <Edit size={16} color="var(--color-text-secondary)" />
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                        );
                                                                    case 'date': return <td key={colId} style={cellStyle}>{new Date(order.date).toLocaleDateString()}</td>;
                                                                    case 'customer': return <td key={colId} style={{ ...cellStyle, fontWeight: 500 }}>{order.customer?.name}</td>;
                                                                    case 'phone': {
                                                                        const operator = getOperatorForPhone(order.customer?.phone);
                                                                        return (
                                                                            <td key={colId} style={cellStyle}>
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                                    {operator && <img src={operator.logo} alt={operator.name} style={{ width: '16px', height: '16px', objectFit: 'contain', borderRadius: '2px' }} title={operator.name} />}
                                                                                    <span>{order.customer?.phone || '-'}</span>
                                                                                </div>
                                                                            </td>
                                                                        );
                                                                    }
                                                                    case 'address': return <td key={colId} style={cellStyle}>{order.customer?.address || '-'}</td>;
                                                                    case 'page': return <td key={colId} style={cellStyle}>{order.customer?.page || '-'}</td>;
                                                                    case 'items':
                                                                        return (
                                                                            <td key={colId} style={cellStyle}>
                                                                                <div style={{ fontSize: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                                    {order.items.map(i => `${i.name} x${i.quantity} `).join(', ')}
                                                                                </div>
                                                                            </td>
                                                                        );
                                                                    case 'total': return <td key={colId} style={{ ...cellStyle, fontWeight: 'bold', textAlign: 'right' }}>${order.total.toFixed(2)}</td>;
                                                                    case 'payBy': return <td key={colId} style={cellStyle}>{order.paymentMethod}</td>;
                                                                    case 'received': return <td key={colId} style={{
                                                                        ...cellStyle,
                                                                        textAlign: 'right',
                                                                        color: (order.paymentStatus === 'Paid' || order.paymentStatus === 'Settled') ? '#2563EB' : '#DC2626',
                                                                        fontWeight: 'bold'
                                                                    }}>${(order.amountReceived ?? order.total).toFixed(2)}</td>;
                                                                    case 'payStatus':
                                                                        return (
                                                                            <td key={colId} style={{
                                                                                width: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                                                minWidth: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                                                overflow: 'visible',
                                                                                textOverflow: 'ellipsis',
                                                                                textAlign: 'left'
                                                                            }}>
                                                                                <PaymentStatusBadge
                                                                                    status={order.paymentStatus || 'Paid'}
                                                                                    disabledOptions={[]}
                                                                                    onChange={(newStatus) => {
                                                                                        const updates: any = { paymentStatus: newStatus };
                                                                                        if (newStatus === 'Paid' || newStatus === 'Settled') {
                                                                                            updates.amountReceived = order.total;
                                                                                            updates.settleDate = new Date().toISOString();
                                                                                        } else if (newStatus === 'Cancel') {
                                                                                            updates.amountReceived = 0;
                                                                                            updates.settleDate = null;
                                                                                            // Auto-set Order Status to Returned ONLY if 'Shipped' or 'Delivered'
                                                                                            const currentStatus = order.shipping?.status || 'Pending';
                                                                                            if (order.shipping && (currentStatus === 'Shipped' || currentStatus === 'Delivered')) {
                                                                                                updates.shipping = { ...order.shipping, status: 'Returned' };
                                                                                            }
                                                                                        } else {
                                                                                            updates.amountReceived = 0;
                                                                                            updates.settleDate = null;
                                                                                        }
                                                                                        updateOrder(order.id, updates);
                                                                                    }}
                                                                                    readOnly={!canEdit || order.shipping?.status === 'ReStock' || order.paymentStatus === 'Cancel' || order.paymentStatus === 'Paid'}
                                                                                />
                                                                            </td>
                                                                        );
                                                                    case 'balance':
                                                                        return (
                                                                            <td key={colId} style={{ ...cellStyle, color: (order.total - (order.amountReceived || 0)) > 0 ? '#DC2626' : '#059669', fontWeight: 600, textAlign: 'right' }}>
                                                                                ${(order.total - (order.amountReceived || (order.paymentStatus === 'Paid' ? order.total : 0))).toFixed(2)}
                                                                            </td>
                                                                        );
                                                                    case 'status':
                                                                        return (
                                                                            <td key={colId} style={{
                                                                                width: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                                                minWidth: `var(--col-${colId}-width, ${columnWidths[colId] ? `${columnWidths[colId]}px` : '150px'})`,
                                                                                overflow: 'visible',
                                                                                textOverflow: 'ellipsis',
                                                                                textAlign: 'left'
                                                                            }}>
                                                                                <StatusBadge
                                                                                    status={order.shipping?.status || 'Pending'}
                                                                                    readOnly={!canEdit || order.shipping?.status === 'ReStock' || order.shipping?.status === 'Delivered' || order.paymentStatus === 'Cancel'}
                                                                                    disabledOptions={
                                                                                        (order.shipping?.status === 'Shipped')
                                                                                            ? ['Ordered', 'Pending']
                                                                                            : ['Delivered', 'Returned']
                                                                                    }
                                                                                    onChange={(newStatus: string) => {
                                                                                        if (newStatus === 'Shipped') {
                                                                                            setShippingOrderToUpdate(order);
                                                                                            setIsShippingModalOpen(true);
                                                                                            return;
                                                                                        }
                                                                                        if (newStatus === 'Pending') {
                                                                                            setPendingOrderToUpdate(order);
                                                                                            setIsPendingRemarkModalOpen(true);
                                                                                            return;
                                                                                        }
                                                                                        updateOrderStatus(order.id, newStatus as any);
                                                                                        if (newStatus === 'Delivered') {
                                                                                            const newPaymentStatus = order.paymentMethod === 'COD' ? 'Unpaid' : 'Unpaid';
                                                                                            updateOrder(order.id, { paymentStatus: newPaymentStatus });
                                                                                        } else if (newStatus === 'ReStock') {
                                                                                            updateOrder(order.id, { paymentStatus: 'Cancel' });
                                                                                            restockOrder(order.id);
                                                                                        } else if (newStatus === 'Returned') {
                                                                                            updateOrder(order.id, { paymentStatus: 'Cancel' });
                                                                                        }
                                                                                    }}
                                                                                />
                                                                            </td>
                                                                        );
                                                                    case 'tracking':
                                                                        return (
                                                                            <td key={colId} style={{ ...cellStyle, padding: '4px' }}>
                                                                                <input
                                                                                    key={`tracking-${order.shipping?.trackingNumber || ''}`}
                                                                                    type="text"
                                                                                    readOnly={!canEdit}
                                                                                    className="search-input"
                                                                                    defaultValue={order.shipping?.trackingNumber || ''}
                                                                                    placeholder="Add ID"
                                                                                    style={{
                                                                                        width: '100%',
                                                                                        padding: '4px 8px',
                                                                                        fontSize: 'inherit',
                                                                                        color: 'inherit',
                                                                                        fontFamily: 'monospace',
                                                                                        border: '1px solid transparent',
                                                                                        background: 'transparent'
                                                                                    }}
                                                                                    onFocus={(e) => {
                                                                                        e.target.style.background = 'white';
                                                                                        e.target.style.borderColor = 'var(--color-primary)';
                                                                                    }}
                                                                                    onBlur={(e) => {
                                                                                        e.target.style.background = 'transparent';
                                                                                        e.target.style.borderColor = 'transparent';
                                                                                        const val = e.target.value.trim();
                                                                                        const currentTracking = order.shipping?.trackingNumber || '';
                                                                                        if (val !== currentTracking) {
                                                                                            const updatedShipping = order.shipping
                                                                                                ? { ...order.shipping, trackingNumber: val }
                                                                                                : { company: '', trackingNumber: val, status: 'Pending' as const, cost: 0, staffName: '' };
                                                                                            updateOrder(order.id, { shipping: updatedShipping });
                                                                                        }
                                                                                    }}
                                                                                    onKeyDown={(e) => {
                                                                                        if (e.key === ' ') e.stopPropagation();
                                                                                        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                                                                                    }}
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                    onMouseDown={(e) => e.stopPropagation()}
                                                                                    onPointerDown={(e) => e.stopPropagation()}
                                                                                />
                                                                            </td>
                                                                        );
                                                                    case 'shippingCo': return <td key={colId} style={cellStyle}>{order.shipping?.company || '-'}</td>;
                                                                    case 'salesman': return <td key={colId} style={cellStyle}>{order.salesman || '-'}</td>;
                                                                    case 'customerCare': return <td key={colId} style={cellStyle}>{order.customerCare || '-'}</td>;
                                                                    case 'remark':
                                                                        return (
                                                                            <td key={colId} style={{ ...cellStyle, padding: '4px' }}>
                                                                                <input
                                                                                    key={`remark-${order.remark || ''}`}
                                                                                    type="text"
                                                                                    readOnly={!canEdit}
                                                                                    className="search-input"
                                                                                    defaultValue={order.remark || ''}
                                                                                    placeholder="Add Remark"
                                                                                    style={{
                                                                                        width: '100%',
                                                                                        padding: '4px 8px',
                                                                                        fontSize: 'inherit',
                                                                                        color: 'inherit',
                                                                                        fontFamily: 'Battambang',
                                                                                        border: '1px solid transparent',
                                                                                        background: 'transparent'
                                                                                    }}
                                                                                    onFocus={(e) => {
                                                                                        e.target.style.background = 'white';
                                                                                        e.target.style.borderColor = 'var(--color-primary)';
                                                                                    }}
                                                                                    onBlur={(e) => {
                                                                                        e.target.style.background = 'transparent';
                                                                                        e.target.style.borderColor = 'transparent';
                                                                                        const val = e.target.value.trim();
                                                                                        if (val !== (order.remark || '')) {
                                                                                            updateOrder(order.id, { remark: val });
                                                                                        }
                                                                                    }}
                                                                                    onKeyDown={(e) => {
                                                                                        if (e.key === ' ') e.stopPropagation();
                                                                                        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                                                                                    }}
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                    onMouseDown={(e) => e.stopPropagation()}
                                                                                    onPointerDown={(e) => e.stopPropagation()}
                                                                                />
                                                                            </td>
                                                                        );
                                                                    case 'lastEdit':
                                                                        return (
                                                                            <td key={colId} style={cellStyle}>
                                                                                <div style={{ display: 'flex', flexDirection: 'column', fontSize: '11px', lineHeight: '1.2' }}>
                                                                                    <span style={{ fontWeight: 500 }}>{order.lastEditedBy || '-'}</span>
                                                                                    {order.lastEditedAt && (
                                                                                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '10px' }}>
                                                                                            {new Date(order.lastEditedAt).toLocaleString()}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                        );
                                                                    case 'settleDate': return <td key={colId} style={cellStyle}>{order.settleDate ? new Date(order.settleDate).toLocaleDateString() : '-'}</td>;
                                                                    default: return <td key={colId} style={cellStyle}>-</td>;
                                                                }
                                                            })}
                                                        </SortableRow>
                                                    );
                                                })}
                                            </SortableContext>
                                        </DndContext>
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <td className="sticky-col-first" style={{ background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)', position: 'sticky', left: 0, zIndex: 20 }}></td>
                                            {visibleColumns.map((colId) => {
                                                const isPinned = (pinnedOrderColumns || []).includes(colId);
                                                const stickyLeft = getStickyLeft(colId);

                                                const commonStyle = {
                                                    padding: '8px 12px',
                                                    fontSize: '12px',
                                                    fontWeight: 'bold',
                                                    borderTop: '2px solid var(--color-border)',
                                                    background: 'var(--color-bg)',
                                                    textAlign: 'left' as const,
                                                    position: isPinned ? 'sticky' as const : undefined,
                                                    left: isPinned ? stickyLeft : undefined,
                                                    zIndex: isPinned ? 20 : 1,
                                                    boxShadow: isPinned ? '2px 0 5px rgba(0,0,0,0.05)' : 'none'
                                                };

                                                if (colId === 'actions') {
                                                    return <td key={colId} style={{ ...commonStyle, minWidth: '100px' }}>Total: {stats.totalOrders}</td>;
                                                }
                                                if (colId === 'total') return <td key={colId} style={{ ...commonStyle, textAlign: 'right' }}>${stats.totalRevenue.toFixed(2)}</td>;
                                                if (colId === 'received') return <td key={colId} style={{ ...commonStyle, textAlign: 'right', color: '#2563EB' }}>${stats.totalReceived.toFixed(2)}</td>;
                                                if (colId === 'balance') return <td key={colId} style={{ ...commonStyle, textAlign: 'right', color: 'var(--color-red)' }}>${stats.totalOutstanding.toFixed(2)}</td>;

                                                return <td key={colId} style={commonStyle}></td>;
                                            })}
                                        </tr>
                                    </tfoot>
                                </table>
                                {filteredOrders.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No orders found.</div>}
                            </>
                        )}
                    </div>

                    {/* Bulk Actions Bar */}
                    {
                        selectedIds.size > 0 && canManage && (
                            <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'var(--color-surface)', padding: '16px 24px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '16px', zIndex: 100, border: '1px solid var(--color-border)' }}>
                                <span style={{ fontWeight: 600 }}>{selectedIds.size} selected</span>
                                <div style={{ height: '24px', width: '1px', background: 'var(--color-border)' }} />
                                <button onClick={handleBulkDelete} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                                    <Trash2 size={18} /> Delete
                                </button>
                            </div>
                        )
                    }
                </>
            ) : (
                <POSInterface
                    orderToEdit={editingOrder}
                    onCancelEdit={() => {
                        setEditingOrder(null);
                        setActiveTab('list');
                    }}
                />
            )
            }

            {
                activeTab === 'list' && filteredOrders.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', padding: '0', position: 'relative' }}>
                        <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                            Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filteredOrders.length)} to {Math.min(currentPage * itemsPerPage, filteredOrders.length)} of {filteredOrders.length} entries
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
                                    <option value={5000}>5000</option>
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
                                {hasMoreOrders && (
                                    <button
                                        onClick={loadMoreOrders}
                                        disabled={isLoadingMore}
                                        style={{
                                            padding: '6px 16px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--color-border)',
                                            background: 'var(--color-primary)',
                                            color: 'white',
                                            cursor: isLoadingMore ? 'not-allowed' : 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '13px',
                                            fontWeight: 500,
                                            marginLeft: '12px',
                                            opacity: isLoadingMore ? 0.7 : 1
                                        }}
                                    >
                                        {isLoadingMore ? 'Loading...' : 'Load Older Records'}
                                    </button>
                                )}
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
                                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Order Details</h2>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                        onClick={() => {
                                            const textToCopy = generateOrderCopyText(selectedOrder, sales);
                                            navigator.clipboard.writeText(textToCopy);
                                            showToast('Order info copied!', 'success');
                                        }}
                                        style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', padding: '6px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
                                        title="Copy Order Info"
                                    >
                                        <Copy size={16} /> Copy
                                    </button>
                                    <button
                                        onClick={() => window.open(`/orders/${selectedOrder.id}`, '_blank')}
                                        style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', padding: '6px', color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
                                        title="Open Details Page"
                                    >
                                        <ExternalLink size={16} /> Open
                                    </button>
                                    <button onClick={() => setIsViewModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={24} /></button>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '12px' }}>
                                <div>
                                    <h4 style={{ color: 'var(--color-text-secondary)', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer</h4>
                                    <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '4px' }}>{selectedOrder.customer?.name}</div>
                                    <div style={{ fontSize: '14px', color: 'var(--color-text-main)' }}>{selectedOrder.customer?.phone}</div>
                                    <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>{selectedOrder.customer?.address}</div>
                                </div>
                                <div>
                                    <h4 style={{ color: 'var(--color-text-secondary)', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Order Info</h4>
                                    <div style={{ fontSize: '14px', marginBottom: '4px' }}>Date: {new Date(selectedOrder.date).toLocaleString()}</div>
                                    <div style={{ fontSize: '14px', marginBottom: '4px' }}>Status: {getStatusBadge(selectedOrder.shipping?.status || 'Pending')}</div>
                                    <div style={{ fontSize: '14px', marginBottom: '4px' }}>Platform: {selectedOrder.customer?.platform} ({selectedOrder.customer?.page})</div>
                                    <div style={{ fontSize: '14px', marginTop: '8px', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <ExternalLink size={14} style={{ color: 'var(--color-primary)' }} />
                                        <a href={`/orders/${selectedOrder.id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
                                            Open Order Page
                                        </a>
                                    </div>
                                </div>
                            </div>

                            <div style={{ background: 'rgba(0,0,0,0.03)', borderRadius: '12px', padding: '20px', marginBottom: '12px' }}>
                                <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Items</h4>
                                {selectedOrder.items.map((item, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                                        <span>{item.name} <span style={{ color: 'var(--color-text-secondary)' }}>x{item.quantity}</span></span>
                                        <span>${(item.price * item.quantity).toFixed(2)}</span>
                                    </div>
                                ))}
                                <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '12px', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '16px' }}>
                                    <span>Total</span>
                                    <span>${selectedOrder.total.toFixed(2)}</span>
                                </div>
                            </div>

                            <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', display: 'grid', gap: '8px' }}>
                                <div><strong>Shipping:</strong> {selectedOrder.shipping?.company} (${selectedOrder.shipping?.cost}) - {selectedOrder.shipping?.trackingNumber || 'No ID'}</div>
                                <div><strong>Salesman:</strong> {selectedOrder.salesman}</div>
                                <div><strong>Remark:</strong> {selectedOrder.remark || '-'}</div>
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

            {/* Shipping Company Selection Modal */}
            <ShippingModalComponent
                isOpen={isShippingModalOpen}
                onClose={() => { setIsShippingModalOpen(false); setShippingOrderToUpdate(null); }}
                order={shippingOrderToUpdate}
            />
            {/* Pending Remark Modal */}
            <PendingRemarkModalComponent
                isOpen={isPendingRemarkModalOpen}
                onClose={() => { setIsPendingRemarkModalOpen(false); setPendingOrderToUpdate(null); }}
                order={pendingOrderToUpdate}
            />
            <DataImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                type="order"
                onImport={handleImportOrders}
            />
            <BulkEditModal
                isOpen={isBulkEditOpen}
                onClose={() => setIsBulkEditOpen(false)}
                onApply={handleBulkEdit}
                count={selectedIds.size}
            />
        </div >
    );
};

export default Orders;
