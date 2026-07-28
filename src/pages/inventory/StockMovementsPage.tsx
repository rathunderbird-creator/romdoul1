import React from 'react';
import { ArrowLeftRight } from 'lucide-react';

const StockMovementsPage: React.FC = () => {
    return (
        <div className="page-container fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Stock Movements</h1>
                    <p className="page-subtitle">Track all inventory transactions</p>
                </div>
            </div>
            
            <div className="table-container">
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <ArrowLeftRight size={48} style={{ opacity: 0.2, marginBottom: '16px', margin: '0 auto' }} />
                    <h3>No stock movements</h3>
                    <p style={{ fontSize: '14px', marginTop: '8px' }}>Transactions will appear here once inventory is moved.</p>
                </div>
            </div>
        </div>
    );
};

export default StockMovementsPage;
