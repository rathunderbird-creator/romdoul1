import React, { useState, useMemo, useEffect, useRef } from 'react';
import Modal from './Modal';
import { useStore } from '../context/StoreContext';
import { useAccounting } from '../hooks/useAccounting';
import { dayKeyFromDate } from '../utils/dateRange';
import MoneyInput from './MoneyInput';
import CashBankOptions from './CashBankOptions';
import { useAccountCurrency, useMoneyField } from '../hooks/useMoneyField';
import { accountCurrency, khrToUsd, usdToKhr, type MoneyMeta } from '../utils/currency';

interface RecordCustomerPaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (data: {
        amount: number;
        paymentDate: string;
        paymentMethod: string;
        receivedInAccountId?: string;
        receivedInAccountName?: string;
        notes?: string;
        // The riel received (amount is its USD).
        money?: MoneyMeta;
    }) => void | Promise<void>;
    // The order's current outstanding balance — prefills Amount and the
    // quick-fill percent buttons.
    remainingBalance: number;
    customerName?: string;
    title?: string;
}

const QUICK_FILLS = [
    { label: 'Full', pct: 1, color: '#10b981' },
    { label: '75%', pct: 0.75, color: '#3b82f6' },
    { label: '50%', pct: 0.5, color: '#f59e0b' },
    { label: '25%', pct: 0.25, color: '#8b5cf6' },
] as const;

const labelStyle: React.CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' };
const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
    background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
    outline: 'none', boxSizing: 'border-box',
};

// Shared "Record Payment" form for a wholesale order — same fields and the
// same recordCustomerPayment() shape WholesaleOrdersPage used to hand-roll
// inline, factored out so Wholesale Payments doesn't become a second copy
// (mirror of RecordSupplierPaymentModal on the purchasing side).
const RecordCustomerPaymentModal: React.FC<RecordCustomerPaymentModalProps> = ({
    isOpen, onClose, onConfirm, remainingBalance, customerName, title = 'Record Payment',
}) => {
    const { wholesaleSettings, khrExchangeRate } = useStore();
    const { accounts, fetchAccounts } = useAccounting();
    // The balance caps the payment (the database refuses more), so a figure
    // above it is a typo (riel); the warning says so before the refusal.
    const field = useMoneyField({ shopRate: khrExchangeRate, maxPlausibleUsd: remainingBalance > 0 ? remainingBalance : null });
    const [paymentDate, setPaymentDate] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('Bank Transfer');
    const [accountId, setAccountId] = useState('');
    const [notes, setNotes] = useState('');
    const initializedRef = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);

    useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)),
        [accounts]
    );

    // Initialize once per open, so accounts arriving later never wipe edits.
    useEffect(() => {
        if (!isOpen) { initializedRef.current = false; return; }
        if (initializedRef.current) return;
        initializedRef.current = true;
        const remaining = remainingBalance > 0 ? remainingBalance : 0;
        setPaymentDate(dayKeyFromDate(new Date()));
        setPaymentMethod('Bank Transfer');
        setNotes('');
        const def = wholesaleSettings.defaultPaymentAccountId;
        const id = def && paymentAccounts.some(a => a.id === def) ? def : '';
        setAccountId(id);
        // A riel default account opens in riel.
        const inRiel = accountCurrency(paymentAccounts.find(a => a.id === id)) === 'KHR';
        field.reset(inRiel ? { amount: remaining ? usdToKhr(remaining, field.shopRate) : '', currency: 'KHR' } : { amount: remaining || 0, currency: 'USD' });
        // field.reset follows the shop rate only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, remainingBalance, wholesaleSettings.defaultPaymentAccountId, paymentAccounts]);

    const coupling = useAccountCurrency(field, paymentAccounts, accountId, setAccountId);
    const rate = Number(field.rate) > 0 ? Number(field.rate) : field.shopRate;
    // Riel within 3 cents of the whole balance settles exactly the balance.
    const amount = field.currency === 'KHR' && remainingBalance > 0 && Math.abs(khrToUsd(field.typed, rate) - remainingBalance) <= 0.03
        ? remainingBalance : field.usd;

    // More than the balance would over-credit the receivable (the database
    // refuses it too).
    const overBalance = remainingBalance > 0 && Number(amount) > remainingBalance + 0.005;
    const canRecord = Number(amount) > 0 && !overBalance && !field.rateInvalid && !(paymentAccounts.length > 0 && !accountId);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {customerName && (
                    <div>
                        <label style={labelStyle}>Customer</label>
                        <div style={{ ...inputStyle, background: 'var(--color-bg)' }}>{customerName}</div>
                    </div>
                )}
                {remainingBalance > 0 && (
                    <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)', borderRadius: '10px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Remaining Balance</span>
                        <span style={{ fontSize: '18px', fontWeight: 700, color: '#ef4444' }}>
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(remainingBalance)}
                        </span>
                    </div>
                )}
                <div>
                    <MoneyInput
                        field={field}
                        label="Amount to Pay"
                        required
                        allowKhr
                        onToggleCurrency={coupling.onToggleCurrency}
                        khrUnavailableReason={coupling.khrUnavailableReason}
                        labelStyle={labelStyle}
                        inputStyle={{ ...inputStyle, fontSize: '16px', fontWeight: 600, border: `1px solid ${Number(amount) <= 0 || overBalance ? 'red' : 'var(--color-border)'}` }}
                    />
                    {overBalance && (
                        <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '6px' }}>
                            More than the remaining balance — enter at most {remainingBalance.toFixed(2)}.
                        </div>
                    )}
                    {remainingBalance > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '10px' }}>
                            {QUICK_FILLS.map(({ label, pct, color }) => {
                                const val = Math.round(remainingBalance * pct * 100) / 100;
                                const active = Math.abs(Number(amount) - val) < 0.005;
                                return (
                                    <button
                                        key={label}
                                        type="button"
                                        onClick={() => field.setAmount(String(field.currency === 'KHR' ? usdToKhr(val, rate) : val))}
                                        style={{
                                            padding: '8px 6px', fontSize: '12px', fontWeight: 700, borderRadius: '8px',
                                            border: `1px solid ${active ? color : 'var(--color-border)'}`,
                                            background: active ? color : 'var(--color-surface)',
                                            color: active ? 'white' : color,
                                            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                                        }}
                                    >
                                        <span>{label}</span>
                                        <span style={{ fontSize: '10px', opacity: 0.85 }}>${val.toFixed(2)}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div>
                        <label style={labelStyle}>Payment Date <span style={{ color: 'red' }}>*</span></label>
                        <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>Method</label>
                        <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            <option value="Cash">Cash</option>
                            <option value="Bank Transfer">Bank Transfer</option>
                            <option value="Credit Card">Credit Card</option>
                            <option value="Cheque">Cheque</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label style={labelStyle}>Received into {paymentAccounts.length > 0 && <span style={{ color: 'red' }}>*</span>}</label>
                    <select
                        className="d2-khmer"
                        value={accountId}
                        onChange={e => coupling.onAccountChange(e.target.value)}
                        style={{ ...inputStyle, cursor: 'pointer', border: `1px solid ${paymentAccounts.length > 0 && !accountId ? 'red' : 'var(--color-border)'}` }}
                    >
                        <option value="">Bank or cash account…</option>
                        <CashBankOptions accounts={paymentAccounts} />
                    </select>
                    {paymentAccounts.length === 0 && (
                        <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                            No cash or bank accounts in the Chart of Accounts yet — the payment saves without one.
                        </div>
                    )}
                </div>
                <div>
                    <label style={labelStyle}>Notes</label>
                    <textarea
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        placeholder="Optional notes…"
                        style={{ ...inputStyle, minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }}
                    />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                    <button
                        onClick={onClose}
                        style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={async () => {
                            // Closing is the caller's call, not ours: onConfirm's save is
                            // async and can fail (bad account, network, etc.) — closing
                            // here unconditionally would hide that failure and discard
                            // everything just typed.
                            if (!canRecord || submittingRef.current) return;
                            if (!field.confirmIfSuspicious()) return;
                            submittingRef.current = true;
                            setSubmitting(true);
                            const acc = paymentAccounts.find(a => a.id === accountId);
                            try {
                                await onConfirm({
                                    amount: Number(amount),
                                    paymentDate,
                                    paymentMethod,
                                    receivedInAccountId: accountId || undefined,
                                    receivedInAccountName: acc?.account_name,
                                    notes: notes.trim() || undefined,
                                    money: field.meta,
                                });
                            } finally {
                                submittingRef.current = false;
                                setSubmitting(false);
                            }
                        }}
                        disabled={!canRecord || submitting}
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: 'none',
                            background: canRecord && !submitting ? 'var(--color-primary)' : 'var(--color-border)',
                            color: canRecord && !submitting ? 'white' : 'var(--color-text-muted)',
                            cursor: canRecord && !submitting ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: 600,
                        }}
                    >
                        {submitting ? 'Saving…' : 'Record Payment'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default RecordCustomerPaymentModal;
