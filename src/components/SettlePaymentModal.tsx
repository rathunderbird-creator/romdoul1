import React, { useState, useEffect, useMemo } from 'react';
import Modal from './Modal';
import { useTx } from './useTx';
import { useStore } from '../context/StoreContext';
import { useAccounting } from '../hooks/useAccounting';
import { dayKeyFromDate } from '../utils/dateRange';
import MoneyInput from './MoneyInput';
import CashBankOptions from './CashBankOptions';
import { useAccountCurrency, useMoneyField, syncFieldToAccount } from '../hooks/useMoneyField';
import { defaultCashBankAccountId, depositDefaultFor, followMethodAccount, isCodPaymentMethod } from '../utils/cashBankAccounts';
import { accountCurrency, formatUsd, khrToUsd, SNAP_TOLERANCE_USD, usdToKhr, type MoneyMeta } from '../utils/currency';
import { roundCents } from '../utils/money';

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
    // receivedUsd: the Received Amount in USD (riel converted at the rate
    // typed, snapped to the amount due when within a few cents). When it
    // differs from amountDue the caller changes the order's money: total =
    // deposit + received, the difference going into the discount.
    // money: the riel received, when the settlement came in riel (the riel
    // amount and rate are recorded with the USD booked).
    // codCollected: the "អ្នកដឹកប្រមូល (COD)" box — the courier collected the
    // money, so the receipt debits 1210 COD receivable (courier) until the
    // courier remits it; undefined when the box is not shown (no codDefault).
    onConfirm: (data: { paymentMethod: string; settleDate: string; depositAccountId?: string; depositAccountName?: string; money?: MoneyMeta; receivedUsd?: number; codCollected?: boolean }) => void;
    // Shows the COD box, starting at this value (utils/cashBankAccounts
    // defaultCodCollected: on for an order a courier has out or has
    // delivered, or one waiting for its payment proof; off for a direct
    // transfer). Omitted: no box, the save says nothing about COD.
    codDefault?: boolean;
    // What is still owed in USD (total − deposit), and the riel the shop
    // expected to collect (sales.custom_khr_amount) — both optional; without
    // amountDue there is no Received Amount field.
    amountDue?: number;
    khrExpected?: number;
    // The order's current total, for the "total becomes …" line.
    orderTotal?: number;
    initialMethod?: string;
    initialDate?: string;
    // Start from initialMethod rather than Bank (a Salesman's payment being
    // confirmed: the method they entered).
    preferInitialMethod?: boolean;
    // A riel payment being confirmed: start on a riel account, at this rate.
    preferRiel?: { rate?: number };
    // Re-opening a payment already booked: the account it went into, used
    // when it is in the currency the form starts in.
    initialAccountId?: string;
    title?: string;
    description?: string;
}

const SettlePaymentModal: React.FC<SettlePaymentModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    initialMethod,
    initialDate,
    preferInitialMethod = false,
    preferRiel,
    initialAccountId,
    amountDue,
    khrExpected,
    orderTotal,
    title,
    description,
    codDefault
}) => {
    const tx = useTx();
    const { paymentMethods, khrExchangeRate, codPaymentMethods, salesSettings } = useStore();
    // Sales Setup's default deposit accounts (USD / riel).
    const defUsd = depositDefaultFor(salesSettings, 'USD');
    const defKhr = depositDefaultFor(salesSettings, 'KHR');
    const showCod = codDefault !== undefined;
    const [codCollected, setCodCollected] = useState<boolean>(false);
    // Until the user clicks the COD box, it follows the Method: a Pay By
    // ticked as a COD payment method in Sales Setup ticks it, any other
    // leaves it at codDefault.
    const [codTouched, setCodTouched] = useState(false);
    // The amount actually received, in dollars or riel (USD | KHR toggle,
    // kept in step with the Deposited into account). A riel figure within a
    // few cents of the amount due books exactly the amount due (snapToUsd).
    const receivedField = useMoneyField({ shopRate: khrExchangeRate, snapToUsd: amountDue ?? null });
    // Typed in this opening: until then the field follows the currency with
    // the prefill (the due in dollars, the expected riel in riel) instead of
    // converting the dollar figure.
    const [receivedEdited, setReceivedEdited] = useState(false);
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
    // as RecordReceiptModal's and DepositModal's field, except Petty Cash: a
    // customer's payment is never received into the petty-cash float.
    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name) && !/petty/i.test(a.account_name)),
        [accounts]
    );

    useEffect(() => {
        if (isOpen) {
            // Bank is the default Pay By — settlements normally arrive by bank
            // transfer from the shipping company (still changeable in the dropdown).
            const bankMethod = paymentMethods.find(m => m.toLowerCase().includes('bank'));
            const fromInitial = preferInitialMethod && initialMethod && paymentMethods.includes(initialMethod) ? initialMethod : '';
            setSelectedMethod(fromInitial || bankMethod || initialMethod || paymentMethods[0] || 'Cash');
            setSettleDate(initialDate ? (/^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : dayKeyFromDate(new Date(initialDate))) : localYMD());
            setDepositAccountId('');
            setCodCollected(codDefault === true);
            setCodTouched(false);
        }
        // paymentAccounts stays OUT of these deps: the accounts arrive after the
        // modal opens, and re-running this then would clobber whatever date or
        // method the user already changed. The account default has its own
        // effect below for exactly that reason.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialMethod, initialDate, paymentMethods, preferInitialMethod, codDefault]);

    useEffect(() => {
        if (!isOpen || !showCod || codTouched) return;
        setCodCollected(codDefault === true || isCodPaymentMethod(codPaymentMethods, selectedMethod));
    }, [isOpen, showCod, codTouched, codDefault, codPaymentMethods, selectedMethod]);

    // Seed the account default once the accounts arrive — but never overwrite
    // a pick the user already made.
    useEffect(() => {
        if (!isOpen || paymentAccounts.length === 0) return;
        setDepositAccountId(prev => {
            if (prev && paymentAccounts.some(a => a.id === prev)) return prev;
            // Bank is the default Deposited into account too, same idea as Pay
            // By; never a riel account by default, except when confirming a
            // payment taken in riel. A payment being re-opened starts on the
            // account it went into, when that is in the starting currency.
            const preferredId = initialAccountId || undefined;
            return (preferRiel ? defaultCashBankAccountId(paymentAccounts, { currency: 'KHR', preferredId, defaultId: defKhr, method: selectedMethod }) : '')
                || defaultCashBankAccountId(paymentAccounts, { currency: 'USD', preferredId, defaultId: defUsd, method: selectedMethod });
        });
        // selectedMethod is read, not a trigger: the seed only fills an empty
        // pick, and a later method change moves the account in its onChange.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, paymentAccounts, preferRiel, initialAccountId, defUsd, defKhr]);

    // What the field starts at in each currency: the amount due in dollars;
    // in riel what the shop expected to collect, else the due at the rate.
    const prefillFor = (c: 'USD' | 'KHR', rate: number): string | number => {
        if (amountDue === undefined) return '';
        if (c === 'USD') return roundCents(amountDue);
        // The saved riel only when it still comes to the amount due at this
        // rate (or a Salesman's riel payment being confirmed, at its own
        // rate): an older figure, from a changed total or rate, would change
        // the order's money with nothing typed.
        const expected = khrExpected && khrExpected > 0 ? Math.round(khrExpected) : 0;
        if (expected > 0 && (preferRiel || Math.abs(khrToUsd(expected, rate) - amountDue) <= SNAP_TOLERANCE_USD)) return expected;
        return usdToKhr(amountDue, rate);
    };

    // Prefill on open, in riel when confirming a payment taken in riel.
    useEffect(() => {
        if (!isOpen) return;
        const c = preferRiel ? 'KHR' : 'USD';
        const rate = preferRiel?.rate && preferRiel.rate > 0 ? preferRiel.rate : receivedField.shopRate;
        receivedField.reset({ amount: prefillFor(c, rate), currency: c, ...(preferRiel?.rate ? { rate: preferRiel.rate } : {}) });
        setReceivedEdited(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, khrExpected, amountDue]);

    // The currency follows the account picked (a riel account takes riel).
    const coupling = useAccountCurrency(receivedField, paymentAccounts, depositAccountId, setDepositAccountId, { usd: defUsd, khr: defKhr });
    useEffect(() => {
        const a = paymentAccounts.find(x => x.id === depositAccountId);
        if (a) syncFieldToAccount(receivedField, accountCurrency(a));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [depositAccountId, paymentAccounts]);

    // Untouched, a currency switch shows that currency's prefill rather than
    // the converted dollar figure (៛82,000 expected, not ៛81,900 from $19.98).
    useEffect(() => {
        if (!isOpen || receivedEdited) return;
        const rate = Number(receivedField.rate) > 0 ? Number(receivedField.rate) : receivedField.shopRate;
        const want = String(prefillFor(receivedField.currency, rate));
        if (receivedField.amount !== want) receivedField.setAmount(want);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [receivedField.currency]);

    const showReceived = amountDue !== undefined;
    const inRiel = showReceived && receivedField.currency === 'KHR';
    // The order's money moves only when the received amount really differs
    // from what is due (a riel figure within a few cents snaps to the due).
    const receivedUsd = roundCents(receivedField.usd);
    const receivedDiff = showReceived ? roundCents((amountDue as number) - receivedUsd) : 0;
    const moneyChanges = showReceived && Number.isFinite(receivedField.typed) && Math.abs(receivedDiff) > 0.005;
    const newTotal = orderTotal !== undefined ? roundCents(orderTotal - receivedDiff) : undefined;
    // The field as MoneyInput drives it: typing marks it edited.
    const receivedInput = {
        ...receivedField,
        setAmount: (v: string) => { setReceivedEdited(true); receivedField.setAmount(v); },
        reinterpret: (c: 'USD' | 'KHR') => { setReceivedEdited(true); receivedField.reinterpret(c); },
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title ?? tx('ui.components.settle.title', 'Settle Payment')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    {description ?? tx('ui.components.settle.description', 'Please confirm the settle date and payment method.')}
                </p>
                <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>{tx('ui.components.settle.settleDate', 'Settle Date')} <span style={{ color: 'red' }}>*</span></label>
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
                        {[{ label: tx('ui.components.common.today', 'Today'), daysAgo: 0 }, { label: tx('ui.components.common.yesterday', 'Yesterday'), daysAgo: 1 }].map(({ label, daysAgo }) => {
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
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>{tx('orders.payBy', 'Pay By')} <span style={{ color: 'red' }}>*</span></label>
                    <select
                        value={selectedMethod}
                        onChange={(e) => {
                            const m = e.target.value;
                            const c = receivedField.currency;
                            const next = followMethodAccount(paymentAccounts, depositAccountId, selectedMethod, m, { currency: c, defaultId: c === 'KHR' ? defKhr : defUsd });
                            setSelectedMethod(m);
                            if (next) setDepositAccountId(next);
                        }}
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
                        {tx('ui.components.common.depositedInto', 'Deposited into')} {accountsLoaded && paymentAccounts.length > 0 && <span style={{ color: 'red' }}>*</span>}
                    </label>
                    <select
                        value={depositAccountId}
                        onChange={(e) => coupling.onAccountChange(e.target.value)}
                        disabled={!accountsLoaded}
                        data-testid="settle-account"
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px',
                            border: `1px solid ${accountsLoaded && paymentAccounts.length > 0 && !depositAccountId ? '#DC2626' : 'var(--color-border)'}`,
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none', boxSizing: 'border-box', opacity: accountsLoaded ? 1 : 0.6
                        }}
                    >
                        <option value="">{accountsLoaded ? tx('ui.components.common.bankOrCash', 'Bank or cash account…') : tx('ui.components.common.loadingAccounts', 'Loading accounts…')}</option>
                        <CashBankOptions accounts={paymentAccounts} />
                    </select>
                    <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        {!accountsLoaded
                            ? tx('ui.components.common.loadingCoa', 'Loading the Chart of Accounts…')
                            : paymentAccounts.length > 0
                                ? (showCod && codCollected
                                    ? tx('ui.components.settle.booksDraftCod', "Settling books the receipt to 1210 COD receivable (courier) as a Draft journal entry; this account is where the courier's remittance will land.")
                                    : tx('ui.components.settle.booksDraft', 'Settling also books the receipt to this account as a Draft journal entry.'))
                                : tx('ui.components.settle.noAccounts', 'No cash or bank accounts in the Chart of Accounts yet — the settlement saves without a ledger entry account.')}
                    </p>
                </div>
                {showCod && (
                    <div data-settle-cod>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={codCollected}
                                onChange={e => { setCodTouched(true); setCodCollected(e.target.checked); }}
                                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                            {tx('ui.components.settle.codCollected', 'អ្នកដឹកប្រមូល (COD)')}
                        </label>
                        <p style={{ margin: '6px 0 0 24px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                            {codCollected
                                ? tx('ui.components.settle.codOnHint', "The courier collected this money and still holds it. It is booked to COD receivable until the courier's remittance is recorded on Accounting › COD remittances.")
                                : tx('ui.components.settle.codOffHint', 'The customer paid the shop directly (ABA transfer, cash): the money is in the account above now.')}
                        </p>
                    </div>
                )}
                {showReceived && (
                    <div data-settle-received>
                        <MoneyInput
                            field={receivedInput}
                            label={tx('ui.components.settle.receivedAmount', 'Received Amount')}
                            allowKhr
                            onToggleCurrency={coupling.onToggleCurrency}
                            khrUnavailableReason={accountsLoaded ? coupling.khrUnavailableReason : tx('ui.components.common.loadingAccounts', 'Loading accounts…')}
                            required
                        />
                        <p style={{ margin: '6px 0 0', fontSize: '12px', color: moneyChanges ? (receivedDiff > 0 ? '#059669' : '#B45309') : 'var(--color-text-muted)' }} data-settle-received-note>
                            {!moneyChanges
                                ? tx('ui.components.settle.dueIs', 'Amount due {due}.', { due: formatUsd(amountDue as number) })
                                : receivedDiff > 0
                                    ? (newTotal !== undefined
                                        ? tx('ui.components.settle.lessThanDueTotal', '{diff} less than the {due} due: the order total becomes {total}, the {diff} saved as a discount.', { diff: formatUsd(receivedDiff), due: formatUsd(amountDue as number), total: formatUsd(newTotal) })
                                        : tx('ui.components.settle.lessThanDue', '{diff} less than the {due} due: saved as a discount on the order.', { diff: formatUsd(receivedDiff), due: formatUsd(amountDue as number) }))
                                    : (newTotal !== undefined
                                        ? tx('ui.components.settle.moreThanDueTotal', '{diff} more than the {due} due: the order total becomes {total}, the {diff} saved as an extra charge.', { diff: formatUsd(-receivedDiff), due: formatUsd(amountDue as number), total: formatUsd(newTotal) })
                                        : tx('ui.components.settle.moreThanDue', '{diff} more than the {due} due: saved as an extra charge on the order.', { diff: formatUsd(-receivedDiff), due: formatUsd(amountDue as number) }))}
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
                        {tx('common.cancel', 'Cancel')}
                    </button>
                    {(() => {
                        // An account is required only when there is one to pick —
                        // and nothing confirms before the accounts have loaded.
                        // A Received Amount is required (0 only when nothing is due).
                        const receivedOk = !showReceived || (Number.isFinite(receivedField.typed) && receivedField.typed >= 0
                            && (receivedField.typed > 0 || (amountDue as number) <= 0.005) && !receivedField.rateInvalid);
                        const valid = accountsLoaded && !submitted && !(paymentAccounts.length > 0 && !depositAccountId) && receivedOk;
                        return (
                            <button
                                onClick={() => {
                                    if (!valid) return;
                                    if (showReceived && !receivedField.confirmIfSuspicious()) return;
                                    // A big difference is asked about once: not again after the
                                    // field's own wrong-amount warning, nor for riel against an
                                    // amount due (the field's check asks above 5%).
                                    if (moneyChanges && !receivedField.warning && !(inRiel && (amountDue as number) > 0)
                                        && Math.abs(receivedDiff) > Math.max(0.5, (amountDue as number) * 0.1)
                                        && !window.confirm(tx('ui.components.settle.bigDiffConfirm', 'Received {rec} but {due} is due. Change the order total by {diff} and save it as a {kind}?', {
                                            rec: formatUsd(receivedUsd), due: formatUsd(amountDue as number), diff: formatUsd(Math.abs(receivedDiff)),
                                            kind: receivedDiff > 0 ? tx('ui.components.settle.discountWord', 'discount') : tx('ui.components.settle.extraChargeWord', 'extra charge'),
                                        }))) return;
                                    setSubmitted(true);
                                    // Ensure time is preserved, or just set to noon if we only care about the date
                                    // Default behavior for <input type="date"> is YYYY-MM-DD
                                    onConfirm({
                                        paymentMethod: selectedMethod,
                                        settleDate: new Date(settleDate).toISOString(),
                                        depositAccountId: depositAccountId || undefined,
                                        depositAccountName: paymentAccounts.find(a => a.id === depositAccountId)?.account_name,
                                        money: inRiel ? receivedField.meta : undefined,
                                        receivedUsd: showReceived ? receivedUsd : undefined,
                                        codCollected: showCod ? codCollected : undefined,
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
                                {tx('common.confirm', 'Confirm')}
                            </button>
                        );
                    })()}
                </div>
            </div>
        </Modal>
    );
};

export default SettlePaymentModal;
