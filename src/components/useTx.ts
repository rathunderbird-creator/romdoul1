// Translation helpers for the shared components in src/components.
// tx('ui.components.x.y', 'English text', { n: 3 }) returns the text in the
// language picked (pos_language), or the English given here when no
// LanguageProvider is above (dev previews) or the key is missing.
// txNow() is the same for plain functions outside React (alerts, helpers).
import { useCallback } from 'react';
import { useOptionalLanguage } from '../context/LanguageContext';
import { fill, tNow } from '../i18n/translate';

export type Tx = (key: string, en: string, vars?: Record<string, string | number>) => string;

export const txNow: Tx = (key, en, vars) => {
    const v = tNow(key);
    return fill(v && v !== key ? v : en, vars);
};

export const useTx = (): Tx => {
    const lang = useOptionalLanguage();
    const t = lang?.t;
    return useCallback<Tx>((key, en, vars) => {
        const v = t ? t(key) : undefined;
        return fill(v && v !== key ? v : en, vars);
    }, [t]);
};

// An order's shipping status (stored English value) as shown on screen:
// status.* in the language picked; in English exactly orderStatusLabel().
const STATUS_KEYS: Record<string, string> = {
    Drafted: 'status.ordered', Confirmed: 'status.confirmed', Pending: 'status.pending', Shipped: 'status.shipped',
    Delivered: 'status.delivered', Cancelled: 'status.cancelled', Returned: 'status.returned', ReStock: 'status.restock',
};
export const orderStatusDisplay = (tx: Tx, status: string): string => {
    const key = STATUS_KEYS[status];
    const en = status === 'Returned' ? 'Returning' : status;
    return key ? tx(key, en) : status;
};
