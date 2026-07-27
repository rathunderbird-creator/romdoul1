import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Mail, Phone, MapPin } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal } from '../../components';
import { useProcurement } from '../../hooks/useProcurement';
import type { Supplier } from '../../types';

const SuppliersPage = () => {
    const { setHeaderContent } = useHeader();
    const { suppliers, isLoading, fetchSuppliers, saveSupplier, deleteSupplier } = useProcurement();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
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
    }, [fetchSuppliers]);

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
        <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Suppliers Directory</h2>
                <button 
                    className="primary-button" 
                    onClick={() => handleOpenModal()}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '8px' }}
                >
                    <Plus size={18} /> Add Supplier
                </button>
            </div>

            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '12px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ padding: '16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Supplier</th>
                            <th style={{ padding: '16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Contact Info</th>
                            <th style={{ padding: '16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Tax ID</th>
                            <th style={{ padding: '16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Status</th>
                            <th style={{ padding: '16px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center' }}>Loading...</td></tr>
                        ) : suppliers.length === 0 ? (
                            <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center' }}>No suppliers found</td></tr>
                        ) : (
                            suppliers.map(supplier => (
                                <tr key={supplier.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={{ padding: '16px' }}>
                                        <div style={{ fontWeight: '600' }}>{supplier.name}</div>
                                        {supplier.contact_name && <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Contact: {supplier.contact_name}</div>}
                                    </td>
                                    <td style={{ padding: '16px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                            {supplier.phone && <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Phone size={14} /> {supplier.phone}</span>}
                                            {supplier.email && <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Mail size={14} /> {supplier.email}</span>}
                                            {supplier.address && <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={14} /> {supplier.address}</span>}
                                        </div>
                                    </td>
                                    <td style={{ padding: '16px', color: 'var(--color-text-secondary)' }}>{supplier.tax_id || '-'}</td>
                                    <td style={{ padding: '16px' }}>
                                        <span style={{
                                            padding: '4px 8px', borderRadius: '4px', fontSize: '12px',
                                            backgroundColor: supplier.is_active ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                            color: supplier.is_active ? 'var(--color-green)' : 'var(--color-red)'
                                        }}>
                                            {supplier.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                            <button 
                                                className="secondary-button" 
                                                style={{ padding: '8px', borderRadius: '6px' }}
                                                onClick={() => handleOpenModal(supplier)}
                                            >
                                                <Edit size={16} />
                                            </button>
                                            <button 
                                                className="danger-button" 
                                                style={{ padding: '8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-red)', border: 'none' }}
                                                onClick={() => handleDelete(supplier.id)}
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
                title={editingSupplier ? 'Edit Supplier' : 'New Supplier'}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 0' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Supplier Name *</label>
                        <input 
                            type="text" 
                            className="input-field" 
                            style={{ width: '100%', padding: '10px' }}
                            value={formData.name || ''} 
                            onChange={(e) => setFormData({...formData, name: e.target.value})} 
                            placeholder="Company Name"
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Contact Person</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px' }}
                                value={formData.contact_name || ''} 
                                onChange={(e) => setFormData({...formData, contact_name: e.target.value})} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Tax ID</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px' }}
                                value={formData.tax_id || ''} 
                                onChange={(e) => setFormData({...formData, tax_id: e.target.value})} 
                            />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Email</label>
                            <input 
                                type="email" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px' }}
                                value={formData.email || ''} 
                                onChange={(e) => setFormData({...formData, email: e.target.value})} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Phone</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px' }}
                                value={formData.phone || ''} 
                                onChange={(e) => setFormData({...formData, phone: e.target.value})} 
                            />
                        </div>
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Address</label>
                        <textarea 
                            className="input-field" 
                            style={{ width: '100%', padding: '10px', minHeight: '60px' }}
                            value={formData.address || ''} 
                            onChange={(e) => setFormData({...formData, address: e.target.value})} 
                        />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input 
                            type="checkbox" 
                            checked={formData.is_active} 
                            onChange={(e) => setFormData({...formData, is_active: e.target.checked})} 
                        />
                        <span>Active</span>
                    </label>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 16px', borderRadius: '8px' }}>Cancel</button>
                        <button 
                            className="primary-button" 
                            onClick={handleSave} 
                            disabled={!formData.name}
                            style={{ padding: '10px 16px', borderRadius: '8px' }}
                        >
                            Save
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default SuppliersPage;
