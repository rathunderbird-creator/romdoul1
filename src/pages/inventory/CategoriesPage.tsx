import React from 'react';
import { Tags } from 'lucide-react';

const CategoriesPage: React.FC = () => {
    return (
        <div className="page-container fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Categories</h1>
                    <p className="page-subtitle">Manage product categories</p>
                </div>
            </div>
            
            <div className="table-container">
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Tags size={48} style={{ opacity: 0.2, marginBottom: '16px', margin: '0 auto' }} />
                    <h3>No categories defined</h3>
                    <p style={{ fontSize: '14px', marginTop: '8px' }}>Create categories to organize your inventory.</p>
                </div>
            </div>
        </div>
    );
};

export default CategoriesPage;
