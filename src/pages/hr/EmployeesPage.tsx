import { useState, useEffect, useMemo } from 'react';
import { Plus, Edit, Trash2, Search, Users, Mail, Phone, Briefcase, Banknote } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';
import { Modal, StatusBadge } from '../../components';
import { useHR } from '../../hooks/useHR';
import type { Employee } from '../../types';

// Helper for generating avatar color based on name
const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 45%)`;
};

const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
};

// Local calendar date — toISOString() is UTC and rolls back a day before 07:00 local.
const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const STATUS_TABS = ['All', 'Active', 'On Leave', 'Terminated'] as const;

const EmployeesPage = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const isMobile = useMobile();
    const { employees, isLoading, fetchEmployees, saveEmployee, deleteEmployee } = useHR();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('Active');
    const [isSaving, setIsSaving] = useState(false);

    const defaultFormData: Partial<Employee> = {
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        department: '',
        position: '',
        hire_date: localToday(),
        base_salary: 0,
        status: 'Active'
    };

    const [formData, setFormData] = useState<Partial<Employee>>(defaultFormData);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Employees Directory</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage staff information and salaries</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchEmployees();
    }, [fetchEmployees]);

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = { All: employees.length };
        employees.forEach(e => { counts[e.status] = (counts[e.status] || 0) + 1; });
        return counts;
    }, [employees]);

    // Monthly salary commitment for the Active team.
    const activePayroll = useMemo(
        () => employees.filter(e => e.status === 'Active').reduce((s, e) => s + (e.base_salary || 0), 0),
        [employees]
    );

    const filteredEmployees = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return employees.filter(emp => {
            if (statusFilter !== 'All' && emp.status !== statusFilter) return false;
            if (!query) return true;
            return emp.first_name.toLowerCase().includes(query) ||
                emp.last_name.toLowerCase().includes(query) ||
                (emp.email && emp.email.toLowerCase().includes(query)) ||
                (emp.phone && emp.phone.toLowerCase().includes(query)) ||
                (emp.department && emp.department.toLowerCase().includes(query)) ||
                (emp.position && emp.position.toLowerCase().includes(query));
        });
    }, [employees, searchQuery, statusFilter]);

    const handleOpenModal = (employee?: Employee) => {
        if (employee) {
            setEditingEmployee(employee);
            setFormData(employee);
        } else {
            setEditingEmployee(null);
            setFormData(defaultFormData);
        }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.first_name?.trim() || !formData.last_name?.trim() || isSaving) return;
        const email = (formData.email || '').trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showToast('Please enter a valid email address', 'error');
            return;
        }
        setIsSaving(true);
        try {
            await saveEmployee({
                ...formData,
                first_name: formData.first_name.trim(),
                last_name: formData.last_name.trim(),
                email,
                phone: (formData.phone || '').trim()
            });
            setIsModalOpen(false);
        } catch (error) {
            // Handled in hook
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (emp: Employee) => {
        // Hard delete cascades to payroll + leave history (and removes the
        // salary expense entries of paid payslips); terminating keeps it all.
        if (confirm(`Delete ${emp.first_name} ${emp.last_name}? This permanently removes their payroll history, leave history, and the salary expense entries of their paid payslips.\n\nTip: set Status to "Terminated" instead to keep the records.`)) {
            await deleteEmployee(emp.id);
        }
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    };

    const cell = isMobile ? '10px 12px' : '14px 20px';
    const grid2 = isMobile ? '1fr' : '1fr 1fr';

    return (
        <div className="page-container fade-in">
            {/* Summary pills */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, padding: '4px 12px', borderRadius: '20px', background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                    <Users size={14} /> {statusCounts['Active'] || 0} active · {employees.length} total
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, padding: '4px 12px', borderRadius: '20px', background: 'var(--color-primary-light)', color: 'var(--color-primary)' }} title="Sum of base salaries for Active employees">
                    <Banknote size={14} /> {formatCurrency(activePayroll)} / month
                </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', flex: 1 }}>
                    <div style={{ position: 'relative', width: '100%', maxWidth: isMobile ? '100%' : '320px' }}>
                        <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input
                            type="text"
                            className="input-field"
                            placeholder="Search name, email, phone, department..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ width: '100%', padding: '10px 10px 10px 40px', borderRadius: '12px', border: '1px solid var(--color-border)' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {STATUS_TABS.map(status => {
                            const active = statusFilter === status;
                            return (
                                <button
                                    key={status}
                                    onClick={() => setStatusFilter(status)}
                                    style={{
                                        padding: '7px 12px', borderRadius: '20px', border: 'none', fontWeight: 600, fontSize: '12px', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: '6px',
                                        background: active ? 'var(--color-primary)' : 'var(--color-bg)',
                                        color: active ? '#fff' : 'var(--color-text-secondary)',
                                    }}
                                >
                                    {status}
                                    <span style={{ background: active ? 'rgba(255,255,255,0.25)' : 'var(--color-surface)', padding: '1px 7px', borderRadius: '12px', fontSize: '10px', fontWeight: 700 }}>{statusCounts[status] || 0}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <button
                    className="primary-button"
                    onClick={() => handleOpenModal()}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '12px', fontWeight: 500, boxShadow: 'var(--shadow-sm)' }}
                >
                    <Plus size={18} /> {isMobile ? 'Employee' : 'New Employee'}
                </button>
            </div>

            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: 'none' }}>
                    <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Employee</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Contact</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Role / Department</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>Base Salary</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Status</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading employees...</td></tr>
                        ) : filteredEmployees.length === 0 ? (
                            <tr>
                                <td colSpan={6} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--color-text-secondary)' }}>
                                        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Users size={32} style={{ opacity: 0.5 }} />
                                        </div>
                                        <div>
                                            <h3 style={{ color: 'var(--color-text-main)', marginBottom: '4px', fontSize: '16px' }}>No employees found</h3>
                                            <p style={{ fontSize: '14px' }}>{employees.length === 0 ? 'Get started by adding your first employee.' : 'Try adjusting your search or status filter.'}</p>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredEmployees.map(emp => (
                                <tr key={emp.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease' }} className="hover-highlight">
                                    <td style={{ padding: cell }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{
                                                width: '40px', height: '40px', borderRadius: '10px',
                                                backgroundColor: stringToColor(emp.first_name + emp.last_name),
                                                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontWeight: 'bold', fontSize: '14px', boxShadow: 'var(--shadow-sm)', flexShrink: 0
                                            }}>
                                                {getInitials(emp.first_name, emp.last_name)}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: '600', fontSize: '15px', whiteSpace: 'nowrap' }}>{emp.first_name} {emp.last_name}</div>
                                                {emp.hire_date && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>Hired: {new Date(emp.hire_date).toLocaleDateString()}</div>}
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: cell }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                            {emp.phone ? <span style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}><Phone size={14} style={{ opacity: 0.7 }} /> {emp.phone}</span> : null}
                                            {emp.email ? <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Mail size={14} style={{ opacity: 0.7 }} /> {emp.email}</span> : null}
                                            {!emp.phone && !emp.email && <span style={{ fontStyle: 'italic', opacity: 0.5 }}>No contact info</span>}
                                        </div>
                                    </td>
                                    <td style={{ padding: cell }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <div style={{ fontWeight: 500 }}>{emp.position || '—'}</div>
                                            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                {emp.department ? <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Briefcase size={12} /> {emp.department}</span> : '—'}
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-main)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        {formatCurrency(emp.base_salary)}
                                    </td>
                                    <td style={{ padding: cell }}>
                                        <StatusBadge status={emp.status} />
                                    </td>
                                    <td style={{ padding: cell, textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', opacity: 0.85 }} className="actions-group">
                                            <button
                                                className="secondary-button"
                                                style={{ padding: '8px', borderRadius: '8px', background: 'var(--color-bg)' }}
                                                onClick={() => handleOpenModal(emp)}
                                                title="Edit Employee"
                                            >
                                                <Edit size={16} />
                                            </button>
                                            <button
                                                className="danger-button"
                                                style={{ padding: '8px', borderRadius: '8px', background: 'var(--color-red-light)', color: 'var(--color-red)', border: 'none' }}
                                                onClick={() => handleDelete(emp)}
                                                title="Delete Employee"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingEmployee ? 'Edit Employee' : 'Add New Employee'}
                width="680px"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px 0', minWidth: isMobile ? undefined : '600px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: grid2, gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>First Name *</label>
                            <input
                                type="text"
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.first_name || ''}
                                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                                autoFocus={!isMobile}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Last Name *</label>
                            <input
                                type="text"
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.last_name || ''}
                                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: grid2, gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Email Address</label>
                            <input
                                type="email"
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.email || ''}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Phone Number</label>
                            <input
                                type="tel"
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.phone || ''}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: grid2, gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Department</label>
                            <input
                                type="text"
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.department || ''}
                                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Position / Title</label>
                            <input
                                type="text"
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.position || ''}
                                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Hire Date</label>
                            <input
                                type="date"
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.hire_date || ''}
                                onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Base Salary ($ / month)</label>
                            <input
                                type="number"
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.base_salary === 0 ? '' : formData.base_salary}
                                onChange={(e) => setFormData({ ...formData, base_salary: Math.max(0, Number(e.target.value) || 0) })}
                                min="0" step="0.01"
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Status</label>
                            <select
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.status || 'Active'}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                            >
                                <option value="Active">Active</option>
                                <option value="On Leave">On Leave</option>
                                <option value="Terminated">Terminated</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px' }}>Cancel</button>
                        <button
                            className="primary-button"
                            onClick={handleSave}
                            disabled={!formData.first_name?.trim() || !formData.last_name?.trim() || isSaving}
                            style={{ padding: '10px 24px', borderRadius: '8px', fontWeight: 600 }}
                        >
                            {isSaving ? 'Saving…' : (editingEmployee ? 'Save Changes' : 'Add Employee')}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default EmployeesPage;
