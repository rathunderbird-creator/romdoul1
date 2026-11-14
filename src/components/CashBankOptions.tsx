// The <option>s of a cash/bank account picker: USD accounts first (by
// code), then the riel accounts under a "Riel (KHR)" group, so a riel
// account is never the one a USD payment slides onto.
import React from 'react';
import { sortCashBankForPicker, splitByCurrency } from '../utils/cashBankAccounts';

type Acct = { id: string; account_code?: string | null; account_name: string };

const CashBankOptions: React.FC<{ accounts: Acct[]; label?: (a: Acct) => string; khrGroupLabel?: string }> = ({ accounts, label, khrGroupLabel = 'Riel (KHR)' }) => {
    const { usd, khr } = splitByCurrency(sortCashBankForPicker(accounts));
    const text = label || ((a: Acct) => `${a.account_code ? a.account_code + ' · ' : ''}${a.account_name}`);
    return (
        <>
            {usd.map(a => <option key={a.id} value={a.id}>{text(a)}</option>)}
            {khr.length > 0 && (
                <optgroup label={khrGroupLabel}>
                    {khr.map(a => <option key={a.id} value={a.id}>{text(a)}</option>)}
                </optgroup>
            )}
        </>
    );
};

export default CashBankOptions;
