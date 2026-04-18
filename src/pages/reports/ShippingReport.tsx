import React, { useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { Truck, PackageCheck, Package } from 'lucide-react';
import type { Sale } from '../../types';

const COLORS = ['#8B5CF6', '#EC4899', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#6B7280'];

const ShippingReport: React.FC = () => {
    const { reportSales } = useOutletContext<any>();

    const { shippingData, totalOrders, totalDelivered, topCompany } = useMemo(() => {
        const companyMap = new Map<string, {
            name: string;
            totalOrders: number;
            totalValue: number;
            delivered: number;
            shipped: number;
            returned: number;
            pending: number;
            other: number;
        }>();

        let totalOrd = 0;
        let totalDel = 0;

        (reportSales || []).forEach((sale: Sale) => {
            const coName = sale.shipping?.company || 'Unassigned';
            if (!companyMap.has(coName)) {
                companyMap.set(coName, {
                    name: coName,
                    totalOrders: 0,
                    totalValue: 0,
                    delivered: 0,
                    shipped: 0,
                    returned: 0,
                    pending: 0,
                    other: 0
                });
            }

            const record = companyMap.get(coName)!;
            record.totalOrders += 1;
            record.totalValue += sale.total;
            totalOrd += 1;

            const status = sale.shipping?.status || 'Pending';
            switch (status) {
                case 'Delivered':
                    record.delivered += 1;
                    totalDel += 1;
                    break;
                case 'Shipped':
                    record.shipped += 1;
                    break;
                case 'Returned':
                    record.returned += 1;
                    break;
                case 'Pending':
                case 'Ordered':
                    record.pending += 1;
                    break;
                default:
                    record.other += 1;
                    break;
            }
        });

        const data = Array.from(companyMap.values()).sort((a, b) => b.totalOrders - a.totalOrders);
        const top = data.length > 0 ? data[0] : null;

        return {
            shippingData: data,
            totalOrders: totalOrd,
            totalDelivered: totalDel,
            topCompany: top
        };
    }, [reportSales]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Shipping Companies Analytics</h2>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(59, 130, 246, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Orders</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.15)', color: '#3B82F6' }}><Truck size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)' }}>{totalOrders}</div>
                </div>

                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(16, 185, 129, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Delivered</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', color: '#10B981' }}><PackageCheck size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)' }}>{totalDelivered}</div>
                </div>
                
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(139, 92, 246, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(139, 92, 246, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Top Company</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6' }}><Package size={18} /></div>
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text-main)', marginTop: '4px' }}>{topCompany ? topCompany.name : 'N/A'}</div>
                </div>
            </div>

            {/* Performance Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
                {/* Orders Volume by Company */}
                <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '400px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Volume by Company</h3>
                    {shippingData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={shippingData} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                                <XAxis type="number" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis dataKey="name" type="category" width={100} stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    cursor={{ fill: 'rgba(59, 130, 246, 0.05)' }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                    formatter={(value: any) => [`${value}`, 'Total Orders']}
                                />
                                <Bar dataKey="totalOrders" fill="#3B82F6" radius={[0, 4, 4, 0]} barSize={24}>
                                    {
                                        shippingData.map((_entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))
                                    }
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No shipping data available.</div>
                    )}
                </div>

                {/* Status Breakdown */}
                <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '400px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Delivery Status Breakdown</h3>
                    {shippingData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={shippingData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                <XAxis dataKey="name" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} angle={-45} textAnchor="end" height={60} />
                                <YAxis stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    cursor={{ fill: 'transparent' }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                />
                                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                <Bar dataKey="delivered" name="Delivered" stackId="a" fill="#10B981" radius={[0, 0, 0, 0]} barSize={32} />
                                <Bar dataKey="shipped" name="Shipped" stackId="a" fill="#3B82F6" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="pending" name="Pending" stackId="a" fill="#F59E0B" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="returned" name="Returned" stackId="a" fill="#EF4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No shipping data available.</div>
                    )}
                </div>
            </div>
            
            {/* Detailed Table */}
            <div className="glass-panel" style={{ padding: '24px', overflow: 'hidden' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 16px 0', color: 'var(--color-text-main)' }}>Company Breakdowns</h3>
                <div style={{ overflowX: 'auto' }}>
                    <table className="spreadsheet-table">
                        <thead>
                            <tr>
                                <th>Company</th>
                                <th style={{ textAlign: 'right' }}>Total Orders</th>
                                <th style={{ textAlign: 'right' }}>Value Moved</th>
                                <th style={{ textAlign: 'center' }}>Delivered</th>
                                <th style={{ textAlign: 'center' }}>Shipped</th>
                                <th style={{ textAlign: 'center' }}>Returned</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shippingData.map(co => (
                                <tr key={co.name}>
                                    <td style={{ fontWeight: 500 }}>{co.name}</td>
                                    <td style={{ textAlign: 'right' }}>{co.totalOrders}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>${co.totalValue.toFixed(2)}</td>
                                    <td style={{ textAlign: 'center', color: 'var(--color-green)' }}>{co.delivered}</td>
                                    <td style={{ textAlign: 'center', color: 'var(--color-primary)' }}>{co.shipped}</td>
                                    <td style={{ textAlign: 'center', color: 'var(--color-red)' }}>{co.returned}</td>
                                </tr>
                            ))}
                            {shippingData.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-secondary)' }}>No data</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
};

export default ShippingReport;
