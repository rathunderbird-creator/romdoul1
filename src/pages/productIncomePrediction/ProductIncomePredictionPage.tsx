// Prediction by Product — route container (/income-expense/product-prediction).
// Resolves header / URL concerns and hands plain data + callbacks to the
// pure ProductIncomePredictionView (which the dev preview in src/dev renders
// with fixtures). No writes here — this screen is fully derived.
//
// Deliberately does NOT take `products` from useStore(): the store's list is
// active-only (the right choice everywhere else in the app), but this screen
// needs deactivated products too so a discontinued SKU's cost isn't silently
// dropped from the period's COGS — see useProductIncomeData.ts's own header
// comment for why.
import React, { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import { useMobile } from '../../hooks/useMobile';
import { useProductIncomeData } from './useProductIncomeData';
import { paramsToState, stateToParams } from './urlState';
import ProductIncomePredictionView from './ProductIncomePredictionView';
import type { ProductIncomeActions, ProductIncomeData } from './types';

const ProductIncomePredictionPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { t, language } = useLanguage();
    const isMobile = useMobile();
    const [params, setParams] = useSearchParams();

    const state = useMemo(() => paramsToState(params, new Date()), [params]);
    const data = useProductIncomeData(state.range);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('productPrediction.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('productPrediction.subtitle')}</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    const { refresh } = data;
    const actions = useMemo<ProductIncomeActions>(() => ({
        // Range changes replace the history entry; opening a product pushes
        // one, so the browser Back button returns to the overview for that range.
        onRangeChange: range => setParams(stateToParams({ range, productId: state.productId }), { replace: true }),
        onOpenProduct: productId => setParams(stateToParams({ range: state.range, productId })),
        onBack: () => setParams(stateToParams({ range: state.range, productId: null })),
        onRefresh: () => refresh(),
    }), [setParams, state.range, state.productId, refresh]);

    const viewData = useMemo<ProductIncomeData>(() => ({
        sales: data.sales,
        products: data.products,
        now: data.now,
    }), [data.sales, data.products, data.now]);

    return (
        <ProductIncomePredictionView
            state={state}
            data={viewData}
            loading={data.loading}
            refreshing={data.refreshing}
            error={data.error ? { message: data.error, retry: refresh } : null}
            isMobile={isMobile}
            t={t}
            language={language}
            actions={actions}
        />
    );
};

export default ProductIncomePredictionPage;
