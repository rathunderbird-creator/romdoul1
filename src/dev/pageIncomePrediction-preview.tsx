// Dev-only preview: open http://localhost:5173/dev/pageIncomePrediction.html
// while `npm run dev` is running.
//
// Mounts the pure PageIncomePredictionView with fixture data so the page can
// be checked in a browser without logging in — no auth, no store, no
// Supabase. A slim grey bar on top switches scenario / language / mobile /
// edit permission and echoes the last `actions.*` call. Commits are applied
// to an in-memory inputs list after a short delay so the saving spinner,
// "saved" flash and recalculated rows can all be seen. Not part of the
// production build (Vite only builds index.html).
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import ErrorBoundary from '../components/ErrorBoundary';
import { LanguageProvider, useLanguage } from '../context/LanguageContext';
import PageIncomePredictionView from '../pages/pageIncomePrediction/PageIncomePredictionView';
import type { PageIncomeActions, PageIncomeData, PageIncomeUrlState } from '../pages/pageIncomePrediction/types';
import type { PageInputRow } from '../pages/pageIncomePrediction/metrics';
import {
    fixtureRange, fixtureNow, fixtureSales, fixtureProductsWithCost, fixtureShippingRates,
    fixturePages, fixtureInputs, fixtureSibling,
} from './pageIncomePrediction-fixtures';

type Scenario = 'normal' | 'loading' | 'empty' | 'error' | 'missingTable' | 'noSibling' | 'saveFails';
const SCENARIOS: Scenario[] = ['normal', 'loading', 'empty', 'error', 'missingTable', 'noSibling', 'saveFails'];

const devBarStyle = {
    display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 10,
    padding: '6px 12px', background: '#e5e7eb', color: '#374151',
    fontSize: 12, fontFamily: 'system-ui, sans-serif', borderBottom: '1px solid #d1d5db',
};
const controlStyle = { fontSize: 12, padding: '2px 6px', borderRadius: 6, border: '1px solid #9ca3af', background: '#fff' };

const Preview = () => {
    const { t, language, setLanguage } = useLanguage();
    const [scenario, setScenario] = useState<Scenario>('normal');
    const scenarioRef = useRef(scenario);
    scenarioRef.current = scenario;
    const [state, setState] = useState<PageIncomeUrlState>({ range: fixtureRange, page: null });
    const [inputs, setInputs] = useState<PageInputRow[]>(fixtureInputs);
    const [canEdit, setCanEdit] = useState(true);
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    const [lastAction, setLastAction] = useState('—');

    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const data = useMemo<PageIncomeData>(() => ({
        sales: scenario === 'empty' ? [] : fixtureSales,
        inputs,
        sibling: scenario === 'noSibling' ? null : fixtureSibling,
        products: fixtureProductsWithCost,
        shippingRates: fixtureShippingRates,
        configPages: fixturePages,
        now: fixtureNow,
    }), [scenario, inputs]);

    const actions = useMemo<PageIncomeActions>(() => {
        const log = (name: string, payload?: unknown) =>
            setLastAction(payload === undefined ? name : `${name} ${JSON.stringify(payload)}`);
        return {
            onRangeChange: range => { setState(s => ({ ...s, range })); log('rangeChange', range); },
            onOpenPage: page => { setState(s => ({ ...s, page })); log('openPage', page); },
            onBack: () => { setState(s => ({ ...s, page: null })); log('back'); },
            onRefresh: () => log('refresh'),
            onCommitInput: (date, page, field, value) => new Promise<void>((resolve, reject) => {
                log('commitInput', { date, page, field, value });
                window.setTimeout(() => {
                    if (scenarioRef.current === 'saveFails') { reject(new Error('simulated failure')); return; }
                    setInputs(prev => {
                        const existing = prev.find(r => r.date === date && r.page === page);
                        const next: PageInputRow = { date, page, boostPage: existing?.boostPage ?? 0, shipping: existing?.shipping ?? null };
                        if (field === 'boostPage') next.boostPage = value ?? 0; else next.shipping = value;
                        const rest = prev.filter(r => !(r.date === date && r.page === page));
                        return next.boostPage === 0 && next.shipping === null ? rest : [...rest, next];
                    });
                    resolve();
                }, 400);
            }),
        };
    }, []);

    return (
        <>
            <div style={devBarStyle}>
                <strong>Prediction by Page preview</strong>
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
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={canEdit} onChange={e => setCanEdit(e.target.checked)} />
                    canEdit
                </label>
                <span style={{ color: '#6b7280' }}>{inputs.length} input rows</span>
                <span style={{ marginLeft: 'auto', minWidth: 0, maxWidth: '60%', display: 'inline-flex', gap: 4 }}>
                    <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>last action:</span>
                    <code title={lastAction} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{lastAction}</code>
                </span>
            </div>
            <div style={{ background: '#f4f6fa', minHeight: '100vh' }}>
                <PageIncomePredictionView
                    state={state}
                    data={data}
                    loading={scenario === 'loading'}
                    refreshing={false}
                    error={scenario === 'error' ? { message: 'network timeout', retry: () => setScenario('normal') } : null}
                    missingTable={scenario === 'missingTable'}
                    canEdit={canEdit}
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
