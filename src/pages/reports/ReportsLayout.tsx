import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, Package, Wallet, Users, ShoppingBag, Truck } from 'lucide-react';
import { DateRangePicker } from '../../components';
import { supabase } from '../../lib/supabase';
import { mapSaleEntity } from '../../utils/mapper';
import type { Sale, Transaction } from '../../types';

const ReportsLayout: React.FC = () => {
    const location = useLocation();
    
    // Global Date State (Default to This Month)
    const [dateRange, setDateRange] = useState(() => {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const getLocalYYYYMMDD = (date: Date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        return { 
            start: getLocalYYYYMMDD(firstDay), 
            end: getLocalYYYYMMDD(now) 
        };
    });

    const [reportSales, setReportSales] = useState<Sale[]>([]);
    const [reportTransactions, setReportTransactions] = useState<Transaction[]>([]);
    const [isLoadingReports, setIsLoadingReports] = useState(false);

    useEffect(() => {
        const fetchReportData = async () => {
            setIsLoadingReports(true);
            try {
                let salesQuery = supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)');
                let transQuery = supabase.from('transactions').select('*');

                if (dateRange.start) {
                    const start = new Date(dateRange.start);
                    start.setHours(0,0,0,0);
                    salesQuery = salesQuery.gte('date', start.toISOString());
                    transQuery = transQuery.gte('date', start.toISOString());
                }
                if (dateRange.end) {
                    const end = new Date(dateRange.end);
                    end.setHours(23,59,59,999);
                    salesQuery = salesQuery.lte('date', end.toISOString());
                    transQuery = transQuery.lte('date', end.toISOString());
                }

                const [salesResult, transResult] = await Promise.all([salesQuery, transQuery]);

                if (salesResult.data) setReportSales(salesResult.data.map(mapSaleEntity));
                if (transResult.data) setReportTransactions(transResult.data);
            } catch (err) {
                console.error("Failed to load report data:", err);
            } finally {
                setIsLoadingReports(false);
            }
        };

        fetchReportData();
    }, [dateRange]);

    const tabs = [
        { path: '/reports/sales', label: 'Sales Overview', icon: BarChart3 },
        { path: '/reports/products', label: 'Top Products', icon: ShoppingBag },
        { path: '/reports/inventory', label: 'Inventory', icon: Package },
        { path: '/reports/financials', label: 'Financials', icon: Wallet },
        { path: '/reports/staff', label: 'Staff Performance', icon: Users },
        { path: '/reports/shipping', label: 'Shipping Companies', icon: Truck },
    ];

    return (
        <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Header Area */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 8px 0', color: 'var(--color-primary)' }}>Reports Center</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>Analyze your business metrics, sales, inventory, and financials.</p>
                </div>
                
                {/* Global Date Filter */}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <DateRangePicker value={dateRange} onChange={setDateRange} />
                </div>
            </div>

            {/* Navigation Tabs */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--color-border)', overflowX: 'auto', paddingBottom: '12px' }}>
                {tabs.map(tab => {
                    const isActive = location.pathname.includes(tab.path);
                    return (
                        <NavLink
                            key={tab.path}
                            to={tab.path}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '10px 16px',
                                borderRadius: '12px',
                                textDecoration: 'none',
                                fontWeight: 600,
                                fontSize: '14px',
                                whiteSpace: 'nowrap',
                                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                backgroundColor: isActive ? 'var(--color-bg)' : 'transparent',
                                transition: 'all 0.2s ease',
                                border: isActive ? '1px solid var(--color-border)' : '1px solid transparent'
                            }}
                        >
                            <tab.icon size={18} />
                            {tab.label}
                        </NavLink>
                    );
                })}
            </div>

            {/* Content Area */}
            <div style={{ flex: 1, animation: 'fadeIn 0.3s ease-out', position: 'relative' }}>
                {isLoadingReports && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', zIndex: 10, display: 'flex', justifyContent: 'center', paddingTop: '100px', backdropFilter: 'blur(2px)' }}>
                        <div className="loader">Loading Data...</div>
                    </div>
                )}
                <Outlet context={{ startDate: dateRange.start, endDate: dateRange.end, reportSales, reportTransactions }} />
            </div>
        </div>
    );
};

export default ReportsLayout;
