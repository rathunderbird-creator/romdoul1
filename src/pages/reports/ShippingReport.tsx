import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { Truck, PackageCheck, Package, DollarSign, Settings } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import type { Sale } from '../../types';

const COLORS = ['#8B5CF6', '#EC4899', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#6B7280'];
const STATUS_OPTIONS = ['Delivered', 'Shipped', 'Pending', 'Confirmed', 'Ordered', 'Returned', 'Cancelled'];

const ShippingReport: React.FC = () => {
    const { reportSales } = useOutletContext<any>();
    const { shippingCompanies, shippingRates, updateShippingRate } = useStore();
    const { showToast } = useToast();

    const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
    const [showRatesPanel, setShowRatesPanel] = useState(false);
    const [rateInputs, setRateInputs] = useState<Record<string, string>>({});

    // Initialize rate inputs when panel opens
    const openRatesPanel = () => {
        const inputs: Record<string, string> = {};
        // Collect all company names from config + report data
        const allCompanies = new Set([...shippingCompanies]);
        (reportSales || []).forEach((sale: Sale) => {
            const co = sale.shipping?.company;
            if (co) allCompanies.add(co);
        });
        allCompanies.forEach(co => {
            inputs[co] = String(shippingRates[co] || '');
        });
        setRateInputs(inputs);
        setShowRatesPanel(true);
    };

    const saveAllRates = () => {
        Object.entries(rateInputs).forEach(([company, value]) => {
            const val = parseFloat(value);
            if (!isNaN(val) && val >= 0) {
                updateShippingRate(company, val);
            }
        });
        showToast('All shipping rates saved successfully!', 'success');
        setShowRatesPanel(false);
    };

    const saveSingleRate = (company: string) => {
        const val = parseFloat(rateInputs[company] || '0');
        if (!isNaN(val) && val >= 0) {
            updateShippingRate(company, val);
            showToast(`Rate for ${company} set to $${val.toFixed(2)}`, 'success');
        }
    };

    const { shippingData, totalOrders, totalDelivered, totalShippingCost, topCompany } = useMemo(() => {
        const companyMap = new Map<string, { name: string; totalOrders: number; totalValue: number; shippingCost: number; costPerItem: number; delivered: number; shipped: number; returned: number; pending: number; other: number }>();
        let totalOrd = 0, totalDel = 0;

        (reportSales || []).forEach((sale: Sale) => {
            const status = sale.shipping?.status || 'Pending';
            if (statusFilter.size > 0 && !statusFilter.has(status)) return;

            const coName = sale.shipping?.company || 'Unassigned';
            if (!companyMap.has(coName)) companyMap.set(coName, { name: coName, totalOrders: 0, totalValue: 0, shippingCost: 0, costPerItem: shippingRates[coName] || 0, delivered: 0, shipped: 0, returned: 0, pending: 0, other: 0 });
            const r = companyMap.get(coName)!;
            r.totalOrders += 1;
            r.totalValue += sale.total;
            r.shippingCost += sale.shipping?.cost || 0;
            totalOrd += 1;
            if (status === 'Delivered') { r.delivered += 1; totalDel += 1; }
            else if (status === 'Shipped') r.shipped += 1;
            else if (status === 'Returned') r.returned += 1;
            else if (status === 'Pending' || status === 'Ordered' || status === 'Confirmed') r.pending += 1;
            else r.other += 1;
        });

        const data = Array.from(companyMap.values()).sort((a, b) => b.totalOrders - a.totalOrders);
        return {
            shippingData: data,
            totalOrders: totalOrd,
            totalDelivered: totalDel,
            totalShippingCost: data.reduce((s, d) => s + (d.totalOrders * d.costPerItem), 0),
            topCompany: data[0] || null
        };
    }, [reportSales, statusFilter, shippingRates]);

    const toggleStatus = (s: string) => {
        setStatusFilter(prev => { const next = new Set(prev); if (next.has(s)) next.delete(s); else next.add(s); return next; });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Shipping Companies Analytics</h2>
                <button
                    onClick={openRatesPanel}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                        cursor: 'pointer', border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)', color: 'var(--color-text-primary)',
                        transition: 'all 0.2s'
                    }}
                >
                    <Settings size={14} />
                    Set Shipping Rates
                </button>
            </div>

            {/* Shipping Rates Config Panel */}
            {showRatesPanel && (
                <div className="glass-panel" style={{ padding: '20px', border: '1px solid rgba(245,158,11,0.3)', background: 'linear-gradient(135deg, rgba(245,158,11,0.05), transparent)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <div>
                            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <DollarSign size={16} style={{ color: '#F59E0B' }} />
                                Shipping Rates (Cost per Item)
                            </h3>
                            <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '4px 0 0 0' }}>
                                Set once — rates are saved and applied automatically to all reports. No need to re-enter daily.
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={() => setShowRatesPanel(false)}
                                style={{
                                    padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                                    cursor: 'pointer', border: '1px solid var(--color-border)',
                                    background: 'transparent', color: 'var(--color-text-secondary)'
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveAllRates}
                                style={{
                                    padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                                    cursor: 'pointer', border: 'none',
                                    background: 'var(--color-primary)', color: 'white'
                                }}
                            >
                                Save All
                            </button>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                        {Object.keys(rateInputs).map(company => (
                            <div key={company} style={{
                                display: 'flex', flexDirection: 'column', gap: '4px',
                                padding: '12px', borderRadius: '10px',
                                background: 'var(--color-surface)', border: '1px solid var(--color-border)'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{company}</label>
                                    {shippingRates[company] !== undefined && shippingRates[company] > 0 && (
                                        <span style={{ fontSize: '10px', color: '#10B981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px' }}>
                                            Saved ✓
                                        </span>
                                    )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>$</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={rateInputs[company]}
                                        onChange={e => setRateInputs(prev => ({ ...prev, [company]: e.target.value }))}
                                        onBlur={() => saveSingleRate(company)}
                                        onKeyDown={e => { if (e.key === 'Enter') saveSingleRate(company); }}
                                        placeholder="0.00"
                                        style={{
                                            flex: 1, padding: '6px 8px', fontSize: '14px', fontWeight: 600,
                                            borderRadius: '6px', border: '1px solid var(--color-border)',
                                            background: 'var(--color-surface-hover)', color: 'var(--color-text-primary)',
                                            outline: 'none', textAlign: 'right', width: '100%'
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(59,130,246,0.2)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Orders</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(59,130,246,0.15)', color: '#3B82F6' }}><Truck size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800 }}>{totalOrders}</div>
                </div>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(16,185,129,0.2)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Delivered</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(16,185,129,0.15)', color: '#10B981' }}><PackageCheck size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800 }}>{totalDelivered}</div>
                </div>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.1), rgba(139,92,246,0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(139,92,246,0.2)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Top Company</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(139,92,246,0.15)', color: '#8B5CF6' }}><Package size={18} /></div>
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '4px' }}>{topCompany ? topCompany.name : 'N/A'}</div>
                </div>
                <div className="stats-card hover-lift" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.02))', padding: '20px', borderRadius: '16px', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Shipping Expense</span>
                        <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}><DollarSign size={18} /></div>
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: '#EF4444' }}>${totalShippingCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
            </div>

            {/* Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
                <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '400px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Volume by Company</h3>
                    {shippingData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={shippingData} layout="vertical" margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                                <XAxis type="number" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis dataKey="name" type="category" width={100} stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip cursor={{ fill: 'rgba(59,130,246,0.05)' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(v: any) => [`${v}`, 'Total Orders']} />
                                <Bar dataKey="totalOrders" fill="#3B82F6" radius={[0, 4, 4, 0]} barSize={24}>
                                    {shippingData.map((_, i) => <Cell key={`c-${i}`} fill={COLORS[i % COLORS.length]} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No shipping data available.</div>}
                </div>
                <div className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '400px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Delivery Status Breakdown</h3>
                    {shippingData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={shippingData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                <XAxis dataKey="name" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} angle={-45} textAnchor="end" height={60} />
                                <YAxis stroke="var(--color-text-secondary)" fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                <Bar dataKey="delivered" name="Delivered" stackId="a" fill="#10B981" barSize={32} />
                                <Bar dataKey="shipped" name="Shipped" stackId="a" fill="#3B82F6" />
                                <Bar dataKey="pending" name="Pending" stackId="a" fill="#F59E0B" />
                                <Bar dataKey="returned" name="Returned" stackId="a" fill="#EF4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>No shipping data available.</div>}
                </div>
            </div>

            {/* Company Breakdowns Table */}
            <div className="glass-panel" style={{ padding: '24px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Company Breakdowns</h3>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginRight: '4px' }}>Status:</span>
                        <button onClick={() => setStatusFilter(new Set())} style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--color-border)', background: statusFilter.size === 0 ? 'var(--color-primary)' : 'transparent', color: statusFilter.size === 0 ? 'white' : 'var(--color-text-secondary)', transition: 'all 0.2s' }}>All</button>
                        {STATUS_OPTIONS.map(s => (
                            <button key={s} onClick={() => toggleStatus(s)} style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--color-border)', background: statusFilter.has(s) ? (s === 'Delivered' ? '#10B981' : s === 'Shipped' ? '#3B82F6' : s === 'Returned' || s === 'Cancelled' ? '#EF4444' : '#F59E0B') : 'transparent', color: statusFilter.has(s) ? 'white' : 'var(--color-text-secondary)', transition: 'all 0.2s' }}>{s}</button>
                        ))}
                    </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="spreadsheet-table">
                        <thead>
                            <tr>
                                <th>Company</th>
                                <th style={{ textAlign: 'right' }}>Orders</th>
                                <th style={{ textAlign: 'right' }}>Value Moved</th>
                                <th style={{ textAlign: 'right' }}>Cost/Item</th>
                                <th style={{ textAlign: 'right' }}>Total Cost</th>
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
                                    <td style={{ textAlign: 'right', color: '#F59E0B', fontWeight: 600 }}>
                                        ${co.costPerItem.toFixed(2)}
                                        {co.costPerItem === 0 && (
                                            <span
                                                onClick={openRatesPanel}
                                                style={{ fontSize: '10px', color: 'var(--color-text-muted)', cursor: 'pointer', marginLeft: '4px', textDecoration: 'underline' }}
                                            >set</span>
                                        )}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>${(co.totalOrders * co.costPerItem).toFixed(2)}</td>
                                    <td style={{ textAlign: 'center', color: 'var(--color-green)' }}>{co.delivered}</td>
                                    <td style={{ textAlign: 'center', color: 'var(--color-primary)' }}>{co.shipped}</td>
                                    <td style={{ textAlign: 'center', color: 'var(--color-red)' }}>{co.returned}</td>
                                </tr>
                            ))}
                            {shippingData.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-secondary)' }}>No data</td></tr>}
                        </tbody>
                        <tfoot>
                            <tr style={{ fontWeight: 700, background: 'var(--color-surface-hover)' }}>
                                <td>Total</td>
                                <td style={{ textAlign: 'right' }}>{shippingData.reduce((s, c) => s + c.totalOrders, 0)}</td>
                                <td style={{ textAlign: 'right' }}>${shippingData.reduce((s, c) => s + c.totalValue, 0).toFixed(2)}</td>
                                <td style={{ textAlign: 'right', color: '#F59E0B' }}>—</td>
                                <td style={{ textAlign: 'right', color: '#EF4444' }}>${shippingData.reduce((s, c) => s + (c.totalOrders * c.costPerItem), 0).toFixed(2)}</td>
                                <td style={{ textAlign: 'center', color: 'var(--color-green)' }}>{shippingData.reduce((s, c) => s + c.delivered, 0)}</td>
                                <td style={{ textAlign: 'center', color: 'var(--color-primary)' }}>{shippingData.reduce((s, c) => s + c.shipped, 0)}</td>
                                <td style={{ textAlign: 'center', color: 'var(--color-red)' }}>{shippingData.reduce((s, c) => s + c.returned, 0)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                    💡 Rates are saved permanently. Click "Set Shipping Rates" to adjust. Total Cost = Orders × Cost/Item.
                </p>
            </div>
        </div>
    );
};

export default ShippingReport;
