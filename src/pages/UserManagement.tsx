import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import type { User, Role, Permission } from '../types';
import {
    Plus, Edit2, Trash2, Shield, User as UserIcon, Check, Lock, Users as UsersIcon,
    LayoutDashboard, ShoppingCart, Truck, Wallet, Package, Briefcase, HeartHandshake,
    Calculator, Settings, ShieldCheck, X, Search, AlertCircle, Mail, Eye, EyeOff, Target
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
            { key: 'use_checkbox', label: 'Use Checkbox', description: 'Select order rows with checkboxes for batch operations' },
            { key: 'restock_orders', label: 'ReStock', description: 'Restock returned orders back into inventory' },
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
    const [userSearch, setUserSearch] = useState('');
    const [userRoleFilter, setUserRoleFilter] = useState('all');
    const [showUserPassword, setShowUserPassword] = useState(false);

    const closeUserModal = () => {
        setIsUserModalOpen(false);
        setShowUserPassword(false);
    };

    // Close the user modal on Escape for keyboard users.
    React.useEffect(() => {
        if (!isUserModalOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeUserModal(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isUserModalOpen]);

    // Role State
    const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [roleFormData, setRoleFormData] = useState<Partial<Role>>({ name: '', description: '', permissions: [] });
    const [roleSearch, setRoleSearch] = useState('');

    const closeRoleModal = () => {
        setIsRoleModalOpen(false);
        setRoleSearch('');
    };

    // Close the role modal on Escape for keyboard users.
    React.useEffect(() => {
        if (!isRoleModalOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRoleModal(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isRoleModalOpen]);

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
        setShowUserPassword(false);
        setIsUserModalOpen(true);
    };

    const handleSaveUser = async () => {
        const name = userFormData.name?.trim();
        const email = userFormData.email?.trim();
        if (!name || !email || !userFormData.roleId) {
            showToast('Please fill in all required fields', 'error');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showToast('Please enter a valid email address', 'error');
            return;
        }
        const duplicateEmail = users.some(u => u.id !== editingUser?.id && u.email.trim().toLowerCase() === email.toLowerCase());
        if (duplicateEmail) {
            showToast('A user with this email already exists', 'error');
            return;
        }
        // A new account needs a password up front: PINs can't be read back
        // anymore, so an account created without one would look normal in the
        // list ('••••') but could never log in (check_pin refuses empty PINs).
        if (!editingUser && !(userFormData.pin || '').trim()) {
            showToast('Please set a login password for the new user', 'error');
            return;
        }

        try {
            if (editingUser) {
                // PINs can't be read back anymore, so the form field starts empty
                // on edit: blank means "keep the current password" (as the
                // placeholder says) — only a typed value changes it.
                const { pin: pinInput, ...restForm } = userFormData;
                const editPayload: Partial<User> = { ...restForm, name, email };
                if (pinInput && pinInput.trim()) editPayload.pin = pinInput.trim();
                await updateUser(editingUser.id, editPayload);
                showToast('User updated successfully', 'success');
            } else {
                await addUser({ ...userFormData, name, email } as Omit<User, 'id'>);
                showToast('User added successfully', 'success');
            }
            closeUserModal();
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Failed to save user', 'error');
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
        setRoleSearch('');
        setIsRoleModalOpen(true);
    };

    const handleSaveRole = async () => {
        const name = roleFormData.name?.trim();
        if (!name) {
            showToast('Role name is required', 'error');
            return;
        }
        const duplicate = roles.some(r => r.id !== editingRole?.id && r.name.trim().toLowerCase() === name.toLowerCase());
        if (duplicate) {
            showToast('A role with this name already exists', 'error');
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

    // Live validation + search filtering for the role modal.
    const roleNameTrimmed = roleFormData.name?.trim() || '';
    const roleNameDuplicate = !!roleNameTrimmed && roles.some(
        r => r.id !== editingRole?.id && r.name.trim().toLowerCase() === roleNameTrimmed.toLowerCase()
    );
    const canSaveRole = !!roleNameTrimmed && !roleNameDuplicate;
    const roleSearchLower = roleSearch.trim().toLowerCase();
    const filteredRoleGroups = PERMISSION_GROUPS
        .map(group => ({
            ...group,
            permissions: roleSearchLower
                ? group.permissions.filter(p =>
                    p.label.toLowerCase().includes(roleSearchLower) ||
                    p.description.toLowerCase().includes(roleSearchLower) ||
                    group.category.toLowerCase().includes(roleSearchLower))
                : group.permissions,
        }))
        .filter(g => g.permissions.length > 0);

    // Users tab: search + role filter, then sort by role name.
    const userSearchLower = userSearch.trim().toLowerCase();
    const filteredUsers = [...users]
        .filter(u => userRoleFilter === 'all' || u.roleId === userRoleFilter)
        .filter(u => !userSearchLower
            || u.name.toLowerCase().includes(userSearchLower)
            || u.email.toLowerCase().includes(userSearchLower))
        .sort((a, b) => {
            const roleA = roles.find(r => r.id === a.roleId)?.name || '';
            const roleB = roles.find(r => r.id === b.roleId)?.name || '';
            return roleA.localeCompare(roleB) || a.name.localeCompare(b.name);
        });

    // User modal validation.
    const userNameTrimmed = userFormData.name?.trim() || '';
    const userEmailTrimmed = userFormData.email?.trim() || '';
    const userEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmailTrimmed);
    const userEmailDuplicate = !!userEmailTrimmed && users.some(
        u => u.id !== editingUser?.id && u.email.trim().toLowerCase() === userEmailTrimmed.toLowerCase()
    );
    const canSaveUser = !!userNameTrimmed && !!userFormData.roleId && userEmailValid && !userEmailDuplicate;

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
                    {/* Toolbar: search + role filter + count */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
                            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                            <input
                                type="text"
                                value={userSearch}
                                onChange={e => setUserSearch(e.target.value)}
                                placeholder="Search by name or email…"
                                style={{ width: '100%', padding: '9px 12px 9px 36px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                            />
                        </div>
                        <select
                            value={userRoleFilter}
                            onChange={e => setUserRoleFilter(e.target.value)}
                            style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer' }}
                        >
                            <option value="all">All roles</option>
                            {roles.map(role => (
                                <option key={role.id} value={role.id}>{role.name}</option>
                            ))}
                        </select>
                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                            {filteredUsers.length} of {users.length} {users.length === 1 ? 'user' : 'users'}
                        </span>
                    </div>

                    <div style={{ background: 'var(--color-surface)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                                <thead style={{ background: 'var(--color-bg-secondary)' }}>
                                    <tr>
                                        <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)' }}>User</th>
                                        <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Role</th>
                                        <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Password</th>
                                        <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredUsers.map(user => (
                                        <tr key={user.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '14px 16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', fontWeight: 'bold', flexShrink: 0 }}>
                                                        {user.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div style={{ minWidth: 0 }}>
                                                        <div style={{ fontWeight: 500 }}>{user.name}</div>
                                                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{user.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{
                                                    padding: '4px 12px',
                                                    borderRadius: '20px',
                                                    background: 'rgba(59, 130, 246, 0.1)',
                                                    color: '#3B82F6',
                                                    fontSize: '13px',
                                                    fontWeight: 500,
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    {roles.find(r => r.id === user.roleId)?.name || 'Unknown'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-secondary)' }}>
                                                    <Lock size={14} />
                                                    {/* PINs are never downloaded to the browser anymore. */}
                                                    <span>••••</span>
                                                </div>
                                            </td>
                                            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                    <button onClick={() => handleOpenUserModal(user)} title="Edit user" style={{ padding: '6px', borderRadius: '6px', color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'var(--color-bg-secondary)'} onMouseOut={e => e.currentTarget.style.background = 'none'}>
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button onClick={() => handleDeleteUser(user.id)} title="Delete user" style={{ padding: '6px', borderRadius: '6px', color: 'var(--color-red)', background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'} onMouseOut={e => e.currentTarget.style.background = 'none'}>
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {filteredUsers.length === 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '48px 24px', color: 'var(--color-text-secondary)' }}>
                                <UsersIcon size={32} style={{ opacity: 0.4 }} />
                                <div style={{ fontSize: '14px' }}>
                                    {users.length === 0 ? 'No users yet — add your first user.' : 'No users match your filters.'}
                                </div>
                            </div>
                        )}
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
                <div
                    onClick={closeUserModal}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ background: 'var(--color-surface)', borderRadius: '16px', width: '520px', maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}
                    >
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '20px 24px', borderBottom: '1px solid var(--color-border)' }}>
                            <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', fontWeight: 'bold', fontSize: '18px', flexShrink: 0 }}>
                                {userNameTrimmed ? userNameTrimmed.charAt(0).toUpperCase() : <UserIcon size={20} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>{editingUser ? 'Edit User' : 'Add User'}</h2>
                                <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                    {editingUser ? 'Update this user’s account details' : 'Create a new user account'}
                                </p>
                            </div>
                            <button
                                onClick={closeUserModal}
                                aria-label="Close"
                                style={{ padding: '8px', borderRadius: '8px', background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', flexShrink: 0 }}
                                onMouseOver={e => e.currentTarget.style.background = 'var(--color-bg-secondary)'}
                                onMouseOut={e => e.currentTarget.style.background = 'none'}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body */}
                        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Name <span style={{ color: 'var(--color-red)' }}>*</span></label>
                                <input
                                    type="text"
                                    value={userFormData.name}
                                    autoFocus
                                    onChange={e => setUserFormData({ ...userFormData, name: e.target.value })}
                                    placeholder="Full name"
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Email <span style={{ color: 'var(--color-red)' }}>*</span></label>
                                <div style={{ position: 'relative' }}>
                                    <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                    <input
                                        type="email"
                                        value={userFormData.email}
                                        onChange={e => setUserFormData({ ...userFormData, email: e.target.value })}
                                        placeholder="name@example.com"
                                        style={{ width: '100%', padding: '10px 10px 10px 36px', borderRadius: '8px', border: `1px solid ${userEmailDuplicate || (userEmailTrimmed && !userEmailValid) ? 'var(--color-red)' : 'var(--color-border)'}`, background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                                    />
                                </div>
                                {userEmailTrimmed && !userEmailValid && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px', fontSize: '12px', color: 'var(--color-red)' }}>
                                        <AlertCircle size={13} /> Enter a valid email address
                                    </div>
                                )}
                                {userEmailValid && userEmailDuplicate && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px', fontSize: '12px', color: 'var(--color-red)' }}>
                                        <AlertCircle size={13} /> A user with this email already exists
                                    </div>
                                )}
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Role <span style={{ color: 'var(--color-red)' }}>*</span></label>
                                <select
                                    value={userFormData.roleId}
                                    onChange={e => setUserFormData({ ...userFormData, roleId: e.target.value })}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                                >
                                    <option value="" disabled>Select a role</option>
                                    {roles.map(role => (
                                        <option key={role.id} value={role.id}>{role.name}</option>
                                    ))}
                                </select>
                                {userFormData.roleId && (
                                    <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                        {roles.find(r => r.id === userFormData.roleId)?.id === 'admin'
                                            ? 'Full access to everything'
                                            : `${roles.find(r => r.id === userFormData.roleId)?.permissions.length || 0} permission(s)`}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Password <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>(optional)</span></label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showUserPassword ? 'text' : 'password'}
                                        value={userFormData.pin || ''}
                                        onChange={e => setUserFormData({ ...userFormData, pin: e.target.value })}
                                        placeholder={editingUser ? 'Leave blank to keep current' : 'Set a login password'}
                                        style={{ width: '100%', padding: '10px 40px 10px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowUserPassword(v => !v)}
                                        aria-label={showUserPassword ? 'Hide password' : 'Show password'}
                                        style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', padding: '4px', background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', display: 'flex' }}
                                    >
                                        {showUserPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>
                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: '4px' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Target size={15} /> Sales Targets ($)
                                </h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                    {([
                                        ['Daily', 'dailyTarget'],
                                        ['Weekly', 'weeklyTarget'],
                                        ['Monthly', 'monthlyTarget'],
                                    ] as const).map(([label, field]) => (
                                        <div key={field}>
                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 500 }}>{label}</label>
                                            <input
                                                type="number"
                                                min={0}
                                                value={userFormData[field] || 0}
                                                onChange={e => setUserFormData({ ...userFormData, [field]: parseFloat(e.target.value) || 0 })}
                                                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', fontSize: '13px', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 24px', borderTop: '1px solid var(--color-border)' }}>
                            <button onClick={closeUserModal} style={{ padding: '10px 18px', borderRadius: '8px', background: 'none', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer', fontWeight: 500 }}>Cancel</button>
                            <button
                                onClick={handleSaveUser}
                                disabled={!canSaveUser}
                                style={{ padding: '10px 18px', borderRadius: '8px', background: 'var(--color-primary)', color: 'white', border: 'none', cursor: canSaveUser ? 'pointer' : 'not-allowed', fontWeight: 500, opacity: canSaveUser ? 1 : 0.5 }}
                            >
                                {editingUser ? 'Save Changes' : 'Create User'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Role Modal */}
            {isRoleModalOpen && (
                <div
                    onClick={closeRoleModal}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ background: 'var(--color-surface)', borderRadius: '16px', width: '640px', maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}
                    >
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '20px 24px', borderBottom: '1px solid var(--color-border)' }}>
                            <div style={{ width: '42px', height: '42px', borderRadius: '11px', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', flexShrink: 0 }}>
                                <Shield size={22} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>{editingRole ? 'Edit Role' : 'Add Role'}</h2>
                                <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                    {editingRole ? 'Update this role and its permissions' : 'Define a role and choose what it can access'}
                                </p>
                            </div>
                            <button
                                onClick={closeRoleModal}
                                aria-label="Close"
                                style={{ padding: '8px', borderRadius: '8px', background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', flexShrink: 0 }}
                                onMouseOver={e => e.currentTarget.style.background = 'var(--color-bg-secondary)'}
                                onMouseOut={e => e.currentTarget.style.background = 'none'}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body */}
                        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>
                                        Role Name <span style={{ color: 'var(--color-red)' }}>*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={roleFormData.name}
                                        autoFocus
                                        onChange={e => setRoleFormData({ ...roleFormData, name: e.target.value })}
                                        placeholder="e.g. Cashier"
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: `1px solid ${roleNameDuplicate ? 'var(--color-red)' : 'var(--color-border)'}`, background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                                    />
                                    {roleNameDuplicate && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px', fontSize: '12px', color: 'var(--color-red)' }}>
                                            <AlertCircle size={13} /> A role with this name already exists
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>
                                        Description <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>(optional)</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={roleFormData.description}
                                        onChange={e => setRoleFormData({ ...roleFormData, description: e.target.value })}
                                        placeholder="Short summary of this role"
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                                    />
                                </div>
                            </div>

                            {/* Permissions toolbar */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600 }}>Permissions</label>
                                    <span style={{ fontSize: '12px', fontWeight: 600, padding: '2px 10px', borderRadius: '20px', background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                                        {selectedCount} / {ALL_PERMISSIONS.length}
                                    </span>
                                </div>
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', marginBottom: '16px', borderRadius: '8px', background: 'rgba(34, 197, 94, 0.08)', color: '#16A34A', fontSize: '12px', fontWeight: 500 }}>
                                    <ShieldCheck size={14} /> The Admin role always has full access and cannot be changed.
                                </div>
                            )}

                            {/* Search */}
                            {!isEditingAdminRole && (
                                <div style={{ position: 'relative', marginBottom: '16px' }}>
                                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                    <input
                                        type="text"
                                        value={roleSearch}
                                        onChange={e => setRoleSearch(e.target.value)}
                                        placeholder="Search permissions…"
                                        style={{ width: '100%', padding: '9px 12px 9px 36px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                                    />
                                </div>
                            )}

                            {/* Permission groups */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                                {filteredRoleGroups.map(group => {
                                    const GroupIcon = group.icon;
                                    const groupKeys = group.permissions.map(p => p.key);
                                    const selectedInGroup = groupKeys.filter(k => isEditingAdminRole || roleFormData.permissions?.includes(k)).length;
                                    const allInGroup = selectedInGroup === groupKeys.length;
                                    return (
                                        <div key={group.category}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                                    <GroupIcon size={14} /> {group.category}
                                                    <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--color-text-secondary)' }}>· {selectedInGroup}/{groupKeys.length}</span>
                                                </div>
                                                {!isEditingAdminRole && (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleGroup(group)}
                                                        style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                                    >
                                                        {allInGroup ? 'Clear' : 'Select all'}
                                                    </button>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {group.permissions.map(({ key, label, description }) => {
                                                    const checked = isEditingAdminRole || roleFormData.permissions?.includes(key);
                                                    return (
                                                        <div
                                                            key={key}
                                                            onClick={() => togglePermission(key)}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '12px',
                                                                padding: '12px 14px',
                                                                borderRadius: '10px',
                                                                border: checked ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                                background: checked ? 'rgba(59, 130, 246, 0.06)' : 'var(--color-bg-secondary)',
                                                                cursor: isEditingAdminRole ? 'not-allowed' : 'pointer',
                                                                opacity: isEditingAdminRole ? 0.75 : 1,
                                                                transition: 'all 0.15s'
                                                            }}
                                                        >
                                                            <div style={{
                                                                width: '20px',
                                                                height: '20px',
                                                                borderRadius: '5px',
                                                                border: '1px solid',
                                                                borderColor: checked ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                                                background: checked ? 'var(--color-primary)' : 'transparent',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                color: 'white',
                                                                flexShrink: 0
                                                            }}>
                                                                {checked && <Check size={13} />}
                                                            </div>
                                                            <div style={{ minWidth: 0 }}>
                                                                <div style={{ fontSize: '14px', fontWeight: 500 }}>{label}</div>
                                                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.35, marginTop: '2px' }}>{description}</div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                                {filteredRoleGroups.length === 0 && (
                                    <div style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                        No permissions match “{roleSearch}”.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 24px', borderTop: '1px solid var(--color-border)' }}>
                            <button onClick={closeRoleModal} style={{ padding: '10px 18px', borderRadius: '8px', background: 'none', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer', fontWeight: 500 }}>Cancel</button>
                            <button
                                onClick={handleSaveRole}
                                disabled={!canSaveRole}
                                style={{ padding: '10px 18px', borderRadius: '8px', background: 'var(--color-primary)', color: 'white', border: 'none', cursor: canSaveRole ? 'pointer' : 'not-allowed', fontWeight: 500, opacity: canSaveRole ? 1 : 0.5 }}
                            >
                                {editingRole ? 'Save Changes' : 'Create Role'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;
