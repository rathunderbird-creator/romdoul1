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
    const { products, addProduct, updateProduct, deleteProduct, deleteProducts, categories, currentUser, productOrder, updateProductOrder, refreshData, addStock, adjustStock } = useStore();
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
    const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [hoverPreview, setHoverPreview] = useState<{ src: string; x: number; y: number } | null>(null);

    React.useEffect(() => {
        const fetchSuppliers = async () => {
            const { data } = await supabase.from('suppliers').select('id, name').eq('is_active', true);
            if (data) setSuppliers(data);
        };
        fetchSuppliers();
    }, []);

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
    const [adjustStockProduct, setAdjustStockProduct] = useState<Product | null>(null);
    const [adjustStockAmount, setAdjustStockAmount] = useState<number | string>('');
    const [adjustStockReason, setAdjustStockReason] = useState<string>('');
    const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null);
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
    const [itemsPerPage, setItemsPerPage] = useState(100);

    // Form State
    type ProductFormState = Omit<Product, 'id' | 'price' | 'stock' | 'lowStockThreshold' | 'purchaseCost' | 'reorderLevel'> & {
        price: number | string;
        purchaseCost: number | string;
        stock: number | string;
        lowStockThreshold: number | string;
        reorderLevel: number | string;
    };

    const initialFormState: ProductFormState = useMemo(() => ({
        name: '',
        model: '',
        price: 0,
        purchaseCost: 0,
        stock: 0,
        lowStockThreshold: 5,
        reorderLevel: 5,
        lowStockAlert: true,
        unitOfMeasure: 'PCS',
        category: categories[0] || 'Portable',
        image: 'https://placehold.co/300x300',
        sku: '',
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
            lowStockThreshold: product.lowStockThreshold ?? 5,
            reorderLevel: product.reorderLevel ?? 5,
            unitOfMeasure: product.unitOfMeasure ?? 'PCS',
            lowStockAlert: product.lowStockAlert ?? true
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
            stock: Number(formData.stock || 0),
            lowStockThreshold: Number(formData.lowStockThreshold || 5),
            reorderLevel: Number(formData.reorderLevel || 5)
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
            {/* Minimalist Stats Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: canViewFinancials ? 'repeat(6, 1fr)' : 'repeat(5, 1fr)', gap: '16px', marginBottom: '24px' }}>
                <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '8px', border: '1px solid var(--color-border)', borderTop: '4px solid #6366f1', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 500 }}>Total Products</span>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827' }}>{stats.totalProducts}</div>
                </div>
                <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '8px', border: '1px solid var(--color-border)', borderTop: '4px solid #3B82F6', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 500 }}>Total Stock</span>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827' }}>{stats.totalAllStock.toLocaleString()}</div>
                </div>
                <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '8px', border: '1px solid var(--color-border)', borderTop: '4px solid #10B981', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 500 }}>In Stock</span>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827' }}>{products.filter(p => p.stock > 0).length}</div>
                </div>
                <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '8px', border: '1px solid var(--color-border)', borderTop: '4px solid #F59E0B', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 500 }}>Low Stock</span>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827' }}>{stats.lowStock}</div>
                </div>
                <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '8px', border: '1px solid var(--color-border)', borderTop: '4px solid #EF4444', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 500 }}>Out of Stock</span>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827' }}>{products.filter(p => p.stock === 0).length}</div>
                </div>
                {canViewFinancials && (
                    <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '8px', border: '1px solid var(--color-border)', borderTop: '4px solid #8B5CF6', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 500 }}>Total Value</span>
                        <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827' }}>${stats.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                )}
            </div>

            {/* Simple Search Bar */}
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px' }}>
                <div style={{ flex: 1, position: 'relative', background: '#ffffff', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                    <Search size={18} color="var(--color-text-muted)" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input 
                        type="text" 
                        placeholder="Search products by name or SKU..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{ width: '100%', padding: '12px 16px 12px 44px', background: 'transparent', border: 'none', outline: 'none', fontSize: '14px', color: '#111827' }}
                    />
                </div>
                {canManageInventory && (
                    <button onClick={openAddModalCallback} style={{ background: '#4F46E5', color: '#ffffff', border: 'none', borderRadius: '8px', padding: '0 20px', height: '42px', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flexShrink: 0 }}>
                        <Plus size={18} />
                        Add Product
                    </button>
                )}
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto', background: '#ffffff', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                            <th style={{ padding: '16px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('sku')}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>SKU {sortConfig?.key === 'sku' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />}</div>
                            </th>
                            <th style={{ padding: '16px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>Product Name {sortConfig?.key === 'name' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />}</div>
                            </th>
                            <th style={{ padding: '16px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('category')}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>Category {sortConfig?.key === 'category' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />}</div>
                            </th>
                            {canViewFinancials && (
                                <th style={{ padding: '16px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('purchaseCost')}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>Cost {sortConfig?.key === 'purchaseCost' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />}</div>
                                </th>
                            )}
                            <th style={{ padding: '16px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('supplier')}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>Supplier {sortConfig?.key === 'supplier' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />}</div>
                            </th>
                            <th style={{ padding: '16px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('price')}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>Sell Price {sortConfig?.key === 'price' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />}</div>
                            </th>
                            <th style={{ padding: '16px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('stock')}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>Stock {sortConfig?.key === 'stock' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />}</div>
                            </th>
                            {canViewFinancials && (
                                <th style={{ padding: '16px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('totalValue')}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>Total Value {sortConfig?.key === 'totalValue' ? (sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ChevronsUpDown size={14} style={{ opacity: 0.3 }} />}</div>
                                </th>
                            )}
                            <th style={{ padding: '16px', fontWeight: 600 }}>Status</th>
                            {canManageInventory && <th style={{ padding: '16px', fontWeight: 600, textAlign: 'right' }}>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAndSortedProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((product) => {
                            const isOutOfStock = product.stock === 0;
                            const isLowStock = product.stock > 0 && product.stock < (product.lowStockThreshold || 5);
                            return (
                                <tr key={product.id} style={{ 
                                    borderBottom: '1px solid var(--color-border)',
                                    backgroundColor: recentlyUpdatedId === product.id ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                                    transition: 'background-color 0.8s ease'
                                }}>
                                    <td style={{ padding: '16px', fontSize: '13px', fontWeight: 600, color: '#4B5563' }}>
                                        {product.sku || 'N/A'}
                                    </td>
                                    <td style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{ width: '24px', height: '24px', borderRadius: '4px', background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <Package size={14} color="#6366f1" />
                                        </div>
                                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{product.name}</span>
                                    </td>
                                    <td style={{ padding: '16px', fontSize: '13px', color: '#6B7280' }}>
                                        {product.category}
                                    </td>
                                    {canViewFinancials && (
                                        <td style={{ padding: '16px', fontSize: '13px', color: '#6B7280' }}>
                                            ${(product.purchaseCost || 0).toFixed(2)}
                                        </td>
                                    )}
                                    <td style={{ padding: '16px', fontSize: '13px', color: '#6B7280' }}>
                                        {product.supplier || '-'}
                                    </td>
                                    <td style={{ padding: '16px', fontSize: '13px', fontWeight: 600, color: '#111827' }}>
                                        <InlineEditCell 
                                            value={product.price} 
                                            type="price" 
                                            onSave={(val) => updateProduct(product.id, { price: val })} 
                                            canEdit={canManageInventory} 
                                        />
                                    </td>
                                    <td style={{ padding: '16px', fontSize: '13px', color: '#6B7280' }}>
                                        <InlineEditCell 
                                            value={product.stock} 
                                            type="stock" 
                                            onSave={(val) => updateProduct(product.id, { stock: val })} 
                                            isLowStock={isLowStock} 
                                            canEdit={canManageInventory} 
                                        /> pcs
                                    </td>
                                    {canViewFinancials && (
                                        <td style={{ padding: '16px', fontSize: '13px', fontWeight: 600, color: '#111827' }}>
                                            ${(product.price * product.stock).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                    )}
                                    <td style={{ padding: '16px' }}>
                                        <span style={{ 
                                            display: 'inline-block',
                                            padding: '4px 12px', 
                                            borderRadius: '16px', 
                                            fontSize: '10px', 
                                            fontWeight: 800,
                                            textTransform: 'uppercase',
                                            backgroundColor: isOutOfStock ? '#FEE2E2' : (isLowStock ? '#FEF3C7' : '#D1FAE5'),
                                            color: isOutOfStock ? '#EF4444' : (isLowStock ? '#F59E0B' : '#10B981'),
                                        }}>
                                            {isOutOfStock ? 'Out of Stock' : (isLowStock ? 'Low Stock' : 'In Stock')}
                                        </span>
                                    </td>
                                    {canManageInventory && (
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                                <button onClick={() => updateProduct(product.id, { stock: 0 })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F59E0B' }} title="Mark Out of Stock">
                                                    <AlertTriangle size={14} />
                                                </button>
                                                <button onClick={() => setAdjustStockProduct(product)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#10B981' }} title="Adjust Stock">
                                                    <Layers size={14} />
                                                </button>
                                                <button onClick={() => openEditModal(product)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)' }} title="Edit Product">
                                                    <Edit2 size={14} />
                                                </button>
                                                <button onClick={() => promptDelete(product.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444' }} title="Delete">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)' }}>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                        Showing {filteredAndSortedProducts.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} to {Math.min(currentPage * itemsPerPage, filteredAndSortedProducts.length)} of {filteredAndSortedProducts.length}
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            style={{ padding: '6px 12px', borderRadius: '6px', background: '#ffffff', border: '1px solid var(--color-border)', color: currentPage === 1 ? 'var(--color-text-muted)' : 'var(--color-text-main)', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                        >
                            Previous
                        </button>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredAndSortedProducts.length / itemsPerPage), p + 1))}
                            disabled={currentPage >= Math.ceil(filteredAndSortedProducts.length / itemsPerPage) || filteredAndSortedProducts.length === 0}
                            style={{ padding: '6px 12px', borderRadius: '6px', background: '#ffffff', border: '1px solid var(--color-border)', color: currentPage >= Math.ceil(filteredAndSortedProducts.length / itemsPerPage) || filteredAndSortedProducts.length === 0 ? 'var(--color-text-muted)' : 'var(--color-text-main)', cursor: currentPage >= Math.ceil(filteredAndSortedProducts.length / itemsPerPage) || filteredAndSortedProducts.length === 0 ? 'not-allowed' : 'pointer' }}
                        >
                            Next
                        </button>
                    </div>
                </div>
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
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>SKU</label>
                                        <input 
                                            className="search-input" 
                                            style={{ width: '100%' }} 
                                            placeholder="e.g. SKU-12345" 
                                            value={formData.sku || ''} 
                                            onChange={e => setFormData({ ...formData, sku: e.target.value })} 
                                        />
                                    </div>
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
                                                
                                                const matches = products.filter(p => (p.name || '').trim().toLowerCase() === normalizedNewName);
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
                                        {formErrors.name && <p style={{ color: '#EF4444', fontSize: '11px', marginTop: '4px' }}>{formErrors.name}</p>}
                                        <datalist id="product-names">
                                            {Array.from(new Set(products.map(p => p.name))).sort().map(name => (
                                                <option key={name} value={name} />
                                            ))}
                                        </datalist>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Category</label>
                                        <select className="search-input" style={{ width: '100%' }} value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value as any })}>
                                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Low Stock Alert</label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '42px', padding: '0 12px', background: 'var(--color-bg)', borderRadius: '8px', border: '1px solid var(--color-border)', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={formData.lowStockAlert} onChange={e => setFormData({ ...formData, lowStockAlert: e.target.checked })} style={{ width: '16px', height: '16px' }} />
                                            <span style={{ fontSize: '14px', color: 'var(--color-text-main)' }}>Enable alerts for this product</span>
                                        </label>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Supplier</label>
                                        <select className="search-input" style={{ width: '100%' }} value={formData.supplier || ''} onChange={e => setFormData({ ...formData, supplier: e.target.value })}>
                                            <option value="">Select Supplier</option>
                                            {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    <div></div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Cost Price ($)</label>
                                        <input className="search-input" type="number" style={{ width: '100%', borderColor: formErrors.purchaseCost ? '#EF4444' : undefined }} placeholder="0.00" value={formData.purchaseCost} onChange={e => setFormData({ ...formData, purchaseCost: e.target.value === '' ? '' : Number(e.target.value) })} />
                                        {formErrors.purchaseCost && <p style={{ color: '#EF4444', fontSize: '11px', marginTop: '4px' }}>{formErrors.purchaseCost}</p>}
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Selling Price ($) *</label>
                                        <input className="search-input" type="number" style={{ width: '100%', borderColor: formErrors.price ? '#EF4444' : undefined }} placeholder="0.00" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value === '' ? '' : Number(e.target.value) })} />
                                        {formErrors.price && <p style={{ color: '#EF4444', fontSize: '11px', marginTop: '4px' }}>{formErrors.price}</p>}
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Unit of Measure</label>
                                        <select className="search-input" style={{ width: '100%' }} value={formData.unitOfMeasure} onChange={e => setFormData({ ...formData, unitOfMeasure: e.target.value })}>
                                            <option value="PCS">PCS</option>
                                            <option value="BOX">BOX</option>
                                            <option value="KG">KG</option>
                                            <option value="LITER">LITER</option>
                                            <option value="METER">METER</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Reorder Level</label>
                                        <input className="search-input" type="number" min="0" style={{ width: '100%' }} placeholder="e.g. 5" value={formData.reorderLevel} onChange={e => setFormData({ ...formData, reorderLevel: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} disabled={!formData.lowStockAlert} />
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
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
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
                                        const pid = addStockProduct.id;
                                        await addStock(pid, Number(addStockAmount), Number(addStockCost) || 0);
                                                    showToast(`Added ${addStockAmount} stock to ${addStockProduct.name}`, 'success');
                                        setAddStockProduct(null);
                                        setRecentlyUpdatedId(pid);
                                        setTimeout(() => setRecentlyUpdatedId(null), 2000);
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
                                        const pid = addStockProduct.id;
                                        await addStock(pid, Number(addStockAmount), Number(addStockCost) || 0);
                                        showToast(`Added ${addStockAmount} stock to ${addStockProduct.name}`, 'success');
                                        setAddStockProduct(null);
                                        setRecentlyUpdatedId(pid);
                                        setTimeout(() => setRecentlyUpdatedId(null), 2000);
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


            {/* Adjust Stock Modal */}
            {
                adjustStockProduct && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                    }}>
                        <div className="glass-panel" style={{ width: '400px', padding: '32px', animation: 'slideIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                <div>
                                    <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Adjust Stock</h3>
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', marginTop: '4px' }}>
                                        {adjustStockProduct.name} - Current Stock: <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{adjustStockProduct.stock}</span>
                                    </p>
                                </div>
                                <button onClick={() => setAdjustStockProduct(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', height: 'fit-content' }}><X size={24} /></button>
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-main)', fontWeight: 500 }}>New Stock Quantity</label>
                                        <input
                                            className="search-input"
                                            type="number"
                                            style={{ width: '100%', fontSize: '16px', padding: '12px' }}
                                            placeholder="e.g. 50"
                                            autoFocus
                                            value={adjustStockAmount}
                                            onChange={e => setAdjustStockAmount(e.target.value === '' ? '' : Number(e.target.value))}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-main)', fontWeight: 500 }}>Reason for Adjustment</label>
                                        <input
                                            className="search-input"
                                            type="text"
                                            style={{ width: '100%', fontSize: '14px', padding: '12px' }}
                                            placeholder="e.g. Damaged goods, recount, etc."
                                            value={adjustStockReason}
                                            onChange={e => setAdjustStockReason(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button onClick={() => setAdjustStockProduct(null)} style={{ padding: '10px 20px', borderRadius: '8px', backgroundColor: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Cancel</button>
                                <button
                                    onClick={async () => {
                                        if (adjustStockAmount === '' || Number(adjustStockAmount) < 0) {
                                            showToast('Please enter a valid stock amount', 'error');
                                            return;
                                        }
                                        const pid = adjustStockProduct.id;
                                        await adjustStock(pid, Number(adjustStockAmount), adjustStockReason);
                                        showToast(`Adjusted stock for ${adjustStockProduct.name}`, 'success');
                                        setAdjustStockProduct(null);
                                        setRecentlyUpdatedId(pid);
                                        setTimeout(() => setRecentlyUpdatedId(null), 2000);
                                    }}
                                    className="primary-button"
                                    style={{ padding: '10px 24px' }}
                                    disabled={adjustStockAmount === '' || Number(adjustStockAmount) < 0}
                                >
                                    Confirm Adjustment
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
