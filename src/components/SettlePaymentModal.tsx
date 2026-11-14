import React, { useState, useEffect, useMemo } from 'react';
import Modal from './Modal';
import { useStore } from '../context/StoreContext';
import { useAccounting } from '../hooks/useAccounting';
import { dayKeyFromDate } from '../utils/dateRange';
import MoneyInput from './MoneyInput';
import CashBankOptions from './CashBankOptions';
import { useMoneyField } from '../hooks/useMoneyField';
import { counterpartAccount, defaultCashBankAccountId } from '../utils/cashBankAccounts';
import { accountCurrency, formatUsd, isKhrAccountName, usdToKhr, type MoneyMeta } from '../utils/currency';

// Local calendar day as YYYY-MM-DD, `daysAgo` days back. Steps by calendar day
// (not 24h) so a daylight-saving change can't land on the wrong date.
const localYMD = (daysAgo = 0): string => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface SettlePaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    // depositAccountId/depositAccountName name the cash/bank ledger account the
    // settlement lands in — the caller passes them (with postToLedger) to
    // updateOrder so settling also books the receipt, instead of leaving the
    // entry for a later manual Record Receipt on Customer Payment. They stay
    // optional: an instance with no cash/bank accounts settles without them.
    // money: the riel received, when the settlement came in riel (the order's
    // USD is still what is booked; the riel amount and rate are recorded
    // with it).
    onConfirm: (data: { paymentMethod: string; settleDate: string; depositAccountId?: string; depositAccountName?: string; money?: MoneyMeta }) => void;
    // What this settlement books in USD (total − deposit), and the riel the
    // shop expected to collect (sales.custom_khr_amount) — both optional;
    // without amountDue the riel option is not offered.
    amountDue?: number;
    khrExpected?: number;
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
    amountDue,
    khrExpected,
    title = "Settle Payment",
    description = "Please confirm the settle date and payment method."
}) => {
    const { paymentMethods, khrExchangeRate } = useStore();
    // The riel actually received (only when the account / toggle says riel).
    const rielField = useMoneyField({ shopRate: khrExchangeRate, snapToUsd: amountDue ?? null, init: { currency: 'KHR' } });
    const { accounts, fetchAccounts } = useAccounting();
    const [selectedMethod, setSelectedMethod] = useState<string>('');
    const [settleDate, setSettleDate] = useState<string>('');
    const [depositAccountId, setDepositAccountId] = useState<string>('');
    // Confirm stays disabled until the chart of accounts has actually loaded —
    // before that, "no accounts" can't be told from "not here yet", and a quick
    // Confirm would book the receipt to a heuristically picked account.
    const [accountsLoaded, setAccountsLoaded] = useState(false);
    // One confirm per opening: a second click before the modal closes would
    // send the same settle twice.
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setAccountsLoaded(false);
            setSubmitted(false);
            fetchAccounts().finally(() => setAccountsLoaded(true));
        }
    }, [isOpen, fetchAccounts]);

    // Cash/bank ledger accounts for the "Deposited into" select — same filter
    // as RecordReceiptModal's and DepositModal's field.
    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)),
        [accounts]
    );

    useEffect(() => {
        if (isOpen) {
            // Bank is the default Pay By — settlements normally arrive by bank
            // transfer from the shipping company (still changeable in the dropdown).
            const bankMethod = paymentMethods.find(m => m.toLowerCase().includes('bank'));
            setSelectedMethod(bankMethod || initialMethod || paymentMethods[0] || 'Cash');
            setSettleDate(initialDate ? (/^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : dayKeyFromDate(new Date(initialDate))) : localYMD());
            setDepositAccountId('');
        }
        // paymentAccounts stays OUT of these deps: the accounts arrive after the
        // modal opens, and re-running this then would clobber whatever date or
        // method the user already changed. The account default has its own
        // effect below for exactly that reason.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialMethod, initialDate, paymentMethods]);

    // Seed the account default once the accounts arrive — but never overwrite
    // a pick the user already made.
    useEffect(() => {
        if (!isOpen || paymentAccounts.length === 0) return;
        setDepositAccountId(prev => {
            if (prev && paymentAccounts.some(a => a.id === prev)) return prev;
            // Bank is the default Deposited into account too, same idea as Pay
            // By; never a riel account by default.
            return defaultCashBankAccountId(paymentAccounts);
        });
    }, [isOpen, paymentAccounts]);

    // Riel prefill on open: what the shop expected to collect, else the
    // amount due at the shop rate.
    useEffect(() => {
        if (!isOpen) return;
        const expected = khrExpected && khrExpected > 0 ? Math.round(khrExpected) : (amountDue ? usdToKhr(amountDue, rielField.shopRate) : '');
        rielField.reset({ amount: expected, currency: 'KHR' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, khrExpected, amountDue]);

    const inRiel = amountDue !== undefined && accountCurrency(paymentAccounts.find(a => a.id === depositAccountId)) === 'KHR';
    const hasKhrAccounts = paymentAccounts.some(a => isKhrAccountName(a.account_name));

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
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        {[{ label: 'Today', daysAgo: 0 }, { label: 'Yesterday', daysAgo: 1 }].map(({ label, daysAgo }) => {
                            const value = localYMD(daysAgo);
                            const active = settleDate === value;
                            return (
                                <button
                                    key={label}
                                    type="button"
                                    onClick={() => setSettleDate(value)}
                                    style={{
                                        padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                                        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                        background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                                        color: active ? 'white' : 'var(--color-text-secondary)'
                                    }}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
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
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>
                        Deposited into {accountsLoaded && paymentAccounts.length > 0 && <span style={{ color: 'red' }}>*</span>}
                    </label>
                    <select
                        value={depositAccountId}
                        onChange={(e) => setDepositAccountId(e.target.value)}
                        disabled={!accountsLoaded}
                        data-testid="settle-account"
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px',
                            border: `1px solid ${accountsLoaded && paymentAccounts.length > 0 && !depositAccountId ? '#DC2626' : 'var(--color-border)'}`,
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none', boxSizing: 'border-box', opacity: accountsLoaded ? 1 : 0.6
                        }}
                    >
                        <option value="">{accountsLoaded ? 'Bank or cash account…' : 'Loading accounts…'}</option>
                        <CashBankOptions accounts={paymentAccounts} />
                    </select>
                    <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        {!accountsLoaded
                            ? 'Loading the Chart of Accounts…'
                            : paymentAccounts.length > 0
                                ? 'Settling also books the receipt to this account as a Draft journal entry.'
                                : 'No cash or bank accounts in the Chart of Accounts yet — the settlement saves without a ledger entry account.'}
                    </p>
                    {amountDue !== undefined && hasKhrAccounts && (
                        <button
                            type="button"
                            onClick={() => {
                                const next = counterpartAccount(paymentAccounts, depositAccountId, inRiel ? 'USD' : 'KHR');
                                if (next) setDepositAccountId(next.id);
                            }}
                            style={{ marginTop: '6px', background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
                        >
                            {inRiel ? 'Received in dollars instead' : 'Received in riel (៛)?'}
                        </button>
                    )}
                </div>
                {inRiel && amountDue !== undefined && (
                    <div>
                        <MoneyInput field={rielField} label="Riel received" required />
                        <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                            Books the order's {formatUsd(amountDue)}; the riel amount and rate are recorded with it.
                        </p>
                    </div>
                )}
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
                    {(() => {
                        // An account is required only when there is one to pick —
                        // and nothing confirms before the accounts have loaded.
                        const valid = accountsLoaded && !submitted && !(paymentAccounts.length > 0 && !depositAccountId)
                            && !(inRiel && (!(rielField.typed > 0) || rielField.rateInvalid));
                        return (
                            <button
                                onClick={() => {
                                    if (!valid) return;
                                    if (inRiel && !rielField.confirmIfSuspicious()) return;
                                    setSubmitted(true);
                                    // Ensure time is preserved, or just set to noon if we only care about the date
                                    // Default behavior for <input type="date"> is YYYY-MM-DD
                                    onConfirm({
                                        paymentMethod: selectedMethod,
                                        settleDate: new Date(settleDate).toISOString(),
                                        depositAccountId: depositAccountId || undefined,
                                        depositAccountName: paymentAccounts.find(a => a.id === depositAccountId)?.account_name,
                                        money: inRiel ? rielField.meta : undefined,
                                    });
                                    onClose();
                                }}
                                className="primary-button"
                                disabled={!valid}
                                style={{
                                    padding: '10px 16px', borderRadius: '8px', border: 'none',
                                    background: valid ? 'var(--color-primary)' : 'var(--color-border)',
                                    color: valid ? 'white' : 'var(--color-text-muted)',
                                    cursor: valid ? 'pointer' : 'not-allowed',
                                    fontSize: '14px', fontWeight: 500
                                }}
                            >
                                Confirm
                            </button>
                        );
                    })()}
                </div>
            </div>
        </Modal>
    );
};

export default SettlePaymentModal;
