import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import type { User, Role, Permission } from '../types';
import { Plus, Edit2, Trash2, Shield, User as UserIcon, Check, Lock } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const UserManagement: React.FC = () => {
    const { users, roles, addUser, updateUser, deleteUser, addRole, updateRole, deleteRole } = useStore();
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState<'users' | 'roles'>('users');

    // User State
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [userFormData, setUserFormData] = useState<Partial<User>>({ name: '', email: '', roleId: '', pin: '' });

    // Role State
    const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [roleFormData, setRoleFormData] = useState<Partial<Role>>({ name: '', description: '', permissions: [] });

    const allPermissions: Permission[] = [
        'view_dashboard',
        'manage_inventory',
        'view_reports',
        'manage_settings',
        'manage_users',
        'manage_orders',
        'create_orders',
        'view_orders',
        'view_inventory_stock'
    ];

    // User Handlers
    const handleOpenUserModal = (user?: User) => {
        if (user) {
            setEditingUser(user);
            setUserFormData(user);
        } else {
            setEditingUser(null);
            setUserFormData({ name: '', email: '', roleId: roles[0]?.id || '', pin: '' });
        }
        setIsUserModalOpen(true);
    };

    const handleSaveUser = async () => {
        if (!userFormData.name || !userFormData.email || !userFormData.roleId) {
            showToast('Please fill in all required fields', 'error');
            return;
        }

        try {
            if (editingUser) {
                await updateUser(editingUser.id, userFormData);
                showToast('User updated successfully', 'success');
            } else {
                await addUser(userFormData as Omit<User, 'id'>);
                showToast('User added successfully', 'success');
            }
            setIsUserModalOpen(false);
        } catch (error) {
            showToast('Failed to save user', 'error');
        }
    };

    const handleDeleteUser = async (id: string) => {
        if (confirm('Are you sure you want to delete this user?')) {
            await deleteUser(id);
            showToast('User deleted successfully', 'success');
        }
    };

    // Role Handlers
    const handleOpenRoleModal = (role?: Role) => {
        if (role) {
            setEditingRole(role);
            setRoleFormData(role);
        } else {
            setEditingRole(null);
            setRoleFormData({ name: '', description: '', permissions: [] });
        }
        setIsRoleModalOpen(true);
    };

    const handleSaveRole = async () => {
        if (!roleFormData.name) {
            showToast('Role name is required', 'error');
            return;
        }

        try {
            if (editingRole) {
                await updateRole(editingRole.id, roleFormData);
                showToast('Role updated successfully', 'success');
            } else {
                await addRole(roleFormData as Omit<Role, 'id'>);
                showToast('Role added successfully', 'success');
            }
            setIsRoleModalOpen(false);
        } catch (error) {
            showToast('Failed to save role', 'error');
        }
    };

    const handleDeleteRole = async (id: string) => {
        if (users.some(u => u.roleId === id)) {
            showToast('Cannot delete role assigned to users', 'error');
            return;
        }
        if (confirm('Are you sure you want to delete this role?')) {
            await deleteRole(id);
            showToast('Role deleted successfully', 'success');
        }
    };

    const togglePermission = (permission: Permission) => {
        const currentPermissions = roleFormData.permissions || [];
        if (currentPermissions.includes(permission)) {
            setRoleFormData({ ...roleFormData, permissions: currentPermissions.filter(p => p !== permission) });
        } else {
            setRoleFormData({ ...roleFormData, permissions: [...currentPermissions, permission] });
        }
    };

    return (
        <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '24px', color: 'var(--color-text)' }}>User Management</h1>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', borderBottom: '1px solid var(--color-border)' }}>
                <button
                    onClick={() => setActiveTab('users')}
                    style={{
                        padding: '12px 24px',
                        borderBottom: activeTab === 'users' ? '2px solid var(--color-primary)' : 'none',
                        color: activeTab === 'users' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        fontWeight: activeTab === 'users' ? 'bold' : 'normal',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <UserIcon size={18} /> Users
                </button>
                <button
                    onClick={() => setActiveTab('roles')}
                    style={{
                        padding: '12px 24px',
                        borderBottom: activeTab === 'roles' ? '2px solid var(--color-primary)' : 'none',
                        color: activeTab === 'roles' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        fontWeight: activeTab === 'roles' ? 'bold' : 'normal',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <Shield size={18} /> Roles & Permissions
                </button>
            </div>

            {activeTab === 'users' ? (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                        <button
                            onClick={() => handleOpenUserModal()}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'var(--color-primary)',
                                color: 'white',
                                padding: '10px 16px',
                                borderRadius: '8px',
                                border: 'none',
                                cursor: 'pointer',
                                fontWeight: 500
                            }}
                        >
                            <Plus size={18} /> Add User
                        </button>
                    </div>

                    <div style={{ background: 'var(--color-surface)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ background: 'var(--color-bg-secondary)' }}>
                                <tr>
                                    <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)' }}>User</th>
                                    <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Role</th>
                                    <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)' }}>PIN</th>
                                    <th style={{ padding: '16px', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(user => (
                                    <tr key={user.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '16px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', fontWeight: 'bold' }}>
                                                    {user.name.charAt(0)}
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: 500 }}>{user.name}</div>
                                                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{user.email}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <span style={{
                                                padding: '4px 12px',
                                                borderRadius: '20px',
                                                background: 'rgba(59, 130, 246, 0.1)',
                                                color: '#3B82F6',
                                                fontSize: '13px',
                                                fontWeight: 500
                                            }}>
                                                {roles.find(r => r.id === user.roleId)?.name || 'Unknown'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-secondary)' }}>
                                                <Lock size={14} />
                                                <span>{user.pin ? '••••' : 'Not Set'}</span>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                <button onClick={() => handleOpenUserModal(user)} style={{ padding: '6px', borderRadius: '6px', color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'var(--color-bg-secondary)'} onMouseOut={e => e.currentTarget.style.background = 'none'}>
                                                    <Edit2 size={16} />
                                                </button>
                                                <button onClick={() => handleDeleteUser(user.id)} style={{ padding: '6px', borderRadius: '6px', color: 'var(--color-red)', background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'} onMouseOut={e => e.currentTarget.style.background = 'none'}>
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                        <button
                            onClick={() => handleOpenRoleModal()}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'var(--color-primary)',
                                color: 'white',
                                padding: '10px 16px',
                                borderRadius: '8px',
                                border: 'none',
                                cursor: 'pointer',
                                fontWeight: 500
                            }}
                        >
                            <Plus size={18} /> Add Role
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
                        {roles.map(role => (
                            <div key={role.id} style={{ background: 'var(--color-surface)', borderRadius: '12px', padding: '20px', border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                    <div>
                                        <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 600 }}>{role.name}</h3>
                                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>{role.description}</p>
                                    </div>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                        <button onClick={() => handleOpenRoleModal(role)} style={{ padding: '6px', borderRadius: '6px', color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}><Edit2 size={16} /></button>
                                        <button onClick={() => handleDeleteRole(role.id)} style={{ padding: '6px', borderRadius: '6px', color: 'var(--color-red)', background: 'none', border: 'none', cursor: 'pointer' }}><Trash2 size={16} /></button>
                                    </div>
                                </div>

                                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
                                    <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Permissions</h4>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        {role.permissions.map(perm => (
                                            <span key={perm} style={{
                                                fontSize: '12px',
                                                padding: '4px 10px',
                                                borderRadius: '12px',
                                                background: 'var(--color-bg-secondary)',
                                                color: 'var(--color-text)',
                                                border: '1px solid var(--color-border)'
                                            }}>
                                                {perm.replace(/_/g, ' ')}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* User Modal */}
            {isUserModalOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '12px', width: '400px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                        <h2 style={{ marginTop: 0, marginBottom: '20px' }}>{editingUser ? 'Edit User' : 'Add User'}</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>Name</label>
                                <input
                                    type="text"
                                    value={userFormData.name}
                                    onChange={e => setUserFormData({ ...userFormData, name: e.target.value })}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>Email</label>
                                <input
                                    type="email"
                                    value={userFormData.email}
                                    onChange={e => setUserFormData({ ...userFormData, email: e.target.value })}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>Role</label>
                                <select
                                    value={userFormData.roleId}
                                    onChange={e => setUserFormData({ ...userFormData, roleId: e.target.value })}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}
                                >
                                    {roles.map(role => (
                                        <option key={role.id} value={role.id}>{role.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>PIN (Optional)</label>
                                <input
                                    type="text"
                                    value={userFormData.pin}
                                    onChange={e => setUserFormData({ ...userFormData, pin: e.target.value })}
                                    placeholder="e.g. 1234"
                                    maxLength={4}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}
                                />
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                            <button onClick={() => setIsUserModalOpen(false)} style={{ padding: '10px 16px', borderRadius: '8px', background: 'none', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer' }}>Cancel</button>
                            <button onClick={handleSaveUser} style={{ padding: '10px 16px', borderRadius: '8px', background: 'var(--color-primary)', color: 'white', border: 'none', cursor: 'pointer' }}>Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Role Modal */}
            {isRoleModalOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '12px', width: '500px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                        <h2 style={{ marginTop: 0, marginBottom: '20px' }}>{editingRole ? 'Edit Role' : 'Add Role'}</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>Role Name</label>
                                <input
                                    type="text"
                                    value={roleFormData.name}
                                    onChange={e => setRoleFormData({ ...roleFormData, name: e.target.value })}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>Description</label>
                                <input
                                    type="text"
                                    value={roleFormData.description}
                                    onChange={e => setRoleFormData({ ...roleFormData, description: e.target.value })}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '12px', fontSize: '14px', fontWeight: 500 }}>Permissions</label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    {allPermissions.map(perm => (
                                        <div
                                            key={perm}
                                            onClick={() => togglePermission(perm)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '10px',
                                                padding: '8px 12px',
                                                borderRadius: '8px',
                                                border: roleFormData.permissions?.includes(perm) ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                background: roleFormData.permissions?.includes(perm) ? 'rgba(59, 130, 246, 0.05)' : 'var(--color-bg-secondary)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            <div style={{
                                                width: '18px',
                                                height: '18px',
                                                borderRadius: '4px',
                                                border: '1px solid',
                                                borderColor: roleFormData.permissions?.includes(perm) ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                                background: roleFormData.permissions?.includes(perm) ? 'var(--color-primary)' : 'transparent',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: 'white'
                                            }}>
                                                {roleFormData.permissions?.includes(perm) && <Check size={12} />}
                                            </div>
                                            <span style={{ fontSize: '13px', fontWeight: 500 }}>{perm.replace(/_/g, ' ')}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                            <button onClick={() => setIsRoleModalOpen(false)} style={{ padding: '10px 16px', borderRadius: '8px', background: 'none', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer' }}>Cancel</button>
                            <button onClick={handleSaveRole} style={{ padding: '10px 16px', borderRadius: '8px', background: 'var(--color-primary)', color: 'white', border: 'none', cursor: 'pointer' }}>Save</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;
