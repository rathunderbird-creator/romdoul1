import React, { useMemo, useState, useEffect } from 'react';
import { useStore } from '../../context/StoreContext';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Users, Award, Target, Save, X } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { supabase } from '../../lib/supabase';

const StaffPerformance: React.FC = () => {
    const { users, updateUser, salesmen, currentUser } = useStore();
    const { reportSales, startDate, endDate } = useOutletContext<any>();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const navigate = useNavigate();

    const handleNavigateToOrders = (salesman?: string) => {
        if (salesman) {
            localStorage.setItem('orders_salesmanFilter', salesman);
        }
        navigate('/orders');
    };

    const [salesForTargets, setSalesForTargets] = useState<any[]>([]);
    const [isLoadingTargets, setIsLoadingTargets] = useState(false);
    const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
    const [targetModalUserId, setTargetModalUserId] = useState<string | null>(null);
    const [tempTargets, setTempTargets] = useState<Record<string, { dailyTarget: number; weeklyTarget: number; monthlyTarget: number }>>({});

    // Fetch monthly sales for targets (paid sales from the current month to today)
    useEffect(() => {
        const fetchSalesForTargets = async () => {
            setIsLoadingTargets(true);
            try {
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                
                const { data, error } = await supabase
                    .from('sales')
                    .select('total, date, salesman, payment_status')
                    .eq('payment_status', 'Paid')
                    .gte('date', startOfMonth.toISOString());

                if (error) throw error;
                setSalesForTargets(data || []);
            } catch (err) {
                console.error("Failed to fetch sales for targets:", err);
            } finally {
                setIsLoadingTargets(false);
            }
        };

        fetchSalesForTargets();
    }, [reportSales]);

    // Calculate actual sales for today, this week, and this month
    const targetActuals = useMemo(() => {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        const currentDay = now.getDay();
        const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
        startOfWeek.setHours(0, 0, 0, 0);

        const map = new Map<string, { daily: number; weekly: number; monthly: number }>();

        salesForTargets.forEach((sale) => {
            const sm = sale.salesman || '';
            if (!sm) return;

            if (!map.has(sm)) {
                map.set(sm, { daily: 0, weekly: 0, monthly: 0 });
            }

            const stats = map.get(sm)!;
            const saleDate = new Date(sale.date);

            stats.monthly += Number(sale.total) || 0;

            if (saleDate >= startOfWeek) {
                stats.weekly += Number(sale.total) || 0;
            }

            if (saleDate >= startOfToday) {
                stats.daily += Number(sale.total) || 0;
            }
        });

        return map;
    }, [salesForTargets]);

    // Filter to display salesmen users or anyone with targets configured
    const targetUsers = useMemo(() => {
        return users.filter(u => 
            u.roleId === 'salesman' || 
            (u.dailyTarget || 0) > 0 || 
            (u.weeklyTarget || 0) > 0 || 
            (u.monthlyTarget || 0) > 0
        );
    }, [users]);

    // Chart aggregations (based on reportSales global date range)
    const { staffData, topSalesman } = useMemo(() => {
        const staffMap = new Map<string, { name: string; revenue: number; orders: number }>();
        
        // Initialize with known salesmen
        salesmen.forEach(name => {
            staffMap.set(name, { name, revenue: 0, orders: 0 });
        });

        const validSales = (reportSales || []).filter((s: any) => s.paymentStatus === 'Paid');
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

    // Modal target operations
    const handleOpenSetTargetsModal = (userId?: string) => {
        const initialTemp: typeof tempTargets = {};
        users.forEach(u => {
            initialTemp[u.id] = {
                dailyTarget: u.dailyTarget || 0,
                weeklyTarget: u.weeklyTarget || 0,
                monthlyTarget: u.monthlyTarget || 0
            };
        });
        setTempTargets(initialTemp);
        setTargetModalUserId(userId || null);
        setIsTargetModalOpen(true);
    };

    const handleSaveTargets = async () => {
        try {
            const promises = Object.entries(tempTargets).map(async ([userId, tgs]) => {
                const u = users.find(usr => usr.id === userId);
                if (u) {
                    if (
                        (u.dailyTarget || 0) !== tgs.dailyTarget ||
                        (u.weeklyTarget || 0) !== tgs.weeklyTarget ||
                        (u.monthlyTarget || 0) !== tgs.monthlyTarget
                    ) {
                        await updateUser(userId, tgs);
                    }
                }
            });
            await Promise.all(promises);
            showToast(t('targets.saveSuccess'), 'success');
            setIsTargetModalOpen(false);
        } catch (err) {
            console.error(err);
            showToast(t('targets.saveError'), 'error');
        }
    };

    // Render individual target progress bar details
    const renderProgressRow = (label: string, actual: number, target: number) => {
        const percent = target > 0 ? Math.round((actual / target) * 100) : 0;
        
        let barColor = 'var(--color-border)';
        let badgeBg = 'rgba(156, 163, 175, 0.1)';
        let badgeColor = 'var(--color-text-secondary)';

        if (target > 0) {
            if (percent >= 100) {
                barColor = '#10B981'; // Green
                badgeBg = 'rgba(16, 185, 129, 0.15)';
                badgeColor = '#10B981';
            } else if (percent >= 50) {
                barColor = '#3B82F6'; // Blue
                badgeBg = 'rgba(59, 130, 246, 0.15)';
                badgeColor = '#3B82F6';
            } else {
                barColor = '#F59E0B'; // Orange
                badgeBg = 'rgba(245, 158, 11, 0.15)';
                badgeColor = '#F59E0B';
            }
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                    <span style={{ fontWeight: 500, color: 'var(--color-text-main)' }}>{label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: 'var(--color-text-secondary)' }}>
                            ${actual.toFixed(2)} / <span style={{ fontWeight: 600 }}>${target.toFixed(2)}</span>
                        </span>
                        {target > 0 && (
                            <span style={{
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                background: badgeBg,
                                color: badgeColor
                            }}>
                                {percent}%
                            </span>
                        )}
                    </div>
                </div>
                <div style={{ width: '100%', height: '8px', background: 'var(--color-bg-secondary)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                        width: `${Math.min(percent, 100)}%`,
                        height: '100%',
                        background: barColor,
                        borderRadius: '4px',
                        transition: 'width 0.5s ease-out'
                    }} />
                </div>
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>{t('nav.staffPerformance')}</h2>
                {currentUser?.roleId === 'admin' && (
                    <button
                        onClick={() => handleOpenSetTargetsModal()}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'var(--color-primary)',
                            color: 'white',
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: 500,
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            transition: 'all 0.2s'
                        }}
                        onMouseOver={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                        onMouseOut={e => e.currentTarget.style.filter = 'none'}
                    >
                        <Target size={16} /> {t('targets.setTargets')}
                    </button>
                )}
            </div>

            {/* Sales Targets & Progress Dashboard */}
            <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Target size={18} style={{ color: 'var(--color-primary)' }} /> {t('targets.title')}
                    {isLoadingTargets && <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 'normal', fontStyle: 'italic' }}>({t('common.loading')})</span>}
                </h3>
                {targetUsers.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                        {targetUsers.map(user => {
                            const stats = targetActuals.get(user.name) || { daily: 0, weekly: 0, monthly: 0 };
                            return (
                                <div key={user.id} style={{ background: 'var(--color-bg-secondary)', borderRadius: '12px', padding: '20px', border: '1px solid var(--color-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', borderBottom: '1px solid var(--color-border)', paddingBottom: '12px' }}>
                                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-light))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', fontSize: '16px' }}>
                                            {user.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div 
                                            style={{ cursor: 'pointer', flex: 1 }}
                                            onClick={() => handleNavigateToOrders(user.name)}
                                            onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                                            onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
                                        >
                                            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)' }}>{user.name}</h4>
                                            <span style={{
                                                padding: '2px 8px',
                                                borderRadius: '10px',
                                                background: 'rgba(59, 130, 246, 0.1)',
                                                color: '#3B82F6',
                                                fontSize: '11px',
                                                fontWeight: 500,
                                                marginTop: '4px',
                                                display: 'inline-block'
                                            }}>
                                                {user.roleId.charAt(0).toUpperCase() + user.roleId.slice(1)}
                                            </span>
                                        </div>
                                        {currentUser?.roleId === 'admin' && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleOpenSetTargetsModal(user.id);
                                                }}
                                                style={{
                                                    background: 'var(--color-surface)',
                                                    border: '1px solid var(--color-border)',
                                                    padding: '6px 10px',
                                                    borderRadius: '8px',
                                                    cursor: 'pointer',
                                                    fontSize: '12px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    color: 'var(--color-text-secondary)',
                                                    transition: 'all 0.2s',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                }}
                                                onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.color = 'var(--color-primary)'; }}
                                                onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                                                title="Set Target"
                                            >
                                                <Target size={14} /> Set
                                            </button>
                                        )}
                                    </div>
                                    {renderProgressRow(t('targets.dailyTarget'), stats.daily, user.dailyTarget || 0)}
                                    {renderProgressRow(t('targets.weeklyTarget'), stats.weekly, user.weeklyTarget || 0)}
                                    {renderProgressRow(t('targets.monthlyTarget'), stats.monthly, user.monthlyTarget || 0)}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-secondary)' }}>
                        No salesman target profiles configured. Edit user settings to establish targets.
                    </div>
                )}
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(139, 92, 246, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(139, 92, 246, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Active Staff</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6' }}><Users size={18} /></div>
                    </div>
                    <div 
                        style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)', cursor: 'pointer' }}
                        onClick={() => handleNavigateToOrders('All')}
                        title="Go to Orders"
                    >
                        {staffData.length}
                    </div>
                </div>

                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.1), rgba(236, 72, 153, 0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(236, 72, 153, 0.2)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Top Performer</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(236, 72, 153, 0.15)', color: '#EC4899' }}><Award size={18} /></div>
                    </div>
                    <div 
                        style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text-main)', marginTop: '4px', cursor: topSalesman ? 'pointer' : 'default' }}
                        onClick={() => topSalesman ? handleNavigateToOrders(topSalesman.name) : undefined}
                        title={topSalesman ? "Go to Orders for " + topSalesman.name : undefined}
                    >
                        {topSalesman ? topSalesman.name : 'N/A'}
                    </div>
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
                                <Bar 
                                    dataKey="revenue" 
                                    fill="#8B5CF6" 
                                    radius={[0, 4, 4, 0]} 
                                    barSize={24} 
                                    onClick={(data) => handleNavigateToOrders(data.name)} 
                                    style={{ cursor: 'pointer' }} 
                                />
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
                                <Bar 
                                    dataKey="orders" 
                                    fill="#EC4899" 
                                    radius={[0, 4, 4, 0]} 
                                    barSize={24} 
                                    onClick={(data) => handleNavigateToOrders(data.name)} 
                                    style={{ cursor: 'pointer' }} 
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No staff order data.</div>
                    )}
                </div>
            </div>

            {/* Set Targets Modal */}
            {isTargetModalOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
                    <div style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '16px', width: '650px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', border: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--color-border)', paddingBottom: '12px' }}>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Target size={20} style={{ color: 'var(--color-primary)' }} /> {t('targets.setTargets')}
                            </h3>
                            <button onClick={() => setIsTargetModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', padding: '4px' }}><X size={20} /></button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid var(--color-border)', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                                        <th style={{ textAlign: 'left', padding: '8px 12px' }}>{t('targets.salesman')}</th>
                                        <th style={{ textAlign: 'center', padding: '8px 12px', width: '120px' }}>Daily ($)</th>
                                        <th style={{ textAlign: 'center', padding: '8px 12px', width: '120px' }}>Weekly ($)</th>
                                        <th style={{ textAlign: 'center', padding: '8px 12px', width: '120px' }}>Monthly ($)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.filter(u => (u.roleId === 'salesman' || u.roleId === 'store_manager' || u.roleId === 'cashier') && (!targetModalUserId || u.id === targetModalUserId)).map(user => {
                                        const values = tempTargets[user.id] || { dailyTarget: 0, weeklyTarget: 0, monthlyTarget: 0 };
                                        return (
                                            <tr key={user.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <td style={{ padding: '12px' }}>
                                                    <div style={{ fontWeight: 500, color: 'var(--color-text-main)' }}>{user.name}</div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{user.email}</div>
                                                </td>
                                                <td style={{ padding: '8px 4px' }}>
                                                    <input
                                                        type="number"
                                                        value={values.dailyTarget}
                                                        onChange={e => setTempTargets({
                                                            ...tempTargets,
                                                            [user.id]: { ...values, dailyTarget: parseFloat(e.target.value) || 0 }
                                                        })}
                                                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', textAlign: 'right' }}
                                                    />
                                                </td>
                                                <td style={{ padding: '8px 4px' }}>
                                                    <input
                                                        type="number"
                                                        value={values.weeklyTarget}
                                                        onChange={e => setTempTargets({
                                                            ...tempTargets,
                                                            [user.id]: { ...values, weeklyTarget: parseFloat(e.target.value) || 0 }
                                                        })}
                                                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', textAlign: 'right' }}
                                                    />
                                                </td>
                                                <td style={{ padding: '8px 4px' }}>
                                                    <input
                                                        type="number"
                                                        value={values.monthlyTarget}
                                                        onChange={e => setTempTargets({
                                                            ...tempTargets,
                                                            [user.id]: { ...values, monthlyTarget: parseFloat(e.target.value) || 0 }
                                                        })}
                                                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', textAlign: 'right' }}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
                            <button onClick={() => setIsTargetModalOpen(false)} style={{ padding: '8px 16px', borderRadius: '8px', background: 'none', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer', fontSize: '14px' }}>Cancel</button>
                            <button onClick={handleSaveTargets} style={{ padding: '8px 20px', borderRadius: '8px', background: 'var(--color-primary)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 500 }}>
                                <Save size={16} /> Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StaffPerformance;
