import React, { useState, useEffect, useMemo, useRef } from 'react';
import Modal from './Modal';
import { useStore } from '../context/StoreContext';
import { useAccounting } from '../hooks/useAccounting';
import type { Sale } from '../types';
import { dayKeyFromDate } from '../utils/dateRange';
import MoneyInput from './MoneyInput';
import CashBankOptions from './CashBankOptions';
import { useAccountCurrency, useMoneyField } from '../hooks/useMoneyField';
import { defaultCashBankAccountId } from '../utils/cashBankAccounts';
import { accountCurrency, formatMoneyLine, isKhrRow, type MoneyMeta, type MoneyRow } from '../utils/currency';

// Local calendar day as YYYY-MM-DD, `daysAgo` days back. Steps by calendar day
// (not 24h) so a daylight-saving change can't land on the wrong date.
const localYMD = (daysAgo = 0): string => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface RecordReceiptModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (data: {
        paymentMethod: string;
        settleDate: string;
        depositAccountId?: string;
        depositAccountName?: string;
        amountReceived: number;
        receiptReference?: string;
        receiptNotes?: string;
        // The riel received (not in finalizeMode: that amount is fixed).
        money?: MoneyMeta;
    }) => void;
    // Single order this receipt is being recorded against — fixes the
    // customer and drives the amount-received default/remaining-balance math.
    order: Pick<Sale, 'total' | 'amountReceived' | 'depositAmount' | 'customer'>;
    initialMethod?: string;
    initialDate?: string;
    // Preferred "Deposited into" account: an explicit id (e.g. the existing
    // journal entry's debit account), else an account whose name matches the hint.
    initialDepositAccountId?: string;
    depositAccountHint?: string;
    // Finalizing an already-recorded payment: the amount is fixed to order.total
    // and there is no method or remaining balance to edit.
    finalizeMode?: boolean;
    // finalizeMode: the recorded payment row, shown as "៛82,000 @ 4,100 =
    // $20.00" when it was riel, and steering the default account to a riel
    // account then.
    finalizeRow?: MoneyRow | null;
    title?: string;
    description?: string;
}

const RecordReceiptModal: React.FC<RecordReceiptModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    order,
    initialMethod,
    initialDate,
    initialDepositAccountId,
    depositAccountHint,
    finalizeMode = false,
    finalizeRow,
    title = "Record Receipt",
    description = "Please confirm the settle date and payment method."
}) => {
    const { paymentMethods, khrExchangeRate } = useStore();
    const { accounts, fetchAccounts } = useAccounting();
    const [selectedMethod, setSelectedMethod] = useState<string>('');
    const [settleDate, setSettleDate] = useState<string>('');
    // The user's explicit "Deposited into" pick; '' falls back to the default below.
    const [chosenAccountId, setChosenAccountId] = useState<string>('');
    const [receiptReference, setReceiptReference] = useState<string>('');
    const [receiptNotes, setReceiptNotes] = useState<string>('');
    const [accountsLoaded, setAccountsLoaded] = useState(false);
    const initializedRef = useRef(false);

    useEffect(() => {
        let alive = true;
        fetchAccounts().finally(() => { if (alive) setAccountsLoaded(true); });
        return () => { alive = false; };
    }, [fetchAccounts]);

    // Cash/bank ledger accounts for the "Deposit into" select.
    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)),
        [accounts]
    );

    // The balance still due; a figure above it is a typo (riel).
    const due = Math.max(0, order.total - (order.depositAmount || order.amountReceived || 0));
    const field = useMoneyField({ shopRate: khrExchangeRate, maxPlausibleUsd: due || null });

    // Initialize once per open, so accounts arriving later never wipe the user's edits.
    useEffect(() => {
        if (!isOpen) { initializedRef.current = false; return; }
        if (initializedRef.current) return;
        initializedRef.current = true;
        // Bank is the default Pay By — settlements normally arrive by bank
        // transfer from the shipping company (still changeable in the dropdown).
        const bankMethod = paymentMethods.find(m => m.toLowerCase().includes('bank'));
        setSelectedMethod(bankMethod || initialMethod || paymentMethods[0] || 'Cash');
        setSettleDate(initialDate ? (/^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : dayKeyFromDate(new Date(initialDate))) : localYMD());
        setChosenAccountId('');
        // Default to the order's outstanding balance — an order that already
        // took a deposit defaults to the remainder, not the whole total again.
        field.reset({ amount: finalizeMode ? order.total : due, currency: 'USD' });
        setReceiptReference('');
        setReceiptNotes('');
        // field.reset follows the shop rate only; the rest are this open's inputs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialMethod, initialDate, paymentMethods, finalizeMode, order.total, order.depositAmount, order.amountReceived]);

    // Default "Deposited into" until the user picks one: the preferred id, then
    // a name match on the hint (a cash method picks the cash account), then Bank.
    // In the payment's currency: a USD receipt never opens on a riel account;
    // a riel row being finalized opens on a riel one when the store has one.
    const rowIsKhr = finalizeMode && isKhrRow(finalizeRow);
    const defaultAccountId = useMemo(() => defaultCashBankAccountId(paymentAccounts, {
        preferredId: initialDepositAccountId,
        hint: depositAccountHint,
        cashHint: true,
        currency: rowIsKhr ? 'KHR' : 'USD',
    }) || (rowIsKhr ? defaultCashBankAccountId(paymentAccounts, { hint: depositAccountHint, cashHint: true }) : ''),
    [paymentAccounts, initialDepositAccountId, depositAccountHint, rowIsKhr]);
    const depositAccountId = chosenAccountId || defaultAccountId;
    const coupling = useAccountCurrency(field, paymentAccounts, depositAccountId, setChosenAccountId);
    const amountReceived = finalizeMode ? order.total : field.usd;
    // Posting a row: the amount is fixed, so the account must match the
    // row's currency (a riel row into a riel account, a USD row into a USD
    // one). A mismatch is shown and asks before posting.
    const pickedAccount = paymentAccounts.find(a => a.id === depositAccountId);
    const rowCurrency = rowIsKhr ? 'KHR' : 'USD';
    const finalizeMismatch = finalizeMode && !!pickedAccount && accountCurrency(pickedAccount) !== rowCurrency;
    const mismatchText = rowCurrency === 'KHR'
        ? `This row was received in riel (${finalizeRow ? formatMoneyLine(finalizeRow) : ''}), but ${pickedAccount?.account_name ?? 'this account'} is a dollar account.`
        : `This row was received in dollars, but ${pickedAccount?.account_name ?? 'this account'} is a riel account.`;

    // A prior deposit already reduced the balance — leave it out of "remaining"
    // too, or a fully-settling receipt would still show a bogus balance.
    const remainingBalance = Math.max(0, order.total - (order.depositAmount || 0) - (amountReceived || 0));
    const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(settleDate);
    const canRecord = accountsLoaded && dateValid && amountReceived > 0 && !(!finalizeMode && field.rateInvalid) && !(paymentAccounts.length > 0 && !depositAccountId);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    {description}
                </p>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Customer</label>
                    <div style={{
                        width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                        boxSizing: 'border-box'
                    }}>
                        {order.customer?.name || '—'}
                    </div>
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Payment date <span style={{ color: 'red' }}>*</span></label>
                    <input
                        type="date"
                        value={settleDate}
                        onChange={(e) => setSettleDate(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: `1px solid ${dateValid ? 'var(--color-border)' : 'red'}`,
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
                    {finalizeMode && <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Amount received <span style={{ color: 'red' }}>*</span></label>}
                    {finalizeMode ? (
                        <div style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '14px', fontWeight: 600,
                            boxSizing: 'border-box'
                        }}>
                            {finalizeRow && isKhrRow(finalizeRow)
                                ? formatMoneyLine(finalizeRow)
                                : `$${Number(order.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </div>
                    ) : (
                        <MoneyInput
                            field={field}
                            label="Amount received"
                            required
                            allowKhr
                            onToggleCurrency={coupling.onToggleCurrency}
                            khrUnavailableReason={coupling.khrUnavailableReason}
                            labelStyle={{ color: 'var(--color-text-main)' }}
                            inputStyle={{ fontSize: '14px', fontWeight: 400, borderRadius: '8px', padding: '10px', border: `1px solid ${amountReceived <= 0 ? 'red' : 'var(--color-border)'}` }}
                        />
                    )}
                </div>
                {/* Shown in every mode, including finalizeMode — a finalized receipt
                    still has a payment method (how the money actually arrived),
                    and the caller may need to correct it, not just view it. */}
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Method <span style={{ color: 'red' }}>*</span></label>
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
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Reference</label>
                    <input
                        type="text"
                        value={receiptReference}
                        onChange={(e) => setReceiptReference(e.target.value)}
                        placeholder="Cheque or transfer number"
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none', boxSizing: 'border-box'
                        }}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Deposited into <span style={{ color: 'red' }}>*</span></label>
                    <select
                        value={depositAccountId}
                        disabled={!accountsLoaded}
                        onChange={(e) => (finalizeMode ? setChosenAccountId(e.target.value) : coupling.onAccountChange(e.target.value))}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px',
                            border: `1px solid ${paymentAccounts.length > 0 && !depositAccountId ? 'red' : 'var(--color-border)'}`,
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none', boxSizing: 'border-box'
                        }}
                    >
                        <option value="">Bank or cash account…</option>
                        <CashBankOptions accounts={paymentAccounts} />
                    </select>
                    {finalizeMismatch && (
                        <div data-money-warning role="alert" style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '8px', fontSize: '12px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.55)', color: '#B45309' }}>
                            {mismatchText}
                        </div>
                    )}
                    {!accountsLoaded ? (
                        <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                            Loading accounts…
                        </div>
                    ) : paymentAccounts.length === 0 && (
                        <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                            No cash or bank accounts in the Chart of Accounts yet — the settlement saves without one.
                        </div>
                    )}
                </div>
                {!finalizeMode && (
                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                        Remaining balance: ${remainingBalance.toFixed(2)}
                    </div>
                )}
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Notes</label>
                    <textarea
                        value={receiptNotes}
                        onChange={(e) => setReceiptNotes(e.target.value)}
                        placeholder="Optional notes…"
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none', boxSizing: 'border-box', minHeight: '70px', resize: 'vertical', fontFamily: 'inherit'
                        }}
                    />
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
                            if (!canRecord) return;
                            if (!finalizeMode && !field.confirmIfSuspicious()) return;
                            if (finalizeMismatch && !window.confirm(`${mismatchText}\nPost it there anyway?`)) return;
                            const depositAccountName = paymentAccounts.find(a => a.id === depositAccountId)?.account_name;
                            onConfirm({
                                paymentMethod: selectedMethod,
                                settleDate: new Date(settleDate).toISOString(),
                                depositAccountId: depositAccountId || undefined,
                                depositAccountName,
                                amountReceived,
                                receiptReference: receiptReference.trim() || undefined,
                                receiptNotes: receiptNotes.trim() || undefined,
                                money: finalizeMode ? undefined : field.meta,
                            });
                            onClose();
                        }}
                        disabled={!canRecord}
                        className="primary-button"
                        style={{
                            padding: '10px 16px', borderRadius: '8px', border: 'none',
                            background: 'var(--color-primary)',
                            color: 'white',
                            cursor: !canRecord ? 'not-allowed' : 'pointer',
                            opacity: !canRecord ? 0.6 : 1,
                            fontSize: '14px', fontWeight: 500
                        }}
                    >
                        Record Receipt
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default RecordReceiptModal;
