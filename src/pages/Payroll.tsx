import React, { useState, useEffect, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import { usePayroll } from '../hooks/usePayroll';
import { AlertCircle, Edit2, CalendarDays } from 'lucide-react';
import type { User } from '../types';
import { useToast } from '../context/ToastContext';

// Helper to get initials
const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?';
};

const Payroll: React.FC = () => {
    const { users, roles, updateUser, currency } = useStore();
    const { attendances, isLoading, error, fetchAttendanceForPeriod } = usePayroll();
    const { showToast } = useToast();

    // Default to current month
    const currentDate = new Date();
    const [selectedMonth, setSelectedMonth] = useState(`${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`);
    
    // Edit base salary tracking
    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [tempBaseSalary, setTempBaseSalary] = useState<string>('');
    const [savingId, setSavingId] = useState<string | null>(null);

    // Fetch data when month changes
    useEffect(() => {
        if (!selectedMonth) return;
        
        const [year, month] = selectedMonth.split('-');
        
        // Ensure accurate start and end dates of the selected month
        const startDate = new Date(parseInt(year), parseInt(month) - 1, 1).toISOString().split('T')[0];
        const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0]; // last day of month
        
        // This will trigger the fetch in the custom hook
        fetchAttendanceForPeriod(startDate, endDate);
        
    }, [selectedMonth, fetchAttendanceForPeriod]);

    const handleSalaryUpdate = async (userId: string) => {
        const val = Number(tempBaseSalary);
        if (isNaN(val)) {
            showToast('Invalid salary amoount', 'error');
            return;
        }

        setSavingId(userId);
        try {
            await updateUser(userId, { baseSalary: val });
            showToast('Base salary updated successfully', 'success');
            setEditingUserId(null);
        } catch (err) {
            showToast('Failed to update base salary', 'error');
        } finally {
            setSavingId(null);
        }
    };

    // Derived Payroll Calculations (Computed directly in React to reflect any instant DB updates to user or attendance)
    const payrollData = useMemo(() => {
        const [yearStr, monthStr] = selectedMonth.split('-');
        const year = parseInt(yearStr);
        const month = parseInt(monthStr);
        // Get the total number of days in the month to calculate accurate daily rates
        const daysInMonth = new Date(year, month, 0).getDate();

        return users.map((user: User) => {
            const userRecords = attendances.filter(a => a.userId === user.id);
            
            const stats = {
                Present: 0,
                Absent: 0,
                Late: 0,
                HalfDay: 0,
                Leave: 0
            };

            userRecords.forEach(record => {
                if (record.status === 'Present') stats.Present++;
                if (record.status === 'Absent') stats.Absent++;
                if (record.status === 'Late') stats.Late++;
                if (record.status === 'Half Day') stats.HalfDay++;
                if (record.status === 'Leave') stats.Leave++;
            });

            const baseSalary = user.baseSalary || 0;
            const dailyRate = baseSalary / daysInMonth;

            // Simple business logic calculation (You can tune these deductions later!):
            const absentDeduction = stats.Absent * dailyRate;
            const halfDayDeduction = stats.HalfDay * (dailyRate * 0.5);
            // No deduction for Late or Leave by default, purely tracked administratively right now
            const totalDeductions = absentDeduction + halfDayDeduction;
            
            const netSalary = Math.max(0, baseSalary - totalDeductions);

            return {
                user,
                stats,
                baseSalary,
                dailyRate,
                totalDeductions,
                netSalary
            };
        });
    }, [users, attendances, selectedMonth]);

    const currencySymbol = currency || '$';

    return (
        <div style={{ animation: 'fadeIn 0.3s ease' }}>
             {/* Header */}
             <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>                
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--color-surface)', padding: '10px 16px', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                    <CalendarDays size={22} color="var(--color-primary)" />
                    <input 
                        type="month" 
                        value={selectedMonth} 
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--color-text)',
                            fontSize: '15px',
                            fontWeight: '700',
                            outline: 'none',
                            cursor: 'pointer'
                        }}
                    />
                </div>
            </div>

            {/* Error Banner */}
            {error && (
                <div style={{ padding: '16px 20px', backgroundColor: 'rgba(239, 68, 68, 0.12)', borderLeft: '4px solid var(--color-danger)', color: 'var(--color-text)', borderRadius: '8px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '15px' }}>
                    <AlertCircle size={24} color="var(--color-danger)" />
                    <div>{error}</div>
                </div>
            )}

            {/* Content Table */}
            <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', border: '1px solid var(--color-border)' }}>
                {isLoading ? (
                    <div style={{ padding: '64px', display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '16px' }}>
                        <div className="loader" style={{ width: '48px', height: '48px' }}>Loading...</div>
                        <p style={{ color: 'var(--color-text-muted)' }}>Calculating Payroll for {selectedMonth}...</p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                            <thead style={{ background: 'var(--color-bg-secondary)' }}>
                                <tr>
                                    <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 'bold', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Staff Member</th>
                                    <th style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Present</th>
                                    <th style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Absent</th>
                                    <th style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Late / Half</th>
                                    <th style={{ padding: '16px', textAlign: 'right', fontWeight: 'bold', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Leaves</th>
                                    <th style={{ padding: '16px 24px', textAlign: 'right', fontWeight: 'bold', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Base Salary</th>
                                    <th style={{ padding: '16px 24px', textAlign: 'right', fontWeight: 'bold', color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'rgba(34, 197, 94, 0.05)' }}>Net Salary</th>
                                </tr>
                            </thead>
                            <tbody>
                                {payrollData.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                            No users found. Go to User Management to add staff.
                                        </td>
                                    </tr>
                                ) : (
                                    payrollData.map(({ user, stats, baseSalary, netSalary, totalDeductions }) => {
                                        return (
                                            <tr key={user.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--color-background)'} onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                
                                                {/* Staff Column */}
                                                <td style={{ padding: '16px 24px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                        <div style={{ 
                                                            width: '40px', height: '40px', 
                                                            borderRadius: '50%', backgroundColor: 'var(--color-primary-light)', 
                                                            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            fontWeight: 'bold'
                                                        }}>
                                                            {getInitials(user.name)}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontWeight: 'bold', color: 'var(--color-text)' }}>{user.name}</div>
                                                            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                                {roles.find(r => r.id === user.roleId)?.name || user.roleId}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Stats Columns */}
                                                <td style={{ padding: '16px', textAlign: 'center', fontWeight: '500', color: 'var(--color-success)' }}>
                                                    {stats.Present}
                                                </td>
                                                <td style={{ padding: '16px', textAlign: 'center', fontWeight: '600', color: stats.Absent > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                                                    {stats.Absent}
                                                </td>
                                                <td style={{ padding: '16px', textAlign: 'center', fontWeight: '500' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: (stats.Late > 0 || stats.HalfDay > 0) ? 'var(--color-warning)' : 'var(--color-text-muted)'}}>
                                                        <span>{stats.Late} L</span>
                                                        <span style={{ color: 'var(--color-border)' }}>|</span>
                                                        <span>{stats.HalfDay} H</span>
                                                    </div>
                                                </td>
                                                <td style={{ padding: '16px', textAlign: 'right', fontWeight: '500', color: stats.Leave > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                                                    {stats.Leave}
                                                </td>

                                                {/* Edit Base Salary Column */}
                                                <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                                    {editingUserId === user.id ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                                                            <input
                                                                type="number"
                                                                autoFocus
                                                                value={tempBaseSalary}
                                                                onChange={(e) => setTempBaseSalary(e.target.value)}
                                                                style={{
                                                                    width: '80px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-primary)',
                                                                    background: 'transparent', color: 'var(--color-text)', textAlign: 'right', fontWeight: 'bold'
                                                                }}
                                                                onKeyDown={(e) => { if (e.key === 'Enter') handleSalaryUpdate(user.id); if(e.key === 'Escape') setEditingUserId(null); }}
                                                            />
                                                            <button 
                                                                onClick={() => handleSalaryUpdate(user.id)}
                                                                disabled={savingId === user.id}
                                                                style={{ padding: '6px 10px', background: 'var(--color-primary)', color: 'white', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px'}}
                                                            >
                                                                {savingId === user.id ? '...' : 'Save'}
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div 
                                                            onClick={() => { setEditingUserId(user.id); setTempBaseSalary(baseSalary.toString()); }}
                                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', cursor: 'pointer' }}
                                                            className="salary-hover"
                                                        >
                                                            <Edit2 size={14} className="edit-icon" style={{ opacity: 0.3 }} />
                                                            <span style={{ fontWeight: 'bold', fontSize: '15px', color: baseSalary > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                                                                {Number(baseSalary).toLocaleString('en-US', { style: 'currency', currency: 'USD' }).replace('$', currencySymbol)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </td>

                                                {/* Final Net Salary */}
                                                <td style={{ padding: '16px 24px', textAlign: 'right', backgroundColor: 'rgba(34, 197, 94, 0.05)' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                                        <span style={{ fontWeight: '800', fontSize: '18px', color: 'var(--color-text)' }}>
                                                            {Number(netSalary).toLocaleString('en-US', { style: 'currency', currency: 'USD' }).replace('$', currencySymbol)}
                                                        </span>
                                                        {totalDeductions > 0 && (
                                                            <span style={{ fontSize: '12px', color: 'var(--color-danger)', fontWeight: 'bold' }}>
                                                                -{Number(totalDeductions).toLocaleString('en-US', { style: 'currency', currency: 'USD' }).replace('$', currencySymbol)} deductions
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                            </tr>
                                        )
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            {/* Some CSS for hover effects */}
            <style>
                {`
                    .salary-hover:hover .edit-icon {
                        opacity: 1 !important;
                        color: var(--color-primary);
                    }
                `}
            </style>
        </div>
    );
};

export default Payroll;
