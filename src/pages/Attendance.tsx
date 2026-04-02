import React, { useState, useEffect } from 'react';
import { useStore } from '../context/StoreContext';
import { useAttendance } from '../hooks/useAttendance';
import type { StaffAttendance } from '../types';
import { Calendar, CheckCircle2, AlertCircle, UserCheck, Play, Square, Edit2, User, DollarSign } from 'lucide-react';
import Payroll from './Payroll';

// Helper to get initials
const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?';
};

// Helper to format time (e.g. "14:30" or "14:30:00" -> "02:30 PM")
const formatTime = (timeStr?: string | null) => {
    if (!timeStr) return '--:--';
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    const date = new Date();
    date.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10));
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Helper to get current time in HH:mm
const getCurrentTimeStr = () => {
    const d = new Date();
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
};

const Attendance: React.FC = () => {
    const { hasPermission } = useStore();
    const [activeTab, setActiveTab] = useState<'daily' | 'payroll'>('daily');
    const today = new Date().toISOString().split('T')[0];
    const [selectedDate, setSelectedDate] = useState<string>(today);
    const { staff, attendances, isLoading, error, fetchAttendanceData, updateAttendance } = useAttendance();
    const [savingId, setSavingId] = useState<string | null>(null);

    // State to toggle manual edit mode for times
    const [editingTime, setEditingTime] = useState<{ userId: string, field: 'clockIn' | 'clockOut' } | null>(null);

    useEffect(() => {
        fetchAttendanceData(selectedDate);
    }, [selectedDate, fetchAttendanceData]);

    const handleStatusChange = async (userId: string, newStatus: StaffAttendance['status']) => {
        setSavingId(userId);
        try {
            await updateAttendance(userId, selectedDate, { status: newStatus });
        } finally {
            setSavingId(null);
        }
    };

    const handleTimeChange = async (userId: string, field: 'clockIn' | 'clockOut', value: string) => {
        setSavingId(userId);
        try {
            await updateAttendance(userId, selectedDate, { [field]: value });
            setEditingTime(null);
        } finally {
            setSavingId(null);
        }
    };

    const handleQuickClockIn = async (userId: string, currentStatus?: string) => {
        setSavingId(userId);
        const updates: any = { clockIn: getCurrentTimeStr() };
        if (!currentStatus || currentStatus === 'Select...') {
            updates.status = 'Present';
        }
        try {
            await updateAttendance(userId, selectedDate, updates);
        } finally {
            setSavingId(null);
        }
    };

    const handleQuickClockOut = async (userId: string) => {
        setSavingId(userId);
        try {
            await updateAttendance(userId, selectedDate, { clockOut: getCurrentTimeStr() });
        } finally {
            setSavingId(null);
        }
    };

    const handleNotesChange = async (userId: string, value: string) => {
        setSavingId(userId);
        try {
            await updateAttendance(userId, selectedDate, { notes: value });
        } finally {
            setSavingId(null);
        }
    };

    const getStatusColor = (status: StaffAttendance['status'] | undefined) => {
        switch (status) {
            case 'Present': return 'var(--color-success)';
            case 'Absent': return 'var(--color-danger)';
            case 'Late': return 'var(--color-warning)';
            case 'Half Day': return 'var(--color-warning)';
            case 'Leave': return 'var(--color-primary)';
            default: return 'var(--color-text-muted)';
        }
    };

    const getStatusBg = (status: StaffAttendance['status'] | undefined) => {
        switch (status) {
            case 'Present': return 'rgba(34, 197, 94, 0.1)';
            case 'Absent': return 'rgba(239, 68, 68, 0.1)';
            case 'Late': return 'rgba(245, 158, 11, 0.1)';
            case 'Half Day': return 'rgba(245, 158, 11, 0.1)';
            case 'Leave': return 'rgba(59, 130, 246, 0.1)';
            default: return 'rgba(156, 163, 175, 0.1)';
        }
    };

    return (
        <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
            {/* Header & Date Selector */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px', marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--color-primary)' }}>
                        <UserCheck size={32} />
                        Attendance Hub
                    </h1>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '6px', fontSize: '15px' }}>
                        Manage daily shifts, statuses, and calculate monthly payroll.
                    </p>
                </div>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--color-border)', marginBottom: '32px' }}>
                <button
                    onClick={() => setActiveTab('daily')}
                    style={{
                        padding: '12px 24px',
                        borderBottom: activeTab === 'daily' ? '3px solid var(--color-primary)' : 'none',
                        color: activeTab === 'daily' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        fontWeight: activeTab === 'daily' ? 'bold' : '500',
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '8px',
                        transition: 'border-color 0.2s, color 0.2s'
                    }}
                >
                    <UserCheck size={18} /> Daily Log
                </button>
                {hasPermission('manage_payroll') && (
                    <button
                        onClick={() => setActiveTab('payroll')}
                        style={{
                            padding: '12px 24px',
                            borderBottom: activeTab === 'payroll' ? '3px solid var(--color-primary)' : 'none',
                            color: activeTab === 'payroll' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            fontWeight: activeTab === 'payroll' ? 'bold' : '500',
                            background: 'none', border: 'none', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px',
                            transition: 'border-color 0.2s, color 0.2s'
                        }}
                    >
                        <DollarSign size={18} /> Monthly Payroll
                    </button>
                )}
            </div>

            {/* Daily Log Content */}
            {activeTab === 'daily' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--color-surface)', padding: '10px 16px', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                            <Calendar size={22} color="var(--color-primary)" />
                            <input 
                                type="date" 
                                value={selectedDate} 
                                onChange={(e) => setSelectedDate(e.target.value)}
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
                    <div dangerouslySetInnerHTML={{ __html: error }} />
                </div>
            )}

            {/* Top Summary Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                <div style={{ background: 'var(--color-surface)', padding: '20px', borderRadius: '16px', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(156, 163, 175, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <User size={24} color="var(--color-text-muted)" />
                    </div>
                    <div>
                        <h3 style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: '4px', fontWeight: 600 }}>Total Staff</h3>
                        <p style={{ fontSize: '24px', fontWeight: '800' }}>{staff.length}</p>
                    </div>
                </div>
                <div style={{ background: 'var(--color-surface)', padding: '20px', borderRadius: '16px', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CheckCircle2 size={24} color="var(--color-success)" />
                    </div>
                    <div>
                        <h3 style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: '4px', fontWeight: 600 }}>Present Today</h3>
                        <p style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-success)' }}>
                            {attendances.filter(a => a.status === 'Present').length}
                        </p>
                    </div>
                </div>
                <div style={{ background: 'var(--color-surface)', padding: '20px', borderRadius: '16px', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <AlertCircle size={24} color="var(--color-danger)" />
                    </div>
                    <div>
                        <h3 style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: '4px', fontWeight: 600 }}>Absent / Leave</h3>
                        <p style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-danger)' }}>
                            {attendances.filter(a => a.status === 'Absent' || a.status === 'Leave').length}
                        </p>
                    </div>
                </div>
            </div>

            {/* Staff Grid */}
            {isLoading ? (
                <div style={{ padding: '64px', display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '16px' }}>
                    <div className="loader" style={{ width: '48px', height: '48px' }}>Loading...</div>
                    <p style={{ color: 'var(--color-text-muted)' }}>Retrieving records...</p>
                </div>
            ) : staff.length === 0 ? (
                <div style={{ padding: '64px', textAlign: 'center', background: 'var(--color-surface)', borderRadius: '16px', border: '1px dashed var(--color-border)' }}>
                    <User size={48} color="var(--color-text-muted)" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                    <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text)' }}>No Staff Found</h3>
                    <p style={{ color: 'var(--color-text-muted)', marginTop: '8px' }}>Users added in User Management will appear here.</p>
                </div>
            ) : (
                <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', border: '1px solid var(--color-border)' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                            <thead style={{ background: 'var(--color-bg-secondary)' }}>
                                <tr>
                                    <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 'bold', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Staff Member</th>
                                    <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 'bold', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Status</th>
                                    <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 'bold', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Clock In</th>
                                    <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 'bold', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Clock Out</th>
                                    <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 'bold', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {staff.map((user) => {
                                    const attRecord = attendances.find(a => a.userId === user.id);
                                    const isSaving = savingId === user.id;
                                    const statusColor = attRecord ? getStatusColor(attRecord.status) : 'var(--color-border)';
                                    const statusBg = attRecord ? getStatusBg(attRecord.status) : 'var(--color-surface)';

                                    return (
                                        <tr key={user.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s', backgroundColor: isSaving ? 'rgba(0,0,0,0.02)' : 'transparent' }}>
                                            {/* User Info */}
                                            <td style={{ padding: '16px 24px', verticalAlign: 'middle' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                    <div style={{ 
                                                        width: '40px', height: '40px', 
                                                        borderRadius: '50%', 
                                                        backgroundColor: statusBg, 
                                                        color: statusColor !== 'var(--color-border)' ? statusColor : 'var(--color-text-muted)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: '16px', fontWeight: 'bold',
                                                        border: `2px solid ${statusBg === 'var(--color-surface)' ? 'var(--color-border)' : statusColor}`
                                                    }}>
                                                        {getInitials(user.name)}
                                                    </div>
                                                    <div style={{ overflow: 'hidden' }}>
                                                        <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
                                                            {user.name}
                                                        </h3>
                                                        <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
                                                            {user.roleId}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Status Dropdown */}
                                            <td style={{ padding: '16px 24px', verticalAlign: 'middle' }}>
                                                <select
                                                    value={attRecord?.status || ''}
                                                    onChange={(e) => handleStatusChange(user.id, e.target.value as any)}
                                                    style={{
                                                        width: '140px',
                                                        padding: '8px 12px',
                                                        borderRadius: '8px',
                                                        border: `1px solid ${statusColor}`,
                                                        backgroundColor: statusBg,
                                                        color: statusColor !== 'var(--color-border)' ? statusColor : 'var(--color-text)',
                                                        fontWeight: '600',
                                                        fontSize: '14px',
                                                        outline: 'none',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    <option value="" disabled>Select Status...</option>
                                                    <option value="Present">🟢 Present</option>
                                                    <option value="Absent">🔴 Absent</option>
                                                    <option value="Late">🟠 Late</option>
                                                    <option value="Half Day">🟡 Half Day</option>
                                                    <option value="Leave">🔵 Leave</option>
                                                </select>
                                            </td>

                                            {/* Clock In */}
                                            <td style={{ padding: '16px 24px', verticalAlign: 'middle' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {editingTime?.userId === user.id && editingTime.field === 'clockIn' ? (
                                                        <input
                                                            type="time"
                                                            autoFocus
                                                            value={attRecord?.clockIn || ''}
                                                            onChange={(e) => handleTimeChange(user.id, 'clockIn', e.target.value)}
                                                            onBlur={() => setEditingTime(null)}
                                                            style={{ width: '110px', border: '1px solid var(--color-primary)', background: 'transparent', outline: 'none', color: 'var(--color-text)', fontSize: '14px', fontWeight: 600, padding: '4px 8px', borderRadius: '4px' }}
                                                        />
                                                    ) : attRecord?.clockIn ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>
                                                                {formatTime(attRecord.clockIn)}
                                                            </div>
                                                            <Edit2 size={12} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => setEditingTime({ userId: user.id, field: 'clockIn'})} />
                                                        </div>
                                                    ) : (
                                                        <button 
                                                            onClick={() => handleQuickClockIn(user.id, attRecord?.status)}
                                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '6px 12px', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
                                                        >
                                                            <Play size={14} fill="currentColor" /> In
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Clock Out */}
                                            <td style={{ padding: '16px 24px', verticalAlign: 'middle' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {editingTime?.userId === user.id && editingTime.field === 'clockOut' ? (
                                                        <input
                                                            type="time"
                                                            autoFocus
                                                            value={attRecord?.clockOut || ''}
                                                            onChange={(e) => handleTimeChange(user.id, 'clockOut', e.target.value)}
                                                            onBlur={() => setEditingTime(null)}
                                                            style={{ width: '110px', border: '1px solid var(--color-primary)', background: 'transparent', outline: 'none', color: 'var(--color-text)', fontSize: '14px', fontWeight: 600, padding: '4px 8px', borderRadius: '4px' }}
                                                        />
                                                    ) : attRecord?.clockOut ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>
                                                                {formatTime(attRecord.clockOut)}
                                                            </div>
                                                            <Edit2 size={12} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => setEditingTime({ userId: user.id, field: 'clockOut'})} />
                                                        </div>
                                                    ) : (
                                                        <button 
                                                            disabled={!attRecord?.clockIn}
                                                            onClick={() => handleQuickClockOut(user.id)}
                                                            style={{ 
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '6px 12px', 
                                                                background: 'var(--color-surface)', color: attRecord?.clockIn ? '#f97316' : 'var(--color-text-muted)', 
                                                                border: `1px solid ${attRecord?.clockIn ? '#fdba74' : 'var(--color-border)'}`, 
                                                                borderRadius: '6px', cursor: attRecord?.clockIn ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: 600 
                                                            }}
                                                        >
                                                            <Square size={14} fill="currentColor" /> Out
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Notes */}
                                            <td style={{ padding: '16px 24px', verticalAlign: 'middle' }}>
                                                <input
                                                    key={`notes-${selectedDate}-${user.id}`}
                                                    type="text"
                                                    defaultValue={attRecord?.notes || ''}
                                                    placeholder="Add notes..."
                                                    onBlur={(e) => {
                                                        if (e.target.value !== (attRecord?.notes || '')) {
                                                            handleNotesChange(user.id, e.target.value);
                                                        }
                                                    }}
                                                    style={{
                                                        width: '100%',
                                                        minWidth: '150px',
                                                        padding: '8px 12px',
                                                        borderRadius: '8px',
                                                        border: '1px solid transparent',
                                                        background: 'var(--color-background)',
                                                        color: 'var(--color-text)',
                                                        outline: 'none',
                                                        fontSize: '13px',
                                                        transition: 'all 0.2s',
                                                    }}
                                                    onFocus={(e) => e.target.style.border = '1px solid var(--color-primary)'}
                                                    onMouseLeave={(e) => {
                                                        if(document.activeElement !== e.target) {
                                                            (e.target as HTMLInputElement).style.border = '1px solid transparent';
                                                        }
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        if(document.activeElement !== e.target) {
                                                            (e.target as HTMLInputElement).style.border = '1px solid var(--color-border)';
                                                        }
                                                    }}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            </div>
            )}
            
            {/* Payroll Content */}
            {activeTab === 'payroll' && (
                <Payroll />
            )}
        </div>
    );
};

export default Attendance;

