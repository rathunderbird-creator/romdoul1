import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeftRight, Search, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Download, PackagePlus, PackageMinus, Activity } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';
import { supabase } from '../../lib/supabase';
import DateRangePicker from '../../components/DateRangePicker';
import { StatsCard } from '../../components';

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

const StockMovementsPage: React.FC = () => {
    const { warehouses } = useStore();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const isMobile = useMobile();

    const [movements, setMovements] = useState<StockMovement[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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
    
    // Sorting state
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(() => {
        const saved = localStorage.getItem('stock_movements_sortConfig');
        return saved ? JSON.parse(saved) : { key: 'movement_date', direction: 'desc' };
    });

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(() => {
        return Number(localStorage.getItem('stock_movements_itemsPerPage')) || 100;
    });

    useEffect(() => {
        localStorage.setItem('stock_movements_dateRange', JSON.stringify(dateRange));
        localStorage.setItem('stock_movements_searchTerm', searchTerm);
        localStorage.setItem('stock_movements_typeFilter', typeFilter);
        localStorage.setItem('stock_movements_sortConfig', JSON.stringify(sortConfig));
        localStorage.setItem('stock_movements_itemsPerPage', itemsPerPage.toString());
    }, [dateRange, searchTerm, typeFilter, sortConfig, itemsPerPage]);

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
    }, [dateRange, typeFilter]);

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
                    aValue = new Date(a.movement_date || a.created_at).getTime();
                    bValue = new Date(b.movement_date || b.created_at).getTime();
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
        filteredMovements.forEach(m => {
            if (m.type === 'in') totalIn += m.quantity;
            if (m.type === 'out') totalOut += m.quantity;
        });
        return {
            totalMovements: filteredMovements.length,
            totalIn,
            totalOut,
            netChange: totalIn - totalOut
        };
    }, [filteredMovements]);

    const totalPages = Math.ceil(sortedMovements.length / itemsPerPage);
    const paginatedMovements = sortedMovements.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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

    const clearFilters = () => {
        setDateRange({ start: '', end: '' });
        setSearchTerm('');
        setTypeFilter('all');
    };

    const hasActiveFilters = dateRange.start || dateRange.end || searchTerm || typeFilter !== 'all';

    return (
        <div style={{ padding: isMobile ? '12px' : '24px' }}>
            <div className="fade-in">
                {/* Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                    <StatsCard 
                        title="Total Records" 
                        value={stats.totalMovements.toLocaleString()} 
                        icon={Activity} 
                        color="#6366f1"
                        bgColor="rgba(99, 102, 241, 0.1)"
                    />
                    <StatsCard 
                        title="Items Received (In)" 
                        value={`+${stats.totalIn.toLocaleString()}`} 
                        icon={PackagePlus} 
                        color="#10B981"
                        bgColor="rgba(16, 185, 129, 0.1)"
                    />
                    <StatsCard 
                        title="Items Issued (Out)" 
                        value={`-${stats.totalOut.toLocaleString()}`} 
                        icon={PackageMinus} 
                        color="#EF4444"
                        bgColor="rgba(239, 68, 68, 0.1)"
                    />
                    <StatsCard 
                        title="Net Stock Change" 
                        value={`${stats.netChange > 0 ? '+' : ''}${stats.netChange.toLocaleString()}`} 
                        icon={ArrowLeftRight} 
                        color={stats.netChange > 0 ? '#10B981' : stats.netChange < 0 ? '#EF4444' : 'var(--color-text-secondary)'}
                        bgColor={stats.netChange > 0 ? 'rgba(16, 185, 129, 0.1)' : stats.netChange < 0 ? 'rgba(239, 68, 68, 0.1)' : 'var(--color-bg)'}
                    />
                </div>

                {/* Header Actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ position: 'relative', width: isMobile ? '100%' : '300px' }}>
                            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                            <input
                                type="text"
                                placeholder="Search product, reference, source..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ width: '100%', padding: '10px 16px 10px 40px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '14px', outline: 'none' }}
                            />
                        </div>
                        
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={() => setTypeFilter('all')}
                                className={typeFilter === 'all' ? 'primary-button' : 'secondary-button'}
                                style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px' }}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setTypeFilter('in')}
                                className={typeFilter === 'in' ? 'primary-button' : 'secondary-button'}
                                style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', background: typeFilter === 'in' ? '#10B981' : undefined, color: typeFilter === 'in' ? '#FFF' : undefined }}
                            >
                                <TrendingUp size={14} /> In
                            </button>
                            <button
                                onClick={() => setTypeFilter('out')}
                                className={typeFilter === 'out' ? 'primary-button' : 'secondary-button'}
                                style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', background: typeFilter === 'out' ? '#EF4444' : undefined, color: typeFilter === 'out' ? '#FFF' : undefined }}
                            >
                                <TrendingDown size={14} /> Out
                            </button>
                        </div>

                        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '4px' }}>
                            <DateRangePicker value={dateRange} onChange={setDateRange} />
                        </div>
                        
                        {hasActiveFilters && (
                            <button onClick={clearFilters} className="secondary-button" style={{ padding: '8px 12px', borderRadius: '8px', fontSize: '13px', color: '#EF4444', borderColor: 'transparent' }}>
                                Clear Filters
                            </button>
                        )}
                    </div>
                    
                    <button onClick={exportToExcel} className="secondary-button" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px' }}>
                        <Download size={16} /> Export Excel
                    </button>
                </div>

                {/* Table */}
                <div className="table-container" style={{ overflowX: 'auto', background: 'var(--color-surface)', borderRadius: '16px', border: '1px solid var(--color-border)' }}>
                    {isLoading ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                            <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
                            <p>Loading movements...</p>
                        </div>
                    ) : paginatedMovements.length === 0 ? (
                        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                            <ArrowLeftRight size={48} style={{ opacity: 0.2, marginBottom: '16px', margin: '0 auto' }} />
                            <h3>No movements found</h3>
                            <p style={{ fontSize: '14px', marginTop: '8px' }}>Adjust your filters or date range.</p>
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                    <th onClick={() => handleSort('movement_date')} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>Date {sortConfig?.key === 'movement_date' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                    <th onClick={() => handleSort('type')} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>Type {sortConfig?.key === 'type' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                    <th onClick={() => handleSort('product_name')} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>Product {sortConfig?.key === 'product_name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                    <th onClick={() => handleSort('quantity')} style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>Qty {sortConfig?.key === 'quantity' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                    <th onClick={() => handleSort('warehouse_id')} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>Warehouse {sortConfig?.key === 'warehouse_id' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                    <th onClick={() => handleSort('source')} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>Source / Reason {sortConfig?.key === 'source' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                    <th onClick={() => handleSort('supplier')} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>Supplier / Customer {sortConfig?.key === 'supplier' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                    <th onClick={() => handleSort('reference_id')} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>Reference / Note {sortConfig?.key === 'reference_id' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedMovements.map(record => {
                                    const warehouse = warehouses.find(w => w.id === record.warehouse_id);
                                    
                                    return (
                                        <tr key={record.id} style={{ borderBottom: '1px solid var(--color-border)' }} className="table-row">
                                            <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                                                {new Date(record.movement_date || record.created_at).toLocaleDateString()}
                                            </td>
                                            <td style={{ padding: '12px 16px' }}>
                                                {record.type === 'in' ? (
                                                    <span style={{ padding: '4px 8px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.1)', color: '#10B981', fontSize: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                        <TrendingUp size={12} /> IN
                                                    </span>
                                                ) : (
                                                    <span style={{ padding: '4px 8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', fontSize: '12px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                        <TrendingDown size={12} /> OUT
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 500 }}>
                                                {record.product_name}
                                            </td>
                                            <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: '13px', fontWeight: 600, color: record.type === 'in' ? '#10B981' : '#EF4444' }}>
                                                {record.type === 'in' ? '+' : '-'}{record.quantity}
                                            </td>
                                            <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                {warehouse?.name || '-'}
                                            </td>
                                            <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                                                {record.type === 'in' ? record.source : record.reason}
                                            </td>
                                            <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                {record.supplier || record.customer_name || '-'}
                                            </td>
                                            <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                <div style={{ fontFamily: 'monospace' }}>{record.reference_id || record.note || '-'}</div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
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
                                    className="icon-button"
                                    style={{ padding: '6px', opacity: currentPage === 1 ? 0.5 : 1 }}
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', margin: '0 8px' }}>
                                    Page <span style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>{currentPage}</span> of {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className="icon-button"
                                    style={{ padding: '6px', opacity: currentPage === totalPages ? 0.5 : 1 }}
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StockMovementsPage;
