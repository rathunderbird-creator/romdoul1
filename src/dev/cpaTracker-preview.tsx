// Dev-only preview: open http://localhost:5173/dev/cpaTracker.html while
// `npm run dev` is running.
//
// Mounts the pure CpaTrackerView with fixture data — no auth, no store, no
// Supabase. A slim grey bar switches scenario / language / mobile / edit
// permission and echoes the last `actions.*` call. Commits are applied to the
// in-memory entries / settings after a short delay so the spinner, "saved"
// flash and recalculated figures can be seen. Not part of the production build.
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import ErrorBoundary from '../components/ErrorBoundary';
import { LanguageProvider, useLanguage } from '../context/LanguageContext';
import CpaTrackerView from '../pages/cpaTracker/CpaTrackerView';
import type { CpaActions, CpaData, CpaUrlState } from '../pages/cpaTracker/types';
import { isEmptyEntry, type DailyEntryRow, type ProductSettingRow } from '../pages/cpaTracker/metrics';
import {
    cpaFixtureNow, cpaFixtureRange, cpaFixturePages, cpaFixtureProducts, cpaFixtureSales, cpaFixtureEntries, cpaFixtureSettings,
} from './cpaTracker-fixtures';

type Scenario = 'normal' | 'loading' | 'empty' | 'error' | 'missingTables' | 'noSettings' | 'saveFails';
const SCENARIOS: Scenario[] = ['normal', 'loading', 'empty', 'error', 'missingTables', 'noSettings', 'saveFails'];

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
    const [state, setState] = useState<CpaUrlState>({ range: cpaFixtureRange, tab: 'daily', page: null, product: null });
    const [entries, setEntries] = useState<DailyEntryRow[]>(cpaFixtureEntries);
    const [settings, setSettings] = useState<ProductSettingRow[]>(cpaFixtureSettings);
    const [canEdit, setCanEdit] = useState(true);
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    const [lastAction, setLastAction] = useState('—');

    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const data = useMemo<CpaData>(() => ({
        sales: scenario === 'empty' ? [] : cpaFixtureSales,
        entries: scenario === 'empty' ? [] : entries,
        settings: scenario === 'noSettings' ? [] : settings,
        products: cpaFixtureProducts,
        configPages: cpaFixturePages,
        now: cpaFixtureNow,
    }), [scenario, entries, settings]);

    const actions = useMemo<CpaActions>(() => {
        const log = (name: string, payload?: unknown) => setLastAction(payload === undefined ? name : `${name} ${JSON.stringify(payload)}`);
        const later = (apply: () => void) => new Promise<void>((resolve, reject) => {
            window.setTimeout(() => {
                if (scenarioRef.current === 'saveFails') { reject(new Error('simulated failure')); return; }
                apply();
                resolve();
            }, 400);
        });
        return {
            onStateChange: next => { setState(s => ({ ...s, ...next })); log('stateChange', next); },
            onRefresh: () => log('refresh'),
            onOpenOrders: filters => log('openOrders', filters),
            onCommitEntry: (date, page, productId, patch) => {
                log('commitEntry', { date, page, productId, ...patch });
                return later(() => setEntries(prev => {
                    const same = (r: DailyEntryRow) => r.date === date && r.page === page && r.productId === productId;
                    const existing = prev.find(same);
                    const next: DailyEntryRow = existing ? { ...existing } : { date, page, productId, adSpend: null, inboundChats: null, closedOverride: null, deliveredOverride: null };
                    for (const [field, value] of Object.entries(patch) as [keyof typeof patch, number | null][]) {
                        next[field] = value;
                    }
                    const rest = prev.filter(r => !same(r));
                    return isEmptyEntry(next) ? rest : [...rest, next];
                }));
            },
            onCommitSetting: (productId, field, value) => {
                log('commitSetting', { productId, field, value });
                return later(() => setSettings(prev => {
                    const existing = prev.find(s => s.productId === productId);
                    const next: ProductSettingRow = existing ? { ...existing } : { productId, courierFee: null, packaging: null, desiredProfit: null, expectedDeliveryRate: null };
                    next[field] = value;
                    return [...prev.filter(s => s.productId !== productId), next];
                }));
            },
        };
    }, []);

    return (
        <>
            <div style={devBarStyle}>
                <strong>Profit &amp; CPA Tracker preview</strong>
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
                <span style={{ color: '#6b7280' }}>{entries.length} entries · {settings.length} settings</span>
                <span style={{ marginLeft: 'auto', minWidth: 0, maxWidth: '55%', display: 'inline-flex', gap: 4 }}>
                    <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>last action:</span>
                    <code id="last-action" title={lastAction} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{lastAction}</code>
                </span>
            </div>
            <div style={{ background: '#f4f6fa', minHeight: '100vh' }}>
                <CpaTrackerView
                    state={state}
                    data={data}
                    loading={scenario === 'loading'}
                    refreshing={false}
                    ready={scenario !== 'loading' && scenario !== 'error'}
                    error={scenario === 'error' ? { message: 'network timeout', retry: () => setScenario('normal') } : null}
                    missingTables={scenario === 'missingTables'}
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
