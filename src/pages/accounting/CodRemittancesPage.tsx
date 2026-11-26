// COD remittances (Accounting): the lump a delivery company pays into the
// shop's bank account for the cash-on-delivery orders it collected. A
// courier-collected receipt (Settle's "អ្នកដឹកប្រមូល (COD)" box) debits 1210
// COD receivable (courier); this page books the money arriving — one Draft
// entry per bank credit, Dr bank (1010 / 1011) / Cr 1210 — plus Dr expense
// for a fee the courier kept before transferring (Cr 1210 is then the
// bank amount + the fee) — reference
// COD-REMIT-<n> — and shows what the couriers still hold (the 1210
// balance). Posting stays with the owner on Journal Entries, like every
// other Draft. Modelled on RevenueExpenseEntryPage, cut down to one entry
// shape. Needs migrations/add_cod_receivable.sql (the 1210 account).
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, AlertTriangle, Truck, Pencil, BookOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMobile } from '../../hooks/useMobile';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import { fill } from '../../i18n/translate';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../context/StoreContext';
import { useAccounting } from '../../hooks/useAccounting';
import { supabase } from '../../lib/supabase';
import { nextJournalEntryNumber } from '../../utils/journalEntryNumber';
import { isCashBankAccount, isCodCourierAccount, isCodReceivableAccount, sortCashBankForPicker } from '../../utils/cashBankAccounts';
import CashBankOptions from '../../components/CashBankOptions';
import MoneyInput from '../../components/MoneyInput';
import { useAccountCurrency, useMoneyField } from '../../hooks/useMoneyField';
import { CURRENCY_KEYS, formatKhr, formatMoneyLine, isKhrAccountName, isMissingCurrencyColumnError, khrToUsd, parseAmount, usdToKhr } from '../../utils/currency';
import { roundCents } from '../../utils/money';
import type { ChartOfAccount, JournalEntry } from '../../types';

const BLUE = '#2563EB';
export const COD_REMIT_PREFIX = 'COD-REMIT-';

const todayYmd = (): string => {
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fmt = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The entry's description carries the courier and the bank REF#, in one
// fixed shape so the list can read them back: "COD remittance — J&T · REF 123".
// A fee the courier kept is added at the end ("· fee USD 1.50") for the
// Journal Entries reader only; the page reads the fee off the lines.
const describe = (courier: string, ref: string, feeUsd = 0): string =>
    `COD remittance — ${courier}${ref ? ` · REF ${ref}` : ''}${feeUsd > 0 ? ` · fee USD ${feeUsd.toFixed(2)}` : ''}`;
const parseDescription = (d: string): { courier: string; ref: string } => {
    const m = /^COD remittance — (.*?)(?: · REF (.*?))?(?: · fee USD [\d.,]+)?$/.exec(d || '');
    return m ? { courier: m[1] || '', ref: m[2] || '' } : { courier: d || '', ref: '' };
};
// The expense a courier's deducted fee goes to, by name, else the first expense.
const DELIVERY_EXPENSE_RE = /deliver|shipping|courier|freight|transport|ដឹក/i;
// The income row behind a receipt entry: reference TX-<tx id>, and
// TX-<tx id>-ADJ for its LED-6 correction (add_order_payment_functions.sql).
const txIdOf = (ref: string): string | null => {
    const m = /^TX-([0-9a-fA-F-]{36})(?:-ADJ)?$/.exec(ref || '');
    return m ? m[1] : null;
};
// Couriers are grouped by name, case and spaces ignored (the same match
// Sales Setup's lists make).
const courierKey = (name: string): string => name.trim().toLowerCase();

interface RemitRow {
    entryId: string;
    date: string;
    number: string;      // entry_number, else reference_id
    refId: string;
    courier: string;
    bankRef: string;
    bankId: string;
    bankName: string;
    amount: number;      // USD, the bank debit (what landed in the bank)
    fee: number;         // USD the courier kept as its fee (the expense debit), 0 for none
    feeAccountId: string;
    currency: string | null;
    original_amount: number | null;
    exchange_rate: number | null;
    status: string;
    lineCount: number;
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

const CodRemittancesPage: React.FC = () => {
    const isMobile = useMobile();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const tc = (k: string) => t('ui.accounting.cod.' + k);
    const { shippingCompanies, khrExchangeRate } = useStore();
    const { saveJournalEntry } = useAccounting();
    const navigate = useNavigate();

    const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
    // Every line on 1210 (Draft and Posted: the receipts are Drafts until the
    // owner posts them, and the couriers hold that money all the same).
    // `courier`: who holds / remitted this line's money ('' = unassigned).
    type CodLine = { entryId: string; debit: number; credit: number; status: string; date: string; courier: string };
    const [codLines, setCodLines] = useState<CodLine[] | null>(null);
    const [rows, setRows] = useState<RemitRow[] | null>(null);
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
                // The COURIER receivable (1210) only: a deliveryman's money
                // (1220) is handed over directly and the order marked Paid —
                // it never goes through a courier remittance.
                const cod = (accs || []).find(a => a.account_type === 'Asset' && isCodCourierAccount(a))
                    || (accs || []).find(a => a.account_type === 'Asset' && isCodReceivableAccount(a));
                // Two fetches: every line on 1210 (the balance), and the
                // remittance entries with their lines (the list). The riel
                // columns arrive with add_khr_currency.sql.
                const loadCod = () => cod
                    ? supabase.from('journal_entry_lines')
                        .select(`id, journal_entry_id, account_id, debit, credit, entry:journal_entries!inner(id, date, status, reference_id, description)`)
                        .eq('account_id', cod.id).limit(5000)
                    : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null });
                const loadRemits = (withCurrency: boolean) => supabase
                    .from('journal_entries')
                    .select(`id, date, description, reference_id, entry_number, status${withCurrency ? ', currency, original_amount, exchange_rate' : ''}, lines:journal_entry_lines(id, account_id, debit, credit)`)
                    .like('reference_id', `${COD_REMIT_PREFIX}%`)
                    .order('date', { ascending: false })
                    .limit(2000);
                let remits = await loadRemits(true);
                if (remits.error && isMissingCurrencyColumnError(remits.error)) remits = await loadRemits(false);
                if (remits.error) throw remits.error;
                const codRes = await loadCod();
                if (codRes.error) throw codRes.error;

                // Which courier each 1210 line belongs to. A remittance names
                // its courier in the description. A receipt (TX-<tx>, and its
                // -ADJ correction) belongs to the income row's shipping
                // company, else its order's (a Paid checkout's income row
                // carries none). Anything else — the opening entry, a manual
                // journal — is unassigned.
                type CodRaw = { journal_entry_id: unknown; debit: unknown; credit: unknown; entry: { id?: unknown; date?: unknown; status?: unknown; reference_id?: unknown; description?: unknown } | null };
                const rawCod = (codRes.data || []) as unknown as CodRaw[];
                const txIds = Array.from(new Set(rawCod.map(l => txIdOf(String(l.entry?.reference_id || ''))).filter((x): x is string => !!x)));
                const txCourier = new Map<string, string>();
                const txOrder = new Map<string, string>();
                for (let i = 0; i < txIds.length; i += 200) {
                    // transactions.shipping_co (not shipping_company — that is
                    // the sales column).
                    const { data, error } = await supabase.from('transactions').select('id, shipping_co, order_id').in('id', txIds.slice(i, i + 200));
                    if (error) throw error;
                    for (const tr of (data || []) as { id: unknown; shipping_co?: unknown; order_id?: unknown }[]) {
                        if (tr.shipping_co) txCourier.set(String(tr.id), String(tr.shipping_co));
                        else if (tr.order_id) txOrder.set(String(tr.id), String(tr.order_id));
                    }
                }
                const orderIds = Array.from(new Set(txOrder.values()));
                const orderCourier = new Map<string, string>();
                for (let i = 0; i < orderIds.length; i += 200) {
                    const { data, error } = await supabase.from('sales').select('id, shipping_company').in('id', orderIds.slice(i, i + 200));
                    if (error) throw error;
                    for (const s of (data || []) as { id: unknown; shipping_company?: unknown }[]) {
                        if (s.shipping_company) orderCourier.set(String(s.id), String(s.shipping_company));
                    }
                }
                const courierOf = (ref: string, description: string): string => {
                    if (ref.startsWith(COD_REMIT_PREFIX)) return parseDescription(description).courier.trim();
                    const txId = txIdOf(ref);
                    if (!txId) return '';
                    return (txCourier.get(txId) || orderCourier.get(txOrder.get(txId) || '') || '').trim();
                };
                if (!alive) return;

                setCodLines(rawCod.map(l => ({
                    entryId: String(l.journal_entry_id), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
                    status: String(l.entry?.status || 'Posted'), date: String(l.entry?.date || '').slice(0, 10),
                    courier: courierOf(String(l.entry?.reference_id || ''), String(l.entry?.description || '')),
                })));
                const byId = new Map((accs || []).map(a => [a.id, a]));
                type RemitRaw = { id: unknown; date: unknown; description: unknown; reference_id: unknown; entry_number?: unknown; status?: unknown; currency?: unknown; original_amount?: unknown; exchange_rate?: unknown; lines: { account_id: unknown; debit: unknown; credit: unknown }[] | null };
                const parsed: RemitRow[] = ((remits.data || []) as unknown as RemitRaw[]).map(e => {
                    const lines = e.lines || [];
                    // Debits: the bank line (a cash/bank account), and the
                    // fee line (anything else) when the courier kept its fee.
                    const debits = lines.filter(l => (Number(l.debit) || 0) > 0 && !isCodReceivableAccount(byId.get(String(l.account_id)) || { account_name: '' }));
                    const isBank = (l: { account_id: unknown }) => { const a = byId.get(String(l.account_id)); return !!a && isCashBankAccount(a); };
                    const bank = debits.find(isBank) || debits[0];
                    const feeLines = debits.filter(l => l !== bank);
                    const { courier, ref } = parseDescription(String(e.description || ''));
                    return {
                        entryId: String(e.id),
                        date: String(e.date || '').slice(0, 10),
                        number: String(e.entry_number || e.reference_id || ''),
                        refId: String(e.reference_id || ''),
                        courier, bankRef: ref,
                        bankId: bank ? String(bank.account_id) : '',
                        bankName: bank ? (byId.get(String(bank.account_id))?.account_name || '?') : '—',
                        amount: bank ? Number(bank.debit) || 0 : 0,
                        fee: feeLines.reduce((s, l) => s + (Number(l.debit) || 0), 0),
                        feeAccountId: feeLines[0] ? String(feeLines[0].account_id) : '',
                        currency: e.currency ? String(e.currency) : null,
                        original_amount: e.original_amount === null || e.original_amount === undefined ? null : Number(e.original_amount),
                        exchange_rate: e.exchange_rate === null || e.exchange_rate === undefined ? null : Number(e.exchange_rate),
                        status: String(e.status || 'Posted'),
                        lineCount: lines.length,
                    };
                });
                const seq = (r: RemitRow) => { const m = /^JE-(\d+)-/.exec(r.number); return m ? Number(m[1]) : -1; };
                parsed.sort((a, b) => b.date.localeCompare(a.date) || seq(b) - seq(a) || b.entryId.localeCompare(a.entryId));
                setAccounts(accs || []);
                setRows(parsed);
            } catch (e) {
                console.error('Failed to load COD remittances:', e);
                if (!alive) return;
                setLoadError(e instanceof Error ? e.message : String(e));
                setRows(prev => prev ?? []);
                setCodLines(prev => prev ?? []);
            }
        })();
        return () => { alive = false; };
    }, [refreshKey]);

    // Courier first, matching the load above: the page settles 1210.
    const codAccount = useMemo(() => accounts.find(a => a.account_type === 'Asset' && isCodCourierAccount(a))
        || accounts.find(a => a.account_type === 'Asset' && isCodReceivableAccount(a)), [accounts]);
    // Where the remittance lands: the cash/bank accounts, petty cash aside
    // (a courier pays into the bank). Riel accounts under their own group.
    const bankAccounts = useMemo(
        () => sortCashBankForPicker(accounts.filter(a => a.is_active && isCashBankAccount(a) && !/petty/i.test(a.account_name))),
        [accounts]
    );
    const expenseAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Expense')
            .sort((a, b) => Number(!DELIVERY_EXPENSE_RE.test(a.account_name)) - Number(!DELIVERY_EXPENSE_RE.test(b.account_name)) || (a.account_code || '').localeCompare(b.account_code || '')),
        [accounts]
    );

    // ── Totals ──
    const totals = useMemo(() => {
        const all = (codLines || []).reduce((s, l) => s + l.debit - l.credit, 0);
        const posted = (codLines || []).filter(l => l.status !== 'Draft').reduce((s, l) => s + l.debit - l.credit, 0);
        const month = todayYmd().slice(0, 7);
        const remittedMonth = (rows || []).filter(r => r.date.slice(0, 7) === month).reduce((s, r) => s + r.amount, 0);
        return { held: all, heldPosted: posted, remittedMonth, count: (rows || []).length };
    }, [codLines, rows]);

    // Per courier: 1210 debits are what it collected, credits what it
    // remitted, the difference what it still holds. Named couriers by what
    // they hold, the unassigned remainder last.
    type CourierTotals = { name: string; collected: number; remitted: number; held: number };
    const byCourier = useMemo((): CourierTotals[] => {
        const groups = new Map<string, CourierTotals>();
        for (const l of codLines || []) {
            const key = courierKey(l.courier);
            const g = groups.get(key) || { name: l.courier.trim(), collected: 0, remitted: 0, held: 0 };
            g.collected += l.debit;
            g.remitted += l.credit;
            g.held += l.debit - l.credit;
            groups.set(key, g);
        }
        return Array.from(groups.values()).sort((a, b) =>
            Number(a.name === '') - Number(b.name === '') || b.held - a.held || a.name.localeCompare(b.name));
    }, [codLines]);

    // ── Form ──
    const [date, setDate] = useState(todayYmd());
    const [courier, setCourier] = useState('');
    const [courierOther, setCourierOther] = useState('');
    const [bankId, setBankId] = useState('');
    const [bankRef, setBankRef] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const field = useMoneyField({ shopRate: khrExchangeRate });
    const coupling = useAccountCurrency(field, bankAccounts, bankId, setBankId);
    const [editing, setEditing] = useState<RemitRow | null>(null);
    // The fee the courier kept, typed in the amount's currency (riel at the
    // amount's rate), and the expense it goes to.
    const [fee, setFee] = useState('');
    const [feeAccountId, setFeeAccountId] = useState('');
    useEffect(() => {
        setFeeAccountId(prev => (prev && expenseAccounts.some(a => a.id === prev)) ? prev : (expenseAccounts[0]?.id || ''));
    }, [expenseAccounts]);

    useEffect(() => {
        if (!courier && shippingCompanies.length > 0) setCourier(shippingCompanies[0]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shippingCompanies]);
    // Couriers remit riel into the ABA riel account: that is the default
    // when the store has one, else the first dollar bank account.
    useEffect(() => {
        if (bankAccounts.length === 0) return;
        setBankId(prev => {
            if (prev && bankAccounts.some(a => a.id === prev)) return prev;
            const riel = bankAccounts.find(a => isKhrAccountName(a.account_name) && /bank|aba/i.test(a.account_name));
            const usd = bankAccounts.find(a => !isKhrAccountName(a.account_name) && /bank|aba/i.test(a.account_name));
            const pick = riel || usd || bankAccounts[0];
            if (pick && field.currency !== (isKhrAccountName(pick.account_name) ? 'KHR' : 'USD')) field.reinterpret(isKhrAccountName(pick.account_name) ? 'KHR' : 'USD');
            return pick?.id || '';
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bankAccounts]);

    const courierName = (courier === '__other__' ? courierOther : courier).trim();
    const chosenHolds = useMemo(() => byCourier.find(g => g.name !== '' && courierKey(g.name) === courierKey(courierName)), [byCourier, courierName]);
    const amountUsd = field.usd;
    const feeTyped = parseAmount(fee);
    const feeUsd = !(feeTyped > 0) ? 0
        : field.currency === 'KHR' ? khrToUsd(feeTyped, Number(field.rate)) : Math.round(feeTyped * 100) / 100;
    const grossUsd = Math.round((amountUsd + feeUsd) * 100) / 100;
    const feeInvalid = fee.trim() !== '' && !(feeTyped >= 0);
    const canSave = !isSaving && amountUsd > 0 && !field.rateInvalid && !feeInvalid && (feeUsd === 0 || !!feeAccountId)
        && !!bankId && !!codAccount && !!date && !!courierName;
    // "All": everything the chosen courier still holds reaches the bank —
    // with a fee typed, the amount is held − fee, so Cr 1210 lands on the
    // held figure exactly and the courier's row empties to zero.
    const allUsd = chosenHolds ? Math.max(0, roundCents(chosenHolds.held - feeUsd)) : 0;
    const allRate = Number(field.rate) > 0 ? Number(field.rate) : field.shopRate;
    const fillAll = () => {
        if (!(allUsd > 0)) return;
        // A riel field takes riel: to the single riel (not the usual 100) so
        // it converts back to the held USD figure to the cent.
        field.setAmount(String(field.currency === 'KHR' ? usdToKhr(allUsd, allRate, 1) : allUsd));
    };

    const resetForm = () => {
        setEditing(null);
        field.setAmount('');
        setFee('');
        setBankRef('');
        setDate(todayYmd());
    };

    const header = (entryNumber: string | null): Partial<JournalEntry> => ({
        date,
        description: describe(courierName, bankRef.trim(), feeUsd),
        status: 'Draft',
        ...(entryNumber ? { entry_number: entryNumber } : {}),
        ...field.meta,
    });
    // Dr bank (what landed) + Dr expense (the fee the courier kept) / Cr 1210
    // (both: the courier no longer holds either).
    const entryLines = () => [
        { account_id: bankId, debit: amountUsd, credit: 0, description: `Remittance from ${courierName}` },
        ...(feeUsd > 0 ? [{ account_id: feeAccountId, debit: feeUsd, credit: 0, description: `Delivery fee kept by ${courierName}` }] : []),
        { account_id: codAccount!.id, debit: 0, credit: grossUsd, description: `COD remitted — ${courierName}` },
    ];

    const handleSave = async () => {
        if (!canSave) return;
        if (!field.confirmIfSuspicious()) return;
        setIsSaving(true);
        try {
            if (editing) {
                // A Draft rewritten in place: header first, then the two lines
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
                const entryNumber = await nextJournalEntryNumber('COD', date);
                await saveJournalEntry({ ...header(entryNumber), reference_id: `${COD_REMIT_PREFIX}${Date.now()}` }, entryLines());
                showToast(tc('toast.saved'), 'success');
            }
            resetForm();
            refetch();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast(tc('toast.saveFailed') + ': ' + msg, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const startEdit = (r: RemitRow) => {
        if (r.status !== 'Draft') { showToast(tc('toast.postedNoChange'), 'info'); return; }
        setEditing(r);
        setDate(r.date);
        const known = shippingCompanies.includes(r.courier);
        setCourier(known ? r.courier : '__other__');
        if (!known) setCourierOther(r.courier);
        setBankRef(r.bankRef);
        if (r.bankId) setBankId(r.bankId);
        const khr = r.currency === 'KHR' && !!r.original_amount;
        field.reset(khr
            ? { amount: r.original_amount!, currency: 'KHR', rate: r.exchange_rate || undefined }
            : { amount: r.amount, currency: 'USD' });
        setFee(r.fee > 0 ? String(khr && r.exchange_rate ? usdToKhr(r.fee, r.exchange_rate, 1) : r.fee) : '');
        if (r.feeAccountId) setFeeAccountId(r.feeAccountId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
    const handleDelete = async (r: RemitRow) => {
        if (r.status !== 'Draft') { showToast(tc('toast.postedNoChange'), 'info'); return; }
        if (busyIds.has(r.entryId)) return;
        if (!confirm(fill(tc('confirm.delete'), { amount: fmt(r.amount), courier: r.courier, date: r.date }))) return;
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

    const loading = rows === null;
    const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
    // Every label row is as tall as the Amount field's (its USD | KHR toggle
    // is 26px, components/MoneyInput), and the grid aligns at the top: the
    // inputs of one row then line up whatever the Amount field shows under
    // itself (the riel rate row, a warning), instead of the neighbours
    // sinking to its bottom edge.
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

    return (
        <div className="acct-page" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Totals */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px' }}>
                {[
                    { label: tc('card.held'), value: fmt(totals.held), sub: fill(tc('card.heldPosted'), { amount: fmt(totals.heldPosted) }) },
                    { label: tc('card.remittedMonth'), value: fmt(totals.remittedMonth) },
                    { label: tc('card.count'), value: String(totals.count) },
                ].map(c => (
                    <div key={c.label} style={{ ...cardStyle, borderTop: `3px solid ${BLUE}`, padding: '14px 16px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{c.label}</div>
                        <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : c.value}</div>
                        {c.sub && !loading && <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>{c.sub}</div>}
                    </div>
                ))}
            </div>

            {/* Per courier: collected, remitted, still held. */}
            {!loading && byCourier.length > 0 && (
                <div style={{ ...cardStyle, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-text-main)' }}>{tc('byCourier.title')}</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{tc('byCourier.hint')}</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={th}>{tc('byCourier.courier')}</th>
                                    <th style={{ ...th, textAlign: 'right' }}>{tc('byCourier.collected')}</th>
                                    <th style={{ ...th, textAlign: 'right' }}>{tc('byCourier.remitted')}</th>
                                    <th style={{ ...th, textAlign: 'right' }}>{tc('byCourier.held')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {byCourier.map(g => (
                                    <tr key={g.name || '__unassigned__'}>
                                        <td style={td}>{g.name || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{tc('byCourier.unassigned')}</span>}</td>
                                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(g.collected)}</td>
                                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(g.remitted)}</td>
                                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: g.held < -0.005 ? '#B91C1C' : g.held > 0.005 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{fmt(g.held)}</td>
                                    </tr>
                                ))}
                                <tr>
                                    <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{tc('byCourier.total')}</td>
                                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, borderBottom: 'none' }}>{fmt(byCourier.reduce((s, g) => s + g.collected, 0))}</td>
                                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, borderBottom: 'none' }}>{fmt(byCourier.reduce((s, g) => s + g.remitted, 0))}</td>
                                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 800, borderBottom: 'none' }}>{fmt(totals.held)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Form */}
            <div style={{ ...cardStyle, borderLeft: `4px solid ${editing ? '#F59E0B' : BLUE}`, background: editing ? 'rgba(245, 158, 11, 0.04)' : undefined, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: `${BLUE}1A`, color: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Truck size={18} />
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text-main)' }}>
                        {editing ? tc('editEntry') : tc('newEntry')}
                        {editing && <span style={{ marginLeft: '10px', fontSize: '11px', fontWeight: 500, color: 'var(--color-text-muted)' }}>{editing.number}</span>}
                    </div>
                </div>

                {!loading && !codAccount ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', fontSize: '13px', color: 'var(--color-text-main)' }}>
                        <AlertTriangle size={18} color="#F59E0B" style={{ flexShrink: 0 }} />
                        <span>{tc('noAccount')}</span>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '12px', alignItems: 'start' }}>
                        <div>
                            <label style={labelStyle}>{t('ui.accounting.common.date')}</label>
                            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                            <label style={labelStyle}>{tc('courier')}</label>
                            <select value={courier} onChange={e => setCourier(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                {shippingCompanies.map(c => <option key={c} value={c}>{c}</option>)}
                                <option value="__other__">{tc('courierOther')}</option>
                            </select>
                            {courier === '__other__' && (
                                <input type="text" value={courierOther} onChange={e => setCourierOther(e.target.value)} placeholder={tc('courierOtherPh')} style={{ ...inputStyle, marginTop: '6px' }} />
                            )}
                            {chosenHolds && (
                                <div style={{ marginTop: '6px', fontSize: '11px', color: chosenHolds.held < -0.005 ? '#B91C1C' : 'var(--color-text-muted)' }}>
                                    {fill(tc('byCourier.holds'), { amount: fmt(chosenHolds.held) })}
                                </div>
                            )}
                        </div>
                        <div>
                            <label style={labelStyle}>{tc('bankRef')}</label>
                            <input type="text" value={bankRef} onChange={e => setBankRef(e.target.value)} placeholder={tc('bankRefPh')} style={inputStyle} />
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
                            {allUsd > 0 && (
                                <button
                                    type="button"
                                    onClick={fillAll}
                                    title={tc('allHint')}
                                    style={{
                                        marginTop: '6px', padding: '3px 10px', borderRadius: '6px', cursor: 'pointer',
                                        border: `1px solid color-mix(in srgb, ${BLUE} 45%, var(--color-border))`,
                                        background: 'transparent', color: BLUE, fontSize: '11px', fontWeight: 700,
                                    }}
                                >
                                    {fill(tc('allBtn'), { amount: field.currency === 'KHR' ? formatKhr(usdToKhr(allUsd, allRate, 1)) : `USD ${fmt(allUsd)}` })}
                                </button>
                            )}
                        </div>
                        <div>
                            <label style={labelStyle}>{tc('receivedInto')}</label>
                            <select value={bankId} onChange={e => coupling.onAccountChange(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                {bankAccounts.length === 0 && <option value="">{t('ui.components.common.bankOrCash')}</option>}
                                <CashBankOptions accounts={bankAccounts} />
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>{tc('creditedTo')}</label>
                            <input type="text" value={codAccount ? `${codAccount.account_code} · ${codAccount.account_name}` : ''} disabled style={{ ...inputStyle, opacity: 0.7 }} />
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
                        {amountUsd > 0 && bankId && codAccount && (
                            <div style={{ gridColumn: '1 / -1', borderRadius: '10px', border: `1px solid color-mix(in srgb, ${BLUE} 30%, var(--color-border))`, background: `color-mix(in srgb, ${BLUE} 4%, var(--color-surface))`, padding: '10px 14px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: BLUE, marginBottom: '4px' }}>{t('ui.accounting.re.preview')}</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--color-border)', fontSize: '13px', color: 'var(--color-text-main)' }}>
                                    <span>{fill(t('ui.accounting.re.drDot'), { name: accounts.find(a => a.id === bankId)?.account_name || '?' })}</span>
                                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>USD {fmt(amountUsd)}{field.currency === 'KHR' && <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}> ({formatMoneyLine({ amount: amountUsd, ...field.meta })})</span>}</span>
                                </div>
                                {feeUsd > 0 && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--color-border)', fontSize: '13px', color: 'var(--color-text-main)' }}>
                                        <span>{fill(t('ui.accounting.re.drDot'), { name: accounts.find(a => a.id === feeAccountId)?.account_name || '?' })}</span>
                                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>USD {fmt(feeUsd)}</span>
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0 2px', fontSize: '13px', color: 'var(--color-text-main)' }}>
                                    <span style={{ paddingLeft: '18px' }}>{fill(t('ui.accounting.re.crDot'), { name: codAccount.account_name })}</span>
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
                                    background: canSave ? BLUE : 'var(--color-border)', color: canSave ? 'white' : 'var(--color-text-muted)',
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
                                    <span style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>{r.courier}</span>
                                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(r)}</span>
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{r.date} · {r.bankName}{r.bankRef ? ` · REF ${r.bankRef}` : ''}{r.fee > 0 ? ` · ${fill(tc('feeShort'), { amount: fmt(r.fee) })}` : ''}</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--color-text-muted)' }}>{r.number}</span>
                                    <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        <StatusChip status={r.status} />
                                        {r.status === 'Draft' && <>
                                            <button onClick={() => startEdit(r)} style={btn}><Pencil size={13} /></button>
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
                                    <th style={th}>{tc('courier')}</th>
                                    <th style={th}>{tc('receivedInto')}</th>
                                    <th style={th}>{tc('bankRef')}</th>
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
                                        <td style={td}>{r.courier}</td>
                                        <td style={td}>{r.bankName}</td>
                                        <td style={{ ...td, fontFamily: 'monospace', fontSize: '12px' }}>{r.bankRef || '—'}</td>
                                        <td style={{ ...td, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(r)}</td>
                                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: r.fee > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{r.fee > 0 ? `USD ${fmt(r.fee)}` : '—'}</td>
                                        <td style={td}><StatusChip status={r.status} /></td>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                            {r.status === 'Draft' ? (
                                                <span style={{ display: 'inline-flex', gap: '6px' }}>
                                                    <button onClick={() => startEdit(r)} style={btn} title={t('common.edit')}><Pencil size={13} /></button>
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

export default CodRemittancesPage;
