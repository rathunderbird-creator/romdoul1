import { useState, useEffect, useMemo } from 'react';
import { Plus, Edit, Trash2, Search, Users, Mail, Phone, Briefcase } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
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

const EmployeesPage = () => {
    const { setHeaderContent } = useHeader();
    const { employees, isLoading, fetchEmployees, saveEmployee, deleteEmployee } = useHR();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    
    const defaultFormData: Partial<Employee> = {
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        department: '',
        position: '',
        hire_date: new Date().toISOString().split('T')[0],
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

    const filteredEmployees = useMemo(() => {
        if (!searchQuery.trim()) return employees;
        const query = searchQuery.toLowerCase();
        return employees.filter(emp => 
            emp.first_name.toLowerCase().includes(query) || 
            emp.last_name.toLowerCase().includes(query) ||
            (emp.email && emp.email.toLowerCase().includes(query)) ||
            (emp.department && emp.department.toLowerCase().includes(query))
        );
    }, [employees, searchQuery]);

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
        if (!formData.first_name || !formData.last_name) return;
        try {
            await saveEmployee(formData);
            setIsModalOpen(false);
        } catch (error) {
            // Handled in hook
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this employee? This will also remove their payroll and leave history.')) {
            await deleteEmployee(id);
        }
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    };

    return (
        <div className="page-container fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ flex: 1, minWidth: '300px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ position: 'relative', width: '100%', maxWidth: '400px' }}>
                        <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input 
                            type="text" 
                            className="input-field" 
                            placeholder="Search employees by name, email, or department..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ width: '100%', padding: '10px 10px 10px 40px', borderRadius: '12px', border: '1px solid var(--color-border)' }}
                        />
                    </div>
                </div>
                <button 
                    className="primary-button" 
                    onClick={() => handleOpenModal()}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '12px', fontWeight: 500, boxShadow: 'var(--shadow-sm)' }}
                >
                    <Plus size={18} /> New Employee
                </button>
            </div>

            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: 'none' }}>
                    <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Employee</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Contact</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Role / Department</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Base Salary</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Status</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>Actions</th>
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
                                            <p style={{ fontSize: '14px' }}>{searchQuery ? 'Try adjusting your search terms.' : 'Get started by adding your first employee.'}</p>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredEmployees.map(emp => (
                                <tr key={emp.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease' }} className="hover-highlight">
                                    <td style={{ padding: '16px 24px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <div style={{ 
                                                width: '40px', height: '40px', borderRadius: '10px', 
                                                backgroundColor: stringToColor(emp.first_name + emp.last_name), 
                                                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontWeight: 'bold', fontSize: '14px', boxShadow: 'var(--shadow-sm)'
                                            }}>
                                                {getInitials(emp.first_name, emp.last_name)}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: '600', fontSize: '15px' }}>{emp.first_name} {emp.last_name}</div>
                                                {emp.hire_date && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>Hired: {new Date(emp.hire_date).toLocaleDateString()}</div>}
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: '16px 24px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                            {emp.phone ? <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Phone size={14} style={{ opacity: 0.7 }} /> {emp.phone}</span> : null}
                                            {emp.email ? <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Mail size={14} style={{ opacity: 0.7 }} /> {emp.email}</span> : null}
                                            {!emp.phone && !emp.email && <span style={{ fontStyle: 'italic', opacity: 0.5 }}>No contact info</span>}
                                        </div>
                                    </td>
                                    <td style={{ padding: '16px 24px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <div style={{ fontWeight: 500 }}>{emp.position || '—'}</div>
                                            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                {emp.department ? <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Briefcase size={12}/> {emp.department}</span> : '—'}
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                                        {formatCurrency(emp.base_salary)}
                                    </td>
                                    <td style={{ padding: '16px 24px' }}>
                                        <StatusBadge status={emp.status} />
                                    </td>
                                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', opacity: 0.8 }} className="actions-group">
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
                                                onClick={() => handleDelete(emp.id)}
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
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px 0', minWidth: '600px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>First Name *</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.first_name || ''} 
                                onChange={(e) => setFormData({...formData, first_name: e.target.value})} 
                                autoFocus
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Last Name *</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.last_name || ''} 
                                onChange={(e) => setFormData({...formData, last_name: e.target.value})} 
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Email Address</label>
                            <input 
                                type="email" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.email || ''} 
                                onChange={(e) => setFormData({...formData, email: e.target.value})} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Phone Number</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.phone || ''} 
                                onChange={(e) => setFormData({...formData, phone: e.target.value})} 
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Department</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.department || ''} 
                                onChange={(e) => setFormData({...formData, department: e.target.value})} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Position / Title</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.position || ''} 
                                onChange={(e) => setFormData({...formData, position: e.target.value})} 
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Hire Date</label>
                            <input 
                                type="date" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.hire_date || ''} 
                                onChange={(e) => setFormData({...formData, hire_date: e.target.value})} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Base Salary ($)</label>
                            <input 
                                type="number" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.base_salary === 0 ? '' : formData.base_salary} 
                                onChange={(e) => setFormData({...formData, base_salary: Number(e.target.value) || 0})} 
                                min="0" step="0.01"
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Status</label>
                            <select 
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.status || 'Active'}
                                onChange={(e) => setFormData({...formData, status: e.target.value})}
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
                            disabled={!formData.first_name || !formData.last_name}
                            style={{ padding: '10px 24px', borderRadius: '8px', fontWeight: 600 }}
                        >
                            {editingEmployee ? 'Save Changes' : 'Add Employee'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default EmployeesPage;
