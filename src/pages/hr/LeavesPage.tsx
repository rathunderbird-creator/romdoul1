import { useState, useEffect, useMemo } from 'react';
import { Plus, Edit, Trash2, Calendar, CheckCircle, XCircle } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal, StatusBadge } from '../../components';
import { useHR } from '../../hooks/useHR';
import type { LeaveRequest } from '../../types';

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

const LeavesPage = () => {
    const { setHeaderContent } = useHeader();
    const { leaveRequests, employees, isLoading, fetchLeaveRequests, fetchEmployees, saveLeaveRequest, deleteLeaveRequest } = useHR();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingLeave, setEditingLeave] = useState<LeaveRequest | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('All');
    
    const defaultFormData: Partial<LeaveRequest> = {
        employee_id: '',
        leave_type: 'Vacation',
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0],
        status: 'Pending',
        reason: ''
    };
    
    const [formData, setFormData] = useState<Partial<LeaveRequest>>(defaultFormData);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Leave Requests</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage employee time off</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchLeaveRequests();
        fetchEmployees(true); // silent fetch for dropdown
    }, [fetchLeaveRequests, fetchEmployees]);

    const filteredLeaves = useMemo(() => {
        if (filterStatus === 'All') return leaveRequests;
        return leaveRequests.filter(req => req.status === filterStatus);
    }, [leaveRequests, filterStatus]);

    const handleOpenModal = (leave?: LeaveRequest) => {
        if (leave) {
            setEditingLeave(leave);
            setFormData(leave);
        } else {
            setEditingLeave(null);
            setFormData({...defaultFormData, employee_id: employees.length > 0 ? employees[0].id : ''});
        }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.employee_id) return;
        try {
            await saveLeaveRequest(formData);
            setIsModalOpen(false);
        } catch (error) {
            // Handled in hook
        }
    };

    const handleStatusChange = async (leave: LeaveRequest, newStatus: string) => {
        await saveLeaveRequest({ ...leave, status: newStatus });
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this leave request?')) {
            await deleteLeaveRequest(id);
        }
    };

    const calculateDays = (start: string, end: string) => {
        const d1 = new Date(start);
        const d2 = new Date(end);
        const diffTime = Math.abs(d2.getTime() - d1.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
        return diffDays;
    };

    return (
        <div className="page-container fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {['All', 'Pending', 'Approved', 'Rejected'].map(status => (
                        <button
                            key={status}
                            onClick={() => setFilterStatus(status)}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '20px',
                                border: 'none',
                                fontWeight: 500,
                                fontSize: '13px',
                                cursor: 'pointer',
                                background: filterStatus === status ? 'var(--color-primary)' : 'var(--color-bg)',
                                color: filterStatus === status ? '#fff' : 'var(--color-text-secondary)',
                                boxShadow: filterStatus === status ? 'var(--shadow-sm)' : 'none'
                            }}
                        >
                            {status}
                        </button>
                    ))}
                </div>
                <button 
                    className="primary-button" 
                    onClick={() => handleOpenModal()}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '12px', fontWeight: 500, boxShadow: 'var(--shadow-sm)' }}
                >
                    <Plus size={18} /> Log Leave Request
                </button>
            </div>

            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: 'none' }}>
                    <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Employee</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Leave Type</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Duration</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Reason</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Status</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading leave requests...</td></tr>
                        ) : filteredLeaves.length === 0 ? (
                            <tr>
                                <td colSpan={6} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--color-text-secondary)' }}>
                                        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Calendar size={32} style={{ opacity: 0.5 }} />
                                        </div>
                                        <div>
                                            <h3 style={{ color: 'var(--color-text-main)', marginBottom: '4px', fontSize: '16px' }}>No leave requests found</h3>
                                            <p style={{ fontSize: '14px' }}>There are no {filterStatus.toLowerCase()} leave requests at this time.</p>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredLeaves.map(req => {
                                const emp = req.employee;
                                return (
                                    <tr key={req.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease' }} className="hover-highlight">
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
                                                        {emp.department && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>{emp.department}</div>}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unknown Employee</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '16px 24px', fontWeight: 500 }}>
                                            {req.leave_type}
                                        </td>
                                        <td style={{ padding: '16px 24px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <div style={{ fontSize: '13px', fontWeight: 500 }}>
                                                    {calculateDays(req.start_date, req.end_date)} day(s)
                                                </div>
                                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                    {new Date(req.start_date).toLocaleDateString()} - {new Date(req.end_date).toLocaleDateString()}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px 24px', fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '200px' }}>
                                            {req.reason || '—'}
                                        </td>
                                        <td style={{ padding: '16px 24px' }}>
                                            <StatusBadge status={req.status} />
                                        </td>
                                        <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', opacity: 0.8 }} className="actions-group">
                                                {req.status === 'Pending' && (
                                                    <>
                                                        <button 
                                                            onClick={() => handleStatusChange(req, 'Approved')}
                                                            style={{ padding: '6px 8px', borderRadius: '6px', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-success)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600 }}
                                                            title="Approve"
                                                        >
                                                            <CheckCircle size={14} /> Approve
                                                        </button>
                                                        <button 
                                                            onClick={() => handleStatusChange(req, 'Rejected')}
                                                            style={{ padding: '6px 8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600 }}
                                                            title="Reject"
                                                        >
                                                            <XCircle size={14} /> Reject
                                                        </button>
                                                    </>
                                                )}
                                                <button 
                                                    className="secondary-button" 
                                                    style={{ padding: '6px', borderRadius: '6px', background: 'var(--color-bg)' }}
                                                    onClick={() => handleOpenModal(req)}
                                                    title="Edit"
                                                >
                                                    <Edit size={14} />
                                                </button>
                                                <button 
                                                    className="danger-button" 
                                                    style={{ padding: '6px', borderRadius: '6px', background: 'var(--color-red-light)', color: 'var(--color-red)', border: 'none' }}
                                                    onClick={() => handleDelete(req.id)}
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
                title={editingLeave ? 'Edit Leave Request' : 'New Leave Request'}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px 0', minWidth: '400px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Employee *</label>
                        <select 
                            className="input-field"
                            style={{ width: '100%', padding: '10px 12px' }}
                            value={formData.employee_id || ''}
                            onChange={(e) => setFormData({...formData, employee_id: e.target.value})}
                        >
                            {employees.length === 0 && <option value="">No employees available</option>}
                            {employees.map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Leave Type</label>
                            <select 
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.leave_type || 'Vacation'}
                                onChange={(e) => setFormData({...formData, leave_type: e.target.value})}
                            >
                                <option value="Vacation">Vacation / Annual</option>
                                <option value="Sick">Sick Leave</option>
                                <option value="Unpaid">Unpaid Leave</option>
                                <option value="Maternity">Maternity/Paternity</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Status</label>
                            <select 
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.status || 'Pending'}
                                onChange={(e) => setFormData({...formData, status: e.target.value})}
                            >
                                <option value="Pending">Pending</option>
                                <option value="Approved">Approved</option>
                                <option value="Rejected">Rejected</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Start Date *</label>
                            <input 
                                type="date" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.start_date || ''} 
                                onChange={(e) => setFormData({...formData, start_date: e.target.value})} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>End Date *</label>
                            <input 
                                type="date" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.end_date || ''} 
                                min={formData.start_date}
                                onChange={(e) => setFormData({...formData, end_date: e.target.value})} 
                            />
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Reason (Optional)</label>
                        <textarea 
                            className="input-field" 
                            style={{ width: '100%', padding: '10px 12px', minHeight: '80px', resize: 'vertical' }}
                            value={formData.reason || ''} 
                            onChange={(e) => setFormData({...formData, reason: e.target.value})} 
                            placeholder="Brief reason for the leave..."
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px' }}>Cancel</button>
                        <button 
                            className="primary-button" 
                            onClick={handleSave} 
                            disabled={!formData.employee_id || !formData.start_date || !formData.end_date}
                            style={{ padding: '10px 24px', borderRadius: '8px', fontWeight: 600 }}
                        >
                            {editingLeave ? 'Save Changes' : 'Submit Request'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default LeavesPage;
