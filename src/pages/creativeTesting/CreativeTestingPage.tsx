// Creative Testing — the "Product CPA & Creative Testing Tracker" workbook as
// a page, in the Profit & CPA Tracker section.
//
//   Testing Sandbox = 7-day creative AB tests. Each row's verdict is computed
//     with the workbook's decision rules (validated against every sheet row):
//       no delivered + spend >= 2x target gross CPA  -> KILL (no results)
//       realized net CPA  > break-even CPA           -> KILL (above break-even)
//       >= 3 delivered and net CPA <= target net CPA -> GRADUATE TO SCALING
//       otherwise                                    -> HOLD & MONITOR
//   Winner Ads = graduated creatives being scaled. Health per the workbook:
//       net 7-day CPA > break-even      -> UNPROFITABLE   (pause immediately)
//       frequency >= 2.8                -> FATIGUE        (swap hook)
//       net 7-day CPA <= target net CPA -> SCALE HEALTHY  (+15-20% budget)
//       otherwise                       -> STABLE / MARGIN SQUEEZE (hold)
//
// Targets are never typed in: they come live from the product catalogue +
// cpa_product_settings through the CPA tracker's own unitEconomicsOf, so this
// page always agrees with the Unit Economics tab.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, Pencil, GraduationCap, AlertTriangle, FlaskConical, Trophy, X } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../utils/fetchAll';
import { fetchAllProducts } from '../../utils/fetchAllProducts';
import { settingsMapOf, unitEconomicsOf, type ProductSettingRow, type UnitEconomics } from '../cpaTracker/metrics';
import type { Product } from '../../types';

const GREEN = '#10B981', RED = '#EF4444', AMBER = '#F59E0B', BLUE = '#3B82F6', PURPLE = '#8B5CF6';

const fmt = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayYmd = (): string => {
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

interface TestRow {
    id: string; launchDate: string; page: string; productId: string | null; productName: string;
    hook: string; adSpend: number; inboundChats: number; closedOrders: number; deliveredOrders: number; decision: string;
}
interface WinnerRow {
    id: string; graduatedDate: string | null; postId: string; page: string; productId: string | null; productName: string;
    hook: string; dailyBudget: number; spend7d: number; delivered7d: number; frequency: number | null; ctr: number | null; notes: string;
}

type Verdict = { key: 'none' | 'testing' | 'graduate' | 'hold' | 'kill-zero' | 'kill-be'; label: string; color: string };
const verdictOf = (spend: number, delivered: number, econ: UnitEconomics | null): Verdict => {
    if (spend <= 0 && delivered <= 0) return { key: 'none', label: '—', color: 'var(--color-text-muted)' };
    if (!econ) return { key: 'testing', label: 'NO TARGETS', color: AMBER };
    if (delivered === 0) {
        return econ.targetGrossCpa > 0 && spend >= 2 * econ.targetGrossCpa
            ? { key: 'kill-zero', label: 'KILL · no results', color: RED }
            : { key: 'testing', label: 'KEEP TESTING', color: BLUE };
    }
    const net = spend / delivered;
    if (net > econ.breakEvenCpa) return { key: 'kill-be', label: 'KILL · above break-even', color: RED };
    if (delivered >= 3 && net <= econ.targetNetCpa) return { key: 'graduate', label: 'GRADUATE TO SCALING', color: GREEN };
    return { key: 'hold', label: 'HOLD & MONITOR', color: AMBER };
};

type Health = { key: 'none' | 'unprofitable' | 'fatigue' | 'scale' | 'stable'; label: string; action: string; color: string };
const healthOf = (spend7: number, delivered7: number, frequency: number | null, econ: UnitEconomics | null): Health => {
    if (spend7 <= 0 && delivered7 <= 0) return { key: 'none', label: '—', action: '—', color: 'var(--color-text-muted)' };
    if (!econ) return { key: 'none', label: 'NO TARGETS', action: 'Set product economics first', color: AMBER };
    const net = delivered7 > 0 ? spend7 / delivered7 : Infinity;
    if (net > econ.breakEvenCpa) return { key: 'unprofitable', label: 'UNPROFITABLE', action: 'Pause Ad Immediately', color: RED };
    if ((frequency ?? 0) >= 2.8) return { key: 'fatigue', label: 'FATIGUE WARNING', action: 'Swap Hook / Queue Replacement', color: AMBER };
    if (net <= econ.targetNetCpa) return { key: 'scale', label: 'SCALE HEALTHY', action: 'Scale Budget +15-20%', color: GREEN };
    return { key: 'stable', label: 'STABLE / MARGIN SQUEEZE', action: 'Hold Budget Steady', color: BLUE };
};

const Chip: React.FC<{ label: string; color: string }> = ({ label, color }) => (
    <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.3px', color, background: `${color.startsWith('var') ? 'transparent' : color + '1F'}`, border: `1px solid ${color.startsWith('var') ? 'var(--color-border)' : color + '55'}`, whiteSpace: 'nowrap' }}>
        {label}
    </span>
);

const emptyTestForm = () => ({ id: '', launchDate: todayYmd(), page: '', productId: '', hook: '', adSpend: '', inboundChats: '', closedOrders: '', deliveredOrders: '' });
const emptyWinnerForm = () => ({ id: '', graduatedDate: todayYmd(), postId: '', page: '', productId: '', hook: '', dailyBudget: '', spend7d: '', delivered7d: '', frequency: '', ctr: '', notes: '' });

const CreativeTestingPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const isMobile = useMobile();

    const [tab, setTab] = useState<'sandbox' | 'winners'>('sandbox');
    const [products, setProducts] = useState<Product[]>([]);
    const [settings, setSettings] = useState<ProductSettingRow[]>([]);
    const [tests, setTests] = useState<TestRow[] | null>(null);
    const [winners, setWinners] = useState<WinnerRow[] | null>(null);
    const [setupNeeded, setSetupNeeded] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const refetch = useCallback(() => setRefreshKey(k => k + 1), []);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Creative Testing</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>7-day creative tests and the winners being scaled</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const missingTable = (e: { code?: string; message?: string } | null) =>
                    !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|find the table/i.test(e.message || ''));

                const [prods, settingRows, testRes, winnerRes] = await Promise.all([
                    fetchAllProducts(),
                    fetchAll((from, to) => supabase.from('cpa_product_settings').select('*').order('product_id', { ascending: true }).range(from, to)),
                    supabase.from('creative_tests').select('*').order('launch_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000),
                    supabase.from('winner_ads').select('*').order('graduated_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(1000),
                ]);
                if (!alive) return;
                setProducts(prods);
                type Raw = Record<string, unknown>;
                setSettings((settingRows as Raw[]).map(r => ({
                    productId: String(r.product_id),
                    courierFee: numOrNull(r.courier_fee),
                    packaging: numOrNull(r.packaging),
                    desiredProfit: numOrNull(r.desired_profit),
                    expectedDeliveryRate: numOrNull(r.expected_delivery_rate),
                })));
                if (missingTable(testRes.error) || missingTable(winnerRes.error)) {
                    setSetupNeeded(true);
                    setTests([]); setWinners([]);
                    return;
                }
                if (testRes.error) throw testRes.error;
                if (winnerRes.error) throw winnerRes.error;
                setSetupNeeded(false);
                setTests(((testRes.data || []) as Raw[]).map(r => ({
                    id: String(r.id), launchDate: String(r.launch_date || ''), page: String(r.page || ''),
                    productId: r.product_id ? String(r.product_id) : null, productName: String(r.product_name || ''),
                    hook: String(r.hook || ''), adSpend: Number(r.ad_spend) || 0, inboundChats: Number(r.inbound_chats) || 0,
                    closedOrders: Number(r.closed_orders) || 0, deliveredOrders: Number(r.delivered_orders) || 0, decision: String(r.decision || ''),
                })));
                setWinners(((winnerRes.data || []) as Raw[]).map(r => ({
                    id: String(r.id), graduatedDate: r.graduated_date ? String(r.graduated_date) : null, postId: String(r.post_id || ''),
                    page: String(r.page || ''), productId: r.product_id ? String(r.product_id) : null, productName: String(r.product_name || ''),
                    hook: String(r.hook || ''), dailyBudget: Number(r.daily_budget) || 0, spend7d: Number(r.spend_7d) || 0,
                    delivered7d: Number(r.delivered_7d) || 0, frequency: numOrNull(r.frequency), ctr: numOrNull(r.ctr), notes: String(r.notes || ''),
                })));
            } catch (e) {
                console.error('Creative Testing load failed:', e);
                if (alive) { setTests([]); setWinners([]); showToast('Failed to load creative tests', 'error'); }
            }
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshKey]);

    const settingsMap = useMemo(() => settingsMapOf(settings), [settings]);
    const econById = useMemo(() => {
        const m = new Map<string, UnitEconomics>();
        for (const p of products) m.set(p.id, unitEconomicsOf(p, settingsMap));
        return m;
    }, [products, settingsMap]);
    const activeProducts = useMemo(
        () => products.filter(p => p.isActive !== false).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        [products]
    );
    const econOf = (productId: string | null): UnitEconomics | null => (productId && econById.get(productId)) || null;

    // ── Forms (create + edit share one form per tab) ──
    const [testForm, setTestForm] = useState(emptyTestForm());
    const [winnerForm, setWinnerForm] = useState(emptyWinnerForm());
    const [isSaving, setIsSaving] = useState(false);
    const loading = tests === null || winners === null;

    const saveTest = async () => {
        const productName = activeProducts.find(p => p.id === testForm.productId)?.name || '';
        if (!testForm.launchDate || !testForm.productId || isSaving) return;
        setIsSaving(true);
        try {
            const payload = {
                launch_date: testForm.launchDate, page: testForm.page.trim(), product_id: testForm.productId,
                product_name: productName, hook: testForm.hook.trim(),
                ad_spend: Number(testForm.adSpend) || 0, inbound_chats: Math.round(Number(testForm.inboundChats) || 0),
                closed_orders: Math.round(Number(testForm.closedOrders) || 0), delivered_orders: Math.round(Number(testForm.deliveredOrders) || 0),
            };
            const q = testForm.id
                ? supabase.from('creative_tests').update(payload).eq('id', testForm.id)
                : supabase.from('creative_tests').insert([payload]);
            const { error } = await q;
            if (error) throw error;
            showToast(testForm.id ? 'Test updated' : 'Test added', 'success');
            setTestForm(emptyTestForm());
            refetch();
        } catch (e) {
            showToast('Failed to save test: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally { setIsSaving(false); }
    };

    const saveWinner = async () => {
        const productName = activeProducts.find(p => p.id === winnerForm.productId)?.name || '';
        if (!winnerForm.productId || isSaving) return;
        setIsSaving(true);
        try {
            const payload = {
                graduated_date: winnerForm.graduatedDate || null, post_id: winnerForm.postId.trim(), page: winnerForm.page.trim(),
                product_id: winnerForm.productId, product_name: productName, hook: winnerForm.hook.trim(),
                daily_budget: Number(winnerForm.dailyBudget) || 0, spend_7d: Number(winnerForm.spend7d) || 0,
                delivered_7d: Math.round(Number(winnerForm.delivered7d) || 0),
                frequency: winnerForm.frequency === '' ? null : Number(winnerForm.frequency),
                ctr: winnerForm.ctr === '' ? null : Number(winnerForm.ctr),
                notes: winnerForm.notes.trim(),
            };
            const q = winnerForm.id
                ? supabase.from('winner_ads').update(payload).eq('id', winnerForm.id)
                : supabase.from('winner_ads').insert([payload]);
            const { error } = await q;
            if (error) throw error;
            showToast(winnerForm.id ? 'Winner updated' : 'Winner added', 'success');
            setWinnerForm(emptyWinnerForm());
            refetch();
        } catch (e) {
            showToast('Failed to save winner: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally { setIsSaving(false); }
    };

    const deleteRow = async (table: 'creative_tests' | 'winner_ads', id: string, what: string) => {
        if (!confirm(`Delete this ${what}?`)) return;
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) showToast('Delete failed: ' + error.message, 'error');
        else { showToast('Deleted', 'success'); refetch(); }
    };

    const setDecision = async (t: TestRow, decision: string) => {
        setTests(prev => prev ? prev.map(x => x.id === t.id ? { ...x, decision } : x) : prev);
        const { error } = await supabase.from('creative_tests').update({ decision }).eq('id', t.id);
        if (error) { showToast('Failed to save decision: ' + error.message, 'error'); refetch(); }
    };

    const graduate = (t: TestRow) => {
        setWinnerForm({
            ...emptyWinnerForm(),
            graduatedDate: todayYmd(), page: t.page, productId: t.productId || '', hook: t.hook,
        });
        setTab('winners');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast('Fill in the winner details and save', 'info');
    };

    // ── KPIs ──
    const kpis = useMemo(() => {
        const ts = tests || [], ws = winners || [];
        const verdicts = ts.map(t => verdictOf(t.adSpend, t.deliveredOrders, econOf(t.productId)).key);
        const wHealth = ws.map(w => healthOf(w.spend7d, w.delivered7d, w.frequency, econOf(w.productId)).key);
        return {
            tests: ts.length,
            testSpend: ts.reduce((s, t) => s + t.adSpend, 0),
            graduates: verdicts.filter(v => v === 'graduate').length,
            kills: verdicts.filter(v => v === 'kill-zero' || v === 'kill-be').length,
            winners: ws.length,
            winnerSpend: ws.reduce((s, w) => s + w.spend7d, 0),
            winnerDelivered: ws.reduce((s, w) => s + w.delivered7d, 0),
            needAction: wHealth.filter(h => h === 'unprofitable' || h === 'fatigue').length,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tests, winners, econById]);

    const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
    const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' };
    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
        background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', outline: 'none',
    };
    const thStyle: React.CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' };
    const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '12.5px', color: 'var(--color-text-main)', whiteSpace: 'nowrap' };
    const tdNum: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

    const kpiCards = tab === 'sandbox'
        ? [
            { label: 'Tests', value: String(kpis.tests), color: BLUE },
            { label: 'Test Spend', value: `$${fmt(kpis.testSpend)}`, color: AMBER },
            { label: 'Ready To Graduate', value: String(kpis.graduates), color: GREEN },
            { label: 'To Kill', value: String(kpis.kills), color: RED },
        ]
        : [
            { label: 'Winner Ads', value: String(kpis.winners), color: PURPLE },
            { label: '7-Day Spend', value: `$${fmt(kpis.winnerSpend)}`, color: AMBER },
            { label: '7-Day Delivered', value: String(kpis.winnerDelivered), color: GREEN },
            { label: 'Need Action', value: String(kpis.needAction), color: RED },
        ];

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '4px', alignSelf: 'flex-start', flexWrap: 'wrap' }}>
                {([['sandbox', 'Testing Sandbox', FlaskConical], ['winners', 'Winner Ads', Trophy]] as const).map(([key, label, Icon]) => (
                    <button key={key} onClick={() => setTab(key)} style={{
                        display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 16px', borderRadius: '9px', border: 'none',
                        background: tab === key ? 'var(--color-surface)' : 'transparent', color: tab === key ? BLUE : 'var(--color-text-secondary)',
                        fontWeight: tab === key ? 700 : 500, fontSize: '13px', cursor: 'pointer', boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                    }}>
                        <Icon size={15} /> {label}
                    </button>
                ))}
                <button onClick={refetch} title="Reload" style={{ display: 'flex', alignItems: 'center', padding: '9px 12px', borderRadius: '9px', border: 'none', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                    <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
                </button>
            </div>

            {setupNeeded && (
                <div style={{ ...cardStyle, borderLeft: `4px solid ${AMBER}`, padding: '14px 18px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <AlertTriangle size={20} color={AMBER} style={{ flexShrink: 0 }} />
                    <div style={{ fontSize: '13px', color: 'var(--color-text-main)' }}>
                        <strong>Database setup needed.</strong> Run <code>migrations/creative_testing.sql</code> in this instance's Supabase SQL editor, then press the reload button above.
                    </div>
                </div>
            )}

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
                {kpiCards.map(c => (
                    <div key={c.label} style={{ ...cardStyle, borderTop: `3px solid ${c.color}`, padding: '12px 16px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{c.label}</div>
                        <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : c.value}</div>
                    </div>
                ))}
            </div>

            {/* Entry form */}
            {!setupNeeded && tab === 'sandbox' && (
                <div style={{ ...cardStyle, borderLeft: `4px solid ${BLUE}`, padding: '16px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>{testForm.id ? 'Edit Test' : 'New Creative Test'}</div>
                        {testForm.id && (
                            <button onClick={() => setTestForm(emptyTestForm())} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer' }}>
                                <X size={13} /> Cancel edit
                            </button>
                        )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', alignItems: 'end' }}>
                        <div><label style={labelStyle}>Launch Date</label><input type="date" value={testForm.launchDate} onChange={e => setTestForm(f => ({ ...f, launchDate: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Ad Account / Page</label><input type="text" className="d2-khmer" placeholder="e.g. VT Speaker" value={testForm.page} onChange={e => setTestForm(f => ({ ...f, page: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Product</label>
                            <select value={testForm.productId} onChange={e => setTestForm(f => ({ ...f, productId: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="">Select product…</option>
                                {activeProducts.map(p => <option key={p.id} value={p.id}>{p.name}{p.model ? ` (${p.model})` : ''}</option>)}
                            </select>
                        </div>
                        <div style={{ gridColumn: isMobile ? 'auto' : 'span 2' }}><label style={labelStyle}>Creative Angle / Hook</label><input type="text" className="d2-khmer" placeholder="e.g. Water Subwoofer Bass Vibration" value={testForm.hook} onChange={e => setTestForm(f => ({ ...f, hook: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Ad Spend ($)</label><input type="number" min="0" step="0.01" placeholder="0.00" value={testForm.adSpend} onChange={e => setTestForm(f => ({ ...f, adSpend: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Inbound Chats</label><input type="number" min="0" step="1" placeholder="0" value={testForm.inboundChats} onChange={e => setTestForm(f => ({ ...f, inboundChats: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Closed Orders</label><input type="number" min="0" step="1" placeholder="0" value={testForm.closedOrders} onChange={e => setTestForm(f => ({ ...f, closedOrders: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Delivered Orders</label><input type="number" min="0" step="1" placeholder="0" value={testForm.deliveredOrders} onChange={e => setTestForm(f => ({ ...f, deliveredOrders: e.target.value }))} style={inputStyle} /></div>
                        <button onClick={saveTest} disabled={!testForm.launchDate || !testForm.productId || isSaving} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', padding: '10px 14px', borderRadius: '9px', border: 'none', height: '38px',
                            background: testForm.productId && !isSaving ? BLUE : 'var(--color-border)', color: testForm.productId && !isSaving ? 'white' : 'var(--color-text-muted)',
                            fontSize: '13px', fontWeight: 700, cursor: testForm.productId && !isSaving ? 'pointer' : 'not-allowed',
                        }}>
                            <Plus size={15} /> {isSaving ? 'Saving…' : testForm.id ? 'Update Test' : 'Add Test'}
                        </button>
                    </div>
                </div>
            )}

            {!setupNeeded && tab === 'winners' && (
                <div style={{ ...cardStyle, borderLeft: `4px solid ${PURPLE}`, padding: '16px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>{winnerForm.id ? 'Edit Winner Ad' : 'New Winner Ad'}</div>
                        {winnerForm.id && (
                            <button onClick={() => setWinnerForm(emptyWinnerForm())} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer' }}>
                                <X size={13} /> Cancel edit
                            </button>
                        )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', alignItems: 'end' }}>
                        <div><label style={labelStyle}>Date Graduated</label><input type="date" value={winnerForm.graduatedDate} onChange={e => setWinnerForm(f => ({ ...f, graduatedDate: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Post ID</label><input type="text" placeholder="1203859…" value={winnerForm.postId} onChange={e => setWinnerForm(f => ({ ...f, postId: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Ad Account / Page</label><input type="text" className="d2-khmer" value={winnerForm.page} onChange={e => setWinnerForm(f => ({ ...f, page: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Product</label>
                            <select value={winnerForm.productId} onChange={e => setWinnerForm(f => ({ ...f, productId: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="">Select product…</option>
                                {activeProducts.map(p => <option key={p.id} value={p.id}>{p.name}{p.model ? ` (${p.model})` : ''}</option>)}
                            </select>
                        </div>
                        <div style={{ gridColumn: isMobile ? 'auto' : 'span 2' }}><label style={labelStyle}>Winning Creative Hook</label><input type="text" className="d2-khmer" value={winnerForm.hook} onChange={e => setWinnerForm(f => ({ ...f, hook: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Daily Budget ($)</label><input type="number" min="0" step="0.01" placeholder="0.00" value={winnerForm.dailyBudget} onChange={e => setWinnerForm(f => ({ ...f, dailyBudget: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>7-Day Spend ($)</label><input type="number" min="0" step="0.01" placeholder="0.00" value={winnerForm.spend7d} onChange={e => setWinnerForm(f => ({ ...f, spend7d: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>7-Day Delivered</label><input type="number" min="0" step="1" placeholder="0" value={winnerForm.delivered7d} onChange={e => setWinnerForm(f => ({ ...f, delivered7d: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Frequency</label><input type="number" min="0" step="0.01" placeholder="e.g. 1.85" value={winnerForm.frequency} onChange={e => setWinnerForm(f => ({ ...f, frequency: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>CTR (%)</label><input type="number" min="0" step="0.1" placeholder="e.g. 2.3" value={winnerForm.ctr} onChange={e => setWinnerForm(f => ({ ...f, ctr: e.target.value }))} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Notes</label><input type="text" className="d2-khmer" value={winnerForm.notes} onChange={e => setWinnerForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} /></div>
                        <button onClick={saveWinner} disabled={!winnerForm.productId || isSaving} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', padding: '10px 14px', borderRadius: '9px', border: 'none', height: '38px',
                            background: winnerForm.productId && !isSaving ? PURPLE : 'var(--color-border)', color: winnerForm.productId && !isSaving ? 'white' : 'var(--color-text-muted)',
                            fontSize: '13px', fontWeight: 700, cursor: winnerForm.productId && !isSaving ? 'pointer' : 'not-allowed',
                        }}>
                            <Plus size={15} /> {isSaving ? 'Saving…' : winnerForm.id ? 'Update Winner' : 'Add Winner'}
                        </button>
                    </div>
                </div>
            )}

            {/* Rows */}
            <div style={{ ...cardStyle, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading…</div>
                ) : tab === 'sandbox' ? (
                    (tests || []).length === 0 ? (
                        <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>No creative tests yet — add the first one above.</div>
                    ) : isMobile ? (
                        (tests || []).map(t => {
                            const econ = econOf(t.productId);
                            const v = verdictOf(t.adSpend, t.deliveredOrders, econ);
                            const net = t.deliveredOrders > 0 ? t.adSpend / t.deliveredOrders : null;
                            return (
                                <div key={t.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                                        <span className="d2-khmer" style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.productName}</span>
                                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', flexShrink: 0 }}>{t.launchDate}</span>
                                    </div>
                                    <div className="d2-khmer" style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '3px 0' }}>{t.hook || '—'}{t.page ? ` · ${t.page}` : ''}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                                        ${fmt(t.adSpend)} · {t.inboundChats} chats · {t.closedOrders} closed · {t.deliveredOrders} delivered
                                        {net !== null && econ && <> · CPA ${fmt(net)} / target ${fmt(econ.targetNetCpa)}</>}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '7px', gap: '8px' }}>
                                        <Chip label={v.label} color={v.color} />
                                        <span style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                            {v.key === 'graduate' && <GraduationCap size={16} color={GREEN} style={{ cursor: 'pointer' }} onClick={() => graduate(t)} />}
                                            <Pencil size={14} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => setTestForm({ id: t.id, launchDate: t.launchDate, page: t.page, productId: t.productId || '', hook: t.hook, adSpend: String(t.adSpend || ''), inboundChats: String(t.inboundChats || ''), closedOrders: String(t.closedOrders || ''), deliveredOrders: String(t.deliveredOrders || '') })} />
                                            <Trash2 size={14} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => deleteRow('creative_tests', t.id, 'test')} />
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1280px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                        <th style={thStyle}>Date</th><th style={thStyle}>Page</th><th style={thStyle}>Product</th><th style={thStyle}>Hook</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Spend</th><th style={{ ...thStyle, textAlign: 'right' }}>Chats</th><th style={{ ...thStyle, textAlign: 'right' }}>$/Chat</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Closed</th><th style={{ ...thStyle, textAlign: 'right' }}>Close %</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Delivered</th><th style={{ ...thStyle, textAlign: 'right' }}>Net CPA</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Target / BE</th>
                                        <th style={{ ...thStyle, textAlign: 'center' }}>Verdict</th><th style={{ ...thStyle, textAlign: 'center' }}>Decision</th><th style={thStyle}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(tests || []).map((t, idx) => {
                                        const econ = econOf(t.productId);
                                        const v = verdictOf(t.adSpend, t.deliveredOrders, econ);
                                        const net = t.deliveredOrders > 0 ? t.adSpend / t.deliveredOrders : null;
                                        const costChat = t.inboundChats > 0 ? t.adSpend / t.inboundChats : null;
                                        const closeRate = t.inboundChats > 0 ? (t.closedOrders / t.inboundChats) * 100 : null;
                                        return (
                                            <tr key={t.id} style={{ borderBottom: '1px solid var(--color-border)', background: idx % 2 ? 'rgba(127,127,127,0.03)' : 'transparent' }}>
                                                <td style={tdStyle}>{t.launchDate}</td>
                                                <td className="d2-khmer" style={{ ...tdStyle, maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.page}>{t.page || '—'}</td>
                                                <td className="d2-khmer" style={{ ...tdStyle, fontWeight: 600, maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.productName}>{t.productName}</td>
                                                <td className="d2-khmer" style={{ ...tdStyle, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text-secondary)' }} title={t.hook}>{t.hook || '—'}</td>
                                                <td style={tdNum}>${fmt(t.adSpend)}</td>
                                                <td style={tdNum}>{t.inboundChats}</td>
                                                <td style={{ ...tdNum, color: 'var(--color-text-secondary)' }}>{costChat !== null ? `$${fmt(costChat)}` : '—'}</td>
                                                <td style={tdNum}>{t.closedOrders}</td>
                                                <td style={{ ...tdNum, color: 'var(--color-text-secondary)' }}>{closeRate !== null ? `${closeRate.toFixed(1)}%` : '—'}</td>
                                                <td style={{ ...tdNum, fontWeight: 700 }}>{t.deliveredOrders}</td>
                                                <td style={{ ...tdNum, fontWeight: 700, color: net !== null && econ ? (net <= econ.targetNetCpa ? GREEN : net > econ.breakEvenCpa ? RED : AMBER) : 'var(--color-text-main)' }}>{net !== null ? `$${fmt(net)}` : '—'}</td>
                                                <td style={{ ...tdNum, color: 'var(--color-text-secondary)' }}>{econ ? `$${fmt(econ.targetNetCpa)} / $${fmt(econ.breakEvenCpa)}` : '—'}</td>
                                                <td style={{ ...tdStyle, textAlign: 'center' }}><Chip label={v.label} color={v.color} /></td>
                                                <td style={{ ...tdStyle, textAlign: 'center' }}>
                                                    <select value={t.decision} onChange={e => setDecision(t, e.target.value)} style={{ padding: '4px 8px', borderRadius: '7px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '11.5px', cursor: 'pointer' }}>
                                                        <option value="">—</option><option value="SCALE">SCALE</option><option value="HOLD">HOLD</option><option value="KILL">KILL</option>
                                                    </select>
                                                </td>
                                                <td style={{ ...tdStyle, textAlign: 'right' }}>
                                                    <span style={{ display: 'inline-flex', gap: '12px', alignItems: 'center' }}>
                                                        {v.key === 'graduate' && <GraduationCap size={16} color={GREEN} style={{ cursor: 'pointer' }} onClick={() => graduate(t)} />}
                                                        <Pencil size={14} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => setTestForm({ id: t.id, launchDate: t.launchDate, page: t.page, productId: t.productId || '', hook: t.hook, adSpend: String(t.adSpend || ''), inboundChats: String(t.inboundChats || ''), closedOrders: String(t.closedOrders || ''), deliveredOrders: String(t.deliveredOrders || '') })} />
                                                        <Trash2 size={14} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => deleteRow('creative_tests', t.id, 'test')} />
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )
                ) : (
                    (winners || []).length === 0 ? (
                        <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>No winner ads yet — graduate a test or add one above.</div>
                    ) : isMobile ? (
                        (winners || []).map(w => {
                            const econ = econOf(w.productId);
                            const h = healthOf(w.spend7d, w.delivered7d, w.frequency, econ);
                            const net = w.delivered7d > 0 ? w.spend7d / w.delivered7d : null;
                            return (
                                <div key={w.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                                        <span className="d2-khmer" style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.productName}</span>
                                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', flexShrink: 0 }}>{w.graduatedDate || '—'}</span>
                                    </div>
                                    <div className="d2-khmer" style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '3px 0' }}>{w.hook || '—'}{w.page ? ` · ${w.page}` : ''}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                                        ${fmt(w.spend7d)} / 7d · {w.delivered7d} delivered{net !== null && <> · CPA ${fmt(net)}</>}{econ && <> / target ${fmt(econ.targetNetCpa)}</>}
                                        {w.frequency !== null && <> · freq {w.frequency}</>}{w.ctr !== null && <> · CTR {w.ctr}%</>}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '7px', gap: '8px' }}>
                                        <Chip label={h.label} color={h.color} />
                                        <span style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                            <Pencil size={14} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => setWinnerForm({ id: w.id, graduatedDate: w.graduatedDate || '', postId: w.postId, page: w.page, productId: w.productId || '', hook: w.hook, dailyBudget: String(w.dailyBudget || ''), spend7d: String(w.spend7d || ''), delivered7d: String(w.delivered7d || ''), frequency: w.frequency === null ? '' : String(w.frequency), ctr: w.ctr === null ? '' : String(w.ctr), notes: w.notes })} />
                                            <Trash2 size={14} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => deleteRow('winner_ads', w.id, 'winner ad')} />
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '11.5px', color: h.key === 'unprofitable' || h.key === 'fatigue' ? h.color : 'var(--color-text-muted)', marginTop: '4px', fontWeight: 600 }}>{h.action}</div>
                                </div>
                            );
                        })
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1280px' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
                                        <th style={thStyle}>Graduated</th><th style={thStyle}>Post ID</th><th style={thStyle}>Page</th><th style={thStyle}>Product</th><th style={thStyle}>Hook</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Budget/d</th><th style={{ ...thStyle, textAlign: 'right' }}>7d Spend</th><th style={{ ...thStyle, textAlign: 'right' }}>7d Del.</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>7d CPA</th><th style={{ ...thStyle, textAlign: 'right' }}>Target / BE</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Freq</th><th style={{ ...thStyle, textAlign: 'right' }}>CTR</th>
                                        <th style={{ ...thStyle, textAlign: 'center' }}>Health</th><th style={thStyle}>Action</th><th style={thStyle}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(winners || []).map((w, idx) => {
                                        const econ = econOf(w.productId);
                                        const h = healthOf(w.spend7d, w.delivered7d, w.frequency, econ);
                                        const net = w.delivered7d > 0 ? w.spend7d / w.delivered7d : null;
                                        return (
                                            <tr key={w.id} style={{ borderBottom: '1px solid var(--color-border)', background: idx % 2 ? 'rgba(127,127,127,0.03)' : 'transparent' }}>
                                                <td style={tdStyle}>{w.graduatedDate || '—'}</td>
                                                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '11px', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text-secondary)' }} title={w.postId}>{w.postId || '—'}</td>
                                                <td className="d2-khmer" style={{ ...tdStyle, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={w.page}>{w.page || '—'}</td>
                                                <td className="d2-khmer" style={{ ...tdStyle, fontWeight: 600, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={w.productName}>{w.productName}</td>
                                                <td className="d2-khmer" style={{ ...tdStyle, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text-secondary)' }} title={w.hook}>{w.hook || '—'}</td>
                                                <td style={tdNum}>${fmt(w.dailyBudget)}</td>
                                                <td style={tdNum}>${fmt(w.spend7d)}</td>
                                                <td style={{ ...tdNum, fontWeight: 700 }}>{w.delivered7d}</td>
                                                <td style={{ ...tdNum, fontWeight: 700, color: net !== null && econ ? (net <= econ.targetNetCpa ? GREEN : net > econ.breakEvenCpa ? RED : AMBER) : 'var(--color-text-main)' }}>{net !== null ? `$${fmt(net)}` : '—'}</td>
                                                <td style={{ ...tdNum, color: 'var(--color-text-secondary)' }}>{econ ? `$${fmt(econ.targetNetCpa)} / $${fmt(econ.breakEvenCpa)}` : '—'}</td>
                                                <td style={{ ...tdNum, color: (w.frequency ?? 0) >= 2.8 ? AMBER : 'var(--color-text-secondary)', fontWeight: (w.frequency ?? 0) >= 2.8 ? 700 : 400 }}>{w.frequency ?? '—'}</td>
                                                <td style={{ ...tdNum, color: w.ctr === null ? 'var(--color-text-secondary)' : w.ctr >= 2 ? GREEN : w.ctr < 1 ? RED : 'var(--color-text-secondary)', fontWeight: w.ctr !== null && (w.ctr >= 2 || w.ctr < 1) ? 700 : 400 }}>{w.ctr !== null ? `${w.ctr}%` : '—'}</td>
                                                <td style={{ ...tdStyle, textAlign: 'center' }}><Chip label={h.label} color={h.color} /></td>
                                                <td style={{ ...tdStyle, fontSize: '11.5px', color: h.key === 'unprofitable' || h.key === 'fatigue' ? h.color : 'var(--color-text-secondary)', fontWeight: h.key === 'unprofitable' ? 700 : 500 }}>{h.action}</td>
                                                <td style={{ ...tdStyle, textAlign: 'right' }}>
                                                    <span style={{ display: 'inline-flex', gap: '12px', alignItems: 'center' }}>
                                                        <Pencil size={14} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => setWinnerForm({ id: w.id, graduatedDate: w.graduatedDate || '', postId: w.postId, page: w.page, productId: w.productId || '', hook: w.hook, dailyBudget: String(w.dailyBudget || ''), spend7d: String(w.spend7d || ''), delivered7d: String(w.delivered7d || ''), frequency: w.frequency === null ? '' : String(w.frequency), ctr: w.ctr === null ? '' : String(w.ctr), notes: w.notes })} />
                                                        <Trash2 size={14} color="var(--color-text-muted)" style={{ cursor: 'pointer' }} onClick={() => deleteRow('winner_ads', w.id, 'winner ad')} />
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )
                )}
            </div>

            {/* The decision rules, so the verdicts explain themselves */}
            <div style={{ ...cardStyle, padding: '12px 18px', fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                <strong style={{ color: 'var(--color-text-main)' }}>Rules</strong> — Sandbox: <span style={{ color: GREEN, fontWeight: 600 }}>GRADUATE</span> at ≥ 3 delivered with net CPA ≤ target · <span style={{ color: AMBER, fontWeight: 600 }}>HOLD</span> between target and break-even · <span style={{ color: RED, fontWeight: 600 }}>KILL</span> above break-even, or spend ≥ 2× target with nothing delivered.
                Winners: <span style={{ color: RED, fontWeight: 600 }}>UNPROFITABLE</span> above break-even (pause) · <span style={{ color: AMBER, fontWeight: 600 }}>FATIGUE</span> at frequency ≥ 2.8 (swap hook) · <span style={{ color: GREEN, fontWeight: 600 }}>SCALE HEALTHY</span> at or under target (+15–20% budget) · CTR ≥ 2% strong, &lt; 1% weak. Targets come from Unit Economics in the CPA Tracker.
            </div>

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default CreativeTestingPage;
