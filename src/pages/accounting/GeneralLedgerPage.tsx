import { useState, useEffect, useMemo, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, BookText, Trash2 } from 'lucide-react';
import { useMobile } from '../../hooks/useMobile';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useAccounting } from '../../hooks/useAccounting';
import { supabase } from '../../lib/supabase';
import DateRangePicker from '../../components/DateRangePicker';
import type { ChartOfAccount } from '../../types';

// Same per-type accents as the Chart of Accounts page.
const TYPE_COLORS: Record<ChartOfAccount['account_type'], string> = {
    Asset: '#10B981',
    Liability: '#EF4444',
    Equity: '#5469d4',
    Revenue: '#0EA5E9',
    Expense: '#F59E0B',
};

// Asset and Expense accounts carry a debit-normal balance; the rest credit-normal.
const signedAmount = (type: ChartOfAccount['account_type'], debit: number, credit: number): number =>
    type === 'Asset' || type === 'Expense' ? debit - credit : credit - debit;

interface LedgerRow {
    key: string;
    date: string;          // YYYY-MM-DD
    sortKey: string;       // date + created_at for a stable posting order
    entryId: string;
    entryRef: string;
    status: string;        // the underlying journal entry's status ('Draft' | 'Posted')
    description: string;
    account: ChartOfAccount;
    debit: number;
    credit: number;
    // The entry's other side: where this posting's money came from or went to.
    contraName: string;
    contraIds: string[];
}

const GeneralLedgerPage = () => {
    const isMobile = useMobile();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { accounts, journalEntries, isLoading, fetchAccounts, fetchJournalEntries } = useAccounting();

    // A deep link (e.g. from Chart of Accounts or a Financial Report line) can
    // pre-filter the ledger to one account via ?account=<id>. This only seeds
    // the initial state — once loaded, the dropdown below drives the filter
    // exactly as before.
    const [searchParams] = useSearchParams();
    const [accountFilter, setAccountFilter] = useState<string>(() => searchParams.get('account') || 'all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>General Ledger</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Every posting per account, with running balances.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchAccounts();
        fetchJournalEntries();
    }, [fetchAccounts, fetchJournalEntries]);

    // A draft entry can be deleted straight from the ledger, same rule as
    // Journal Entries: Posted is final — adjust it with a correcting entry
    // instead. One entry's lines can span several accounts, so this removes
    // it from every account it posted to, not just the one being viewed.
    const deleteEntry = async (entryId: string) => {
        if (!confirm('Delete this draft entry? Its lines are removed too.')) return;
        try {
            const { error: lErr } = await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', entryId);
            if (lErr) throw lErr;
            const { error } = await supabase.from('journal_entries').delete().eq('id', entryId);
            if (error) throw error;
            showToast('Draft deleted', 'success');
            fetchJournalEntries();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed to delete draft: ' + msg, 'error');
        }
    };

    // Every journal line flattened into one ledger row, oldest first.
    const allRows = useMemo(() => {
        const rows: LedgerRow[] = [];
        for (const entry of journalEntries) {
            for (const line of entry.lines || []) {
                if (!line.account) continue; // the account was deleted
                const debit = Number(line.debit) || 0;
                const credit = Number(line.credit) || 0;
                // Contra = the entry's opposite-side lines (a compound entry can
                // have several); deduped so a 4-line sale shows each account once.
                const opposite = (entry.lines || []).filter(l =>
                    l !== line && l.account && (debit > 0 ? (Number(l.credit) || 0) > 0 : (Number(l.debit) || 0) > 0));
                const contraIds: string[] = [];
                const contraNames: string[] = [];
                for (const l of opposite) {
                    if (!l.account || contraIds.includes(l.account.id)) continue;
                    contraIds.push(l.account.id);
                    contraNames.push(l.account.account_name);
                }
                rows.push({
                    key: line.id || `${entry.id}-${line.account_id}-${rows.length}`,
                    date: entry.date,
                    sortKey: `${entry.date}|${entry.created_at || ''}`,
                    entryId: entry.id,
                    // Prefer the human-readable entry_number (see
                    // utils/journalEntryNumber.ts); older rows fall back to
                    // reference_id, then a slice of the entry's own uuid.
                    entryRef: entry.entry_number || entry.reference_id || `#${entry.id.slice(0, 8)}`,
                    status: entry.status || 'Posted',
                    description: entry.description || '—',
                    account: line.account,
                    debit,
                    credit,
                    contraName: contraNames.join(', ') || '—',
                    contraIds,
                });
            }
        }
        rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        return rows;
    }, [journalEntries]);

    // The date range + account + search filters, each optional. Rows BEFORE the
    // range still matter for the opening balance, so filter in two steps.
    const filtered = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        const byAccount = allRows.filter(r =>
            (accountFilter === 'all' || r.account.id === accountFilter) &&
            (!q || r.description.toLowerCase().includes(q) || r.entryRef.toLowerCase().includes(q)));
        const opening = byAccount.filter(r => dateFrom && r.date < dateFrom);
        const inRange = byAccount.filter(r =>
            (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo));
        return { opening, inRange };
    }, [allRows, accountFilter, dateFrom, dateTo, searchQuery]);

    // Group the visible rows per account (chart order), each with its opening
    // balance, running balances and closing totals.
    const ledgerGroups = useMemo(() => {
        const ordered = [...accounts].sort((a, b) => a.account_code.localeCompare(b.account_code));
        return ordered
            .filter(a => accountFilter === 'all' ? filtered.inRange.some(r => r.account.id === a.id) : a.id === accountFilter)
            .map(account => {
                const opening = filtered.opening
                    .filter(r => r.account.id === account.id)
                    .reduce((t, r) => t + signedAmount(account.account_type, r.debit, r.credit), 0);
                let running = opening;
                let debits = 0, credits = 0;
                const rows = filtered.inRange
                    .filter(r => r.account.id === account.id)
                    .map(r => {
                        running += signedAmount(account.account_type, r.debit, r.credit);
                        debits += r.debit;
                        credits += r.credit;
                        return { ...r, balance: running };
                    });
                return { account, opening, rows, debits, credits, closing: running };
            });
    }, [accounts, accountFilter, filtered]);

    const totals = useMemo(() => {
        let debits = 0, credits = 0, lines = 0;
        for (const g of ledgerGroups) { debits += g.debits; credits += g.credits; lines += g.rows.length; }
        return { debits, credits, lines, accounts: ledgerGroups.length };
    }, [ledgerGroups]);

    const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    const singleAccount = accountFilter !== 'all' ? ledgerGroups[0] : null;

    const summaryCards: { label: string; value: string; negative?: boolean }[] = singleAccount
        ? [
            { label: 'Opening Balance', value: fmt(singleAccount.opening), negative: singleAccount.opening < 0 },
            { label: 'Total Debits', value: fmt(singleAccount.debits) },
            { label: 'Total Credits', value: fmt(singleAccount.credits) },
            { label: 'Closing Balance', value: fmt(singleAccount.closing), negative: singleAccount.closing < 0 },
        ]
        : [
            { label: 'Accounts with Activity', value: String(totals.accounts) },
            { label: 'Journal Lines', value: String(totals.lines) },
            { label: 'Total Debits', value: fmt(totals.debits) },
            { label: 'Total Credits', value: fmt(totals.credits) },
        ];

    const inputStyle: React.CSSProperties = {
        padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
        fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)'
    };

    const sectionHeader = (g: (typeof ledgerGroups)[number]) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: TYPE_COLORS[g.account.account_type], flexShrink: 0 }} />
            <span className="d2-khmer" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {g.account.account_code} · {g.account.account_name}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase', flexShrink: 0 }}>{g.account.account_type}</span>
        </div>
    );

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)' }}>
            {/* Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <select
                    className="d2-khmer"
                    value={accountFilter}
                    onChange={e => setAccountFilter(e.target.value)}
                    style={{ ...inputStyle, maxWidth: '260px', cursor: 'pointer' }}
                >
                    <option value="all">All Accounts</option>
                    {[...accounts].sort((a, b) => a.account_code.localeCompare(b.account_code)).map(a => (
                        <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>
                    ))}
                </select>
                <DateRangePicker value={{ start: dateFrom, end: dateTo }} onChange={(r) => { setDateFrom(r.start); setDateTo(r.end); }} />
                <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
                    <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                        type="text"
                        placeholder="Search description or entry…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        style={{ ...inputStyle, width: '100%', paddingLeft: '34px', boxSizing: 'border-box' }}
                    />
                </div>
                {(dateFrom || dateTo || searchQuery || accountFilter !== 'all') && (
                    <button
                        onClick={() => { setAccountFilter('all'); setDateFrom(''); setDateTo(''); setSearchQuery(''); }}
                        style={{ ...inputStyle, cursor: 'pointer', color: 'var(--color-text-secondary)' }}
                    >
                        Clear
                    </button>
                )}
            </div>

            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px', marginBottom: '24px' }}>
                {summaryCards.map(card => (
                    <div key={card.label} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{card.label}</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '6px', fontVariantNumeric: 'tabular-nums', color: card.negative ? '#DC2626' : 'var(--color-text-main)' }}>
                            {isLoading ? '…' : card.value}
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ background: 'var(--color-surface)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                {isLoading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading ledger…</div>
                ) : ledgerGroups.length === 0 || (singleAccount && singleAccount.rows.length === 0 && singleAccount.opening === 0) ? (
                    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                        <BookText size={28} style={{ opacity: 0.35, marginBottom: '8px' }} />
                        <div>No postings match these filters.</div>
                    </div>
                ) : isMobile ? (
                    // Phones: section header per account, stacked line rows.
                    ledgerGroups.map(g => (
                        <Fragment key={g.account.id}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '10px 14px', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
                                {sectionHeader(g)}
                                <span style={{ fontSize: '12px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: g.closing < 0 ? '#DC2626' : 'var(--color-text-secondary)', flexShrink: 0 }}>{fmt(g.closing)}</span>
                            </div>
                            {dateFrom && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', fontSize: '12px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
                                    <span>Opening balance</span>
                                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(g.opening)}</span>
                                </div>
                            )}
                            {g.rows.map(row => (
                                <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderBottom: '1px solid var(--color-border)' }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div className="d2-khmer" style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.description}</div>
                                        <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {fmtDate(row.date)} · {row.entryRef}{row.contraName !== '—' && <span className="d2-khmer"> · ↔ {row.contraName}</span>}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontSize: '12.5px', fontVariantNumeric: 'tabular-nums', color: row.debit > 0 ? '#059669' : row.credit > 0 ? '#DC2626' : 'var(--color-text-muted)' }}>
                                            {row.debit > 0 ? `Dr ${fmt(row.debit)}` : `Cr ${fmt(row.credit)}`}
                                        </div>
                                        <div style={{ fontSize: '11px', color: row.balance < 0 ? '#DC2626' : 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', marginTop: '2px' }}>{fmt(row.balance)}</div>
                                    </div>
                                    {row.status === 'Draft' && (
                                        <button
                                            onClick={() => deleteEntry(row.entryId)}
                                            title="Delete this draft entry"
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '4px', flexShrink: 0 }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </Fragment>
                    ))
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13.5px', minWidth: '920px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <th style={{ padding: '14px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', width: '120px' }}>Date</th>
                                    <th style={{ padding: '14px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', width: '140px' }}>Entry</th>
                                    <th style={{ padding: '14px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Description</th>
                                    <th style={{ padding: '14px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', width: '180px' }}>Contra Account</th>
                                    <th style={{ padding: '14px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', width: '130px', textAlign: 'right' }}>Debit</th>
                                    <th style={{ padding: '14px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', width: '130px', textAlign: 'right' }}>Credit</th>
                                    <th style={{ padding: '14px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', width: '150px', textAlign: 'right' }}>Balance</th>
                                    <th style={{ padding: '14px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', width: '60px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {ledgerGroups.map(g => (
                                    <Fragment key={g.account.id}>
                                        <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
                                            <td colSpan={6} style={{ padding: '10px 24px', borderLeft: `3px solid ${TYPE_COLORS[g.account.account_type]}` }}>{sectionHeader(g)}</td>
                                            <td colSpan={2} style={{ padding: '10px 24px', textAlign: 'right', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                                {dateFrom ? <>Opening <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: g.opening < 0 ? '#DC2626' : 'var(--color-text-secondary)' }}>{fmt(g.opening)}</span></> : null}
                                            </td>
                                        </tr>
                                        {g.rows.map(row => (
                                            <tr key={row.key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <td style={{ padding: '12px 24px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(row.date)}</td>
                                                <td style={{ padding: '12px 24px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{row.entryRef}</td>
                                                <td className="d2-khmer" style={{ padding: '12px 24px', color: 'var(--color-text-main)' }}>{row.description}</td>
                                                <td className="d2-khmer" style={{ padding: '12px 24px', color: 'var(--color-text-secondary)' }}>
                                                    {row.contraIds.length === 1 ? (
                                                        <span
                                                            className="hover-highlight"
                                                            onClick={() => setAccountFilter(row.contraIds[0])}
                                                            title="View this account's ledger"
                                                            style={{ cursor: 'pointer' }}
                                                        >{row.contraName}</span>
                                                    ) : row.contraName}
                                                </td>
                                                <td style={{ padding: '12px 24px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: row.debit > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{row.debit > 0 ? fmt(row.debit) : '—'}</td>
                                                <td style={{ padding: '12px 24px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: row.credit > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{row.credit > 0 ? fmt(row.credit) : '—'}</td>
                                                <td style={{ padding: '12px 24px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: row.balance < 0 ? '#DC2626' : 'var(--color-text-main)' }}>{fmt(row.balance)}</td>
                                                <td style={{ padding: '12px 24px', textAlign: 'center' }}>
                                                    {row.status === 'Draft' && (
                                                        <button
                                                            onClick={() => deleteEntry(row.entryId)}
                                                            title="Delete this draft entry"
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '2px' }}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                        <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                                            <td colSpan={4} style={{ padding: '10px 24px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                                                Total · {g.rows.length} {g.rows.length === 1 ? 'line' : 'lines'}
                                            </td>
                                            <td style={{ padding: '10px 24px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{fmt(g.debits)}</td>
                                            <td style={{ padding: '10px 24px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{fmt(g.credits)}</td>
                                            <td style={{ padding: '10px 24px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: g.closing < 0 ? '#DC2626' : 'var(--color-text-main)' }}>{fmt(g.closing)}</td>
                                            <td style={{ padding: '10px 24px' }}></td>
                                        </tr>
                                    </Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default GeneralLedgerPage;
