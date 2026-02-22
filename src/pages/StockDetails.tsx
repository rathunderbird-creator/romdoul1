import React, { useState, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { DateRangePicker } from '../components';
import { useMobile } from '../hooks/useMobile';

const StockDetails: React.FC = () => {
    const { products, sales } = useStore();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();

    // Default to today
    const [dateRange, setDateRange] = useState(() => {
        const today = new Date().toISOString().split('T')[0];
        return { start: today, end: today };
    });

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Stock Details</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Daily stock summary</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const dailyStockStats = useMemo(() => {
        if (!dateRange.start || !dateRange.end) return [];

        const start = new Date(dateRange.start);
        start.setHours(0, 0, 0, 0);
        const end = new Date(dateRange.end);
        end.setHours(23, 59, 59, 999);

        // 1. Calculate Sold and Return for the specific date range
        const soldMap = new Map<string, number>();
        const returnMap = new Map<string, number>();

        // 2. Calculate TOTAL Sold and Return SINCE the end of the selected date range
        // This is necessary to calculate "Old Stock" backwards from "Current Stock"
        // Old Stock = Current Stock + Total Sold After Date - Total Returned After Date
        const soldAfterMap = new Map<string, number>();
        const returnAfterMap = new Map<string, number>();

        sales.forEach(sale => {
            const saleDate = new Date(sale.date);
            const isWithinRange = saleDate >= start && saleDate <= end;
            const isAfterRange = saleDate > end;

            const isReturn = sale.shipping?.status === 'Returned' || sale.shipping?.status === 'ReStock' || sale.paymentStatus === 'Cancel';

            // Note: In a real system, Returns should be tracked by the date they were ACTUALLY returned. 
            // Here we only have the sale date and lastEditedAt. We'll use sale.date as a proxy unless a specific return date field exists.

            sale.items.forEach(item => {
                if (isWithinRange) {
                    if (isReturn) {
                        returnMap.set(item.id, (returnMap.get(item.id) || 0) + item.quantity);
                    } else {
                        soldMap.set(item.id, (soldMap.get(item.id) || 0) + item.quantity);
                    }
                }

                if (isAfterRange) {
                    if (isReturn) {
                        returnAfterMap.set(item.id, (returnAfterMap.get(item.id) || 0) + item.quantity);
                    } else {
                        soldAfterMap.set(item.id, (soldAfterMap.get(item.id) || 0) + item.quantity);
                    }
                }
            });
        });

        return products.map(product => {
            const currentStock = product.stock;
            const soldInPeriod = soldMap.get(product.id) || 0;
            const returnedInPeriod = returnMap.get(product.id) || 0;
            const soldAfterPeriod = soldAfterMap.get(product.id) || 0;
            const returnedAfterPeriod = returnAfterMap.get(product.id) || 0;
            const buyInPeriod = 0; // Not tracked explicitly yet

            // Reconstruct the stock at the END of the period
            // Stock at end of period = Current Stock + What was sold since then - What was returned since then
            const newStock = currentStock + soldAfterPeriod - returnedAfterPeriod;

            // Reconstruct the stock at the START of the period
            // Old Stock = Stock at end of period + What was sold during period - What was returned during period - What was bought during period
            const oldStock = newStock + soldInPeriod - returnedInPeriod - buyInPeriod;

            return {
                ...product,
                oldStock,
                soldInPeriod,
                returnedInPeriod,
                buyInPeriod,
                newStock
            };
        }).sort((a, b) => a.model.localeCompare(b.model));
    }, [products, sales, dateRange]);


    const totals = dailyStockStats.reduce((acc, curr) => ({
        oldStock: acc.oldStock + curr.oldStock,
        soldInPeriod: acc.soldInPeriod + curr.soldInPeriod,
        returnedInPeriod: acc.returnedInPeriod + curr.returnedInPeriod,
        buyInPeriod: acc.buyInPeriod + curr.buyInPeriod,
        newStock: acc.newStock + curr.newStock
    }), { oldStock: 0, soldInPeriod: 0, returnedInPeriod: 0, buyInPeriod: 0, newStock: 0 });


    return (
        <div style={{ paddingBottom: '40px' }}>
            <div className="glass-panel" style={{
                marginBottom: '20px',
                padding: '16px',
                display: 'flex',
                justifyContent: isMobile ? 'center' : 'flex-end',
                alignItems: 'center',
                position: 'relative',
                zIndex: 50
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: isMobile ? '100%' : 'auto'
                }}>
                    <div style={{ flex: 1 }}>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>
                </div>
            </div>

            <div className="glass-panel" style={{ overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table className="spreadsheet-table">
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', minWidth: '150px' }}>Model</th>
                                <th style={{ textAlign: 'center', minWidth: '100px' }}>Old Stock</th>
                                <th style={{ textAlign: 'center', minWidth: '100px' }}>Sold</th>
                                <th style={{ textAlign: 'center', minWidth: '100px' }}>Return</th>
                                <th style={{ textAlign: 'center', minWidth: '100px' }}>Buy</th>
                                <th style={{ textAlign: 'center', minWidth: '100px' }}>New Stock</th>
                            </tr>
                        </thead>
                        <tbody>
                            {dailyStockStats.map((stat) => (
                                <tr key={stat.id}>
                                    <td style={{ fontWeight: 500 }}>{stat.model}</td>
                                    <td style={{ textAlign: 'center' }}>{stat.oldStock}</td>
                                    <td style={{ textAlign: 'center', color: stat.soldInPeriod > 0 ? 'var(--color-green)' : 'inherit', fontWeight: stat.soldInPeriod > 0 ? 'bold' : 'normal' }}>
                                        {stat.soldInPeriod || ''}
                                    </td>
                                    <td style={{ textAlign: 'center', color: stat.returnedInPeriod > 0 ? 'var(--color-red)' : 'inherit', fontWeight: stat.returnedInPeriod > 0 ? 'bold' : 'normal' }}>
                                        {stat.returnedInPeriod || ''}
                                    </td>
                                    <td style={{ textAlign: 'center', color: stat.buyInPeriod > 0 ? 'var(--color-primary)' : 'inherit', fontWeight: stat.buyInPeriod > 0 ? 'bold' : 'normal' }}>
                                        {stat.buyInPeriod || ''}
                                    </td>
                                    <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{stat.newStock}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr style={{ background: 'var(--color-primary-light)', borderTop: '2px solid var(--color-border)' }}>
                                <td style={{ fontWeight: 'bold', padding: '12px 16px' }}>Total Summary</td>
                                <td style={{ textAlign: 'center', fontWeight: 'bold', padding: '12px 16px' }}>{totals.oldStock}</td>
                                <td style={{ textAlign: 'center', fontWeight: 'bold', color: totals.soldInPeriod > 0 ? 'var(--color-green)' : 'inherit', padding: '12px 16px' }}>{totals.soldInPeriod}</td>
                                <td style={{ textAlign: 'center', fontWeight: 'bold', color: totals.returnedInPeriod > 0 ? 'var(--color-red)' : 'inherit', padding: '12px 16px' }}>{totals.returnedInPeriod}</td>
                                <td style={{ textAlign: 'center', fontWeight: 'bold', color: totals.buyInPeriod > 0 ? 'var(--color-primary)' : 'inherit', padding: '12px 16px' }}>{totals.buyInPeriod}</td>
                                <td style={{ textAlign: 'center', fontWeight: 'bold', padding: '12px 16px' }}>{totals.newStock}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default StockDetails;
