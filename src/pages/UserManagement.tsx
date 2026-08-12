import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import type { User, Role, Permission } from '../types';
import {
    Plus, Edit2, Trash2, Shield, User as UserIcon, Check, Lock, Users as UsersIcon,
    LayoutDashboard, ShoppingCart, Truck, Wallet, Package, Briefcase, HeartHandshake,
    Calculator, Settings, ShieldCheck
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';

// --- Permission catalog -----------------------------------------------------
// Grouped to mirror the app's actual navigation (see Sidebar.tsx / App.tsx routes),
// with human-readable labels and descriptions. This is the single source of truth
// for what the Roles editor shows, so new permissions only need to be added here.
interface PermissionMeta {
    key: Permission;
    label: string;
    description: string;
}
interface PermissionGroup {
    category: string;
    icon: React.ComponentType<{ size?: number }>;
    permissions: PermissionMeta[];
}

const PERMISSION_GROUPS: PermissionGroup[] = [
    {
        category: 'Dashboard',
        icon: LayoutDashboard,
        permissions: [
            { key: 'view_dashboard', label: 'View Dashboard', description: 'Access the home dashboard, Todo and shipping point' },
        ],
    },
    {
        category: 'Sales & Orders',
        icon: ShoppingCart,
        permissions: [
            { key: 'process_sales', label: 'Process Sales (POS)', description: 'Use the point-of-sale to ring up sales' },
            { key: 'view_orders', label: 'View Orders', description: 'View orders in read-only mode' },
            { key: 'create_orders', label: 'Create Orders', description: 'Create new customer orders' },
            { key: 'manage_orders', label: 'Manage Orders', description: 'Edit, delete, and manage shipping, payments and scammers' },
        ],
    },
    {
        category: 'Inventory',
        icon: Package,
        permissions: [
            { key: 'view_inventory_stock', label: 'View Stock', description: 'View products and stock levels' },
            { key: 'manage_inventory', label: 'Manage Inventory', description: 'Edit products, categories, warehouses and stock movements' },
        ],
    },
    {
        category: 'Finance',
        icon: Wallet,
        permissions: [
            { key: 'manage_income_expense', label: 'Income & Expense', description: 'Manage income, expenses, revenue and predictions' },
            { key: 'view_reports', label: 'View Reports', description: 'Access sales, financial and inventory reports' },
        ],
    },
    {
        category: 'Purchasing',
        icon: Truck,
        permissions: [
            { key: 'manage_procurement', label: 'Manage Procurement', description: 'Purchase orders, suppliers and receiving' },
        ],
    },
    {
        category: 'HR & Payroll',
        icon: Briefcase,
        permissions: [
            { key: 'manage_attendance', label: 'Manage Attendance', description: 'Record and review staff attendance' },
            { key: 'manage_payroll', label: 'Manage Payroll', description: 'Process payroll runs' },
            { key: 'manage_hr', label: 'Manage HR', description: 'Employees, leaves and HR payroll' },
        ],
    },
    {
        category: 'CRM',
        icon: HeartHandshake,
        permissions: [
            { key: 'manage_crm', label: 'Manage CRM', description: 'Leads, interactions and quotations' },
        ],
    },
    {
        category: 'Accounting',
        icon: Calculator,
        permissions: [
            { key: 'manage_accounting', label: 'Manage Accounting', description: 'Chart of accounts, journal entries and payments' },
        ],
    },
    {
        category: 'Administration',
        icon: Settings,
        permissions: [
            { key: 'manage_users', label: 'Manage Users', description: 'Create users and roles, assign permissions' },
            { key: 'manage_settings', label: 'Manage Settings', description: 'Store profile, security and system settings' },
        ],
    },
];

// Flat list of every permission key, derived from the catalog above.
const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key));
const UserManagement: React.FC = () => {
    const { users, roles, addUser, updateUser, deleteUser, addRole, updateRole, deleteRole, refreshData, currentUser } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const [activeTab, setActiveTab] = useState<'users' | 'roles'>('users');

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>User Management</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage user accounts and roles</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    React.useEffect(() => {
        refreshData(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // User State
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [userFormData, setUserFormData] = useState<Partial<User>>({ name: '', email: '', roleId: '', pin: '', dailyTarget: 0, weeklyTarget: 0, monthlyTarget: 0 });

    // Role State
    const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [roleFormData, setRoleFormData] = useState<Partial<Role>>({ name: '', description: '', permissions: [] });

    // User Handlers
    const handleOpenUserModal = (user?: User) => {
        if (user) {
            setEditingUser(user);
            setUserFormData({
                ...user,
                dailyTarget: user.dailyTarget || 0,
                weeklyTarget: user.weeklyTarget || 0,
                monthlyTarget: user.monthlyTarget || 0
            });
        } else {
            setEditingUser(null);
            setUserFormData({ name: '', email: '', roleId: roles[0]?.id || '', pin: '', dailyTarget: 0, weeklyTarget: 0, monthlyTarget: 0 });
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
            // Surface the store guard's actual reason (e.g. self-lockout) instead of a
            // generic message, so the user knows why the save was refused.
            showToast(error instanceof Error ? error.message : 'Failed to save role', 'error');
        }
    };

    const handleDeleteRole = async (id: string) => {
        if (!confirm('Are you sure you want to delete this role?')) return;
        try {
            await deleteRole(id);
            showToast('Role deleted successfully', 'success');
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Failed to delete role', 'error');
        }
    };

    // The Admin role is always full-access (enforced in hasPermission), so its
    // checkboxes are shown ticked-and-locked rather than pretending they're editable.
    const isEditingAdminRole = editingRole?.id === 'admin';

    const togglePermission = (permission: Permission) => {
        if (isEditingAdminRole) return;
        const currentPermissions = roleFormData.permissions || [];
        if (currentPermissions.includes(permission)) {
            setRoleFormData({ ...roleFormData, permissions: currentPermissions.filter(p => p !== permission) });
        } else {
            setRoleFormData({ ...roleFormData, permissions: [...currentPermissions, permission] });
        }
    };

    // Toggle every permission in a category on/off at once.
    const toggleGroup = (group: PermissionGroup) => {
        if (isEditingAdminRole) return;
        const current = roleFormData.permissions || [];
        const keys = group.permissions.map(p => p.key);
        const allSelected = keys.every(k => current.includes(k));
        const next = allSelected
            ? current.filter(p => !keys.includes(p))
            : Array.from(new Set([...current, ...keys]));
        setRoleFormData({ ...roleFormData, permissions: next });
    };

    // Select-all / clear-all across every permission.
    const toggleAllPermissions = () => {
        if (isEditingAdminRole) return;
        const current = roleFormData.permissions || [];
        const allSelected = ALL_PERMISSIONS.every(p => current.includes(p));
        setRoleFormData({ ...roleFormData, permissions: allSelected ? [] : [...ALL_PERMISSIONS] });
    };

    const selectedCount = isEditingAdminRole ? ALL_PERMISSIONS.length : (roleFormData.permissions?.length || 0);

    return (
        <div style={{ padding: '24px', maxWidth: '100%', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', gap: '16px' }}>
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
                
                <div style={{ paddingBottom: '12px' }}>
                    {activeTab === 'users' ? (
                        <button
                            onClick={() => handleOpenUserModal()}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                background: 'var(--color-primary)', color: 'white',
                                padding: '8px 16px', borderRadius: '8px',
                                border: 'none', cursor: 'pointer', fontWeight: 500
                            }}
                        >
                            <Plus size={18} /> Add User
                        </button>
                    ) : (
                        <button
                            onClick={() => handleOpenRoleModal()}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                background: 'var(--color-primary)', color: 'white',
                                padding: '8px 16px', borderRadius: '8px',
                                border: 'none', cursor: 'pointer', fontWeight: 500
                            }}
                        >
                            <Plus size={18} /> Add Role
                        </button>
                    )}
                </div>
            </div>

            {activeTab === 'users' ? (
                <div>


                    <div style={{ background: 'var(--color-surface)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ background: 'var(--color-bg-secondary)' }}>
                                <tr>
                                    <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)' }}>User</th>
                                    <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Role</th>
                                    <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Password</th>
                                    <th style={{ padding: '16px', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...users].sort((a, b) => {
                                    const roleA = roles.find(r => r.id === a.roleId)?.name || '';
                                    const roleB = roles.find(r => r.id === b.roleId)?.name || '';
                                    return roleA.localeCompare(roleB);
                                }).map(user => (
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


                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                        {roles.map(role => {
                            const assignedUsers = users.filter(u => u.roleId === role.id).length;
                            const permCount = role.permissions.length;
                            const isAdminRole = role.id === 'admin';
                            // Admin has full access regardless of its stored list.
                            const hasFullAccess = isAdminRole || ALL_PERMISSIONS.every(p => role.permissions.includes(p));
                            // Why deletion is blocked, if it is — mirrors the store guards.
                            const deleteBlockedReason = isAdminRole
                                ? 'The Admin role is protected'
                                : assignedUsers > 0
                                    ? 'Reassign its users first'
                                    : currentUser?.roleId === role.id
                                        ? 'This is your own role'
                                        : null;
                            return (
                                <div key={role.id} style={{ display: 'flex', flexDirection: 'column', background: 'var(--color-surface)', borderRadius: '12px', padding: '20px', border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                                            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', flexShrink: 0 }}>
                                                <Shield size={20} />
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <h3 style={{ margin: '0 0 2px 0', fontSize: '17px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{role.name}</h3>
                                                <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>{role.description || 'No description'}</p>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                            <button onClick={() => handleOpenRoleModal(role)} title={isAdminRole ? 'View Admin role (always full access)' : 'Edit role'} style={{ padding: '6px', borderRadius: '6px', color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}><Edit2 size={16} /></button>
                                            <button
                                                onClick={() => handleDeleteRole(role.id)}
                                                disabled={!!deleteBlockedReason}
                                                title={deleteBlockedReason || 'Delete role'}
                                                style={{ padding: '6px', borderRadius: '6px', color: 'var(--color-red)', background: 'none', border: 'none', cursor: deleteBlockedReason ? 'not-allowed' : 'pointer', opacity: deleteBlockedReason ? 0.35 : 1 }}
                                            ><Trash2 size={16} /></button>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                            <UsersIcon size={13} /> {assignedUsers} {assignedUsers === 1 ? 'user' : 'users'}
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                            <ShieldCheck size={13} /> {permCount} {permCount === 1 ? 'permission' : 'permissions'}
                                        </span>
                                    </div>

                                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: 'auto' }}>
                                        <h4 style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Permissions</h4>
                                        {hasFullAccess ? (
                                            <span style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.1)', color: '#16A34A', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                <ShieldCheck size={13} /> Full access
                                            </span>
                                        ) : permCount === 0 ? (
                                            <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>No permissions granted</span>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                {PERMISSION_GROUPS.map(group => {
                                                    const granted = group.permissions.filter(p => role.permissions.includes(p.key));
                                                    if (granted.length === 0) return null;
                                                    const GroupIcon = group.icon;
                                                    return (
                                                        <div key={group.category}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                                                                <GroupIcon size={12} /> {group.category}
                                                            </div>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                                {granted.map(p => (
                                                                    <span key={p.key} style={{
                                                                        fontSize: '12px',
                                                                        padding: '4px 10px',
                                                                        borderRadius: '12px',
                                                                        background: 'var(--color-bg-secondary)',
                                                                        color: 'var(--color-text)',
                                                                        border: '1px solid var(--color-border)'
                                                                    }}>
                                                                        {p.label}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* User Modal */}
            {isUserModalOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: 'var(--color-surface)', padding: '24px', borderRadius: '12px', width: '450px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
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
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500 }}>Password <span style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>(Optional)</span></label>
                                <input
                                    type="text"
                                    value={userFormData.pin}
                                    onChange={e => setUserFormData({ ...userFormData, pin: e.target.value })}
                                    placeholder="Enter password"
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}
                                />
                            </div>
                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: '8px' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: 'var(--color-primary)' }}>Sales Targets ($)</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 500 }}>Daily</label>
                                        <input
                                            type="number"
                                            value={userFormData.dailyTarget || 0}
                                            onChange={e => setUserFormData({ ...userFormData, dailyTarget: parseFloat(e.target.value) || 0 })}
                                            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', fontSize: '13px' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 500 }}>Weekly</label>
                                        <input
                                            type="number"
                                            value={userFormData.weeklyTarget || 0}
                                            onChange={e => setUserFormData({ ...userFormData, weeklyTarget: parseFloat(e.target.value) || 0 })}
                                            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', fontSize: '13px' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 500 }}>Monthly</label>
                                        <input
                                            type="number"
                                            value={userFormData.monthlyTarget || 0}
                                            onChange={e => setUserFormData({ ...userFormData, monthlyTarget: parseFloat(e.target.value) || 0 })}
                                            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', fontSize: '13px' }}
                                        />
                                    </div>
                                </div>
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
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 500 }}>
                                        Permissions <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>({selectedCount}/{ALL_PERMISSIONS.length})</span>
                                    </label>
                                    {!isEditingAdminRole && (
                                        <button
                                            type="button"
                                            onClick={toggleAllPermissions}
                                            style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                        >
                                            {ALL_PERMISSIONS.every(p => roleFormData.permissions?.includes(p)) ? 'Clear all' : 'Select all'}
                                        </button>
                                    )}
                                </div>

                                {isEditingAdminRole && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', marginBottom: '12px', borderRadius: '8px', background: 'rgba(34, 197, 94, 0.08)', color: '#16A34A', fontSize: '12px', fontWeight: 500 }}>
                                        <ShieldCheck size={14} /> The Admin role always has full access and cannot be changed.
                                    </div>
                                )}

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {PERMISSION_GROUPS.map(group => {
                                        const GroupIcon = group.icon;
                                        const groupKeys = group.permissions.map(p => p.key);
                                        const allInGroup = groupKeys.every(k => roleFormData.permissions?.includes(k));
                                        return (
                                            <div key={group.category}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                                        <GroupIcon size={14} /> {group.category}
                                                    </div>
                                                    {!isEditingAdminRole && (
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleGroup(group)}
                                                            style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                                        >
                                                            {allInGroup ? 'Clear' : 'All'}
                                                        </button>
                                                    )}
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                    {group.permissions.map(({ key, label, description }) => {
                                                        const checked = isEditingAdminRole || roleFormData.permissions?.includes(key);
                                                        return (
                                                            <div
                                                                key={key}
                                                                onClick={() => togglePermission(key)}
                                                                title={description}
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'flex-start',
                                                                    gap: '10px',
                                                                    padding: '10px 12px',
                                                                    borderRadius: '8px',
                                                                    border: checked ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                                    background: checked ? 'rgba(59, 130, 246, 0.05)' : 'var(--color-bg-secondary)',
                                                                    cursor: isEditingAdminRole ? 'not-allowed' : 'pointer',
                                                                    opacity: isEditingAdminRole ? 0.7 : 1,
                                                                    transition: 'all 0.2s'
                                                                }}
                                                            >
                                                                <div style={{
                                                                    width: '18px',
                                                                    height: '18px',
                                                                    borderRadius: '4px',
                                                                    border: '1px solid',
                                                                    borderColor: checked ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                                                    background: checked ? 'var(--color-primary)' : 'transparent',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    color: 'white',
                                                                    flexShrink: 0,
                                                                    marginTop: '1px'
                                                                }}>
                                                                    {checked && <Check size={12} />}
                                                                </div>
                                                                <div style={{ minWidth: 0 }}>
                                                                    <div style={{ fontSize: '13px', fontWeight: 500 }}>{label}</div>
                                                                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', lineHeight: 1.3, marginTop: '2px' }}>{description}</div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
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
