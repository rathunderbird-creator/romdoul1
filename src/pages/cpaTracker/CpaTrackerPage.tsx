// Profit & CPA Tracker — route container (/income-expense/cpa-tracker).
// Resolves store / header / toast / URL concerns and hands plain data +
// callbacks to the pure CpaTrackerView (which the dev preview in src/dev
// renders with fixtures).
//
// `products` deliberately comes from useCpaTrackerData (the full active +
// inactive catalogue), NOT useStore() — a discontinued product's history keeps
// its real price and cost.
import React, { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../../context/StoreContext';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';
import { useCpaTrackerData } from './useCpaTrackerData';
import { paramsToState, stateToParams } from './urlState';
import CpaTrackerView from './CpaTrackerView';
import type { CpaActions, CpaData } from './types';

const CpaTrackerPage: React.FC = () => {
    const { pages, currentUser, hasPermission } = useStore();
    const { setHeaderContent } = useHeader();
    const { t, language } = useLanguage();
    const { showToast } = useToast();
    const isMobile = useMobile();
    const [params, setParams] = useSearchParams();

    const state = useMemo(() => paramsToState(params, new Date()), [params]);
    const data = useCpaTrackerData(state.range, currentUser?.name);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('cpaTracker.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('cpaTracker.subtitle')}</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    const { refresh, commitEntry, commitSetting } = data;
    const actions = useMemo<CpaActions>(() => ({
        // Every view change replaces the history entry except a tab switch,
        // so Back steps through tabs but not through every filter tweak.
        onStateChange: next => setParams(stateToParams({ ...state, ...next }), { replace: !('tab' in next) || next.tab === state.tab }),
        onRefresh: () => refresh(),
        onCommitEntry: async (date, page, productId, patch) => {
            try {
                await commitEntry(date, page, productId, patch);
            } catch (e) {
                console.error('Profit & CPA Tracker: save failed', e);
                showToast(t('cpaTracker.saveFailed'), 'error');
                throw e;
            }
        },
        onCommitSetting: async (productId, field, value) => {
            try {
                await commitSetting(productId, field, value);
            } catch (e) {
                console.error('Profit & CPA Tracker: setting save failed', e);
                showToast(t('cpaTracker.saveFailed'), 'error');
                throw e;
            }
        },
    }), [setParams, state, refresh, commitEntry, commitSetting, showToast, t]);

    const viewData = useMemo<CpaData>(() => ({
        sales: data.sales,
        entries: data.entries,
        settings: data.settings,
        products: data.products,
        configPages: pages || [],
        now: data.now,
    }), [data.sales, data.entries, data.settings, data.products, data.now, pages]);

    return (
        <CpaTrackerView
            state={state}
            data={viewData}
            loading={data.loading}
            refreshing={data.refreshing}
            ready={data.ready}
            error={data.error ? { message: data.error, retry: refresh } : null}
            missingTables={data.missingTables}
            canEdit={hasPermission('manage_income_expense')}
            isMobile={isMobile}
            t={t}
            language={language}
            actions={actions}
        />
    );
};

export default CpaTrackerPage;
