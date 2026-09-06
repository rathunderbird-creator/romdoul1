import { useState, useEffect, useMemo } from 'react';
import { Plus, Edit, Trash2, Calendar, CheckCircle, XCircle } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';
import { Modal, StatusBadge } from '../../components';
import { useHR, isPayableEmployee } from '../../hooks/useHR';
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

// Local calendar date — toISOString() is UTC and rolls back a day before 07:00 local.
const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const STATUS_TABS = ['All', 'Pending', 'Approved', 'Rejected'] as const;

const LeavesPage = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const isMobile = useMobile();
    const { leaveRequests, employees, isLoading, fetchLeaveRequests, fetchEmployees, saveLeaveRequest, deleteLeaveRequest } = useHR();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingLeave, setEditingLeave] = useState<LeaveRequest | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('All');
    const [isSaving, setIsSaving] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const defaultFormData: Partial<LeaveRequest> = {
        employee_id: '',
        leave_type: 'Vacation',
        start_date: localToday(),
        end_date: localToday(),
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

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = { All: leaveRequests.length };
        leaveRequests.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
        return counts;
    }, [leaveRequests]);

    const filteredLeaves = useMemo(() => {
        if (filterStatus === 'All') return leaveRequests;
        return leaveRequests.filter(req => req.status === filterStatus);
    }, [leaveRequests, filterStatus]);

    // New requests are for current staff (Active or On Leave — not Terminated);
    // editing keeps the request's own employee listed regardless.
    const selectableEmployees = useMemo(() => {
        const current = employees.filter(isPayableEmployee);
        if (editingLeave && !current.some(e => e.id === editingLeave.employee_id)) {
            const own = employees.find(e => e.id === editingLeave.employee_id);
            if (own) return [own, ...current];
        }
        return current;
    }, [employees, editingLeave]);

    const handleOpenModal = (leave?: LeaveRequest) => {
        if (leave) {
            setEditingLeave(leave);
            setFormData(leave);
        } else {
            setEditingLeave(null);
            // Only ever preselect someone the dropdown actually shows.
            const first = employees.find(isPayableEmployee);
            setFormData({ ...defaultFormData, employee_id: first ? first.id : '' });
        }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.employee_id || !formData.start_date || !formData.end_date || isSaving) return;
        // The date input's `min` only styles the field — a typed end date can still precede the start.
        if (formData.end_date < formData.start_date) {
            showToast('End date cannot be before the start date', 'error');
            return;
        }
        setIsSaving(true);
        try {
            await saveLeaveRequest(formData);
            setIsModalOpen(false);
        } catch (error) {
            // Handled in hook
        } finally {
            setIsSaving(false);
        }
    };

    const handleStatusChange = async (leave: LeaveRequest, newStatus: string) => {
        setBusyId(leave.id);
        try {
            await saveLeaveRequest({ ...leave, status: newStatus });
        } catch { /* hook toasts */ } finally {
            setBusyId(null);
        }
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

    const cell = isMobile ? '10px 12px' : '14px 20px';
    const grid2 = isMobile ? '1fr' : '1fr 1fr';
    const requestedDays = formData.start_date && formData.end_date && formData.end_date >= formData.start_date
        ? calculateDays(formData.start_date, formData.end_date)
        : 0;

    return (
        <div className="page-container fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {STATUS_TABS.map(status => {
                        const active = filterStatus === status;
                        const count = statusCounts[status] || 0;
                        return (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                style={{
                                    padding: '7px 14px',
                                    borderRadius: '20px',
                                    border: 'none',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    background: active ? 'var(--color-primary)' : 'var(--color-bg)',
                                    color: active ? '#fff' : 'var(--color-text-secondary)',
                                    boxShadow: active ? 'var(--shadow-sm)' : 'none'
                                }}
                            >
                                {status}
                                <span style={{
                                    background: active ? 'rgba(255,255,255,0.25)' : (status === 'Pending' && count > 0 ? '#FEF3C7' : 'var(--color-surface)'),
                                    color: active ? '#fff' : (status === 'Pending' && count > 0 ? '#D97706' : 'inherit'),
                                    padding: '1px 7px', borderRadius: '12px', fontSize: '10px', fontWeight: 700,
                                }}>{count}</span>
                            </button>
                        );
                    })}
                </div>
                <button
                    className="primary-button"
                    onClick={() => handleOpenModal()}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '12px', fontWeight: 500, boxShadow: 'var(--shadow-sm)' }}
                >
                    <Plus size={18} /> {isMobile ? 'Leave' : 'Log Leave Request'}
                </button>
            </div>

            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: 'none' }}>
                    <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Employee</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Leave Type</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Duration</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Reason</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Status</th>
                            <th style={{ padding: cell, fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>Actions</th>
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
                                const isBusy = busyId === req.id;
                                return (
                                    <tr key={req.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease', opacity: isBusy ? 0.6 : 1 }} className="hover-highlight">
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
                                                        {emp.department && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>{emp.department}</div>}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unknown Employee</span>
                                            )}
                                        </td>
                                        <td style={{ padding: cell, fontWeight: 500, whiteSpace: 'nowrap' }}>
                                            {req.leave_type}
                                        </td>
                                        <td style={{ padding: cell }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <div style={{ fontSize: '13px', fontWeight: 600 }}>
                                                    {calculateDays(req.start_date, req.end_date)} day(s)
                                                </div>
                                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                                                    {new Date(req.start_date).toLocaleDateString()} – {new Date(req.end_date).toLocaleDateString()}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: cell, fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '220px' }} title={req.reason || ''}>
                                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.reason || '—'}</div>
                                        </td>
                                        <td style={{ padding: cell }}>
                                            <StatusBadge status={req.status} />
                                        </td>
                                        <td style={{ padding: cell, textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', opacity: 0.85 }} className="actions-group">
                                                {req.status === 'Pending' && (
                                                    <>
                                                        <button
                                                            onClick={() => handleStatusChange(req, 'Approved')}
                                                            disabled={isBusy}
                                                            style={{ padding: '6px 8px', borderRadius: '6px', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-success)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600 }}
                                                            title="Approve"
                                                        >
                                                            <CheckCircle size={14} /> {!isMobile && 'Approve'}
                                                        </button>
                                                        <button
                                                            onClick={() => handleStatusChange(req, 'Rejected')}
                                                            disabled={isBusy}
                                                            style={{ padding: '6px 8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600 }}
                                                            title="Reject"
                                                        >
                                                            <XCircle size={14} /> {!isMobile && 'Reject'}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px 0', minWidth: isMobile ? undefined : '400px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Employee *</label>
                        <select
                            className="input-field"
                            style={{ width: '100%', padding: '10px 12px' }}
                            value={formData.employee_id || ''}
                            onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                        >
                            {selectableEmployees.length === 0 && <option value="">No active employees</option>}
                            {selectableEmployees.map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: grid2, gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Leave Type</label>
                            <select
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.leave_type || 'Vacation'}
                                onChange={(e) => setFormData({ ...formData, leave_type: e.target.value })}
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
                                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                            >
                                <option value="Pending">Pending</option>
                                <option value="Approved">Approved</option>
                                <option value="Rejected">Rejected</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: grid2, gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Start Date *</label>
                            <input
                                type="date"
                                className="input-field"
                                style={{ width: '100%', padding: '10px 12px' }}
                                value={formData.start_date || ''}
                                onChange={(e) => {
                                    const start = e.target.value;
                                    // Keep the range valid as the start moves past the end.
                                    setFormData(prev => ({ ...prev, start_date: start, end_date: prev.end_date && prev.end_date < start ? start : prev.end_date }));
                                }}
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
                                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                            />
                        </div>
                    </div>
                    {requestedDays > 0 && (
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '-8px' }}>
                            {requestedDays} day(s) requested
                        </div>
                    )}

                    <div>
                        <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Reason (Optional)</label>
                        <textarea
                            className="input-field"
                            style={{ width: '100%', padding: '10px 12px', minHeight: '80px', resize: 'vertical' }}
                            value={formData.reason || ''}
                            onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                            placeholder="Brief reason for the leave..."
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px' }}>Cancel</button>
                        <button
                            className="primary-button"
                            onClick={handleSave}
                            disabled={!formData.employee_id || !formData.start_date || !formData.end_date || isSaving}
                            style={{ padding: '10px 24px', borderRadius: '8px', fontWeight: 600 }}
                        >
                            {isSaving ? 'Saving…' : (editingLeave ? 'Save Changes' : 'Submit Request')}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default LeavesPage;
