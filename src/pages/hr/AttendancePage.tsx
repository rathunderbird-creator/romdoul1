import React, { useState, useEffect } from 'react';
import { useAttendance } from '../../hooks/useAttendance';
import type { User as UserType, StaffAttendance } from '../../types';
import { Calendar, CheckCircle2, AlertCircle, UserCheck, Play, Square, Edit2, User, Check, X } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';

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

const AttendancePage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const today = new Date().toISOString().split('T')[0];
    const [selectedDate, setSelectedDate] = useState<string>(today);
    const { staff, attendances, isLoading, error, fetchAttendanceData, updateAttendance } = useAttendance();
    const [savingId, setSavingId] = useState<string | null>(null);

    // State to toggle manual edit mode for times
    const [editingTime, setEditingTime] = useState<{ userId: string, field: 'clockIn' | 'clockOut', value: string } | null>(null);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Attendance Log</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage daily shifts and staff attendance records.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

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
        <div className="page-container fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <UserCheck size={24} color="var(--color-primary)" />
                    Daily Attendance
                </h2>
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

            {error && (
                <div style={{ padding: '16px 20px', backgroundColor: 'rgba(239, 68, 68, 0.12)', borderLeft: '4px solid var(--color-danger)', color: 'var(--color-text)', borderRadius: '8px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '15px' }}>
                    <AlertCircle size={24} color="var(--color-danger)" />
                    <div dangerouslySetInnerHTML={{ __html: error }} />
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                <div className="clickable-card glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(156, 163, 175, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <User size={24} color="var(--color-text-muted)" />
                    </div>
                    <div>
                        <h3 style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: '4px', fontWeight: 600 }}>Total Staff</h3>
                        <p style={{ fontSize: '24px', fontWeight: '800' }}>{staff.length}</p>
                    </div>
                </div>
                <div className="clickable-card glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CheckCircle2 size={24} color="var(--color-success)" />
                    </div>
                    <div>
                        <h3 style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: '4px', fontWeight: 600 }}>Present Today</h3>
                        <p style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-success)' }}>
                            {attendances.filter((a: StaffAttendance) => a.status === 'Present').length} <span style={{ fontSize: '14px', color: 'var(--color-text-muted)', fontWeight: 600 }}>/ {staff.length}</span>
                        </p>
                    </div>
                </div>
                <div className="clickable-card glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <AlertCircle size={24} color="var(--color-danger)" />
                    </div>
                    <div>
                        <h3 style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: '4px', fontWeight: 600 }}>Absent / Leave</h3>
                        <p style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-danger)' }}>
                            {attendances.filter((a: StaffAttendance) => a.status === 'Absent' || a.status === 'Leave').length}
                        </p>
                    </div>
                </div>
            </div>

            <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                {isLoading ? (
                    <div style={{ padding: '64px', display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '16px' }}>
                        <div className="loader" style={{ width: '48px', height: '48px' }}>Loading...</div>
                        <p style={{ color: 'var(--color-text-muted)' }}>Retrieving records...</p>
                    </div>
                ) : staff.length === 0 ? (
                    <div style={{ padding: '64px', textAlign: 'center' }}>
                        <User size={48} color="var(--color-text-muted)" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                        <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text)' }}>No Staff Found</h3>
                        <p style={{ color: 'var(--color-text-muted)', marginTop: '8px' }}>Users added in User Management will appear here.</p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', border: 'none' }}>
                            <thead>
                                <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                                    <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', borderRight: 'none' }}>Staff Member</th>
                                    <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', borderRight: 'none' }}>Status</th>
                                    <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', borderRight: 'none' }}>Clock In</th>
                                    <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', borderRight: 'none' }}>Clock Out</th>
                                    <th style={{ padding: '16px 24px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', borderRight: 'none' }}>Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {staff.map((user: UserType) => {
                                    const attRecord = attendances.find((a: StaffAttendance) => a.userId === user.id);
                                    const isSaving = savingId === user.id;
                                    const statusColor = attRecord ? getStatusColor(attRecord.status) : 'var(--color-border)';
                                    const statusBg = attRecord ? getStatusBg(attRecord.status) : 'var(--color-surface)';

                                    return (
                                        <tr 
                                            key={user.id} 
                                            className="hover-highlight"
                                            style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: isSaving ? 'rgba(0,0,0,0.02)' : 'transparent', opacity: isSaving ? 0.7 : 1 }}
                                        >
                                            <td style={{ padding: '16px 24px', verticalAlign: 'middle', borderRight: 'none' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                    <div style={{ 
                                                        width: '40px', height: '40px', 
                                                        borderRadius: '12px', 
                                                        backgroundColor: statusBg, 
                                                        color: statusColor !== 'var(--color-border)' ? statusColor : 'var(--color-text-muted)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: '14px', fontWeight: 'bold',
                                                        border: `2px solid ${statusBg === 'var(--color-surface)' ? 'var(--color-border)' : statusColor}`
                                                    }}>
                                                        {getInitials(user.name)}
                                                    </div>
                                                    <div>
                                                        <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>
                                                            {user.name}
                                                        </h3>
                                                        <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
                                                            {user.roleId}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>

                                            <td style={{ padding: '16px 24px', verticalAlign: 'middle', borderRight: 'none' }}>
                                                <select
                                                    value={attRecord?.status || ''}
                                                    onChange={(e) => handleStatusChange(user.id, e.target.value as any)}
                                                    className="input-field"
                                                    style={{
                                                        width: '140px',
                                                        padding: '8px 12px',
                                                        borderRadius: '8px',
                                                        border: `1px solid ${statusColor}`,
                                                        backgroundColor: statusBg,
                                                        color: statusColor !== 'var(--color-border)' ? statusColor : 'var(--color-text)',
                                                        fontWeight: '600',
                                                        fontSize: '13px',
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

                                            <td style={{ padding: '16px 24px', verticalAlign: 'middle', borderRight: 'none' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {editingTime?.userId === user.id && editingTime.field === 'clockIn' ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <input
                                                                type="time"
                                                                autoFocus
                                                                value={editingTime.value}
                                                                onChange={(e) => setEditingTime(prev => prev ? { ...prev, value: e.target.value } : null)}
                                                                style={{ width: '105px', border: '1px solid var(--color-primary)', background: 'transparent', outline: 'none', color: 'var(--color-text)', fontSize: '13px', fontWeight: 600, padding: '4px 8px', borderRadius: '6px' }}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter' && editingTime) handleTimeChange(user.id, 'clockIn', editingTime.value);
                                                                    if (e.key === 'Escape') setEditingTime(null);
                                                                }}
                                                            />
                                                            <button 
                                                                onClick={() => editingTime && handleTimeChange(user.id, 'clockIn', editingTime.value)}
                                                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px', background: 'var(--color-success)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                                                            ><Check size={14} /></button>
                                                            <button 
                                                                onClick={() => setEditingTime(null)}
                                                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer' }}
                                                            ><X size={14} /></button>
                                                        </div>
                                                    ) : attRecord?.clockIn ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>
                                                                {formatTime(attRecord.clockIn)}
                                                            </div>
                                                            <button className="icon-button" onClick={() => setEditingTime({ userId: user.id, field: 'clockIn', value: attRecord.clockIn || ''})} style={{ padding: '4px' }}>
                                                                <Edit2 size={12} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button 
                                                            onClick={() => handleQuickClockIn(user.id, attRecord?.status)}
                                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px 12px', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
                                                        >
                                                            <Play size={14} fill="currentColor" /> Clock In
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            <td style={{ padding: '16px 24px', verticalAlign: 'middle', borderRight: 'none' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {editingTime?.userId === user.id && editingTime.field === 'clockOut' ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <input
                                                                type="time"
                                                                autoFocus
                                                                value={editingTime.value}
                                                                onChange={(e) => setEditingTime(prev => prev ? { ...prev, value: e.target.value } : null)}
                                                                style={{ width: '105px', border: '1px solid var(--color-primary)', background: 'transparent', outline: 'none', color: 'var(--color-text)', fontSize: '13px', fontWeight: 600, padding: '4px 8px', borderRadius: '6px' }}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter' && editingTime) handleTimeChange(user.id, 'clockOut', editingTime.value);
                                                                    if (e.key === 'Escape') setEditingTime(null);
                                                                }}
                                                            />
                                                            <button 
                                                                onClick={() => editingTime && handleTimeChange(user.id, 'clockOut', editingTime.value)}
                                                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px', background: 'var(--color-success)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                                                            ><Check size={14} /></button>
                                                            <button 
                                                                onClick={() => setEditingTime(null)}
                                                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer' }}
                                                            ><X size={14} /></button>
                                                        </div>
                                                    ) : attRecord?.clockOut ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>
                                                                {formatTime(attRecord.clockOut)}
                                                            </div>
                                                            <button className="icon-button" onClick={() => setEditingTime({ userId: user.id, field: 'clockOut', value: attRecord.clockOut || ''})} style={{ padding: '4px' }}>
                                                                <Edit2 size={12} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button 
                                                            disabled={!attRecord?.clockIn}
                                                            onClick={() => handleQuickClockOut(user.id)}
                                                            style={{ 
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px 12px', 
                                                                background: 'var(--color-surface)', color: attRecord?.clockIn ? '#f97316' : 'var(--color-text-muted)', 
                                                                border: `1px solid ${attRecord?.clockIn ? '#fdba74' : 'var(--color-border)'}`, 
                                                                borderRadius: '8px', cursor: attRecord?.clockIn ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: 600 
                                                            }}
                                                        >
                                                            <Square size={14} fill="currentColor" /> Clock Out
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            <td style={{ padding: '16px 24px', verticalAlign: 'middle', borderRight: 'none' }}>
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
                                                    className="input-field"
                                                    style={{
                                                        width: '100%',
                                                        minWidth: '150px',
                                                        padding: '8px 12px',
                                                        borderRadius: '8px',
                                                        fontSize: '13px'
                                                    }}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AttendancePage;
