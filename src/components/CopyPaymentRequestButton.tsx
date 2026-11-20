import React from 'react';
import { HandCoins } from 'lucide-react';
import type { Sale } from '../types';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { calculateDailySequence } from '../utils/orderUtils';
import { fillPaymentRequest, paymentRequestDue, paymentRequestTemplate, paymentRequestValues } from '../utils/paymentRequest';

// Order Details › Copy payment request: the Sales Setup › Defaults message,
// filled from this order, on the clipboard to paste into Telegram /
// Messenger. Shown only while the order still has something to pay.
const CopyPaymentRequestButton: React.FC<{ order: Sale; sales: Sale[] }> = ({ order, sales }) => {
    const { salesSettings, storeName, khrExchangeRate } = useStore();
    const { showToast } = useToast();
    const { t } = useLanguage();
    if (paymentRequestDue(order) <= 0) return null;
    const copy = async () => {
        const text = fillPaymentRequest(paymentRequestTemplate(salesSettings.paymentRequestMessage),
            paymentRequestValues(order, { orderNo: calculateDailySequence(order, sales), storeName, khrRate: khrExchangeRate }));
        try {
            await navigator.clipboard.writeText(text);
            showToast(t('ui.components.orderDetails.paymentRequestCopied'), 'success');
        } catch {
            showToast(t('ui.components.orderDetails.paymentRequestCopyFailed'), 'error');
        }
    };
    return (
        <button onClick={copy} className="secondary-button" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            title={t('ui.components.orderDetails.paymentRequestHint')}>
            <HandCoins size={16} /> {t('ui.components.orderDetails.copyPaymentRequest')}
        </button>
    );
};

export default CopyPaymentRequestButton;
