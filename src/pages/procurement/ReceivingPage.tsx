import React, { useState } from 'react';
import { PackageCheck, Search, Filter } from 'lucide-react';

const ReceivingPage: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');

    return (
        <div className="page-container fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Receiving</h1>
                    <p className="page-subtitle">Track and receive items from purchase orders</p>
                </div>
            </div>

            <div className="table-container">
                <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: '1 1 300px' }}>
                        <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                        <input
                            type="text"
                            placeholder="Search purchase orders or items..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '10px 10px 10px 40px',
                                borderRadius: '8px',
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-bg)',
                                color: 'var(--color-text-main)',
                                fontSize: '14px'
                            }}
                        />
                    </div>
                    <button style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'var(--color-text-main)', cursor: 'pointer' }}>
                        <Filter size={16} />
                        Filter
                    </button>
                </div>

                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <PackageCheck size={48} style={{ opacity: 0.2, marginBottom: '16px', margin: '0 auto' }} />
                    <h3>No items to receive</h3>
                    <p style={{ fontSize: '14px', marginTop: '8px' }}>Create a purchase order to start receiving items.</p>
                </div>
            </div>
        </div>
    );
};

export default ReceivingPage;
