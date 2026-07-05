import React, { useState, useEffect } from 'react';
import { X, Calendar, Package, CreditCard } from 'lucide-react';

interface BulkEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    onApply: (field: 'date' | 'status' | 'paymentStatus' | 'settleDate', value: any, settleDate?: string) => Promise<void>;
    count: number;
}

const BulkEditModal: React.FC<BulkEditModalProps> = ({ isOpen, onClose, onApply, count }) => {
    const [field, setField] = useState<'date' | 'status' | 'paymentStatus' | 'settleDate'>('date');
    const [value, setValue] = useState<string>('');
    const [settleDate, setSettleDate] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (field === 'paymentStatus' && (value === 'Paid' || value === 'Settled')) {
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            setSettleDate(`${yyyy}-${mm}-${dd}`);
        } else {
            setSettleDate('');
        }
    }, [field, value]);

    if (!isOpen) return null;

    const handleApply = async () => {
        if (!value) return;
        setIsSubmitting(true);
        try {
            await onApply(field, value, settleDate);
            onClose();
        } catch (error) {
            console.error(error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const statusOptions = ['Ordered', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Cancelled'];
    const paymentStatusOptions = ['Unpaid', 'Paid', 'Get File', 'Cancel'];

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)',
            padding: '20px'
        }}>
            <div className="glass-panel" style={{
                width: '100%',
                maxWidth: '400px',
                padding: '24px',
                background: 'white',
                borderRadius: '16px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Bulk Edit {count} Orders</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        <X size={20} color="var(--color-text-secondary)" />
                    </button>
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                        Field to Edit
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => { setField('date'); setValue(''); }}
                            style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '8px',
                                border: field === 'date' ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                background: field === 'date' ? 'var(--color-bg-primary)' : 'var(--color-surface)',
                                color: field === 'date' ? 'var(--color-primary)' : 'var(--color-text-main)',
                                cursor: 'pointer',
                                fontSize: '13px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            <Calendar size={18} />
                            Date
                        </button>
                        <button
                            onClick={() => { setField('settleDate'); setValue(''); }}
                            style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '8px',
                                border: field === 'settleDate' ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                background: field === 'settleDate' ? 'var(--color-bg-primary)' : 'var(--color-surface)',
                                color: field === 'settleDate' ? 'var(--color-primary)' : 'var(--color-text-main)',
                                cursor: 'pointer',
                                fontSize: '13px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            <Calendar size={18} />
                            Settle Date
                        </button>
                        <button
                            onClick={() => { setField('status'); setValue(''); }}
                            style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '8px',
                                border: field === 'status' ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                background: field === 'status' ? 'var(--color-bg-primary)' : 'var(--color-surface)',
                                color: field === 'status' ? 'var(--color-primary)' : 'var(--color-text-main)',
                                cursor: 'pointer',
                                fontSize: '13px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            <Package size={18} />
                            Status
                        </button>
                        <button
                            onClick={() => { setField('paymentStatus'); setValue(''); }}
                            style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '8px',
                                border: field === 'paymentStatus' ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                background: field === 'paymentStatus' ? 'var(--color-bg-primary)' : 'var(--color-surface)',
                                color: field === 'paymentStatus' ? 'var(--color-primary)' : 'var(--color-text-main)',
                                cursor: 'pointer',
                                fontSize: '13px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            <CreditCard size={18} />
                            Payment
                        </button>
                    </div>
                </div>

                <div style={{ marginBottom: '24px' }}>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                        New Value
                    </label>
                    {(field === 'date' || field === 'settleDate') && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                                type="date"
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                style={{
                                    flex: 1,
                                    padding: '12px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    fontSize: '14px'
                                }}
                            />
                            <button
                                onClick={() => {
                                    const now = new Date();
                                    const yyyy = now.getFullYear();
                                    const mm = String(now.getMonth() + 1).padStart(2, '0');
                                    const dd = String(now.getDate()).padStart(2, '0');
                                    setValue(`${yyyy}-${mm}-${dd}`);
                                }}
                                style={{
                                    padding: '0 16px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-primary)',
                                    background: 'var(--color-surface)',
                                    color: 'var(--color-primary)',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Now
                            </button>
                        </div>
                    )}
                    {field === 'status' && (
                        <select
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                border: '1px solid var(--color-border)',
                                fontSize: '14px'
                            }}
                        >
                            <option value="">Select Status...</option>
                            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    )}
                    {field === 'paymentStatus' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <select
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    fontSize: '14px'
                                }}
                            >
                                <option value="">Select Payment Status...</option>
                                {paymentStatusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>

                            {(value === 'Paid' || value === 'Settled') && (
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                                        Settle Date
                                    </label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <input
                                            type="date"
                                            value={settleDate}
                                            onChange={(e) => setSettleDate(e.target.value)}
                                            style={{
                                                flex: 1,
                                                padding: '12px',
                                                borderRadius: '8px',
                                                border: '1px solid var(--color-border)',
                                                fontSize: '14px'
                                            }}
                                        />
                                        <button
                                            onClick={() => {
                                                const now = new Date();
                                                const yyyy = now.getFullYear();
                                                const mm = String(now.getMonth() + 1).padStart(2, '0');
                                                const dd = String(now.getDate()).padStart(2, '0');
                                                setSettleDate(`${yyyy}-${mm}-${dd}`);
                                            }}
                                            style={{
                                                padding: '0 16px',
                                                borderRadius: '8px',
                                                border: '1px solid var(--color-primary)',
                                                background: 'var(--color-surface)',
                                                color: 'var(--color-primary)',
                                                fontWeight: 500,
                                                cursor: 'pointer',
                                                fontSize: '13px',
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            Now
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={onClose}
                        style={{
                            flex: 1,
                            padding: '12px',
                            borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            background: 'white',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: 500
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={!value || isSubmitting}
                        className="primary-button"
                        style={{
                            flex: 1,
                            padding: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            fontSize: '14px',
                            fontWeight: 600,
                            opacity: (!value || isSubmitting) ? 0.7 : 1,
                            cursor: (!value || isSubmitting) ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {isSubmitting ? 'Updating...' : 'Update Orders'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BulkEditModal;
