
import React, { useState, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, Package, AlertTriangle, DollarSign, Layers, ArrowUp, ArrowDown, ChevronsUpDown, X, Boxes } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import StatsCard from '../components/StatsCard';
import MobileInventoryCard from '../components/MobileInventoryCard';
import type { Product } from '../types';

type SortConfig = {
    key: keyof Product | 'totalValue' | 'createdAt' | 'soldPaid';
    direction: 'asc' | 'desc';
} | null;

const Inventory: React.FC = () => {
    const { products, addProduct, updateProduct, deleteProduct, deleteProducts, categories, sales, restockOrder, updateOrder, deleteOrders, currentUser, addStock, restocks } = useStore();
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
    const [isRestockModalOpen, setIsRestockModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);

    // Restock Form State
    const [restockData, setRestockData] = useState({
        productId: '',
        quantity: 0,
        cost: 0,
        note: ''
    });

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
    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'soldPaid', direction: 'desc' });

    // Daily Stock Summary State
    const [dailyStockDate, setDailyStockDate] = useState<string>(new Date().toISOString().split('T')[0]);



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
    const soldPaidMap = useMemo(() => {
        const map = new Map<string, number>();
        sales.forEach(sale => {
            if (sale.paymentStatus === 'Paid' || sale.paymentStatus === 'Settled' || sale.paymentStatus === 'Paid/Settled' as any) {
                sale.items.forEach(item => {
                    map.set(item.id, (map.get(item.id) || 0) + item.quantity);
                });
            }
        });
        return map;
    }, [sales]);

    const filteredAndSortedProducts = useMemo(() => {
        let mappedProducts = products.map(p => ({
            ...p,
            soldPaid: soldPaidMap.get(p.id) || 0
        }));

        let result = mappedProducts.filter(product => {
            const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                product.model.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = categoryFilter === 'All' || product.category === categoryFilter;
            return matchesSearch && matchesCategory;
        });

        if (sortConfig) {
            result.sort((a, b) => {
                let aValue: any = a[sortConfig.key as keyof typeof a];
                let bValue: any = b[sortConfig.key as keyof typeof b];

                // Handle 'totalValue' sort key
                if (sortConfig.key === 'totalValue') {
                    aValue = a.price * a.stock;
                    bValue = b.price * b.stock;
                }

                // Handle 'createdAt' sort key
                if (sortConfig.key === 'createdAt') {
                    aValue = new Date(a.createdAt || 0).getTime();
                    bValue = new Date(b.createdAt || 0).getTime();
                }

                if (sortConfig.key === 'soldPaid') {
                    aValue = a.soldPaid;
                    bValue = b.soldPaid;
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
    }, [products, searchTerm, categoryFilter, sortConfig, soldPaidMap]);

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

    // Daily Stock Calculations
    const dailyStockData = useMemo(() => {
        const selectedStartOfDay = new Date(dailyStockDate);
        selectedStartOfDay.setHours(0, 0, 0, 0);
        const selectedEndOfDay = new Date(dailyStockDate);
        selectedEndOfDay.setHours(23, 59, 59, 999);

        const map = new Map<string, {
            soldToday: number;
            returnedToday: number;
            soldSince: number;
            returnedSince: number;
            boughtToday: number;
            boughtSince: number;
        }>();

        products.forEach(p => map.set(p.id, { soldToday: 0, returnedToday: 0, soldSince: 0, returnedSince: 0, boughtToday: 0, boughtSince: 0 }));

        sales.forEach(sale => {
            const saleDate = new Date(sale.date);
            const isToday = saleDate >= selectedStartOfDay && saleDate <= selectedEndOfDay;
            const isAfterToday = saleDate > selectedEndOfDay;

            const isSold = sale.paymentStatus === 'Paid' || sale.paymentStatus === 'Settled' || sale.paymentStatus === 'Paid/Settled' as any;
            const isReturned = sale.shipping?.status === 'Returned' || sale.shipping?.status === 'ReStock';

            sale.items.forEach(item => {
                const data = map.get(item.id);
                if (!data) return;

                if (isSold && !isReturned) {
                    if (isToday) data.soldToday += item.quantity;
                    if (isAfterToday) data.soldSince += item.quantity;
                }

                if (isReturned) {
                    if (isToday) data.returnedToday += item.quantity;
                    if (isAfterToday) data.returnedSince += item.quantity;
                }
            });
        });

        restocks.forEach(restock => {
            const restockDate = new Date(restock.date);
            const isToday = restockDate >= selectedStartOfDay && restockDate <= selectedEndOfDay;
            const isAfterToday = restockDate > selectedEndOfDay;

            const data = map.get(restock.productId);
            if (!data) return;

            if (isToday) data.boughtToday += restock.quantity;
            if (isAfterToday) data.boughtSince += restock.quantity;
        });

        const result = products.map(p => {
            const data = map.get(p.id)!;
            const newStock = p.stock;

            // Stock at end of today = Current Stock + Sold Since - Returned Since - Bought Since
            const newStockEndOfThatDay = newStock + data.soldSince - data.returnedSince - data.boughtSince;

            // Old Stock = Stock at end of today + Sold Today - Returned Today - Bought Today
            const oldStock = newStockEndOfThatDay + data.soldToday - data.returnedToday - data.boughtToday;

            return {
                ...p,
                oldStock,
                soldOnDate: data.soldToday,
                returnedOnDate: data.returnedToday,
                buyOnDate: data.boughtToday,
                newStockOnDate: newStockEndOfThatDay
            };
        });

        return result.filter(r => r.oldStock !== 0 || r.soldOnDate !== 0 || r.returnedOnDate !== 0 || r.buyOnDate !== 0 || r.newStockOnDate !== 0)
            .sort((a, b) => (a.model || a.name).localeCompare(b.model || b.name));
    }, [products, sales, restocks, dailyStockDate]);


    // Handlers
    const handleSort = (key: keyof Product | 'totalValue' | 'createdAt' | 'soldPaid') => {
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

    const openRestockModal = () => {
        setRestockData({ productId: products.length > 0 ? products[0].id : '', quantity: 0, cost: 0, note: '' });
        setIsRestockModalOpen(true);
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

    const handleRestockSave = async () => {
        if (!restockData.productId || restockData.quantity <= 0) {
            showToast('Please select a product and enter a valid quantity', 'error');
            return;
        }

        try {
            await addStock(restockData.productId, restockData.quantity, restockData.cost, restockData.note);
            showToast('Stock added successfully', 'success');
            setIsRestockModalOpen(false);
        } catch (error) {
            showToast('Failed to add stock', 'error');
        }
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
    const SortIcon = ({ columnKey }: { columnKey: keyof Product | 'totalValue' | 'createdAt' | 'soldPaid' }) => {
        if (sortConfig?.key !== columnKey) return <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />;
        return sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    };

    const renderHeader = (label: string, key: keyof Product | 'totalValue' | 'createdAt' | 'soldPaid', width?: string) => (
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
                        <>
                            <button
                                onClick={openAddModal}
                                className="primary-button"
                                style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                <Plus size={20} />
                                Add Product
                            </button>
                            <button
                                onClick={openRestockModal}
                                className="secondary-button"
                                style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                            >
                                <Package size={20} />
                                Add Stock
                            </button>
                        </>
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
                    {filteredAndSortedProducts.map((product) => (
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
                        <style>{`
                            .stock-table-14px.spreadsheet-table { font-size: 14px !important; }
                            .stock-table-14px.spreadsheet-table th, .stock-table-14px.spreadsheet-table td { font-size: 14px !important; }
                            .stock-table-14px.spreadsheet-table th { padding: 8px 12px !important; }
                            .stock-table-14px.spreadsheet-table td { padding: 8px 12px !important; }
                        `}</style>
                        <h3 style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)', position: 'sticky', top: 0, background: 'var(--color-surface)', zIndex: 10 }}>
                            All Stock ({filteredAndSortedProducts.length})
                        </h3>
                        <table className="spreadsheet-table stock-table-14px">
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
                                    {renderHeader('Created', 'createdAt')}
                                    {renderHeader('Price', 'price')}
                                    {renderHeader('Stock', 'stock')}
                                    {renderHeader('Sold (Paid)', 'soldPaid')}
                                    {canViewFinancials && renderHeader('Total Value', 'totalValue')}
                                    {canManageInventory && <th style={{ textAlign: 'right' }}>Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredAndSortedProducts.map((product) => (
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
                                                <img src={product.image} alt="" style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'contain', background: 'white', padding: '2px', border: '1px solid var(--color-border)' }} />
                                                <div>
                                                    <div style={{ fontWeight: 600 }}>{product.name}</div>
                                                    <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>{product.model}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                            {product.createdAt ? new Date(product.createdAt).toLocaleDateString() : '-'}
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
                                        <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                                            {product.soldPaid}
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
                                    <td colSpan={2} style={{ textAlign: 'right', padding: '12px 16px' }}>Totals:</td>
                                    <td style={{ padding: '12px 16px' }}>—</td>
                                    <td style={{ padding: '12px 16px' }}>—</td>
                                    <td style={{ padding: '12px 16px', color: '#10B981' }}>
                                        {filteredAndSortedProducts.reduce((sum, p) => sum + p.stock, 0)}
                                    </td>
                                    <td style={{ padding: '12px 16px', color: 'var(--color-primary)' }}>
                                        {filteredAndSortedProducts.reduce((sum, p) => sum + p.soldPaid, 0)}
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
                            {sales.filter(s => s.shipping?.status === 'Returned').length === 0 ? (
                                <div style={{ padding: '32px', textAlign: 'center', color: '#059669', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Boxes size={20} />
                                    </div>
                                    <p style={{ fontSize: '13px', fontWeight: 500 }}>No returned orders pending restock.</p>
                                </div>
                            ) : (
                                <table className="spreadsheet-table compact">
                                    <thead style={{ background: '#FEF2F2' }}>
                                        <tr>
                                            <th>Order / Customer</th>
                                            <th>Items</th>
                                            <th style={{ textAlign: 'right' }}>Date</th>
                                            <th style={{ textAlign: 'right', width: '50px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sales.filter(s => s.shipping?.status === 'Returned').map(order => (
                                            <tr key={order.id} style={{ background: '#FEF2F2' }}>
                                                <td style={{ whiteSpace: 'normal' }}>
                                                    <div style={{ fontWeight: 600 }}>#{order.id.slice(0, 8)}</div>
                                                    <div style={{ color: 'var(--color-text-secondary)' }}>{order.customer?.name || 'Unknown'}</div>
                                                </td>
                                                <td style={{}}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                        {order.items.map((item, idx) => (
                                                            <span key={idx}>
                                                                {item.name} <span style={{ color: '#DC2626', fontWeight: 600 }}>(x{item.quantity})</span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td style={{ textAlign: 'right', color: 'var(--color-text-secondary)', verticalAlign: 'middle' }}>
                                                    {new Date(order.date).toLocaleDateString()}
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
                            {sales.filter(s => s.shipping?.status === 'ReStock').length === 0 ? (
                                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                    <p style={{ fontSize: '13px', fontWeight: 500 }}>No restocked orders found.</p>
                                </div>
                            ) : (
                                <table className="spreadsheet-table compact">
                                    <thead style={{ background: '#EFF6FF' }}>
                                        <tr>
                                            {currentUser && (currentUser.roleId === 'admin' || currentUser.id === '1') && <th style={{ width: '40px' }}></th>}
                                            <th>Order / Customer</th>
                                            <th>Items Restocked</th>
                                            <th style={{ textAlign: 'right' }}>Date</th>
                                            <th style={{ textAlign: 'center' }}>Last Edit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sales.filter(s => s.shipping?.status === 'ReStock').map(order => (
                                            <tr key={order.id} style={{ background: '#EFF6FF' }}>
                                                {currentUser && (currentUser.roleId === 'admin' || currentUser.id === '1') && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        <button
                                                            onClick={async () => {
                                                                if (confirm('Are you sure you want to delete this restock history? This will permanently remove the order record.')) {
                                                                    await deleteOrders([order.id]);
                                                                    showToast('Restock history deleted', 'success');
                                                                }
                                                            }}
                                                            className="icon-button danger"
                                                            title="Delete History"
                                                            style={{ padding: '4px' }}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </td>
                                                )}
                                                <td style={{ whiteSpace: 'normal' }}>
                                                    <div style={{ fontWeight: 600 }}>#{order.id.slice(0, 8)}</div>
                                                    <div style={{ color: 'var(--color-text-secondary)' }}>{order.customer?.name || 'Unknown'}</div>
                                                </td>
                                                <td style={{}}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                        {order.items.map((item, idx) => (
                                                            <span key={idx}>
                                                                {item.name} <span style={{ color: '#2563EB', fontWeight: 600 }}>(x{item.quantity})</span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                                                    {new Date(order.date).toLocaleDateString()}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: '1.2' }}>
                                                        <span style={{ fontWeight: 500 }}>{order.lastEditedBy || '-'}</span>
                                                        {order.lastEditedAt && (
                                                            <span style={{ color: 'var(--color-text-secondary)', fontSize: '9px' }}>
                                                                {new Date(order.lastEditedAt).toLocaleString()}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Daily Stock Summary Table */}
                        <div className="glass-panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)', flex: 1 }}>
                            <h3 style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', margin: 0, fontSize: '14px', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#E0F7FA', position: 'sticky', top: 0, zIndex: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Layers size={16} /> Daily Stock Summary
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontWeight: 600, fontSize: '13px' }}>Date:</span>
                                    <input
                                        type="date"
                                        className="search-input"
                                        style={{ background: 'white', padding: '4px 8px', fontSize: '13px' }}
                                        value={dailyStockDate}
                                        onChange={e => setDailyStockDate(e.target.value)}
                                    />
                                </div>
                            </h3>
                            <div style={{ overflow: 'auto' }}>
                                <table className="spreadsheet-table compact">
                                    <thead>
                                        <tr style={{ background: '#E3F2FD' }}>
                                            <th style={{ width: '25%' }}>Model</th>
                                            <th style={{ textAlign: 'center' }}>Old Stock</th>
                                            <th style={{ textAlign: 'center', color: '#DC2626' }}>Sold</th>
                                            <th style={{ textAlign: 'center' }}>Return</th>
                                            <th style={{ textAlign: 'center', color: '#9333EA' }}>Buy</th>
                                            <th style={{ textAlign: 'center', color: '#2563EB' }}>New Stock</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {dailyStockData.map(row => (
                                            <tr key={row.id}>
                                                <td style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{row.model || row.name}</td>
                                                <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.oldStock}</td>
                                                <td style={{ textAlign: 'center', fontWeight: 600, color: '#DC2626' }}>{row.soldOnDate || ''}</td>
                                                <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.returnedOnDate || ''}</td>
                                                <td style={{ textAlign: 'center', fontWeight: 600, color: '#9333EA' }}>{row.buyOnDate || ''}</td>
                                                <td style={{ textAlign: 'center', fontWeight: 600, color: '#2563EB' }}>{row.newStockOnDate}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot style={{ background: '#FEF08A' }}>
                                        <tr>
                                            <th style={{ textAlign: 'center', fontWeight: 'bold' }}>Total Summary</th>
                                            <th style={{ textAlign: 'center', fontWeight: 'bold' }}>{dailyStockData.reduce((sum, row) => sum + row.oldStock, 0)}</th>
                                            <th style={{ textAlign: 'center', fontWeight: 'bold', color: '#DC2626' }}>{dailyStockData.reduce((sum, row) => sum + row.soldOnDate, 0)}</th>
                                            <th style={{ textAlign: 'center', fontWeight: 'bold' }}>{dailyStockData.reduce((sum, row) => sum + row.returnedOnDate, 0)}</th>
                                            <th style={{ textAlign: 'center', fontWeight: 'bold', color: '#9333EA' }}>{dailyStockData.reduce((sum, row) => sum + row.buyOnDate, 0)}</th>
                                            <th style={{ textAlign: 'center', fontWeight: 'bold', color: '#2563EB' }}>{dailyStockData.reduce((sum, row) => sum + row.newStockOnDate, 0)}</th>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
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
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) {
                                                        const reader = new FileReader();
                                                        reader.onloadend = () => {
                                                            setFormData(prev => ({ ...prev, image: reader.result as string }));
                                                        };
                                                        reader.readAsDataURL(file);
                                                    }
                                                }}
                                                className="search-input"
                                                style={{ width: '100%', padding: '8px' }}
                                            />
                                            <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '6px' }}>
                                                Select an image file (JPG, PNG, GIF). <br />
                                                <span style={{ fontSize: '11px', opacity: 0.7 }}>Note: Large images may affect performance as they are stored locally.</span>
                                            </p>
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

            {/* Add Stock Modal */}
            {
                isRestockModalOpen && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                    }}>
                        <div className="glass-panel" style={{ width: '400px', padding: '32px', animation: 'slideIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Add Stock</h3>
                                <button onClick={() => setIsRestockModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={24} /></button>
                            </div>
                            <div style={{ display: 'grid', gap: '16px', marginBottom: '12px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Product</label>
                                    <select
                                        className="search-input"
                                        style={{ width: '100%' }}
                                        value={restockData.productId}
                                        onChange={e => setRestockData({ ...restockData, productId: e.target.value })}
                                    >
                                        <option value="">Select a product...</option>
                                        {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.model})</option>)}
                                    </select>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Quantity to Add</label>
                                        <input className="search-input" type="number" style={{ width: '100%' }} placeholder="0" value={restockData.quantity || ''} onChange={e => setRestockData({ ...restockData, quantity: Number(e.target.value) })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Cost per unit ($)</label>
                                        <input className="search-input" type="number" style={{ width: '100%' }} placeholder="0.00" value={restockData.cost || ''} onChange={e => setRestockData({ ...restockData, cost: Number(e.target.value) })} />
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Note / Supplier (Optional)</label>
                                    <input className="search-input" style={{ width: '100%' }} placeholder="e.g. Resupplied from main warehouse" value={restockData.note} onChange={e => setRestockData({ ...restockData, note: e.target.value })} />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button onClick={() => setIsRestockModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px', backgroundColor: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={handleRestockSave} className="primary-button" style={{ padding: '10px 24px' }}>Add Stock</button>
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

        </div >
    );
};
export default Inventory;
