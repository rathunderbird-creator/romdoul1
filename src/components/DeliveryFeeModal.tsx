import React, { useEffect, useMemo, useState } from 'react';
import { X, Truck, CheckCircle2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useAccounting } from '../hooks/useAccounting';
import type { PaidMoney, PaymentClaim, Sale } from '../types';
import MoneyInput from './MoneyInput';
import { useAccountCurrency, useMoneyField } from '../hooks/useMoneyField';
import CashBankOptions from './CashBankOptions';
import { defaultCashBankAccountId, depositDefaultFor, followMethodAccount } from '../utils/cashBankAccounts';
import { accountCurrency, rielToReopen, usdToKhr, type MoneyMeta } from '../utils/currency';
import { useTx } from './useTx';

// The most a delivery fee plausibly is, in USD: above it the field warns
// (the Romdoul2 incident: a $2 fee typed as 8000 riel was booked as $8,000).
const DELIVERY_FEE_MAX_PLAUSIBLE_USD = 15;

interface DeliveryFeeModalProps {
    order: Sale | null;
    onClose: () => void;
    // amount is USD; money carries the riel amount and rate when paid in riel.
    onConfirm: (fee: { amount: number; method: string; date: string; depositAccountId?: string; depositAccountName?: string; money: MoneyMeta }) => void;
    // The fee already booked, as it was received (its income row):
    // re-opening the form starts in that currency, on an account in it.
    paid?: PaidMoney;
    // A Salesman's unconfirmed PdFee claim: the form opens prefilled from
    // it (amount, method, date, riel) for the confirmer — saving books it.
    claim?: PaymentClaim;
}

const today = () => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

// Records a cancelled order's delivery-fee-only payment (paymentStatus
// 'PdFee') — the order itself isn't fulfilled, but the customer paid for
// delivery, and that gets booked straight to Revenue (not the order total).
const DeliveryFeeModal: React.FC<DeliveryFeeModalProps> = ({ order, onClose, onConfirm, paid, claim }) => {
    const { paymentMethods, khrExchangeRate, salesSettings } = useStore();
    // Sales Setup's default deposit accounts (USD / riel).
    const defUsd = depositDefaultFor(salesSettings, 'USD', 'PdFee');
    const defKhr = depositDefaultFor(salesSettings, 'KHR', 'PdFee');
    const { accounts, fetchAccounts } = useAccounting();
    const tx = useTx();
    const field = useMoneyField({ shopRate: khrExchangeRate, maxPlausibleUsd: DELIVERY_FEE_MAX_PLAUSIBLE_USD });
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
            // the same generic fields Paid/Deposit already reuse for this; a
            // Salesman's unconfirmed claim prefills the confirmer's opening.
            const fromClaim = claim && order.paymentStatus !== 'PdFee' ? claim : undefined;
            const bank = paymentMethods.find(m => m.toLowerCase().includes('bank'));
            setMethod(order.paymentStatus === 'PdFee' && order.paymentMethod ? order.paymentMethod
                : (fromClaim?.method && paymentMethods.includes(fromClaim.method) ? fromClaim.method : '') || bank || paymentMethods[0] || 'Bank');
            setDate(order.paymentStatus === 'PdFee' && order.settleDate ? order.settleDate.slice(0, 10) : (fromClaim?.date || today()));
            // Bank first, as the Pay By above; never a riel account by default
            // (a fee the Salesman claimed in riel starts on a riel account,
            // when there is one). A fee already booked reopens in the currency
            // it was received in, on an account in that currency (the one it
            // went into, when it still is).
            const claimRiel = fromClaim?.currency === 'KHR' && (fromClaim.original_amount || 0) > 0;
            const preferredId = order.paymentStatus === 'PdFee' ? order.depositAccountId : undefined;
            const booked = order.paymentStatus === 'PdFee' ? paid : undefined;
            const startMethod = order.paymentStatus === 'PdFee' && order.paymentMethod ? order.paymentMethod
                : (fromClaim?.method && paymentMethods.includes(fromClaim.method) ? fromClaim.method : '') || bank || paymentMethods[0] || 'Bank';
            const accountId = (claimRiel ? defaultCashBankAccountId(paymentAccounts, { currency: 'KHR', defaultId: defKhr, method: startMethod }) : '')
                || (booked ? defaultCashBankAccountId(paymentAccounts, { currency: booked.currency, preferredId, defaultId: booked.currency === 'KHR' ? defKhr : defUsd, method: startMethod }) : '')
                || defaultCashBankAccountId(paymentAccounts, { preferredId, defaultId: defUsd, method: startMethod });
            setDepositAccountId(accountId);
            // A correction of a fee in a riel account reopens in riel.
            const cur = accountCurrency(paymentAccounts.find(a => a.id === accountId));
            const prev = order.paymentStatus === 'PdFee' && order.amountReceived ? order.amountReceived
                : fromClaim ? fromClaim.amount : '';
            field.reset(cur === 'KHR'
                ? (claimRiel
                    ? { amount: fromClaim!.original_amount!, currency: 'KHR', rate: fromClaim!.exchange_rate || field.shopRate }
                    : booked?.currency === 'KHR' && prev !== ''
                        // The riel received, at its own rate.
                        ? { amount: rielToReopen(booked.original_amount, booked.exchange_rate, Number(prev)), currency: 'KHR', rate: booked.exchange_rate }
                        : { amount: prev === '' ? '' : usdToKhr(Number(prev), field.shopRate), currency: 'KHR' })
                : { amount: prev, currency: 'USD' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order, paymentAccounts, paid]);

    const coupling = useAccountCurrency(field, paymentAccounts, depositAccountId, setDepositAccountId, { usd: defUsd, khr: defKhr });

    if (!order) return null;

    const amt = field.usd;
    const valid = amt > 0 && !field.rateInvalid && !(paymentAccounts.length > 0 && !depositAccountId);

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
                            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>{tx('ui.components.payStatus.pdFeeTitle', 'Paid for Delivery Fee')}</h2>
                            <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '1px 0 0 0' }}>{order.customer?.name || tx('ui.components.common.customer', 'Customer')} · {tx('ui.components.deliveryFee.orderTotal', 'Order total')} ${order.total.toFixed(2)}</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '30px', height: '30px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={17} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {claim && order.paymentStatus !== 'PdFee' && (
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '8px 10px', lineHeight: 1.5 }}>
                            {claim.by
                                ? tx('ui.components.deliveryFee.confirmingBy', 'Confirming the delivery fee {by} entered on {date}. Check it arrived, correct anything that differs, then save: that books it.', { by: claim.by, date: claim.date || '' })
                                : tx('ui.components.deliveryFee.confirming', 'Confirming the delivery fee entered. Check it arrived, correct anything that differs, then save: that books it.')}
                        </div>
                    )}
                    <MoneyInput
                        field={field}
                        label={tx('ui.components.deliveryFee.amount', 'Delivery Fee Amount')}
                        required
                        autoFocus
                        allowKhr
                        placeholder={field.currency === 'KHR' ? tx('ui.components.common.eg', 'e.g. {v}', { v: '8000' }) : tx('ui.components.common.eg', 'e.g. {v}', { v: '1.50' })}
                        onToggleCurrency={coupling.onToggleCurrency}
                        khrUnavailableReason={coupling.khrUnavailableReason}
                        labelStyle={labelStyle}
                        inputStyle={inputStyle}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={labelStyle}>{tx('orders.payBy', 'Pay By')}</label>
                            <select value={method} onChange={e => {
                                const m = e.target.value;
                                const next = followMethodAccount(paymentAccounts, depositAccountId, method, m, { currency: field.currency, defaultId: field.currency === 'KHR' ? defKhr : defUsd });
                                setMethod(m);
                                if (next) setDepositAccountId(next);
                            }} style={inputStyle}>
                                {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>{tx('orders.date', 'Date')}</label>
                            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
                        </div>
                    </div>
                    <div>
                        <label style={labelStyle}>{tx('ui.components.common.receivedInto', 'Received into')} *</label>
                        <select
                            value={depositAccountId}
                            onChange={e => coupling.onAccountChange(e.target.value)}
                            style={{ ...inputStyle, border: `1px solid ${paymentAccounts.length > 0 && !depositAccountId ? '#DC2626' : 'var(--color-border)'}` }}
                        >
                            <option value="">{tx('ui.components.common.bankOrCash', 'Bank or cash account…')}</option>
                            <CashBankOptions accounts={paymentAccounts} />
                        </select>
                        {paymentAccounts.length === 0 && (
                            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                {tx('ui.components.deliveryFee.noAccounts', 'No cash or bank accounts in the Chart of Accounts yet — the fee saves without one.')}
                            </div>
                        )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '8px 10px' }}>
                        {tx('ui.components.deliveryFee.note', 'The order is treated as cancelled — only this delivery fee is posted straight to Revenue (account 4005 · Delivery Fee Revenue), not the order total.')}
                    </div>
                </div>

                {/* Footer */}
                <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button className="secondary-button" onClick={onClose} style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600 }}>{tx('common.cancel', 'Cancel')}</button>
                    <button
                        className="primary-button"
                        disabled={!valid}
                        onClick={() => {
                            // A dollar field given a riel-sized figure (or the
                            // other way round) asks first, showing both readings.
                            if (!field.confirmIfSuspicious()) return;
                            const depositAccountName = paymentAccounts.find(a => a.id === depositAccountId)?.account_name;
                            onConfirm({
                                amount: amt,
                                method,
                                date,
                                depositAccountId: depositAccountId || undefined,
                                depositAccountName,
                                money: field.meta,
                            });
                        }}
                        style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600, background: '#0E7490', opacity: valid ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <CheckCircle2 size={16} /> {tx('common.save', 'Save')}
                    </button>
                </div>
            </div>
        </div>
    );
};

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' };

export default DeliveryFeeModal;
