import React from 'react';
import { ShieldOff, Trash2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';

const Scammers: React.FC = () => {
    const { blockedCustomers, removeBlockedCustomer } = useStore();
    const { setHeaderContent } = useHeader();

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Blocked Customers (Scammers)</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '14px' }}>Manage customers who are blocked from ordering</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    return (
        <div className="page-container" style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            <div className="glass-panel" style={{ padding: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'linear-gradient(135deg, #FEE2E2 0%, #FECACA 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <ShieldOff size={20} color="#DC2626" />
                    </div>
                    <div>
                        <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Blocked Customers List</h3>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Customers below cannot place new orders</div>
                    </div>
                </div>

                {blockedCustomers && blockedCustomers.length > 0 ? (
                    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: '12px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                            <thead>
                                <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Customer</th>
                                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Phone</th>
                                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Reason</th>
                                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Blocked Details</th>
                                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {blockedCustomers.map((bc) => (
                                    <tr key={bc.phone} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '12px 16px', fontWeight: 500 }}>{bc.name}</td>
                                        <td style={{ padding: '12px 16px' }}>{bc.phone}</td>
                                        <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>{bc.reason || '-'}</td>
                                        <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                            {bc.blockedBy && <div>By: {bc.blockedBy}</div>}
                                            <div>On: {new Date(bc.blockedAt).toLocaleDateString()}</div>
                                        </td>
                                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                            <button
                                                onClick={() => removeBlockedCustomer(bc.phone)}
                                                style={{ padding: '6px 12px', fontSize: '13px', background: '#FEF2F2', color: '#DC2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                                title="Unblock Customer"
                                            >
                                                <Trash2 size={14} /> Unblock
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div style={{ padding: '32px', textAlign: 'center', background: 'var(--color-surface)', borderRadius: '12px', border: '1px dashed var(--color-border)', color: 'var(--color-text-secondary)' }}>
                        No blocked customers.
                    </div>
                )}
            </div>
        </div>
    );
};

export default Scammers;
