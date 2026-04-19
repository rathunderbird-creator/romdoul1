
import React, { useState, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, Package, AlertTriangle, DollarSign, Layers, ArrowUp, ArrowDown, ChevronsUpDown, X, ChevronLeft, ChevronRight, Boxes, GripVertical, Filter, Download } from 'lucide-react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { useClickOutside } from '../hooks/useClickOutside';
import MobileInventoryCard from '../components/MobileInventoryCard';
import { supabase } from '../lib/supabase';
import { processImageForUpload } from '../utils/imageUtils';
import type { Product } from '../types';
import LazyAvatar from '../components/LazyAvatar';

type SortConfig = {
    key: keyof Product | 'totalValue';
    direction: 'asc' | 'desc';
} | null;

const SortableProductRow = ({ id, children, isDraggable, className }: { id: string, children: React.ReactNode, isDraggable: boolean, className?: string }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !isDraggable });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : 1,
        position: isDragging ? ('relative' as const) : undefined,
        zIndex: isDragging ? 10 : undefined,
        backgroundColor: isDragging ? 'var(--color-bg)' : undefined,
    };

    return (
        <tr ref={setNodeRef} style={style} className={className}>
            {children}
            {isDraggable && (
                <td style={{ width: '40px', textAlign: 'center', cursor: 'grab' }} {...attributes} {...listeners}>
                    <GripVertical size={16} color="var(--color-text-secondary)" />
                </td>
            )}
        </tr>
    );
};

const InlineEditCell = ({
    value,
    type,
    onSave,
    isLowStock,
    canEdit
}: {
    value: number;
    type: 'price' | 'stock';
    onSave: (val: number) => void;
    isLowStock?: boolean;
    canEdit?: boolean;
}) => {
    const [isEditing, setIsEditing] = React.useState(false);
    const [tempValue, setTempValue] = React.useState(value.toString());
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    const handleSave = () => {
        if (tempValue.trim() === '') {
            setTempValue(value.toString()); // revert
            setIsEditing(false);
            return;
        }
        const num = Number(tempValue);
        if (!isNaN(num) && num >= 0) {
            if (num !== value) onSave(num);
        } else {
            setTempValue(value.toString()); // revert
        }
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="number"
                value={tempValue}
                onChange={e => setTempValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={e => {
                    if (e.key === 'Enter') handleSave();
                    if (e.key === 'Escape') {
                        setTempValue(value.toString());
                        setIsEditing(false);
                    }
                }}
                style={{ width: type === 'price' ? '70px' : '60px', padding: '4px', fontSize: '13px', borderRadius: '4px', border: '1px solid var(--color-primary)', textAlign: type === 'price' ? 'left' : 'center', outline: 'none' }}
            />
        );
    }

    return (
        <div 
            onClick={() => { if (canEdit) { setIsEditing(true); setTempValue(value.toString()); } }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: canEdit ? 'text' : 'default', minHeight: '24px', padding: '2px 4px', borderRadius: '4px', margin: '-2px -4px' }}
            className={canEdit ? "hover-bg-subtle" : ""}
            title={canEdit ? "Click to edit" : undefined}
        >
            {type === 'price' ? (
                <span style={{ fontWeight: 600 }}>${value}</span>
            ) : (
                isLowStock ? (
                    <span style={{ color: '#EF4444', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'bold', fontSize: '14px' }}>
                        <AlertTriangle size={14} /> {value}
                    </span>
                ) : (
                    <span style={{ color: '#3B82F6', fontWeight: 'bold', fontSize: '14px' }}>{value}</span>
                )
            )}
            {canEdit && <Edit2 size={12} style={{ opacity: 0.3 }} />}
        </div>
    );
};

const Inventory: React.FC = () => {
    const { products, addProduct, updateProduct, deleteProduct, deleteProducts, categories, currentUser, productOrder, updateProductOrder, refreshData } = useStore();
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
    const [hoverPreview, setHoverPreview] = useState<{ src: string; x: number; y: number } | null>(null);

    const handleImageHover = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const anchor = e.currentTarget;
        const img = anchor.querySelector('img') as HTMLImageElement | null;
        if (img && img.src) {
            const rect = anchor.getBoundingClientRect();
            setHoverPreview({
                src: img.src,
                x: rect.right + 12,
                y: rect.top - 80,
            });
        }
    }, []);

    const handleImageLeave = React.useCallback(() => {
        setHoverPreview(null);
    }, []);

    // Add Stock State
    const [addStockProduct, setAddStockProduct] = useState<Product | null>(null);
    const [addStockAmount, setAddStockAmount] = useState<number | string>('');
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

    const handleBulkCategoryUpdate = (newCategory: string) => {
        if (confirm(`Change category for ${selectedIds.size} items to "${newCategory}"?`)) {
            Array.from(selectedIds).forEach(id => {
                updateProduct(id, { category: newCategory });
            });
            showToast(`Category updated to ${newCategory}`, 'success');
            setSelectedIds(new Set());
        }
    };

    const handleBulkStockUpdate = (newStock: number) => {
        Array.from(selectedIds).forEach(id => {
            updateProduct(id, { stock: newStock });
        });
        showToast(`Stock updated to ${newStock} for selected items`, 'success');
        setSelectedIds(new Set());
    };

    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    
    // Column Filters
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const filterMenuRef = useClickOutside<HTMLDivElement>(() => setActiveFilterColumn(null));
    const [columnFilters, setColumnFilters] = useState({
        categories: new Set<string>(),
        priceMin: '',
        priceMax: '',
        stockMin: '',
        stockMax: ''
    });
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
            const productName = (product.name || '').trim();
            const productModel = (product.model || '').trim();
            const searchQuery = searchTerm.trim().toLowerCase();

            const matchesSearch = productName.toLowerCase().includes(searchQuery) ||
                productModel.toLowerCase().includes(searchQuery);
            
            const matchesCategory = columnFilters.categories.size === 0 || columnFilters.categories.has(product.category);
            
            const pMin = columnFilters.priceMin ? Number(columnFilters.priceMin) : -Infinity;
            const pMax = columnFilters.priceMax ? Number(columnFilters.priceMax) : Infinity;
            const matchesPrice = product.price >= pMin && product.price <= pMax;

            const sMin = columnFilters.stockMin ? Number(columnFilters.stockMin) : -Infinity;
            const sMax = columnFilters.stockMax ? Number(columnFilters.stockMax) : Infinity;
            const matchesStock = product.stock >= sMin && product.stock <= sMax;

            return matchesSearch && matchesCategory && matchesPrice && matchesStock;
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
        } else {
            // Unsorted: use productOrder
            result.sort((a, b) => {
                const aIndex = (productOrder || []).indexOf(a.id);
                const bIndex = (productOrder || []).indexOf(b.id);

                if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                if (aIndex !== -1) return -1;
                if (bIndex !== -1) return 1;

                const aDate = new Date(a.createdAt || 0).getTime();
                const bDate = new Date(b.createdAt || 0).getTime();
                return bDate - aDate;
            });
        }

        return result;
    }, [products, searchTerm, columnFilters, sortConfig, productOrder]);

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

    // DND Logic
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id || sortConfig) return;

        let newOrder = [...(productOrder?.length ? productOrder : filteredAndSortedProducts.map(p => p.id))];

        if (!newOrder.includes(active.id as string)) newOrder.push(active.id as string);
        if (!newOrder.includes(over.id as string)) newOrder.push(over.id as string);

        const oldIndex = newOrder.indexOf(active.id as string);
        const newIndex = newOrder.indexOf(over.id as string);

        if (oldIndex !== -1 && newIndex !== -1) {
            newOrder = arrayMove(newOrder, oldIndex, newIndex);
            updateProductOrder(newOrder);
        }
    };

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

    const handleExportCSV = () => {
        if (filteredAndSortedProducts.length === 0) {
            showToast('No products to export', 'error');
            return;
        }

        const csvRows = [];
        const headers = ['ID', 'Name', 'Model', 'Category', 'Price', 'Stock', 'Low Stock Alert', 'Total Value'];
        csvRows.push(headers.join(','));

        for (const product of filteredAndSortedProducts) {
            const values = [
                product.id,
                `"${(product.name || '').replace(/"/g, '""')}"`,
                `"${(product.model || '').replace(/"/g, '""')}"`,
                `"${(product.category || '').replace(/"/g, '""')}"`,
                product.price,
                product.stock,
                product.lowStockThreshold || 5,
                product.price * product.stock
            ];
            csvRows.push(values.join(','));
        }

        const csvString = "\uFEFF" + csvRows.join('\n'); // Add BOM for UTF-8 Excel support
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        link.href = url;
        link.setAttribute('download', `inventory_export_${timestamp}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const renderHeader = (label: string, key: keyof Product | 'totalValue', width?: string, filterable?: boolean) => {
        const isFilterActive = activeFilterColumn === key;
        const hasActiveFilter = (key === 'category' && columnFilters.categories.size > 0) ||
                                (key === 'price' && (columnFilters.priceMin || columnFilters.priceMax)) ||
                                (key === 'stock' && (columnFilters.stockMin || columnFilters.stockMax));

        return (
            <th style={{ width, position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <div onClick={() => handleSort(key)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1 }}>
                        {label}
                        <SortIcon columnKey={key} />
                    </div>
                    {filterable && (
                        <div style={{ position: 'relative' }} ref={isFilterActive ? (filterMenuRef as any) : null}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveFilterColumn(activeFilterColumn === key ? null : key);
                                }}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: hasActiveFilter ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                    padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    borderRadius: '4px', backgroundColor: isFilterActive ? 'var(--color-bg)' : 'transparent'
                                }}
                            >
                                <Filter size={14} />
                            </button>
                            {isFilterActive && (
                                <div className="glass-panel" style={{
                                    position: 'absolute', top: '100%', left: 0, marginTop: '8px',
                                    padding: '12px', minWidth: '200px', zIndex: 100, display: 'flex', flexDirection: 'column', gap: '8px',
                                    boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
                                }}>
                                    {key === 'category' && (
                                        <>
                                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Filter Categories</div>
                                            <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {allCategories.filter(c => c !== 'All').map(cat => (
                                                    <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={columnFilters.categories.has(cat)}
                                                            onChange={() => {
                                                                const newSet = new Set(columnFilters.categories);
                                                                if (newSet.has(cat)) newSet.delete(cat);
                                                                else newSet.add(cat);
                                                                setColumnFilters(prev => ({ ...prev, categories: newSet }));
                                                            }}
                                                            style={{ cursor: 'pointer' }}
                                                        />
                                                        {cat}
                                                    </label>
                                                ))}
                                            </div>
                                            <button 
                                                onClick={() => setColumnFilters(prev => ({ ...prev, categories: new Set() }))}
                                                style={{ fontSize: '12px', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', marginTop: '4px', padding: 0 }}
                                            >
                                                Clear all
                                            </button>
                                        </>
                                    )}
                                    {(key === 'price' || key === 'stock') && (
                                        <>
                                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                                                Filter {key === 'price' ? 'Price' : 'Stock'}
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <input
                                                    type="number"
                                                    placeholder="Min"
                                                    value={key === 'price' ? columnFilters.priceMin : columnFilters.stockMin}
                                                    onChange={(e) => setColumnFilters(prev => ({ ...prev, [key === 'price' ? 'priceMin' : 'stockMin']: e.target.value }))}
                                                    style={{ width: '80px', padding: '6px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--color-border)', outline: 'none' }}
                                                />
                                                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>-</span>
                                                <input
                                                    type="number"
                                                    placeholder="Max"
                                                    value={key === 'price' ? columnFilters.priceMax : columnFilters.stockMax}
                                                    onChange={(e) => setColumnFilters(prev => ({ ...prev, [key === 'price' ? 'priceMax' : 'stockMax']: e.target.value }))}
                                                    style={{ width: '80px', padding: '6px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--color-border)', outline: 'none' }}
                                                />
                                            </div>
                                            <button 
                                                onClick={() => setColumnFilters(prev => ({ ...prev, [key === 'price' ? 'priceMin' : 'stockMin']: '', [key === 'price' ? 'priceMax' : 'stockMax']: '' }))}
                                                style={{ fontSize: '12px', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', marginTop: '4px', padding: 0 }}
                                            >
                                                Clear
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </th>
        );
    };

    return (
        <div style={{ paddingBottom: isMobile ? '80px' : '0' }}>
            {/* Fixed Image Hover Preview */}
            {hoverPreview && (
                <div style={{
                    position: 'fixed',
                    left: hoverPreview.x,
                    top: hoverPreview.y - 210,
                    width: '200px',
                    height: '200px',
                    borderRadius: '12px',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
                    padding: '8px',
                    zIndex: 9999,
                    pointerEvents: 'none',
                    animation: 'fadeInPreview 0.15s ease',
                    overflow: 'hidden',
                }}>
                    <img
                        src={hoverPreview.src}
                        alt="Preview"
                        style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '8px' }}
                    />
                </div>
            )}
            {/* Premium Stats Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.02))', padding: '14px', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 8px 32px rgba(59, 130, 246, 0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Products</span>
                        <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.15)', color: '#3B82F6' }}><Package size={15} /></div>
                    </div>
                    <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-text-main)' }}>{stats.totalProducts}</div>
                </div>
                
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.02))', padding: '14px', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 8px 32px rgba(16, 185, 129, 0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Stock Items</span>
                        <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', color: '#10B981' }}><Boxes size={15} /></div>
                    </div>
                    <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-text-main)' }}>{stats.totalAllStock.toLocaleString()}</div>
                </div>

                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.02))', padding: '14px', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 8px 32px rgba(239, 68, 68, 0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Low Stock</span>
                        <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444' }}><AlertTriangle size={15} /></div>
                    </div>
                    <div style={{ fontSize: '22px', fontWeight: 800, color: '#EF4444' }}>{stats.lowStock}</div>
                </div>

                {canViewFinancials && (
                    <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(245, 158, 11, 0.02))', padding: '14px', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 8px 32px rgba(245, 158, 11, 0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Value</span>
                            <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B' }}><DollarSign size={15} /></div>
                        </div>
                        <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-text-main)' }}>${stats.totalValue.toLocaleString()}</div>
                    </div>
                )}

                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(139, 92, 246, 0.02))', padding: '14px', borderRadius: '12px', border: '1px solid rgba(139, 92, 246, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 8px 32px rgba(139, 92, 246, 0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Categories</span>
                        <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6' }}><Layers size={15} /></div>
                    </div>
                    <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-text-main)' }}>{stats.categoryCount}</div>
                </div>
            </div>

            {/* Unified Command Bar */}
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center', gap: '16px', padding: '16px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '16px', marginBottom: '24px', position: 'sticky', top: '10px', zIndex: 40, boxShadow: '0 4px 20px rgba(0,0,0,0.03)', backdropFilter: 'blur(10px)' }}>
                <div style={{ display: 'flex', gap: '12px', flex: 1, flexDirection: isMobile ? 'column' : 'row' }}>
                    <div style={{ position: 'relative', flex: 1, maxWidth: isMobile ? '100%' : '300px' }}>
                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                        <input
                            type="text"
                            placeholder="Search inventory..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="search-input"
                            style={{ width: '100%', paddingLeft: '36px', height: '40px', background: 'var(--color-bg)' }}
                        />
                    </div>
                    {/* Category filter moved to column header */}
                </div>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <button onClick={() => { refreshData(); showToast('Inventory refreshed', 'success'); }} className="secondary-button hover-lift" style={{ height: '40px', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-bg)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                        {!isMobile && 'Refresh'}
                    </button>
                    <button onClick={handleExportCSV} className="secondary-button hover-lift" style={{ height: '40px', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-bg)' }}>
                        <Download size={16} />
                        {!isMobile && 'Export'}
                    </button>
                    {canManageInventory && (
                        <button onClick={openAddModal} className="primary-button hover-lift" style={{ height: '40px', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)' }}>
                            <Plus size={18} />
                            Add Product
                        </button>
                    )}
                </div>
            </div>

        

            {/* Filters have been moved inside the All Stock container */}

            {/* Content: List or Table */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filteredAndSortedProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(p => p.id)} strategy={verticalListSortingStrategy}>
            {isMobile ? (
                    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', maxHeight: 'calc(100vh - 240px)', paddingBottom: '80px' }}>
                        {filteredAndSortedProducts.length === 0 ? (
                            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', background: 'var(--color-surface)', borderRadius: '16px', border: '1px dashed var(--color-border)', margin: '16px' }}>
                                <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                                    <Package size={24} />
                                </div>
                                <p style={{ fontSize: '14px', fontWeight: 500 }}>No products found matching your search.</p>
                            </div>
                        ) : (
                            filteredAndSortedProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((product) => (
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
                            ))
                        )}
                    </div>
                ) : (
                    <div className="glass-panel hover-lift" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 350px)', position: 'relative' }}>
                        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--color-surface)' }}>
                            <h3 style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Package size={18} style={{ color: 'var(--color-primary)' }}/> All Stock ({filteredAndSortedProducts.length})
                            </h3>
                        </div>
                        {filteredAndSortedProducts.length === 0 ? (
                            <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                                    <Search size={32} />
                                </div>
                                <div>
                                    <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>No products found</h4>
                                    <p style={{ fontSize: '14px' }}>Try adjusting your search or category filters.</p>
                                </div>
                            </div>
                        ) : (
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
                                    {renderHeader('Category', 'category', undefined, true)}
                                    {renderHeader('Price', 'price', undefined, true)}
                                    {renderHeader('Stock', 'stock', undefined, true)}
                                    {canViewFinancials && renderHeader('Total Value', 'totalValue')}
                                    {canManageInventory && <th style={{ textAlign: 'right' }}>Actions</th>}
                                    {!sortConfig && <th style={{ width: '40px' }} />}
                                </tr>
                            </thead>
                            <tbody>
                                        {filteredAndSortedProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((product) => (
                                            <SortableProductRow
                                                key={product.id}
                                                id={product.id}
                                                isDraggable={!sortConfig}
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
                                                        <div data-preview-anchor onMouseEnter={handleImageHover} onMouseLeave={handleImageLeave} style={{ flexShrink: 0, cursor: 'pointer' }}>
                                                            <LazyAvatar productId={product.id} initialImage={product.image} alt="" style={{ width: '32px', height: '32px', borderRadius: '4px', backgroundColor: 'white', padding: '2px', border: '1px solid var(--color-border)', flexShrink: 0 }} />
                                                        </div>
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
                                                <td>
                                                    <InlineEditCell 
                                                        value={product.price} 
                                                        type="price" 
                                                        onSave={(val) => {
                                                            updateProduct(product.id, { price: val });
                                                            showToast(`Updated price for ${product.name}`, 'success');
                                                        }} 
                                                        canEdit={canManageInventory} 
                                                    />
                                                </td>
                                                <td>
                                                    <InlineEditCell 
                                                        value={product.stock} 
                                                        type="stock" 
                                                        isLowStock={product.stock < (product.lowStockThreshold || 5)}
                                                        onSave={(val) => {
                                                            updateProduct(product.id, { stock: val });
                                                            showToast(`Updated stock for ${product.name}`, 'success');
                                                        }} 
                                                        canEdit={canManageInventory} 
                                                    />
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
                                            </SortableProductRow>
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
                        )}
                    </div>
                )}
            </SortableContext>
            </DndContext>
            {/* Mobile Summary Footer */}
            {
                isMobile && (
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
                )
            }

            {/* Pagination */}
            {
                filteredAndSortedProducts.length > 0 && (
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
                )
            }


            {/* Bulk Actions Bar */}
            {
                selectedIds.size > 0 && (
                    <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'var(--color-surface)', padding: '16px 24px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '16px', zIndex: 100, border: '1px solid var(--color-border)' }}>
                        <span style={{ fontWeight: 600 }}>{selectedIds.size} selected</span>
                        <div style={{ height: '24px', width: '1px', background: 'var(--color-border)' }} />
                        <select
                            onChange={(e) => {
                                if (e.target.value) {
                                    handleBulkCategoryUpdate(e.target.value);
                                    e.target.value = '';
                                }
                            }}
                            className="search-input"
                            style={{ height: '36px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none' }}
                            defaultValue=""
                        >
                            <option value="" disabled>Set Category...</option>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button onClick={() => {
                            const newStock = prompt(`Enter new stock value for ${selectedIds.size} selected items:`);
                            if (newStock !== null) {
                                const num = Number(newStock);
                                if (!isNaN(num) && num >= 0) {
                                    handleBulkStockUpdate(num);
                                } else {
                                    alert('Invalid stock amount. Please enter a positive number.');
                                }
                            }
                        }} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text-main)', borderRadius: '8px', border: '1px solid var(--color-border)', cursor: 'pointer', fontWeight: 500 }}>
                            <Package size={18} /> Set Stock
                        </button>
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
