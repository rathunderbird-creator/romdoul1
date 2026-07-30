import React, { useState, useMemo, useEffect } from 'react';
import { Warehouse, Plus, Edit2, Trash2, Search, Package, MapPin, Phone, CheckCircle, X, ChevronRight, Hash } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';

interface WarehouseFormData {
    name: string;
    address: string;
    contact: string;
    capacity: string;
}

const WarehousesPage: React.FC = () => {
    const { warehouses, warehouseStock, products, addWarehouse, updateWarehouse, deleteWarehouse, currentUser } = useStore();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const isMobile = useMobile();

    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingWarehouse, setEditingWarehouse] = useState<any>(null);
    const [formData, setFormData] = useState<WarehouseFormData>({ name: '', address: '', contact: '', capacity: '' });
    
    // For specific warehouse detail view
    const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
    const [stockSearchTerm, setStockSearchTerm] = useState('');

    const isAdmin = currentUser?.roleId === 'admin';

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Warehouses {selectedWarehouseId && <><ChevronRight size={14} color="var(--color-text-muted)" /> <span style={{ color: 'var(--color-text-secondary)' }}>Stock View</span></>}
                    </h1>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, selectedWarehouseId]);

    const filteredWarehouses = useMemo(() => {
        return warehouses.filter(w => 
            w.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
            (w.address || '').toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [warehouses, searchTerm]);

    const openModal = (warehouse?: any) => {
        if (warehouse) {
            setEditingWarehouse(warehouse);
            setFormData({
                name: warehouse.name,
                address: warehouse.address || '',
                contact: warehouse.contact || '',
                capacity: warehouse.capacity?.toString() || ''
            });
        } else {
            setEditingWarehouse(null);
            setFormData({ name: '', address: '', contact: '', capacity: '' });
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const data = {
                name: formData.name,
                address: formData.address,
                contact: formData.contact,
                capacity: formData.capacity ? parseInt(formData.capacity) : undefined
            };

            if (editingWarehouse) {
                await updateWarehouse(editingWarehouse.id, data);
                showToast('Warehouse updated successfully', 'success');
            } else {
                await addWarehouse(data);
                showToast('Warehouse created successfully', 'success');
            }
            setIsModalOpen(false);
        } catch (error: any) {
            showToast(error.message || 'Failed to save warehouse', 'error');
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (window.confirm(`Are you sure you want to delete ${name}? This may orphan stock records associated with this warehouse.`)) {
            try {
                await deleteWarehouse(id);
                showToast('Warehouse deleted', 'success');
                if (selectedWarehouseId === id) setSelectedWarehouseId(null);
            } catch (error: any) {
                showToast(error.message || 'Failed to delete warehouse', 'error');
            }
        }
    };

    // -- Stock Detail View Logic --
    const selectedWarehouse = warehouses.find(w => w.id === selectedWarehouseId);
    const warehouseProducts = useMemo(() => {
        if (!selectedWarehouseId) return [];
        // Map warehouseStock to products
        return warehouseStock
            .filter(ws => ws.warehouseId === selectedWarehouseId)
            .map(ws => {
                const p = products.find(prod => prod.id === ws.productId);
                return {
                    ...ws,
                    productName: p?.name || 'Unknown Product',
                    sku: p?.sku || '-',
                    image: p?.image || ''
                };
            })
            .filter(item => 
                item.productName.toLowerCase().includes(stockSearchTerm.toLowerCase()) || 
                item.sku.toLowerCase().includes(stockSearchTerm.toLowerCase())
            )
            .sort((a, b) => b.quantity - a.quantity);
    }, [warehouseStock, selectedWarehouseId, products, stockSearchTerm]);

    const totalWarehouseStock = useMemo(() => warehouseProducts.reduce((sum, item) => sum + item.quantity, 0), [warehouseProducts]);
    const totalWarehouseCapacity = selectedWarehouse?.capacity || 0;
    const capacityPercentage = totalWarehouseCapacity > 0 ? Math.min(100, Math.round((totalWarehouseStock / totalWarehouseCapacity) * 100)) : 0;

    const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '13px', background: 'var(--color-bg)', outline: 'none', transition: 'border-color 0.2s' };

    return (
        <div style={{ padding: '24px' }}>
            {selectedWarehouseId && selectedWarehouse ? (
                // STOCK DETAIL VIEW
                <div className="fade-in">
                    <button 
                        onClick={() => setSelectedWarehouseId(null)}
                        className="secondary-button"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '24px', padding: '6px 12px' }}
                    >
                        <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} /> Back to Warehouses
                    </button>

                    <div style={{ display: 'flex', gap: '24px', flexDirection: isMobile ? 'column' : 'row' }}>
                        {/* Sidebar Info */}
                        <div style={{ width: isMobile ? '100%' : '300px', flexShrink: 0 }}>
                            <div className="glass-panel" style={{ padding: '24px', borderRadius: '16px' }}>
                                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', marginBottom: '16px' }}>
                                    <Warehouse size={24} />
                                </div>
                                <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>{selectedWarehouse.name}</h2>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {selectedWarehouse.address && (
                                        <div style={{ display: 'flex', gap: '8px', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                            <MapPin size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                                            <span>{selectedWarehouse.address}</span>
                                        </div>
                                    )}
                                    {selectedWarehouse.contact && (
                                        <div style={{ display: 'flex', gap: '8px', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                            <Phone size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                                            <span>{selectedWarehouse.contact}</span>
                                        </div>
                                    )}
                                </div>

                                <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--color-border)' }}>
                                    <h3 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: '12px' }}>Capacity</h3>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', fontWeight: 500 }}>
                                        <span>{totalWarehouseStock.toLocaleString()} Items</span>
                                        <span style={{ color: 'var(--color-text-secondary)' }}>/ {totalWarehouseCapacity > 0 ? totalWarehouseCapacity.toLocaleString() : '∞'}</span>
                                    </div>
                                    {totalWarehouseCapacity > 0 && (
                                        <div style={{ height: '6px', background: 'var(--color-bg)', borderRadius: '3px', overflow: 'hidden' }}>
                                            <div style={{ 
                                                height: '100%', 
                                                width: `${capacityPercentage}%`, 
                                                background: capacityPercentage > 90 ? '#EF4444' : capacityPercentage > 75 ? '#F59E0B' : '#10B981',
                                                borderRadius: '3px'
                                            }} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Main Stock Table */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)' }}>
                                <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                                    <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Warehouse Inventory</h3>
                                    <div style={{ position: 'relative', width: isMobile ? '100%' : '240px' }}>
                                        <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                                        <input
                                            type="text"
                                            placeholder="Search products..."
                                            value={stockSearchTerm}
                                            onChange={(e) => setStockSearchTerm(e.target.value)}
                                            style={{ width: '100%', padding: '8px 12px 8px 36px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '13px', outline: 'none' }}
                                        />
                                    </div>
                                </div>

                                {warehouseProducts.length === 0 ? (
                                    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        <Package size={48} style={{ opacity: 0.2, marginBottom: '16px', margin: '0 auto' }} />
                                        <h3 style={{ fontSize: '15px', fontWeight: 500 }}>No stock found</h3>
                                        <p style={{ fontSize: '13px', marginTop: '8px' }}>This warehouse has no products assigned to it yet.</p>
                                    </div>
                                ) : (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table className="spreadsheet-table">
                                            <thead>
                                                <tr>
                                                    <th>Product</th>
                                                    <th>SKU</th>
                                                    <th style={{ textAlign: 'center' }}>Quantity</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {warehouseProducts.map(item => (
                                                    <tr key={item.id}>
                                                        <td>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                {item.image ? (
                                                                    <img src={item.image} alt={item.productName} style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }} />
                                                                ) : (
                                                                    <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                        <Package size={16} color="var(--color-text-muted)" />
                                                                    </div>
                                                                )}
                                                                <span style={{ fontWeight: 500, fontSize: '13px' }}>{item.productName}</span>
                                                            </div>
                                                        </td>
                                                        <td style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>{item.sku}</td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <span style={{ 
                                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 700,
                                                                background: item.quantity <= 0 ? '#FEF2F2' : '#ECFDF5',
                                                                color: item.quantity <= 0 ? '#EF4444' : '#10B981'
                                                            }}>
                                                                {item.quantity.toLocaleString()}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                // WAREHOUSE LIST VIEW
                <div className="fade-in">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                        <div style={{ position: 'relative', width: isMobile ? '100%' : '300px' }}>
                            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                            <input
                                type="text"
                                placeholder="Search warehouses..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ width: '100%', padding: '10px 16px 10px 40px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '14px', outline: 'none' }}
                            />
                        </div>
                        {isAdmin && (
                            <button onClick={() => openModal()} className="primary-button" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Plus size={18} /> New Warehouse
                            </button>
                        )}
                    </div>

                    {filteredWarehouses.length === 0 ? (
                        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--color-text-secondary)', background: 'var(--color-surface)', borderRadius: '16px', border: '1px dashed var(--color-border)' }}>
                            <Warehouse size={48} style={{ opacity: 0.2, marginBottom: '16px', margin: '0 auto' }} />
                            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)' }}>No warehouses found</h3>
                            <p style={{ fontSize: '14px', marginTop: '8px' }}>{searchTerm ? 'Try a different search term.' : 'Add your first warehouse to start tracking inventory locations.'}</p>
                            {isAdmin && !searchTerm && (
                                <button onClick={() => openModal()} className="primary-button" style={{ marginTop: '24px' }}>
                                    Add Warehouse
                                </button>
                            )}
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
                            {filteredWarehouses.map(warehouse => {
                                // Calculate stock for this warehouse
                                const whStock = warehouseStock.filter(ws => ws.warehouseId === warehouse.id).reduce((sum, item) => sum + item.quantity, 0);
                                const capacity = warehouse.capacity || 0;
                                const pct = capacity > 0 ? Math.min(100, Math.round((whStock / capacity) * 100)) : 0;

                                return (
                                    <div key={warehouse.id} className="glass-panel" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                        <div style={{ padding: '20px', borderBottom: '1px solid var(--color-border)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)' }}>
                                                        <Warehouse size={20} />
                                                    </div>
                                                    <div>
                                                        <h3 style={{ fontSize: '16px', fontWeight: 600 }}>{warehouse.name}</h3>
                                                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                                                            {new Date(warehouse.createdAt || '').toLocaleDateString()}
                                                        </div>
                                                    </div>
                                                </div>
                                                {isAdmin && (
                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                        <button onClick={() => openModal(warehouse)} className="icon-button" style={{ padding: '6px', color: 'var(--color-text-secondary)' }}>
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button onClick={() => handleDelete(warehouse.id, warehouse.name)} className="icon-button" style={{ padding: '6px', color: '#EF4444' }}>
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {warehouse.address && (
                                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                        <MapPin size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                                                        <span style={{ lineHeight: 1.4 }}>{warehouse.address}</span>
                                                    </div>
                                                )}
                                                {warehouse.contact && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                        <Phone size={16} style={{ flexShrink: 0 }} />
                                                        <span>{warehouse.contact}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        
                                        <div style={{ padding: '16px 20px', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                                            <div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', fontWeight: 500 }}>
                                                    <span>Stock Utilisation</span>
                                                    <span style={{ color: 'var(--color-text-secondary)' }}>{whStock.toLocaleString()} {capacity > 0 ? `/ ${capacity.toLocaleString()}` : ''}</span>
                                                </div>
                                                {capacity > 0 && (
                                                    <div style={{ height: '6px', background: 'var(--color-surface)', borderRadius: '3px', overflow: 'hidden' }}>
                                                        <div style={{ height: '100%', width: `${pct}%`, background: pct > 90 ? '#EF4444' : pct > 75 ? '#F59E0B' : '#10B981', borderRadius: '3px' }} />
                                                    </div>
                                                )}
                                            </div>
                                            
                                            <button 
                                                onClick={() => setSelectedWarehouseId(warehouse.id)}
                                                style={{ width: '100%', padding: '10px', marginTop: 'auto', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s' }}
                                                onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.color = 'var(--color-primary)'; }}
                                                onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-main)'; }}
                                            >
                                                View Inventory <ChevronRight size={16} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Modal */}
            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content fade-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px', width: '90%' }}>
                        <div className="modal-header">
                            <h2 style={{ fontSize: '18px', fontWeight: 600 }}>{editingWarehouse ? 'Edit Warehouse' : 'Add Warehouse'}</h2>
                            <button onClick={() => setIsModalOpen(false)} className="icon-button"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div>
                                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Warehouse Name *</label>
                                    <div style={{ position: 'relative' }}>
                                        <Warehouse size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                                        <input
                                            required
                                            type="text"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            style={{ ...inputStyle, paddingLeft: '36px' }}
                                            placeholder="e.g., Main Fulfillment Center"
                                        />
                                    </div>
                                </div>
                                
                                <div>
                                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Address</label>
                                    <div style={{ position: 'relative' }}>
                                        <MapPin size={16} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--color-text-muted)' }} />
                                        <textarea
                                            value={formData.address}
                                            onChange={e => setFormData({ ...formData, address: e.target.value })}
                                            style={{ ...inputStyle, paddingLeft: '36px', minHeight: '80px', resize: 'vertical' }}
                                            placeholder="Full address..."
                                        />
                                    </div>
                                </div>
                                
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Contact Details</label>
                                        <div style={{ position: 'relative' }}>
                                            <Phone size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                                            <input
                                                type="text"
                                                value={formData.contact}
                                                onChange={e => setFormData({ ...formData, contact: e.target.value })}
                                                style={{ ...inputStyle, paddingLeft: '36px' }}
                                                placeholder="Phone or email"
                                            />
                                        </div>
                                    </div>
                                    
                                    <div>
                                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Max Capacity (Items)</label>
                                        <div style={{ position: 'relative' }}>
                                            <Hash size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                                            <input
                                                type="number"
                                                value={formData.capacity}
                                                onChange={e => setFormData({ ...formData, capacity: e.target.value })}
                                                style={{ ...inputStyle, paddingLeft: '36px' }}
                                                placeholder="e.g., 10000"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="secondary-button">Cancel</button>
                                <button type="submit" className="primary-button" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <CheckCircle size={16} /> Save Warehouse
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WarehousesPage;
