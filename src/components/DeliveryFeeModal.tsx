import React, { useEffect, useMemo, useState } from 'react';
import { X, Truck, CheckCircle2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useAccounting } from '../hooks/useAccounting';
import type { Sale } from '../types';

interface DeliveryFeeModalProps {
    order: Sale | null;
    onClose: () => void;
    onConfirm: (fee: { amount: number; method: string; date: string; depositAccountId?: string; depositAccountName?: string }) => void;
}

const today = () => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

// Records a cancelled order's delivery-fee-only payment (paymentStatus
// 'PdFee') — the order itself isn't fulfilled, but the customer paid for
// delivery, and that gets booked straight to Revenue (not the order total).
const DeliveryFeeModal: React.FC<DeliveryFeeModalProps> = ({ order, onClose, onConfirm }) => {
    const { paymentMethods } = useStore();
    const { accounts, fetchAccounts } = useAccounting();
    const [amount, setAmount] = useState<number | string>('');
    const [method, setMethod] = useState('');
    const [date, setDate] = useState(today());
    const [depositAccountId, setDepositAccountId] = useState('');

    useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

    // Cash/bank ledger accounts for "Received into" — same filter as Deposit's
    // and the Settle Payment flow's own account picker.
    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)),
        [accounts]
    );

    useEffect(() => {
        if (order) {
            // Re-opening an already-PdFee order (to correct it) prefills from
            // the same generic fields Paid/Deposit already reuse for this.
            setAmount(order.paymentStatus === 'PdFee' && order.amountReceived ? order.amountReceived : '');
            const bank = paymentMethods.find(m => m.toLowerCase().includes('bank'));
            setMethod(order.paymentStatus === 'PdFee' && order.paymentMethod ? order.paymentMethod : (bank || paymentMethods[0] || 'Bank'));
            setDate(order.paymentStatus === 'PdFee' && order.settleDate ? order.settleDate.slice(0, 10) : today());
            const bankAccount = paymentAccounts.find(a => a.account_name.toLowerCase().includes('bank'));
            setDepositAccountId(order.paymentStatus === 'PdFee' && order.depositAccountId ? order.depositAccountId : (bankAccount?.id || paymentAccounts[0]?.id || ''));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order, paymentAccounts]);

    if (!order) return null;

    const amt = Number(amount) || 0;
    const valid = amt > 0 && !(paymentAccounts.length > 0 && !depositAccountId);

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: '20px', width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(14,116,144,0.08), rgba(103,232,249,0.04))' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: 'linear-gradient(135deg, #0E7490, #22D3EE)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                            <Truck size={19} />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Paid for Delivery Fee</h2>
                            <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '1px 0 0 0' }}>{order.customer?.name || 'Customer'} · Order total ${order.total.toFixed(2)}</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '30px', height: '30px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={17} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                        <label style={labelStyle}>Delivery Fee Amount ($) *</label>
                        <input type="number" autoFocus min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inputStyle, fontSize: '16px', fontWeight: 600 }} placeholder="e.g. 1.50" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={labelStyle}>Pay By</label>
                            <select value={method} onChange={e => setMethod(e.target.value)} style={inputStyle}>
                                {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Date</label>
                            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
                        </div>
                    </div>
                    <div>
                        <label style={labelStyle}>Received into *</label>
                        <select
                            value={depositAccountId}
                            onChange={e => setDepositAccountId(e.target.value)}
                            style={{ ...inputStyle, border: `1px solid ${paymentAccounts.length > 0 && !depositAccountId ? '#DC2626' : 'var(--color-border)'}` }}
                        >
                            <option value="">Bank or cash account…</option>
                            {paymentAccounts.map(a => (
                                <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>
                            ))}
                        </select>
                        {paymentAccounts.length === 0 && (
                            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                No cash or bank accounts in the Chart of Accounts yet — the fee saves without one.
                            </div>
                        )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '8px 10px' }}>
                        The order is treated as cancelled — only this delivery fee is posted straight to Revenue (account 4005 · Delivery Fee Revenue), not the order total.
                    </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button className="secondary-button" onClick={onClose} style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600 }}>Cancel</button>
                    <button
                        className="primary-button"
                        disabled={!valid}
                        onClick={() => {
                            const depositAccountName = paymentAccounts.find(a => a.id === depositAccountId)?.account_name;
                            onConfirm({
                                amount: amt,
                                method,
                                date,
                                depositAccountId: depositAccountId || undefined,
                                depositAccountName
                            });
                        }}
                        style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600, background: '#0E7490', opacity: valid ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <CheckCircle2 size={16} /> Save
                    </button>
                </div>
            </div>
        </div>
    );
};

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' };

export default DeliveryFeeModal;
