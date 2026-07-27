// @ts-nocheck

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
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

const PIE_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4'];

const Inventory: React.FC = () => {
    const { products, addProduct, updateProduct, deleteProduct, deleteProducts, categories, currentUser, productOrder, updateProductOrder, refreshData, addStock } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();

    // Permission Logic
    const restrictedRoles = ['store_manager', 'salesman', 'customer_care'];
    const canViewFinancials = !restrictedRoles.includes(currentUser?.roleId || '');
    const canManageInventory = !restrictedRoles.includes(currentUser?.roleId || '');

    // Header effect moved below openAddModal

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
    const [addStockCost, setAddStockCost] = useState<number | string>('');
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

    // Column resize state
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

    const handleResizeStart = useCallback((key: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const th = (e.target as HTMLElement).closest('th');
        if (!th) return;
        const startWidth = th.getBoundingClientRect().width;
        resizingRef.current = { key, startX: e.clientX, startWidth };

        const handleMouseMove = (ev: MouseEvent) => {
            if (!resizingRef.current) return;
            const diff = ev.clientX - resizingRef.current.startX;
            const newWidth = Math.max(60, resizingRef.current.startWidth + diff);
            setColumnWidths(prev => ({ ...prev, [resizingRef.current!.key]: newWidth }));
        };

        const handleMouseUp = () => {
            resizingRef.current = null;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, []);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);

    // Form State
    type ProductFormState = Omit<Product, 'id' | 'price' | 'stock' | 'lowStockThreshold' | 'purchaseCost'> & {
        price: number | string;
        purchaseCost: number | string;
        stock: number | string;
        lowStockThreshold: number | string;
    };

    const initialFormState: ProductFormState = useMemo(() => ({
        name: '',
        model: '',
        price: 0,
        purchaseCost: 0,
        stock: 0,
        lowStockThreshold: 5,
        category: categories[0] || 'Portable',
        image: 'https://placehold.co/300x300',
        invoiceNumber: '',
        supplier: ''
    }), [categories]);
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
            // Default: newest first
            result.sort((a, b) => {
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
    const pieChartData = useMemo(() => {
        const counts = products.reduce((acc, p) => {
            acc[p.category] = (acc[p.category] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [products]);


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

    const openAddModalCallback = React.useCallback(openAddModal, [initialFormState]);

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '16px' }}>
                    <div>
                        <h1 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0, color: 'var(--color-text-main)' }}>Inventory</h1>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0, marginTop: '4px' }}>{filteredAndSortedProducts ? filteredAndSortedProducts.length : 0} products</p>
                    </div>
                    {canManageInventory && (
                        <button onClick={openAddModalCallback} className="primary-button hover-lift" style={{ height: '36px', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '8px', fontSize: '13px', fontWeight: 600 }}>
                            <Plus size={16} /> Add Product
                        </button>
                    )}
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, filteredAndSortedProducts, canManageInventory, openAddModalCallback]);

    const openEditModal = (product: Product) => {
        setEditingProduct(product);
        setFormData({
            ...product,
            purchaseCost: product.purchaseCost ?? 0,
            lowStockThreshold: product.lowStockThreshold ?? 5
        });
        setIsModalOpen(true);
    };

    const [formErrors, setFormErrors] = useState<Record<string, string>>({});

    const handleSave = () => {
        const errors: Record<string, string> = {};
        if (!formData.name.trim()) errors.name = 'Product name is required';
        if (formData.price === '' || Number(formData.price) <= 0) errors.price = 'Sell price must be greater than 0';
        if (formData.stock === '' || Number(formData.stock) < 0) errors.stock = 'Stock cannot be negative';
        if (formData.purchaseCost === '' || Number(formData.purchaseCost) < 0) errors.purchaseCost = 'Cost cannot be negative';

        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            showToast('Please fix the highlighted fields', 'error');
            return;
        }
        setFormErrors({});

        const productData = {
            ...formData,
            price: Number(formData.price),
            purchaseCost: Number(formData.purchaseCost || 0),
            stock: Number(formData.stock),
            lowStockThreshold: Number(formData.lowStockThreshold)
        };

        if (editingProduct) {
            updateProduct(editingProduct.id, productData);
            showToast('Product updated successfully', 'success');
        } else {
            // Update sell price on all existing products with the same name
            const matchingProducts = products.filter(p => p.name.trim().toLowerCase() === formData.name.trim().toLowerCase());
            if (matchingProducts.length > 0) {
                matchingProducts.forEach(p => {
                    updateProduct(p.id, { price: Number(formData.price) });
                });
            }
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
        const headers = ['ID', 'Name', 'Model', 'Category', 'Cost of Purchase', 'Sell Price', 'Stock', 'Low Stock Alert', 'Total Value'];
        csvRows.push(headers.join(','));

        for (const product of filteredAndSortedProducts) {
            const values = [
                product.id,
                `"${(product.name || '').replace(/"/g, '""')}"`,
                `"${(product.model || '').replace(/"/g, '""')}"`,
                `"${(product.category || '').replace(/"/g, '""')}"`,
                product.purchaseCost || 0,
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
            <th style={{ width: columnWidths[key] ? `${columnWidths[key]}px` : width, position: 'relative', minWidth: '60px' }}>
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
                <div
                    onMouseDown={(e) => handleResizeStart(key, e)}
                    style={{
                        position: 'absolute', right: 0, top: 0, bottom: 0, width: '5px',
                        cursor: 'col-resize', zIndex: 31,
                        background: 'transparent'
                    }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--color-primary)'; (e.target as HTMLElement).style.opacity = '0.4'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; (e.target as HTMLElement).style.opacity = '1'; }}
                />
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div className="stats-card hover-lift" style={{ background: 'var(--color-surface)', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Products</span>
                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text-main)' }}>{stats.totalProducts}</div>
                    </div>
                    <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', color: '#3B82F6' }}><Package size={18} /></div>
                </div>

                {canViewFinancials && (
                    <div className="stats-card hover-lift" style={{ background: 'var(--color-surface)', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inventory Value</span>
                            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text-main)' }}>${stats.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                        <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: '#10B981' }}><DollarSign size={18} /></div>
                    </div>
                )}

                <div className="stats-card hover-lift" style={{ background: 'var(--color-surface)', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Low Stock</span>
                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text-main)' }}>{stats.lowStock}</div>
                    </div>
                    <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', color: '#F59E0B' }}><AlertTriangle size={18} /></div>
                </div>

                <div className="stats-card hover-lift" style={{ background: 'var(--color-surface)', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Out Of Stock</span>
                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text-main)' }}>{products.filter(p => p.stock === 0).length}</div>
                    </div>
                    <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444' }}><X size={18} /></div>
                </div>
            </div>

            {/* Unified Command Bar */}
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center', gap: '16px', marginBottom: '16px' }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                    <Search size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                    <input
                        type="text"
                        placeholder="Search products..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{ width: '100%', paddingLeft: '44px', height: '40px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'var(--color-text-main)', fontSize: '14px', outline: 'none' }}
                    />
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <select
                        value={columnFilters.categories.size > 0 ? Array.from(columnFilters.categories)[0] : 'All'}
                        onChange={(e) => {
                            if (e.target.value === 'All') setColumnFilters(prev => ({ ...prev, categories: new Set() }));
                            else setColumnFilters(prev => ({ ...prev, categories: new Set([e.target.value]) }));
                        }}
                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'var(--color-text-main)', padding: '0 32px 0 16px', height: '40px', appearance: 'none', cursor: 'pointer', fontSize: '13px' }}
                    >
                        <option value="All">All Categories</option>
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>

                    <select
                        value={columnFilters.stockMin === '1' ? 'In Stock' : columnFilters.stockMax === '0' ? 'Out of Stock' : 'All'}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'All') setColumnFilters(prev => ({ ...prev, stockMin: '', stockMax: '' }));
                            if (val === 'In Stock') setColumnFilters(prev => ({ ...prev, stockMin: '1', stockMax: '' }));
                            if (val === 'Out of Stock') setColumnFilters(prev => ({ ...prev, stockMin: '', stockMax: '0' }));
                        }}
                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'var(--color-text-main)', padding: '0 32px 0 16px', height: '40px', appearance: 'none', cursor: 'pointer', fontSize: '13px' }}
                    >
                        <option value="All">All Status</option>
                        <option value="In Stock">In Stock</option>
                        <option value="Out of Stock">Out of Stock</option>
                    </select>
                </div>
            </div>

            {/* Layout Split */}
            <div style={{ display: 'flex', gap: '24px', flexDirection: isMobile ? 'column' : 'row' }}>
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)', overflow: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    <th style={{ padding: '16px', fontWeight: 600 }}>Product Name</th>
                                    <th style={{ padding: '16px', fontWeight: 600 }}>SKU</th>
                                    <th style={{ padding: '16px', fontWeight: 600 }}>Category</th>
                                    <th style={{ padding: '16px', fontWeight: 600 }}>Price</th>
                                    <th style={{ padding: '16px', fontWeight: 600 }}>Stock</th>
                                    <th style={{ padding: '16px', fontWeight: 600 }}>Status</th>
                                    {canManageInventory && <th style={{ padding: '16px', fontWeight: 600, textAlign: 'right' }}>Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredAndSortedProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((product) => (
                                    <tr key={product.id} style={{ borderBottom: '1px solid var(--color-border)' }} className="hover-bg">
                                        <td style={{ padding: '12px 16px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'white', display: 'flex', alignItems: 'center', justifyItems: 'center', overflow: 'hidden', padding: '2px', flexShrink: 0 }}>
                                                    <img src={product.image || 'https://placehold.co/300x300'} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="" />
                                                </div>
                                                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)' }}>{product.name}</span>
                                            </div>
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{product.model}</td>
                                        <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{product.category}</td>
                                        <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--color-text-main)' }}>
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
                                        <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--color-text-main)' }}>
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
                                        <td style={{ padding: '12px 16px' }}>
                                            {product.stock === 0 ? (
                                                <span style={{ padding: '4px 8px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', fontSize: '11px', fontWeight: 600 }}>Out of Stock</span>
                                            ) : product.stock < (product.lowStockThreshold || 5) ? (
                                                <span style={{ padding: '4px 8px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.1)', color: '#F59E0B', fontSize: '11px', fontWeight: 600 }}>Low Stock</span>
                                            ) : (
                                                <span style={{ padding: '4px 8px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.1)', color: '#10B981', fontSize: '11px', fontWeight: 600 }}>In Stock</span>
                                            )}
                                        </td>
                                        {canManageInventory && (
                                            <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                    <button onClick={() => openEditModal(product)} style={{ padding: '4px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><Edit2 size={14} /></button>
                                                    <button onClick={() => promptDelete(product.id)} style={{ padding: '4px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><Trash2 size={14} /></button>
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        
                        <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)' }}>
                            <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredAndSortedProducts.length)} of {filteredAndSortedProducts.length}
                            </span>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    style={{ padding: '6px 12px', borderRadius: '6px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: currentPage === 1 ? 'var(--color-text-muted)' : 'var(--color-text-main)', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredAndSortedProducts.length / itemsPerPage), p + 1))}
                                    disabled={currentPage >= Math.ceil(filteredAndSortedProducts.length / itemsPerPage)}
                                    style={{ padding: '6px 12px', borderRadius: '6px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: currentPage >= Math.ceil(filteredAndSortedProducts.length / itemsPerPage) ? 'var(--color-text-muted)' : 'var(--color-text-main)', cursor: currentPage >= Math.ceil(filteredAndSortedProducts.length / itemsPerPage) ? 'not-allowed' : 'pointer' }}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                
                {!isMobile && (
                    <div style={{ width: '300px', flexShrink: 0 }}>
                        <div style={{ background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)', padding: '20px' }}>
                            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)' }}>By Category</h3>
                            <p style={{ margin: 0, marginTop: '4px', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '24px' }}>Product distribution</p>
                            
                            <div style={{ height: '220px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            isAnimationActive={false}
                                            data={pieChartData}
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                            stroke="none"
                                        >
                                            {pieChartData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4'][index % 7]} />
                                            ))}
                                        </Pie>
                                        <RechartsTooltip 
                                            contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px' }}
                                            itemStyle={{ color: 'var(--color-text-main)' }}
                                        />
                                        
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            {/* Custom legend to avoid Recharts Legend infinite loop bug */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
                                {pieChartData.map((entry, index) => (
                                    <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4'][index % 7], flexShrink: 0 }} />
                                        <span style={{ color: 'var(--color-text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                                        <span style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>{entry.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

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
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Product Name *</label>
                                    <input 
                                        list="product-names"
                                        className="search-input" 
                                        style={{ width: '100%', borderColor: formErrors.name ? '#EF4444' : undefined }} 
                                        placeholder="e.g. JBL Flip 6" 
                                        value={formData.name} 
                                        onChange={e => {
                                            const newName = e.target.value;
                                            const normalizedNewName = newName.trim().toLowerCase();
                                            
                                            // Find all matching products
                                            const matches = products.filter(p => (p.name || '').trim().toLowerCase() === normalizedNewName);
                                            // Prefer a match that actually has a real image
                                            const isPlaceholder = (url: string | undefined) => !url || url.includes('placeholder.com') || url.includes('placehold.co');
                                            const referenceProduct = matches.find(p => !isPlaceholder(p.image)) || matches[0];
                                            
                                            setFormData(prev => {
                                                if (referenceProduct && !editingProduct) {
                                                    return { 
                                                        ...prev, 
                                                        name: newName,
                                                        image: isPlaceholder(referenceProduct.image) ? 'https://placehold.co/300x300' : referenceProduct.image,
                                                        category: referenceProduct.category,
                                                        price: referenceProduct.price,
                                                        purchaseCost: referenceProduct.purchaseCost || 0
                                                    };
                                                }
                                                return { ...prev, name: newName };
                                            });
                                        }} 
                                    />
                                    <datalist id="product-names">
                                        {Array.from(new Set(products.map(p => p.name))).sort().map(name => (
                                            <option key={name} value={name} />
                                        ))}
                                    </datalist>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Category</label>
                                    <select className="search-input" style={{ width: '100%' }} value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value as any })}>
                                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Cost of Purchase ($)</label>
                                        <input className="search-input" type="number" style={{ width: '100%', borderColor: formErrors.purchaseCost ? '#EF4444' : undefined }} placeholder="0.00" value={formData.purchaseCost} onChange={e => setFormData({ ...formData, purchaseCost: e.target.value === '' ? '' : Number(e.target.value) })} />
                                        {formErrors.purchaseCost && <p style={{ color: '#EF4444', fontSize: '11px', marginTop: '4px' }}>{formErrors.purchaseCost}</p>}
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Sell Price ($) *</label>
                                        <input className="search-input" type="number" style={{ width: '100%', borderColor: formErrors.price ? '#EF4444' : undefined }} placeholder="0.00" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value === '' ? '' : Number(e.target.value) })} />
                                        {formErrors.price && <p style={{ color: '#EF4444', fontSize: '11px', marginTop: '4px' }}>{formErrors.price}</p>}
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Stock</label>
                                        <input className="search-input" type="number" min="0" style={{ width: '100%', borderColor: formErrors.stock ? '#EF4444' : undefined }} placeholder="0" value={formData.stock} onChange={e => setFormData({ ...formData, stock: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} />
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
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Invoice Number</label>
                                        <input
                                            className="search-input"
                                            type="text"
                                            style={{ width: '100%' }}
                                            placeholder="INV-001"
                                            value={formData.invoiceNumber || ''}
                                            onChange={e => setFormData({ ...formData, invoiceNumber: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Supplier</label>
                                        <input
                                            className="search-input"
                                            type="text"
                                            style={{ width: '100%' }}
                                            placeholder="Supplier Name"
                                            value={formData.supplier || ''}
                                            onChange={e => setFormData({ ...formData, supplier: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div style={{ marginTop: '16px' }}>
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
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-main)', fontWeight: 500 }}>Quantity to Add</label>
                                        <input
                                            className="search-input"
                                            type="number"
                                            style={{ width: '100%', fontSize: '16px', padding: '12px' }}
                                            placeholder="e.g. 50"
                                            autoFocus
                                            value={addStockAmount}
                                            onChange={e => setAddStockAmount(e.target.value === '' ? '' : Number(e.target.value))}
                                            onKeyDown={async e => {
                                                if (e.key === 'Enter' && addStockAmount !== '' && Number(addStockAmount) > 0) {
                                                    await addStock(addStockProduct.id, Number(addStockAmount), Number(addStockCost) || 0);
                                                    showToast(`Added ${addStockAmount} stock to ${addStockProduct.name}`, 'success');
                                                    setAddStockProduct(null);
                                                }
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-main)', fontWeight: 500 }}>Unit Cost ($)</label>
                                        <input
                                            className="search-input"
                                            type="number"
                                            style={{ width: '100%', fontSize: '16px', padding: '12px' }}
                                            placeholder="0.00"
                                            value={addStockCost}
                                            onChange={e => setAddStockCost(e.target.value === '' ? '' : Number(e.target.value))}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button onClick={() => setAddStockProduct(null)} style={{ padding: '10px 20px', borderRadius: '8px', backgroundColor: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Cancel</button>
                                <button
                                    onClick={async () => {
                                        if (addStockAmount === '' || Number(addStockAmount) <= 0) {
                                            showToast('Please enter a valid stock amount', 'error');
                                            return;
                                        }
                                        await addStock(addStockProduct.id, Number(addStockAmount), Number(addStockCost) || 0);
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
