import React, { useEffect, useMemo, useState } from 'react';
import { X, FileCheck2, CheckCircle2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { Sale } from '../types';
import MoneyInput from './MoneyInput';
import { useMoneyField } from '../hooks/useMoneyField';
import { useAccounting } from '../hooks/useAccounting';
import { type MoneyMeta } from '../utils/currency';
import { defaultCodHolderFor, isCodDeliverymanAccount } from '../utils/cashBankAccounts';
import { useTx } from './useTx';

interface GetFileModalProps {
    order: Sale | null;
    // The status being entered (the popup's title): Get File or Collected.
    status?: 'Get File' | 'Collected';
    onClose: () => void;
    // collectUsd: what the courier collects (total − deposit), in USD;
    // money carries the riel amount and rate when it was typed in riel;
    // method (Collected only): the order's Pay By — how the courier will
    // remit (Cash, Bank, …). Absent when left unset.
    // holder (Collected only, shown when the chart has a 1220 deliveryman
    // receivable): who holds the money — 'courier' books the receipt to
    // 1210, 'deliveryman' to 1220. Absent when the store has no choice.
    onConfirm: (data: { collectUsd: number; money: MoneyMeta; method?: string; holder?: 'courier' | 'deliveryman' }) => void;
}

// Moving an order to Get File: the courier collects the order's money, so
// the amount to collect is asked first (a courier ticked in Sales Setup gets
// that amount booked as COD receivable the moment the order enters Get File).
// A changed amount changes the order's total, the difference going into the
// discount — the same rule as the Settle form's Received Amount.
const GetFileModal: React.FC<GetFileModalProps> = ({ order, status = 'Get File', onClose, onConfirm }) => {
    const { khrExchangeRate, paymentMethods, salesSettings } = useStore();
    const tx = useTx();
    const field = useMoneyField({ shopRate: khrExchangeRate });
    // Collected only: the order's Pay By (how the courier will remit).
    // '' = left unset — the save then says nothing about the method.
    const [method, setMethod] = useState('');
    // Who holds the money (Collected only): courier -> receivable 1210,
    // deliveryman -> 1220. Offered only when the chart has a deliveryman
    // receivable (1220 "COD receivable (Deliveryman)").
    const [holder, setHolder] = useState<'courier' | 'deliveryman'>('courier');
    // A pick made in this opening stands; only the automatic default moves.
    const [holderTouched, setHolderTouched] = useState(false);
    const { accounts, fetchAccounts } = useAccounting();
    const hasDeliveryman = useMemo(
        () => accounts.some(a => a.is_active && a.account_type === 'Asset' && isCodDeliverymanAccount(a)),
        [accounts]
    );

    useEffect(() => {
        if (!order) return;
        const due = Math.max(0, (Number(order.total) || 0) - (order.depositAmount || 0));
        // An order with a riel price (customKhrAmount) opens in riel.
        field.reset(order.customKhrAmount
            ? { amount: Math.round(Number(order.customKhrAmount)), currency: 'KHR' }
            : { amount: due.toFixed(2), currency: 'USD' });
        setMethod(order.paymentMethod && paymentMethods.includes(order.paymentMethod) ? order.paymentMethod : '');
        setHolder(order.codHolder === 'deliveryman' ? 'deliveryman' : 'courier');
        setHolderTouched(false);
        if (status === 'Collected') void fetchAccounts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order]);

    // An order with no stored holder opens on Sales Setup's pick (Sales
    // Payment › Collected / Get File) once the accounts arrive — the
    // configured deliveryman receivable makes Deliveryman the default.
    useEffect(() => {
        if (!order || status !== 'Collected' || holderTouched || order.codHolder) return;
        setHolder(defaultCodHolderFor(salesSettings, accounts));
    }, [order, status, holderTouched, accounts, salesSettings]);

    if (!order) return null;

    const deposit = order.depositAmount || 0;
    const amt = field.usd;
    const valid = Number.isFinite(amt) && amt >= 0 && field.amount !== '' && !field.rateInvalid;

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: '20px', width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
                <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(29,78,216,0.08), rgba(147,197,253,0.06))' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: 'linear-gradient(135deg, #1D4ED8, #60A5FA)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                            <FileCheck2 size={19} />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>{status === 'Collected' ? tx('dashboard2.pay.Collected', 'Collected') : tx('ui.components.getFile.title', 'Get File')}</h2>
                            <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '1px 0 0 0' }}>
                                {order.customer?.name || tx('ui.components.common.customer', 'Customer')}
                                {order.shipping?.company ? ` · ${tx('ui.components.getFile.shippedBy', 'Shipped by')} ${order.shipping.company}` : ''}
                                {' · '}{tx('ui.components.deliveryFee.orderTotal', 'Order total')} ${(Number(order.total) || 0).toFixed(2)}
                                {deposit > 0 ? ` · ${tx('ui.components.getFile.deposit', 'Deposit')} $${deposit.toFixed(2)}` : ''}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '30px', height: '30px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={17} />
                    </button>
                </div>

                <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <MoneyInput
                        field={field}
                        label={tx('ui.components.getFile.amount', 'Amount the courier collects')}
                        required
                        autoFocus
                        allowKhr
                        labelStyle={labelStyle}
                        inputStyle={inputStyle}
                    />
                    {status === 'Collected' && hasDeliveryman && (
                        <div>
                            <label style={labelStyle}>{tx('ui.components.getFile.holder', 'Money held by')}</label>
                            <select value={holder} onChange={e => { setHolder(e.target.value === 'deliveryman' ? 'deliveryman' : 'courier'); setHolderTouched(true); }} style={inputStyle}>
                                <option value="courier">{tx('ui.components.getFile.holderCourier', 'Courier (shipping company) — 1210')}</option>
                                <option value="deliveryman">{tx('ui.components.getFile.holderDeliveryman', 'Deliveryman — 1220')}</option>
                            </select>
                        </div>
                    )}
                    {status === 'Collected' && (
                        <div>
                            <label style={labelStyle}>{tx('ui.components.getFile.method', 'Method (Cash/Bank)')}</label>
                            <select value={method} onChange={e => setMethod(e.target.value)} style={inputStyle}>
                                <option value="">{tx('ui.components.getFile.methodNone', 'Not set — choose at remittance')}</option>
                                {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '8px 10px' }}>
                        {tx('ui.components.getFile.note', 'A different amount changes the order total (the difference goes into the discount). Cash or bank, riel or dollar, is chosen when the courier remits, in Accounting › COD Remittances.')}
                    </div>
                </div>

                <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button className="secondary-button" onClick={onClose} style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600 }}>{tx('common.cancel', 'Cancel')}</button>
                    <button
                        className="primary-button"
                        disabled={!valid}
                        onClick={() => {
                            if (!field.confirmIfSuspicious()) return;
                            onConfirm({
                                collectUsd: Math.round(amt * 100) / 100, money: field.meta,
                                ...(status === 'Collected' && method ? { method } : {}),
                                ...(status === 'Collected' && hasDeliveryman ? { holder } : {}),
                            });
                        }}
                        style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600, background: '#1D4ED8', opacity: valid ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '8px' }}
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

export default GetFileModal;
