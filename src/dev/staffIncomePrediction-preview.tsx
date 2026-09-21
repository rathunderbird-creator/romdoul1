// Dev-only preview: open http://localhost:5173/dev/staffIncomePrediction.html
// while `npm run dev` is running.
//
// Mounts the pure StaffIncomePredictionView with fixture data — no auth, no
// store, no Supabase. A slim grey bar on top switches scenario / language /
// mobile and echoes the last `actions.*` call. Not part of the production
// build (Vite only builds index.html).
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import ErrorBoundary from '../components/ErrorBoundary';
import { LanguageProvider, useLanguage } from '../context/LanguageContext';
import StaffIncomePredictionView from '../pages/staffIncomePrediction/StaffIncomePredictionView';
import type { StaffIncomeActions, StaffIncomeData, StaffIncomeUrlState } from '../pages/staffIncomePrediction/types';
import { fixtureMonth, fixtureNow, fixtureSales, fixtureProductsWithCost, fixtureUsers, fixtureConfigSalesmen } from './staffIncomePrediction-fixtures';

type Scenario = 'normal' | 'loading' | 'empty' | 'error';
const SCENARIOS: Scenario[] = ['normal', 'loading', 'empty', 'error'];

const devBarStyle = {
    display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 10,
    padding: '6px 12px', background: '#e5e7eb', color: '#374151',
    fontSize: 12, fontFamily: 'system-ui, sans-serif', borderBottom: '1px solid #d1d5db',
};
const controlStyle = { fontSize: 12, padding: '2px 6px', borderRadius: 6, border: '1px solid #9ca3af', background: '#fff' };

const Preview = () => {
    const { t, language, setLanguage } = useLanguage();
    const [scenario, setScenario] = useState<Scenario>('normal');
    const [state, setState] = useState<StaffIncomeUrlState>({ month: fixtureMonth, staff: null });
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    const [lastAction, setLastAction] = useState('—');

    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const data = useMemo<StaffIncomeData>(() => ({
        sales: scenario === 'empty' ? [] : fixtureSales,
        products: fixtureProductsWithCost,
        users: fixtureUsers,
        configSalesmen: fixtureConfigSalesmen,
        now: fixtureNow,
    }), [scenario]);

    const actions = useMemo<StaffIncomeActions>(() => {
        const log = (name: string, payload?: unknown) =>
            setLastAction(payload === undefined ? name : `${name} ${JSON.stringify(payload)}`);
        return {
            onMonthChange: month => { setState(s => ({ ...s, month })); log('monthChange', month); },
            onOpenStaff: staff => { setState(s => ({ ...s, staff })); log('openStaff', staff); },
            onBack: () => { setState(s => ({ ...s, staff: null })); log('back'); },
            onRefresh: () => log('refresh'),
        };
    }, []);

    return (
        <>
            <div style={devBarStyle}>
                <strong>Prediction by Staff preview</strong>
                <label>
                    scenario{' '}
                    <select value={scenario} onChange={e => setScenario(e.target.value as Scenario)} style={controlStyle}>
                        {SCENARIOS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </label>
                <button type="button" onClick={() => setLanguage(language === 'en' ? 'km' : 'en')} title="Switch language" style={{ ...controlStyle, cursor: 'pointer' }}>
                    {language === 'en' ? 'ខ្មែរ' : 'EN'}
                </button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={isMobile} onChange={e => setIsMobile(e.target.checked)} />
                    isMobile
                </label>
                <span style={{ marginLeft: 'auto', minWidth: 0, maxWidth: '60%', display: 'inline-flex', gap: 4 }}>
                    <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>last action:</span>
                    <code title={lastAction} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{lastAction}</code>
                </span>
            </div>
            <div style={{ background: '#f4f6fa', minHeight: '100vh' }}>
                <StaffIncomePredictionView
                    state={state}
                    data={data}
                    loading={scenario === 'loading'}
                    refreshing={false}
                    error={scenario === 'error' ? { message: 'network timeout', retry: () => setScenario('normal') } : null}
                    isMobile={isMobile}
                    t={t}
                    language={language}
                    actions={actions}
                />
            </div>
        </>
    );
};

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ErrorBoundary>
            <LanguageProvider>
                <Preview />
            </LanguageProvider>
        </ErrorBoundary>
    </StrictMode>,
);
