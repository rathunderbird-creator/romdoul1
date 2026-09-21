// Prediction by Staff — route container (/income-expense/staff-prediction).
// Resolves store / header / URL concerns and hands plain data + callbacks to
// the pure StaffIncomePredictionView (which the dev preview in src/dev
// renders with fixtures). No writes here — this screen is fully derived.
//
// `products` deliberately comes from useStaffIncomeData (which fetches the
// full active+inactive catalogue), NOT useStore() — see that hook's file
// header for why a discontinued product's cost must not be silently dropped.
// `users` (for monthlyTarget) and `salesmen` (the Settings roster) DO come
// straight from useStore() — neither is COGS-sensitive the way products are.
import React, { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../../context/StoreContext';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import { useMobile } from '../../hooks/useMobile';
import { useStaffIncomeData } from './useStaffIncomeData';
import { paramsToState, stateToParams } from './urlState';
import StaffIncomePredictionView from './StaffIncomePredictionView';
import type { StaffIncomeActions, StaffIncomeData } from './types';

const StaffIncomePredictionPage: React.FC = () => {
    const { users, salesmen } = useStore();
    const { setHeaderContent } = useHeader();
    const { t, language } = useLanguage();
    const isMobile = useMobile();
    const [params, setParams] = useSearchParams();

    const state = useMemo(() => paramsToState(params, new Date()), [params]);
    const data = useStaffIncomeData(state.month);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('staffPrediction.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('staffPrediction.subtitle')}</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    const { refresh } = data;
    const actions = useMemo<StaffIncomeActions>(() => ({
        // Month changes replace the history entry; opening a staff member
        // pushes one, so the browser Back button returns to the overview
        // for that month.
        onMonthChange: month => setParams(stateToParams({ month, staff: state.staff }), { replace: true }),
        onOpenStaff: staff => setParams(stateToParams({ month: state.month, staff })),
        onBack: () => setParams(stateToParams({ month: state.month, staff: null })),
        onRefresh: () => refresh(),
    }), [setParams, state.month, state.staff, refresh]);

    const viewData = useMemo<StaffIncomeData>(() => ({
        sales: data.sales,
        products: data.products,
        users,
        configSalesmen: salesmen,
        now: data.now,
    }), [data.sales, data.products, data.now, users, salesmen]);

    return (
        <StaffIncomePredictionView
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

export default StaffIncomePredictionPage;
