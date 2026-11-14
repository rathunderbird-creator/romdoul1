// One money field for every payment / receipt / expense form: a USD or riel
// (KHR) amount, the rate a riel amount is converted at (pre-filled with the
// shop rate from Settings), the live USD equivalent, and the wrong-amount
// warning — a USD field given a riel-sized number (the Romdoul2 $2 delivery
// fee typed as 8000 and booked as $8,000) or a riel field given a dollar-
// sized one. It warns, never blocks: the submit handler calls
// field.confirmIfSuspicious(), which shows both readings and lets the user
// go on or fix it.
//
// useMoneyField (src/hooks/useMoneyField.ts) holds the state; <MoneyInput
// field={…}/> draws it. Forms with a cash/bank account picker keep the
// currency in step with the account (useAccountCurrency: a riel account
// takes riel).
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useOptionalLanguage } from '../context/LanguageContext';
import { amountWarningLine, formatKhr, formatRate, formatUsd, khrToUsd, type Currency } from '../utils/currency';
import type { MoneyField } from '../hooks/useMoneyField';

type Tr = (key: string, vars?: Record<string, string>) => string;

type MoneyInputProps = {
    field: MoneyField;
    label: string;
    // Show the USD / ៛ toggle (false: USD only, the warning still applies).
    allowKhr?: boolean;
    // The account decides the currency; the toggle shows it but is locked
    // unless onToggleCurrency is given.
    currencyLocked?: boolean;
    lockedReason?: string;
    // The store has no riel account yet: the ៛ side is disabled.
    khrUnavailableReason?: string;
    // Called before the field switches currency (the toggle, or the
    // warning's "It's riel" / "It's dollars"): a form with an account picker
    // swaps to the matching account in that currency. The field itself is
    // switched by MoneyInput.
    onToggleCurrency?: (c: Currency) => void;
    required?: boolean;
    autoFocus?: boolean;
    placeholder?: string;
    disabled?: boolean;
    labelStyle?: React.CSSProperties;
    inputStyle?: React.CSSProperties;
    id?: string;
};

const baseLabel: React.CSSProperties = { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' };
const baseInput: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: '10px', fontSize: '14px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main, var(--color-text))', boxSizing: 'border-box' };

const MoneyInput: React.FC<MoneyInputProps> = ({
    field, label, allowKhr = false, currencyLocked = false, lockedReason, khrUnavailableReason, onToggleCurrency,
    required, autoFocus, placeholder, disabled, labelStyle, inputStyle, id,
}) => {
    const lang = useOptionalLanguage();
    const t: Tr | undefined = lang ? (k => lang.t(k)) : undefined;
    const tx = (key: string, en: string) => {
        const v = t?.(key);
        return v && v !== key ? v : en;
    };
    const isKhr = field.currency === 'KHR';
    const toggle = (c: Currency) => {
        if (c === field.currency) return;
        onToggleCurrency?.(c);
        field.setCurrency(c);
    };
    const reread = (c: Currency) => {
        onToggleCurrency?.(c);
        field.reinterpret(c);
    };
    const toggleLocked = currencyLocked && !onToggleCurrency;
    const khrDisabled = !!khrUnavailableReason;
    const showToggle = allowKhr;
    const preview = isKhr && Number.isFinite(field.typed) && field.typed > 0;
    const showSnapDiff = isKhr && field.snapToUsd !== null && Number.isFinite(field.typed) && Math.abs(field.diffUsd) > 0.011;
    const seg = (c: Currency, text: string, off: boolean, title?: string) => (
        <button
            type="button"
            onClick={() => !off && toggle(c)}
            disabled={off || disabled}
            title={title}
            aria-pressed={field.currency === c}
            data-currency={c}
            style={{
                padding: '4px 10px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: off ? 'not-allowed' : 'pointer',
                background: field.currency === c ? 'var(--color-primary)' : 'transparent',
                color: field.currency === c ? '#fff' : 'var(--color-text-secondary)',
                opacity: off && field.currency !== c ? 0.45 : 1,
            }}
        >{text}</button>
    );

    return (
        <div data-money-input>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                <label htmlFor={id} style={{ ...baseLabel, ...labelStyle, marginBottom: 0 }}>
                    {label} ({isKhr ? '៛' : '$'}){required ? ' *' : ''}
                </label>
                {showToggle && (
                    <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}
                        title={toggleLocked ? lockedReason : undefined}>
                        {seg('USD', 'USD $', toggleLocked)}
                        {seg('KHR', '៛ KHR', toggleLocked || khrDisabled, khrDisabled ? khrUnavailableReason : (toggleLocked ? lockedReason : undefined))}
                    </div>
                )}
            </div>
            <input
                id={id}
                type="number"
                min="0"
                step={isKhr ? '100' : '0.01'}
                inputMode={isKhr ? 'numeric' : 'decimal'}
                autoFocus={autoFocus}
                disabled={disabled}
                value={field.amount}
                onChange={e => field.setAmount(e.target.value)}
                placeholder={placeholder ?? (isKhr ? 'e.g. 82000' : 'e.g. 20.00')}
                style={{ ...baseInput, fontSize: '16px', fontWeight: 600, ...inputStyle, ...(field.warning ? { border: '1px solid #F59E0B' } : {}) }}
            />
            {isKhr && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '12px', color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
                    <span>{tx('money.rate', 'Rate ៛ per $1')}</span>
                    <input
                        type="number"
                        min="1"
                        step="1"
                        value={field.rate}
                        disabled={disabled}
                        onChange={e => field.setRate(e.target.value)}
                        aria-label="Riel per dollar"
                        style={{ ...baseInput, width: '90px', padding: '4px 8px', fontSize: '13px', border: `1px solid ${field.rateInvalid ? '#DC2626' : (field.rateWarning ? '#F59E0B' : 'var(--color-border)')}` }}
                    />
                    {Number(field.rate) !== field.shopRate && (
                        <button type="button" onClick={field.resetRate}
                            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', fontSize: '12px' }}>
                            {tx('money.shopRate', 'shop rate')} {formatKhr(field.shopRate)}
                        </button>
                    )}
                    {preview && (
                        <span data-money-preview style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--color-text-main, var(--color-text))' }}>
                            {formatKhr(field.typed)} @ {formatRate(Number(field.rate) > 0 ? Number(field.rate) : field.shopRate)} = {formatUsd(khrToUsd(field.typed, Number(field.rate) > 0 ? Number(field.rate) : field.shopRate))}
                        </span>
                    )}
                </div>
            )}
            {field.rateInvalid && (
                <div style={{ marginTop: '6px', fontSize: '12px', color: '#DC2626' }}>{tx('money.rateInvalid', 'Enter a riel rate above 0.')}</div>
            )}
            {showSnapDiff && field.snapToUsd !== null && (
                <div data-money-snap style={{ marginTop: '6px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                    {`Due ${formatUsd(field.snapToUsd)}; ${formatKhr(field.typed)} = ${formatUsd(khrToUsd(field.typed, Number(field.rate) > 0 ? Number(field.rate) : field.shopRate))} — `}
                    {Math.abs(field.diffUsd) <= 0.03
                        ? 'matches.'
                        : `difference ${formatUsd(Math.abs(field.diffUsd))}.`}
                </div>
            )}
            {(field.warning || field.rateWarning) && (
                <div data-money-warning role="alert" style={{ marginTop: '8px', display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', borderRadius: '8px', fontSize: '12px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.55)', color: '#B45309' }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <div style={{ flex: 1 }}>
                        <div>{amountWarningLine((field.warning || field.rateWarning)!, t)}</div>
                        {field.warning?.kind === 'usd-looks-riel' && allowKhr && !toggleLocked && !khrDisabled && (
                            <button type="button" onClick={() => reread('KHR')}
                                style={warnBtn}>
                                {tx('money.itsRiel', "It's riel")} → {formatKhr(field.warning.typed)} = {formatUsd(field.warning.asRielUsd)}
                            </button>
                        )}
                        {field.warning?.kind === 'khr-looks-usd' && allowKhr && !toggleLocked && (
                            <button type="button" onClick={() => reread('USD')}
                                style={warnBtn}>
                                {tx('money.itsDollars', "It's dollars")} → {formatUsd(field.warning.asUsd)}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const warnBtn: React.CSSProperties = { marginTop: '6px', padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.7)', background: 'transparent', color: '#B45309', fontSize: '12px', fontWeight: 600, cursor: 'pointer' };

export default MoneyInput;
