import React, { useEffect, useState } from 'react';
import { X, Wallet, CheckCircle2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { Sale } from '../types';

interface DepositModalProps {
    order: Sale | null;
    onClose: () => void;
    onConfirm: (deposit: { amount: number; method: string; date: string }) => void;
}

const today = () => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

// Records the upfront deposit for a retail order (rest is collected via COD).
const DepositModal: React.FC<DepositModalProps> = ({ order, onClose, onConfirm }) => {
    const { paymentMethods } = useStore();
    const [amount, setAmount] = useState<number | string>('');
    const [method, setMethod] = useState('');
    const [date, setDate] = useState(today());

    useEffect(() => {
        if (order) {
            setAmount(order.depositAmount && order.depositAmount > 0 ? order.depositAmount : '');
            const bank = paymentMethods.find(m => m.toLowerCase().includes('bank'));
            setMethod(order.depositMethod || bank || paymentMethods[0] || 'Bank');
            setDate(order.depositDate ? order.depositDate.slice(0, 10) : today());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order]);

    if (!order) return null;

    const amt = Number(amount) || 0;
    const remaining = Math.max(0, (order.total || 0) - amt);
    const valid = amt > 0 && amt < (order.total || 0);

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: '20px', width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(126,34,206,0.06), rgba(168,85,247,0.03))' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: 'linear-gradient(135deg, #7e22ce, #a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                            <Wallet size={19} />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Record Deposit</h2>
                            <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '1px 0 0 0' }}>{order.customer?.name || 'Customer'} · Total ${order.total.toFixed(2)}</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '30px', height: '30px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={17} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                        <label style={labelStyle}>Deposit Amount ($) *</label>
                        <input type="number" autoFocus min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inputStyle, fontSize: '16px', fontWeight: 600 }} placeholder="e.g. 2.00" />
                        {amt > 0 && (
                            <div style={{ marginTop: '6px', fontSize: '12px', color: amt >= (order.total || 0) ? '#DC2626' : 'var(--color-text-secondary)' }}>
                                {amt >= (order.total || 0)
                                    ? 'Deposit must be less than the order total — use Paid for full payment.'
                                    : <>Remaining via COD: <strong style={{ color: '#DC2626' }}>${remaining.toFixed(2)}</strong></>}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={labelStyle}>Pay By</label>
                            <select value={method} onChange={e => setMethod(e.target.value)} style={inputStyle}>
                                {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Deposit Date</label>
                            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
                        </div>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '8px 10px' }}>
                        The deposit is logged as income now (កក់ប្រាក់) and is always kept, even if the order is cancelled later. When the order is marked Paid, only the COD remainder is added to income.
                    </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button className="secondary-button" onClick={onClose} style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600 }}>Cancel</button>
                    <button
                        className="primary-button"
                        disabled={!valid}
                        onClick={() => onConfirm({ amount: amt, method, date })}
                        style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600, background: '#7e22ce', opacity: valid ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <CheckCircle2 size={16} /> Save Deposit
                    </button>
                </div>
            </div>
        </div>
    );
};

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' };

export default DepositModal;
