
import React, { useState, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, Package, AlertTriangle, DollarSign, Layers, ArrowUp, ArrowDown, ChevronsUpDown, X, ChevronLeft, ChevronRight, Boxes } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import StatsCard from '../components/StatsCard';
import MobileInventoryCard from '../components/MobileInventoryCard';
import type { Product, Sale } from '../types';
import { supabase } from '../lib/supabase';
import { processImageForUpload } from '../utils/imageUtils';
import LazyAvatar from '../components/LazyAvatar';

type SortConfig = {
    key: keyof Product | 'totalValue';
    direction: 'asc' | 'desc';
} | null;

const Inventory: React.FC = () => {
    const { products, addProduct, updateProduct, deleteProduct, deleteProducts, categories, restockOrder, updateOrder, currentUser, salesUpdatedAt } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();

    // Permission Logic
    const restrictedRoles = ['store_manager', 'salesman', 'customer_care'];
    const canViewFinancials = !restrictedRoles.includes(currentUser?.roleId || '');
    const canManageInventory = !restrictedRoles.includes(currentUser?.roleId || '');

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Inventory Management</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage stock and products</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    // State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [isUploadingImage, setIsUploadingImage] = useState(false);

    // Add Stock State
    const [addStockProduct, setAddStockProduct] = useState<Product | null>(null);
    const [addStockAmount, setAddStockAmount] = useState<number | string>('');

    // Historical Orders State
    const [returnedOrders, setReturnedOrders] = useState<Sale[]>([]);
    const [restockedHistory, setRestockedHistory] = useState<Sale[]>([]);

    React.useEffect(() => {
        const fetchHistoricalOrders = async () => {
            try {
                // Fetch Returned Orders
                const { data: retData, error: retErr } = await supabase
                    .from('sales')
                    .select('*, items:sale_items(*)')
                    .eq('shipping_status', 'Returned')
                    .order('date', { ascending: false });

                if (retErr) throw retErr;

                // Fetch Restocked History
                const { data: resData, error: resErr } = await supabase
                    .from('sales')
                    .select('*, items:sale_items(*)')
                    .eq('shipping_status', 'ReStock')
                    .order('date', { ascending: false });

                if (resErr) throw resErr;

                // Map Supabase snake_case back to frontend camelCase expectations for minimal UI disruption
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

        fetchHistoricalOrders();
    }, [salesUpdatedAt]);

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredAndSortedProducts.length && filteredAndSortedProducts.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredAndSortedProducts.map(p => p.id)));
        }
    };

    const handleBulkDelete = () => {
        if (confirm(`Are you sure you want to delete ${selectedIds.size} products ? `)) {
            deleteProducts(Array.from(selectedIds));
            setSelectedIds(new Set());
            showToast('Products deleted successfully', 'success');
        }
    };

    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('All');
    const [sortConfig, setSortConfig] = useState<SortConfig>(null);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);

    // Form State
    type ProductFormState = Omit<Product, 'id' | 'price' | 'stock' | 'lowStockThreshold'> & {
        price: number | string;
        stock: number | string;
        lowStockThreshold: number | string;
    };

    const initialFormState: ProductFormState = {
        name: '',
        model: '',
        price: 0,
        stock: 0,
        lowStockThreshold: 5,
        category: categories[0] || 'Portable',
        image: 'https://via.placeholder.com/300'
    };
    const [formData, setFormData] = useState<ProductFormState>(initialFormState);

    const allCategories = ['All', ...categories];

    // Mobile Expansion State
    const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());

    const toggleProductExpansion = (id: string) => {
        const newExpanded = new Set(expandedProductIds);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedProductIds(newExpanded);
    };

    // Derived State
    const filteredAndSortedProducts = useMemo(() => {
        let result = products.filter(product => {
            const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                product.model.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = categoryFilter === 'All' || product.category === categoryFilter;
            return matchesSearch && matchesCategory;
        });

        if (sortConfig) {
            result.sort((a, b) => {
                let aValue: any = a[sortConfig.key as keyof Product];
                let bValue: any = b[sortConfig.key as keyof Product];

                // Handle 'totalValue' sort key
                if (sortConfig.key === 'totalValue') {
                    aValue = a.price * a.stock;
                    bValue = b.price * b.stock;
                }

                if (aValue < bValue) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }

        return result;
    }, [products, searchTerm, categoryFilter, sortConfig]);

    // Calculate Totals
    const stats = useMemo(() => {
        const totalProducts = products.length;
        const lowStock = products.filter(p => p.stock < (p.lowStockThreshold || 5)).length;
        const totalValue = products.reduce((sum, p) => sum + (p.price * p.stock), 0);
        const categoryCount = categories.length;
        const totalAllStock = products.reduce((sum, p) => sum + p.stock, 0);

        return {
            totalProducts,
            lowStock,
            totalValue,
            categoryCount,
            totalAllStock
        };
    }, [products, categories]);

    // Handlers
    const handleSort = (key: keyof Product | 'totalValue') => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const openAddModal = () => {
        setEditingProduct(null);
        setFormData(initialFormState);
        setIsModalOpen(true);
    };

    const openEditModal = (product: Product) => {
        setEditingProduct(product);
        setFormData({
            ...product,
            lowStockThreshold: product.lowStockThreshold ?? 5
        });
        setIsModalOpen(true);
    };

    const handleSave = () => {
        if (!formData.name || !formData.price) {
            showToast('Please fill in required fields', 'error');
            return;
        }

        const productData = {
            ...formData,
            price: Number(formData.price),
            stock: Number(formData.stock),
            lowStockThreshold: Number(formData.lowStockThreshold)
        };

        if (editingProduct) {
            updateProduct(editingProduct.id, productData);
            showToast('Product updated successfully', 'success');
        } else {
            addProduct(productData as Omit<Product, 'id'>);
            showToast('Product added successfully', 'success');
        }
        setIsModalOpen(false);
    };

    const promptDelete = (id: string) => {
        setDeleteId(id);
    };

    const confirmDelete = () => {
        if (deleteId) {
            deleteProduct(deleteId);
            showToast('Product deleted', 'info');
            setDeleteId(null);
        }
    };

    // Render Helpers
    const SortIcon = ({ columnKey }: { columnKey: keyof Product | 'totalValue' }) => {
        if (sortConfig?.key !== columnKey) return <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />;
        return sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    };

    const renderHeader = (label: string, key: keyof Product | 'totalValue', width?: string) => (
        <th
            onClick={() => handleSort(key)}
            style={{ width, cursor: 'pointer' }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {label}
                <SortIcon columnKey={key} />
            </div>
        </th>
    );

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                    {canManageInventory && (
                        <button
                            onClick={openAddModal}
                            className="primary-button"
                            style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                            <Plus size={20} />
                            Add Product
                        </button>
                    )}
                </div>
            </div>

            {/* Stats Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '12px' }}>
                <StatsCard title="Total Products" value={stats.totalProducts} icon={Package} color="var(--color-primary)" />
                <StatsCard title="Products in Stock" value={stats.totalAllStock} icon={Boxes} color="#3B82F6" />
                <StatsCard title="Low Stock" value={stats.lowStock} icon={AlertTriangle} color="var(--color-red)" />
                {canViewFinancials && (
                    <StatsCard title="Total Value" value={`$${stats.totalValue.toLocaleString()} `} icon={DollarSign} color="var(--color-green)" />
                )}
                <StatsCard title="Categories" value={stats.categoryCount} icon={Layers} color="var(--color-purple)" />
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                    <Search size={20} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                    <input
                        type="text"
                        placeholder="Search products..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="search-input"
                        style={{ width: '100%', paddingLeft: '40px' }}
                    />
                </div>
                <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="search-input"
                    style={{ width: '180px' }}
                >
                    {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            {/* Content: List or Table */}
            {isMobile ? (
                <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 280px)', paddingBottom: '80px' }}>
                    {filteredAndSortedProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((product) => (
                        <MobileInventoryCard
                            key={product.id}
                            product={product}
                            isSelected={selectedIds.has(product.id)}
                            onToggleSelect={() => toggleSelection(product.id)}
                            isExpanded={expandedProductIds.has(product.id)}
                            onToggleExpand={() => toggleProductExpansion(product.id)}
                            onEdit={openEditModal}
                            onDelete={promptDelete}
                        // Pass permissions to Mobile Card if needed, or handle inside component
                        // For now assuming mobile card might show price/actions, need to check MobileInventoryCard later if requested
                        />
                    ))}
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', height: 'calc(100vh - 200px)' }}>
                    {/* Main Stock Table */}
                    <div className="glass-panel" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <h3 style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)', position: 'sticky', top: 0, background: 'var(--color-surface)', zIndex: 10 }}>
                            All Stock ({filteredAndSortedProducts.length})
                        </h3>
                        <table className="spreadsheet-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '40px', textAlign: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={filteredAndSortedProducts.length > 0 && selectedIds.size === filteredAndSortedProducts.length}
                                            onChange={toggleSelectAll}
                                            style={{ cursor: 'pointer' }}
                                        />
                                    </th>
                                    {renderHeader('Product', 'name')}
                                    {renderHeader('Category', 'category')}
                                    {renderHeader('Price', 'price')}
                                    {renderHeader('Stock', 'stock')}
                                    {canViewFinancials && renderHeader('Total Value', 'totalValue')}
                                    {canManageInventory && <th style={{ textAlign: 'right' }}>Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredAndSortedProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((product) => (
                                    <tr
                                        key={product.id}
                                        className={selectedIds.has(product.id) ? 'selected' : ''}
                                    >
                                        <td style={{ textAlign: 'center' }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(product.id)}
                                                onChange={() => toggleSelection(product.id)}
                                                style={{ cursor: 'pointer' }}
                                            />
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <LazyAvatar productId={product.id} initialImage={product.image} alt="" style={{ width: '32px', height: '32px', borderRadius: '4px', backgroundColor: 'white', padding: '2px', border: '1px solid var(--color-border)', flexShrink: 0 }} />
                                                <div>
                                                    <div style={{ fontWeight: 600 }}>{product.name}</div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{product.model}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span style={{ padding: '2px 8px', borderRadius: '12px', backgroundColor: 'var(--color-bg)', fontSize: '11px', border: '1px solid var(--color-border)' }}>
                                                {product.category}
                                            </span>
                                        </td>
                                        <td style={{ fontWeight: 600 }}>${product.price}</td>
                                        <td>
                                            {product.stock < (product.lowStockThreshold || 5) ? (
                                                <span style={{ color: '#EF4444', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500 }}>
                                                    <AlertTriangle size={14} /> {product.stock}
                                                </span>
                                            ) : (
                                                <span style={{ color: '#10B981', fontWeight: 500 }}>{product.stock}</span>
                                            )}
                                        </td>
                                        {canViewFinancials && (
                                            <td style={{ color: 'var(--color-text-secondary)' }}>
                                                ${(product.price * product.stock).toLocaleString()}
                                            </td>
                                        )}
                                        {canManageInventory && (
                                            <td style={{ textAlign: 'right' }}>
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                    <button
                                                        onClick={() => {
                                                            setAddStockProduct(product);
                                                            setAddStockAmount('');
                                                        }}
                                                        style={{ padding: '6px', borderRadius: '6px', backgroundColor: 'transparent', color: '#10B981', border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                                                        className="hover-primary"
                                                        title="Add Stock"
                                                    >
                                                        <Plus size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => openEditModal(product)}
                                                        style={{ padding: '6px', borderRadius: '6px', backgroundColor: 'transparent', color: 'var(--color-text-secondary)', border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                                                        className="hover-primary"
                                                        title="Edit"
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => promptDelete(product.id)}
                                                        style={{ padding: '6px', borderRadius: '6px', backgroundColor: 'transparent', color: '#EF4444', border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                                                        className="hover-danger"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ background: 'var(--color-surface)', fontWeight: 'bold' }}>
                                    <td colSpan={3} style={{ textAlign: 'right', padding: '12px 16px' }}>Totals:</td>
                                    <td style={{ padding: '12px 16px' }}>—</td>
                                    <td style={{ padding: '12px 16px', color: '#10B981' }}>
                                        {filteredAndSortedProducts.reduce((sum, p) => sum + p.stock, 0)}
                                    </td>
                                    {canViewFinancials && (
                                        <td style={{ padding: '12px 16px' }}>
                                            ${filteredAndSortedProducts.reduce((sum, p) => sum + (p.price * p.stock), 0).toLocaleString()}
                                        </td>
                                    )}
                                    {canManageInventory && <td></td>}
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Right Column: Returned & Restocked */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflow: 'hidden' }}>
                        {/* ReStock Table (Returned Orders) */}
                        <div className="glass-panel" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', border: '1px solid #FCA5A5', flex: 1 }}>
                            <h3 style={{ padding: '12px 16px', borderBottom: '1px solid #FCA5A5', margin: 0, fontSize: '14px', fontWeight: 600, color: '#DC2626', background: '#FEF2F2', display: 'flex', alignItems: 'center', gap: '8px', position: 'sticky', top: 0, zIndex: 10 }}>
                                <AlertTriangle size={16} /> Returned Orders
                            </h3>
                            {returnedOrders.length === 0 ? (
                                <div style={{ padding: '32px', textAlign: 'center', color: '#059669', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Boxes size={20} />
                                    </div>
                                    <p style={{ fontSize: '13px', fontWeight: 500 }}>No returned orders pending restock.</p>
                                </div>
                            ) : (
                                <table className="spreadsheet-table">
                                    <thead style={{ background: '#FEF2F2' }}>
                                        <tr>
                                            <th>Order / Customer</th>
                                            <th>Items</th>
                                            <th style={{ textAlign: 'right', width: '50px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {returnedOrders.map(order => (
                                            <tr key={order.id} style={{ background: '#FEF2F2' }}>
                                                <td style={{ whiteSpace: 'normal' }}>
                                                    <div style={{ fontWeight: 600, fontSize: '13px' }}>#{order.id.slice(0, 8)}</div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{order.customer?.name || 'Unknown'}</div>
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
                                                <td style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                                                    <button
                                                        onClick={async () => {
                                                            if (confirm('Restock items from this order?')) {
                                                                // 1. Update status to ReStock (Optimistic Remove from List)
                                                                updateOrder(order.id, {
                                                                    paymentStatus: 'Cancel',
                                                                    shipping: { ...order.shipping, status: 'ReStock' } as any
                                                                });

                                                                // 2. Restock Items (Updates Stock)
                                                                await restockOrder(order.id);

                                                                showToast('Items restocked & order updated', 'success');
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
                                            <th>Order / Customer</th>
                                            <th>Items Restocked</th>
                                            <th style={{ textAlign: 'right' }}>Date</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {restockedHistory.map(order => (
                                            <tr key={order.id} style={{ background: '#EFF6FF' }}>
                                                <td style={{ whiteSpace: 'normal' }}>
                                                    <div style={{ fontWeight: 600, fontSize: '13px' }}>#{order.id.slice(0, 8)}</div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{order.customer?.name || 'Unknown'}</div>
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
                                                <td style={{ textAlign: 'right', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                    {new Date(order.date).toLocaleDateString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Mobile Summary Footer */}
            {isMobile && (
                <div style={{
                    position: 'fixed',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    backgroundColor: 'white',
                    borderTop: '1px solid var(--color-border)',
                    padding: '12px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    zIndex: 90,
                    boxShadow: '0 -2px 10px rgba(0,0,0,0.05)'
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Total Stock</span>
                        <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--color-text-main)' }}>
                            {filteredAndSortedProducts.reduce((sum, p) => sum + p.stock, 0).toLocaleString()}
                        </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Total Value</span>
                        <span style={{ fontWeight: 600, fontSize: '15px', color: '#10B981' }}>
                            ${filteredAndSortedProducts.reduce((sum, p) => sum + (p.price * p.stock), 0).toLocaleString()}
                        </span>
                    </div>
                </div>
            )}

            {/* Pagination */}
            {filteredAndSortedProducts.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 4px' }}>
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                        Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filteredAndSortedProducts.length)} to {Math.min(currentPage * itemsPerPage, filteredAndSortedProducts.length)} of {filteredAndSortedProducts.length} products
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            <span>Rows per page:</span>
                            <select
                                value={itemsPerPage}
                                onChange={(e) => {
                                    setItemsPerPage(Number(e.target.value));
                                    setCurrentPage(1);
                                }}
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
                                <option value={10}>10</option>
                                <option value={20}>20</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
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
                                Page <span style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>{currentPage}</span> of {Math.ceil(filteredAndSortedProducts.length / itemsPerPage)}
                            </span>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredAndSortedProducts.length / itemsPerPage), p + 1))}
                                disabled={currentPage === Math.ceil(filteredAndSortedProducts.length / itemsPerPage)}
                                style={{
                                    padding: '6px', borderRadius: '6px', border: '1px solid var(--color-border)',
                                    background: currentPage === Math.ceil(filteredAndSortedProducts.length / itemsPerPage) ? 'var(--color-bg)' : 'var(--color-surface)',
                                    color: currentPage === Math.ceil(filteredAndSortedProducts.length / itemsPerPage) ? 'var(--color-text-muted)' : 'var(--color-text-main)',
                                    cursor: currentPage === Math.ceil(filteredAndSortedProducts.length / itemsPerPage) ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            )}


            {/* Bulk Actions Bar */}
            {
                selectedIds.size > 0 && (
                    <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'var(--color-surface)', padding: '16px 24px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '16px', zIndex: 100, border: '1px solid var(--color-border)' }}>
                        <span style={{ fontWeight: 600 }}>{selectedIds.size} selected</span>
                        <div style={{ height: '24px', width: '1px', background: 'var(--color-border)' }} />
                        <button onClick={handleBulkDelete} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#FEE2E2', color: '#EF4444', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                            <Trash2 size={18} /> Delete
                        </button>
                    </div>
                )
            }

            {/* Add/Edit Modal */}
            {
                isModalOpen && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                    }}>
                        <div className="glass-panel" style={{ width: '500px', padding: '32px', animation: 'slideIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>{editingProduct ? 'Edit Product' : 'Add New Product'}</h3>
                                <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={24} /></button>
                            </div>
                            <div style={{ display: 'grid', gap: '16px', marginBottom: '12px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Product Name</label>
                                    <input className="search-input" style={{ width: '100%' }} placeholder="e.g. JBL Flip 6" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Model</label>
                                        <input className="search-input" style={{ width: '100%' }} placeholder="JBL-F6" value={formData.model} onChange={e => setFormData({ ...formData, model: e.target.value })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Category</label>
                                        <select className="search-input" style={{ width: '100%' }} value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value as any })}>
                                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Price ($)</label>
                                        <input className="search-input" type="number" style={{ width: '100%' }} placeholder="0.00" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value === '' ? '' : Number(e.target.value) })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Stock</label>
                                        <input className="search-input" type="number" style={{ width: '100%' }} placeholder="0" value={formData.stock} onChange={e => setFormData({ ...formData, stock: e.target.value === '' ? '' : Number(e.target.value) })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Low Stock Alert</label>
                                        <input
                                            className="search-input"
                                            type="number"
                                            style={{ width: '100%' }}
                                            placeholder="5"
                                            value={formData.lowStockThreshold}
                                            onChange={e => setFormData({ ...formData, lowStockThreshold: e.target.value === '' ? '' : Number(e.target.value) })}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Product Image</label>
                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                                        {formData.image && (
                                            <div style={{ width: '80px', height: '80px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-border)', flexShrink: 0, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <img src={formData.image} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                            </div>
                                        )}
                                        <div style={{ flex: 1 }}>
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={async (e) => {
                                                    const file = e.target.files?.[0];
                                                    if (!file) return;

                                                    try {
                                                        setIsUploadingImage(true);

                                                        // 1. Process image (crop & resize)
                                                        const processedBlob = await processImageForUpload(file);

                                                        // 2. Generate unique filename
                                                        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;

                                                        // 3. Upload to Supabase Storage
                                                        const { error } = await supabase.storage
                                                            .from('products')
                                                            .upload(fileName, processedBlob, {
                                                                contentType: 'image/jpeg',
                                                                upsert: false
                                                            });

                                                        if (error) {
                                                            // Handle missing bucket gracefully by falling back if needed, but normally throw
                                                            throw error;
                                                        }

                                                        // 4. Retrieve Public URL and save to form
                                                        const { data: publicData } = supabase.storage
                                                            .from('products')
                                                            .getPublicUrl(fileName);

                                                        if (publicData?.publicUrl) {
                                                            setFormData(prev => ({ ...prev, image: publicData.publicUrl }));
                                                            showToast('Image processed and uploaded', 'success');
                                                        }

                                                    } catch (err: any) {
                                                        console.error('Image upload failed:', err);
                                                        showToast('Upload failed: ' + err.message, 'error');
                                                    } finally {
                                                        setIsUploadingImage(false);
                                                        e.target.value = ''; // Reset input so same file can be selected again
                                                    }
                                                }}
                                                className="search-input"
                                                style={{ width: '100%', padding: '8px', opacity: isUploadingImage ? 0.5 : 1 }}
                                                disabled={isUploadingImage}
                                            />
                                            {isUploadingImage ? (
                                                <p style={{ fontSize: '12px', color: 'var(--color-primary)', marginTop: '6px', fontWeight: 600 }}>
                                                    Processing and uploading image...
                                                </p>
                                            ) : (
                                                <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '6px' }}>
                                                    Select an image file (Auto crops to 1:1, Auto resizes, & compressed).
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button onClick={() => setIsModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px', backgroundColor: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={handleSave} className="primary-button" style={{ padding: '10px 24px' }}>{editingProduct ? 'Save Changes' : 'Add Product'}</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Delete Confirmation Modal */}
            {
                deleteId && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                    }}>
                        <div className="glass-panel" style={{ width: '400px', padding: '32px', textAlign: 'center' }}>
                            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                                <AlertTriangle size={32} />
                            </div>
                            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>Delete Product?</h3>
                            <p style={{ color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
                                Are you sure you want to delete this product? This action cannot be undone.
                            </p>
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                                <button onClick={() => setDeleteId(null)} style={{ padding: '10px 20px', borderRadius: '8px', backgroundColor: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={confirmDelete} style={{ padding: '10px 24px', borderRadius: '8px', backgroundColor: '#EF4444', color: 'white', border: 'none', cursor: 'pointer' }}>Delete</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Add Stock Modal */}
            {
                addStockProduct && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                    }}>
                        <div className="glass-panel" style={{ width: '400px', padding: '32px', animation: 'slideIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                <div>
                                    <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Add Stock</h3>
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', marginTop: '4px' }}>
                                        {addStockProduct.name} - Current Stock: <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{addStockProduct.stock}</span>
                                    </p>
                                </div>
                                <button onClick={() => setAddStockProduct(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', height: 'fit-content' }}><X size={24} /></button>
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-main)', fontWeight: 500 }}>Quantity to Add</label>
                                <input
                                    className="search-input"
                                    type="number"
                                    style={{ width: '100%', fontSize: '16px', padding: '12px' }}
                                    placeholder="e.g. 50"
                                    autoFocus
                                    value={addStockAmount}
                                    onChange={e => setAddStockAmount(e.target.value === '' ? '' : Number(e.target.value))}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && addStockAmount !== '' && Number(addStockAmount) > 0) {
                                            updateProduct(addStockProduct.id, { stock: addStockProduct.stock + Number(addStockAmount) });
                                            showToast(`Added ${addStockAmount} stock to ${addStockProduct.name}`, 'success');
                                            setAddStockProduct(null);
                                        }
                                    }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button onClick={() => setAddStockProduct(null)} style={{ padding: '10px 20px', borderRadius: '8px', backgroundColor: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Cancel</button>
                                <button
                                    onClick={() => {
                                        if (addStockAmount === '' || Number(addStockAmount) <= 0) {
                                            showToast('Please enter a valid stock amount', 'error');
                                            return;
                                        }
                                        updateProduct(addStockProduct.id, { stock: addStockProduct.stock + Number(addStockAmount) });
                                        showToast(`Added ${addStockAmount} stock to ${addStockProduct.name}`, 'success');
                                        setAddStockProduct(null);
                                    }}
                                    className="primary-button"
                                    style={{ padding: '10px 24px' }}
                                    disabled={addStockAmount === '' || Number(addStockAmount) <= 0}
                                >
                                    Confirm Addition
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

        </div >
    );
};
export default Inventory;
