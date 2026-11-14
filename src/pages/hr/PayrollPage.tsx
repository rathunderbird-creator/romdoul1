import { useState, useEffect, useMemo } from 'react';
import { Plus, Edit, Trash2, DollarSign, CheckCircle, CreditCard, Clock, Users, Undo2 } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';
import { Modal, StatusBadge } from '../../components';
import { useHR, isPayableEmployee } from '../../hooks/useHR';
import { useLanguage } from '../../context/LanguageContext';
import { fill } from '../../i18n/translate';
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

// Local calendar values — toISOString() is UTC and rolls back a day/month
// between midnight and 07:00 local.
const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const localMonth = () => localToday().substring(0, 7);

const PayrollPage = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { t, language } = useLanguage();
    const isMobile = useMobile();
    const { payrollRuns, employees, isLoading, fetchPayrollRuns, fetchEmployees, savePayrollRun, generatePayrollForMonth, deletePayrollRun } = useHR();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPayroll, setEditingPayroll] = useState<PayrollRun | null>(null);
    const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [genMonth, setGenMonth] = useState<string>(localMonth());
    const [isGenerating, setIsGenerating] = useState(false);
    // Row whose Pay/Undo is in flight — the button is disabled meanwhile so a
    // double-click can't start two overlapping saves.
    const [busyId, setBusyId] = useState<string | null>(null);

    const currentMonth = localMonth();

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
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('ui.people.hr.pay.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('ui.people.hr.pay.subtitle')}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    useEffect(() => {
        fetchPayrollRuns();
        fetchEmployees(true); // silent fetch
    }, [fetchPayrollRuns, fetchEmployees]);

    // Payslips go to current staff (Active or On Leave — not Terminated); an
    // existing run keeps its employee in the list even if terminated since.
    const selectableEmployees = useMemo(() => {
        const current = employees.filter(isPayableEmployee);
        if (editingPayroll && !current.some(e => e.id === editingPayroll.employee_id)) {
            const own = employees.find(e => e.id === editingPayroll.employee_id);
            if (own) return [own, ...current];
        }
        return current;
    }, [employees, editingPayroll]);

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

    // Summary stats + footer sums over the filtered rows
    const stats = useMemo(() => {
        let totalBase = 0, totalBonus = 0, totalDeductions = 0, totalNet = 0, totalPaid = 0, paidCount = 0;
        filteredPayrolls.forEach(p => {
            totalBase += p.base_pay || 0;
            totalBonus += p.bonus || 0;
            totalDeductions += p.deductions || 0;
            totalNet += p.net_pay || 0;
            if (p.payment_status === 'Paid') {
                totalPaid += p.net_pay || 0;
                paidCount += 1;
            }
        });
        return { totalBase, totalBonus, totalDeductions, totalNet, totalPaid, totalPending: totalNet - totalPaid, paidCount, pendingCount: filteredPayrolls.length - paidCount };
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
            // Only ever preselect someone the dropdown actually shows.
            const firstEmp = employees.find(isPayableEmployee) || null;
            setFormData({
                ...defaultFormData,
                month: selectedMonthFilter || currentMonth,
                employee_id: firstEmp ? firstEmp.id : '',
                base_pay: firstEmp ? firstEmp.base_salary : 0
            });
        }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.employee_id || !formData.month || isSaving) return;
        // One payslip per employee per month.
        const duplicate = payrollRuns.find(p => p.employee_id === formData.employee_id && p.month === formData.month && p.id !== editingPayroll?.id);
        if (duplicate) {
            showToast(fill(t('ui.people.hr.pay.duplicate'), { month: formatMonth(formData.month) }), 'error');
            return;
        }
        setIsSaving(true);
        try {
            await savePayrollRun(formData);
            setIsModalOpen(false);
        } catch (error) {
            // Handled in hook
        } finally {
            setIsSaving(false);
        }
    };

    const markAsPaid = async (payroll: PayrollRun) => {
        if (busyId) return;
        setBusyId(payroll.id);
        try {
            await savePayrollRun({
                ...payroll,
                payment_status: 'Paid',
                payment_date: localToday()
            });
        } catch { /* hook toasts */ } finally {
            setBusyId(null);
        }
    };

    const revertToPending = async (payroll: PayrollRun) => {
        if (busyId) return;
        if (!confirm(t('ui.people.hr.pay.confirmUnpay'))) return;
        setBusyId(payroll.id);
        try {
            await savePayrollRun({ ...payroll, payment_status: 'Pending', payment_date: undefined });
        } catch { /* hook toasts */ } finally {
            setBusyId(null);
        }
    };

    const handleGenerateAll = async () => {
        if (!genMonth || isGenerating) return;
        // Same rule as the hook: everyone not Terminated (Active + On Leave).
        const payableCount = employees.filter(isPayableEmployee).length;
        if (payableCount === 0) { showToast(t('ui.people.hr.pay.noEmployees'), 'error'); return; }
        if (!confirm(fill(t('ui.people.hr.pay.confirmGenerate'), { month: formatMonth(genMonth) }))) return;
        setIsGenerating(true);
        try {
            const result = await generatePayrollForMonth(genMonth);
            if (result.created === 0) {
                showToast(fill(t('ui.people.hr.pay.nothingToDo'), { month: formatMonth(genMonth) }), 'info');
            } else {
                showToast(fill(t('ui.people.hr.pay.created'), { n: result.created, month: formatMonth(genMonth) }) + (result.skipped ? fill(t('ui.people.hr.pay.skipped'), { n: result.skipped }) : ''), 'success');
            }
            setSelectedMonthFilter(genMonth);
        } catch { /* hook toasts */ } finally {
            setIsGenerating(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm(t('ui.people.hr.pay.confirmDelete'))) {
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
        return date.toLocaleDateString(language === 'km' ? 'km-KH' : 'en-US', { month: 'long', year: 'numeric' });
    };

    const cell = isMobile ? '10px 12px' : '14px 20px';
    const grid2 = isMobile ? '1fr' : '1fr 1fr';
    const StatCard = ({ icon: Icon, label, value, color, bg, sub }: { icon: any; label: string; value: string; color: string; bg: string; sub?: string }) => (
        <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '10px' : '16px', padding: isMobile ? '12px' : undefined }}>
            <div style={{ width: isMobile ? '38px' : '48px', height: isMobile ? '38px' : '48px', borderRadius: '12px', background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={isMobile ? 18 : 24} />
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? '11px' : '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: isMobile ? '18px' : '24px', fontWeight: 700, color }}>{value}</div>
                {sub && <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{sub}</div>}
            </div>
        </div>
    );

    return (
        <div className="page-container fade-in">
            {/* Stats Overview */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: isMobile ? '10px' : '20px', marginBottom: '24px' }}>
                <StatCard icon={DollarSign} label={t('ui.people.hr.pay.totalNetPay')} value={formatCurrency(stats.totalNet)} color="var(--color-text-main)" bg="rgba(59, 130, 246, 0.1)" sub={fill(t('ui.people.hr.pay.payslipsN'), { n: filteredPayrolls.length })} />
                <StatCard icon={CheckCircle} label={t('status.paid')} value={formatCurrency(stats.totalPaid)} color="var(--color-success)" bg="rgba(34, 197, 94, 0.1)" sub={fill(t('ui.people.hr.pay.paidN'), { n: stats.paidCount })} />
                <StatCard icon={Clock} label={t('ui.people.hr.pay.pendingToPay')} value={formatCurrency(stats.totalPending)} color={stats.totalPending > 0 ? '#f59e0b' : 'var(--color-text-main)'} bg="rgba(245, 158, 11, 0.1)" sub={fill(t('ui.people.hr.pay.pendingN'), { n: stats.pendingCount })} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('ui.people.hr.pay.filterMonth')}</label>
                    <select
                        className="input-field"
                        value={selectedMonthFilter}
                        onChange={(e) => setSelectedMonthFilter(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: '12px', minWidth: '150px' }}
                    >
                        <option value="">{t('ui.people.hr.pay.allMonths')}</option>
                        {availableMonths.map(m => (
                            <option key={m} value={m}>{formatMonth(m)}</option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {/* Whole-month generation: one Pending payslip per current (non-terminated) employee */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '4px 4px 4px 10px' }}>
                        <input
                            type="month"
                            className="input-field"
                            value={genMonth}
                            onChange={(e) => setGenMonth(e.target.value)}
                            style={{ border: 'none', background: 'transparent', padding: '4px', fontSize: '13px', minWidth: 0 }}
                        />
                        <button
                            className="secondary-button"
                            onClick={handleGenerateAll}
                            disabled={isGenerating}
                            title={t('ui.people.hr.pay.generateAllHint')}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '10px', fontWeight: 600, fontSize: '13px' }}
                        >
                            <Users size={16} /> {isGenerating ? t('ui.people.hr.pay.generating') : t('ui.people.hr.pay.generateAll')}
                        </button>
                    </div>
                    <button
                        className="primary-button"
                        onClick={() => handleOpenModal()}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '12px', fontWeight: 500, boxShadow: 'var(--shadow-sm)' }}
                    >
                        <Plus size={18} /> {isMobile ? t('ui.people.hr.pay.payslip') : t('ui.people.hr.pay.generatePayslip')}
                    </button>
                </div>
            </div>

            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: 'none' }}>
                    <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>{t('ui.people.hr.emp.employee')}</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>{t('ui.people.hr.pay.month')}</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>{t('ui.people.hr.pay.basePay')}</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-success)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>{t('ui.people.hr.pay.bonus')}</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-danger)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>{t('ui.people.hr.pay.deductions')}</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-main)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>{t('ui.people.hr.pay.netPay')}</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>{t('ui.people.hr.status.label')}</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>{t('common.actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{t('ui.people.hr.pay.loading')}</td></tr>
                        ) : filteredPayrolls.length === 0 ? (
                            <tr>
                                <td colSpan={8} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--color-text-secondary)' }}>
                                        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <CreditCard size={32} style={{ opacity: 0.5 }} />
                                        </div>
                                        <div>
                                            <h3 style={{ color: 'var(--color-text-main)', marginBottom: '4px', fontSize: '16px' }}>{t('ui.people.hr.pay.none')}</h3>
                                            <p style={{ fontSize: '14px' }}>{t('ui.people.hr.pay.noneHint')}</p>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredPayrolls.map(pay => {
                                const emp = pay.employee;
                                return (
                                    <tr key={pay.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease' }} className="hover-highlight">
                                        <td style={{ padding: cell }}>
                                            {emp ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <div style={{
                                                        width: '32px', height: '32px', borderRadius: '8px',
                                                        backgroundColor: stringToColor(emp.first_name + emp.last_name),
                                                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontWeight: 'bold', fontSize: '12px', boxShadow: 'var(--shadow-sm)', flexShrink: 0
                                                    }}>
                                                        {getInitials(emp.first_name, emp.last_name)}
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: '600', fontSize: '14px', whiteSpace: 'nowrap' }}>{emp.first_name} {emp.last_name}</div>
                                                        {emp.position && <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{emp.position}</div>}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{t('ui.people.hr.leave.unknownEmployee')}</span>
                                            )}
                                        </td>
                                        <td style={{ padding: cell, fontWeight: 500, fontSize: '14px', whiteSpace: 'nowrap' }}>
                                            {formatMonth(pay.month)}
                                        </td>
                                        <td style={{ padding: cell, textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                                            {formatCurrency(pay.base_pay)}
                                        </td>
                                        <td style={{ padding: cell, textAlign: 'right', color: 'var(--color-success)', fontWeight: 500 }}>
                                            {pay.bonus > 0 ? `+${formatCurrency(pay.bonus)}` : '—'}
                                        </td>
                                        <td style={{ padding: cell, textAlign: 'right', color: 'var(--color-danger)', fontWeight: 500 }}>
                                            {pay.deductions > 0 ? `-${formatCurrency(pay.deductions)}` : '—'}
                                        </td>
                                        <td style={{ padding: cell, textAlign: 'right', fontWeight: 700, fontSize: '15px', color: 'var(--color-text-main)' }}>
                                            {formatCurrency(pay.net_pay)}
                                        </td>
                                        <td style={{ padding: cell }}>
                                            <StatusBadge status={pay.payment_status} />
                                            {pay.payment_status === 'Paid' && pay.payment_date && (
                                                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px', whiteSpace: 'nowrap' }}>
                                                    {t('ui.people.hr.pay.on')} {new Date(pay.payment_date).toLocaleDateString()}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: cell, textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', opacity: 0.8 }} className="actions-group">
                                                {pay.payment_status === 'Pending' ? (
                                                    <button
                                                        onClick={() => markAsPaid(pay)}
                                                        disabled={busyId !== null}
                                                        style={{ padding: '6px 12px', borderRadius: '6px', background: 'var(--color-primary)', color: 'white', border: 'none', cursor: busyId ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, boxShadow: 'var(--shadow-sm)', opacity: busyId === pay.id ? 0.6 : 1 }}
                                                        title={t('ui.people.hr.pay.payHint')}
                                                    >
                                                        {busyId === pay.id ? t('ui.people.hr.pay.paying') : t('ui.people.hr.pay.pay')}
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => revertToPending(pay)}
                                                        disabled={busyId !== null}
                                                        className="secondary-button"
                                                        style={{ padding: '6px', borderRadius: '6px', background: 'var(--color-bg)', opacity: busyId === pay.id ? 0.6 : 1 }}
                                                        title={t('ui.people.hr.pay.markNotPaid')}
                                                    >
                                                        <Undo2 size={14} />
                                                    </button>
                                                )}
                                                <button
                                                    className="secondary-button"
                                                    style={{ padding: '6px', borderRadius: '6px', background: 'var(--color-bg)' }}
                                                    onClick={() => handleOpenModal(pay)}
                                                    title={t('common.edit')}
                                                >
                                                    <Edit size={14} />
                                                </button>
                                                <button
                                                    className="danger-button"
                                                    style={{ padding: '6px', borderRadius: '6px', background: 'var(--color-red-light)', color: 'var(--color-red)', border: 'none' }}
                                                    onClick={() => handleDelete(pay.id)}
                                                    title={t('common.delete')}
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
                    {filteredPayrolls.length > 0 && (
                        <tfoot>
                            <tr style={{ background: 'var(--color-bg)', fontWeight: 700, fontSize: '13px' }}>
                                <td style={{ padding: cell, borderTop: '2px solid var(--color-border)' }}>{t('common.total')}: {filteredPayrolls.length}</td>
                                <td style={{ padding: cell, borderTop: '2px solid var(--color-border)' }}></td>
                                <td style={{ padding: cell, borderTop: '2px solid var(--color-border)', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{formatCurrency(stats.totalBase)}</td>
                                <td style={{ padding: cell, borderTop: '2px solid var(--color-border)', textAlign: 'right', color: 'var(--color-success)' }}>{stats.totalBonus > 0 ? `+${formatCurrency(stats.totalBonus)}` : '—'}</td>
                                <td style={{ padding: cell, borderTop: '2px solid var(--color-border)', textAlign: 'right', color: 'var(--color-danger)' }}>{stats.totalDeductions > 0 ? `-${formatCurrency(stats.totalDeductions)}` : '—'}</td>
                                <td style={{ padding: cell, borderTop: '2px solid var(--color-border)', textAlign: 'right', fontSize: '15px' }}>{formatCurrency(stats.totalNet)}</td>
                                <td style={{ padding: cell, borderTop: '2px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                                    <span style={{ color: 'var(--color-success)' }}>{formatCurrency(stats.totalPaid)} {t('ui.people.hr.pay.paidWord')}</span>
                                    {stats.totalPending > 0 && <span style={{ color: '#f59e0b' }}> · {formatCurrency(stats.totalPending)} {t('ui.people.hr.pay.dueWord')}</span>}
                                </td>
                                <td style={{ padding: cell, borderTop: '2px solid var(--color-border)' }}></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingPayroll ? t('ui.people.hr.pay.editRun') : t('ui.people.hr.pay.generatePayslip')}
                width="640px"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px 0', minWidth: isMobile ? undefined : '500px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: grid2, gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>{t('ui.people.hr.emp.employee')} *</label>
                            <select
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.employee_id || ''}
                                onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                                disabled={!!editingPayroll} // Cannot change employee after creation
                            >
                                {selectableEmployees.length === 0 && <option value="">{t('ui.people.hr.leave.noActiveEmployees')}</option>}
                                {selectableEmployees.map(emp => (
                                    <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name} ({formatCurrency(emp.base_salary)})</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>{t('ui.people.hr.pay.month')} *</label>
                            <input
                                type="month"
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.month || currentMonth}
                                onChange={(e) => setFormData({ ...formData, month: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="glass-panel" style={{ padding: '16px', background: 'var(--color-bg)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: grid2, gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('ui.people.hr.pay.basePay')} ($)</label>
                                <input
                                    type="number"
                                    className="input-field"
                                    style={{ width: '100%', padding: '10px 12px' }}
                                    value={formData.base_pay === 0 ? '' : formData.base_pay}
                                    onChange={(e) => setFormData({ ...formData, base_pay: Math.max(0, Number(e.target.value) || 0) })}
                                    min="0" step="0.01"
                                />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-success)' }}>{t('ui.people.hr.pay.bonus')} ($)</label>
                                    <input
                                        type="number"
                                        className="input-field"
                                        style={{ width: '100%', padding: '10px 12px', borderColor: 'rgba(34, 197, 94, 0.3)' }}
                                        value={formData.bonus === 0 ? '' : formData.bonus}
                                        onChange={(e) => setFormData({ ...formData, bonus: Math.max(0, Number(e.target.value) || 0) })}
                                        min="0" step="0.01"
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-danger)' }}>{t('ui.people.hr.pay.deductions')} ($)</label>
                                    <input
                                        type="number"
                                        className="input-field"
                                        style={{ width: '100%', padding: '10px 12px', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                                        value={formData.deductions === 0 ? '' : formData.deductions}
                                        onChange={(e) => setFormData({ ...formData, deductions: Math.max(0, Number(e.target.value) || 0) })}
                                        min="0" step="0.01"
                                    />
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '2px dashed var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '16px', fontWeight: 600 }}>{t('ui.people.hr.pay.totalNetPay')}</span>
                            <span style={{ fontSize: '24px', fontWeight: 700, color: (formData.net_pay || 0) < 0 ? 'var(--color-danger)' : 'var(--color-primary)' }}>
                                {formatCurrency(formData.net_pay || 0)}
                            </span>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: grid2, gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>{t('ui.people.hr.pay.paymentStatus')}</label>
                            <select
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.payment_status || 'Pending'}
                                onChange={(e) => setFormData({ ...formData, payment_status: e.target.value, payment_date: e.target.value === 'Paid' ? (formData.payment_date || localToday()) : undefined })}
                            >
                                <option value="Pending">{t('status.pending')}</option>
                                <option value="Paid">{t('status.paid')}</option>
                            </select>
                        </div>
                        {formData.payment_status === 'Paid' && (
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>{t('ui.people.hr.pay.paymentDate')}</label>
                                <input
                                    type="date"
                                    className="input-field"
                                    style={{ width: '100%', padding: '10px 12px' }}
                                    value={formData.payment_date || localToday()}
                                    onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                                />
                            </div>
                        )}
                    </div>
                    {formData.payment_status === 'Paid' && (
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '-8px' }}>
                            {t('ui.people.hr.pay.paidNote')}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px' }}>{t('common.cancel')}</button>
                        <button
                            className="primary-button"
                            onClick={handleSave}
                            disabled={!formData.employee_id || !formData.month || isSaving || (formData.net_pay || 0) < 0}
                            style={{ padding: '10px 24px', borderRadius: '8px', fontWeight: 600 }}
                        >
                            {isSaving ? t('ui.people.common.saving') : (editingPayroll ? t('ui.people.common.saveChanges') : t('ui.people.hr.pay.generatePayslip'))}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default PayrollPage;
