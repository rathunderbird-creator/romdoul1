import React, { useState, useMemo } from 'react';
import { Plus, Trash2, DollarSign, Wallet } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal } from '../../components';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';

const PaymentsPage: React.FC = () => {
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
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Payments</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Record and track outgoing payments</p>
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
        <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', background: 'var(--color-surface)', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
                <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ padding: '12px', background: 'rgba(59, 130, 246, 0.1)', color: '#3B82F6', borderRadius: '12px' }}>
                        <Wallet size={24} />
                    </div>
                    <div>
                        <h2 style={{ fontSize: '16px', fontWeight: 'bold' }}>Total Payments</h2>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--color-text)' }}>
                            ${paymentsList.reduce((sum, p) => sum + p.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
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
            </div>

            <div className="glass-panel" style={{ overflow: 'hidden' }}>
                {paymentsList.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                        <DollarSign size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
                        <p>No payments recorded yet.</p>
                    </div>
                ) : (
                    <table className="spreadsheet-table" style={{ tableLayout: 'fixed' }}>
                        <thead>
                            <tr>
                                <th style={{ width: '120px' }}>Date</th>
                                <th style={{ width: '150px' }}>Category</th>
                                <th>Description</th>
                                <th style={{ width: '120px' }}>Payment Method</th>
                                <th style={{ width: '120px', textAlign: 'right' }}>Amount</th>
                                <th style={{ width: '80px', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paymentsList.map(payment => (
                                <tr key={payment.id} className="hover-bg-subtle">
                                    <td style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                        {new Date(payment.date).toLocaleDateString()}
                                    </td>
                                    <td>
                                        <span style={{ padding: '4px 8px', borderRadius: '4px', backgroundColor: 'var(--color-bg)', fontSize: '12px', border: '1px solid var(--color-border)' }}>
                                            {payment.category || '—'}
                                        </span>
                                    </td>
                                    <td style={{ color: 'var(--color-text)' }}>
                                        {payment.description || '—'}
                                    </td>
                                    <td style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                        {payment.pay_by || '—'}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--color-text)' }}>
                                        ${payment.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
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

export default PaymentsPage;
