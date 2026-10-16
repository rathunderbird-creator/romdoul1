import React, { useState, useMemo } from 'react';
import { Plus, Trash2, DollarSign } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal } from '../../components';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';

const PaymentsPage: React.FC = () => {
    const isMobile = useMobile();
    const { setHeaderContent } = useHeader();
    const { transactions, addTransaction, deleteTransaction, refreshData } = useStore();
    const { showToast } = useToast();

    const [isModalOpen, setIsModalOpen] = useState(false);
    
    // Form state
    const [date, setDate] = useState(() => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
    const [amount, setAmount] = useState<number | string>('');
    const [category, setCategory] = useState('');
    const [description, setDescription] = useState('');
    const [payBy, setPayBy] = useState('Cash');

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Payments</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Record and track outgoing payments.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    // Only show Expense type transactions as outgoing "Payments"
    const paymentsList = useMemo(() => {
        return transactions
            .filter(t => t.type === 'Expense')
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [transactions]);

    const handleSave = async () => {
        if (!amount || Number(amount) <= 0) {
            showToast('Please enter a valid amount', 'error');
            return;
        }

        try {
            const newPayment = {
                type: 'Expense' as const,
                amount: Number(amount),
                category: category || 'General Payment',
                description,
                date: new Date(date).toISOString(),
                pay_by: payBy
            };

            await addTransaction(newPayment);
            showToast('Payment recorded successfully', 'success');
            setIsModalOpen(false);
        } catch (error: any) {
            showToast(error.message || 'Failed to record payment', 'error');
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this payment?')) {
            try {
                await deleteTransaction(id);
                showToast('Payment deleted successfully', 'success');
            } catch (error: any) {
                showToast(error.message || 'Failed to delete payment', 'error');
            }
        }
    };

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)' }}>
            {/* Summary — same flat cards as the financial statements */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '24px' }}>
                <div style={{ ...cardStyle, padding: '16px 20px' }}>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Total Payments</div>
                    <div style={{ fontSize: '26px', fontWeight: 800, color: '#3B82F6', marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>
                        ${paymentsList.reduce((sum, p) => sum + p.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                </div>
                <div style={{ ...cardStyle, padding: '16px 20px' }}>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Payments Recorded</div>
                    <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>
                        {paymentsList.length}
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <button className="secondary-button" onClick={() => { refreshData(); showToast('Refreshed payments', 'success'); }}>Refresh</button>
                <button className="primary-button" onClick={() => {
                    setDate(new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
                    setAmount('');
                    setCategory('');
                    setDescription('');
                    setIsModalOpen(true);
                }}>
                    <Plus size={18} /> Record Payment
                </button>
            </div>

            <div style={{ ...cardStyle, overflow: 'hidden' }}>
                {paymentsList.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                        <DollarSign size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
                        <p>No payments recorded yet.</p>
                    </div>
                ) : isMobile ? (
                    // Phones: one card per payment — no sideways scrolling.
                    paymentsList.map(payment => (
                        <div key={payment.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                                <span style={{ padding: '3px 8px', borderRadius: '4px', backgroundColor: 'var(--color-bg)', fontSize: '11px', border: '1px solid var(--color-border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {payment.category || '—'}
                                </span>
                                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', flexShrink: 0 }}>{new Date(payment.date).toLocaleDateString()}</span>
                            </div>
                            <div className="d2-khmer" style={{ fontSize: '13px', color: 'var(--color-text-main)', margin: '6px 0' }}>
                                {payment.description || '—'}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{payment.pay_by || '—'}</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                    <span style={{ fontWeight: 700, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>
                                        ${payment.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </span>
                                    <Trash2 size={15} color="#EF4444" style={{ cursor: 'pointer' }} onClick={() => handleDelete(payment.id)} />
                                </span>
                            </div>
                        </div>
                    ))
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px', minWidth: '680px' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg)' }}>
                                <th style={{ ...thStyle, width: '120px' }}>Date</th>
                                <th style={{ ...thStyle, width: '150px' }}>Category</th>
                                <th style={thStyle}>Description</th>
                                <th style={{ ...thStyle, width: '140px' }}>Payment Method</th>
                                <th style={{ ...thStyle, width: '120px', textAlign: 'right' }}>Amount</th>
                                <th style={{ ...thStyle, width: '80px', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paymentsList.map(payment => (
                                <tr key={payment.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                                    <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>
                                        {new Date(payment.date).toLocaleDateString()}
                                    </td>
                                    <td style={tdStyle}>
                                        <span style={{ padding: '4px 8px', borderRadius: '4px', backgroundColor: 'var(--color-bg)', fontSize: '12px', border: '1px solid var(--color-border)' }}>
                                            {payment.category || '—'}
                                        </span>
                                    </td>
                                    <td className="d2-khmer" style={{ ...tdStyle, whiteSpace: 'normal', color: 'var(--color-text-main)' }}>
                                        {payment.description || '—'}
                                    </td>
                                    <td style={{ ...tdStyle, color: 'var(--color-text-secondary)' }}>
                                        {payment.pay_by || '—'}
                                    </td>
                                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>
                                        ${payment.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                                        <button
                                            className="icon-button"
                                            onClick={() => handleDelete(payment.id)}
                                            style={{ color: '#EF4444' }}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                )}
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Record Payment">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Date</label>
                        <input 
                            type="date" 
                            className="search-input" 
                            style={{ width: '100%' }}
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Amount ($)</label>
                        <input 
                            type="number" 
                            className="search-input" 
                            style={{ width: '100%' }}
                            placeholder="0.00"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            min="0"
                            step="0.01"
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Category</label>
                            <input 
                                type="text" 
                                className="search-input" 
                                style={{ width: '100%' }}
                                placeholder="e.g. Supplier, Utilities, Rent"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Payment Method</label>
                            <select 
                                className="search-input" 
                                style={{ width: '100%' }}
                                value={payBy}
                                onChange={(e) => setPayBy(e.target.value)}
                            >
                                <option value="Cash">Cash</option>
                                <option value="Bank Transfer">Bank Transfer</option>
                                <option value="Credit Card">Credit Card</option>
                                <option value="Cheque">Cheque</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Description (Optional)</label>
                        <textarea 
                            className="search-input" 
                            style={{ width: '100%', minHeight: '80px', resize: 'vertical' }}
                            placeholder="Add details about this payment..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)}>Cancel</button>
                        <button className="primary-button" onClick={handleSave}>Record Payment</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

// The flat card + table text styles used across the financial statements.
const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
const thStyle: React.CSSProperties = { padding: '10px 14px', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: '13px', whiteSpace: 'nowrap' };

export default PaymentsPage;
