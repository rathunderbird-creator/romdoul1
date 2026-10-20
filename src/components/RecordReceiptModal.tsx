import React, { useState, useEffect, useMemo, useRef } from 'react';
import Modal from './Modal';
import { useStore } from '../context/StoreContext';
import { useAccounting } from '../hooks/useAccounting';
import type { Sale } from '../types';
import { dayKeyFromDate } from '../utils/dateRange';

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
    title = "Record Receipt",
    description = "Please confirm the settle date and payment method."
}) => {
    const { paymentMethods } = useStore();
    const { accounts, fetchAccounts } = useAccounting();
    const [selectedMethod, setSelectedMethod] = useState<string>('');
    const [settleDate, setSettleDate] = useState<string>('');
    // The user's explicit "Deposited into" pick; '' falls back to the default below.
    const [chosenAccountId, setChosenAccountId] = useState<string>('');
    const [amountReceived, setAmountReceived] = useState<number>(0);
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
        setAmountReceived(finalizeMode ? order.total : Math.max(0, order.total - (order.depositAmount || order.amountReceived || 0)));
        setReceiptReference('');
        setReceiptNotes('');
    }, [isOpen, initialMethod, initialDate, paymentMethods, finalizeMode, order.total, order.depositAmount, order.amountReceived]);

    // Default "Deposited into" until the user picks one: the preferred id, then
    // a name match on the hint (a cash method picks the cash account), then Bank.
    const defaultAccountId = useMemo(() => {
        const hint = (depositAccountHint || '').trim().toLowerCase();
        const preferred = (initialDepositAccountId && paymentAccounts.find(a => a.id === initialDepositAccountId))
            || (hint ? paymentAccounts.find(a => a.account_name.toLowerCase() === hint) : undefined)
            || (hint.includes('cash') ? paymentAccounts.find(a => /cash/i.test(a.account_name)) : undefined)
            || paymentAccounts.find(a => a.account_name.toLowerCase().includes('bank'))
            || paymentAccounts[0];
        return preferred?.id || '';
    }, [paymentAccounts, initialDepositAccountId, depositAccountHint]);
    const depositAccountId = chosenAccountId || defaultAccountId;

    // A prior deposit already reduced the balance — leave it out of "remaining"
    // too, or a fully-settling receipt would still show a bogus balance.
    const remainingBalance = Math.max(0, order.total - (order.depositAmount || 0) - (amountReceived || 0));
    const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(settleDate);
    const canRecord = accountsLoaded && dateValid && amountReceived > 0 && !(paymentAccounts.length > 0 && !depositAccountId);

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
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: 'var(--color-text-main)' }}>Amount received <span style={{ color: 'red' }}>*</span></label>
                    {finalizeMode ? (
                        <div style={{
                            width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '14px', fontWeight: 600,
                            boxSizing: 'border-box'
                        }}>
                            ${Number(order.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                    ) : (
                        <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={amountReceived}
                            onChange={(e) => setAmountReceived(parseFloat(e.target.value) || 0)}
                            style={{
                                width: '100%', padding: '10px', borderRadius: '8px',
                                border: `1px solid ${amountReceived <= 0 ? 'red' : 'var(--color-border)'}`,
                                background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                                outline: 'none', boxSizing: 'border-box'
                            }}
                        />
                    )}
                </div>
                {!finalizeMode && (
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
                )}
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
                        onChange={(e) => setChosenAccountId(e.target.value)}
                        style={{
                            width: '100%', padding: '10px', borderRadius: '8px',
                            border: `1px solid ${paymentAccounts.length > 0 && !depositAccountId ? 'red' : 'var(--color-border)'}`,
                            background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '14px',
                            outline: 'none', boxSizing: 'border-box'
                        }}
                    >
                        <option value="">Bank or cash account…</option>
                        {paymentAccounts.map(a => (
                            <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>
                        ))}
                    </select>
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
                            const depositAccountName = paymentAccounts.find(a => a.id === depositAccountId)?.account_name;
                            onConfirm({
                                paymentMethod: selectedMethod,
                                settleDate: new Date(settleDate).toISOString(),
                                depositAccountId: depositAccountId || undefined,
                                depositAccountName,
                                amountReceived,
                                receiptReference: receiptReference.trim() || undefined,
                                receiptNotes: receiptNotes.trim() || undefined
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
