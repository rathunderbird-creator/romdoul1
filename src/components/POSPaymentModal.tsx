import React, { useState, useEffect } from 'react';
import { X, Calculator, Banknote, CreditCard, QrCode } from 'lucide-react';
import { useToast } from '../context/ToastContext';

interface POSPaymentModalProps {
    total: number;
    onClose: () => void;
    onConfirm: (paymentMethod: 'Cash' | 'Card' | 'QR' | 'Bank Transfer', amountReceived: number) => void;
}

const POSPaymentModal: React.FC<POSPaymentModalProps> = ({ total, onClose, onConfirm }) => {
    const { showToast } = useToast();
    const [amountReceived, setAmountReceived] = useState<string>('');
    const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Card' | 'QR' | 'Bank Transfer'>('Cash');
    const [change, setChange] = useState<number>(0);

    useEffect(() => {
        const received = parseFloat(amountReceived) || 0;
        setChange(received - total);
    }, [amountReceived, total]);

    const handleConfirm = () => {
        const received = parseFloat(amountReceived) || 0;
        if (received < total && paymentMethod === 'Cash') {
            showToast('Amount received is less than total', 'error');
            return;
        }
        onConfirm(paymentMethod, received);
    };

    const handleQuickAmount = (amount: number) => {
        setAmountReceived(amount.toString());
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200,
            backdropFilter: 'blur(4px)'
        }}>
            <div className="glass-panel" style={{ width: '450px', padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '24px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Calculator size={24} /> Payment
                    </h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                        <X size={24} />
                    </button>
                </div>

                <div style={{ textAlign: 'center', padding: '24px', background: 'var(--color-bg)', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Total Amount</div>
                    <div style={{ fontSize: '48px', fontWeight: 'bold', color: 'var(--color-primary)' }}>${total.toFixed(2)}</div>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '12px', fontSize: '14px', fontWeight: 600 }}>Payment Method</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                        <button
                            onClick={() => setPaymentMethod('Cash')}
                            style={{
                                padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)',
                                background: paymentMethod === 'Cash' ? 'var(--color-primary)' : 'var(--color-surface)',
                                color: paymentMethod === 'Cash' ? 'white' : 'var(--color-text-main)',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer', transition: 'all 0.2s'
                            }}
                        >
                            <Banknote size={24} />
                            <span style={{ fontSize: '13px', fontWeight: 500 }}>Cash</span>
                        </button>
                        <button
                            onClick={() => setPaymentMethod('QR')}
                            style={{
                                padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)',
                                background: paymentMethod === 'QR' ? 'var(--color-primary)' : 'var(--color-surface)',
                                color: paymentMethod === 'QR' ? 'white' : 'var(--color-text-main)',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer', transition: 'all 0.2s'
                            }}
                        >
                            <QrCode size={24} />
                            <span style={{ fontSize: '13px', fontWeight: 500 }}>QR Code</span>
                        </button>
                        <button
                            onClick={() => setPaymentMethod('Card')}
                            style={{
                                padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)',
                                background: paymentMethod === 'Card' ? 'var(--color-primary)' : 'var(--color-surface)',
                                color: paymentMethod === 'Card' ? 'white' : 'var(--color-text-main)',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer', transition: 'all 0.2s'
                            }}
                        >
                            <CreditCard size={24} />
                            <span style={{ fontSize: '13px', fontWeight: 500 }}>Card</span>
                        </button>
                    </div>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 600 }}>Amount Received ($)</label>
                    <input
                        type="number"
                        value={amountReceived}
                        onChange={e => setAmountReceived(e.target.value)}
                        placeholder="0.00"
                        className="search-input"
                        style={{ width: '100%', fontSize: '24px', padding: '16px', fontWeight: 'bold' }}
                        autoFocus
                    />
                    {paymentMethod === 'Cash' && (
                        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
                            {[10, 20, 50, 100].map(amt => (
                                <button
                                    key={amt}
                                    onClick={() => handleQuickAmount(amt)}
                                    style={{
                                        padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--color-border)',
                                        background: 'var(--color-surface)', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap'
                                    }}
                                >
                                    ${amt}
                                </button>
                            ))}
                            <button
                                onClick={() => handleQuickAmount(total)}
                                style={{
                                    padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--color-border)',
                                    background: 'var(--color-surface)', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap'
                                }}
                            >
                                Exact
                            </button>
                        </div>
                    )}
                </div>

                {paymentMethod === 'Cash' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: change < 0 ? '#FEE2E2' : '#D1FAE5', borderRadius: '8px', color: change < 0 ? '#DC2626' : '#059669' }}>
                        <span style={{ fontWeight: 600 }}>Change</span>
                        <span style={{ fontSize: '20px', fontWeight: 'bold' }}>${Math.max(0, change).toFixed(2)}</span>
                    </div>
                )}

                <button
                    onClick={handleConfirm}
                    className="primary-button"
                    style={{ width: '100%', padding: '16px', fontSize: '18px', display: 'flex', justifyContent: 'center', gap: '12px' }}
                >
                    <Banknote size={20} />
                    Confirm Payment
                </button>
            </div>
        </div>
    );
};

export default POSPaymentModal;
