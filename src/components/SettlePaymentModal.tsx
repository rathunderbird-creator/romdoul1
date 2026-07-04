import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import { useStore } from '../context/StoreContext';

interface SettlePaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (data: { paymentMethod: string; settleDate: string }) => void;
    initialMethod?: string;
    initialDate?: string;
    title?: string;
    description?: string;
}

const SettlePaymentModal: React.FC<SettlePaymentModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    initialMethod,
    initialDate,
    title = "Settle Payment",
    description = "Please confirm the settle date and payment method."
}) => {
    const { paymentMethods } = useStore();
    const [selectedMethod, setSelectedMethod] = useState<string>('');
    const [settleDate, setSettleDate] = useState<string>('');

    useEffect(() => {
        if (isOpen) {
            setSelectedMethod(initialMethod || paymentMethods[0] || 'Cash');
            setSettleDate(initialDate ? new Date(initialDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
        }
    }, [isOpen, initialMethod, initialDate, paymentMethods]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    {description}
                </p>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Settle Date <span style={{ color: 'red' }}>*</span></label>
                    <input
                        type="date"
                        value={settleDate}
                        onChange={(e) => setSettleDate(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none', boxSizing: 'border-box'
                        }}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Pay By <span style={{ color: 'red' }}>*</span></label>
                    <select
                        value={selectedMethod}
                        onChange={(e) => setSelectedMethod(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none', boxSizing: 'border-box'
                        }}
                    >
                        {paymentMethods.map(method => (
                            <option key={method} value={method}>{method}</option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer',
                            fontSize: '14px', fontWeight: 500
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            // Ensure time is preserved, or just set to noon if we only care about the date
                            // Default behavior for <input type="date"> is YYYY-MM-DD
                            onConfirm({ paymentMethod: selectedMethod, settleDate: new Date(settleDate).toISOString() });
                            onClose();
                        }}
                        className="primary-button"
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: 'none',
                            background: 'var(--color-primary)',
                            color: 'white', cursor: 'pointer',
                            fontSize: '14px', fontWeight: 500
                        }}
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default SettlePaymentModal;
