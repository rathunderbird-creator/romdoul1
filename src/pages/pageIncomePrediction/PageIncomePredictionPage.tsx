// Prediction by Page — route container (/income-expense/page-prediction).
// Resolves store / header / toast / URL concerns and hands plain data +
// callbacks to the pure PageIncomePredictionView (which the dev preview in
// src/dev renders with fixtures).
//
// `products` deliberately comes from usePageIncomeData (which fetches the
// full active+inactive catalogue), NOT useStore() — see
// usePageIncomeData.ts's file header for why a discontinued SKU's cost must
// not be silently dropped from this month's COGS.
import React, { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../../context/StoreContext';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';
import { usePageIncomeData } from './usePageIncomeData';
import { paramsToState, stateToParams } from './urlState';
import PageIncomePredictionView from './PageIncomePredictionView';
import type { PageIncomeActions, PageIncomeData } from './types';

const PageIncomePredictionPage: React.FC = () => {
    const { pages, shippingRates, currentUser, hasPermission } = useStore();
    const { setHeaderContent } = useHeader();
    const { t, language } = useLanguage();
    const { showToast } = useToast();
    const isMobile = useMobile();
    const [params, setParams] = useSearchParams();

    const state = useMemo(() => paramsToState(params, new Date()), [params]);
    const data = usePageIncomeData(state.month, currentUser?.name);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('pagePrediction.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('pagePrediction.subtitle')}</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    const { refresh, commitInput } = data;
    const actions = useMemo<PageIncomeActions>(() => ({
        // Month changes replace the history entry; opening a page pushes one,
        // so the browser Back button returns to the overview for that month.
        onMonthChange: month => setParams(stateToParams({ month, page: state.page }), { replace: true }),
        onOpenPage: page => setParams(stateToParams({ month: state.month, page })),
        onBack: () => setParams(stateToParams({ month: state.month, page: null })),
        onRefresh: () => refresh(),
        onCommitInput: async (date, page, field, value) => {
            try {
                await commitInput(date, page, field, value);
            } catch (e) {
                console.error('Prediction by Page: save failed', e);
                showToast(t('pagePrediction.saveFailed'), 'error');
                throw e;
            }
        },
    }), [setParams, state.month, state.page, refresh, commitInput, showToast, t]);

    const viewData = useMemo<PageIncomeData>(() => ({
        sales: data.sales,
        inputs: data.inputs,
        sibling: data.sibling,
        staffInputs: data.staffInputs,
        products: data.products,
        shippingRates: shippingRates || {},
        configPages: pages,
        now: data.now,
    }), [data.sales, data.inputs, data.sibling, data.staffInputs, data.products, data.now, shippingRates, pages]);

    return (
        <PageIncomePredictionView
            state={state}
            data={viewData}
            loading={data.loading}
            refreshing={data.refreshing}
            error={data.error ? { message: data.error, retry: refresh } : null}
            missingTable={data.missingTable}
            canEdit={hasPermission('manage_income_expense')}
            isMobile={isMobile}
            t={t}
            language={language}
            actions={actions}
        />
    );
};

export default PageIncomePredictionPage;
