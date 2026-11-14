import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import type { User, Role, Permission } from '../types';
import {
    Plus, Edit2, Trash2, Shield, User as UserIcon, Check, Lock, Users as UsersIcon,
    LayoutDashboard, ShoppingCart, Truck, Wallet, Package, Briefcase, HeartHandshake,
    Calculator, Settings, X, Search, AlertCircle, Mail, Eye, EyeOff, Target,
    ChevronRight, ChevronDown, Minus
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { useLocation } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { fill } from '../i18n/translate';

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
            { key: 'use_checkbox', label: 'Use Checkbox', description: 'Select rows with checkboxes for batch operations (Orders, and Revenue & Expense)' },
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
        category: 'Procurement',
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
            { key: 'manage_accounting', label: 'Manage Accounting', description: 'Chart of accounts, journal entries, revenue/expense, financial reports, Cash In/Out and payments' },
        ],
    },
    {
        category: 'Administration',
        icon: Settings,
        permissions: [
            { key: 'manage_users', label: 'Manage Users', description: 'Create users and roles, assign permissions' },
            { key: 'manage_settings', label: 'Manage Settings', description: 'Store profile, security and system settings' },
            { key: 'manage_database', label: 'Manage Database', description: 'Backup, Restore and Migrate tools (Settings > Database) — admin only by default' },
        ],
    },
];

// Flat list of every permission key, derived from the catalog above.
const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key));
// Translation keys (ui.admin.users.categories.*) per category; the English
// category names above stay as-is (React keys, collapsed-state keys).
const CATEGORY_KEYS: Record<string, string> = {
    'Dashboard': 'dashboard',
    'Sales & Orders': 'sales',
    'Inventory': 'inventory',
    'Finance': 'finance',
    'Procurement': 'procurement',
    'HR & Payroll': 'hr',
    'CRM': 'crm',
    'Accounting': 'accounting',
    'Administration': 'administration',
};
const UserManagement: React.FC = () => {
    const { users, roles, addUser, updateUser, deleteUser, addRole, updateRole, deleteRole, refreshData, currentUser } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();
    const location = useLocation();
    const { t } = useLanguage();
    // Display text for the permission catalog; falls back to the English source.
    const tx = (key: string, en: string) => { const v = t(key); return v && v !== key ? v : en; };
    const permLabel = (p: PermissionMeta) => tx(`ui.admin.users.perm.${p.key}.label`, p.label);
    const permDesc = (p: PermissionMeta) => tx(`ui.admin.users.perm.${p.key}.desc`, p.description);
    const catLabel = (category: string) => tx(`ui.admin.users.categories.${CATEGORY_KEYS[category] || ''}`, category);
    // Which page this URL is: /users = Users, /users/roles = Roles & Permissions
    // (two sidebar entries sharing this component).
    const activeTab: 'users' | 'roles' = location.pathname.startsWith('/users/roles') ? 'roles' : 'users';

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>
                        {activeTab === 'users' ? t('nav.teamUsers') : t('nav.rolesPermissions')}
                    </h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                        {activeTab === 'users' ? t('ui.admin.users.usersSubtitle') : t('ui.admin.users.rolesSubtitle')}
                    </p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, activeTab, t]);

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
    // In-flight guards: a double-click must not save or delete twice.
    const [isSavingUser, setIsSavingUser] = useState(false);
    const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

    // SEC-3: Manage Users is not admin. Non-admins cannot touch admin accounts
    // or hand out the admin role; nobody edits their own role. The same rules
    // are enforced again in the store (updateUser/addUser/deleteUser), so this
    // is UI honesty, not the actual guard.
    const isAdminActor = currentUser?.roleId === 'admin';
    const canTouchUser = (user: User) => isAdminActor || user.roleId !== 'admin';
    // SEC-3 (review): a non-admin may only hand out roles whose permissions
    // their OWN role already holds — otherwise assigning an existing richer
    // role (one an admin built) to an account whose password they set is a
    // ready-made escalation. Admin is excluded for everyone below admin.
    const actorPermissions = currentUser?.roleId === 'admin'
        ? ALL_PERMISSIONS
        : roles.find(r => r.id === currentUser?.roleId)?.permissions || [];
    const roleWithinActor = (role: Role) =>
        role.id !== 'admin' && role.permissions.every(p => actorPermissions.includes(p));
    const assignableRoles = isAdminActor ? roles : roles.filter(roleWithinActor);
    // Same cap for passwords: a non-admin may not reset the password of an
    // account whose role is richer than their own (the store refuses too).
    const canSetPinFor = (user: User | null) => {
        if (isAdminActor || !user) return true;
        if (user.id === currentUser?.id) return true;
        if (user.roleId === 'admin') return false;
        const targetRole = roles.find(r => r.id === user.roleId);
        return !targetRole || targetRole.permissions.every(p => actorPermissions.includes(p));
    };

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

    // Role State — the modal only edits a role's name/description now;
    // permissions are granted inline in the master-detail panel below.
    const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [roleFormData, setRoleFormData] = useState<Partial<Role>>({ name: '', description: '', permissions: [] });

    // Master-detail state: which role is open on the right, its unsaved
    // permission draft (null = no edits), the permission search and the
    // collapsed category sections.
    const [selectedRoleId, setSelectedRoleId] = useState('');
    const [permDraft, setPermDraft] = useState<Permission[] | null>(null);
    const [permSearch, setPermSearch] = useState('');
    const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});

    const closeRoleModal = () => {
        setIsRoleModalOpen(false);
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
            setUserFormData({ name: '', email: '', roleId: assignableRoles[0]?.id || '', pin: '', dailyTarget: 0, weeklyTarget: 0, monthlyTarget: 0 });
        }
        setShowUserPassword(false);
        setIsUserModalOpen(true);
    };

    const handleSaveUser = async () => {
        if (isSavingUser) return;
        const name = userFormData.name?.trim();
        const email = userFormData.email?.trim();
        if (!name || !email || !userFormData.roleId) {
            showToast(t('ui.admin.users.fillRequired'), 'error');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showToast(t('ui.admin.users.validEmail'), 'error');
            return;
        }
        const duplicateEmail = users.some(u => u.id !== editingUser?.id && u.email.trim().toLowerCase() === email.toLowerCase());
        if (duplicateEmail) {
            showToast(t('ui.admin.users.emailExists'), 'error');
            return;
        }
        // A new account needs a password up front: PINs can't be read back
        // anymore, so an account created without one would look normal in the
        // list ('••••') but could never log in (check_pin refuses empty PINs).
        if (!editingUser && !(userFormData.pin || '').trim()) {
            showToast(t('ui.admin.users.setPassword'), 'error');
            return;
        }

        setIsSavingUser(true);
        try {
            if (editingUser) {
                // PINs can't be read back anymore, so the form field starts empty
                // on edit: blank means "keep the current password" (as the
                // placeholder says) — only a typed value changes it.
                const { pin: pinInput, ...restForm } = userFormData;
                const editPayload: Partial<User> = { ...restForm, name, email };
                if (pinInput && pinInput.trim()) editPayload.pin = pinInput.trim();
                await updateUser(editingUser.id, editPayload);
                showToast(t('ui.admin.users.userUpdated'), 'success');
            } else {
                await addUser({ ...userFormData, name, email } as Omit<User, 'id'>);
                showToast(t('ui.admin.users.userAdded'), 'success');
            }
            closeUserModal();
        } catch (error) {
            showToast(error instanceof Error ? error.message : t('ui.admin.users.saveUserFailed'), 'error');
        } finally {
            setIsSavingUser(false);
        }
    };

    const handleDeleteUser = async (id: string) => {
        if (deletingUserId) return;
        if (!confirm(t('ui.admin.users.confirmDeleteUser'))) return;
        setDeletingUserId(id);
        try {
            await deleteUser(id);
            showToast(t('ui.admin.users.userDeleted'), 'success');
        } catch (error) {
            // e.g. the SEC-3 guard: non-admins cannot delete an admin account.
            showToast(error instanceof Error ? error.message : t('ui.admin.users.deleteUserFailed'), 'error');
        } finally {
            setDeletingUserId(null);
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
        const name = roleFormData.name?.trim();
        if (!name) {
            showToast(t('ui.admin.users.roleNameRequired'), 'error');
            return;
        }
        const duplicate = roles.some(r => r.id !== editingRole?.id && r.name.trim().toLowerCase() === name.toLowerCase());
        if (duplicate) {
            showToast(t('ui.admin.users.roleExists'), 'error');
            return;
        }

        try {
            if (editingRole) {
                // The modal only renames; permissions are edited in the panel.
                await updateRole(editingRole.id, { name, description: roleFormData.description || '' });
                showToast(t('ui.admin.users.roleUpdated'), 'success');
            } else {
                // New roles start with nothing granted (like the reference
                // design) and open in the panel for granting.
                const newRole = await addRole({ name, description: roleFormData.description || '', permissions: [] });
                setSelectedRoleId(newRole.id);
                setPermDraft(null);
                showToast(t('ui.admin.users.roleAdded'), 'success');
            }
            setIsRoleModalOpen(false);
        } catch (error) {
            // Surface the store guard's actual reason (e.g. self-lockout) instead of a
            // generic message, so the user knows why the save was refused.
            showToast(error instanceof Error ? error.message : t('ui.admin.users.saveRoleFailed'), 'error');
        }
    };

    const handleDeleteRole = async (id: string) => {
        if (!confirm(t('ui.admin.users.confirmDeleteRole'))) return;
        try {
            await deleteRole(id);
            showToast(t('ui.admin.users.roleDeleted'), 'success');
        } catch (error) {
            showToast(error instanceof Error ? error.message : t('ui.admin.users.deleteRoleFailed'), 'error');
        }
    };

    // ── Master-detail panel logic ────────────────────────────────────────
    // Keep a valid selection: default to the first role, recover after deletes.
    React.useEffect(() => {
        if (roles.length === 0) return;
        if (!roles.some(r => r.id === selectedRoleId)) {
            setSelectedRoleId(roles[0].id);
            setPermDraft(null);
        }
    }, [roles, selectedRoleId]);

    const selectedRole = roles.find(r => r.id === selectedRoleId) || null;
    // The built-in Admin role is managed by the system: always full access
    // (hasPermission hardcodes it), never editable here.
    const isSystemRole = selectedRole?.id === 'admin';
    const savedPerms: Permission[] = selectedRole
        ? (isSystemRole ? ALL_PERMISSIONS : selectedRole.permissions.filter(p => ALL_PERMISSIONS.includes(p)))
        : [];
    const effectivePerms = permDraft ?? savedPerms;
    const permsDirty = permDraft !== null
        && (permDraft.length !== savedPerms.length || permDraft.some(p => !savedPerms.includes(p)));

    const selectRole = (id: string) => {
        if (id === selectedRoleId) return;
        if (permsDirty && !confirm(t('ui.admin.users.discardConfirm'))) return;
        setSelectedRoleId(id);
        setPermDraft(null);
    };

    const toggleRolePermission = (key: Permission) => {
        if (!selectedRole || isSystemRole) return;
        setPermDraft(effectivePerms.includes(key)
            ? effectivePerms.filter(p => p !== key)
            : [...effectivePerms, key]);
    };

    // Toggle every permission in a category on/off at once.
    const toggleRoleGroup = (group: PermissionGroup) => {
        if (!selectedRole || isSystemRole) return;
        const keys = group.permissions.map(p => p.key);
        const allSelected = keys.every(k => effectivePerms.includes(k));
        setPermDraft(allSelected
            ? effectivePerms.filter(p => !keys.includes(p))
            : Array.from(new Set([...effectivePerms, ...keys])));
    };

    const savePermissions = async () => {
        if (!selectedRole || permDraft === null) return;
        try {
            await updateRole(selectedRole.id, { permissions: permDraft });
            setPermDraft(null);
            showToast(t('ui.admin.users.permsUpdated'), 'success');
        } catch (error) {
            // Surface the store guard's actual reason (e.g. self-lockout).
            showToast(error instanceof Error ? error.message : t('ui.admin.users.savePermsFailed'), 'error');
        }
    };

    // Live validation for the role modal.
    const roleNameTrimmed = roleFormData.name?.trim() || '';
    const roleNameDuplicate = !!roleNameTrimmed && roles.some(
        r => r.id !== editingRole?.id && r.name.trim().toLowerCase() === roleNameTrimmed.toLowerCase()
    );
    const canSaveRole = !!roleNameTrimmed && !roleNameDuplicate;

    // Search filtering for the permissions panel.
    const permSearchLower = permSearch.trim().toLowerCase();
    const filteredRoleGroups = PERMISSION_GROUPS
        .map(group => ({
            ...group,
            permissions: permSearchLower
                ? group.permissions.filter(p =>
                    p.label.toLowerCase().includes(permSearchLower) ||
                    p.description.toLowerCase().includes(permSearchLower) ||
                    group.category.toLowerCase().includes(permSearchLower) ||
                    permLabel(p).toLowerCase().includes(permSearchLower) ||
                    permDesc(p).toLowerCase().includes(permSearchLower) ||
                    catLabel(group.category).toLowerCase().includes(permSearchLower))
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
    const canSaveUser = !!userNameTrimmed && !!userFormData.roleId && userEmailValid && !userEmailDuplicate && !isSavingUser;

    return (
        <div style={{ padding: '24px', maxWidth: '100%', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid var(--color-border)' }}>
                {/* Users and Roles & Permissions are separate pages now (Team menu),
                    so each shows only its own title — no cross tabs. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0', fontWeight: 'bold', color: 'var(--color-primary)' }}>
                    {activeTab === 'users' ? <UserIcon size={18} /> : <Shield size={18} />}
                    {activeTab === 'users' ? t('nav.teamUsers') : t('nav.rolesPermissions')}
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
                            <Plus size={18} /> {t('ui.admin.users.addUser')}
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
                            <Plus size={18} /> {t('ui.admin.users.newRole')}
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
                                placeholder={t('ui.admin.users.searchUsers')}
                                style={{ width: '100%', padding: '9px 12px 9px 36px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                            />
                        </div>
                        <select
                            value={userRoleFilter}
                            onChange={e => setUserRoleFilter(e.target.value)}
                            style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer' }}
                        >
                            <option value="all">{t('ui.admin.users.allRoles')}</option>
                            {roles.map(role => (
                                <option key={role.id} value={role.id}>{role.name}</option>
                            ))}
                        </select>
                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                            {fill(users.length === 1 ? t('ui.admin.users.countOne') : t('ui.admin.users.countMany'), { shown: filteredUsers.length, total: users.length })}
                        </span>
                    </div>

                    <div style={{ background: 'var(--color-surface)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                                <thead style={{ background: 'var(--color-bg-secondary)' }}>
                                    <tr>
                                        <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)' }}>{t('ui.admin.users.colUser')}</th>
                                        <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)' }}>{t('ui.admin.users.colRole')}</th>
                                        <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)' }}>{t('ui.admin.users.colPassword')}</th>
                                        <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-secondary)' }}>{t('common.actions')}</th>
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
                                                    {roles.find(r => r.id === user.roleId)?.name || t('ui.admin.users.unknown')}
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
                                                    {/* SEC-3: only admins may edit or delete an admin account
                                                        (the store enforces this too — these are honest buttons). */}
                                                    <button onClick={() => handleOpenUserModal(user)} disabled={!canTouchUser(user)} title={canTouchUser(user) ? t('ui.admin.users.editUser') : t('ui.admin.users.onlyAdminEdit')} style={{ padding: '6px', borderRadius: '6px', color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: canTouchUser(user) ? 'pointer' : 'not-allowed', opacity: canTouchUser(user) ? 1 : 0.35, transition: 'background 0.2s' }} onMouseOver={e => { if (canTouchUser(user)) e.currentTarget.style.background = 'var(--color-bg-secondary)'; }} onMouseOut={e => e.currentTarget.style.background = 'none'}>
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button onClick={() => handleDeleteUser(user.id)} disabled={!canTouchUser(user) || deletingUserId !== null} title={canTouchUser(user) ? t('ui.admin.users.deleteUser') : t('ui.admin.users.onlyAdminDelete')} style={{ padding: '6px', borderRadius: '6px', color: 'var(--color-red)', background: 'none', border: 'none', cursor: canTouchUser(user) && !deletingUserId ? 'pointer' : 'not-allowed', opacity: canTouchUser(user) ? 1 : 0.35, transition: 'background 0.2s' }} onMouseOver={e => { if (canTouchUser(user)) e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }} onMouseOut={e => e.currentTarget.style.background = 'none'}>
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
                                    {users.length === 0 ? t('ui.admin.users.noUsers') : t('ui.admin.users.noUsersMatch')}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                // Master-detail: roles list on the left, the selected role's
                // permissions on the right (stacked on phones).
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(260px, 340px) 1fr', gap: '16px', alignItems: 'start' }}>
                    {/* Roles list */}
                    <div style={{ background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                        <div style={{ padding: '16px 20px', fontSize: '15px', fontWeight: 700 }}>{t('ui.admin.users.roles')}</div>
                        {roles.map(role => {
                            const isAdminRole = role.id === 'admin';
                            const granted = isAdminRole ? ALL_PERMISSIONS.length : role.permissions.filter(p => ALL_PERMISSIONS.includes(p)).length;
                            const available = ALL_PERMISSIONS.length - granted;
                            const selected = role.id === selectedRoleId;
                            const assignedUsers = users.filter(u => u.roleId === role.id).length;
                            // Why deletion is blocked, if it is — mirrors the store guards.
                            const deleteBlockedReason = isAdminRole
                                ? t('ui.admin.users.adminProtected')
                                : assignedUsers > 0
                                    ? t('ui.admin.users.reassignFirst')
                                    : currentUser?.roleId === role.id
                                        ? t('ui.admin.users.ownRole')
                                        : null;
                            return (
                                <div
                                    key={role.id}
                                    onClick={() => selectRole(role.id)}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={selected}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRole(role.id); } }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '14px 14px 14px 20px',
                                        borderTop: '1px solid var(--color-border)',
                                        background: selected ? 'var(--color-primary-light)' : 'transparent',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontWeight: 700, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{role.name}</span>
                                            {isAdminRole && (
                                                <span style={{ fontSize: '11px', fontWeight: 500, padding: '1px 8px', borderRadius: '6px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', flexShrink: 0 }}>{t('ui.admin.users.system')}</span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '3px' }}>
                                            {fill(t('ui.admin.users.granted'), { n: granted })}
                                            {available > 0 && <span style={{ color: '#D97706' }}> · {fill(t('ui.admin.users.moreAvailable'), { n: available })}</span>}
                                        </div>
                                    </div>
                                    {!isAdminRole && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); if (!deleteBlockedReason) handleDeleteRole(role.id); }}
                                            disabled={!!deleteBlockedReason}
                                            title={deleteBlockedReason || t('ui.admin.users.deleteRole')}
                                            style={{ padding: '6px', borderRadius: '6px', color: 'var(--color-red)', background: 'none', border: 'none', cursor: deleteBlockedReason ? 'not-allowed' : 'pointer', opacity: deleteBlockedReason ? 0.35 : 1, flexShrink: 0, display: 'flex' }}
                                        ><Trash2 size={15} /></button>
                                    )}
                                    <ChevronRight size={16} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
                                </div>
                            );
                        })}
                        {roles.length === 0 && (
                            <div style={{ padding: '32px 20px', borderTop: '1px solid var(--color-border)', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                {t('ui.admin.users.noRoles')}
                            </div>
                        )}
                    </div>

                    {/* Permissions panel */}
                    <div style={{ background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                        {selectedRole ? (
                            <>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '15px', fontWeight: 700 }}>
                                            {t('ui.admin.users.permissionsTitle')} <span style={{ color: 'var(--color-primary)' }}>{selectedRole.name}</span>
                                        </div>
                                        <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', marginTop: '3px' }}>
                                            {isSystemRole
                                                ? t('ui.admin.users.systemRoleNote')
                                                : (selectedRole.description || t('ui.admin.users.chipsHelp'))}
                                        </div>
                                    </div>
                                    {!isSystemRole && (
                                        <button
                                            onClick={() => handleOpenRoleModal(selectedRole)}
                                            title={t('ui.admin.users.renameRole')}
                                            aria-label={t('ui.admin.users.renameRole')}
                                            style={{ padding: '7px', borderRadius: '8px', color: 'var(--color-text-secondary)', background: 'none', border: '1px solid var(--color-border)', cursor: 'pointer', display: 'flex', flexShrink: 0 }}
                                        ><Edit2 size={14} /></button>
                                    )}
                                </div>

                                {/* Search + granted count */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px', borderBottom: '1px solid var(--color-border)' }}>
                                    <div style={{ position: 'relative', flex: 1 }}>
                                        <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                        <input
                                            type="text"
                                            value={permSearch}
                                            onChange={e => setPermSearch(e.target.value)}
                                            placeholder={t('ui.admin.users.searchPerms')}
                                            style={{ width: '100%', padding: '9px 12px 9px 34px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', boxSizing: 'border-box', fontSize: '13px' }}
                                        />
                                    </div>
                                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>
                                        {effectivePerms.length} / {ALL_PERMISSIONS.length}
                                    </span>
                                </div>

                                {/* Category sections */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 20px' }}>
                                    {filteredRoleGroups.map(group => {
                                        const keys = group.permissions.map(p => p.key);
                                        const grantedInGroup = keys.filter(k => effectivePerms.includes(k)).length;
                                        const allInGroup = grantedInGroup === keys.length;
                                        // Searching always shows matches, even in a collapsed section.
                                        const collapsed = !!collapsedCats[group.category] && !permSearchLower;
                                        return (
                                            <div key={group.category} style={{ border: '1px solid var(--color-border)', borderRadius: '12px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px' }}>
                                                    <button
                                                        onClick={() => setCollapsedCats(prev => ({ ...prev, [group.category]: !prev[group.category] }))}
                                                        aria-label={fill(collapsed ? t('ui.admin.users.expand') : t('ui.admin.users.collapse'), { name: catLabel(group.category) })}
                                                        aria-expanded={!collapsed}
                                                        style={{ padding: '2px', background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', display: 'flex' }}
                                                    >
                                                        <ChevronDown size={15} style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }} />
                                                    </button>
                                                    <div
                                                        onClick={() => toggleRoleGroup(group)}
                                                        role="checkbox"
                                                        aria-checked={allInGroup ? true : grantedInGroup > 0 ? 'mixed' : false}
                                                        aria-label={fill(t('ui.admin.users.toggleAll'), { name: catLabel(group.category) })}
                                                        tabIndex={isSystemRole ? -1 : 0}
                                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRoleGroup(group); } }}
                                                        style={{
                                                            width: '18px', height: '18px', borderRadius: '5px', flexShrink: 0,
                                                            border: '1px solid',
                                                            borderColor: grantedInGroup > 0 ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                                            background: grantedInGroup > 0 ? 'var(--color-primary)' : 'transparent',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
                                                            cursor: isSystemRole ? 'not-allowed' : 'pointer',
                                                            opacity: isSystemRole ? 0.55 : 1
                                                        }}
                                                    >
                                                        {allInGroup ? <Check size={12} /> : grantedInGroup > 0 ? <Minus size={12} /> : null}
                                                    </div>
                                                    <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{catLabel(group.category)}</span>
                                                    <span style={{ marginLeft: 'auto', fontSize: '12.5px', fontWeight: 600, color: allInGroup ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                                                        {grantedInGroup}/{keys.length}
                                                    </span>
                                                </div>
                                                {!collapsed && (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '0 14px 14px 42px' }}>
                                                        {group.permissions.map((perm) => {
                                                            const { key } = perm;
                                                            const checked = effectivePerms.includes(key);
                                                            return (
                                                                <button
                                                                    key={key}
                                                                    onClick={() => toggleRolePermission(key)}
                                                                    title={permDesc(perm)}
                                                                    aria-pressed={checked}
                                                                    style={{
                                                                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                                        padding: '6px 13px', borderRadius: '999px',
                                                                        fontSize: '12.5px', fontWeight: 500,
                                                                        border: checked ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                                        background: checked ? 'var(--color-primary-light)' : 'var(--color-surface)',
                                                                        color: checked ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                                                        cursor: isSystemRole ? 'not-allowed' : 'pointer',
                                                                        transition: 'all 0.12s'
                                                                    }}
                                                                >
                                                                    {checked && <Check size={12} />}
                                                                    {permLabel(perm)}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {filteredRoleGroups.length === 0 && (
                                        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                            {fill(t('ui.admin.users.noPermsMatch'), { q: permSearch })}
                                        </div>
                                    )}
                                </div>

                                {/* Unsaved-changes bar */}
                                {permsDirty && (
                                    <div style={{ position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 20px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{t('ui.admin.users.unsaved')}</span>
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            <button onClick={() => setPermDraft(null)} style={{ padding: '8px 14px', borderRadius: '8px', background: 'none', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer', fontWeight: 500, fontSize: '13px' }}>{t('ui.admin.users.discard')}</button>
                                            <button onClick={savePermissions} style={{ padding: '8px 16px', borderRadius: '8px', background: 'var(--color-primary)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>{t('ui.admin.users.saveChanges')}</button>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                {t('ui.admin.users.selectRole')}
                            </div>
                        )}
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
                                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>{editingUser ? t('ui.admin.users.editUserTitle') : t('ui.admin.users.addUser')}</h2>
                                <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                    {editingUser ? t('ui.admin.users.editUserSub') : t('ui.admin.users.addUserSub')}
                                </p>
                            </div>
                            <button
                                onClick={closeUserModal}
                                aria-label={t('common.close')}
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
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>{t('ui.admin.users.name')} <span style={{ color: 'var(--color-red)' }}>*</span></label>
                                <input
                                    type="text"
                                    value={userFormData.name}
                                    autoFocus
                                    onChange={e => setUserFormData({ ...userFormData, name: e.target.value })}
                                    placeholder={t('ui.admin.users.fullName')}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>{t('ui.admin.users.email')} <span style={{ color: 'var(--color-red)' }}>*</span></label>
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
                                        <AlertCircle size={13} /> {t('ui.admin.users.enterValidEmail')}
                                    </div>
                                )}
                                {userEmailValid && userEmailDuplicate && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px', fontSize: '12px', color: 'var(--color-red)' }}>
                                        <AlertCircle size={13} /> {t('ui.admin.users.emailExists')}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>{t('ui.admin.users.colRole')} <span style={{ color: 'var(--color-red)' }}>*</span></label>
                                {/* SEC-3: non-admins only see roles their own role's permissions
                                    cover (never Administrator, never a richer custom role), and
                                    nobody can change their OWN role (the store refuses all of it too). */}
                                <select
                                    value={userFormData.roleId}
                                    onChange={e => setUserFormData({ ...userFormData, roleId: e.target.value })}
                                    disabled={!!editingUser && editingUser.id === currentUser?.id}
                                    title={editingUser && editingUser.id === currentUser?.id ? t('ui.admin.users.ownRoleTitle') : undefined}
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box', cursor: editingUser && editingUser.id === currentUser?.id ? 'not-allowed' : undefined }}
                                >
                                    <option value="" disabled>{t('ui.admin.users.selectARole')}</option>
                                    {assignableRoles.map(role => (
                                        <option key={role.id} value={role.id}>{role.name}</option>
                                    ))}
                                    {/* Keep the current value visible even when not assignable
                                        (e.g. an admin editing their own admin account). */}
                                    {userFormData.roleId && !assignableRoles.some(r => r.id === userFormData.roleId) && (
                                        <option value={userFormData.roleId}>{roles.find(r => r.id === userFormData.roleId)?.name || userFormData.roleId}</option>
                                    )}
                                </select>
                                {editingUser && editingUser.id === currentUser?.id && (
                                    <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                        {t('ui.admin.users.ownRoleNote')}
                                    </div>
                                )}
                                {userFormData.roleId && (
                                    <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                        {roles.find(r => r.id === userFormData.roleId)?.id === 'admin'
                                            ? t('ui.admin.users.fullAccess')
                                            : fill(t('ui.admin.users.nPermissions'), { n: roles.find(r => r.id === userFormData.roleId)?.permissions.length || 0 })}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>{t('ui.admin.users.colPassword')} <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>{t('ui.admin.users.optional')}</span></label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showUserPassword ? 'text' : 'password'}
                                        value={userFormData.pin || ''}
                                        onChange={e => setUserFormData({ ...userFormData, pin: e.target.value })}
                                        disabled={!canSetPinFor(editingUser)}
                                        placeholder={editingUser ? (canSetPinFor(editingUser) ? t('ui.admin.users.keepCurrent') : t('ui.admin.users.onlyAdminPassword')) : t('ui.admin.users.setLoginPassword')}
                                        title={canSetPinFor(editingUser) ? undefined : t('ui.admin.users.richerRole')}
                                        style={{ width: '100%', padding: '10px 40px 10px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box', cursor: canSetPinFor(editingUser) ? undefined : 'not-allowed' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowUserPassword(v => !v)}
                                        aria-label={showUserPassword ? t('ui.admin.users.hidePassword') : t('ui.admin.users.showPassword')}
                                        style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', padding: '4px', background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', display: 'flex' }}
                                    >
                                        {showUserPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>
                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: '4px' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Target size={15} /> {t('ui.admin.users.salesTargets')}
                                </h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                    {([
                                        [t('ui.admin.users.daily'), 'dailyTarget'],
                                        [t('ui.admin.users.weekly'), 'weeklyTarget'],
                                        [t('ui.admin.users.monthly'), 'monthlyTarget'],
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
                            <button onClick={closeUserModal} style={{ padding: '10px 18px', borderRadius: '8px', background: 'none', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer', fontWeight: 500 }}>{t('common.cancel')}</button>
                            <button
                                onClick={handleSaveUser}
                                disabled={!canSaveUser}
                                style={{ padding: '10px 18px', borderRadius: '8px', background: 'var(--color-primary)', color: 'white', border: 'none', cursor: canSaveUser ? 'pointer' : 'not-allowed', fontWeight: 500, opacity: canSaveUser ? 1 : 0.5 }}
                            >
                                {isSavingUser ? t('ui.admin.telegram.saving') : (editingUser ? t('settings.saveChanges') : t('ui.admin.users.createUser'))}
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
                        style={{ background: 'var(--color-surface)', borderRadius: '16px', width: '520px', maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}
                    >
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '20px 24px', borderBottom: '1px solid var(--color-border)' }}>
                            <div style={{ width: '42px', height: '42px', borderRadius: '11px', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', flexShrink: 0 }}>
                                <Shield size={22} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>{editingRole ? t('ui.admin.users.renameRoleTitle') : t('ui.admin.users.newRole')}</h2>
                                <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                    {editingRole ? t('ui.admin.users.renameRoleSub') : t('ui.admin.users.newRoleSub')}
                                </p>
                            </div>
                            <button
                                onClick={closeRoleModal}
                                aria-label={t('common.close')}
                                style={{ padding: '8px', borderRadius: '8px', background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', flexShrink: 0 }}
                                onMouseOver={e => e.currentTarget.style.background = 'var(--color-bg-secondary)'}
                                onMouseOut={e => e.currentTarget.style.background = 'none'}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body */}
                        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>
                                        {t('ui.admin.users.roleName')} <span style={{ color: 'var(--color-red)' }}>*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={roleFormData.name}
                                        autoFocus
                                        onChange={e => setRoleFormData({ ...roleFormData, name: e.target.value })}
                                        placeholder={t('ui.admin.users.roleNamePlaceholder')}
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: `1px solid ${roleNameDuplicate ? 'var(--color-red)' : 'var(--color-border)'}`, background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                                    />
                                    {roleNameDuplicate && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px', fontSize: '12px', color: 'var(--color-red)' }}>
                                            <AlertCircle size={13} /> {t('ui.admin.users.roleExists')}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>
                                        {t('ui.admin.users.description')} <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>{t('ui.admin.users.optional')}</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={roleFormData.description}
                                        onChange={e => setRoleFormData({ ...roleFormData, description: e.target.value })}
                                        placeholder={t('ui.admin.users.descriptionPlaceholder')}
                                        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)', boxSizing: 'border-box' }}
                                    />
                                </div>
                            </div>

                        </div>

                        {/* Footer */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 24px', borderTop: '1px solid var(--color-border)' }}>
                            <button onClick={closeRoleModal} style={{ padding: '10px 18px', borderRadius: '8px', background: 'none', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer', fontWeight: 500 }}>{t('common.cancel')}</button>
                            <button
                                onClick={handleSaveRole}
                                disabled={!canSaveRole}
                                style={{ padding: '10px 18px', borderRadius: '8px', background: 'var(--color-primary)', color: 'white', border: 'none', cursor: canSaveRole ? 'pointer' : 'not-allowed', fontWeight: 500, opacity: canSaveRole ? 1 : 0.5 }}
                            >
                                {editingRole ? t('settings.saveChanges') : t('ui.admin.users.createRole')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;
