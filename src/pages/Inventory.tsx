
import React, { useState, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, Package, AlertTriangle, DollarSign, Layers, ArrowUp, ArrowDown, ChevronsUpDown, X, ChevronLeft, ChevronRight, Boxes } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import StatsCard from '../components/StatsCard';
import MobileInventoryCard from '../components/MobileInventoryCard';
import type { Product } from '../types';

type SortConfig = {
    key: keyof Product | 'totalValue';
    direction: 'asc' | 'desc';
} | null;

const Inventory: React.FC = () => {
    const { products, addProduct, updateProduct, deleteProduct, deleteProducts, categories } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();

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
    const initialFormState: Partial<Product> = {
        name: '',
        model: '',
        price: 0,
        stock: 0,
        lowStockThreshold: 5,
        category: categories[0] || 'Portable',
        image: 'https://via.placeholder.com/300'
    };
    const [formData, setFormData] = useState<Partial<Product>>(initialFormState);

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
        setFormData(product);
        setIsModalOpen(true);
    };

    const handleSave = () => {
        if (!formData.name || !formData.price) {
            showToast('Please fill in required fields', 'error');
            return;
        }

        if (editingProduct) {
            updateProduct(editingProduct.id, formData);
            showToast('Product updated successfully', 'success');
        } else {
            addProduct(formData as Omit<Product, 'id'>);
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
                    <button
                        onClick={openAddModal}
                        className="primary-button"
                        style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <Plus size={20} />
                        Add Product
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '12px' }}>
                <StatsCard title="Total Products" value={stats.totalProducts} icon={Package} color="var(--color-primary)" />
                <StatsCard title="Products in Stock" value={stats.totalAllStock} icon={Boxes} color="#3B82F6" />
                <StatsCard title="Low Stock" value={stats.lowStock} icon={AlertTriangle} color="var(--color-red)" />
                <StatsCard title="Total Value" value={`$${stats.totalValue.toLocaleString()} `} icon={DollarSign} color="var(--color-green)" />
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
            <div className={!isMobile ? "glass-panel" : ""} style={{ overflow: 'auto', maxHeight: isMobile ? 'calc(100vh - 280px)' : 'calc(100vh - 200px)' }}>
                {isMobile ? (
                    // Mobile View
                    <div style={{ paddingBottom: '80px' }}>
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
                            />
                        ))}
                    </div>
                ) : (
                    // Desktop View
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
                                {renderHeader('Total Value', 'totalValue')}
                                <th style={{ textAlign: 'right' }}>Actions</th>
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
                                            <img src={product.image} alt="" style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'contain', background: 'white', padding: '2px', border: '1px solid var(--color-border)' }} />
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
                                    <td style={{ color: 'var(--color-text-secondary)' }}>
                                        ${(product.price * product.stock).toLocaleString()}
                                    </td>
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
                                <td style={{ padding: '12px 16px' }}>
                                    ${filteredAndSortedProducts.reduce((sum, p) => sum + (p.price * p.stock), 0).toLocaleString()}
                                </td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                )}

                {filteredAndSortedProducts.length === 0 && (
                    <div style={{ padding: '60px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                        <div style={{ marginBottom: '16px', opacity: 0.5 }}><Search size={48} /></div>
                        <p>No products found matching your search.</p>
                    </div>
                )}
            </div>

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
                                        <input className="search-input" type="number" style={{ width: '100%' }} placeholder="0.00" value={formData.price} onChange={e => setFormData({ ...formData, price: Number(e.target.value) })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Stock</label>
                                        <input className="search-input" type="number" style={{ width: '100%' }} placeholder="0" value={formData.stock} onChange={e => setFormData({ ...formData, stock: Number(e.target.value) })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Low Stock Alert</label>
                                        <input
                                            className="search-input"
                                            type="number"
                                            style={{ width: '100%' }}
                                            placeholder="5"
                                            value={formData.lowStockThreshold}
                                            onChange={e => setFormData({ ...formData, lowStockThreshold: Number(e.target.value) })}
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
