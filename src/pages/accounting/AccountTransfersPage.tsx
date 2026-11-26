// Account Transfers (Accounting): moving the shop's own money between its
// cash and bank accounts — bank → cash on hand, cash → petty cash top-up,
// ABA → another bank. The COD Remittances page settles a courier; this one
// is account-to-account: one Draft entry per transfer, Dr the receiving
// account / Cr the sending account — plus Dr expense for a bank fee the
// sender was charged (Cr is then the amount + the fee) — reference
// ACC-XFER-<n>. Posting stays with the owner on Journal Entries, like every
// other Draft. Modelled on CodRemittancesPage, with the per-courier table
// replaced by a per-account balance table (what each account holds now).
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, AlertTriangle, ArrowLeftRight, ArrowRight, Pencil, BookOpen, CheckCircle2 } from 'lucide-react';
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
import CashBankOptions from '../../components/CashBankOptions';
import MoneyInput from '../../components/MoneyInput';
import { useAccountCurrency, useMoneyField } from '../../hooks/useMoneyField';
import { CURRENCY_KEYS, formatKhr, formatMoneyLine, isKhrAccountName, isMissingCurrencyColumnError, khrToUsd, parseAmount, usdToKhr } from '../../utils/currency';
import { roundCents } from '../../utils/money';
import type { ChartOfAccount, JournalEntry } from '../../types';

const TEAL = '#0D9488';
export const ACC_XFER_PREFIX = 'ACC-XFER-';

const todayYmd = (): string => {
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fmt = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The entry's description carries both account names and the user's note in
// one fixed shape so the list can read the note back:
// "Account transfer — Bank Account ABA → Cash on Hand (USD) · note". A fee
// is added at the end ("· fee USD 0.50") for the Journal Entries reader
// only; the page reads the fee off the lines.
const describe = (from: string, to: string, note: string, feeUsd = 0): string =>
    `Account transfer — ${from} → ${to}${note ? ` · ${note}` : ''}${feeUsd > 0 ? ` · fee USD ${feeUsd.toFixed(2)}` : ''}`;
const parseNote = (d: string): string => {
    const m = /^Account transfer — .*? → .*?(?: · (.*?))?(?: · fee USD [\d.,]+)?$/.exec(d || '');
    return m?.[1] || '';
};

interface XferRow {
    entryId: string;
    date: string;
    number: string;      // entry_number, else reference_id
    note: string;
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    amount: number;      // USD, the receiving account's debit
    fee: number;         // USD the bank charged the sender, 0 for none
    feeAccountId: string;
    currency: string | null;
    original_amount: number | null;
    exchange_rate: number | null;
    status: string;
}

const StatusChip: React.FC<{ status: string }> = ({ status }) => {
    const { t } = useLanguage();
    return (
        <span style={{
            fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap',
            color: status === 'Draft' ? '#B45309' : '#047857',
            background: status === 'Draft' ? 'rgba(217, 119, 6, 0.12)' : 'rgba(5, 150, 105, 0.12)',
        }}>{status === 'Draft' ? t('ui.accounting.common.status.draft') : status === 'Posted' ? t('ui.accounting.common.status.posted') : status}</span>
    );
};

const AccountTransfersPage: React.FC = () => {
    const isMobile = useMobile();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const tc = (k: string) => t('ui.accounting.xfer.' + k);
    const { khrExchangeRate } = useStore();
    const { saveJournalEntry } = useAccounting();
    const navigate = useNavigate();

    const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
    // Every line on the cash/bank accounts, for the balance table: posted
    // is the books, withDrafts adds what the Drafts would move once posted.
    type AcctBal = { posted: number; withDrafts: number };
    const [balances, setBalances] = useState<Map<string, AcctBal> | null>(null);
    const [rows, setRows] = useState<XferRow[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const refetch = useCallback(() => setRefreshKey(k => k + 1), []);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>{tc('title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>{tc('subtitle')}</p>
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
                const cashIds = (accs || []).filter(a => isCashBankAccount(a)).map(a => a.id);

                // Two fetches: every line on the cash/bank accounts (the
                // balances), and the transfer entries with their lines (the
                // list). The riel columns arrive with add_khr_currency.sql;
                // the status column with add_entry_status.sql — without it
                // every line counts as Posted, like fetchPostedLedgerLines.
                type BalRow = { id: unknown; account_id: unknown; debit: unknown; credit: unknown; entry: { status?: unknown } | null };
                const loadBalances = (withStatus: boolean) => cashIds.length === 0
                    ? Promise.resolve([] as BalRow[])
                    : fetchAll((from, to) => supabase
                        .from('journal_entry_lines')
                        .select(`id, account_id, debit, credit, entry:journal_entries!inner(${withStatus ? 'status' : 'id'})`)
                        .in('account_id', cashIds)
                        .order('id', { ascending: true })
                        .range(from, to), 1000, { label: 'AccountTransfers.balances', maxRows: 100000 }) as Promise<BalRow[]>;
                const loadXfers = (withCurrency: boolean) => supabase
                    .from('journal_entries')
                    .select(`id, date, description, reference_id, entry_number, status${withCurrency ? ', currency, original_amount, exchange_rate' : ''}, lines:journal_entry_lines(id, account_id, debit, credit)`)
                    .like('reference_id', `${ACC_XFER_PREFIX}%`)
                    .order('date', { ascending: false })
                    .limit(2000);
                let xfers = await loadXfers(true);
                if (xfers.error && isMissingCurrencyColumnError(xfers.error)) xfers = await loadXfers(false);
                if (xfers.error) throw xfers.error;
                let balRows: BalRow[];
                try {
                    balRows = await loadBalances(true);
                } catch (e) {
                    if (/status/i.test((e as { message?: string })?.message || '')) balRows = await loadBalances(false);
                    else throw e;
                }
                if (!alive) return;

                const bals = new Map<string, AcctBal>();
                for (const l of balRows) {
                    const id = String(l.account_id);
                    const b = bals.get(id) || { posted: 0, withDrafts: 0 };
                    const delta = (Number(l.debit) || 0) - (Number(l.credit) || 0);
                    b.withDrafts += delta;
                    if (String(l.entry?.status || 'Posted') !== 'Draft') b.posted += delta;
                    bals.set(id, b);
                }
                setBalances(bals);

                const byId = new Map((accs || []).map(a => [a.id, a]));
                type XferRaw = { id: unknown; date: unknown; description: unknown; reference_id: unknown; entry_number?: unknown; status?: unknown; currency?: unknown; original_amount?: unknown; exchange_rate?: unknown; lines: { account_id: unknown; debit: unknown; credit: unknown }[] | null };
                const parsed: XferRow[] = ((xfers.data || []) as unknown as XferRaw[]).map(e => {
                    const lines = e.lines || [];
                    // Debits: the receiving account (a cash/bank account) and
                    // the fee line (anything else). Credit: the sender.
                    const isBank = (l: { account_id: unknown }) => { const a = byId.get(String(l.account_id)); return !!a && isCashBankAccount(a); };
                    const debits = lines.filter(l => (Number(l.debit) || 0) > 0);
                    const toLine = debits.find(isBank) || debits[0];
                    const feeLines = debits.filter(l => l !== toLine);
                    const fromLine = lines.find(l => (Number(l.credit) || 0) > 0);
                    return {
                        entryId: String(e.id),
                        date: String(e.date || '').slice(0, 10),
                        number: String(e.entry_number || e.reference_id || ''),
                        note: parseNote(String(e.description || '')),
                        fromId: fromLine ? String(fromLine.account_id) : '',
                        fromName: fromLine ? (byId.get(String(fromLine.account_id))?.account_name || '?') : '—',
                        toId: toLine ? String(toLine.account_id) : '',
                        toName: toLine ? (byId.get(String(toLine.account_id))?.account_name || '?') : '—',
                        amount: toLine ? Number(toLine.debit) || 0 : 0,
                        fee: feeLines.reduce((s, l) => s + (Number(l.debit) || 0), 0),
                        feeAccountId: feeLines[0] ? String(feeLines[0].account_id) : '',
                        currency: e.currency ? String(e.currency) : null,
                        original_amount: e.original_amount === null || e.original_amount === undefined ? null : Number(e.original_amount),
                        exchange_rate: e.exchange_rate === null || e.exchange_rate === undefined ? null : Number(e.exchange_rate),
                        status: String(e.status || 'Posted'),
                    };
                });
                const seq = (r: XferRow) => { const m = /^JE-(\d+)-/.exec(r.number); return m ? Number(m[1]) : -1; };
                parsed.sort((a, b) => b.date.localeCompare(a.date) || seq(b) - seq(a) || b.entryId.localeCompare(a.entryId));
                setAccounts(accs || []);
                setRows(parsed);
            } catch (e) {
                console.error('Failed to load account transfers:', e);
                if (!alive) return;
                setLoadError(e instanceof Error ? e.message : String(e));
                setRows(prev => prev ?? []);
                setBalances(prev => prev ?? new Map());
            }
        })();
        return () => { alive = false; };
    }, [refreshKey]);

    // Both pickers offer every active cash/bank account — petty cash too
    // (topping up the float is a classic transfer). Riel group last.
    const xferAccounts = useMemo(
        () => sortCashBankForPicker(accounts.filter(a => a.is_active && isCashBankAccount(a))),
        [accounts]
    );
    const expenseAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Expense')
            .sort((a, b) => Number(!/fee|charge|bank/i.test(a.account_name)) - Number(!/fee|charge|bank/i.test(b.account_name)) || (a.account_code || '').localeCompare(b.account_code || '')),
        [accounts]
    );

    // ── Totals ──
    const totals = useMemo(() => {
        const month = todayYmd().slice(0, 7);
        const monthTotal = (rows || []).filter(r => r.date.slice(0, 7) === month).reduce((s, r) => s + r.amount, 0);
        const drafts = (rows || []).filter(r => r.status === 'Draft').length;
        return { monthTotal, count: (rows || []).length, drafts };
    }, [rows]);

    // ── Form ──
    const [date, setDate] = useState(todayYmd());
    const [fromId, setFromId] = useState('');
    const [toId, setToId] = useState('');
    const [note, setNote] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const field = useMoneyField({ shopRate: khrExchangeRate });
    // The amount follows the SENDING account's currency: a riel account
    // sends riel (converted at the rate), a dollar account dollars.
    const coupling = useAccountCurrency(field, xferAccounts, fromId, setFromId);
    const [editing, setEditing] = useState<XferRow | null>(null);
    const [fee, setFee] = useState('');
    const [feeAccountId, setFeeAccountId] = useState('');
    useEffect(() => {
        setFeeAccountId(prev => (prev && expenseAccounts.some(a => a.id === prev)) ? prev : (expenseAccounts[0]?.id || ''));
    }, [expenseAccounts]);

    // Defaults: from the USD bank account, to Cash on Hand (USD) — the most
    // common move — falling back to the first two accounts in picker order.
    useEffect(() => {
        if (xferAccounts.length === 0) return;
        setFromId(prev => {
            if (prev && xferAccounts.some(a => a.id === prev)) return prev;
            const usd = xferAccounts.filter(a => !isKhrAccountName(a.account_name));
            const pick = usd.find(a => /bank|aba/i.test(a.account_name)) || usd[0] || xferAccounts[0];
            if (pick && field.currency !== (isKhrAccountName(pick.account_name) ? 'KHR' : 'USD')) field.reinterpret(isKhrAccountName(pick.account_name) ? 'KHR' : 'USD');
            return pick?.id || '';
        });
        setToId(prev => {
            if (prev && xferAccounts.some(a => a.id === prev)) return prev;
            const usd = xferAccounts.filter(a => !isKhrAccountName(a.account_name));
            const cash = usd.find(a => /cash on hand/i.test(a.account_name)) || usd.find(a => /cash/i.test(a.account_name));
            return (cash || xferAccounts.find(a => a.id !== (usd.find(x => /bank|aba/i.test(x.account_name)) || usd[0] || xferAccounts[0])?.id) || xferAccounts[0])?.id || '';
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [xferAccounts]);

    const fromAcc = useMemo(() => accounts.find(a => a.id === fromId), [accounts, fromId]);
    const toAcc = useMemo(() => accounts.find(a => a.id === toId), [accounts, toId]);
    const sameAccount = !!fromId && fromId === toId;
    const crossCurrency = !!fromAcc && !!toAcc && isKhrAccountName(fromAcc.account_name) !== isKhrAccountName(toAcc.account_name);
    const amountUsd = field.usd;
    const feeTyped = parseAmount(fee);
    const feeUsd = !(feeTyped > 0) ? 0
        : field.currency === 'KHR' ? khrToUsd(feeTyped, Number(field.rate)) : Math.round(feeTyped * 100) / 100;
    const grossUsd = Math.round((amountUsd + feeUsd) * 100) / 100;
    const feeInvalid = fee.trim() !== '' && !(feeTyped >= 0);
    const fromBal = fromId ? balances?.get(fromId) : undefined;
    const overdraws = !!fromBal && grossUsd > 0 && fromBal.posted - grossUsd < -0.005;
    // "All": the sender's whole posted balance leaves the account — with a
    // fee typed, the amount is balance − fee, so Cr lands on the balance
    // exactly and the account empties to zero.
    const allUsd = fromBal ? Math.max(0, roundCents(fromBal.posted - feeUsd)) : 0;
    const allRate = Number(field.rate) > 0 ? Number(field.rate) : field.shopRate;
    const fillAll = () => {
        if (!(allUsd > 0)) return;
        // A riel field takes riel: to the single riel (not the usual 100) so
        // it converts back to the posted USD balance to the cent.
        field.setAmount(String(field.currency === 'KHR' ? usdToKhr(allUsd, allRate, 1) : allUsd));
    };
    const canSave = !isSaving && amountUsd > 0 && !field.rateInvalid && !feeInvalid && (feeUsd === 0 || !!feeAccountId)
        && !!fromId && !!toId && !sameAccount && !!date;

    const resetForm = () => {
        setEditing(null);
        field.setAmount('');
        setFee('');
        setNote('');
        setDate(todayYmd());
    };

    const header = (entryNumber: string | null): Partial<JournalEntry> => ({
        date,
        description: describe(fromAcc?.account_name || '?', toAcc?.account_name || '?', note.trim(), feeUsd),
        status: 'Draft',
        ...(entryNumber ? { entry_number: entryNumber } : {}),
        ...field.meta,
    });
    // Dr receiving account (+ Dr expense for the bank's fee) / Cr sender
    // (the amount and the fee both left it).
    const entryLines = () => [
        { account_id: toId, debit: amountUsd, credit: 0, description: `Transfer from ${fromAcc?.account_name || '?'}` },
        ...(feeUsd > 0 ? [{ account_id: feeAccountId, debit: feeUsd, credit: 0, description: 'Transfer fee' }] : []),
        { account_id: fromId, debit: 0, credit: grossUsd, description: `Transfer to ${toAcc?.account_name || '?'}` },
    ];

    const handleSave = async () => {
        if (!canSave) return;
        if (!field.confirmIfSuspicious()) return;
        setIsSaving(true);
        try {
            if (editing) {
                // A Draft rewritten in place: header first, then the lines
                // (the old ones put back if the new ones cannot be written).
                const { data: oldLines, error: oldErr } = await supabase.from('journal_entry_lines').select('*').eq('journal_entry_id', editing.entryId);
                if (oldErr) throw oldErr;
                const h = header(null);
                const patch: Record<string, unknown> = { date: h.date, description: h.description, currency: h.currency, original_amount: h.original_amount ?? null, exchange_rate: h.exchange_rate ?? null };
                let { error: updErr } = await supabase.from('journal_entries').update(patch).eq('id', editing.entryId);
                if (updErr && isMissingCurrencyColumnError(updErr)) {
                    for (const k of CURRENCY_KEYS) delete patch[k];
                    ({ error: updErr } = await supabase.from('journal_entries').update(patch).eq('id', editing.entryId));
                }
                if (updErr) throw updErr;
                const { error: delErr } = await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', editing.entryId);
                if (delErr) throw delErr;
                const fresh = entryLines().map(l => ({ journal_entry_id: editing.entryId, ...l }));
                let { error: insErr } = await supabase.from('journal_entry_lines').insert(fresh);
                if (insErr && /description/i.test(insErr.message || '')) {
                    ({ error: insErr } = await supabase.from('journal_entry_lines').insert(fresh.map(l => { const c: Record<string, unknown> = { ...l }; delete c.description; return c; })));
                }
                if (insErr) {
                    const restore = (oldLines || []).map(l => { const c = { ...l } as Record<string, unknown>; delete c.id; delete c.created_at; return c; });
                    const { error: restoreErr } = await supabase.from('journal_entry_lines').insert(restore);
                    if (restoreErr) throw new Error(`${insErr.message} — ${fill(tc('toast.restoreFailed'), { ref: editing.number })}`);
                    throw insErr;
                }
                showToast(tc('toast.updated'), 'success');
            } else {
                const entryNumber = await nextJournalEntryNumber('TRF', date);
                await saveJournalEntry({ ...header(entryNumber), reference_id: `${ACC_XFER_PREFIX}${Date.now()}` }, entryLines());
                showToast(tc('toast.saved'), 'success');
            }
            resetForm();
            refetch();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast(tc('toast.saveFailed') + ': ' + msg, 'error');
        }
        finally {
            setIsSaving(false);
        }
    };

    const startEdit = (r: XferRow) => {
        if (r.status !== 'Draft') { showToast(tc('toast.postedNoChange'), 'info'); return; }
        setEditing(r);
        setDate(r.date);
        if (r.fromId) setFromId(r.fromId);
        if (r.toId) setToId(r.toId);
        setNote(r.note);
        const khr = r.currency === 'KHR' && !!r.original_amount;
        field.reset(khr
            ? { amount: r.original_amount!, currency: 'KHR', rate: r.exchange_rate || undefined }
            : { amount: r.amount, currency: 'USD' });
        setFee(r.fee > 0 ? String(khr && r.exchange_rate ? usdToKhr(r.fee, r.exchange_rate, 1) : r.fee) : '');
        if (r.feeAccountId) setFeeAccountId(r.feeAccountId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
    const handleDelete = async (r: XferRow) => {
        if (r.status !== 'Draft') { showToast(tc('toast.postedNoChange'), 'info'); return; }
        if (busyIds.has(r.entryId)) return;
        if (!confirm(fill(tc('confirm.delete'), { amount: fmt(r.amount), from: r.fromName, to: r.toName, date: r.date }))) return;
        setBusyIds(prev => new Set(prev).add(r.entryId));
        try {
            const { error: lineErr } = await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', r.entryId);
            if (lineErr) throw lineErr;
            const { error: entryErr } = await supabase.from('journal_entries').delete().eq('id', r.entryId);
            if (entryErr) throw entryErr;
            if (editing?.entryId === r.entryId) resetForm();
            showToast(tc('toast.deleted'), 'success');
            refetch();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast(tc('toast.deleteFailed') + ': ' + msg, 'error');
        } finally {
            setBusyIds(prev => { const n = new Set(prev); n.delete(r.entryId); return n; });
        }
    };

    // Post a Draft right here (one way, like Journal Entries): the full
    // refetch also moves the amount from "with Drafts" into the posted
    // balances above.
    const handlePost = async (r: XferRow) => {
        if (r.status !== 'Draft' || busyIds.has(r.entryId)) return;
        setBusyIds(prev => new Set(prev).add(r.entryId));
        try {
            const { error } = await supabase.from('journal_entries').update({ status: 'Posted' }).eq('id', r.entryId);
            if (error) throw error;
            if (editing?.entryId === r.entryId) resetForm();
            showToast(t('ui.wholesale.journal.toast.posted'), 'success');
            refetch();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast(/status/i.test(msg)
                ? t('ui.wholesale.journal.toast.postNeedsStatus')
                : t('ui.wholesale.journal.toast.postFailed') + msg, 'error');
        } finally {
            setBusyIds(prev => { const n = new Set(prev); n.delete(r.entryId); return n; });
        }
    };

    const loading = rows === null;
    const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
    const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', minHeight: '26px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' };
    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '9px 12px', borderRadius: '8px',
        border: editing ? '1.5px solid #5469d4' : '1px solid var(--color-border)',
        background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', outline: 'none',
    };
    const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' };
    const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-text-secondary)', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' };
    const td: React.CSSProperties = { fontSize: '13px', color: 'var(--color-text-main)', padding: '10px 14px', borderBottom: '1px solid var(--color-border)', verticalAlign: 'top' };
    const money = (r: { amount: number; currency: string | null; original_amount: number | null; exchange_rate: number | null }) =>
        r.currency === 'KHR' && r.original_amount
            ? <><span>USD {fmt(r.amount)}</span><div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{formatMoneyLine({ amount: r.amount, currency: 'KHR', original_amount: r.original_amount, exchange_rate: r.exchange_rate })}</div></>
            : <span>USD {fmt(r.amount)}</span>;
    const balanceNote = (id: string) => {
        const b = id ? balances?.get(id) : undefined;
        if (!b) return null;
        return (
            <div style={{ marginTop: '6px', fontSize: '11px', color: id === fromId && overdraws ? '#B91C1C' : 'var(--color-text-muted)' }}>
                {id === fromId && overdraws
                    ? fill(tc('overdraw'), { amount: fmt(b.posted) })
                    : fill(tc('balanceLine'), { amount: fmt(b.posted) })}
            </div>
        );
    };

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Totals */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px' }}>
                {[
                    { label: tc('card.monthTotal'), value: fmt(totals.monthTotal) },
                    { label: tc('card.count'), value: String(totals.count) },
                    { label: tc('card.drafts'), value: String(totals.drafts) },
                ].map(c => (
                    <div key={c.label} style={{ ...cardStyle, borderTop: `3px solid ${TEAL}`, padding: '14px 16px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{c.label}</div>
                        <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : c.value}</div>
                    </div>
                ))}
            </div>

            {/* Per account: where the money sits right now. */}
            {!loading && xferAccounts.length > 0 && (
                <div style={{ ...cardStyle, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-text-main)' }}>{tc('byAccount.title')}</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{tc('byAccount.hint')}</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={th}>{tc('byAccount.account')}</th>
                                    <th style={{ ...th, textAlign: 'right' }}>{tc('byAccount.posted')}</th>
                                    <th style={{ ...th, textAlign: 'right' }}>{tc('byAccount.withDrafts')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {xferAccounts.map(a => {
                                    const b = balances?.get(a.id) || { posted: 0, withDrafts: 0 };
                                    return (
                                        <tr key={a.id}>
                                            <td style={td}>{a.account_code ? `${a.account_code} · ` : ''}{a.account_name}</td>
                                            <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: b.posted < -0.005 ? '#B91C1C' : 'var(--color-text-main)' }}>{fmt(b.posted)}</td>
                                            <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: Math.abs(b.withDrafts - b.posted) > 0.005 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{fmt(b.withDrafts)}</td>
                                        </tr>
                                    );
                                })}
                                <tr>
                                    <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{tc('byAccount.total')}</td>
                                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 800, borderBottom: 'none' }}>{fmt(xferAccounts.reduce((s, a) => s + (balances?.get(a.id)?.posted || 0), 0))}</td>
                                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, borderBottom: 'none' }}>{fmt(xferAccounts.reduce((s, a) => s + (balances?.get(a.id)?.withDrafts || 0), 0))}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Form */}
            <div style={{ ...cardStyle, borderLeft: `4px solid ${editing ? '#F59E0B' : TEAL}`, background: editing ? 'rgba(245, 158, 11, 0.04)' : undefined, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: `${TEAL}1A`, color: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <ArrowLeftRight size={18} />
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text-main)' }}>
                        {editing ? tc('editEntry') : tc('newEntry')}
                        {editing && <span style={{ marginLeft: '10px', fontSize: '11px', fontWeight: 500, color: 'var(--color-text-muted)' }}>{editing.number}</span>}
                    </div>
                </div>

                {!loading && xferAccounts.length < 2 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', fontSize: '13px', color: 'var(--color-text-main)' }}>
                        <AlertTriangle size={18} color="#F59E0B" style={{ flexShrink: 0 }} />
                        <span>{tc('noAccounts')}</span>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '12px', alignItems: 'start' }}>
                        <div>
                            <label style={labelStyle}>{t('ui.accounting.common.date')}</label>
                            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                            <label style={labelStyle}>{tc('from')}</label>
                            <select value={fromId} onChange={e => coupling.onAccountChange(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                {xferAccounts.length === 0 && <option value="">{t('ui.components.common.bankOrCash')}</option>}
                                <CashBankOptions accounts={xferAccounts} />
                            </select>
                            {balanceNote(fromId)}
                        </div>
                        <div>
                            <label style={labelStyle}>{tc('to')}</label>
                            <select value={toId} onChange={e => setToId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', ...(sameAccount ? { borderColor: '#DC2626' } : {}) }}>
                                {xferAccounts.length === 0 && <option value="">{t('ui.components.common.bankOrCash')}</option>}
                                <CashBankOptions accounts={xferAccounts} />
                            </select>
                            {sameAccount
                                ? <div style={{ marginTop: '6px', fontSize: '11px', color: '#B91C1C' }}>{tc('sameAccount')}</div>
                                : balanceNote(toId)}
                        </div>
                        <div onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') handleSave(); }}>
                            <MoneyInput
                                field={field}
                                label={t('common.amount')}
                                allowKhr
                                placeholder={field.currency === 'KHR' ? '0' : '0.00'}
                                onToggleCurrency={coupling.onToggleCurrency}
                                khrUnavailableReason={coupling.khrUnavailableReason}
                                labelStyle={labelStyle}
                                inputStyle={{ ...inputStyle, fontWeight: 400 }}
                            />
                            {allUsd > 0 && !sameAccount && (
                                <button
                                    type="button"
                                    onClick={fillAll}
                                    title={tc('allHint')}
                                    style={{
                                        marginTop: '6px', padding: '3px 10px', borderRadius: '6px', cursor: 'pointer',
                                        border: `1px solid color-mix(in srgb, ${TEAL} 45%, var(--color-border))`,
                                        background: 'transparent', color: TEAL, fontSize: '11px', fontWeight: 700,
                                    }}
                                >
                                    {fill(tc('allBtn'), { amount: field.currency === 'KHR' ? formatKhr(usdToKhr(allUsd, allRate, 1)) : `USD ${fmt(allUsd)}` })}
                                </button>
                            )}
                            {crossCurrency && (
                                <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--color-text-muted)' }}>{tc('xchgHint')}</div>
                            )}
                        </div>
                        <div>
                            <label style={labelStyle}>{tc('note')}</label>
                            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder={tc('notePh')} style={inputStyle} />
                        </div>
                        <div>
                            <label style={labelStyle}>{fill(tc('fee'), { currency: field.currency })}</label>
                            <input
                                type="text" inputMode="decimal" value={fee}
                                onChange={e => setFee(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                                placeholder={tc('feePh')}
                                style={{ ...inputStyle, ...(feeInvalid ? { borderColor: '#DC2626' } : {}) }}
                            />
                            {feeUsd > 0 && field.currency === 'KHR' && (
                                <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--color-text-muted)' }}>= USD {fmt(feeUsd)}</div>
                            )}
                        </div>
                        {feeUsd > 0 && (
                            <div>
                                <label style={labelStyle}>{tc('feeAccount')}</label>
                                <select value={feeAccountId} onChange={e => setFeeAccountId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                    {expenseAccounts.length === 0 && <option value="">{tc('feeNoAccount')}</option>}
                                    {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}
                                </select>
                            </div>
                        )}
                        {amountUsd > 0 && fromId && toId && !sameAccount && (
                            <div style={{ gridColumn: '1 / -1', borderRadius: '10px', border: `1px solid color-mix(in srgb, ${TEAL} 30%, var(--color-border))`, background: `color-mix(in srgb, ${TEAL} 4%, var(--color-surface))`, padding: '10px 14px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: TEAL, marginBottom: '4px' }}>{t('ui.accounting.re.preview')}</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--color-border)', fontSize: '13px', color: 'var(--color-text-main)' }}>
                                    <span>{fill(t('ui.accounting.re.drDot'), { name: toAcc?.account_name || '?' })}</span>
                                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>USD {fmt(amountUsd)}{field.currency === 'KHR' && <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}> ({formatMoneyLine({ amount: amountUsd, ...field.meta })})</span>}</span>
                                </div>
                                {feeUsd > 0 && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--color-border)', fontSize: '13px', color: 'var(--color-text-main)' }}>
                                        <span>{fill(t('ui.accounting.re.drDot'), { name: accounts.find(a => a.id === feeAccountId)?.account_name || '?' })}</span>
                                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>USD {fmt(feeUsd)}</span>
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0 2px', fontSize: '13px', color: 'var(--color-text-main)' }}>
                                    <span style={{ paddingLeft: '18px' }}>{fill(t('ui.accounting.re.crDot'), { name: fromAcc?.account_name || '?' })}</span>
                                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>USD {fmt(grossUsd)}</span>
                                </div>
                            </div>
                        )}
                        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                                onClick={handleSave}
                                disabled={!canSave}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '9px', border: 'none',
                                    background: canSave ? TEAL : 'var(--color-border)', color: canSave ? 'white' : 'var(--color-text-muted)',
                                    fontSize: '13px', fontWeight: 700, cursor: canSave ? 'pointer' : 'not-allowed', flexShrink: 0, height: '38px',
                                }}
                            >
                                {editing ? <Pencil size={15} /> : <Plus size={16} />} {isSaving ? t('ui.accounting.common.saving') : editing ? t('ui.accounting.common.saveChanges') : tc('submit')}
                            </button>
                            {editing && (
                                <button onClick={resetForm} style={{ padding: '10px 16px', borderRadius: '9px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', flexShrink: 0, height: '38px' }}>
                                    {t('common.cancel')}
                                </button>
                            )}
                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{tc('draftNote')}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* List */}
            <div style={{ ...cardStyle, overflow: 'hidden' }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-text-main)' }}>{tc('entries')}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button onClick={() => navigate('/accounting/journal-entries')} style={btn} title={tc('postHint')}><BookOpen size={13} /> {t('nav.journalEntries')}</button>
                        <button onClick={refetch} title={t('ui.accounting.common.reload')} style={btn}><RefreshCw size={13} /></button>
                    </span>
                </div>
                {loadError && (
                    <div style={{ padding: '14px 18px', fontSize: '13px', color: '#B91C1C' }}>{loadError}</div>
                )}
                {loading ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>{t('common.loading')}</div>
                ) : rows.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>{tc('empty')}</div>
                ) : isMobile ? (
                    <div>
                        {rows.map(r => (
                            <div key={r.entryId} style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '13px' }}>
                                    <span style={{ fontWeight: 700, color: 'var(--color-text-main)', display: 'inline-flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                        {r.fromName} <ArrowRight size={13} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} /> {r.toName}
                                    </span>
                                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(r)}</span>
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{r.date}{r.note ? ` · ${r.note}` : ''}{r.fee > 0 ? ` · ${fill(tc('feeShort'), { amount: fmt(r.fee) })}` : ''}</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--color-text-muted)' }}>{r.number}</span>
                                    <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        <StatusChip status={r.status} />
                                        {r.status === 'Draft' && <>
                                            <button onClick={() => startEdit(r)} style={btn}><Pencil size={13} /></button>
                                            <button onClick={() => handlePost(r)} disabled={busyIds.has(r.entryId)} style={{ ...btn, color: TEAL }}><CheckCircle2 size={13} /> {t('ui.wholesale.journal.post')}</button>
                                            <button onClick={() => handleDelete(r)} disabled={busyIds.has(r.entryId)} style={{ ...btn, color: '#DC2626' }}><Trash2 size={13} /></button>
                                        </>}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={th}>{t('ui.accounting.common.date')}</th>
                                    <th style={th}>{t('ui.accounting.re.referenceNumber')}</th>
                                    <th style={th}>{tc('fromCol')}</th>
                                    <th style={th}>{tc('toCol')}</th>
                                    <th style={th}>{tc('note')}</th>
                                    <th style={{ ...th, textAlign: 'right' }}>{t('common.amount')}</th>
                                    <th style={{ ...th, textAlign: 'right' }}>{tc('feeCol')}</th>
                                    <th style={th}>{t('ui.accounting.common.statusLabel')}</th>
                                    <th style={th}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.entryId}>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.date}</td>
                                        <td style={{ ...td, fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>{r.number}</td>
                                        <td style={td}>{r.fromName}</td>
                                        <td style={td}>{r.toName}</td>
                                        <td style={{ ...td, color: r.note ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{r.note || '—'}</td>
                                        <td style={{ ...td, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(r)}</td>
                                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: r.fee > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{r.fee > 0 ? `USD ${fmt(r.fee)}` : '—'}</td>
                                        <td style={td}><StatusChip status={r.status} /></td>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                            {r.status === 'Draft' ? (
                                                <span style={{ display: 'inline-flex', gap: '6px' }}>
                                                    <button onClick={() => startEdit(r)} style={btn} title={t('common.edit')}><Pencil size={13} /></button>
                                                    <button onClick={() => handlePost(r)} disabled={busyIds.has(r.entryId)} style={{ ...btn, color: TEAL }} title={t('ui.wholesale.journal.post')}><CheckCircle2 size={13} /> {t('ui.wholesale.journal.post')}</button>
                                                    <button onClick={() => handleDelete(r)} disabled={busyIds.has(r.entryId)} style={{ ...btn, color: '#DC2626' }} title={t('common.delete')}><Trash2 size={13} /></button>
                                                </span>
                                            ) : <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{tc('postedLocked')}</span>}
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

export default AccountTransfersPage;
