// Riel Revaluation (Accounting): riel payments, phase 3 — foreign-exchange
// gain and loss on the riel accounts (1002 Cash on Hand (KHR), 1011 Bank
// Account ABA (KHR)). The books stay in USD; this page reads each riel
// account's riel balance from the journal and
//   * drafts a revaluation (FX-REVAL-…) that brings every riel account to
//     riel balance / the rate picked, the difference to Foreign Exchange
//     Gain / Loss (an unrealised gain or loss);
//   * drafts an exchange (FX-CONV-…) when riel is sold for dollars at the
//     bank (or bought): selling takes the riel out at its book value, the
//     difference to the dollars received is the realised gain or loss.
// Both are Drafts, posted by the owner on Journal Entries like every other
// Draft. The rules live in utils/fxRevaluation.ts
// (tests/fx-revaluation.test.mjs). Needs migrations/add_khr_currency.sql
// (the riel accounts and the currency columns); the two FX accounts are
// added from this page when the chart has none.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, AlertTriangle, Scale, ArrowRightLeft, Trash2, BookOpen, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMobile } from '../../hooks/useMobile';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import { fill } from '../../i18n/translate';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../context/StoreContext';
import { useAccounting } from '../../hooks/useAccounting';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../utils/fetchAll';
import { nextJournalEntryNumber } from '../../utils/journalEntryNumber';
import { isCashBankAccount, sortCashBankForPicker } from '../../utils/cashBankAccounts';
import {
    formatKhr, formatRate, formatUsd, isKhrAccountName, isMissingCurrencyColumnError, khrMeta, parseAmount,
    RATE_WARN_MAX, RATE_WARN_MIN, shopRate as toShopRate,
} from '../../utils/currency';
import { roundCents } from '../../utils/money';
import {
    exchangeLines, findFxAccounts, freeAccountCode, FX_CONV_PREFIX, FX_GAIN_NAME, FX_LOSS_NAME, FX_REVAL_PREFIX,
    revaluationLines, revaluationRows, rielBalances, type ExchangeDirection, type FxEntry, type FxLine,
} from '../../utils/fxRevaluation';
import type { ChartOfAccount } from '../../types';

const BLUE = '#2563EB';
const GREEN = '#047857';
const RED = '#B91C1C';

const todayYmd = (): string => {
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const signedUsd = (n: number): string => (n > 0 ? '+' : '') + formatUsd(n);

interface FxListRow {
    id: string;
    date: string;
    number: string;
    kind: 'reval' | 'conv';
    description: string;
    status: string;
    fxNet: number;              // + gain, − loss (the lines on the FX accounts)
}

const FxRevaluationPage: React.FC = () => {
    const isMobile = useMobile();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const tf = (k: string) => t('ui.accounting.fx.' + k);
    const { khrExchangeRate } = useStore();
    const shop = toShopRate(khrExchangeRate);
    const { saveJournalEntry, saveAccount } = useAccounting();
    const navigate = useNavigate();

    const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
    const [lines, setLines] = useState<FxLine[] | null>(null);
    const [entries, setEntries] = useState<Map<string, FxEntry>>(new Map());
    const [fxRows, setFxRows] = useState<FxListRow[]>([]);
    const [noCurrencyColumns, setNoCurrencyColumns] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const refetch = useCallback(() => setRefreshKey(k => k + 1), []);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>{tf('title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>{tf('subtitle')}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setHeaderContent, t]);

    useEffect(() => {
        let alive = true;
        setLoadError(null);
        (async () => {
            try {
                const { data: accs, error: accErr } = await supabase.from('chart_of_accounts').select('*').order('account_code', { ascending: true });
                if (accErr) throw accErr;
                const all = (accs || []) as ChartOfAccount[];
                const rielIds = all.filter(a => a.account_type === 'Asset' && isCashBankAccount(a) && isKhrAccountName(a.account_name)).map(a => a.id);
                const { gain, loss } = findFxAccounts(all);

                // Every line on a riel account, with its entry's riel tag
                // (the columns arrive with add_khr_currency.sql).
                type Raw = { id: unknown; journal_entry_id: unknown; account_id: unknown; debit: unknown; credit: unknown;
                    entry: { id?: unknown; date?: unknown; status?: unknown; reference_id?: unknown; currency?: unknown; original_amount?: unknown; exchange_rate?: unknown } | null };
                const load = (withCurrency: boolean) => fetchAll((from, to) => supabase
                    .from('journal_entry_lines')
                    .select(`id, journal_entry_id, account_id, debit, credit, entry:journal_entries!inner(id, date, status, reference_id${withCurrency ? ', currency, original_amount, exchange_rate' : ''})`)
                    .in('account_id', rielIds)
                    .order('id', { ascending: true })
                    .range(from, to), 1000, { label: 'FxRevaluationPage riel lines', maxRows: 100000 }) as Promise<Raw[]>;
                let raw: Raw[] = [];
                let withCurrency = true;
                if (rielIds.length) {
                    try { raw = await load(true); } catch (e) {
                        if (!isMissingCurrencyColumnError(e)) throw e;
                        withCurrency = false;
                        raw = await load(false);
                    }
                }
                const entryMap = new Map<string, FxEntry>();
                const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
                for (const r of raw) {
                    const e = r.entry;
                    if (!e) continue;
                    const id = String(e.id);
                    if (!entryMap.has(id)) entryMap.set(id, {
                        id, date: String(e.date || '').slice(0, 10), status: String(e.status || 'Posted'),
                        reference_id: e.reference_id ? String(e.reference_id) : null,
                        currency: e.currency ? String(e.currency) : null,
                        original_amount: numOrNull(e.original_amount), exchange_rate: numOrNull(e.exchange_rate),
                    });
                }

                // The FX entries this page drafted, for the list.
                const { data: fxData, error: fxErr } = await supabase.from('journal_entries')
                    .select('id, date, description, reference_id, entry_number, status, lines:journal_entry_lines(account_id, debit, credit)')
                    .like('reference_id', 'FX-%').order('date', { ascending: false }).limit(1000);
                if (fxErr) throw fxErr;
                type FxRaw = { id: unknown; date: unknown; description: unknown; reference_id: unknown; entry_number?: unknown; status?: unknown; lines: { account_id: unknown; debit: unknown; credit: unknown }[] | null };
                const fxIds = new Set([gain?.id, loss?.id].filter(Boolean) as string[]);
                const list: FxListRow[] = ((fxData || []) as unknown as FxRaw[])
                    .filter(e => String(e.reference_id || '').startsWith(FX_REVAL_PREFIX) || String(e.reference_id || '').startsWith(FX_CONV_PREFIX))
                    .map(e => ({
                        id: String(e.id),
                        date: String(e.date || '').slice(0, 10),
                        number: String(e.entry_number || e.reference_id || ''),
                        kind: String(e.reference_id || '').startsWith(FX_REVAL_PREFIX) ? 'reval' as const : 'conv' as const,
                        description: String(e.description || ''),
                        status: String(e.status || 'Posted'),
                        fxNet: roundCents((e.lines || []).filter(l => fxIds.has(String(l.account_id)))
                            .reduce((s, l) => s + (Number(l.credit) || 0) - (Number(l.debit) || 0), 0)),
                    }));

                if (!alive) return;
                setAccounts(all);
                setEntries(entryMap);
                setLines(raw.map(r => ({ entryId: String(r.journal_entry_id), accountId: String(r.account_id), debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 })));
                setNoCurrencyColumns(!withCurrency);
                setFxRows(list);
            } catch (e) {
                console.error('Failed to load riel balances:', e);
                if (!alive) return;
                setLoadError(e instanceof Error ? e.message : String(e));
                setLines(prev => prev ?? []);
            }
        })();
        return () => { alive = false; };
    }, [refreshKey]);

    const nameOf = useCallback((id: string) => accounts.find(a => a.id === id)?.account_name || '?', [accounts]);
    const rielAccounts = useMemo(
        () => sortCashBankForPicker(accounts.filter(a => a.is_active && a.account_type === 'Asset' && isCashBankAccount(a) && isKhrAccountName(a.account_name))),
        [accounts]
    );
    const usdAccounts = useMemo(
        () => sortCashBankForPicker(accounts.filter(a => a.is_active && a.account_type === 'Asset' && isCashBankAccount(a) && !isKhrAccountName(a.account_name))),
        [accounts]
    );
    const fx = useMemo(() => findFxAccounts(accounts), [accounts]);
    const loading = lines === null;

    // ── FX accounts ──
    const [creatingAccounts, setCreatingAccounts] = useState(false);
    const createFxAccounts = async () => {
        setCreatingAccounts(true);
        try {
            if (!fx.gain) await saveAccount({ account_code: freeAccountCode(accounts, '4910'), account_name: FX_GAIN_NAME, account_type: 'Revenue', sub_type: 'Other Revenue', description: 'Gains on riel (KHR) balances: revaluation and exchange', is_active: true });
            if (!fx.loss) await saveAccount({ account_code: freeAccountCode(accounts, '6910'), account_name: FX_LOSS_NAME, account_type: 'Expense', sub_type: 'Other Expense', description: 'Losses on riel (KHR) balances: revaluation and exchange', is_active: true });
            refetch();
        } catch {
            // saveAccount has shown the error.
        } finally {
            setCreatingAccounts(false);
        }
    };

    // ── Revaluation ──
    const [asOf, setAsOf] = useState(todayYmd());
    const [rateText, setRateText] = useState(String(shop));
    useEffect(() => { setRateText(String(shop)); }, [shop]);
    const rate = parseAmount(rateText);
    const rateInvalid = !(rate > 0);
    const rateOdd = !rateInvalid && (rate < RATE_WARN_MIN || rate > RATE_WARN_MAX);

    const balances = useMemo(
        () => rielBalances(lines || [], entries, rielAccounts.map(a => a.id), { asOf, postedOnly: true, fallbackRate: rateInvalid ? shop : rate }),
        [lines, entries, rielAccounts, asOf, rate, rateInvalid, shop]
    );
    const rows = useMemo(() => (rateInvalid ? [] : revaluationRows(balances.values(), rate)), [balances, rate, rateInvalid]);
    const netDiff = roundCents(rows.reduce((s, r) => s + r.diffUsd, 0));
    const draftsLeftOut = Array.from(balances.values()).reduce((s, b) => s + b.draftLines, 0);
    const untagged = Array.from(balances.values()).flatMap(b => b.untaggedEntryIds.map(id => ({ id, account: b.accountId })));
    const pendingReval = fxRows.find(r => r.kind === 'reval' && r.status === 'Draft');
    const [savingReval, setSavingReval] = useState(false);
    const canReval = !savingReval && !loading && !rateInvalid && !!fx.gain && !!fx.loss && rows.some(r => r.diffUsd !== 0) && !pendingReval;

    const draftRevaluation = async () => {
        if (!canReval || !fx.gain || !fx.loss) return;
        const rateLabel = `${formatKhr(rate)} per $1`;
        const { lines: jl, net } = revaluationLines(rows, { gainId: fx.gain.id, lossId: fx.loss.id }, { account: nameOf, rateText: rateLabel });
        if (jl.length === 0) return;
        if (rateOdd && !confirm(fill(tf('confirm.oddRate'), { rate: formatRate(rate), min: formatRate(RATE_WARN_MIN), max: formatRate(RATE_WARN_MAX) }))) return;
        if (!confirm(fill(tf(net >= 0 ? 'confirm.revalGain' : 'confirm.revalLoss'), { amount: formatUsd(Math.abs(net)), rate: formatRate(rate), date: asOf }))) return;
        setSavingReval(true);
        try {
            const entryNumber = await nextJournalEntryNumber('FX', asOf);
            await saveJournalEntry({
                date: asOf,
                description: `Riel revaluation at ${rateLabel} (as of ${asOf})`,
                reference_id: `${FX_REVAL_PREFIX}${asOf.replace(/-/g, '')}-${Date.now()}`,
                status: 'Draft',
                ...(entryNumber ? { entry_number: entryNumber } : {}),
            }, jl);
            showToast(tf('toast.revalSaved'), 'success');
            refetch();
        } catch (e) {
            showToast(tf('toast.saveFailed') + ': ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setSavingReval(false);
        }
    };

    // ── Exchange ──
    const [exDate, setExDate] = useState(todayYmd());
    const [direction, setDirection] = useState<ExchangeDirection>('sellRiel');
    const [exRielId, setExRielId] = useState('');
    const [exUsdId, setExUsdId] = useState('');
    const [exRiel, setExRiel] = useState('');
    const [exUsd, setExUsd] = useState('');
    const [exRef, setExRef] = useState('');
    const [savingEx, setSavingEx] = useState(false);
    useEffect(() => {
        if (rielAccounts.length && !rielAccounts.some(a => a.id === exRielId)) {
            setExRielId((rielAccounts.find(a => /bank|aba/i.test(a.account_name)) || rielAccounts[0]).id);
        }
        if (usdAccounts.length && !usdAccounts.some(a => a.id === exUsdId)) {
            setExUsdId((usdAccounts.find(a => /bank|aba/i.test(a.account_name)) || usdAccounts[0]).id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rielAccounts, usdAccounts]);
    const exRielN = parseAmount(exRiel);
    const exUsdN = parseAmount(exUsd);
    // The riel account before the exchange: every line up to its date,
    // Drafts included (the average rate is a ratio; a Draft receipt is riel
    // the account holds all the same).
    const exBalance = useMemo(
        () => rielBalances(lines || [], entries, exRielId ? [exRielId] : [], { asOf: exDate, fallbackRate: shop }).get(exRielId),
        [lines, entries, exRielId, exDate, shop]
    );
    const exPreview = useMemo(() => {
        if (!(exRielN > 0) || !(exUsdN > 0) || !exRielId || !exUsdId || !fx.gain || !fx.loss) return null;
        return exchangeLines({
            direction, rielAccountId: exRielId, usdAccountId: exUsdId, riel: exRielN, usd: exUsdN,
            balance: exBalance ? { riel: exBalance.riel, usd: exBalance.usd } : undefined,
            fallbackRate: shop, gainId: fx.gain.id, lossId: fx.loss.id,
        }, { riel: nameOf(exRielId), usd: nameOf(exUsdId) });
    }, [direction, exRielId, exUsdId, exRielN, exUsdN, exBalance, shop, fx, nameOf]);
    const oversell = direction === 'sellRiel' && exBalance && exRielN > exBalance.riel;
    const canExchange = !savingEx && !!exPreview && !!exDate;

    const draftExchange = async () => {
        if (!canExchange || !exPreview) return;
        if (oversell && !confirm(fill(tf('confirm.oversell'), { riel: formatKhr(exRielN), balance: formatKhr(exBalance?.riel || 0) }))) return;
        if (exPreview.rate < RATE_WARN_MIN || exPreview.rate > RATE_WARN_MAX) {
            if (!confirm(fill(tf('confirm.oddRate'), { rate: formatRate(exPreview.rate), min: formatRate(RATE_WARN_MIN), max: formatRate(RATE_WARN_MAX) }))) return;
        }
        setSavingEx(true);
        try {
            const verb = direction === 'sellRiel' ? 'sold' : 'bought';
            const entryNumber = await nextJournalEntryNumber('FX', exDate);
            await saveJournalEntry({
                date: exDate,
                description: `Riel exchange — ${verb} ${formatKhr(exRielN)} for ${formatUsd(exUsdN)} (${formatKhr(exPreview.rate)} per $1)${exRef.trim() ? ` · REF ${exRef.trim()}` : ''}`,
                reference_id: `${FX_CONV_PREFIX}${Date.now()}`,
                status: 'Draft',
                ...(entryNumber ? { entry_number: entryNumber } : {}),
                ...khrMeta(exRielN, exPreview.rate),
            }, exPreview.lines);
            showToast(tf('toast.exchangeSaved'), 'success');
            setExRiel(''); setExUsd(''); setExRef('');
            refetch();
        } catch (e) {
            showToast(tf('toast.saveFailed') + ': ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setSavingEx(false);
        }
    };

    // ── List: delete a Draft ──
    const [busyId, setBusyId] = useState<string | null>(null);
    const deleteDraft = async (r: FxListRow) => {
        if (r.status !== 'Draft' || busyId) return;
        if (!confirm(fill(tf('confirm.delete'), { number: r.number, date: r.date }))) return;
        setBusyId(r.id);
        try {
            const { error: lineErr } = await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', r.id);
            if (lineErr) throw lineErr;
            const { error: entryErr } = await supabase.from('journal_entries').delete().eq('id', r.id).eq('status', 'Draft');
            if (entryErr) throw entryErr;
            showToast(tf('toast.deleted'), 'success');
            refetch();
        } catch (e) {
            showToast(tf('toast.deleteFailed') + ': ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setBusyId(null);
        }
    };

    // ── Styles ──
    const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
    const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', minHeight: '22px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' };
    const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', outline: 'none' };
    const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' };
    const primary = (enabled: boolean): React.CSSProperties => ({
        display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '9px', border: 'none',
        background: enabled ? BLUE : 'var(--color-border)', color: enabled ? 'white' : 'var(--color-text-muted)',
        fontSize: '13px', fontWeight: 700, cursor: enabled ? 'pointer' : 'not-allowed', height: '38px', flexShrink: 0,
    });
    const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-text-secondary)', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' };
    const td: React.CSSProperties = { fontSize: '13px', color: 'var(--color-text-main)', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', verticalAlign: 'top' };
    const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
    const diffColor = (n: number) => (n > 0 ? GREEN : n < 0 ? RED : 'var(--color-text-muted)');
    const notice = (tone: 'warn' | 'info', children: React.ReactNode) => (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px', borderRadius: '10px', fontSize: '13px', color: 'var(--color-text-main)',
            background: tone === 'warn' ? 'rgba(245, 158, 11, 0.08)' : 'rgba(37, 99, 235, 0.06)', border: `1px solid ${tone === 'warn' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(37, 99, 235, 0.25)'}` }}>
            <AlertTriangle size={16} color={tone === 'warn' ? '#F59E0B' : BLUE} style={{ flexShrink: 0, marginTop: '1px' }} />
            <div style={{ flex: 1 }}>{children}</div>
        </div>
    );
    const cardHead = (icon: React.ReactNode, title: string, hint?: string) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: `${BLUE}1A`, color: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
            <div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text-main)' }}>{title}</div>
                {hint && <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>{hint}</div>}
            </div>
        </div>
    );

    if (!loading && rielAccounts.length === 0) {
        return (
            <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {loadError && notice('warn', loadError)}
                {notice('warn', tf('noRielAccounts'))}
            </div>
        );
    }

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {loadError && notice('warn', loadError)}
            {noCurrencyColumns && notice('warn', tf('noCurrencyColumns'))}
            {!loading && (!fx.gain || !fx.loss) && notice('info', (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                    <span>{fill(tf('noFxAccounts'), { gain: FX_GAIN_NAME, loss: FX_LOSS_NAME })}</span>
                    <button onClick={createFxAccounts} disabled={creatingAccounts} style={primary(!creatingAccounts)}>
                        <Plus size={15} /> {creatingAccounts ? t('ui.accounting.common.saving') : tf('addFxAccounts')}
                    </button>
                </div>
            ))}

            {/* Revaluation */}
            <div style={{ ...cardStyle, borderLeft: `4px solid ${BLUE}`, padding: '18px 20px' }}>
                {cardHead(<Scale size={18} />, tf('reval.title'), tf('reval.hint'))}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 220px))', gap: '12px', marginBottom: '14px' }}>
                    <div>
                        <label style={labelStyle}>{tf('reval.asOf')}</label>
                        <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>{tf('reval.rate')}</label>
                        <input type="text" inputMode="decimal" value={rateText} onChange={e => setRateText(e.target.value)} style={{ ...inputStyle, borderColor: rateInvalid ? RED : rateOdd ? '#F59E0B' : undefined }} />
                        <div style={{ fontSize: '11px', color: rateInvalid ? RED : 'var(--color-text-muted)', marginTop: '4px' }}>
                            {rateInvalid ? tf('reval.rateInvalid') : fill(tf('reval.shopRate'), { rate: formatRate(shop) })}
                            {!rateInvalid && rate !== shop && <button onClick={() => setRateText(String(shop))} style={{ marginLeft: '6px', border: 'none', background: 'none', color: BLUE, cursor: 'pointer', fontSize: '11px', padding: 0 }}>{tf('reval.useShopRate')}</button>}
                        </div>
                    </div>
                </div>

                <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={th}>{tf('reval.account')}</th>
                                <th style={{ ...th, textAlign: 'right' }}>{tf('reval.rielBalance')}</th>
                                <th style={{ ...th, textAlign: 'right' }}>{tf('reval.bookUsd')}</th>
                                <th style={{ ...th, textAlign: 'right' }}>{tf('reval.avgRate')}</th>
                                <th style={{ ...th, textAlign: 'right' }}>{fill(tf('reval.atRate'), { rate: rateInvalid ? '—' : formatRate(rate) })}</th>
                                <th style={{ ...th, textAlign: 'right' }}>{tf('reval.difference')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--color-text-muted)' }}>{t('common.loading')}</td></tr>
                            ) : rielAccounts.map(a => {
                                const b = balances.get(a.id);
                                const r = rows.find(x => x.accountId === a.id);
                                const avg = b && b.riel > 0 && b.usd > 0 ? b.riel / b.usd : null;
                                return (
                                    <tr key={a.id}>
                                        <td style={td}>{a.account_code} · {a.account_name}</td>
                                        <td style={num}>{formatKhr(b?.riel || 0)}</td>
                                        <td style={num}>{formatUsd(b?.usd || 0)}</td>
                                        <td style={{ ...num, color: 'var(--color-text-secondary)' }}>{avg ? formatRate(Math.round(avg * 100) / 100) : '—'}</td>
                                        <td style={num}>{r ? formatUsd(r.valueUsd) : '—'}</td>
                                        <td style={{ ...num, fontWeight: 700, color: diffColor(r?.diffUsd || 0) }}>{r ? signedUsd(r.diffUsd) : '—'}</td>
                                    </tr>
                                );
                            })}
                            {!loading && (
                                <tr>
                                    <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }} colSpan={5}>{netDiff > 0 ? tf('reval.netGain') : netDiff < 0 ? tf('reval.netLoss') : tf('reval.netNone')}</td>
                                    <td style={{ ...num, fontWeight: 800, borderBottom: 'none', color: diffColor(netDiff) }}>{signedUsd(netDiff)}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                    {draftsLeftOut > 0 && notice('warn', fill(tf('reval.draftsLeftOut'), { n: String(draftsLeftOut) }))}
                    {untagged.length > 0 && notice('warn', (
                        <>
                            {fill(tf('reval.untagged'), { n: String(untagged.length), rate: rateInvalid ? '—' : formatRate(rate) })}
                            <div style={{ marginTop: '6px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                                {untagged.slice(0, 8).map(u => entries.get(u.id)?.reference_id || u.id).join(' · ')}{untagged.length > 8 ? ' …' : ''}
                            </div>
                        </>
                    ))}
                    {pendingReval && notice('warn', fill(tf('reval.pending'), { number: pendingReval.number }))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '14px' }}>
                    <button onClick={draftRevaluation} disabled={!canReval} style={primary(canReval)}>
                        <Scale size={15} /> {savingReval ? t('ui.accounting.common.saving') : tf('reval.submit')}
                    </button>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{tf('draftNote')}</span>
                </div>
            </div>

            {/* Exchange */}
            <div style={{ ...cardStyle, borderLeft: `4px solid ${BLUE}`, padding: '18px 20px' }}>
                {cardHead(<ArrowRightLeft size={18} />, tf('ex.title'), tf('ex.hint'))}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '12px', alignItems: 'start' }}>
                    <div>
                        <label style={labelStyle}>{tf('ex.direction')}</label>
                        <select value={direction} onChange={e => setDirection(e.target.value as ExchangeDirection)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            <option value="sellRiel">{tf('ex.sellRiel')}</option>
                            <option value="buyRiel">{tf('ex.buyRiel')}</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>{t('ui.accounting.common.date')}</label>
                        <input type="date" value={exDate} onChange={e => setExDate(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>{tf('ex.bankRef')}</label>
                        <input type="text" value={exRef} onChange={e => setExRef(e.target.value)} placeholder={tf('ex.bankRefPh')} style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>{direction === 'sellRiel' ? tf('ex.rielFrom') : tf('ex.rielInto')}</label>
                        <select value={exRielId} onChange={e => setExRielId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            {rielAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}
                        </select>
                        {exBalance && <div style={{ fontSize: '11px', color: oversell ? RED : 'var(--color-text-muted)', marginTop: '4px' }}>{fill(tf('ex.holds'), { riel: formatKhr(exBalance.riel), usd: formatUsd(exBalance.usd) })}</div>}
                    </div>
                    <div>
                        <label style={labelStyle}>{tf('ex.rielAmount')}</label>
                        <input type="text" inputMode="numeric" value={exRiel} onChange={e => setExRiel(e.target.value)} placeholder="៛0" style={inputStyle} />
                    </div>
                    <div />
                    <div>
                        <label style={labelStyle}>{direction === 'sellRiel' ? tf('ex.usdInto') : tf('ex.usdFrom')}</label>
                        <select value={exUsdId} onChange={e => setExUsdId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            {usdAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>{tf('ex.usdAmount')}</label>
                        <input type="text" inputMode="decimal" value={exUsd} onChange={e => setExUsd(e.target.value)} placeholder="$0.00" style={inputStyle} />
                    </div>
                </div>

                {exPreview && (
                    <div style={{ marginTop: '14px', borderRadius: '10px', border: `1px solid color-mix(in srgb, ${BLUE} 30%, var(--color-border))`, background: `color-mix(in srgb, ${BLUE} 4%, var(--color-surface))`, padding: '10px 14px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: BLUE, marginBottom: '4px' }}>{t('ui.accounting.re.preview')}</div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                            {fill(tf('ex.rateGot'), { rate: formatRate(Math.round(exPreview.rate * 100) / 100) })}
                            {direction === 'sellRiel' && <> · {fill(tf('ex.bookValue'), { usd: formatUsd(exPreview.bookUsd) })}</>}
                        </div>
                        {exPreview.lines.map((l, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', borderTop: i ? '1px solid var(--color-border)' : 'none', fontSize: '13px', color: 'var(--color-text-main)' }}>
                                <span style={{ paddingLeft: l.credit > 0 ? '18px' : 0 }}>{fill(t(l.debit > 0 ? 'ui.accounting.re.drDot' : 'ui.accounting.re.crDot'), { name: nameOf(l.account_id) })}</span>
                                <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatUsd(l.debit || l.credit)}</span>
                            </div>
                        ))}
                        {direction === 'sellRiel' && (
                            <div style={{ marginTop: '6px', fontSize: '13px', fontWeight: 700, color: diffColor(exPreview.gainUsd) }}>
                                {exPreview.gainUsd > 0 ? fill(tf('ex.gain'), { usd: formatUsd(exPreview.gainUsd) })
                                    : exPreview.gainUsd < 0 ? fill(tf('ex.loss'), { usd: formatUsd(-exPreview.gainUsd) })
                                    : tf('ex.even')}
                            </div>
                        )}
                    </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '14px' }}>
                    <button onClick={draftExchange} disabled={!canExchange} style={primary(canExchange)}>
                        <ArrowRightLeft size={15} /> {savingEx ? t('ui.accounting.common.saving') : tf('ex.submit')}
                    </button>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{tf('draftNote')}</span>
                </div>
            </div>

            {/* FX entries */}
            <div style={{ ...cardStyle, overflow: 'hidden' }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-text-main)' }}>{tf('list.title')}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button onClick={() => navigate('/accounting/journal-entries')} style={btn}><BookOpen size={13} /> {t('nav.journalEntries')}</button>
                        <button onClick={refetch} title={t('ui.accounting.common.reload')} style={btn}><RefreshCw size={13} /></button>
                    </span>
                </div>
                {fxRows.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>{loading ? t('common.loading') : tf('list.empty')}</div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={th}>{t('ui.accounting.common.date')}</th>
                                    <th style={th}>{t('ui.accounting.re.referenceNumber')}</th>
                                    <th style={th}>{tf('list.kind')}</th>
                                    {!isMobile && <th style={th}>{tf('list.description')}</th>}
                                    <th style={{ ...th, textAlign: 'right' }}>{tf('list.gainLoss')}</th>
                                    <th style={th}>{t('ui.accounting.common.statusLabel')}</th>
                                    <th style={th}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {fxRows.map(r => (
                                    <tr key={r.id}>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.date}</td>
                                        <td style={{ ...td, fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>{r.number}</td>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{tf(r.kind === 'reval' ? 'list.reval' : 'list.conv')}</td>
                                        {!isMobile && <td style={{ ...td, color: 'var(--color-text-secondary)' }}>{r.description}</td>}
                                        <td style={{ ...num, fontWeight: 700, color: diffColor(r.fxNet) }}>{signedUsd(r.fxNet)}</td>
                                        <td style={td}>
                                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap',
                                                color: r.status === 'Draft' ? '#B45309' : GREEN, background: r.status === 'Draft' ? 'rgba(217, 119, 6, 0.12)' : 'rgba(5, 150, 105, 0.12)' }}>
                                                {r.status === 'Draft' ? t('ui.accounting.common.status.draft') : t('ui.accounting.common.status.posted')}
                                            </span>
                                        </td>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                            {r.status === 'Draft' && (
                                                <button onClick={() => deleteDraft(r)} disabled={busyId === r.id} style={{ ...btn, color: '#DC2626' }} title={t('common.delete')}><Trash2 size={13} /></button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FxRevaluationPage;
