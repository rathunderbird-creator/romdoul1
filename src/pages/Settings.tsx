import React, { useState } from 'react';
import { Save, Store, Globe, Bell, Shield, Users, Plus, Trash2, Tag, X, User as UserIcon, Moon, Sun, Database } from 'lucide-react';
import { migrateData } from '../lib/migration';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useTheme } from '../context/ThemeContext';
import type { Customer } from '../types';

interface User {
    id: string;
    name: string;
    email: string;
    role: 'Admin' | 'Manager' | 'Cashier';
}

const Settings: React.FC = () => {
    const { categories, addCategory, removeCategory, customers, addCustomer, deleteCustomer } = useStore();
    const { showToast } = useToast();
    const { themeColor, setThemeColor, fontSize, setFontSize, resetTheme, isDarkMode, toggleTheme } = useTheme();
    const { setHeaderContent } = useHeader();

    // Header Content
    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Settings</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage your store preferences and configuration</p>
                </div>
            ),
            actions: (
                <button
                    onClick={handleSave}
                    className="primary-button"
                    style={{
                        padding: '12px 24px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <Save size={20} />
                    Save Changes
                </button>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, isDarkMode]); // Add dependencies if needed, handleSave might need to be wrapped or stable.

    // Local state for settings form (mock implementation)
    const [storeName, setStoreName] = useState('JBL Store Main');
    const [currency, setCurrency] = useState('USD ($)');
    const [taxRate, setTaxRate] = useState('8.5');

    // Category Management
    const [newCategory, setNewCategory] = useState('');
    const [showAddCategory, setShowAddCategory] = useState(false);

    // Customer Management
    const [showAddCustomer, setShowAddCustomer] = useState(false);
    const [newCustomer, setNewCustomer] = useState<Partial<Customer>>({ name: '', phone: '', platform: 'Walk-in' });

    // User Management State
    const [users, setUsers] = useState<User[]>([
        { id: '1', name: 'Admin User', email: 'admin@jblstore.com', role: 'Admin' },
        { id: '2', name: 'John Doe', email: 'john@jblstore.com', role: 'Manager' },
        { id: '3', name: 'Jane Smith', email: 'jane@jblstore.com', role: 'Cashier' },
    ]);
    const [showAddUser, setShowAddUser] = useState(false);
    const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Cashier' as User['role'] });

    const handleSave = () => {
        // Placeholder for save functionality
        showToast('Settings saved successfully!', 'success');
    };

    const handleAddUser = () => {
        if (!newUser.name || !newUser.email) return;
        const user: User = {
            id: Date.now().toString(),
            name: newUser.name,
            email: newUser.email,
            role: newUser.role
        };
        setUsers([...users, user]);
        setNewUser({ name: '', email: '', role: 'Cashier' });
        setShowAddUser(false);
        showToast('User added', 'success');
    };

    const handleDeleteUser = (id: string) => {
        if (confirm('Are you sure you want to remove this user?')) {
            setUsers(users.filter(u => u.id !== id));
            showToast('User removed', 'info');
        }
    };

    const handleAddCategory = () => {
        if (!newCategory.trim()) return;
        if (categories.includes(newCategory.trim())) {
            showToast('Category already exists', 'error');
            return;
        }
        addCategory(newCategory.trim());
        setNewCategory('');
        setShowAddCategory(false);
        showToast('Category added', 'success');
    };

    const handleDeleteCategory = (category: string) => {
        if (confirm(`Delete category "${category}"? Products in this category will need reassignment.`)) {
            removeCategory(category);
            showToast('Category removed', 'info');
        }
    };

    const handleAddCustomer = () => {
        if (!newCustomer.name || !newCustomer.phone) {
            showToast('Name and Phone are required', 'error');
            return;
        }
        addCustomer(newCustomer as Omit<Customer, 'id'>);
        setNewCustomer({ name: '', phone: '', platform: 'Walk-in' });
        setShowAddCustomer(false);
        showToast('Customer added successfully', 'success');
    };

    const handleDeleteCustomer = (id: string) => {
        if (confirm('Delete this customer?')) {
            deleteCustomer(id);
            showToast('Customer deleted', 'info');
        }
    };

    const handleMigration = async () => {
        if (!confirm('This will upload all local data to Supabase. Proceed?')) return;
        const result = await migrateData();
        if (result.success) {
            showToast('Migration successful!', 'success');
        } else {
            showToast(`Migration failed: ${result.error}`, 'error');
        }
    };

    return (
        <div>


            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
                {/* Appearance Section */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'linear-gradient(135deg, #FF6600 0%, #FF8533 100%)' }}></div>
                            <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Appearance</h2>
                        </div>
                        <button
                            onClick={toggleTheme}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'var(--color-bg)',
                                border: '1px solid var(--color-border)',
                                padding: '8px 16px',
                                borderRadius: '20px',
                                cursor: 'pointer',
                                color: 'var(--color-text-main)'
                            }}
                        >
                            {isDarkMode ? <Moon size={18} /> : <Sun size={18} />}
                            <span>{isDarkMode ? 'Dark Mode' : 'Light Mode'}</span>
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Theme Color</label>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <input
                                    type="color"
                                    value={themeColor}
                                    onChange={(e) => setThemeColor(e.target.value)}
                                    style={{
                                        border: 'none',
                                        width: '40px',
                                        height: '40px',
                                        cursor: 'pointer',
                                        background: 'none'
                                    }}
                                />
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {['#FF6600', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444'].map(color => (
                                        <button
                                            key={color}
                                            onClick={() => setThemeColor(color)}
                                            style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '50%',
                                                backgroundColor: color,
                                                border: themeColor === color ? `2px solid var(--color-text-main)` : '2px solid transparent',
                                                cursor: 'pointer',
                                                transition: 'transform 0.2s'
                                            }}
                                            title={color}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                Font Size: {fontSize}px
                            </label>
                            <input
                                type="range"
                                min="12"
                                max="20"
                                step="1"
                                value={fontSize}
                                onChange={(e) => setFontSize(Number(e.target.value))}
                                style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                                <span>Small</span>
                                <span>Medium</span>
                                <span>Large</span>
                            </div>
                        </div>
                        <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
                            <button onClick={resetTheme} style={{
                                padding: '8px 16px',
                                border: '1px solid var(--color-border)',
                                borderRadius: '8px',
                                background: 'transparent',
                                color: 'var(--color-text-secondary)',
                                fontSize: '13px',
                                cursor: 'pointer'
                            }}>
                                Reset to Defaults
                            </button>
                        </div>
                    </div>
                </div>

                {/* Store Profile Section */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                        <Store className="text-primary" size={24} />
                        <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Store Profile</h2>
                    </div>

                    <div style={{ display: 'grid', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Store Name</label>
                            <input
                                type="text"
                                value={storeName}
                                onChange={(e) => setStoreName(e.target.value)}
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Email Address</label>
                                <input
                                    type="email"
                                    defaultValue="contact@jblstore.com"
                                    className="search-input"
                                    style={{ width: '100%', padding: '12px' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Phone Number</label>
                                <input
                                    type="tel"
                                    defaultValue="+1 (555) 123-4567"
                                    className="search-input"
                                    style={{ width: '100%', padding: '12px' }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Data Migration Section */}
                <div className="glass-panel" style={{ padding: '24px', borderColor: 'var(--color-primary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                        <Database size={24} className="text-primary" />
                        <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Data Migration</h3>
                    </div>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
                        Upload your local data to the cloud database (Supabase). This ensures your data is backed up and accessible across devices.
                    </p>
                    <button
                        onClick={handleMigration}
                        className="primary-button"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}
                    >
                        <Database size={18} />
                        Migrate to Supabase
                    </button>
                </div>

                {/* Category Management Section */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Tag className="text-primary" size={24} />
                            <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Product Categories</h2>
                        </div>
                        <button
                            onClick={() => setShowAddCategory(!showAddCategory)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                background: 'transparent', border: '1px solid var(--color-border)',
                                padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', color: 'var(--color-text-main)'
                            }}
                        >
                            <Plus size={16} />
                            Add Category
                        </button>
                    </div>

                    {showAddCategory && (
                        <div style={{
                            marginBottom: '12px', padding: '16px',
                            background: 'var(--color-bg)', borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            display: 'flex', gap: '12px', alignItems: 'end'
                        }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Category Name</label>
                                <input
                                    type="text"
                                    value={newCategory}
                                    onChange={(e) => setNewCategory(e.target.value)}
                                    className="search-input"
                                    style={{ width: '100%', padding: '8px' }}
                                    placeholder="e.g. Headphones"
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                                />
                            </div>
                            <button
                                onClick={handleAddCategory}
                                className="primary-button"
                                style={{ padding: '8px 16px', height: '35px' }}
                            >
                                Add
                            </button>
                        </div>
                    )}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                        {categories.map(cat => (
                            <div key={cat} style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '8px 12px', background: 'var(--color-surface)',
                                borderRadius: '20px', border: '1px solid var(--color-border)'
                            }}>
                                <span style={{ fontWeight: 500 }}>{cat}</span>
                                <button
                                    onClick={() => handleDeleteCategory(cat)}
                                    style={{
                                        background: 'transparent', border: 'none',
                                        color: 'var(--color-text-muted)', cursor: 'pointer',
                                        padding: '4px', display: 'flex'
                                    }}
                                    className="hover-danger"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Customer Management Section */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <UserIcon className="text-primary" size={24} />
                            <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Customers</h2>
                        </div>
                        <button
                            onClick={() => setShowAddCustomer(!showAddCustomer)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                background: 'transparent', border: '1px solid var(--color-border)',
                                padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', color: 'var(--color-text-main)'
                            }}
                        >
                            <Plus size={16} />
                            Add Customer
                        </button>
                    </div>

                    {showAddCustomer && (
                        <div style={{
                            marginBottom: '12px', padding: '16px',
                            background: 'var(--color-bg)', borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '12px', alignItems: 'end'
                        }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Name</label>
                                <input
                                    type="text"
                                    value={newCustomer.name}
                                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                                    className="search-input"
                                    style={{ width: '100%', padding: '8px' }}
                                    placeholder="Customer Name"
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Phone</label>
                                <input
                                    type="text"
                                    value={newCustomer.phone}
                                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                                    className="search-input"
                                    style={{ width: '100%', padding: '8px' }}
                                    placeholder="012 345 678"
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Platform</label>
                                <select
                                    value={newCustomer.platform}
                                    onChange={(e) => setNewCustomer({ ...newCustomer, platform: e.target.value as any })}
                                    className="search-input"
                                    style={{ width: '100%', padding: '8px' }}
                                >
                                    <option value="Walk-in">Walk-in</option>
                                    <option value="Facebook">Facebook</option>
                                    <option value="TikTok">TikTok</option>
                                    <option value="Telegram">Telegram</option>
                                </select>
                            </div>
                            <button
                                onClick={handleAddCustomer}
                                className="primary-button"
                                style={{ padding: '8px 16px', height: '35px' }}
                            >
                                Add
                            </button>
                        </div>
                    )}

                    <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {customers.map(customer => (
                            <div key={customer.id} style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '12px',
                                background: 'var(--color-bg)',
                                borderRadius: '8px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '50%',
                                        background: '#E0F2FE',
                                        color: '#0284C7',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontWeight: 'bold',
                                        fontSize: '14px'
                                    }}>
                                        {customer.name.charAt(0)}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: '500' }}>{customer.name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{customer.phone} • {customer.platform}</div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDeleteCustomer(customer.id)}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--color-error, #EF4444)',
                                        cursor: 'pointer',
                                        padding: '8px'
                                    }}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                        {customers.length === 0 && (
                            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-muted)' }}>No customers found.</div>
                        )}
                    </div>
                </div>

                {/* Users Section */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Users className="text-primary" size={24} />
                            <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Team Members</h2>
                        </div>
                        <button
                            onClick={() => setShowAddUser(!showAddUser)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'transparent',
                                border: '1px solid var(--color-border)',
                                padding: '8px 16px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                color: 'var(--color-text-main)'
                            }}
                        >
                            <Plus size={16} />
                            Add Member
                        </button>
                    </div>

                    {showAddUser && (
                        <div style={{
                            marginBottom: '12px',
                            padding: '16px',
                            background: 'var(--color-bg)',
                            borderRadius: '8px',
                            border: '1px solid var(--color-border)'
                        }}>
                            <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '600' }}>New User</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '12px', alignItems: 'end' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Name</label>
                                    <input
                                        type="text"
                                        value={newUser.name}
                                        onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                                        className="search-input"
                                        style={{ width: '100%', padding: '8px' }}
                                        placeholder="John Doe"
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Email</label>
                                    <input
                                        type="email"
                                        value={newUser.email}
                                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                                        className="search-input"
                                        style={{ width: '100%', padding: '8px' }}
                                        placeholder="john@example.com"
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Role</label>
                                    <select
                                        value={newUser.role}
                                        onChange={(e) => setNewUser({ ...newUser, role: e.target.value as User['role'] })}
                                        className="search-input"
                                        style={{ width: '100%', padding: '8px' }}
                                    >
                                        <option value="Cashier">Cashier</option>
                                        <option value="Manager">Manager</option>
                                        <option value="Admin">Admin</option>
                                    </select>
                                </div>
                                <button
                                    onClick={handleAddUser}
                                    className="primary-button"
                                    style={{ padding: '8px 16px', height: '35px' }}
                                >
                                    Add
                                </button>
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {users.map(user => (
                            <div key={user.id} style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '12px',
                                background: 'var(--color-bg)',
                                borderRadius: '8px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '50%',
                                        background: 'var(--color-primary)',
                                        color: 'white',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontWeight: 'bold',
                                        fontSize: '14px'
                                    }}>
                                        {user.name.charAt(0)}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: '500' }}>{user.name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{user.email} • {user.role}</div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDeleteUser(user.id)}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--color-error, #EF4444)',
                                        cursor: 'pointer',
                                        padding: '8px'
                                    }}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* General Settings Section */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                        <Globe className="text-primary" size={24} />
                        <h2 style={{ fontSize: '20px', fontWeight: '600' }}>General Configuration</h2>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Currency</label>
                            <select
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value)}
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            >
                                <option>USD ($)</option>
                                <option>EUR (€)</option>
                                <option>GBP (£)</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Tax Rate (%)</label>
                            <input
                                type="number"
                                value={taxRate}
                                onChange={(e) => setTaxRate(e.target.value)}
                                className="search-input"
                                style={{ width: '100%', padding: '12px' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Notifications & Security (Placeholder) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="glass-panel" style={{ padding: '24px', opacity: 0.7 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                            <Bell size={24} />
                            <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Notifications</h3>
                        </div>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Manage email and push notification preferences.</p>
                    </div>
                    <div className="glass-panel" style={{ padding: '24px', opacity: 0.7 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                            <Shield size={24} />
                            <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Security</h3>
                        </div>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Update password and 2FA settings.</p>
                    </div>
                </div>


            </div>
        </div>
    );
};

export default Settings;
