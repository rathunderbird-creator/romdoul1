import React, { useMemo } from 'react';
import { useStore } from '../../context/StoreContext';
import { useOutletContext } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Users, Award } from 'lucide-react';

const StaffPerformance: React.FC = () => {
    const { salesmen } = useStore();
    const { reportSales, startDate, endDate } = useOutletContext<any>();

    const { staffData, topSalesman } = useMemo(() => {
        const staffMap = new Map<string, { name: string; revenue: number; orders: number }>();
        
        // Initialize with known salesmen
        salesmen.forEach(name => {
            staffMap.set(name, { name, revenue: 0, orders: 0 });
        });

        const validSales = (reportSales || []).filter((s:any) => s.paymentStatus === 'Paid');
        validSales.forEach((sale: any) => {
            const sm = sale.salesman || 'Unassigned';
            if (!staffMap.has(sm)) staffMap.set(sm, { name: sm, revenue: 0, orders: 0 });
            
            const record = staffMap.get(sm)!;
            record.revenue += sale.total;
            record.orders += 1;
        });

        const data = Array.from(staffMap.values()).sort((a, b) => b.revenue - a.revenue);
        const top = data.length > 0 && data[0].revenue > 0 ? data[0] : null;

        return {
            staffData: data,
            topSalesman: top
        };
    }, [reportSales, salesmen, startDate, endDate]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Staff Performance</h2>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(139, 92, 246, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(139, 92, 246, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Active Staff</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6' }}><Users size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)' }}>{staffData.length}</div>
                </div>

                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.1), rgba(236, 72, 153, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(236, 72, 153, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Top Performer</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(236, 72, 153, 0.15)', color: '#EC4899' }}><Award size={18} /></div>
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text-main)', marginTop: '4px' }}>{topSalesman ? topSalesman.name : 'N/A'}</div>
                </div>
            </div>

            {/* Performance Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
                {/* Revenue by Staff */}
                <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '400px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Revenue by Staff</h3>
                    {staffData.some(d => d.revenue > 0) ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={staffData} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                                <XAxis type="number" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                                <YAxis dataKey="name" type="category" width={100} stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    cursor={{ fill: 'rgba(139, 92, 246, 0.05)' }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                    formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Revenue']}
                                />
                                <Bar dataKey="revenue" fill="#8B5CF6" radius={[0, 4, 4, 0]} barSize={24} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No staff revenue data.</div>
                    )}
                </div>

                {/* Orders by Staff */}
                <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '400px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>Orders Processed</h3>
                    {staffData.some(d => d.orders > 0) ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={staffData} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                                <XAxis type="number" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis dataKey="name" type="category" width={100} stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    cursor={{ fill: 'rgba(236, 72, 153, 0.05)' }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                    formatter={(value: any) => [`${value}`, 'Orders Processed']}
                                />
                                <Bar dataKey="orders" fill="#EC4899" radius={[0, 4, 4, 0]} barSize={24} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No staff order data.</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StaffPerformance;
