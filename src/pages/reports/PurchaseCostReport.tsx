import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from 'recharts';
import { Package, DollarSign, TrendingUp, ShoppingBag } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import type { Sale } from '../../types';


const STATUS_OPTIONS = ['Delivered', 'Shipped', 'Pending', 'Confirmed', 'Ordered', 'Returned', 'Cancelled'];

const PurchaseCostReport: React.FC = () => {
    const { reportSales } = useOutletContext<any>();
    const { products } = useStore();

    const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

    // Build a product lookup map for purchaseCost
    const productCostMap = useMemo(() => {
        const map = new Map<string, { purchaseCost: number; name: string; image: string }>();
        products.forEach(p => {
            map.set(p.id, { purchaseCost: p.purchaseCost || 0, name: p.name, image: p.image });
        });
        return map;
    }, [products]);

    const { productData, dailyData, totalItems, totalPurchaseCost, totalSellValue, grossProfit } = useMemo(() => {
        const productMap = new Map<string, {
            productId: string; name: string; image: string;
            qtyShipped: number; qtyDelivered: number; totalQty: number;
            purchaseCostUnit: number; totalPurchaseCost: number;
            sellPriceUnit: number; totalSellValue: number;
        }>();
        const dailyMap = new Map<string, { date: string; purchaseCost: number; sellValue: number; items: number }>();
        let totalItm = 0, totalPC = 0, totalSV = 0;

        (reportSales || []).forEach((sale: Sale) => {
            const status = sale.shipping?.status || 'Pending';
            if (statusFilter.size > 0 && !statusFilter.has(status)) return;

            // Extract date as YYYY-MM-DD
            const dateKey = sale.date ? sale.date.substring(0, 10) : 'Unknown';

            (sale.items || []).forEach(item => {
                const productInfo = productCostMap.get(item.id);
                const purchaseCost = productInfo?.purchaseCost || 0;
                const itemName = productInfo?.name || item.name || 'Unknown Product';
                const itemImage = productInfo?.image || '';
                const qty = item.quantity || 1;
                const sellPrice = item.price || 0;

                // Product aggregation
                const key = item.id || itemName;
                if (!productMap.has(key)) {
                    productMap.set(key, {
                        productId: item.id, name: itemName, image: itemImage,
                        qtyShipped: 0, qtyDelivered: 0, totalQty: 0,
                        purchaseCostUnit: purchaseCost,
                        totalPurchaseCost: 0,
                        sellPriceUnit: sellPrice,
                        totalSellValue: 0
                    });
                }
                const r = productMap.get(key)!;
                r.totalQty += qty;
                if (status === 'Shipped') r.qtyShipped += qty;
                if (status === 'Delivered') r.qtyDelivered += qty;
                r.totalPurchaseCost += purchaseCost * qty;
                r.totalSellValue += sellPrice * qty;
                // Update unit prices to latest seen
                r.purchaseCostUnit = purchaseCost;
                r.sellPriceUnit = sellPrice;

                // Daily aggregation
                if (!dailyMap.has(dateKey)) {
                    dailyMap.set(dateKey, { date: dateKey, purchaseCost: 0, sellValue: 0, items: 0 });
                }
                const d = dailyMap.get(dateKey)!;
                d.purchaseCost += purchaseCost * qty;
                d.sellValue += sellPrice * qty;
                d.items += qty;

                totalItm += qty;
                totalPC += purchaseCost * qty;
                totalSV += sellPrice * qty;
            });
        });

        const pData = Array.from(productMap.values()).sort((a, b) => b.totalPurchaseCost - a.totalPurchaseCost);
        const dData = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        return {
            productData: pData,
            dailyData: dData,
            totalItems: totalItm,
            totalPurchaseCost: totalPC,
            totalSellValue: totalSV,
            grossProfit: totalSV - totalPC
        };
    }, [reportSales, statusFilter, productCostMap]);

    const toggleStatus = (s: string) => {
        setStatusFilter(prev => {
            const next = new Set(prev);
            if (next.has(s)) next.delete(s);
            else next.add(s);
            return next;
        });
    };

    const profitMargin = totalSellValue > 0 ? ((grossProfit / totalSellValue) * 100) : 0;

    // Top 10 products for chart
    const chartProducts = productData.slice(0, 10).map(p => ({
        name: p.name.length > 20 ? p.name.substring(0, 18) + '…' : p.name,
        cost: p.totalPurchaseCost,
        revenue: p.totalSellValue
    }));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Purchase Cost Analytics</h2>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(59,130,246,0.2)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Items Moved</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(59,130,246,0.15)', color: '#3B82F6' }}><ShoppingBag size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800 }}>{totalItems.toLocaleString()}</div>
                </div>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Purchase Cost</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}><DollarSign size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: '#EF4444' }}>${totalPurchaseCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(16,185,129,0.2)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Sell Value</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(16,185,129,0.15)', color: '#10B981' }}><Package size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: '#10B981' }}>${totalSellValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                <div className="stats-card hover-lift" style={{ background: `linear-gradient(135deg, rgba(${grossProfit >= 0 ? '139,92,246' : '239,68,68'},0.1), rgba(${grossProfit >= 0 ? '139,92,246' : '239,68,68'},0.02))`, padding: '20px', borderRadius: '16px', border: `1px solid rgba(${grossProfit >= 0 ? '139,92,246' : '239,68,68'},0.2)`, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Gross Profit</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: `rgba(${grossProfit >= 0 ? '139,92,246' : '239,68,68'},0.15)`, color: grossProfit >= 0 ? '#8B5CF6' : '#EF4444' }}><TrendingUp size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: grossProfit >= 0 ? '#8B5CF6' : '#EF4444' }}>
                        ${grossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                        Margin: {profitMargin.toFixed(1)}%
                    </div>
                </div>
            </div>

            {/* Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
                {/* Cost by Product */}
                <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '400px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Purchase Cost by Product</h3>
                    {chartProducts.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartProducts} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                                <XAxis type="number" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                                <YAxis dataKey="name" type="category" width={120} stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip
                                    cursor={{ fill: 'rgba(239,68,68,0.05)' }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                    formatter={(v: any, name: any) => [`$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, name === 'cost' ? 'Purchase Cost' : 'Revenue']}
                                />
                                <Legend formatter={(value) => value === 'cost' ? 'Purchase Cost' : 'Sell Value'} />
                                <Bar dataKey="cost" fill="#EF4444" radius={[0, 4, 4, 0]} barSize={16} name="cost" />
                                <Bar dataKey="revenue" fill="#10B981" radius={[0, 4, 4, 0]} barSize={16} name="revenue" />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No data available.</div>}
                </div>

                {/* Daily Trend */}
                <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '400px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Daily Cost Trend</h3>
                    {dailyData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                <XAxis
                                    dataKey="date"
                                    stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false}
                                    tickFormatter={(v) => { const d = new Date(v + 'T00:00:00'); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }}
                                    angle={-45} textAnchor="end" height={60}
                                />
                                <YAxis stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                                <Tooltip
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                    formatter={(v: any, name: any) => [`$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, name === 'purchaseCost' ? 'Purchase Cost' : name === 'sellValue' ? 'Sell Value' : name]}
                                    labelFormatter={(label) => { const d = new Date(label + 'T00:00:00'); return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }}
                                />
                                <Legend formatter={(value) => value === 'purchaseCost' ? 'Purchase Cost' : 'Sell Value'} />
                                <Line type="monotone" dataKey="purchaseCost" stroke="#EF4444" strokeWidth={2} dot={{ r: 3, fill: '#EF4444' }} activeDot={{ r: 5 }} name="purchaseCost" />
                                <Line type="monotone" dataKey="sellValue" stroke="#10B981" strokeWidth={2} dot={{ r: 3, fill: '#10B981' }} activeDot={{ r: 5 }} name="sellValue" />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No data available.</div>}
                </div>
            </div>

            {/* Product Breakdown Table */}
            <div className="glass-panel" style={{ padding: '24px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Product Breakdown</h3>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginRight: '4px' }}>Status:</span>
                        <button
                            onClick={() => setStatusFilter(new Set())}
                            style={{
                                padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                                cursor: 'pointer', border: '1px solid var(--color-border)',
                                background: statusFilter.size === 0 ? 'var(--color-primary)' : 'transparent',
                                color: statusFilter.size === 0 ? 'white' : 'var(--color-text-secondary)',
                                transition: 'all 0.2s'
                            }}
                        >All</button>
                        {STATUS_OPTIONS.map(s => (
                            <button
                                key={s}
                                onClick={() => toggleStatus(s)}
                                style={{
                                    padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                                    cursor: 'pointer', border: '1px solid var(--color-border)',
                                    background: statusFilter.has(s) ? (s === 'Delivered' ? '#10B981' : s === 'Shipped' ? '#3B82F6' : s === 'Returned' || s === 'Cancelled' ? '#EF4444' : '#F59E0B') : 'transparent',
                                    color: statusFilter.has(s) ? 'white' : 'var(--color-text-secondary)',
                                    transition: 'all 0.2s'
                                }}
                            >{s}</button>
                        ))}
                    </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="spreadsheet-table">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th style={{ textAlign: 'center' }}>Shipped</th>
                                <th style={{ textAlign: 'center' }}>Delivered</th>
                                <th style={{ textAlign: 'right' }}>Total Qty</th>
                                <th style={{ textAlign: 'right' }}>Cost/Unit</th>
                                <th style={{ textAlign: 'right' }}>Total Cost</th>
                                <th style={{ textAlign: 'right' }}>Sell/Unit</th>
                                <th style={{ textAlign: 'right' }}>Total Revenue</th>
                                <th style={{ textAlign: 'right' }}>Profit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {productData.map(p => {
                                const profit = p.totalSellValue - p.totalPurchaseCost;
                                return (
                                    <tr key={p.productId || p.name}>
                                        <td style={{ fontWeight: 500, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                                        <td style={{ textAlign: 'center', color: '#3B82F6' }}>{p.qtyShipped}</td>
                                        <td style={{ textAlign: 'center', color: '#10B981' }}>{p.qtyDelivered}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{p.totalQty}</td>
                                        <td style={{ textAlign: 'right', color: '#EF4444' }}>${p.purchaseCostUnit.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>${p.totalPurchaseCost.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right', color: '#10B981' }}>${p.sellPriceUnit.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#10B981' }}>${p.totalSellValue.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, color: profit >= 0 ? '#8B5CF6' : '#EF4444' }}>
                                            ${profit.toFixed(2)}
                                        </td>
                                    </tr>
                                );
                            })}
                            {productData.length === 0 && (
                                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-secondary)' }}>No shipped or delivered products in this period.</td></tr>
                            )}
                        </tbody>
                        <tfoot>
                            <tr style={{ fontWeight: 700, background: 'var(--color-surface-hover)' }}>
                                <td>Total</td>
                                <td style={{ textAlign: 'center', color: '#3B82F6' }}>{productData.reduce((s, p) => s + p.qtyShipped, 0)}</td>
                                <td style={{ textAlign: 'center', color: '#10B981' }}>{productData.reduce((s, p) => s + p.qtyDelivered, 0)}</td>
                                <td style={{ textAlign: 'right' }}>{totalItems}</td>
                                <td style={{ textAlign: 'right', color: '#EF4444' }}>—</td>
                                <td style={{ textAlign: 'right', color: '#EF4444' }}>${totalPurchaseCost.toFixed(2)}</td>
                                <td style={{ textAlign: 'right', color: '#10B981' }}>—</td>
                                <td style={{ textAlign: 'right', color: '#10B981' }}>${totalSellValue.toFixed(2)}</td>
                                <td style={{ textAlign: 'right', color: grossProfit >= 0 ? '#8B5CF6' : '#EF4444' }}>${grossProfit.toFixed(2)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                    💡 Purchase cost is based on each product's current "Cost of Purchase" value. Profit = Sell Value − Purchase Cost.
                </p>
            </div>
        </div>
    );
};

export default PurchaseCostReport;
