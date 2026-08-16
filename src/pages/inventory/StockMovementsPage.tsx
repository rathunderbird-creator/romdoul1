import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeftRight, Search, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Download, PackagePlus, PackageMinus, Activity, Trash2, RefreshCw, X, Package, FileText, User, Warehouse as WarehouseIcon, ChevronDown, Table2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';
import { supabase } from '../../lib/supabase';
import DateRangePicker from '../../components/DateRangePicker';
import { StatsCard } from '../../components';

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

interface StockMovement {
    id: string;
    product_id: string;
    product_name: string;
    type: 'in' | 'out';
    quantity: number;
    unit_price: number;
    source: string;
    reason: string;
    reference_id: string;
    note: string;
    shipping_co: string;
    customer_name: string;
    customer_phone: string;
    movement_date: string;
    warehouse_id: string;
    created_at: string;
    created_by: string;
    supplier: string;
}

// One row of the "Show Movements" summary (Excel-style stock recap).
interface MovementSummaryRow {
    id: string;
    name: string;
    oldStock: number;
    sold: number;
    ret: number;
    buy: number;
    newStock: number;
}

const StockMovementsPage: React.FC = () => {
    const { warehouses, products, updateProduct, currentUser } = useStore();
    const isAdmin = currentUser?.roleId === 'admin';
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const isMobile = useMobile();

    const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
    const [movements, setMovements] = useState<StockMovement[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [detailRecord, setDetailRecord] = useState<StockMovement | null>(null);

    const [dateRange, setDateRange] = useState(() => {
        const saved = localStorage.getItem('stock_movements_dateRange');
        return saved ? JSON.parse(saved) : { start: '', end: '' };
    });
    const [searchTerm, setSearchTerm] = useState(() => {
        return localStorage.getItem('stock_movements_searchTerm') || '';
    });
    const [typeFilter, setTypeFilter] = useState<'all' | 'in' | 'out'>(() => {
        return (localStorage.getItem('stock_movements_typeFilter') as any) || 'all';
    });
    const [warehouseFilter, setWarehouseFilter] = useState<string>(() => {
        return localStorage.getItem('stock_movements_warehouseFilter') || 'all';
    });
    
    // Sorting state. Always open newest-first — a persisted sort (e.g. an old
    // ascending click restored from localStorage) buried the latest entries.
    // Column sorting still works for the current visit.
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(
        { key: 'movement_date', direction: 'desc' }
    );

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(() => {
        return Number(localStorage.getItem('stock_movements_itemsPerPage')) || 100;
    });

    useEffect(() => {
        localStorage.setItem('stock_movements_dateRange', JSON.stringify(dateRange));
        localStorage.setItem('stock_movements_searchTerm', searchTerm);
        localStorage.setItem('stock_movements_typeFilter', typeFilter);
        localStorage.setItem('stock_movements_warehouseFilter', warehouseFilter);
        localStorage.setItem('stock_movements_itemsPerPage', itemsPerPage.toString());
    }, [dateRange, searchTerm, typeFilter, warehouseFilter, itemsPerPage]);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ArrowLeftRight size={16} /> Stock Movements
                    </h1>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const fetchMovements = async () => {
        setIsLoading(true);
        try {
            let query = supabase.from('stock_movements').select('*').order('created_at', { ascending: false });
            
            if (dateRange.start) {
                query = query.gte('movement_date', dateRange.start);
            }
            if (dateRange.end) {
                query = query.lte('movement_date', dateRange.end);
            }
            if (typeFilter !== 'all') {
                query = query.eq('type', typeFilter);
            }
            if (warehouseFilter !== 'all') {
                query = query.eq('warehouse_id', warehouseFilter);
            }

            const { data, error } = await query;
            if (error) throw error;
            if (data) setMovements(data as StockMovement[]);
        } catch (error: any) {
            console.error('Error fetching stock movements:', error);
            showToast('Failed to fetch stock movements', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchMovements();
    }, [dateRange, typeFilter, warehouseFilter]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, itemsPerPage]);


    const filteredMovements = useMemo(() => {
        if (!searchTerm) return movements;
        const q = searchTerm.toLowerCase();
        return movements.filter(m => 
            (m.product_name || '').toLowerCase().includes(q) ||
            (m.source || '').toLowerCase().includes(q) ||
            (m.reason || '').toLowerCase().includes(q) ||
            (m.reference_id || '').toLowerCase().includes(q) ||
            (m.note || '').toLowerCase().includes(q) ||
            (m.customer_name || '').toLowerCase().includes(q) ||
            (m.supplier || '').toLowerCase().includes(q)
        );
    }, [movements, searchTerm]);

    const sortedMovements = useMemo(() => {
        let sortableItems = [...filteredMovements];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                let aValue: any = a[sortConfig.key as keyof StockMovement];
                let bValue: any = b[sortConfig.key as keyof StockMovement];
                
                if (sortConfig.key === 'movement_date') {
                    // movement_date is a plain date, so entries from the same day tie —
                    // break the tie with created_at so the latest transaction stays on top.
                    const aDay = new Date(a.movement_date || a.created_at).getTime();
                    const bDay = new Date(b.movement_date || b.created_at).getTime();
                    if (aDay !== bDay) return sortConfig.direction === 'asc' ? aDay - bDay : bDay - aDay;
                    const aCreated = new Date(a.created_at).getTime();
                    const bCreated = new Date(b.created_at).getTime();
                    return sortConfig.direction === 'asc' ? aCreated - bCreated : bCreated - aCreated;
                } else if (sortConfig.key === 'source') {
                    aValue = a.type === 'in' ? a.source : a.reason;
                    bValue = b.type === 'in' ? b.source : b.reason;
                } else if (sortConfig.key === 'supplier') {
                    aValue = a.supplier || a.customer_name;
                    bValue = b.supplier || b.customer_name;
                } else if (sortConfig.key === 'reference_id') {
                    aValue = a.reference_id || a.note;
                    bValue = b.reference_id || b.note;
                } else if (sortConfig.key === 'warehouse_id') {
                    aValue = warehouses.find(w => w.id === a.warehouse_id)?.name || '';
                    bValue = warehouses.find(w => w.id === b.warehouse_id)?.name || '';
                } else if (sortConfig.key === 'value') {
                    aValue = a.quantity * (a.unit_price || 0);
                    bValue = b.quantity * (b.unit_price || 0);
                }
                
                if (aValue == null) aValue = '';
                if (bValue == null) bValue = '';
                
                if (typeof aValue === 'string') aValue = aValue.toLowerCase();
                if (typeof bValue === 'string') bValue = bValue.toLowerCase();
                
                if (aValue < bValue) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [filteredMovements, sortConfig, warehouses]);

    const stats = useMemo(() => {
        let totalIn = 0;
        let totalOut = 0;
        let valueIn = 0;
        let valueOut = 0;
        filteredMovements.forEach(m => {
            const val = m.quantity * (m.unit_price || 0);
            if (m.type === 'in') {
                totalIn += m.quantity;
                valueIn += val;
            }
            if (m.type === 'out') {
                totalOut += m.quantity;
                valueOut += val;
            }
        });
        return {
            totalMovements: filteredMovements.length,
            totalIn,
            totalOut,
            netChange: totalIn - totalOut,
            valueIn,
            valueOut,
        };
    }, [filteredMovements]);

    // Page-level totals for the table footer
    const pageTotals = useMemo(() => {
        let qtyIn = 0, qtyOut = 0, valIn = 0, valOut = 0;
        paginatedMovementsCalc().forEach(m => {
            const val = m.quantity * (m.unit_price || 0);
            if (m.type === 'in') { qtyIn += m.quantity; valIn += val; }
            else { qtyOut += m.quantity; valOut += val; }
        });
        return { qtyIn, qtyOut, valIn, valOut };

        function paginatedMovementsCalc() {
            return sortedMovements.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
        }
    }, [sortedMovements, currentPage, itemsPerPage]);

    const totalPages = Math.ceil(sortedMovements.length / itemsPerPage);
    const paginatedMovements = sortedMovements.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedRecordIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedRecordIds(newSet);
    };

    const toggleAll = () => {
        if (selectedRecordIds.size === paginatedMovements.length && paginatedMovements.length > 0) {
            setSelectedRecordIds(new Set());
        } else {
            setSelectedRecordIds(new Set(paginatedMovements.map(r => r.id)));
        }
    };

    const handleBulkDelete = async () => {
        // Reverting inventory is not idempotent, so a second click while the first pass
        // is still running would revert the same movements twice.
        if (isLoading) return;
        if (!confirm(`Are you sure you want to delete ${selectedRecordIds.size} stock movement records? This will revert the inventory for these items.`)) return;

        setIsLoading(true);
        try {
            const recordsToDelete = movements.filter(r => selectedRecordIds.has(r.id));

            // Total the reversals per product before writing anything.
            //
            // The previous version updated inside the loop using `product.stock` from
            // React state, which doesn't change between iterations. Deleting two
            // movements for the same product therefore computed both new totals from
            // the same starting figure, and the second write overwrote the first —
            // so only one of the two was ever reverted.
            const productDeltas = new Map<string, number>();
            const warehouseDeltas = new Map<string, number>();

            for (const record of recordsToDelete) {
                const adjustment = record.type === 'in' ? -record.quantity : record.quantity;
                productDeltas.set(record.product_id, (productDeltas.get(record.product_id) || 0) + adjustment);
                if (record.warehouse_id) {
                    const key = `${record.warehouse_id}|${record.product_id}`;
                    warehouseDeltas.set(key, (warehouseDeltas.get(key) || 0) + adjustment);
                }
            }

            for (const [productId, delta] of productDeltas) {
                // Read the live figure rather than trusting cached state, which may be
                // stale if another device changed stock while this page was open.
                const { data: fresh, error: freshError } = await supabase
                    .from('products').select('stock').eq('id', productId).single();
                if (freshError || !fresh) {
                    console.error('Could not read current stock for', productId, freshError?.message);
                    continue;
                }
                const next = fresh.stock + delta;
                if (next < 0) {
                    console.warn(`Reverting movements for ${productId} would give ${next}; clamped to 0.`);
                }
                await updateProduct(productId, { stock: Math.max(0, next) });
            }

            for (const [key, delta] of warehouseDeltas) {
                const [warehouseId, productId] = key.split('|');
                const { data: ws } = await supabase.from('warehouse_stock')
                    .select('id, quantity').eq('warehouse_id', warehouseId).eq('product_id', productId).single();
                if (ws) {
                    await supabase.from('warehouse_stock')
                        .update({ quantity: Math.max(0, ws.quantity + delta) }).eq('id', ws.id);
                }
            }

            const { error } = await supabase.from('stock_movements').delete().in('id', Array.from(selectedRecordIds));
            if (error) throw error;

            setMovements(prev => prev.filter(r => !selectedRecordIds.has(r.id)));
            setSelectedRecordIds(new Set());
            showToast(`Successfully deleted ${selectedRecordIds.size} records`, 'success');
        } catch (err: any) {
            showToast('Failed to delete records: ' + err.message, 'error');
            fetchMovements();
        } finally {
            setIsLoading(false);
        }
    };

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const exportToExcel = () => {
        if (filteredMovements.length === 0) {
            showToast('No records to export', 'error');
            return;
        }
        
        const exportData = filteredMovements.map(m => ({
            'Date': m.movement_date,
            'Type': m.type.toUpperCase(),
            'Product': m.product_name,
            'Quantity': m.quantity,
            'Unit Price': m.unit_price,
            'Total Value': m.quantity * (m.unit_price || 0),
            'Warehouse': warehouses.find(w => w.id === m.warehouse_id)?.name || '-',
            'Source/Reason': m.type === 'in' ? m.source : m.reason,
            'Supplier': m.supplier || '-',
            'Customer': m.customer_name || '-',
            'Phone': m.customer_phone || '-',
            'Shipping Co': m.shipping_co || '-',
            'Reference': m.reference_id || '-',
            'Note': m.note || '-'
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Stock Movements');
        XLSX.writeFile(wb, `Stock_Movements_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    // --- "Show Movements" summary (Excel-style recap per product) ---
    const [isSummaryOpen, setIsSummaryOpen] = useState(false);
    const [isSummaryLoading, setIsSummaryLoading] = useState(false);
    const [summaryRows, setSummaryRows] = useState<MovementSummaryRow[]>([]);
    // The popup has its own date range (seeded from the page filter on open),
    // so the period can be changed without leaving the popup.
    const [summaryDateRange, setSummaryDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
    // Table controls: hide zero-movement rows, sortable columns.
    const [summaryOnlyMovement, setSummaryOnlyMovement] = useState(false);
    const [summarySort, setSummarySort] = useState<{ key: keyof MovementSummaryRow; direction: 'asc' | 'desc' } | null>(null);

    const fetchSummary = async (range: { start: string; end: string }) => {
        setIsSummaryLoading(true);
        try {
            // Fetched separately so the page's In/Out type filter can't skew the
            // recap — only the date range and warehouse filters apply here.
            let query = supabase.from('stock_movements').select('product_id, product_name, type, quantity, source');
            if (range.start) query = query.gte('movement_date', range.start);
            if (range.end) query = query.lte('movement_date', range.end);
            if (warehouseFilter !== 'all') query = query.eq('warehouse_id', warehouseFilter);
            const { data, error } = await query;
            if (error) throw error;

            const byProduct = new Map<string, { sold: number; ret: number; buy: number; name: string }>();
            for (const m of (data || []) as any[]) {
                const key = m.product_id || m.product_name || '?';
                const agg = byProduct.get(key) || { sold: 0, ret: 0, buy: 0, name: m.product_name || 'Unknown' };
                if (m.type === 'out') agg.sold += m.quantity || 0;
                else if (m.source === 'Customer Return') agg.ret += m.quantity || 0;
                else agg.buy += m.quantity || 0; // PO receipts + other stock-ins
                byProduct.set(key, agg);
            }

            // New Stock = current stock; Old Stock is back-calculated so every row
            // satisfies: New = Old + Buy + Return - Sold.
            const rows: MovementSummaryRow[] = products.map(p => {
                const agg = byProduct.get(p.id) || { sold: 0, ret: 0, buy: 0, name: p.name };
                byProduct.delete(p.id);
                const newStock = p.stock || 0;
                return {
                    id: p.id,
                    name: p.name,
                    oldStock: newStock - agg.buy - agg.ret + agg.sold,
                    sold: agg.sold,
                    ret: agg.ret,
                    buy: agg.buy,
                    newStock
                };
            });
            // Movements whose product was deleted still show up, with zero current stock.
            for (const [key, agg] of byProduct) {
                rows.push({ id: key, name: agg.name, oldStock: agg.sold - agg.buy - agg.ret, sold: agg.sold, ret: agg.ret, buy: agg.buy, newStock: 0 });
            }
            setSummaryRows(rows);
        } catch (e: any) {
            console.error('Failed to build movement summary:', e);
            showToast('Failed to build summary: ' + e.message, 'error');
        } finally {
            setIsSummaryLoading(false);
        }
    };

    const openSummary = () => {
        setSummaryDateRange(dateRange);
        setIsSummaryOpen(true);
        fetchSummary(dateRange);
    };

    const summaryHasMovement = (r: MovementSummaryRow) => r.sold > 0 || r.ret > 0 || r.buy > 0;
    const summaryMovementCount = useMemo(() => summaryRows.filter(summaryHasMovement).length, [summaryRows]);

    const displayedSummaryRows = useMemo(() => {
        let rows = summaryOnlyMovement ? summaryRows.filter(summaryHasMovement) : summaryRows;
        if (summarySort) {
            const { key, direction } = summarySort;
            rows = [...rows].sort((a, b) => {
                const av = a[key], bv = b[key];
                const cmp = typeof av === 'string' || typeof bv === 'string'
                    ? String(av).localeCompare(String(bv))
                    : (av as number) - (bv as number);
                return direction === 'asc' ? cmp : -cmp;
            });
        }
        return rows;
    }, [summaryRows, summaryOnlyMovement, summarySort]);

    // Footer totals always match what's on screen (and what exports).
    const summaryTotals = useMemo(() => displayedSummaryRows.reduce(
        (acc, r) => ({
            oldStock: acc.oldStock + r.oldStock,
            sold: acc.sold + r.sold,
            ret: acc.ret + r.ret,
            buy: acc.buy + r.buy,
            newStock: acc.newStock + r.newStock
        }),
        { oldStock: 0, sold: 0, ret: 0, buy: 0, newStock: 0 }
    ), [displayedSummaryRows]);

    const exportSummary = () => {
        if (displayedSummaryRows.length === 0) return;
        const exportData = displayedSummaryRows.map(r => ({
            'Model': r.name, 'Old Stock': r.oldStock, 'Sold': r.sold,
            'Return': r.ret, 'Buy': r.buy, 'New Stock': r.newStock
        }));
        exportData.push({ 'Model': 'Total', 'Old Stock': summaryTotals.oldStock, 'Sold': summaryTotals.sold, 'Return': summaryTotals.ret, 'Buy': summaryTotals.buy, 'New Stock': summaryTotals.newStock });
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Movement Summary');
        XLSX.writeFile(wb, `Movement_Summary_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const summaryRangeLabel = summaryDateRange.start || summaryDateRange.end
        ? `${summaryDateRange.start || '…'} → ${summaryDateRange.end || '…'}`
        : 'All time';

    const clearFilters = () => {
        setDateRange({ start: '', end: '' });
        setSearchTerm('');
        setTypeFilter('all');
        setWarehouseFilter('all');
    };

    const hasActiveFilters = dateRange.start || dateRange.end || searchTerm || typeFilter !== 'all' || warehouseFilter !== 'all';

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
    };

    const formatDateTime = (dateStr: string) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    };

    const sortArrow = (key: string) => sortConfig?.key === key ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

    const thStyle: React.CSSProperties = {
        padding: '12px 14px',
        textAlign: 'left',
        fontSize: '11px',
        fontWeight: 700,
        color: 'var(--color-text-secondary)',
        cursor: 'pointer',
        userSelect: 'none',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        whiteSpace: 'nowrap',
    };

    const segmentBtnStyle = (active: boolean, color?: string): React.CSSProperties => ({
        padding: '7px 16px',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: active ? 600 : 500,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        border: active ? 'none' : '1px solid var(--color-border)',
        background: active ? (color || 'var(--color-primary)') : 'transparent',
        color: active ? '#FFF' : 'var(--color-text-secondary)',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
    });

    return (
        <div style={{ padding: isMobile ? '12px' : '24px' }}>
            <div className="fade-in">
                {/* Summary Stats Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                    <StatsCard 
                        title="Total Records" 
                        value={stats.totalMovements.toLocaleString()} 
                        icon={Activity} 
                        color="#6366f1"
                        bgColor="rgba(99, 102, 241, 0.1)"
                    />
                    <StatsCard 
                        title="Qty In" 
                        value={`+${stats.totalIn.toLocaleString()}`} 
                        icon={PackagePlus} 
                        color="#10B981"
                        bgColor="rgba(16, 185, 129, 0.1)"
                        trend={<span style={{ color: '#10B981' }}>{formatCurrency(stats.valueIn)}</span>}
                    />
                    <StatsCard 
                        title="Qty Out" 
                        value={`-${stats.totalOut.toLocaleString()}`} 
                        icon={PackageMinus} 
                        color="#EF4444"
                        bgColor="rgba(239, 68, 68, 0.1)"
                        trend={<span style={{ color: '#EF4444' }}>{formatCurrency(stats.valueOut)}</span>}
                    />
                    <StatsCard 
                        title="Net Change" 
                        value={`${stats.netChange > 0 ? '+' : ''}${stats.netChange.toLocaleString()}`} 
                        icon={ArrowLeftRight} 
                        color={stats.netChange > 0 ? '#10B981' : stats.netChange < 0 ? '#EF4444' : 'var(--color-text-secondary)'}
                        bgColor={stats.netChange > 0 ? 'rgba(16, 185, 129, 0.1)' : stats.netChange < 0 ? 'rgba(239, 68, 68, 0.1)' : 'var(--color-bg)'}
                        trend={<span>Net value: {formatCurrency(stats.valueIn - stats.valueOut)}</span>}
                    />
                </div>

                {/* Toolbar */}
                <div style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '14px',
                    padding: '16px 20px',
                    marginBottom: '20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '14px',
                }}>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
                        {/* Search */}
                        <div style={{ position: 'relative', width: isMobile ? '100%' : '280px' }}>
                            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                            <input
                                type="text"
                                placeholder="Search product, supplier..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '9px 14px 9px 36px',
                                    borderRadius: '10px',
                                    border: '1px solid var(--color-border)',
                                    fontSize: '13px',
                                    outline: 'none',
                                    background: 'var(--color-bg)',
                                    color: 'var(--color-text)',
                                    transition: 'border-color 0.2s',
                                }}
                            />
                        </div>
                        
                        {/* Type Filter - Segmented Control */}
                        <div style={{ display: 'flex', gap: '4px', background: 'var(--color-bg)', borderRadius: '10px', padding: '3px', border: '1px solid var(--color-border)' }}>
                            <button onClick={() => setTypeFilter('all')} style={segmentBtnStyle(typeFilter === 'all', '#6366f1')}>All</button>
                            <button onClick={() => setTypeFilter('in')} style={segmentBtnStyle(typeFilter === 'in', '#10B981')}>
                                <TrendingUp size={14} /> In
                            </button>
                            <button onClick={() => setTypeFilter('out')} style={segmentBtnStyle(typeFilter === 'out', '#EF4444')}>
                                <TrendingDown size={14} /> Out
                            </button>
                        </div>

                        {/* Warehouse Filter */}
                        {warehouses.length > 0 && (
                            <div style={{ position: 'relative' }}>
                                <select
                                    value={warehouseFilter}
                                    onChange={(e) => setWarehouseFilter(e.target.value)}
                                    style={{
                                        padding: '9px 32px 9px 12px',
                                        borderRadius: '10px',
                                        border: '1px solid var(--color-border)',
                                        fontSize: '13px',
                                        outline: 'none',
                                        background: 'var(--color-bg)',
                                        color: 'var(--color-text)',
                                        cursor: 'pointer',
                                        appearance: 'none',
                                        fontWeight: 500,
                                    }}
                                >
                                    <option value="all">All Warehouses</option>
                                    {warehouses.map(w => (
                                        <option key={w.id} value={w.id}>{w.name}</option>
                                    ))}
                                </select>
                                <ChevronDown size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--color-text-muted)' }} />
                            </div>
                        )}

                        {/* Date Range */}
                        <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '3px' }}>
                            <DateRangePicker value={dateRange} onChange={setDateRange} />
                        </div>
                        
                        {hasActiveFilters && (
                            <button onClick={clearFilters} style={{
                                padding: '8px 12px',
                                borderRadius: '8px',
                                fontSize: '13px',
                                color: '#EF4444',
                                background: 'rgba(239, 68, 68, 0.06)',
                                border: '1px solid rgba(239, 68, 68, 0.15)',
                                cursor: 'pointer',
                                fontWeight: 500,
                                transition: 'all 0.2s',
                            }}>
                                Clear Filters
                            </button>
                        )}
                    </div>
                    
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button onClick={openSummary} style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '9px 14px', borderRadius: '10px',
                            border: 'none',
                            background: 'linear-gradient(135deg, #3B82F6, #2563EB)', color: 'white',
                            fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
                            transition: 'all 0.2s',
                        }}>
                            <Table2 size={14} /> Show Movements
                        </button>
                        <button onClick={fetchMovements} style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '9px 14px', borderRadius: '10px',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-bg)', color: 'var(--color-text)',
                            fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}>
                            <RefreshCw size={14} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} /> Refresh
                        </button>
                        <button onClick={exportToExcel} style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '9px 14px', borderRadius: '10px',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-bg)', color: 'var(--color-text)',
                            fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}>
                            <Download size={14} /> Export
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div style={{ overflowX: 'auto', background: 'var(--color-surface)', borderRadius: '16px', border: '1px solid var(--color-border)' }}>
                    {isLoading ? (
                        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                            <RefreshCw size={32} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 16px', display: 'block', opacity: 0.4 }} />
                            <p style={{ fontSize: '14px' }}>Loading movements...</p>
                        </div>
                    ) : paginatedMovements.length === 0 ? (
                        <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                            <ArrowLeftRight size={48} style={{ opacity: 0.15, marginBottom: '16px', margin: '0 auto 16px', display: 'block' }} />
                            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>No movements found</h3>
                            <p style={{ fontSize: '14px', opacity: 0.7 }}>Adjust your filters or date range.</p>
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1100px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                    <th style={{ width: '40px', padding: '12px 14px', textAlign: 'center' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={paginatedMovements.length > 0 && selectedRecordIds.size === paginatedMovements.length} 
                                            onChange={toggleAll}
                                            style={{ cursor: 'pointer', accentColor: '#6366f1' }}
                                        />
                                    </th>
                                    <th onClick={() => handleSort('movement_date')} style={thStyle}>Date{sortArrow('movement_date')}</th>
                                    <th onClick={() => handleSort('type')} style={{ ...thStyle, textAlign: 'center' }}>Type{sortArrow('type')}</th>
                                    <th onClick={() => handleSort('product_name')} style={thStyle}>Product{sortArrow('product_name')}</th>
                                    <th onClick={() => handleSort('quantity')} style={{ ...thStyle, textAlign: 'center' }}>Qty{sortArrow('quantity')}</th>
                                    <th onClick={() => handleSort('value')} style={{ ...thStyle, textAlign: 'right' }}>Value{sortArrow('value')}</th>
                                    <th onClick={() => handleSort('warehouse_id')} style={thStyle}>Warehouse{sortArrow('warehouse_id')}</th>
                                    <th onClick={() => handleSort('source')} style={thStyle}>Source / Reason{sortArrow('source')}</th>
                                    <th onClick={() => handleSort('supplier')} style={thStyle}>Supplier / Customer{sortArrow('supplier')}</th>
                                    <th onClick={() => handleSort('reference_id')} style={thStyle}>Reference / Note{sortArrow('reference_id')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedMovements.map((record, idx) => {
                                    const warehouse = warehouses.find(w => w.id === record.warehouse_id);
                                    const isSelected = selectedRecordIds.has(record.id);
                                    const rowValue = record.quantity * (record.unit_price || 0);
                                    const accentColor = record.type === 'in' ? '#10B981' : '#EF4444';
                                    
                                    return (
                                        <tr
                                            key={record.id}
                                            onClick={() => setDetailRecord(record)}
                                            style={{
                                                borderBottom: '1px solid var(--color-border)',
                                                cursor: 'pointer',
                                                transition: 'background-color 0.15s ease',
                                                background: isSelected
                                                    ? 'rgba(99, 102, 241, 0.06)'
                                                    : idx % 2 === 1
                                                        ? 'rgba(0,0,0,0.015)'
                                                        : undefined,
                                                borderLeft: `3px solid ${accentColor}`,
                                            }}
                                            onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(99, 102, 241, 0.04)'; }}
                                            onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : ''; }}
                                        >
                                            <td style={{ padding: '11px 14px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={isSelected} 
                                                    onChange={() => toggleSelection(record.id)}
                                                    style={{ cursor: 'pointer', accentColor: '#6366f1' }}
                                                />
                                            </td>
                                            <td style={{ padding: '11px 14px', fontSize: '13px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                                                {formatDate(record.movement_date || record.created_at)}
                                            </td>
                                            <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                                                {record.type === 'in' ? (
                                                    <span style={{ padding: '4px 10px', borderRadius: '20px', background: 'rgba(16, 185, 129, 0.1)', color: '#10B981', fontSize: '11px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase' }}>
                                                        <TrendingUp size={11} /> In
                                                    </span>
                                                ) : (
                                                    <span style={{ padding: '4px 10px', borderRadius: '20px', background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', fontSize: '11px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase' }}>
                                                        <TrendingDown size={11} /> Out
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '11px 14px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {record.product_name}
                                            </td>
                                            <td style={{ padding: '11px 14px', textAlign: 'center', fontSize: '13px', fontWeight: 700, color: accentColor, fontVariantNumeric: 'tabular-nums' }}>
                                                {record.type === 'in' ? '+' : '-'}{record.quantity}
                                            </td>
                                            <td style={{ padding: '11px 14px', textAlign: 'right', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                                {rowValue > 0 ? formatCurrency(rowValue) : <span style={{ color: 'var(--color-text-muted)' }}>-</span>}
                                            </td>
                                            <td style={{ padding: '11px 14px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                {warehouse?.name || <span style={{ color: 'var(--color-text-muted)' }}>-</span>}
                                            </td>
                                            <td style={{ padding: '11px 14px', fontSize: '13px', color: 'var(--color-text)' }}>
                                                {record.type === 'in' ? record.source : record.reason || <span style={{ color: 'var(--color-text-muted)' }}>-</span>}
                                            </td>
                                            <td style={{ padding: '11px 14px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                {record.supplier || record.customer_name || <span style={{ color: 'var(--color-text-muted)' }}>-</span>}
                                            </td>
                                            <td style={{ padding: '11px 14px', fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{record.reference_id || record.note || '-'}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            {/* Totals Footer */}
                            <tfoot>
                                <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-bg)', fontWeight: 700 }}>
                                    <td colSpan={4} style={{ padding: '12px 14px', fontSize: '12px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        Page Totals
                                    </td>
                                    <td style={{ padding: '12px 14px', textAlign: 'center', fontSize: '13px' }}>
                                        <span style={{ color: '#10B981' }}>+{pageTotals.qtyIn}</span>
                                        {' / '}
                                        <span style={{ color: '#EF4444' }}>-{pageTotals.qtyOut}</span>
                                    </td>
                                    <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: '13px' }}>
                                        <div style={{ color: '#10B981', fontSize: '12px' }}>{formatCurrency(pageTotals.valIn)}</div>
                                        <div style={{ color: '#EF4444', fontSize: '12px' }}>{formatCurrency(pageTotals.valOut)}</div>
                                    </td>
                                    <td colSpan={4}></td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>

                {/* Pagination Controls */}
                {filteredMovements.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', flexWrap: 'wrap', gap: '12px' }}>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                            Showing {Math.min((currentPage - 1) * itemsPerPage + 1, filteredMovements.length)} to {Math.min(currentPage * itemsPerPage, filteredMovements.length)} of {filteredMovements.length} entries
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Show:</span>
                                <select 
                                    value={itemsPerPage} 
                                    onChange={(e) => setItemsPerPage(Number(e.target.value))}
                                    style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '12px', outline: 'none', cursor: 'pointer', background: 'var(--color-surface)' }}
                                >
                                    {[50, 100, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    style={{ padding: '6px', opacity: currentPage === 1 ? 0.4 : 1, border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text)' }}
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', margin: '0 8px' }}>
                                    Page <span style={{ color: 'var(--color-text-main)', fontWeight: 700 }}>{currentPage}</span> of {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    style={{ padding: '6px', opacity: currentPage === totalPages ? 0.4 : 1, border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text)' }}
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom Floating Actions */}
            {isAdmin && selectedRecordIds.size > 0 && (
                <div style={{
                    position: 'fixed',
                    bottom: '24px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'var(--color-surface, white)',
                    padding: '12px 24px',
                    borderRadius: '16px',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                    border: '1px solid var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    zIndex: 1000,
                    animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)', borderRight: '1px solid var(--color-border)', paddingRight: '16px' }}>
                        {selectedRecordIds.size} Selected
                    </div>
                    <button type="button" onClick={handleBulkDelete} disabled={isLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: '8px', border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer', opacity: isLoading ? 0.6 : 1, fontWeight: 500 }}>
                        <Trash2 size={18} /> {isLoading ? 'Deleting…' : 'Delete'}
                    </button>
                </div>
            )}

            {/* "Show Movements" Summary Modal — per-product stock recap */}
            {isSummaryOpen && (() => {
                const numTd: React.CSSProperties = { padding: '9px 14px', textAlign: 'center', fontSize: '13px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border)' };
                const pill = (bg: string, color: string): React.CSSProperties => ({ display: 'inline-block', minWidth: '36px', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700, background: bg, color });
                const zero = <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>0</span>;
                const thBase: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, padding: '10px 14px', background: 'var(--color-bg)', borderBottom: '2px solid var(--color-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', textAlign: 'center', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
                const footTd: React.CSSProperties = { ...numTd, position: 'sticky', bottom: 0, background: 'var(--color-bg)', borderTop: '2px solid var(--color-border)', borderBottom: 'none', fontWeight: 800, padding: '11px 14px' };
                const chip = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, background: active ? 'var(--color-primary)' : '#FFFFFF', color: active ? 'white' : 'var(--color-text-secondary)', cursor: 'pointer', transition: 'all 0.15s' });
                // Every header is clickable — show a faint ↕ on inactive columns so
                // sortability is visible, and a solid ↑ / ↓ on the active one.
                const arrow = (key: keyof MovementSummaryRow) => summarySort?.key === key
                    ? <span style={{ marginLeft: '4px' }}>{summarySort.direction === 'asc' ? '↑' : '↓'}</span>
                    : <span style={{ marginLeft: '4px', opacity: 0.35 }}>↕</span>;
                const toggleSort = (key: keyof MovementSummaryRow) => setSummarySort(prev => prev?.key === key ? (prev.direction === 'asc' ? { key, direction: 'desc' } : null) : { key, direction: 'asc' });
                return (
                    <div
                        onClick={() => setIsSummaryOpen(false)}
                        style={{
                            // Below the DateRangePicker portal (z 9999) so the calendar
                            // opens ON TOP of this popup instead of hiding behind it.
                            position: 'fixed', inset: 0, zIndex: 9000,
                            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: isMobile ? '12px' : '24px',
                            animation: 'fadeIn 0.2s ease',
                        }}
                    >
                        <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                background: '#FFFFFF', borderRadius: '20px',
                                width: '100%', maxWidth: '820px', maxHeight: '88vh',
                                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                                boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
                                animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                        >
                            {/* Header */}
                            <div style={{
                                padding: '18px 22px', borderBottom: '1px solid var(--color-border)',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                background: 'linear-gradient(135deg, rgba(59,130,246,0.07), rgba(37,99,235,0.03))', gap: '10px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '13px', minWidth: 0 }}>
                                    <div style={{
                                        width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                                        background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
                                    }}>
                                        <Table2 size={20} />
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#111827' }}>Stock Movement Summary</h2>
                                        <p style={{ fontSize: '12px', color: '#6B7280', margin: '2px 0 0 0' }}>
                                            {summaryRangeLabel}
                                            {warehouseFilter !== 'all' && ` · ${warehouses.find(w => w.id === warehouseFilter)?.name || ''}`}
                                        </p>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                    <div style={{ background: '#FFFFFF', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '2px' }}>
                                        <DateRangePicker
                                            compact={isMobile}
                                            value={summaryDateRange}
                                            onChange={(v) => { setSummaryDateRange(v); fetchSummary(v); }}
                                        />
                                    </div>
                                    {(summaryDateRange.start || summaryDateRange.end) && (
                                        <button
                                            onClick={() => { const all = { start: '', end: '' }; setSummaryDateRange(all); fetchSummary(all); }}
                                            style={{
                                                padding: '8px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                                                border: '1px solid var(--color-border)', background: '#FFFFFF',
                                                color: '#6B7280', cursor: 'pointer', whiteSpace: 'nowrap'
                                            }}
                                        >
                                            All time
                                        </button>
                                    )}
                                    <button onClick={exportSummary} title="Export to Excel" style={{
                                        display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px',
                                        borderRadius: '10px', border: '1px solid var(--color-border)',
                                        background: 'var(--color-bg)', color: '#111827', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                                    }}>
                                        <Download size={14} /> {!isMobile && 'Export'}
                                    </button>
                                    <button onClick={() => setIsSummaryOpen(false)} style={{
                                        background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                                        cursor: 'pointer', color: '#6B7280', width: '34px', height: '34px',
                                        borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <X size={18} />
                                    </button>
                                </div>
                            </div>

                            {/* View toggle */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: isMobile ? '10px 12px' : '12px 22px', borderBottom: '1px solid var(--color-border)', background: '#FFFFFF', flexShrink: 0 }}>
                                <button onClick={() => setSummaryOnlyMovement(false)} style={chip(!summaryOnlyMovement)}>
                                    All Products ({summaryRows.length})
                                </button>
                                <button onClick={() => setSummaryOnlyMovement(true)} style={chip(summaryOnlyMovement)}>
                                    With Movement ({summaryMovementCount})
                                </button>
                            </div>

                            {/* Body */}
                            <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                                {isSummaryLoading ? (
                                    <div style={{ padding: '60px', textAlign: 'center', color: '#6B7280' }}>
                                        <RefreshCw size={28} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
                                        Building summary…
                                    </div>
                                ) : displayedSummaryRows.length === 0 ? (
                                    <div style={{ padding: '48px', textAlign: 'center', color: '#6B7280', fontSize: '13px' }}>
                                        No products with movement in this period.
                                    </div>
                                ) : (
                                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: '560px', background: '#FFFFFF' }}>
                                        <thead>
                                            <tr>
                                                <th onClick={() => toggleSort('name')} style={{ ...thBase, textAlign: 'left' }}>Model{arrow('name')}</th>
                                                <th onClick={() => toggleSort('oldStock')} style={thBase}>Old Stock{arrow('oldStock')}</th>
                                                <th onClick={() => toggleSort('sold')} style={{ ...thBase, color: '#DC2626' }}>Sold{arrow('sold')}</th>
                                                <th onClick={() => toggleSort('ret')} style={{ ...thBase, color: '#B45309' }}>Return{arrow('ret')}</th>
                                                <th onClick={() => toggleSort('buy')} style={{ ...thBase, color: '#7E22CE' }}>Buy{arrow('buy')}</th>
                                                <th onClick={() => toggleSort('newStock')} style={{ ...thBase, color: '#2563EB' }}>New Stock{arrow('newStock')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {displayedSummaryRows.map((r, idx) => {
                                                const moved = r.sold > 0 || r.ret > 0 || r.buy > 0;
                                                const net = r.newStock - r.oldStock;
                                                return (
                                                    <tr key={r.id} style={{ background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : '#FFFFFF' }}>
                                                        <td style={{ padding: '9px 14px', fontSize: '13px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', color: moved ? 'var(--color-text-main)' : 'var(--color-text-secondary)', borderLeft: `3px solid ${moved ? '#3B82F6' : 'transparent'}`, whiteSpace: 'nowrap', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {r.name}
                                                        </td>
                                                        <td style={{ ...numTd, color: 'var(--color-text-secondary)' }}>{r.oldStock}</td>
                                                        <td style={numTd}>{r.sold > 0 ? <span style={pill('rgba(239,68,68,0.1)', '#DC2626')}>-{r.sold}</span> : zero}</td>
                                                        <td style={numTd}>{r.ret > 0 ? <span style={pill('rgba(245,158,11,0.12)', '#B45309')}>+{r.ret}</span> : zero}</td>
                                                        <td style={numTd}>{r.buy > 0 ? <span style={pill('rgba(147,51,234,0.1)', '#7E22CE')}>+{r.buy}</span> : zero}</td>
                                                        <td style={{ ...numTd, fontWeight: 800, color: 'var(--color-text-main)' }}>
                                                            {r.newStock}
                                                            {net !== 0 && (
                                                                <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 700, color: net > 0 ? '#059669' : '#DC2626' }}>
                                                                    {net > 0 ? `▲${net}` : `▼${Math.abs(net)}`}
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr>
                                                <td style={{ ...footTd, textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>
                                                    Total · {displayedSummaryRows.length} {displayedSummaryRows.length === 1 ? 'model' : 'models'}
                                                </td>
                                                <td style={{ ...footTd, color: 'var(--color-text-secondary)' }}>{summaryTotals.oldStock}</td>
                                                <td style={{ ...footTd, color: '#DC2626' }}>{summaryTotals.sold > 0 ? `-${summaryTotals.sold}` : 0}</td>
                                                <td style={{ ...footTd, color: '#B45309' }}>{summaryTotals.ret > 0 ? `+${summaryTotals.ret}` : 0}</td>
                                                <td style={{ ...footTd, color: '#7E22CE' }}>{summaryTotals.buy > 0 ? `+${summaryTotals.buy}` : 0}</td>
                                                <td style={{ ...footTd, color: '#2563EB' }}>{summaryTotals.newStock}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Detail Modal */}
            {detailRecord && (
                <div
                    onClick={() => setDetailRecord(null)}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 10000,
                        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '24px',
                        animation: 'fadeIn 0.2s ease',
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'var(--color-surface, #fff)',
                            borderRadius: '20px',
                            width: '100%',
                            maxWidth: '560px',
                            maxHeight: '85vh',
                            overflowY: 'auto',
                            boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
                            animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                    >
                        {/* Header */}
                        <div style={{
                            padding: '20px 24px',
                            borderBottom: '1px solid var(--color-border)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            background: detailRecord.type === 'in'
                                ? 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(52,211,153,0.03))'
                                : 'linear-gradient(135deg, rgba(239,68,68,0.06), rgba(248,113,113,0.03))',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                <div style={{
                                    width: '42px', height: '42px', borderRadius: '12px',
                                    background: detailRecord.type === 'in'
                                        ? 'linear-gradient(135deg, #10B981, #34D399)'
                                        : 'linear-gradient(135deg, #EF4444, #F87171)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
                                }}>
                                    {detailRecord.type === 'in' ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                                </div>
                                <div>
                                    <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
                                        Stock {detailRecord.type === 'in' ? 'In' : 'Out'} Detail
                                    </h2>
                                    <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '2px 0 0 0' }}>
                                        {formatDateTime(detailRecord.movement_date || detailRecord.created_at)}
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setDetailRecord(null)} style={{
                                background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                                cursor: 'pointer', color: 'var(--color-text-muted)',
                                width: '34px', height: '34px', borderRadius: '10px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.2s',
                            }}>
                                <X size={18} />
                            </button>
                        </div>

                        {/* Body */}
                        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* Product & Quantity */}
                            <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '14px', border: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                                    <Package size={15} style={{ color: 'var(--color-text-muted)' }} />
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Product & Quantity</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <DetailField label="Product" value={detailRecord.product_name} />
                                    <DetailField
                                        label="Quantity"
                                        value={
                                            <span style={{ color: detailRecord.type === 'in' ? '#10B981' : '#EF4444', fontWeight: 700, fontSize: '16px' }}>
                                                {detailRecord.type === 'in' ? '+' : '-'}{detailRecord.quantity}
                                            </span>
                                        }
                                    />
                                    <DetailField label="Unit Price" value={detailRecord.unit_price ? formatCurrency(detailRecord.unit_price) : '-'} />
                                    <DetailField
                                        label="Total Value"
                                        value={detailRecord.unit_price ? formatCurrency(detailRecord.quantity * detailRecord.unit_price) : '-'}
                                    />
                                </div>
                            </div>

                            {/* Location & Source */}
                            <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '14px', border: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                                    <WarehouseIcon size={15} style={{ color: 'var(--color-text-muted)' }} />
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Location & Source</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <DetailField label="Warehouse" value={warehouses.find(w => w.id === detailRecord.warehouse_id)?.name || '-'} />
                                    <DetailField label={detailRecord.type === 'in' ? 'Source' : 'Reason'} value={(detailRecord.type === 'in' ? detailRecord.source : detailRecord.reason) || '-'} />
                                </div>
                            </div>

                            {/* People & Shipping */}
                            <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '14px', border: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                                    <User size={15} style={{ color: 'var(--color-text-muted)' }} />
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>People & Shipping</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <DetailField label="Supplier" value={detailRecord.supplier || '-'} />
                                    <DetailField label="Customer" value={detailRecord.customer_name || '-'} />
                                    <DetailField label="Phone" value={detailRecord.customer_phone || '-'} />
                                    <DetailField label="Shipping Co" value={detailRecord.shipping_co || '-'} />
                                </div>
                            </div>

                            {/* Reference & Notes */}
                            <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '14px', border: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                                    <FileText size={15} style={{ color: 'var(--color-text-muted)' }} />
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Reference & Notes</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <DetailField label="Reference ID" value={detailRecord.reference_id || '-'} mono />
                                    <DetailField label="Created By" value={detailRecord.created_by || '-'} />
                                </div>
                                {detailRecord.note && (
                                    <div style={{ marginTop: '12px' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>Note</div>
                                        <div style={{ fontSize: '13px', color: 'var(--color-text)', lineHeight: '1.5', padding: '10px 12px', background: 'var(--color-surface)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                            {detailRecord.note}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px) scale(0.98); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

/* Small helper component for detail modal fields */
const DetailField: React.FC<{ label: string; value: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
    <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: '13px', color: 'var(--color-text)', fontWeight: 500, fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
);

export default StockMovementsPage;
