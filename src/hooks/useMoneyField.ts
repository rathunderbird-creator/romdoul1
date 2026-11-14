// State of a money field (see src/components/MoneyInput.tsx): a USD or riel
// (KHR) amount, the rate a riel amount converts at (pre-filled with the shop
// rate from Settings), the USD the books get, and the wrong-amount warning.
// The submit handler calls field.confirmIfSuspicious() before saving.
import { useCallback, useMemo, useState } from 'react';
import { useOptionalLanguage } from '../context/LanguageContext';
import {
    accountCurrency as accountCurrencyOf, amountWarningText, checkKhrAmount, checkRate, checkUsdAmount, formatKhr, formatRate, formatUsd,
    isKhrAccountName, khrToUsd, parseAmount, resolveMoney, shopRate as toShopRate, SNAP_CONFIRM_SHARE, usdToKhr,
    type AmountWarning, type Currency, type MoneyMeta,
} from '../utils/currency';
import { roundCents } from '../utils/money';
import { counterpartAccount } from '../utils/cashBankAccounts';

export type MoneyField = {
    amount: string;
    setAmount: (v: string) => void;
    currency: Currency;
    // Switches currency and converts the value (USD ↔ riel at the rate).
    setCurrency: (c: Currency) => void;
    // Switches currency and keeps the number ("It's riel" / "It's dollars").
    reinterpret: (c: Currency) => void;
    rate: string;
    setRate: (v: string) => void;
    resetRate: () => void;
    shopRate: number;
    // Puts the field back to a value (on open / edit).
    reset: (init?: { amount?: string | number; currency?: Currency; rate?: number | string }) => void;
    typed: number;            // what is in the box (NaN when empty)
    usd: number;              // what the books get
    meta: MoneyMeta;
    diffUsd: number;          // riel/rate − snapToUsd (0 without a target)
    snapToUsd: number | null;
    warning: AmountWarning | null;
    rateWarning: AmountWarning | null;
    rateInvalid: boolean;
    confirmIfSuspicious: () => boolean;
};

type Tr = (key: string, vars?: Record<string, string>) => string;

const fmtTyped = (n: number, c: Currency) => (c === 'KHR' ? String(Math.round(n)) : String(roundCents(n)));

export function useMoneyField(opts: {
    shopRate: number | null | undefined;
    maxPlausibleUsd?: number | null;
    snapToUsd?: number | null;
    // The form books this USD whatever is typed (Settle: the order's amount);
    // the confirm says so instead of the typed figure's USD.
    fixedBookedUsd?: number | null;
    init?: { amount?: string | number; currency?: Currency; rate?: number | string };
}): MoneyField {
    const shop = toShopRate(opts.shopRate);
    const lang = useOptionalLanguage();
    const t: Tr | undefined = useMemo(() => (lang ? (k: string) => lang.t(k) : undefined), [lang]);
    const [amount, setAmount] = useState<string>(opts.init?.amount !== undefined && opts.init.amount !== null ? String(opts.init.amount) : '');
    const [currency, setCurrencyState] = useState<Currency>(opts.init?.currency || 'USD');
    const [rate, setRate] = useState<string>(String(opts.init?.rate ?? shop));
    const rateNum = Number(rate);
    const effRate = rateNum > 0 ? rateNum : shop;

    const setCurrency = useCallback((c: Currency) => {
        if (c === currency) return;
        const n = parseAmount(amount);
        if (amount !== '' && Number.isFinite(n)) {
            setAmount(c === 'KHR' ? fmtTyped(usdToKhr(n, effRate), 'KHR') : fmtTyped(khrToUsd(n, effRate), 'USD'));
        }
        setCurrencyState(c);
        if (c === 'KHR' && !(Number(rate) > 0)) setRate(String(shop));
    }, [currency, amount, effRate, rate, shop]);

    const reinterpret = useCallback((c: Currency) => {
        setCurrencyState(c);
        if (c === 'KHR' && !(Number(rate) > 0)) setRate(String(shop));
    }, [rate, shop]);

    const reset = useCallback((init?: { amount?: string | number; currency?: Currency; rate?: number | string }) => {
        setAmount(init?.amount !== undefined && init.amount !== null ? String(init.amount) : '');
        setCurrencyState(init?.currency || 'USD');
        setRate(String(init?.rate ?? shop));
    }, [shop]);

    const snap = opts.snapToUsd ?? null;
    const fixed = opts.fixedBookedUsd ?? null;
    const typed = parseAmount(amount);
    const resolved = useMemo(() => resolveMoney({ amount, currency, rate: effRate, snapToUsd: snap }), [amount, currency, effRate, snap]);
    const rateCheck = currency === 'KHR' ? checkRate(rateNum, shop) : null;
    const rateInvalid = rateCheck === 'invalid';
    const rateWarning = rateCheck && rateCheck !== 'invalid' ? rateCheck : null;
    const warning = !Number.isFinite(typed) ? null
        : currency === 'USD' ? checkUsdAmount(typed, { rate: effRate, maxPlausibleUsd: opts.maxPlausibleUsd })
        : checkKhrAmount(typed, { rate: effRate });

    const confirmIfSuspicious = useCallback((): boolean => {
        if (rateInvalid) {
            window.alert(t?.('money.rateInvalid') && t('money.rateInvalid') !== 'money.rateInvalid'
                ? t('money.rateInvalid') : 'Enter a riel rate above 0.');
            return false;
        }
        const parts: string[] = [];
        if (warning) parts.push(amountWarningText(warning, t, fixed));
        if (rateWarning) parts.push(amountWarningText(rateWarning, t));
        if (currency === 'KHR' && snap !== null && snap > 0 && Math.abs(resolved.diffUsd) > snap * SNAP_CONFIRM_SHARE) {
            parts.push(`${formatKhr(typed)} @ ${formatRate(effRate)} = ${formatUsd(khrToUsd(typed, effRate))}, `
                + `but the amount due is ${formatUsd(snap)} (difference ${formatUsd(Math.abs(resolved.diffUsd))}). Go on?`);
        }
        return parts.length === 0 || window.confirm(parts.join('\n\n'));
    }, [rateInvalid, warning, rateWarning, currency, snap, resolved.diffUsd, typed, effRate, t, fixed]);

    return {
        amount, setAmount, currency, setCurrency, reinterpret, rate, setRate, resetRate: () => setRate(String(shop)), shopRate: shop, reset,
        typed, usd: resolved.usd, meta: resolved.meta, diffUsd: resolved.diffUsd, snapToUsd: snap,
        warning, rateWarning, rateInvalid, confirmIfSuspicious,
    };
}

// Keeps a field's currency in step with the cash/bank account picked: a
// riel account takes riel, a USD account dollars (the value converts).
export function syncFieldToAccount(field: MoneyField, accountCurrency: Currency) {
    if (field.currency !== accountCurrency) field.setCurrency(accountCurrency);
}

type CouplingAccount = { id: string; account_code?: string | null; account_name: string; account_type: string };

// A money field next to a cash/bank account picker: picking a riel account
// switches the amount to riel (and back), and flipping the currency toggle
// swaps to the same kind of account (cash/bank) in that currency. When the
// store has accounts but no riel one yet, the riel side is disabled.
export function useAccountCurrency(
    field: MoneyField,
    accounts: CouplingAccount[],
    accountId: string,
    setAccountId: (id: string) => void,
): {
    onAccountChange: (id: string) => void;
    onToggleCurrency: (c: Currency) => void;
    khrUnavailableReason: string | undefined;
    hasKhrAccounts: boolean;
} {
    const lang = useOptionalLanguage();
    const hasKhrAccounts = accounts.some(a => isKhrAccountName(a.account_name));
    const onAccountChange = (id: string) => {
        setAccountId(id);
        const a = accounts.find(x => x.id === id);
        if (a) syncFieldToAccount(field, accountCurrencyOf(a));
    };
    const onToggleCurrency = (c: Currency) => {
        const next = counterpartAccount(accounts, accountId, c);
        if (next) setAccountId(next.id);
    };
    const needKhr = lang?.t('money.needKhrAccount');
    const khrUnavailableReason = accounts.length > 0 && !hasKhrAccounts
        ? (needKhr && needKhr !== 'money.needKhrAccount' ? needKhr : 'Add a riel account first: run migrations/add_khr_currency.sql')
        : undefined;
    return { onAccountChange, onToggleCurrency, khrUnavailableReason, hasKhrAccounts };
}
