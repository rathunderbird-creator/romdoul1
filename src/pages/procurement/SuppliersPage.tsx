import { useState, useEffect, useMemo } from 'react';
import { Plus, Edit, Trash2, Mail, Phone, MapPin, Search, Building2 } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal, StatusBadge } from '../../components';
import { useProcurement } from '../../hooks/useProcurement';
import type { Supplier } from '../../types';

// Helper for generating avatar color based on name
const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 45%)`;
};

const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
};

const SuppliersPage = () => {
    const { setHeaderContent } = useHeader();
    const { suppliers, purchaseOrders, isLoading, fetchSuppliers, fetchPurchaseOrders, saveSupplier, deleteSupplier } = useProcurement();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [formData, setFormData] = useState<Partial<Supplier>>({
        name: '',
        contact_name: '',
        email: '',
        phone: '',
        address: '',
        tax_id: '',
        is_active: true
    });

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Suppliers</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Manage vendor and supplier information</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchSuppliers();
        fetchPurchaseOrders();
    }, [fetchSuppliers, fetchPurchaseOrders]);

    // Calculate balances
    const supplierBalances = useMemo(() => {
        const balances: Record<string, { totalAmount: number, amountPaid: number, balance: number, overdue: boolean }> = {};
        
        suppliers.forEach(s => {
            balances[s.id] = { totalAmount: 0, amountPaid: 0, balance: 0, overdue: false };
        });

        purchaseOrders.forEach(po => {
            if (po.supplier_id && balances[po.supplier_id]) {
                balances[po.supplier_id].totalAmount += (po.total_amount || 0);
                balances[po.supplier_id].amountPaid += (po.amount_paid || 0);
                
                if (po.payment_status !== 'Paid' && po.payment_due_date) {
                    if (new Date(po.payment_due_date) < new Date()) {
                        balances[po.supplier_id].overdue = true;
                    }
                }
            }
        });

        Object.keys(balances).forEach(id => {
            balances[id].balance = balances[id].totalAmount - balances[id].amountPaid;
        });

        return balances;
    }, [suppliers, purchaseOrders]);

    const filteredSuppliers = useMemo(() => {
        if (!searchQuery.trim()) return suppliers;
        const query = searchQuery.toLowerCase();
        return suppliers.filter(s => 
            s.name.toLowerCase().includes(query) || 
            (s.email && s.email.toLowerCase().includes(query)) ||
            (s.contact_name && s.contact_name.toLowerCase().includes(query))
        );
    }, [suppliers, searchQuery]);

    const handleOpenModal = (supplier?: Supplier) => {
        if (supplier) {
            setEditingSupplier(supplier);
            setFormData(supplier);
        } else {
            setEditingSupplier(null);
            setFormData({ name: '', contact_name: '', email: '', phone: '', address: '', tax_id: '', is_active: true });
        }
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.name) return;
        try {
            await saveSupplier(formData);
            setIsModalOpen(false);
        } catch (error) {
            // Error handled in hook
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this supplier?')) {
            await deleteSupplier(id);
        }
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
                            placeholder="Search suppliers by name, contact, or email..." 
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
                    <Plus size={18} /> New Supplier
                </button>
            </div>

            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: 'none' }}>
                    <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', borderRight: 'none' }}>Supplier</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', borderRight: 'none' }}>Contact Details</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', borderRight: 'none' }}>Financials</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', borderRight: 'none' }}>Status</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right', borderBottom: '1px solid var(--color-border)', borderRight: 'none' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading suppliers...</td></tr>
                        ) : filteredSuppliers.length === 0 ? (
                            <tr>
                                <td colSpan={5} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--color-text-secondary)' }}>
                                        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Building2 size={32} style={{ opacity: 0.5 }} />
                                        </div>
                                        <div>
                                            <h3 style={{ color: 'var(--color-text-main)', marginBottom: '4px', fontSize: '16px' }}>No suppliers found</h3>
                                            <p style={{ fontSize: '14px' }}>{searchQuery ? 'Try adjusting your search terms.' : 'Get started by adding your first supplier.'}</p>
                                        </div>
                                        {!searchQuery && (
                                            <button 
                                                className="secondary-button" 
                                                onClick={() => handleOpenModal()}
                                                style={{ padding: '8px 16px', borderRadius: '8px', marginTop: '8px' }}
                                            >
                                                Add Supplier
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredSuppliers.map(supplier => (
                                <tr key={supplier.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease' }} className="hover-highlight">
                                    <td style={{ padding: '16px 24px', borderRight: 'none' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <div style={{ 
                                                width: '40px', height: '40px', borderRadius: '10px', 
                                                backgroundColor: stringToColor(supplier.name), 
                                                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontWeight: 'bold', fontSize: '14px', boxShadow: 'var(--shadow-sm)'
                                            }}>
                                                {getInitials(supplier.name)}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: '600', fontSize: '15px' }}>{supplier.name}</div>
                                                {supplier.contact_name && <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>Contact: {supplier.contact_name}</div>}
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: '16px 24px', borderRight: 'none' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                            {supplier.phone ? <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Phone size={14} style={{ opacity: 0.7 }} /> {supplier.phone}</span> : null}
                                            {supplier.email ? <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Mail size={14} style={{ opacity: 0.7 }} /> {supplier.email}</span> : null}
                                            {supplier.address ? <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><MapPin size={14} style={{ opacity: 0.7 }} /> <span style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{supplier.address}</span></span> : null}
                                            {!supplier.phone && !supplier.email && !supplier.address && <span style={{ fontStyle: 'italic', opacity: 0.5 }}>No contact info</span>}
                                        </div>
                                    </td>
                                    <td style={{ padding: '16px 24px', color: 'var(--color-text-secondary)', borderRight: 'none' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <div style={{ fontSize: '13px' }}>
                                                Balance: <span style={{ fontWeight: 600, color: supplierBalances[supplier.id]?.balance > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
                                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(supplierBalances[supplier.id]?.balance || 0)}
                                                </span>
                                            </div>
                                            {supplierBalances[supplier.id]?.overdue && (
                                                <span style={{ fontSize: '11px', color: 'var(--color-danger)', fontWeight: 600 }}>OVERDUE PAYMENTS</span>
                                            )}
                                        </div>
                                    </td>
                                    <td style={{ padding: '16px 24px', borderRight: 'none' }}>
                                        <StatusBadge status={supplier.is_active ? 'Active' : 'Inactive'} />
                                    </td>
                                    <td style={{ padding: '16px 24px', textAlign: 'right', borderRight: 'none' }}>
                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', opacity: 0.8 }} className="actions-group">
                                            <button 
                                                className="secondary-button" 
                                                style={{ padding: '8px', borderRadius: '8px', background: 'var(--color-bg)' }}
                                                onClick={() => handleOpenModal(supplier)}
                                                title="Edit Supplier"
                                            >
                                                <Edit size={16} />
                                            </button>
                                            <button 
                                                className="danger-button" 
                                                style={{ padding: '8px', borderRadius: '8px', background: 'var(--color-red-light)', color: 'var(--color-red)', border: 'none' }}
                                                onClick={() => handleDelete(supplier.id)}
                                                title="Delete Supplier"
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
                title={editingSupplier ? 'Edit Supplier Details' : 'Register New Supplier'}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px 0', minWidth: '500px' }}>
                    
                    <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                        <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Building2 size={16} /> Company Information
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Supplier Name *</label>
                                <input 
                                    type="text" 
                                    className="input-field" 
                                    style={{ width: '100%', padding: '10px 12px' }}
                                    value={formData.name || ''} 
                                    onChange={(e) => setFormData({...formData, name: e.target.value})} 
                                    placeholder="Enter company or individual name"
                                    autoFocus
                                />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Contact Person</label>
                                    <input 
                                        type="text" 
                                        className="input-field" 
                                        style={{ width: '100%', padding: '10px 12px' }}
                                        value={formData.contact_name || ''} 
                                        onChange={(e) => setFormData({...formData, contact_name: e.target.value})} 
                                        placeholder="Full name"
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Tax ID / VAT</label>
                                    <input 
                                        type="text" 
                                        className="input-field" 
                                        style={{ width: '100%', padding: '10px 12px', fontFamily: 'monospace' }}
                                        value={formData.tax_id || ''} 
                                        onChange={(e) => setFormData({...formData, tax_id: e.target.value})} 
                                        placeholder="Optional"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                        <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <MapPin size={16} /> Contact Details
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Email Address</label>
                                    <input 
                                        type="email" 
                                        className="input-field" 
                                        style={{ width: '100%', padding: '10px 12px' }}
                                        value={formData.email || ''} 
                                        onChange={(e) => setFormData({...formData, email: e.target.value})} 
                                        placeholder="contact@company.com"
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
                                        placeholder="+855 ..."
                                    />
                                </div>
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>Physical Address</label>
                                <textarea 
                                    className="input-field" 
                                    style={{ width: '100%', padding: '10px 12px', minHeight: '80px', resize: 'vertical' }}
                                    value={formData.address || ''} 
                                    onChange={(e) => setFormData({...formData, address: e.target.value})} 
                                    placeholder="Full street address..."
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                            <input 
                                type="checkbox" 
                                checked={formData.is_active} 
                                onChange={(e) => setFormData({...formData, is_active: e.target.checked})} 
                                style={{ width: '18px', height: '18px', accentColor: 'var(--color-primary)' }}
                            />
                            <span style={{ fontWeight: 500 }}>Active Supplier</span>
                        </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px' }}>Cancel</button>
                        <button 
                            className="primary-button" 
                            onClick={handleSave} 
                            disabled={!formData.name}
                            style={{ padding: '10px 24px', borderRadius: '8px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                            {editingSupplier ? 'Save Changes' : 'Register Supplier'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default SuppliersPage;
