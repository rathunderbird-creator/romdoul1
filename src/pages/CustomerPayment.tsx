// Customer Payment — a read-only log of individual retail customer payment
// records (Record Receipt / Deposit entries posted from Payment Tracking).
// Pure display: no create/edit/delete here. This is a dedicated full-history
// listing page, so — like IncomeExpense.tsx's own fetchTransactions — it runs
// its own Supabase query (filtered server-side to the two retail categories
// written by StoreContext's updateOrder) rather than reading the shared,
// globally-capped useStore().transactions (only the 50 most recent rows
// across every category, meant for lightweight overview use elsewhere):
//   'លក់រាយ'   (Retail)  -> a Paid/receipt transaction
//   'កក់ប្រាក់' (Deposit) -> a deposit transaction
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Receipt, Hash, Wallet, X, ExternalLink } from 'lucide-react';
import { postOrFinalizeTransactionReceipt } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { useMobile } from '../hooks/useMobile';
import { useAccounting } from '../hooks/useAccounting';
import { supabase } from '../lib/supabase';
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

// Order-existence resolution runs as a SEPARATE, targeted query against `sales`
// (never the shared, paginated useStore().sales — see orderResolution below) so
// it stays accurate no matter how much of `sales` Orders.tsx has paginated into
// memory. Chunk sizes mirror the same pattern in utils/stockMovementSalesmen.ts.
const ID_CHUNK = 400;     // explicit order_ids per .in() — keeps the URL well under gateway limits
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
    const d = new Date(safeStr);
    return d;
};

const formatDate = (dateStr?: string): string => {
    const d = parseDate(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatAmount = (amount: number): string =>
    `$${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Local calendar day as YYYY-MM-DD — mirrors StoreContext's localDayOf. Never
// toISOString() a date-only value directly, it UTC-shifts; this adjusts for
// the timezone offset first so the calendar day never moves.
const localYMD = (dateStr?: string): string => {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const d = parseDate(dateStr);
    if (isNaN(d.getTime())) return dateStr.slice(0, 10);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

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
// accounting section.
const StatusChip: React.FC<{ status: 'Posted' | 'Draft' }> = ({ status }) => (
    <span style={{
        display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: '12px',
        fontSize: '11px', fontWeight: 700,
        background: status === 'Draft' ? '#fef3c7' : 'rgba(84, 105, 212, 0.12)',
        color: status === 'Draft' ? '#92400e' : '#4c5fd0',
    }}>
        {status}
    </span>
);

const CustomerPaymentPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();
    const { showToast } = useToast();
    const isMobile = useMobile();
    const { journalEntries, fetchJournalEntries } = useAccounting();

    useEffect(() => {
        fetchJournalEntries();
    }, [fetchJournalEntries]);

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('nav.customerPayment')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Read-only log of retail customer payments and deposits</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

    // This page's own dedicated data: every retail Payment/Deposit transaction
    // (not the shared, globally-capped useStore().transactions — see the header
    // comment). Strictly the two retail categories written on Paid/Deposit —
    // nothing else (supplier payments, wholesale, manual Income/Expense/Revenue
    // entries) belongs here; that filtering now happens server-side.
    const [allRetailPayments, setAllRetailPayments] = useState<CustomerPaymentRow[]>([]);
    const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);

    const fetchRetailPayments = useCallback(async () => {
        setIsLoadingTransactions(true);
        try {
            let query = supabase.from('transactions')
                .select('*')
                .eq('type', 'Income')
                .in('category', [RETAIL_PAYMENT_CATEGORY, RETAIL_DEPOSIT_CATEGORY]);

            if (dateRange.start) {
                const start = new Date(dateRange.start);
                start.setHours(0, 0, 0, 0);
                query = query.gte('date', start.toISOString());
            }
            if (dateRange.end) {
                const end = new Date(dateRange.end);
                end.setHours(23, 59, 59, 999);
                query = query.lte('date', end.toISOString());
            }

            // Same convention as IncomeExpense.tsx's fetchTransactions: only cap the
            // unbounded "All dates" case, never a date-filtered one.
            if (!dateRange.start && !dateRange.end) {
                query = query.limit(1000);
            }

            const { data, error } = await query.order('date', { ascending: false });
            if (error) throw error;

            setAllRetailPayments((data || []) as CustomerPaymentRow[]);
        } catch (error) {
            console.error('Failed to fetch customer payments:', error);
        } finally {
            setIsLoadingTransactions(false);
        }
    }, [dateRange]);

    useEffect(() => {
        fetchRetailPayments();
    }, [fetchRetailPayments]);

    // Order-existence resolution: a SEPARATE, targeted query against `sales` —
    // never the shared, paginated useStore().sales, which only holds whatever
    // page Orders.tsx's infinite-scroll has loaded so far. Looking up existence
    // there would read "not yet paginated" as "deleted" (a false positive on a
    // perfectly valid, older order). Instead, resolve exactly the order_ids and
    // #DEP-<fragment>s this page's own rows reference.
    const [orderResolution, setOrderResolution] = useState<{
        liveSaleIds: Set<string>;
        fragmentMatches: Map<string, string[]>; // #DEP-<fragment> -> matching live sale ids
    } | null>(null);

    useEffect(() => {
        let cancelled = false;

        const explicitOrderIds = Array.from(new Set(
            allRetailPayments.map(r => r.order_id).filter((id): id is string => !!id)
        ));
        const fragments = Array.from(new Set(
            allRetailPayments
                .filter(r => !r.order_id && r.category === RETAIL_DEPOSIT_CATEGORY)
                .map(r => DEP_ORDER_FRAGMENT_REGEX.exec(r.description || '')?.[1])
                .filter((f): f is string => !!f)
        ));

        if (explicitOrderIds.length === 0 && fragments.length === 0) {
            setOrderResolution({ liveSaleIds: new Set(), fragmentMatches: new Map() });
            return;
        }

        const resolve = async () => {
            const liveSaleIds = new Set<string>();
            try {
                await Promise.all(chunk(explicitOrderIds, ID_CHUNK).map(async ids => {
                    if (ids.length === 0) return;
                    const { data, error } = await supabase.from('sales').select('id').in('id', ids);
                    if (error) throw error;
                    for (const s of (data || []) as { id: string }[]) liveSaleIds.add(s.id);
                }));
            } catch (err) {
                console.error('Failed to resolve customer payment order ids:', err);
            }

            const fragmentMatches = new Map<string, string[]>();
            try {
                await Promise.all(chunk(fragments, PREFIX_CHUNK).map(async batch => {
                    if (batch.length === 0) return;
                    const { data, error } = await supabase
                        .from('sales')
                        .select('id')
                        .or(batch.map(p => `id.like.${p}%`).join(','));
                    if (error) throw error;
                    for (const s of (data || []) as { id: string }[]) {
                        for (const p of batch) {
                            if (!s.id.startsWith(p)) continue;
                            const list = fragmentMatches.get(p);
                            if (list) list.push(s.id); else fragmentMatches.set(p, [s.id]);
                        }
                    }
                }));
            } catch (err) {
                console.error('Failed to resolve customer payment deposit fragments:', err);
            }

            if (!cancelled) setOrderResolution({ liveSaleIds, fragmentMatches });
        };
        resolve();

        return () => { cancelled = true; };
    }, [allRetailPayments]);

    // Orders are soft-deleted (archived to deleted_orders, restorable from
    // there) and the transactions table is never touched when that happens,
    // so a payment row can outlive its order. Drop a row here only when we
    // can POSITIVELY tell its order was deleted — order_id set but no
    // matching live sale, or (for Deposit rows) the #DEP-<id8> marker
    // embedded in the description at creation time matching zero live sales
    // — never for a row that simply has no link at all (predates tracking,
    // can't tell either way). Recomputed from the targeted orderResolution
    // query above, so a restored order makes its payment reappear automatically
    // without depending on what Orders.tsx happens to have paginated.
    const deletedOrderTxIds = useMemo(() => {
        if (!orderResolution) return new Set<string>();
        const { liveSaleIds, fragmentMatches } = orderResolution;
        const ids = new Set<string>();
        for (const r of allRetailPayments) {
            if (r.order_id) {
                if (!liveSaleIds.has(r.order_id)) ids.add(r.id);
                continue;
            }
            if (r.category === RETAIL_DEPOSIT_CATEGORY) {
                const match = DEP_ORDER_FRAGMENT_REGEX.exec(r.description || '');
                if (match) {
                    const fragment = match[1];
                    const candidates = fragmentMatches.get(fragment) || [];
                    if (candidates.length === 0) ids.add(r.id);
                }
            }
        }
        return ids;
    }, [allRetailPayments, orderResolution]);

    const retailPayments = useMemo(
        () => allRetailPayments.filter(r => !deletedOrderTxIds.has(r.id)),
        [allRetailPayments, deletedOrderTxIds]
    );

    // Only show the Reference / Notes columns when this database instance actually
    // has data in them — they may not exist on every instance yet.
    const hasReferenceData = useMemo(() => retailPayments.some(r => (r.reference || '').trim() !== ''), [retailPayments]);
    const hasNotesData = useMemo(() => retailPayments.some(r => (r.notes || '').trim() !== ''), [retailPayments]);

    // These transactions don't carry a posting status themselves — it lives on
    // the separate journal_entries row linked by reference_id === 'TX-' + id
    // (the same convention used everywhere else in this codebase).
    const journalEntryByTxId = useMemo(() => {
        const map = new Map<string, 'Posted' | 'Draft'>(); // txId -> status
        for (const je of journalEntries) {
            const refId = je.reference_id || '';
            if (refId.startsWith('TX-')) {
                // Fall back to 'Posted' if the status field is absent — same
                // missing-migration-column convention used elsewhere (e.g.
                // JournalEntriesPage's own status chip).
                map.set(refId.slice(3), je.status === 'Draft' ? 'Draft' : 'Posted');
            }
        }
        return map;
    }, [journalEntries]);

    // No matching entry at all is treated the same as an unposted (Draft) one.
    const statusOf = (txId: string): 'Posted' | 'Draft' => journalEntryByTxId.get(txId) || 'Draft';

    // Resolve each row's originating order id (for the "View" action):
    //   1. transaction.order_id, when this instance has run
    //      migrations/add_transaction_order_link.sql and the row was written after that.
    //   2. Else, for Deposit-type rows only, parse the `#DEP-<id8>` fragment out of the
    //      description and look for exactly one sale whose id starts with it — zero or
    //      more than one match is treated as unresolved, never guessed.
    //   3. Else (Payment-type rows with no marker): unresolved — no View button.
    const orderIdByTxId = useMemo(() => {
        const map = new Map<string, string>(); // txId -> resolved order id
        if (!orderResolution) return map;
        const { fragmentMatches } = orderResolution;
        for (const r of retailPayments) {
            if (r.order_id) {
                map.set(r.id, r.order_id);
                continue;
            }
            if (r.category === RETAIL_DEPOSIT_CATEGORY) {
                const match = DEP_ORDER_FRAGMENT_REGEX.exec(r.description || '');
                if (match) {
                    const fragment = match[1];
                    const candidates = fragmentMatches.get(fragment) || [];
                    if (candidates.length === 1) {
                        map.set(r.id, candidates[0]);
                    }
                }
            }
        }
        return map;
    }, [retailPayments, orderResolution]);

    // Order id currently shown in the View popup (OrderDetailsModal), null when closed.
    const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);

    // Row currently being finalized via the "Post Now" / Record Receipt flow.
    const [postTarget, setPostTarget] = useState<CustomerPaymentRow | null>(null);
    const postTargetOrder = useMemo(() => {
        if (!postTarget) return null;
        // Synthetic order-like object for RecordReceiptModal's minimal `order`
        // prop — not a real Sale/order, no internal order-id lookups. amountReceived
        // and depositAmount are 0 so the modal defaults "Amount received" to the
        // full transaction amount and "Remaining balance" to $0 (this transaction
        // already represents a completed payment being finalized, not a partial one).
        const syntheticCustomer: Customer = { id: postTarget.id, name: postTarget.description || 'Customer', phone: '' };
        return { total: Number(postTarget.amount || 0), amountReceived: 0, depositAmount: 0, customer: syntheticCustomer };
    }, [postTarget]);

    const handlePostNowConfirm = ({
        settleDate,
        depositAccountId,
        amountReceived,
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
        const type = tx.category === RETAIL_DEPOSIT_CATEGORY ? 'DEP' : 'RCP';
        postOrFinalizeTransactionReceipt({
            txId: tx.id,
            amount: amountReceived,
            date: settleDate,
            description: tx.description || 'Customer',
            depositAccountId,
            type,
            reference: receiptReference,
            notes: receiptNotes
        }).then(() => {
            showToast('Payment posted to the ledger', 'success');
            // Re-fetch so the row's Status flips to Posted and its Post Now
            // button disappears without a full page reload.
            fetchJournalEntries();
        }).catch((err: unknown) => {
            console.error('Failed to post payment to the ledger:', err);
            const message = err instanceof Error ? err.message : 'Unknown error';
            showToast('Failed to post payment: ' + message, 'error');
        });
    };

    const filteredPayments = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        return retailPayments.filter(r => {
            const matchesSearch = !term
                || (r.description || '').toLowerCase().includes(term)
                || (r.customer_phone || '').toLowerCase().includes(term);

            let matchesDate = true;
            const itemDate = parseDate(r.date);
            if (dateRange.start) {
                const start = parseDate(dateRange.start);
                start.setHours(0, 0, 0, 0);
                matchesDate = matchesDate && itemDate >= start;
            }
            if (dateRange.end) {
                const end = parseDate(dateRange.end);
                end.setHours(23, 59, 59, 999);
                matchesDate = matchesDate && itemDate <= end;
            }

            return matchesSearch && matchesDate;
        }).sort((a, b) => {
            const diff = parseDate(b.date).getTime() - parseDate(a.date).getTime();
            if (diff !== 0) return diff;
            const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return timeB - timeA;
        });
    }, [retailPayments, searchTerm, dateRange]);

    const stats = useMemo(() => {
        const totalAmount = filteredPayments.reduce((sum, r) => sum + Number(r.amount || 0), 0);
        return { count: filteredPayments.length, totalAmount };
    }, [filteredPayments]);

    const hasActiveFilters = searchTerm !== '' || dateRange.start !== '' || dateRange.end !== '';
    const clearFilters = () => {
        setSearchTerm('');
        setDateRange({ start: '', end: '' });
    };

    const colCount = 8 + (hasReferenceData ? 1 : 0) + (hasNotesData ? 1 : 0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            {/* Summary stat cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: isMobile ? '8px' : '16px'
            }}>
                <StatsCard
                    title="Total Records"
                    value={stats.count.toLocaleString()}
                    icon={Receipt}
                    color="var(--color-primary)"
                />
                <StatsCard
                    title="Total Amount"
                    value={formatAmount(stats.totalAmount)}
                    icon={Wallet}
                    color="#059669"
                />
            </div>

            {/* Filters */}
            <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                    <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                    <input
                        type="text"
                        placeholder="Search customer name or phone..."
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

            {/* Table */}
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', whiteSpace: 'nowrap' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg)' }}>
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
                            {isLoadingTransactions ? (
                                <tr>
                                    <td colSpan={colCount} style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        Loading customer payments...
                                    </td>
                                </tr>
                            ) : filteredPayments.length === 0 ? (
                                <tr>
                                    <td colSpan={colCount} style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        No customer payments found for these filters.
                                    </td>
                                </tr>
                            ) : (
                                filteredPayments.map((r, idx) => {
                                    const status = statusOf(r.id);
                                    const orderId = orderIdByTxId.get(r.id);
                                    const customerLabel = r.customer_phone ? `${r.description || '—'} - ${r.customer_phone}` : (r.description || '—');
                                    return (
                                        <tr key={r.id} style={{ background: idx % 2 === 1 ? 'var(--color-bg)' : 'transparent' }}>
                                            <td style={tdStyle}>{formatDate(r.date)}</td>
                                            <td style={{ ...tdStyle, fontWeight: 600 }}>{customerLabel}</td>
                                            <td style={tdStyle}><TypeBadge category={r.category} /></td>
                                            <td style={{ ...tdStyle, fontWeight: 600, color: '#059669' }}>{formatAmount(r.amount)}</td>
                                            <td style={tdStyle}>{r.pay_by || '—'}</td>
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
                                            <td style={tdStyle}><StatusChip status={status} /></td>
                                            <td style={tdStyle}>
                                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                    <button
                                                        onClick={() => setPostTarget(r)}
                                                        disabled={status !== 'Draft'}
                                                        style={{
                                                            padding: '6px 12px', borderRadius: '8px', border: 'none',
                                                            background: status === 'Draft' ? 'var(--color-primary)' : 'var(--color-border)',
                                                            color: status === 'Draft' ? '#fff' : 'var(--color-text-secondary)',
                                                            cursor: status === 'Draft' ? 'pointer' : 'not-allowed',
                                                            fontSize: '12px', fontWeight: 600
                                                        }}
                                                    >
                                                        Post Now
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
            </div>

            {postTarget && postTargetOrder && (
                <RecordReceiptModal
                    isOpen={!!postTarget}
                    onClose={() => setPostTarget(null)}
                    order={postTargetOrder}
                    initialMethod={postTarget.pay_by || undefined}
                    initialDate={localYMD(postTarget.date)}
                    title="Record Receipt"
                    description="Please confirm the settle date and payment method to post this payment to the ledger."
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
