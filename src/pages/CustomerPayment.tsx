// Customer Payment — every retail customer payment record (Record Receipt /
// Deposit entries posted from Payment Tracking and Orders) with its ledger
// status; Draft rows can be finalized with Post Now. This is a dedicated
// full-history listing page, so it runs its own Supabase queries (filtered
// server-side to the two retail categories written by StoreContext's
// updateOrder) rather than reading the shared, globally-capped
// useStore().transactions (only the 50 most recent rows across every category):
//   'លក់រាយ'   (Retail)  -> a Paid/receipt transaction
//   'កក់ប្រាក់' (Deposit) -> a deposit transaction
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Receipt, Hash, Wallet, X, ExternalLink, Download, RefreshCw, ChevronDown, ChevronLeft, ChevronRight, Truck, Banknote, CircleDollarSign, AlertTriangle, Trash2 } from 'lucide-react';
import { postOrFinalizeTransactionReceipt, useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { useMobile } from '../hooks/useMobile';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../utils/fetchAll';
import { addDays, dayKeyFromDate, parseDay } from '../utils/dateRange';
import { getShippingCoColor } from '../utils/orderUtils';
import { getPaymentIcon, getPaymentColor } from '../utils/payment';
import { DateRangePicker, StatsCard, RecordReceiptModal, OrderDetailsModal } from '../components';
import type { Transaction, Customer } from '../types';

// `reference` / `notes` were added by migrations/add_transaction_reference_notes.sql,
// `order_id` / `customer_phone` by migrations/add_transaction_order_link.sql — none may
// exist yet on every database instance, so keep them optional here rather than widening
// the shared Transaction type.
type CustomerPaymentRow = Transaction & {
    reference?: string | null;
    notes?: string | null;
    order_id?: string | null;
    customer_phone?: string | null;
};

// Matches the `#DEP-<first 8 chars of the order's id>` suffix StoreContext appends to a
// Deposit transaction's description (see addOnlineOrder / updateOrder's Deposit branch).
// Only used as a fallback to resolve older Deposit rows that predate `order_id`.
const DEP_ORDER_FRAGMENT_REGEX = /#DEP-([0-9A-Za-z]{8})$/;

const RETAIL_PAYMENT_CATEGORY = 'លក់រាយ';
const RETAIL_DEPOSIT_CATEGORY = 'កក់ប្រាក់';

// Rows per request — at PostgREST's max-rows cap, so pages are fetched in parallel.
const PAGE_ROWS = 1000;

// The View-button lookup for legacy Deposit rows queries `sales` directly
// (never the shared, paginated useStore().sales — see fragmentMatches below) so
// it stays accurate no matter how much of `sales` Orders.tsx has paginated into
// memory.
const PREFIX_CHUNK = 50;  // #DEP-<fragment> patterns per .or()

const chunk = <T,>(items: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
};

// Safari chokes on "YYYY-MM-DD HH:MM:SS" (needs a "T"), same guard as IncomeExpense.
const parseDate = (dateStr?: string): Date => {
    if (!dateStr) return new Date(NaN);
    const safeStr = dateStr.includes(' ') ? dateStr.replace(' ', 'T') : dateStr;
    return new Date(safeStr);
};

const formatDate = (dateStr?: string): string => {
    const d = parseDate(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatAmount = (amount: number): string =>
    `$${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Local calendar day as YYYY-MM-DD — never toISOString() a date directly, it UTC-shifts.
const localYMD = (dateStr?: string): string => {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const d = parseDate(dateStr);
    if (isNaN(d.getTime())) return dateStr.slice(0, 10);
    return dayKeyFromDate(d);
};

type PayTypeFilter = 'All' | 'Paid' | 'Deposit';
type StatusFilter = 'All' | 'Draft' | 'Posted';
type LedgerStatus = 'Posted' | 'Draft';

const isDepositRow = (r: CustomerPaymentRow) => r.category === RETAIL_DEPOSIT_CATEGORY;

const TypeBadge: React.FC<{ category?: string }> = ({ category }) => {
    const isDeposit = category === RETAIL_DEPOSIT_CATEGORY;
    const label = isDeposit ? 'Deposit' : 'Paid';
    const color = isDeposit ? '#7C3AED' : '#059669';
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: '12px',
            fontSize: '11px', fontWeight: 700, background: `${color}1A`, color
        }}>
            {label}
        </span>
    );
};

// Posted (soft blue) / Draft (amber) — same convention as JournalEntriesPage's
// own status chip, so this column reads consistently with the rest of the
// accounting section. 'Unknown' while the ledger lookup is loading or failed.
const StatusChip: React.FC<{ status: LedgerStatus | 'Unknown' }> = ({ status }) => (
    <span style={{
        display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: '12px',
        fontSize: '11px', fontWeight: 700,
        background: status === 'Draft' ? '#fef3c7' : status === 'Posted' ? 'rgba(84, 105, 212, 0.12)' : 'var(--color-bg)',
        color: status === 'Draft' ? '#92400e' : status === 'Posted' ? '#4c5fd0' : 'var(--color-text-secondary)',
    }}>
        {status === 'Unknown' ? '…' : status}
    </span>
);

const Notice: React.FC<{ children: React.ReactNode; onRetry?: () => void }> = ({ children, onRetry }) => (
    <div role="alert" style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '10px',
        background: '#fef3c7', color: '#92400e', fontSize: '13px'
    }}>
        <AlertTriangle size={16} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{children}</span>
        {onRetry && (
            <button onClick={onRetry} style={{ padding: '4px 12px', borderRadius: '8px', border: '1px solid #92400e', background: 'transparent', color: '#92400e', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                Retry
            </button>
        )}
    </div>
);

const CustomerPaymentPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();
    const { showToast } = useToast();
    const { currentUser } = useStore();
    // Unposting rewinds finalized books, so it stays an admin-only action
    // (same gate as Income & Expense's bulk delete).
    const isAdmin = currentUser?.roleId === 'admin';
    const isMobile = useMobile();

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('nav.customerPayment')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Retail customer payments and deposits — post Draft rows to the ledger</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
    const [typeFilter, setTypeFilter] = useState<PayTypeFilter>('All');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
    const [shippingFilter, setShippingFilter] = useState('All');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);

    // This page's own dedicated data: every retail Payment/Deposit transaction in
    // the range, fetched completely (paged past the API row cap) so the totals
    // and search cover the whole history, not just the newest rows.
    const [allRetailPayments, setAllRetailPayments] = useState<CustomerPaymentRow[]>([]);
    const [isLoadingTransactions, setIsLoadingTransactions] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const fetchSeqRef = useRef(0);
    // Date corrections made by the Post Now flow (txId -> new stored date). A
    // range fetch that read the DB before the correction committed re-applies
    // these on resolve instead of reverting the row; entries clear themselves
    // once the server round-trips the moved date.
    const dateCorrectionsRef = useRef(new Map<string, string>());

    const fetchRetailPayments = useCallback(async () => {
        const seq = ++fetchSeqRef.current;
        setIsLoadingTransactions(true);
        setLoadError(null);
        const build = (withCount: boolean) => {
            let q = supabase.from('transactions')
                .select('*', withCount ? { count: 'exact' } : undefined)
                .eq('type', 'Income')
                .in('category', [RETAIL_PAYMENT_CATEGORY, RETAIL_DEPOSIT_CATEGORY]);
            // Local-midnight bounds: the From day from 00:00, through the end of the To day.
            if (dateRange.start) q = q.gte('date', parseDay(dateRange.start).toISOString());
            if (dateRange.end) q = q.lt('date', parseDay(addDays(dateRange.end, 1)).toISOString());
            return q.order('date', { ascending: false }).order('id', { ascending: false });
        };
        try {
            const first = await build(true).range(0, PAGE_ROWS - 1);
            if (first.error) throw first.error;
            const rows = (first.data || []) as CustomerPaymentRow[];
            const total = first.count ?? rows.length;
            if (rows.length > 0 && rows.length < total) {
                // Step by what the server actually returned, in case its cap is below PAGE_ROWS.
                const step = rows.length;
                const rest = await Promise.all(
                    Array.from({ length: Math.ceil(total / step) - 1 }, (_, i) => build(false).range((i + 1) * step, (i + 2) * step - 1))
                );
                const seen = new Set(rows.map(r => r.id));
                for (const page of rest) {
                    if (page.error) throw page.error;
                    for (const row of (page.data || []) as CustomerPaymentRow[]) {
                        if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
                    }
                }
            }
            if (seq !== fetchSeqRef.current) return;
            const corrections = dateCorrectionsRef.current;
            if (corrections.size > 0) {
                for (const row of rows) {
                    const corrected = corrections.get(row.id);
                    if (!corrected) continue;
                    if (localYMD(row.date) === localYMD(corrected)) corrections.delete(row.id);
                    else row.date = corrected;
                }
            }
            setAllRetailPayments(rows);
        } catch (error) {
            if (seq !== fetchSeqRef.current) return;
            console.error('Failed to fetch customer payments:', error);
            setAllRetailPayments([]);
            setLoadError((error as { message?: string })?.message || 'Unknown error');
        } finally {
            if (seq === fetchSeqRef.current) setIsLoadingTransactions(false);
        }
    }, [dateRange]);

    useEffect(() => {
        fetchRetailPayments();
    }, [fetchRetailPayments]);

    // Deleted-order detection: orders are soft-deleted (archived to
    // deleted_orders, restorable from there) and the transactions table is
    // never touched when that happens, so a payment row can outlive its order.
    // Hide a payment only when its order POSITIVELY shows up in deleted_orders
    // — never a row with no link at all (predates tracking, can't tell either
    // way), and never when the lookup itself failed. deleted_orders is tiny
    // (~hundreds of ids), so ONE small query — independent of the payment rows
    // and fired in parallel with them — replaces the old per-order existence
    // scan of `sales` (thousands of ids in chunked queries that blocked the
    // table for seconds).
    const [deletedOrders, setDeletedOrders] = useState<{ ids: string[]; failed: boolean } | null>(null);
    const [deletedNonce, setDeletedNonce] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const rows = await fetchAll<{ id: string }>((from, to) => supabase
                    .from('deleted_orders').select('id').order('id', { ascending: true }).range(from, to));
                if (!cancelled) setDeletedOrders({ ids: rows.map(r => r.id), failed: false });
            } catch (err) {
                console.error('Failed to load deleted orders:', err);
                // A stale list from a previous success beats hiding nothing.
                if (!cancelled) setDeletedOrders(prev => prev && !prev.failed ? prev : { ids: [], failed: true });
            }
        })();
        return () => { cancelled = true; };
    }, [deletedNonce]);

    const resolutionReady = deletedOrders !== null;
    const resolutionFailed = !!deletedOrders?.failed;

    const deletedOrderTxIds = useMemo(() => {
        const ids = new Set<string>();
        if (!deletedOrders || deletedOrders.failed || deletedOrders.ids.length === 0) return ids;
        const deletedSet = new Set(deletedOrders.ids);
        for (const r of allRetailPayments) {
            if (r.order_id) {
                if (deletedSet.has(r.order_id)) ids.add(r.id);
                continue;
            }
            // Legacy Deposit rows carry only the #DEP-<id8> marker.
            if (isDepositRow(r)) {
                const match = DEP_ORDER_FRAGMENT_REGEX.exec(r.description || '');
                if (match && deletedOrders.ids.some(id => id.startsWith(match[1]))) ids.add(r.id);
            }
        }
        return ids;
    }, [allRetailPayments, deletedOrders]);

    const retailPayments = useMemo(
        () => allRetailPayments.filter(r => !deletedOrderTxIds.has(r.id)),
        [allRetailPayments, deletedOrderTxIds]
    );

    // Newest first; sorted once per data load, not on every search keystroke.
    const sortedPayments = useMemo(() => retailPayments
        .map(r => ({ r, d: parseDate(r.date).getTime() || 0, c: r.created_at ? new Date(r.created_at).getTime() || 0 : 0 }))
        .sort((a, b) => (b.d - a.d) || (b.c - a.c))
        .map(x => x.r), [retailPayments]);

    // Only show the Reference / Notes columns when this database instance actually
    // has data in them — they may not exist on every instance yet.
    const hasReferenceData = useMemo(() => retailPayments.some(r => (r.reference || '').trim() !== ''), [retailPayments]);
    const hasNotesData = useMemo(() => retailPayments.some(r => (r.notes || '').trim() !== ''), [retailPayments]);

    const shippingOptions = useMemo(
        () => Array.from(new Set(retailPayments.map(r => r.shipping_co).filter((s): s is string => !!s))).sort(),
        [retailPayments]
    );

    // Ledger status lives on the journal_entries row linked by reference_id ===
    // 'TX-' + transaction id. Loaded directly (every TX- entry, paged past the API
    // row cap) rather than through the shared full-ledger fetch. Until the first
    // load succeeds the status is unknown and Post Now stays disabled; later
    // reloads run in the background on top of the last good result (the server
    // refuses to rewrite a Posted entry, so a slightly stale Draft is safe).
    const [ledger, setLedger] = useState<{
        state: 'loading' | 'ready' | 'error';
        byTx: Map<string, LedgerStatus>;
        debitAccountByTx: Map<string, string>; // existing entry's cash/bank account
        refreshError: boolean;
        // Instance never ran add_entry_status.sql: every entry reads as Posted
        // and unposting can't work, so the Unpost button must not be offered.
        statusMissing: boolean;
    }>({ state: 'loading', byTx: new Map(), debitAccountByTx: new Map(), refreshError: false, statusMissing: false });
    const [ledgerNonce, setLedgerNonce] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLedger(prev => prev.state === 'ready' ? prev : { ...prev, state: 'loading' });
        type JeLine = { account_id: string; debit: number | string | null; account?: { account_type?: string | null; account_name?: string | null } | null };
        type JeRow = { reference_id: string | null; status?: string | null; lines?: JeLine[] | null };
        const load = (cols: string) => fetchAll<JeRow>((from, to) => supabase
            .from('journal_entries')
            .select(cols)
            .like('reference_id', 'TX-%')
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: JeRow[] | null; error: unknown }>);
        (async () => {
            try {
                const lineCols = 'lines:journal_entry_lines(account_id, debit, account:chart_of_accounts(account_type, account_name))';
                let rows: JeRow[];
                let statusMissing = false;
                try {
                    rows = await load(`reference_id, status, ${lineCols}`);
                } catch (err) {
                    // Instances without migrations/add_entry_status.sql: every entry counts as Posted.
                    if (!/status/i.test((err as { message?: string })?.message || '')) throw err;
                    statusMissing = true;
                    rows = await load(`reference_id, ${lineCols}`);
                }
                const byTx = new Map<string, LedgerStatus>();
                const debitAccountByTx = new Map<string, string>();
                for (const je of rows) {
                    const ref = je.reference_id || '';
                    if (!ref.startsWith('TX-')) continue;
                    const txId = ref.slice(3);
                    if (byTx.get(txId) !== 'Posted') byTx.set(txId, je.status === 'Draft' ? 'Draft' : 'Posted');
                    // The entry's cash side only — an RCP entry also carries a COGS
                    // debit, which must never become the "Deposited into" prefill.
                    const debit = (je.lines || []).find(l => Number(l.debit) > 0
                        && l.account?.account_type === 'Asset' && /cash|bank/i.test(l.account?.account_name || ''));
                    if (debit && !debitAccountByTx.has(txId)) debitAccountByTx.set(txId, debit.account_id);
                }
                if (!cancelled) setLedger({ state: 'ready', byTx, debitAccountByTx, refreshError: false, statusMissing });
            } catch (err) {
                console.error('Failed to load ledger status for customer payments:', err);
                if (!cancelled) setLedger(prev => prev.state === 'ready' ? { ...prev, refreshError: true } : { ...prev, state: 'error' });
            }
        })();
        return () => { cancelled = true; };
    }, [ledgerNonce]);

    // Rows posted in this session, so they flip to Posted immediately.
    const [postedIds, setPostedIds] = useState<Set<string>>(new Set());
    const [postingIds, setPostingIds] = useState<Set<string>>(new Set());
    // Row checkboxes for bulk Post Now / bulk Delete. Raw picks; the effective
    // selection is derived below so rows that got posted, deleted or filtered
    // away drop out on their own.
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBulkPosting, setIsBulkPosting] = useState(false);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [isBulkUnposting, setIsBulkUnposting] = useState(false);
    // Bulk Post Now popup: null = closed. date '' keeps each payment's own day,
    // accountId '' resolves the deposit account per payment (same defaults the
    // old confirm-based flow used); notes apply to every posted entry.
    const [bulkPostForm, setBulkPostForm] = useState<{ date: string; accountId: string; notes: string } | null>(null);
    const [bulkAccounts, setBulkAccounts] = useState<{ id: string; account_name: string }[]>([]);

    // No matching entry at all is treated the same as an unposted (Draft) one.
    const statusOf = useCallback(
        (txId: string): LedgerStatus => postedIds.has(txId) ? 'Posted' : (ledger.byTx.get(txId) || 'Draft'),
        [postedIds, ledger.byTx]
    );
    const ledgerReady = ledger.state === 'ready';

    // Resolve each row's originating order id (for the "View" action):
    //   1. transaction.order_id, when this instance has run
    //      migrations/add_transaction_order_link.sql and the row was written after that.
    //   2. Else, for Deposit-type rows only, parse the `#DEP-<id8>` fragment out of the
    //      description and look for exactly one sale whose id starts with it — zero or
    //      more than one match is treated as unresolved, never guessed.
    //   3. Else (Payment-type rows with no marker): unresolved — no View button.
    // The fragment lookup against `sales` is NON-blocking: it only adds View
    // buttons on legacy rows, so the table never waits for it.
    const [fragmentMatches, setFragmentMatches] = useState<Map<string, string[]>>(new Map());

    useEffect(() => {
        let cancelled = false;
        const fragments = Array.from(new Set(
            allRetailPayments
                .filter(r => !r.order_id && isDepositRow(r))
                .map(r => DEP_ORDER_FRAGMENT_REGEX.exec(r.description || '')?.[1])
                .filter((f): f is string => !!f)
        ));
        if (fragments.length === 0) { setFragmentMatches(new Map()); return; }
        (async () => {
            const matches = new Map<string, string[]>();
            const results = await Promise.allSettled(chunk(fragments, PREFIX_CHUNK).map(async batch => {
                const { data, error } = await supabase
                    .from('sales')
                    .select('id')
                    .or(batch.map(p => `id.like.${p}%`).join(','));
                if (error) throw error;
                for (const s of (data || []) as { id: string }[]) {
                    for (const p of batch) {
                        if (!s.id.startsWith(p)) continue;
                        const list = matches.get(p);
                        if (list) list.push(s.id); else matches.set(p, [s.id]);
                    }
                }
            }));
            results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
                .forEach(f => console.error('Failed to resolve deposit order links:', f.reason));
            if (!cancelled) setFragmentMatches(matches);
        })();
        return () => { cancelled = true; };
    }, [allRetailPayments]);

    const orderIdByTxId = useMemo(() => {
        const map = new Map<string, string>(); // txId -> resolved order id
        for (const r of retailPayments) {
            if (r.order_id) {
                map.set(r.id, r.order_id);
                continue;
            }
            if (isDepositRow(r)) {
                const match = DEP_ORDER_FRAGMENT_REGEX.exec(r.description || '');
                const candidates = match ? (fragmentMatches.get(match[1]) || []) : [];
                if (candidates.length === 1) map.set(r.id, candidates[0]);
            }
        }
        return map;
    }, [retailPayments, fragmentMatches]);

    // Order id currently shown in the View popup (OrderDetailsModal), null when closed.
    const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);

    // Row currently being finalized via the "Post Now" / Record Receipt flow.
    const [postTarget, setPostTarget] = useState<CustomerPaymentRow | null>(null);
    const postTargetOrder = useMemo(() => {
        if (!postTarget) return null;
        // Synthetic order-like object for RecordReceiptModal's minimal `order`
        // prop — not a real Sale/order. finalizeMode fixes the amount to this total.
        const syntheticCustomer: Customer = { id: postTarget.id, name: postTarget.description || 'Customer', phone: '' };
        return { total: Number(postTarget.amount || 0), amountReceived: 0, depositAmount: 0, customer: syntheticCustomer };
    }, [postTarget]);

    // After a successful posting, moves the payment row (and its linked sale's
    // settled/deposit day) to the picked day, so the DATE column, Income &
    // Expense, the Orders page and the ledger all land together. settleDateIso
    // is the picked YYYY-MM-DD at UTC midnight — transactions.date's stored
    // convention. Comparison runs in the DISPLAY frame (localYMD both sides) so
    // the update only runs when the day the user sees actually changes.
    const moveTransactionDay = async (
        tx: CustomerPaymentRow,
        settleDateIso: string
    ): Promise<{ status: 'unchanged' | 'moved' | 'row-failed'; saleFailed: boolean; message?: string }> => {
        const pickedDay = localYMD(settleDateIso);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(pickedDay) || pickedDay === localYMD(tx.date)) {
            return { status: 'unchanged', saleFailed: false };
        }
        const { error } = await supabase.from('transactions').update({ date: settleDateIso }).eq('id', tx.id);
        if (error) {
            console.error('Posted, but could not move the payment date:', error);
            return { status: 'row-failed', saleFailed: false, message: error.message || 'unknown error' };
        }
        // The sale's own paid/deposit day must move with it: Orders' Settled
        // Date column filters on it, and StoreContext's settle-date sync would
        // otherwise clobber this row back to the old day on the next order edit.
        let saleFailed = false;
        const orderId = orderIdByTxId.get(tx.id);
        if (orderId) {
            const salePatch = isDepositRow(tx)
                ? { deposit_date: settleDateIso.slice(0, 10) } // DATE column: plain Y-M-D
                : { settle_date: settleDateIso };
            const { error: saleErr } = await supabase.from('sales').update(salePatch).eq('id', orderId);
            if (saleErr) {
                console.error('Moved the payment date, but not the order’s settled/deposit date:', saleErr);
                saleFailed = true;
            }
        }
        // Survive a range fetch that read the DB before this commit:
        // fetchRetailPayments re-applies this correction on resolve.
        dateCorrectionsRef.current.set(tx.id, settleDateIso);
        setAllRetailPayments(prev => prev.map(r => r.id === tx.id ? { ...r, date: settleDateIso } : r));
        return { status: 'moved', saleFailed };
    };

    const handlePostNowConfirm = ({
        settleDate,
        depositAccountId,
        receiptReference,
        receiptNotes
    }: {
        paymentMethod: string;
        settleDate: string;
        depositAccountId?: string;
        depositAccountName?: string;
        amountReceived: number;
        receiptReference?: string;
        receiptNotes?: string;
    }) => {
        if (!postTarget) return;
        const tx = postTarget;
        if (postingIds.has(tx.id)) return;
        setPostingIds(s => new Set(s).add(tx.id));
        postOrFinalizeTransactionReceipt({
            txId: tx.id,
            // Always the payment's own amount, so the ledger matches this row and Income & Expense.
            amount: Number(tx.amount || 0),
            date: settleDate,
            description: tx.description || 'Customer',
            depositAccountId,
            type: isDepositRow(tx) ? 'DEP' : 'RCP',
            reference: receiptReference,
            notes: receiptNotes,
            // Lets an RCP posting also book COGS against the order's items.
            orderId: orderIdByTxId.get(tx.id)
        }).then(async () => {
            setPostedIds(s => new Set(s).add(tx.id));
            // A corrected Payment Date moves the payment row itself too (the
            // DATE column and Income & Expense), not just the ledger entry —
            // otherwise the two sides of the same receipt live on different days.
            // RecordReceiptModal hands settleDate as an ISO built from the picked
            // YYYY-MM-DD at UTC midnight.
            const moved = await moveTransactionDay(tx, settleDate);
            if (moved.status === 'row-failed') {
                showToast('Posted to the ledger, but the payment date could not be updated: ' + moved.message, 'info');
            } else if (moved.status === 'moved') {
                if (moved.saleFailed) {
                    showToast('Date moved, but the order’s own settled date could not be updated — its Orders row still shows the old day.', 'info');
                }
                showToast(`Payment posted — date moved to ${formatDate(settleDate)}`, 'success');
            } else {
                showToast('Payment posted to the ledger', 'success');
            }
        }).catch((err: unknown) => {
            console.error('Failed to post payment to the ledger:', err);
            const message = err instanceof Error ? err.message : 'Unknown error';
            showToast('Failed to post payment: ' + message, 'error');
        }).finally(() => {
            setPostingIds(s => { const n = new Set(s); n.delete(tx.id); return n; });
            setLedgerNonce(n => n + 1);
        });
    };

    // Admin-only: return the selected Posted payments to Draft so they can be
    // corrected and posted again. Touches only the journal entries' status —
    // the payment rows, their lines and amounts stay exactly as they are.
    const handleBulkUnpost = async () => {
        const rows = selectedPostedRows;
        if (!isAdmin || ledger.statusMissing || rows.length === 0 || isBulkUnposting) return;
        if (!window.confirm(`Return ${rows.length} posted ${rows.length === 1 ? 'payment' : 'payments'} to Draft?\nTheir ledger entries can then be corrected and posted again.`)) return;
        setIsBulkUnposting(true);
        const ids = rows.map(r => r.id);
        setPostingIds(prev => new Set([...prev, ...ids]));
        try {
            // A full-coverage deposit books its cost side as a separate
            // ORD-<orderId>-COGS companion entry — unposting the receipt must
            // pull that companion back to Draft with it, or the statements
            // would count the cost of a sale whose revenue is excluded as Draft.
            const refs = ids.map(id => `TX-${id}`);
            rows.forEach(r => {
                const orderId = isDepositRow(r) ? orderIdByTxId.get(r.id) : undefined;
                if (orderId) refs.push(`ORD-${orderId}-COGS`);
            });
            const entryIds: string[] = [];
            for (const batch of chunk(refs, PREFIX_CHUNK)) {
                const { data, error } = await supabase.from('journal_entries').select('id').in('reference_id', batch);
                if (error) throw error;
                entryIds.push(...((data || []) as { id: string }[]).map(e => e.id));
            }
            if (entryIds.length === 0) {
                // Only reachable when the local status map is stale (another
                // session deleted these entries) — resync so the Posted chips
                // agree with the toast instead of re-offering a dead-end Unpost.
                setLedgerNonce(n => n + 1);
                showToast('No ledger entries exist for the selected payments.', 'info');
                return;
            }
            for (const batch of chunk(entryIds, PREFIX_CHUNK)) {
                const { error } = await supabase.from('journal_entries').update({ status: 'Draft' }).in('id', batch);
                if (error) {
                    // Only a genuinely missing status column — a transient error
                    // that merely mentions "status" must reach the resync path
                    // below, since an earlier batch may already be Draft.
                    const msg = error.message || '';
                    if (/status/i.test(msg) && /column|schema cache|does not exist/i.test(msg)) {
                        showToast('This instance needs migrations/add_entry_status.sql before entries can be unposted.', 'info');
                        return;
                    }
                    throw error;
                }
            }
            setLedger(prev => {
                const byTx = new Map(prev.byTx);
                ids.forEach(id => { if (byTx.has(id)) byTx.set(id, 'Draft'); });
                return { ...prev, byTx };
            });
            setPostedIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
            // The local patch above gives instant feedback, but a ledger refetch
            // already in flight (started by a post or Refresh) read these entries
            // as Posted and would clobber it when it lands — and unposted ids have
            // no postedIds shield. Bumping the nonce cancels that stale load.
            setLedgerNonce(n => n + 1);
            showToast(`Returned ${rows.length} ${rows.length === 1 ? 'payment' : 'payments'} to Draft`, 'success');
        } catch (err) {
            console.error('Failed to unpost the entries:', err);
            const message = err instanceof Error ? err.message : 'Unknown error';
            showToast('Failed to unpost: ' + message, 'error');
            // Earlier batches may already be Draft in the DB — drop the
            // postedIds shield for the acted rows so the refetch's statuses win.
            setPostedIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
            setLedgerNonce(n => n + 1);
        } finally {
            setPostingIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
            setIsBulkUnposting(false);
        }
    };

    const filteredPayments = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        // The date range is applied server-side at fetch time, but Post Now's
        // moveTransactionDay patches a row's date locally (no refetch) when it
        // corrects the payment date — re-check the range here too, or a row
        // moved outside it stays visible, showing a date that visibly
        // contradicts the active filter, until the next refresh.
        const startMs = dateRange.start ? parseDay(dateRange.start).getTime() : null;
        const endMs = dateRange.end ? parseDay(addDays(dateRange.end, 1)).getTime() : null;
        return sortedPayments.filter(r => {
            if (startMs !== null || endMs !== null) {
                const t = parseDate(r.date).getTime();
                if (isNaN(t)) return false;
                if (startMs !== null && t < startMs) return false;
                if (endMs !== null && t >= endMs) return false;
            }
            if (typeFilter === 'Paid' && isDepositRow(r)) return false;
            if (typeFilter === 'Deposit' && !isDepositRow(r)) return false;
            if (shippingFilter !== 'All' && (r.shipping_co || '') !== shippingFilter) return false;
            if (statusFilter !== 'All' && statusOf(r.id) !== statusFilter) return false;
            if (!term) return true;
            return [r.description, r.customer_phone, r.shipping_co, r.pay_by, r.reference, r.notes]
                .some(v => (v || '').toLowerCase().includes(term));
        });
    }, [sortedPayments, searchTerm, typeFilter, shippingFilter, statusFilter, statusOf, dateRange]);

    const stats = useMemo(() => {
        const s = { total: 0, count: 0, paid: 0, paidCount: 0, deposit: 0, depositCount: 0, draft: 0, draftCount: 0 };
        for (const r of filteredPayments) {
            const amt = Number(r.amount || 0);
            s.total += amt; s.count++;
            if (isDepositRow(r)) { s.deposit += amt; s.depositCount++; } else { s.paid += amt; s.paidCount++; }
            if (statusOf(r.id) === 'Draft') { s.draft += amt; s.draftCount++; }
        }
        return s;
    }, [filteredPayments, statusOf]);

    // Busy until the rows, the deleted-order check and (when filtering by it) the
    // ledger status are all in, so stale or unfiltered totals never flash.
    const isBusy = isLoadingTransactions || !resolutionReady || (statusFilter !== 'All' && ledger.state === 'loading');
    // A Status filter can't be applied when the status never loaded.
    const statusFilterBlocked = statusFilter !== 'All' && ledger.state === 'error';
    const showStats = !isBusy && !loadError && !statusFilterBlocked;

    useEffect(() => { setCurrentPage(1); }, [searchTerm, dateRange, typeFilter, statusFilter, shippingFilter, pageSize]);
    const totalPages = Math.max(1, Math.ceil(filteredPayments.length / pageSize));
    const page = Math.min(currentPage, totalPages);
    const pageRows = filteredPayments.slice((page - 1) * pageSize, page * pageSize);

    // ── Bulk Post Now / bulk Delete ──
    // A checkbox selects any row regardless of status — Delete applies to any
    // selection, Post Now silently acts on just the postable (Draft) subset of it.
    const canPostRow = useCallback(
        (id: string) => ledgerReady && statusOf(id) === 'Draft' && !postingIds.has(id),
        [ledgerReady, statusOf, postingIds]
    );
    // Effective selection: only rows that are still listed (filtered away or
    // deleted elsewhere drop out on their own).
    const selectedAllRows = useMemo(
        () => selectedIds.size === 0 ? [] : filteredPayments.filter(r => selectedIds.has(r.id)),
        [selectedIds, filteredPayments]
    );
    const selectedTotal = useMemo(() => selectedAllRows.reduce((s, r) => s + Number(r.amount || 0), 0), [selectedAllRows]);
    const selectedPostableRows = useMemo(
        () => selectedAllRows.filter(r => canPostRow(r.id)),
        [selectedAllRows, canPostRow]
    );
    // Posted rows in the selection — what the admin-only bulk Unpost acts on.
    const selectedPostedRows = useMemo(
        () => ledgerReady ? selectedAllRows.filter(r => statusOf(r.id) === 'Posted' && !postingIds.has(r.id)) : [],
        [selectedAllRows, ledgerReady, statusOf, postingIds]
    );
    const selectedPostableTotal = useMemo(() => selectedPostableRows.reduce((s, r) => s + Number(r.amount || 0), 0), [selectedPostableRows]);
    // A row mid-post can't also be selected for a new bulk action.
    const pageSelectableIds = useMemo(() => pageRows.filter(r => !postingIds.has(r.id)).map(r => r.id), [pageRows, postingIds]);
    const allPageSelected = pageSelectableIds.length > 0 && pageSelectableIds.every(id => selectedIds.has(id));
    const somePageSelected = pageSelectableIds.some(id => selectedIds.has(id));

    const toggleSelect = (id: string) => setSelectedIds(prev => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
    });
    const togglePage = () => setSelectedIds(prev => {
        const n = new Set(prev);
        if (allPageSelected) pageSelectableIds.forEach(id => n.delete(id));
        else pageSelectableIds.forEach(id => n.add(id));
        return n;
    });

    // Loads the cash & bank accounts once, shared by the popup's picker and the
    // posting loop. handleBulkPost AWAITS this before resolving per-payment
    // accounts — a submit racing the fetch must not silently skip pay_by
    // matching and let the server debit its generic first-cash/bank fallback.
    // A failed load resets the ref so the next open retries.
    const bulkAccountsPromiseRef = useRef<Promise<{ id: string; account_name: string }[]> | null>(null);
    const loadBulkAccounts = useCallback(() => {
        if (!bulkAccountsPromiseRef.current) {
            bulkAccountsPromiseRef.current = (async () => {
                try {
                    const { data, error } = await supabase.from('chart_of_accounts').select('id, account_name, account_type, is_active');
                    if (error) throw error;
                    const accounts = ((data || []) as { id: string; account_name: string; account_type: string; is_active: boolean }[])
                        .filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name))
                        .map(a => ({ id: a.id, account_name: a.account_name }));
                    setBulkAccounts(accounts);
                    return accounts;
                } catch {
                    bulkAccountsPromiseRef.current = null;
                    return [];
                }
            })();
        }
        return bulkAccountsPromiseRef.current;
    }, []);

    // Opens the bulk Post Now popup (Payment date / Deposited into / Notes).
    // The account list is refetched per open — an account deactivated while the
    // page stayed mounted must not remain pickable.
    const openBulkPost = () => {
        if (selectedPostableRows.length === 0 || isBulkPosting) return;
        setBulkPostForm({ date: '', accountId: '', notes: '' });
        bulkAccountsPromiseRef.current = null;
        loadBulkAccounts();
    };

    // Posts every selected Draft. The popup's choices override the per-payment
    // defaults: a picked Payment date posts (and moves) every payment to that
    // day, a picked account debits all of them there, and Notes land on each
    // entry. Left empty, each payment keeps its own date and resolved account —
    // the entry's existing debit account, else an account matching the payment's
    // method, else the server's cash/bank fallback. The server refuses non-Draft
    // entries, so a stale row can't repost.
    const handleBulkPost = async () => {
        const rows = selectedPostableRows;
        const form = bulkPostForm;
        if (isBulkPosting || !form) return;
        if (rows.length === 0) {
            // A background ledger refresh can drain the postable selection while
            // the popup is open (rows posted elsewhere) — close it rather than
            // leaving a dead 'Post 0 Payments' button.
            setBulkPostForm(null);
            showToast('Nothing left to post — the selected payments are already posted.', 'info');
            return;
        }
        const chosenDay = /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? form.date : '';
        const chosenIso = chosenDay ? new Date(chosenDay).toISOString() : '';
        const notes = form.notes.trim() || undefined;
        setBulkPostForm(null);
        setIsBulkPosting(true);
        setPostingIds(prev => new Set([...prev, ...rows.map(r => r.id)]));
        // Settled account list, not the render-time state — a submit that races
        // the popup's fetch must still resolve pay_by hints per payment.
        const accounts = await loadBulkAccounts();
        const accountFor = (r: CustomerPaymentRow): string | undefined => {
            if (form.accountId) return form.accountId;
            const existing = ledger.debitAccountByTx.get(r.id);
            if (existing) return existing;
            const hint = (r.pay_by || '').trim().toLowerCase();
            if (!hint || accounts.length === 0) return undefined;
            return accounts.find(a => a.account_name.toLowerCase() === hint)?.id
                || (hint.includes('cash') ? accounts.find(a => /cash/i.test(a.account_name))?.id : undefined);
        };
        let ok = 0;
        let moved = 0;
        let moveFailed = 0;
        const failed: string[] = [];
        for (const r of rows) {
            try {
                await postOrFinalizeTransactionReceipt({
                    txId: r.id,
                    amount: Number(r.amount || 0),
                    date: chosenDay || localYMD(r.date),
                    description: r.description || 'Customer',
                    depositAccountId: accountFor(r),
                    type: isDepositRow(r) ? 'DEP' : 'RCP',
                    notes,
                    orderId: orderIdByTxId.get(r.id),
                });
                ok++;
                setPostedIds(prev => new Set(prev).add(r.id));
                setSelectedIds(prev => { const n = new Set(prev); n.delete(r.id); return n; });
                if (chosenIso) {
                    const res = await moveTransactionDay(r, chosenIso);
                    if (res.status === 'moved') moved += res.saleFailed ? 0 : 1;
                    if (res.status === 'row-failed' || (res.status === 'moved' && res.saleFailed)) moveFailed++;
                }
            } catch (err) {
                console.error('Bulk post failed for', r.id, err);
                failed.push(r.description || r.id);
            } finally {
                setPostingIds(prev => { const n = new Set(prev); n.delete(r.id); return n; });
            }
        }
        setIsBulkPosting(false);
        setLedgerNonce(n => n + 1);
        const movedNote = chosenIso && moved > 0
            ? ` — ${moved === 1 ? '1 date' : `${moved} dates`} moved to ${formatDate(chosenIso)}`
            : '';
        if (failed.length === 0) {
            showToast(`Posted ${ok} payment${ok === 1 ? '' : 's'} to the ledger${movedNote}`, 'success');
        } else {
            showToast(`Posted ${ok} of ${rows.length}${movedNote} — failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`, 'error');
        }
        if (moveFailed > 0) {
            showToast(`${moveFailed} payment${moveFailed === 1 ? '' : 's'} posted but couldn't fully move to the new date — the payment or its Orders row may still show the old day.`, 'info');
        }
    };

    // Deletes the selected payments outright — any status, not just Draft. A
    // selected row with a linked journal entry (Posted or Draft) has that entry
    // removed too, or it would be left behind pointing at a deleted transaction.
    const handleBulkDelete = async () => {
        const rows = selectedAllRows;
        if (rows.length === 0 || isBulkDeleting) return;
        const linkedCount = rows.filter(r => ledgerReady && ledger.byTx.has(r.id)).length;
        const warn = linkedCount > 0
            ? `\n${linkedCount} of them ${linkedCount === 1 ? 'has' : 'have'} a ledger entry — ${linkedCount === 1 ? 'it is' : 'those are'} deleted too.`
            : '';
        if (!window.confirm(`Delete ${rows.length} payment${rows.length === 1 ? '' : 's'} (${formatAmount(selectedTotal)})? This cannot be undone.${warn}`)) return;
        setIsBulkDeleting(true);
        const ids = rows.map(r => r.id);
        try {
            const refIds = ids.map(id => `TX-${id}`);
            const entryIds: string[] = [];
            for (const batch of chunk(refIds, PREFIX_CHUNK)) {
                const { data, error } = await supabase.from('journal_entries').select('id').in('reference_id', batch);
                if (error) throw error;
                entryIds.push(...((data || []) as { id: string }[]).map(e => e.id));
            }
            if (entryIds.length > 0) {
                for (const batch of chunk(entryIds, PREFIX_CHUNK)) {
                    const { error: lineErr } = await supabase.from('journal_entry_lines').delete().in('journal_entry_id', batch);
                    if (lineErr) throw lineErr;
                }
                for (const batch of chunk(entryIds, PREFIX_CHUNK)) {
                    const { error: entryErr } = await supabase.from('journal_entries').delete().in('id', batch);
                    if (entryErr) throw entryErr;
                }
            }
            for (const batch of chunk(ids, PREFIX_CHUNK)) {
                const { error: txErr } = await supabase.from('transactions').delete().in('id', batch);
                if (txErr) throw txErr;
            }
            const idSet = new Set(ids);
            setAllRetailPayments(prev => prev.filter(r => !idSet.has(r.id)));
            setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
            showToast(`Deleted ${rows.length} payment${rows.length === 1 ? '' : 's'}`, 'success');
            if (entryIds.length > 0) setLedgerNonce(n => n + 1);
        } catch (err) {
            console.error('Bulk delete failed:', err);
            const message = err instanceof Error ? err.message : 'Unknown error';
            showToast('Failed to delete: ' + message, 'error');
            // Re-sync — some rows or their ledger entries may have been removed before the failure.
            fetchRetailPayments();
            setLedgerNonce(n => n + 1);
        } finally {
            setIsBulkDeleting(false);
        }
    };

    const hasActiveFilters = searchTerm !== '' || dateRange.start !== '' || dateRange.end !== ''
        || typeFilter !== 'All' || statusFilter !== 'All' || shippingFilter !== 'All';
    const clearFilters = () => {
        setSearchTerm('');
        setDateRange({ start: '', end: '' });
        setTypeFilter('All');
        setStatusFilter('All');
        setShippingFilter('All');
    };

    const refreshAll = () => {
        fetchRetailPayments();
        setLedgerNonce(n => n + 1);
        setDeletedNonce(n => n + 1);
    };

    const exportToExcel = async () => {
        if (filteredPayments.length === 0) return;
        const XLSX = await import('xlsx');
        const rows: Record<string, string | number>[] = filteredPayments.map(r => ({
            Date: parseDate(r.date).toLocaleDateString('en-GB'),
            Customer: r.description || '',
            Phone: r.customer_phone || '',
            'Shipping Co': r.shipping_co || '',
            'Payment Type': isDepositRow(r) ? 'Deposit' : 'Paid',
            Amount: Number(r.amount || 0),
            Method: r.pay_by || '',
            Reference: r.reference || '',
            Notes: r.notes || '',
            'Added by': r.added_by || '',
            Status: ledgerReady || postedIds.has(r.id) ? statusOf(r.id) : '',
        }));
        rows.push({});
        rows.push({ Customer: 'Total', Amount: stats.total });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Customer Payments');
        XLSX.writeFile(wb, `Customer_Payments_${dayKeyFromDate(new Date())}.xlsx`);
    };

    const colCount = 9 + (hasReferenceData ? 1 : 0) + (hasNotesData ? 1 : 0);
    const hiddenCount = deletedOrderTxIds.size;
    const statValue = (v: React.ReactNode) => showStats ? v : '—';
    const countLabel = (n: number) => showStats ? `${n.toLocaleString()} record${n === 1 ? '' : 's'}` : undefined;

    const selectStyle: React.CSSProperties = {
        width: '100%', padding: '10px 32px 10px 36px', borderRadius: '10px', border: '1px solid var(--color-border)',
        background: 'var(--color-background)', color: 'var(--color-text-main)', fontSize: '13px',
        appearance: 'none', cursor: 'pointer', outline: 'none'
    };
    const iconButtonStyle: React.CSSProperties = {
        padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '38px', width: '38px', borderRadius: '10px', flexShrink: 0
    };
    const pagerButtonStyle = (disabled: boolean): React.CSSProperties => ({
        padding: '8px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, minWidth: '36px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer'
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            {/* Summary stat cards — Paid / Deposit / Unposted also toggle their filter */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: isMobile ? '8px' : '16px'
            }}>
                <StatsCard
                    title="Total"
                    value={statValue(formatAmount(stats.total))}
                    trend={countLabel(stats.count)}
                    icon={Wallet}
                    color="var(--color-primary)"
                />
                <StatsCard
                    title="Paid"
                    value={statValue(formatAmount(stats.paid))}
                    trend={countLabel(stats.paidCount)}
                    icon={CircleDollarSign}
                    color="#059669"
                    onClick={() => setTypeFilter(f => f === 'Paid' ? 'All' : 'Paid')}
                    style={typeFilter === 'Paid' ? { outline: '2px solid #059669' } : undefined}
                />
                <StatsCard
                    title="Deposit"
                    value={statValue(formatAmount(stats.deposit))}
                    trend={countLabel(stats.depositCount)}
                    icon={Banknote}
                    color="#7C3AED"
                    onClick={() => setTypeFilter(f => f === 'Deposit' ? 'All' : 'Deposit')}
                    style={typeFilter === 'Deposit' ? { outline: '2px solid #7C3AED' } : undefined}
                />
                <StatsCard
                    title="Unposted (Draft)"
                    value={ledgerReady ? statValue(formatAmount(stats.draft)) : '—'}
                    trend={ledgerReady ? countLabel(stats.draftCount) : undefined}
                    icon={Receipt}
                    color="#D97706"
                    onClick={() => setStatusFilter(f => f === 'Draft' ? 'All' : 'Draft')}
                    style={statusFilter === 'Draft' ? { outline: '2px solid #D97706' } : undefined}
                />
            </div>

            {/* Filters */}
            <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                        <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                        <input
                            type="text"
                            placeholder="Search customer, phone, shipping co, reference..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="search-input"
                            style={{ paddingLeft: '36px', width: '100%' }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Date:</span>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                            onClick={exportToExcel}
                            disabled={filteredPayments.length === 0 || !showStats}
                            className="secondary-button"
                            style={{ ...iconButtonStyle, opacity: filteredPayments.length === 0 || !showStats ? 0.5 : 1 }}
                            title="Export to Excel"
                        >
                            <Download size={18} />
                        </button>
                        <button
                            onClick={refreshAll}
                            disabled={isLoadingTransactions}
                            className="secondary-button"
                            style={iconButtonStyle}
                            title="Refresh"
                        >
                            <RefreshCw size={18} style={{ animation: isLoadingTransactions ? 'spin 1s linear infinite' : 'none' }} />
                        </button>
                        {hasActiveFilters && (
                            <button
                                onClick={clearFilters}
                                style={{
                                    padding: '10px 16px', borderRadius: '8px', border: 'none',
                                    background: '#EF4444', color: '#ffffff', cursor: 'pointer',
                                    fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px'
                                }}
                                title="Clear Filters"
                            >
                                <X size={16} /> Clear
                            </button>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '4px', background: 'var(--color-background)', padding: '6px', borderRadius: '12px', flex: isMobile ? '1 1 100%' : 'none' }}>
                        {(['All', 'Paid', 'Deposit'] as PayTypeFilter[]).map(opt => {
                            const active = typeFilter === opt;
                            const color = opt === 'Paid' ? '#059669' : opt === 'Deposit' ? '#7C3AED' : 'var(--color-text-main)';
                            return (
                                <button
                                    key={opt}
                                    onClick={() => setTypeFilter(opt)}
                                    style={{
                                        padding: '6px 12px', fontSize: '13px', borderRadius: '8px', border: 'none', flex: 1, cursor: 'pointer',
                                        background: active ? 'var(--color-surface)' : 'transparent',
                                        color: active ? color : 'var(--color-text-secondary)',
                                        fontWeight: active ? 600 : 500, boxShadow: active ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                                    }}
                                >
                                    {opt === 'All' ? 'All Types' : opt}
                                </button>
                            );
                        })}
                    </div>

                    <div style={{ position: 'relative', flex: isMobile ? '1 1 100%' : '0 1 200px', display: 'flex', alignItems: 'center' }}>
                        <Receipt size={16} style={{ position: 'absolute', left: '14px', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} style={selectStyle}>
                            <option value="All">All Statuses</option>
                            <option value="Draft">Draft</option>
                            <option value="Posted">Posted</option>
                        </select>
                        <ChevronDown size={18} style={{ position: 'absolute', right: '12px', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                    </div>

                    <div style={{ position: 'relative', flex: isMobile ? '1 1 100%' : '0 1 200px', display: 'flex', alignItems: 'center' }}>
                        <Truck size={16} style={{ position: 'absolute', left: '14px', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                        <select value={shippingFilter} onChange={e => setShippingFilter(e.target.value)} style={selectStyle}>
                            <option value="All">All Shipping Co</option>
                            {/* Keep the active pick listed even when the current range has none of it. */}
                            {(shippingFilter !== 'All' && !shippingOptions.includes(shippingFilter) ? [shippingFilter, ...shippingOptions] : shippingOptions).map(co => (
                                <option key={co} value={co} style={{ color: getShippingCoColor(co) }}>{co}</option>
                            ))}
                        </select>
                        <ChevronDown size={18} style={{ position: 'absolute', right: '12px', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                    </div>
                </div>
            </div>

            {resolutionFailed && (
                <Notice onRetry={() => setDeletedNonce(n => n + 1)}>
                    Couldn't check which orders were deleted — payments of deleted orders may be included.
                </Notice>
            )}
            {ledger.state === 'error' && (
                <Notice onRetry={() => setLedgerNonce(n => n + 1)}>
                    Couldn't load the ledger status — Post Now is disabled until it loads.
                </Notice>
            )}
            {ledger.refreshError && (
                <Notice onRetry={() => setLedgerNonce(n => n + 1)}>
                    Couldn't refresh the ledger status — showing the last loaded status.
                </Notice>
            )}

            {/* Bulk selection bar — floats at the bottom-center once any row is
                checked, same place regardless of scroll position. Post Now only
                shows when the selection includes at least one postable Draft;
                Unpost (admin only) when it includes a Posted row; Delete applies
                to the whole selection, any status. */}
            {selectedAllRows.length > 0 && (() => {
                const bulkBusy = isBulkPosting || isBulkDeleting || isBulkUnposting;
                return (
                <div style={{
                    position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
                    zIndex: 500, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                    justifyContent: 'center', maxWidth: 'calc(100vw - 32px)',
                    padding: '12px 18px', borderRadius: '14px',
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    boxShadow: '0 10px 32px rgba(0,0,0,0.22)'
                }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)', whiteSpace: 'nowrap' }}>
                        {selectedAllRows.length} selected · {formatAmount(selectedTotal)}
                    </span>
                    {selectedPostableRows.length > 0 && (
                        <button
                            onClick={openBulkPost}
                            disabled={bulkBusy}
                            style={{
                                padding: '8px 16px', borderRadius: '8px', border: 'none',
                                background: 'var(--color-primary)', color: '#fff',
                                fontSize: '13px', fontWeight: 600, cursor: bulkBusy ? 'not-allowed' : 'pointer',
                                opacity: bulkBusy ? 0.7 : 1, whiteSpace: 'nowrap'
                            }}
                        >
                            {isBulkPosting ? 'Posting…' : `Post Now (${selectedPostableRows.length})`}
                        </button>
                    )}
                    {/* Stays mounted mid-unpost: the acted rows join postingIds, which
                        empties selectedPostedRows, and the button would vanish instead
                        of showing its progress label. Hidden on instances whose
                        journal entries have no status column — unposting can't work there. */}
                    {isAdmin && !ledger.statusMissing && (selectedPostedRows.length > 0 || isBulkUnposting) && (
                        <button
                            onClick={handleBulkUnpost}
                            disabled={bulkBusy}
                            title="Return the selected posted payments to Draft so they can be corrected"
                            style={{
                                // Same forced-light amber pairing as the page's status
                                // chips — a transparent background would put dark amber
                                // on the dark theme's navy surface at ~3.5:1.
                                padding: '8px 16px', borderRadius: '8px',
                                border: '1px solid #D97706', background: '#FEF3C7', color: '#92400E',
                                fontSize: '13px', fontWeight: 600, cursor: bulkBusy ? 'not-allowed' : 'pointer',
                                opacity: bulkBusy ? 0.7 : 1, whiteSpace: 'nowrap'
                            }}
                        >
                            {isBulkUnposting ? 'Unposting…' : `Unpost (${selectedPostedRows.length})`}
                        </button>
                    )}
                    <button
                        onClick={handleBulkDelete}
                        disabled={bulkBusy}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '8px 16px', borderRadius: '8px', border: 'none',
                            background: '#EF4444', color: '#fff',
                            fontSize: '13px', fontWeight: 600, cursor: bulkBusy ? 'not-allowed' : 'pointer',
                            opacity: bulkBusy ? 0.7 : 1, whiteSpace: 'nowrap'
                        }}
                    >
                        <Trash2 size={14} /> {isBulkDeleting ? 'Deleting…' : `Delete (${selectedAllRows.length})`}
                    </button>
                    <button
                        onClick={() => setSelectedIds(new Set())}
                        disabled={bulkBusy}
                        style={{
                            padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-bg)', color: 'var(--color-text-secondary)',
                            fontSize: '13px', fontWeight: 600, cursor: bulkBusy ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        Clear
                    </button>
                </div>
                );
            })()}

            {/* Bulk Post Now popup — Payment date / Deposited into / Notes applied
                to every selected draft; empty fields keep per-payment defaults. */}
            {bulkPostForm && (() => {
                const n = selectedPostableRows.length;
                const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' };
                const inputStyle: React.CSSProperties = {
                    width: '100%', padding: '9px 12px', borderRadius: '8px', boxSizing: 'border-box',
                    border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                    color: 'var(--color-text-main)', fontSize: '13px'
                };
                return (
                    <div
                        // Close on a press that STARTS on the backdrop (mousedown
                        // target check) — a click handler would also fire when a
                        // drag begins inside the dialog and releases outside (the
                        // click lands on the common ancestor), wiping typed input.
                        onMouseDown={e => { if (e.target === e.currentTarget) setBulkPostForm(null); }}
                        style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
                    >
                        <div style={{ width: '420px', maxWidth: '100%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', boxShadow: '0 18px 44px rgba(0,0,0,0.28)', padding: '20px' }}>
                            <h3 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)' }}>Post {n} draft payment{n === 1 ? '' : 's'}</h3>
                            <p style={{ margin: '0 0 16px', fontSize: '12.5px', color: 'var(--color-text-secondary)' }}>{formatAmount(selectedPostableTotal)} total · leave a field empty to keep each payment's own value.</p>
                            <div style={{ marginBottom: '14px' }}>
                                <label style={labelStyle}>Payment date</label>
                                <input type="date" value={bulkPostForm.date} onChange={e => setBulkPostForm(f => f && { ...f, date: e.target.value })} style={inputStyle} />
                                <p style={{ margin: '5px 0 0', fontSize: '11.5px', color: 'var(--color-text-secondary)' }}>
                                    {bulkPostForm.date
                                        ? `All ${n} payment${n === 1 ? '' : 's'} (and their Income & Expense rows) move to this day.`
                                        : 'Empty — each payment posts on its own date.'}
                                </p>
                            </div>
                            <div style={{ marginBottom: '14px' }}>
                                <label style={labelStyle}>Deposited into</label>
                                <select value={bulkPostForm.accountId} onChange={e => setBulkPostForm(f => f && { ...f, accountId: e.target.value })} style={inputStyle}>
                                    <option value="">Auto — each payment's own account</option>
                                    {bulkAccounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
                                </select>
                            </div>
                            <div style={{ marginBottom: '18px' }}>
                                <label style={labelStyle}>Notes</label>
                                <input type="text" value={bulkPostForm.notes} placeholder="Optional — saved on every posted entry" onChange={e => setBulkPostForm(f => f && { ...f, notes: e.target.value })} style={inputStyle} />
                                {bulkPostForm.notes.trim() !== '' && (
                                    <p style={{ margin: '5px 0 0', fontSize: '11.5px', color: 'var(--color-text-secondary)' }}>
                                        Replaces any note the selected entries already carry.
                                    </p>
                                )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                <button onClick={() => setBulkPostForm(null)} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                                    Cancel
                                </button>
                                <button
                                    onClick={handleBulkPost}
                                    disabled={n === 0}
                                    style={{
                                        padding: '9px 18px', borderRadius: '8px', border: 'none',
                                        background: 'var(--color-primary)', color: '#fff', fontSize: '13px', fontWeight: 600,
                                        cursor: n === 0 ? 'not-allowed' : 'pointer', opacity: n === 0 ? 0.6 : 1
                                    }}
                                >
                                    Post {n} Payment{n === 1 ? '' : 's'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Table */}
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', whiteSpace: 'nowrap' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg)' }}>
                                <th style={{ ...thStyle, width: '34px', padding: '10px 8px 10px 12px' }}>
                                    <input
                                        type="checkbox"
                                        checked={allPageSelected}
                                        ref={el => { if (el) el.indeterminate = !allPageSelected && somePageSelected; }}
                                        onChange={togglePage}
                                        disabled={pageSelectableIds.length === 0}
                                        title="Select all payments on this page"
                                        style={{ cursor: pageSelectableIds.length === 0 ? 'not-allowed' : 'pointer' }}
                                    />
                                </th>
                                <th style={thStyle}>Date</th>
                                <th style={thStyle}>Customer</th>
                                <th style={thStyle}>Payment Type</th>
                                <th style={thStyle}>Amount</th>
                                <th style={thStyle}>Method</th>
                                {hasReferenceData && <th style={thStyle}>Reference</th>}
                                {hasNotesData && <th style={thStyle}>Notes</th>}
                                <th style={thStyle}>Added by</th>
                                <th style={thStyle}>Status</th>
                                <th style={thStyle}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loadError ? (
                                <tr>
                                    <td colSpan={colCount} role="alert" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        <div style={{ marginBottom: '12px' }}>Couldn't load customer payments. {loadError}</div>
                                        <button onClick={fetchRetailPayments} disabled={isLoadingTransactions} className="secondary-button" style={{ padding: '8px 16px', borderRadius: '8px' }}>
                                            Retry
                                        </button>
                                    </td>
                                </tr>
                            ) : isBusy ? (
                                <tr>
                                    <td colSpan={colCount} style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        Loading customer payments...
                                    </td>
                                </tr>
                            ) : statusFilterBlocked ? (
                                <tr>
                                    <td colSpan={colCount} role="alert" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        <div style={{ marginBottom: '12px' }}>Couldn't load the ledger status, so the Status filter can't be applied.</div>
                                        <button onClick={() => setLedgerNonce(n => n + 1)} className="secondary-button" style={{ padding: '8px 16px', borderRadius: '8px' }}>
                                            Retry
                                        </button>
                                    </td>
                                </tr>
                            ) : filteredPayments.length === 0 ? (
                                <tr>
                                    <td colSpan={colCount} style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        No customer payments found for these filters.
                                    </td>
                                </tr>
                            ) : (
                                pageRows.map((r, idx) => {
                                    const known = ledgerReady || postedIds.has(r.id);
                                    const status = statusOf(r.id);
                                    const posting = postingIds.has(r.id);
                                    const canPost = known && status === 'Draft' && !posting;
                                    const orderId = orderIdByTxId.get(r.id);
                                    const customerLabel = [r.description || '—', r.customer_phone, r.shipping_co].filter(Boolean).join(' - ');
                                    const PaymentIcon = getPaymentIcon(r.pay_by);
                                    return (
                                        <tr key={r.id} style={{ background: idx % 2 === 1 ? 'var(--color-bg)' : 'transparent' }}>
                                            <td style={{ ...tdStyle, padding: '10px 8px 10px 12px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(r.id)}
                                                    onChange={() => toggleSelect(r.id)}
                                                    disabled={posting}
                                                    title={posting ? 'Posting…' : 'Select payment'}
                                                    style={{ cursor: posting ? 'not-allowed' : 'pointer' }}
                                                />
                                            </td>
                                            <td style={tdStyle}>{formatDate(r.date)}</td>
                                            <td style={{ ...tdStyle, fontWeight: 600 }}>{customerLabel}</td>
                                            <td style={tdStyle}><TypeBadge category={r.category} /></td>
                                            <td style={{ ...tdStyle, fontWeight: 600, color: '#059669' }}>{formatAmount(r.amount)}</td>
                                            <td style={tdStyle}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <span style={{ color: getPaymentColor(r.pay_by) }}>{r.pay_by || '—'}</span>
                                                    {PaymentIcon && <PaymentIcon size={14} color={getPaymentColor(r.pay_by)} />}
                                                </div>
                                            </td>
                                            {hasReferenceData && (
                                                <td style={tdStyle}>
                                                    {r.reference ? (
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                            <Hash size={12} style={{ color: 'var(--color-text-secondary)' }} />{r.reference}
                                                        </span>
                                                    ) : '—'}
                                                </td>
                                            )}
                                            {hasNotesData && (
                                                <td style={{ ...tdStyle, whiteSpace: 'normal', maxWidth: '240px' }}>{r.notes || '—'}</td>
                                            )}
                                            <td style={tdStyle}>{r.added_by || '—'}</td>
                                            <td style={tdStyle}><StatusChip status={known ? status : 'Unknown'} /></td>
                                            <td style={tdStyle}>
                                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                    <button
                                                        onClick={() => setPostTarget(r)}
                                                        disabled={!canPost}
                                                        style={{
                                                            padding: '6px 12px', borderRadius: '8px', border: 'none',
                                                            background: canPost ? 'var(--color-primary)' : 'var(--color-border)',
                                                            color: canPost ? '#fff' : 'var(--color-text-secondary)',
                                                            cursor: canPost ? 'pointer' : 'not-allowed',
                                                            fontSize: '12px', fontWeight: 600
                                                        }}
                                                    >
                                                        {posting ? 'Posting…' : 'Post Now'}
                                                    </button>
                                                    {orderId && (
                                                        <button
                                                            onClick={() => setViewingOrderId(orderId)}
                                                            title="View order details"
                                                            style={{
                                                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                                padding: '6px 12px', borderRadius: '8px',
                                                                border: '1px solid var(--color-border)', background: 'var(--color-bg)',
                                                                color: 'var(--color-primary)', cursor: 'pointer',
                                                                fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap'
                                                            }}
                                                        >
                                                            <ExternalLink size={12} /> View
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {showStats && filteredPayments.length > 0 && (
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px',
                        padding: '12px 16px', borderTop: '1px solid var(--color-border)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                                Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, filteredPayments.length)} of {filteredPayments.length.toLocaleString()} payment{filteredPayments.length === 1 ? '' : 's'}
                                {hiddenCount > 0 && ` · ${hiddenCount.toLocaleString()} hidden (order deleted)`}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Show:</span>
                                <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={{ padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '12px', cursor: 'pointer', background: 'var(--color-surface)', color: 'var(--color-text-main)' }}>
                                    {[50, 100, 200, 500, 1000, 2000, 3000].map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </div>
                        </div>
                        {totalPages > 1 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button disabled={page === 1} onClick={() => setCurrentPage(1)} className="secondary-button" style={pagerButtonStyle(page === 1)} title="First page">««</button>
                                <button disabled={page === 1} onClick={() => setCurrentPage(Math.max(1, page - 1))} className="secondary-button" style={pagerButtonStyle(page === 1)} title="Previous page">
                                    <ChevronLeft size={16} />
                                </button>
                                <span style={{ fontSize: '13px', color: 'var(--color-text-main)', padding: '0 6px', whiteSpace: 'nowrap' }}>
                                    Page {page} of {totalPages}
                                </span>
                                <button disabled={page === totalPages} onClick={() => setCurrentPage(Math.min(totalPages, page + 1))} className="secondary-button" style={pagerButtonStyle(page === totalPages)} title="Next page">
                                    <ChevronRight size={16} />
                                </button>
                                <button disabled={page === totalPages} onClick={() => setCurrentPage(totalPages)} className="secondary-button" style={pagerButtonStyle(page === totalPages)} title="Last page">»»</button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {postTarget && postTargetOrder && (
                <RecordReceiptModal
                    isOpen={!!postTarget}
                    onClose={() => setPostTarget(null)}
                    order={postTargetOrder}
                    finalizeMode
                    initialMethod={postTarget.pay_by || undefined}
                    initialDate={localYMD(postTarget.date)}
                    initialDepositAccountId={ledger.debitAccountByTx.get(postTarget.id)}
                    depositAccountHint={postTarget.pay_by || undefined}
                    title="Record Receipt"
                    description="Confirm the payment date and the account it was deposited into to post this payment to the ledger."
                    onConfirm={handlePostNowConfirm}
                />
            )}

            <OrderDetailsModal
                isOpen={viewingOrderId !== null}
                onClose={() => setViewingOrderId(null)}
                orderId={viewingOrderId}
            />
        </div>
    );
};

const thStyle: React.CSSProperties = {
    padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)',
    borderBottom: '1px solid var(--color-border)'
};

const tdStyle: React.CSSProperties = {
    padding: '10px 12px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-main)'
};

export default CustomerPaymentPage;
