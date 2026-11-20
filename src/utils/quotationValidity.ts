// Sales Setup › Defaults › Quotation validity (days): how long a new
// quotation stays valid (app_config salesSettings.quotationValidityDays).
// CRM › Quotations pre-fills a new quote's "Valid until" with today + that
// many days; the date can still be changed or cleared per quote. Pure
// helpers so the rules are unit-tested (tests/quotation-validity.test.mjs).
import { addDays, isDayKey } from './dateRange';

export const MAX_QUOTATION_VALIDITY_DAYS = 365;

// The saved setting as a whole number of days, or null when none (or a value
// that isn't 1–365 whole days) is saved.
export const quotationValidityDays = (saved: unknown): number | null => {
    const s = typeof saved === 'number' ? String(saved) : typeof saved === 'string' ? saved.trim() : '';
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return n >= 1 && n <= MAX_QUOTATION_VALIDITY_DAYS ? n : null;
};

// What the Defaults field saves for what was typed: '' clears the setting,
// a 1–365 whole number saves it (leading zeros dropped), anything else is
// refused (null) and nothing is saved.
export const quotationValidityInput = (typed: string): string | null => {
    const s = typed.trim();
    if (s === '') return '';
    const n = quotationValidityDays(s);
    return n === null ? null : String(n);
};

// A new quotation's "Valid until": today + the setting, or '' with none.
export const defaultQuotationValidUntil = (saved: unknown, today: string): string => {
    const n = quotationValidityDays(saved);
    return n !== null && isDayKey(today) ? addDays(today, n) : '';
};
