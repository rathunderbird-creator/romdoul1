import React from 'react';
import { HandCoins } from 'lucide-react';
import type { Sale } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { usePaymentRequest } from '../hooks/usePaymentRequest';

// Order Details › Copy payment request (see usePaymentRequest). Shown only
// while the order still has something to pay.
// short: the one-word label (Orders' View popup, beside "Copy" and "Open").
const CopyPaymentRequestButton: React.FC<{ order: Sale; sales: Sale[]; style?: React.CSSProperties; short?: boolean }> = ({ order, sales, style, short }) => {
    const { t } = useLanguage();
    const { canRequest, copy } = usePaymentRequest(sales);
    if (!canRequest(order)) return null;
    return (
        <button type="button" onClick={() => { void copy(order); }} className="secondary-button"
            style={style ?? { display: 'flex', alignItems: 'center', gap: '8px' }}
            title={t('ui.components.orderDetails.paymentRequestHint')}
            aria-label={t('ui.components.orderDetails.copyPaymentRequest')}>
            <HandCoins size={16} /> {t(short ? 'ui.components.orderCard.payRequest' : 'ui.components.orderDetails.copyPaymentRequest')}
        </button>
    );
};

export default CopyPaymentRequestButton;
