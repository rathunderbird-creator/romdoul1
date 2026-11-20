import { useCallback } from 'react';
import type { Sale } from '../types';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { calculateDailySequence } from '../utils/orderUtils';
import { copyText } from '../utils/clipboard';
import { fillPaymentRequest, paymentRequestDue, paymentRequestTemplate, paymentRequestValues } from '../utils/paymentRequest';

// Copy payment request (Order Details, Orders rows / View / mobile card): the
// Sales Setup › Defaults message filled from an order, on the clipboard to
// paste into Telegram / Messenger. `sales` numbers the order within its day.
export const usePaymentRequest = (sales: Sale[]) => {
    const { salesSettings, storeName, khrExchangeRate } = useStore();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const template = salesSettings.paymentRequestMessage;
    const canRequest = useCallback((order: Sale) => paymentRequestDue(order) > 0, []);
    const copy = useCallback(async (order: Sale) => {
        const text = fillPaymentRequest(paymentRequestTemplate(template),
            paymentRequestValues(order, { orderNo: calculateDailySequence(order, sales), storeName, khrRate: khrExchangeRate }));
        const ok = await copyText(text);
        showToast(t(ok ? 'ui.components.orderDetails.paymentRequestCopied' : 'ui.components.orderDetails.paymentRequestCopyFailed'), ok ? 'success' : 'error');
    }, [template, sales, storeName, khrExchangeRate, showToast, t]);
    return { canRequest, copy };
};
