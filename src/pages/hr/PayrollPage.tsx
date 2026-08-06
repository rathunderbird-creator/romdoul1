import { useState, useEffect, useMemo } from 'react';
import { Plus, Edit, Trash2, DollarSign, CheckCircle, CreditCard, Banknote } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal, StatusBadge } from '../../components';
import { useHR } from '../../hooks/useHR';
import type { PayrollRun } from '../../types';

const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
};

const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 45%)`;
};

const PayrollPage = () => {
    const { setHeaderContent } = useHeader();
    const { payrollRuns, employees, isLoading, fetchPayrollRuns, fetchEmployees, savePayrollRun, deletePayrollRun } = useHR();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPayroll, setEditingPayroll] = useState<PayrollRun | null>(null);
    const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>('');
    
    // YYYY-MM format for current month
    const currentMonth = new Date().toISOString().substring(0, 7);
    
    const defaultFormData: Partial<PayrollRun> = {
        employee_id: '',
        month: currentMonth,
        base_pay: 0,
        bonus: 0,
        deductions: 0,
        net_pay: 0,
        payment_status: 'Pending'
    };
    
    const [formData, setFormData] = useState<Partial<PayrollRun>>(defaultFormData);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Payroll Processing</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Generate and track employee salaries</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchPayrollRuns();
        fetchEmployees(true); // silent fetch
    }, [fetchPayrollRuns, fetchEmployees]);

    // Unique months for filter dropdown
    const availableMonths = useMemo(() => {
        const months = new Set<string>();
        payrollRuns.forEach(p => months.add(p.month));
        return Array.from(months).sort().reverse();
    }, [payrollRuns]);

    const filteredPayrolls = useMemo(() => {
        if (!selectedMonthFilter) return payrollRuns;
        return payrollRuns.filter(p => p.month === selectedMonthFilter);
    }, [payrollRuns, selectedMonthFilter]);

    // Summary stats
    const stats = useMemo(() => {
        let totalBase = 0;
        let totalNet = 0;
        let totalPaid = 0;

        filteredPayrolls.forEach(p => {
            totalBase += p.base_pay || 0;
            totalNet += p.net_pay || 0;
            if (p.payment_status === 'Paid') {
                totalPaid += p.net_pay || 0;
            }
        });

        return { totalBase, totalNet, totalPaid };
    }, [filteredPayrolls]);

    // Auto-update base pay and net pay when employee changes
    useEffect(() => {
        if (!editingPayroll && formData.employee_id && employees.length > 0) {
            const emp = employees.find(e => e.id === formData.employee_id);
            if (emp) {
                setFormData(prev => ({
                    ...prev,
                    base_pay: emp.base_salary,
                    net_pay: emp.base_salary + (prev.bonus || 0) - (prev.deductions || 0)
                }));
            }
        }
    }, [formData.employee_id, employees, editingPayroll]);

    // Auto-calculate net pay on bonus/deduction change
    useEffect(() => {
        const base = formData.base_pay || 0;
        const bonus = formData.bonus || 0;
        const ded = formData.deductions || 0;
        setFormData(prev => ({ ...prev, net_pay: base + bonus - ded }));
    }, [formData.base_pay, formData.bonus, formData.deductions]);

    const handleOpenModal = (payroll?: PayrollRun) => {
        if (payroll) {
            setEditingPayroll(payroll);
            setFormData(payroll);
        } else {
            setEditingPayroll(null);
            const firstEmp = employees.length > 0 ? employees[0] : null;
            setFormData({
                ...defaultFormData, 
                employee_id: firstEmp ? firstEmp.id : '',
                base_pay: firstEmp ? firstEmp.base_salary : 0
            });
        }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.employee_id || !formData.month) return;
        try {
            await savePayrollRun(formData);
            setIsModalOpen(false);
        } catch (error) {
            // Handled in hook
        }
    };

    const markAsPaid = async (payroll: PayrollRun) => {
        await savePayrollRun({ 
            ...payroll, 
            payment_status: 'Paid',
            payment_date: new Date().toISOString().split('T')[0]
        });
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this payroll record?')) {
            await deletePayrollRun(id);
        }
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    };

    const formatMonth = (ym: string) => {
        if (!ym) return '';
        const [year, month] = ym.split('-');
        const date = new Date(Number(year), Number(month) - 1);
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    };

    return (
        <div className="page-container fade-in">
            {/* Stats Overview */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Banknote size={24} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Total Base Pay</div>
                        <div style={{ fontSize: '24px', fontWeight: 700 }}>{formatCurrency(stats.totalBase)}</div>
                    </div>
                </div>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <DollarSign size={24} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Total Net Pay (Calculated)</div>
                        <div style={{ fontSize: '24px', fontWeight: 700 }}>{formatCurrency(stats.totalNet)}</div>
                    </div>
                </div>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CheckCircle size={24} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Actually Paid</div>
                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-success)' }}>{formatCurrency(stats.totalPaid)}</div>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Filter Month:</label>
                    <select 
                        className="input-field" 
                        value={selectedMonthFilter} 
                        onChange={(e) => setSelectedMonthFilter(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: '12px', minWidth: '150px' }}
                    >
                        <option value="">All Months</option>
                        {availableMonths.map(m => (
                            <option key={m} value={m}>{formatMonth(m)}</option>
                        ))}
                    </select>
                </div>
                <button 
                    className="primary-button" 
                    onClick={() => handleOpenModal()}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '12px', fontWeight: 500, boxShadow: 'var(--shadow-sm)' }}
                >
                    <Plus size={18} /> Generate Payroll
                </button>
            </div>

            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: 'none' }}>
                    <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Employee</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Month</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>Base Pay</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-success)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>Bonus</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-danger)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>Deductions</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-main)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>Net Pay</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Status</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading payroll records...</td></tr>
                        ) : filteredPayrolls.length === 0 ? (
                            <tr>
                                <td colSpan={8} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--color-text-secondary)' }}>
                                        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <CreditCard size={32} style={{ opacity: 0.5 }} />
                                        </div>
                                        <div>
                                            <h3 style={{ color: 'var(--color-text-main)', marginBottom: '4px', fontSize: '16px' }}>No payroll records</h3>
                                            <p style={{ fontSize: '14px' }}>Click "Generate Payroll" to create payslips.</p>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredPayrolls.map(pay => {
                                const emp = pay.employee;
                                return (
                                    <tr key={pay.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease' }} className="hover-highlight">
                                        <td style={{ padding: '16px 24px' }}>
                                            {emp ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <div style={{ 
                                                        width: '32px', height: '32px', borderRadius: '8px', 
                                                        backgroundColor: stringToColor(emp.first_name + emp.last_name), 
                                                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontWeight: 'bold', fontSize: '12px', boxShadow: 'var(--shadow-sm)'
                                                    }}>
                                                        {getInitials(emp.first_name, emp.last_name)}
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: '600', fontSize: '14px' }}>{emp.first_name} {emp.last_name}</div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unknown Employee</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '16px 24px', fontWeight: 500, fontSize: '14px' }}>
                                            {formatMonth(pay.month)}
                                        </td>
                                        <td style={{ padding: '16px 24px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                                            {formatCurrency(pay.base_pay)}
                                        </td>
                                        <td style={{ padding: '16px 24px', textAlign: 'right', color: 'var(--color-success)', fontWeight: 500 }}>
                                            {pay.bonus > 0 ? `+${formatCurrency(pay.bonus)}` : '—'}
                                        </td>
                                        <td style={{ padding: '16px 24px', textAlign: 'right', color: 'var(--color-danger)', fontWeight: 500 }}>
                                            {pay.deductions > 0 ? `-${formatCurrency(pay.deductions)}` : '—'}
                                        </td>
                                        <td style={{ padding: '16px 24px', textAlign: 'right', fontWeight: 700, fontSize: '15px', color: 'var(--color-text-main)' }}>
                                            {formatCurrency(pay.net_pay)}
                                        </td>
                                        <td style={{ padding: '16px 24px' }}>
                                            <StatusBadge status={pay.payment_status} />
                                            {pay.payment_status === 'Paid' && pay.payment_date && (
                                                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                                                    on {new Date(pay.payment_date).toLocaleDateString()}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', opacity: 0.8 }} className="actions-group">
                                                {pay.payment_status === 'Pending' && (
                                                    <button 
                                                        onClick={() => markAsPaid(pay)}
                                                        style={{ padding: '6px 12px', borderRadius: '6px', background: 'var(--color-primary)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, boxShadow: 'var(--shadow-sm)' }}
                                                        title="Mark as Paid"
                                                    >
                                                        Pay
                                                    </button>
                                                )}
                                                <button 
                                                    className="secondary-button" 
                                                    style={{ padding: '6px', borderRadius: '6px', background: 'var(--color-bg)' }}
                                                    onClick={() => handleOpenModal(pay)}
                                                    title="Edit"
                                                >
                                                    <Edit size={14} />
                                                </button>
                                                <button 
                                                    className="danger-button" 
                                                    style={{ padding: '6px', borderRadius: '6px', background: 'var(--color-red-light)', color: 'var(--color-red)', border: 'none' }}
                                                    onClick={() => handleDelete(pay.id)}
                                                    title="Delete"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            <Modal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                title={editingPayroll ? 'Edit Payroll Run' : 'Generate Payslip'}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px 0', minWidth: '500px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Employee *</label>
                            <select 
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.employee_id || ''}
                                onChange={(e) => setFormData({...formData, employee_id: e.target.value})}
                                disabled={!!editingPayroll} // Cannot change employee after creation
                            >
                                {employees.length === 0 && <option value="">No employees available</option>}
                                {employees.map(emp => (
                                    <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name} ({formatCurrency(emp.base_salary)})</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Month *</label>
                            <input 
                                type="month" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.month || currentMonth} 
                                onChange={(e) => setFormData({...formData, month: e.target.value})} 
                            />
                        </div>
                    </div>

                    <div className="glass-panel" style={{ padding: '16px', background: 'var(--color-bg)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Base Pay ($)</label>
                                <input 
                                    type="number" 
                                    className="input-field" 
                                    style={{ width: '100%', padding: '10px 12px' }}
                                    value={formData.base_pay === 0 ? '' : formData.base_pay} 
                                    onChange={(e) => setFormData({...formData, base_pay: Number(e.target.value) || 0})} 
                                    min="0" step="0.01"
                                />
                            </div>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-success)' }}>Bonus ($)</label>
                                    <input 
                                        type="number" 
                                        className="input-field" 
                                        style={{ width: '100%', padding: '10px 12px', borderColor: 'rgba(34, 197, 94, 0.3)' }}
                                        value={formData.bonus === 0 ? '' : formData.bonus} 
                                        onChange={(e) => setFormData({...formData, bonus: Number(e.target.value) || 0})} 
                                        min="0" step="0.01"
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-danger)' }}>Deductions ($)</label>
                                    <input 
                                        type="number" 
                                        className="input-field" 
                                        style={{ width: '100%', padding: '10px 12px', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                                        value={formData.deductions === 0 ? '' : formData.deductions} 
                                        onChange={(e) => setFormData({...formData, deductions: Number(e.target.value) || 0})} 
                                        min="0" step="0.01"
                                    />
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '2px dashed var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '16px', fontWeight: 600 }}>Total Net Pay</span>
                            <span style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-primary)' }}>
                                {formatCurrency(formData.net_pay || 0)}
                            </span>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Payment Status</label>
                            <select 
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.payment_status || 'Pending'}
                                onChange={(e) => setFormData({...formData, payment_status: e.target.value})}
                            >
                                <option value="Pending">Pending</option>
                                <option value="Paid">Paid</option>
                            </select>
                        </div>
                        {formData.payment_status === 'Paid' && (
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Payment Date</label>
                                <input 
                                    type="date" 
                                    className="input-field" 
                                    style={{ width: '100%', padding: '10px 12px' }}
                                    value={formData.payment_date || new Date().toISOString().split('T')[0]} 
                                    onChange={(e) => setFormData({...formData, payment_date: e.target.value})} 
                                />
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px' }}>Cancel</button>
                        <button 
                            className="primary-button" 
                            onClick={handleSave} 
                            disabled={!formData.employee_id || !formData.month}
                            style={{ padding: '10px 24px', borderRadius: '8px', fontWeight: 600 }}
                        >
                            {editingPayroll ? 'Save Changes' : 'Generate Payslip'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default PayrollPage;
