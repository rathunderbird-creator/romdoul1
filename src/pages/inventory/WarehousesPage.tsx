import React from 'react';
import { Warehouse } from 'lucide-react';

const WarehousesPage: React.FC = () => {
    return (
        <div className="page-container fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Warehouses</h1>
                    <p className="page-subtitle">Manage storage locations and warehouses</p>
                </div>
            </div>
            
            <div className="table-container">
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Warehouse size={48} style={{ opacity: 0.2, marginBottom: '16px', margin: '0 auto' }} />
                    <h3>No warehouses defined</h3>
                    <p style={{ fontSize: '14px', marginTop: '8px' }}>Add warehouses to track multi-location inventory.</p>
                </div>
            </div>
        </div>
    );
};

export default WarehousesPage;
