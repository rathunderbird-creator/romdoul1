import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Printer, Download, RefreshCw, BookText, Trash2 } from 'lucide-react';
import { useMobile } from '../../hooks/useMobile';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useAccounting } from '../../hooks/useAccounting';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { supabase } from '../../lib/supabase';
import type { ChartOfAccount } from '../../types';

// Asset and Expense accounts carry a debit-normal balance; the rest credit-normal.
const signedAmount = (type: ChartOfAccount['account_type'], debit: number, credit: number): number =>
    type === 'Asset' || type === 'Expense' ? debit - credit : credit - debit;

const fmt = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
    const [glDateRange, setGlDateRange] = usePersistedDateRange('general_ledger_range');
    const dateFrom = glDateRange.start;
    const dateTo = glDateRange.end;
    const setDateFrom = (v: string) => setGlDateRange(r => ({ ...r, start: v }));
    const setDateTo = (v: string) => setGlDateRange(r => ({ ...r, end: v }));

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>General Ledger</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', margin: 0 }}>Every posted line behind an account balance</p>
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

    // The date range + account filter, each optional. Rows BEFORE the range
    // still matter for the opening balance, so filter in two steps.
    const filtered = useMemo(() => {
        const byAccount = allRows.filter(r => accountFilter === 'all' || r.account.id === accountFilter);
        const opening = byAccount.filter(r => dateFrom && r.date < dateFrom);
        const inRange = byAccount.filter(r =>
            (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo));
        return { opening, inRange };
    }, [allRows, accountFilter, dateFrom, dateTo]);

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

    const [refreshKey, setRefreshKey] = useState(0);
    const reload = () => { setRefreshKey(k => k + 1); fetchAccounts(); fetchJournalEntries(); };

    const exportCsv = () => {
        const header = ['Account Code', 'Account Name', 'Date', 'Reference', 'Description', 'Contra Account', 'Debit', 'Credit', 'Balance'];
        const rows: (string | number)[][] = [];
        for (const g of ledgerGroups) {
            rows.push([g.account.account_code, g.account.account_name, '', '', 'Opening balance', '', '', '', fmt(g.opening)]);
            for (const row of g.rows) {
                rows.push([g.account.account_code, g.account.account_name, row.date, row.entryRef, row.description, row.contraName, row.debit > 0 ? fmt(row.debit) : '', row.credit > 0 ? fmt(row.credit) : '', fmt(row.balance)]);
            }
            rows.push([g.account.account_code, g.account.account_name, '', '', 'Closing balance', '', fmt(g.debits), fmt(g.credits), fmt(g.closing)]);
        }
        const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `general-ledger-${dateFrom || 'all'}-to-${dateTo || 'all'}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const printList = () => {
        const w = window.open('', '_blank', 'width=1100,height=750');
        if (!w) return;
        const accountBlocks = ledgerGroups.map(g => {
            const rowsHtml = g.rows.map(row => `<tr>
                <td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.entryRef)}</td><td>${escapeHtml(row.description)}</td>
                <td>${escapeHtml(row.contraName)}</td><td style="text-align:right">${row.debit > 0 ? fmt(row.debit) : '—'}</td>
                <td style="text-align:right">${row.credit > 0 ? fmt(row.credit) : '—'}</td><td style="text-align:right">${fmt(row.balance)}</td>
            </tr>`).join('');
            return `<h2>${escapeHtml(g.account.account_code)} · ${escapeHtml(g.account.account_name)} <span style="color:#64748b;font-weight:400">(${escapeHtml(g.account.account_type)}) — Closing balance: ${fmt(g.closing)}</span></h2>
            <table><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Contra Account</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead>
            <tbody>
                <tr style="font-style:italic;color:#64748b"><td>Opening balance</td><td></td><td></td><td></td><td></td><td></td><td style="text-align:right">${fmt(g.opening)}</td></tr>
                ${rowsHtml}
                <tr style="font-weight:700;border-top:2px solid #cbd5e1"><td>Closing balance</td><td></td><td></td><td></td><td style="text-align:right">${fmt(g.debits)}</td><td style="text-align:right">${fmt(g.credits)}</td><td style="text-align:right">${fmt(g.closing)}</td></tr>
            </tbody></table>`;
        }).join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>General Ledger</title><style>
            body{font-family:Segoe UI,Arial,sans-serif;color:#1a1f36;padding:28px}
            h1{font-size:20px;margin:0}h2{font-size:14px;margin:24px 0 6px}p{color:#64748b;margin:4px 0 20px;font-size:13px}
            table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px}
            th{font-size:10px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #cbd5e1;padding:6px;text-align:left}
            th:nth-child(n+5){text-align:right}
            td{padding:5px 6px;border-bottom:1px solid #e2e8f0;font-variant-numeric:tabular-nums}
        </style></head><body><h1>General Ledger</h1><p>${dateFrom || 'Inception'} – ${dateTo || 'today'} · All figures are in USD.</p>
        ${accountBlocks}</body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    const labelStyle: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' };
    const inputStyle: React.CSSProperties = {
        padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
        fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)'
    };
    const btnStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px',
        border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)',
        fontSize: '13px', fontWeight: 600, cursor: 'pointer',
    };
    const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' };
    const refBadgeStyle: React.CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: '6px', background: 'var(--color-bg)', color: 'var(--color-text-secondary)', fontSize: '11px', whiteSpace: 'nowrap' };

    const cardHeader = (g: (typeof ledgerGroups)[number]) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '14px 20px', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0 }}>
                <span className="d2-khmer" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {g.account.account_code} {g.account.account_name}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', flexShrink: 0 }}>{g.account.account_type}</span>
            </div>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                Closing balance: <strong style={{ color: g.closing < 0 ? '#DC2626' : 'var(--color-text-main)' }}>{fmt(g.closing)}</strong>
            </span>
        </div>
    );

    return (
        <div style={isMobile ? { display: 'flex', flexDirection: 'column', gap: '20px' } : { display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
            <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)', flex: isMobile ? undefined : '8 1 0', minWidth: 0 }}>
                {/* Filters */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    <div>
                        <label style={labelStyle}>From</label>
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>To</label>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>Account</label>
                        <select
                            className="d2-khmer"
                            value={accountFilter}
                            onChange={e => setAccountFilter(e.target.value)}
                            style={{ ...inputStyle, maxWidth: '260px', cursor: 'pointer' }}
                        >
                            <option value="all">All accounts</option>
                            {[...accounts].sort((a, b) => a.account_code.localeCompare(b.account_code)).map(a => (
                                <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>
                            ))}
                        </select>
                    </div>
                    <button onClick={reload} title="Reload the ledger" style={{ ...btnStyle, padding: '9px 10px' }}>
                        <RefreshCw size={14} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                    </button>
                    <button onClick={printList} disabled={isLoading} style={{ ...btnStyle, opacity: isLoading ? 0.5 : 1 }}><Printer size={14} /> Print list</button>
                    <button onClick={exportCsv} disabled={isLoading} style={{ ...btnStyle, opacity: isLoading ? 0.5 : 1 }}><Download size={14} /> Export CSV</button>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>All figures are in USD.</div>

                {isLoading ? (
                    <div style={{ ...cardStyle, padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading ledger…</div>
                ) : ledgerGroups.length === 0 ? (
                    <div style={{ ...cardStyle, padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                        <BookText size={28} style={{ opacity: 0.35, marginBottom: '8px' }} />
                        <div>No postings match these filters.</div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }} key={refreshKey}>
                        {ledgerGroups.map(g => (
                            <div key={g.account.id} style={cardStyle}>
                                {cardHeader(g)}
                                {isMobile ? (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 16px', fontSize: '12px', fontStyle: 'italic', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
                                            <span>Opening balance</span>
                                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(g.opening)}</span>
                                        </div>
                                        {g.rows.map(row => (
                                            <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--color-border)' }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div className="d2-khmer" style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.description}</div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span>{row.date}</span><span style={refBadgeStyle}>{row.entryRef}</span>
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                    <div style={{ fontSize: '12.5px', fontVariantNumeric: 'tabular-nums', color: row.debit > 0 ? '#059669' : row.credit > 0 ? '#DC2626' : 'var(--color-text-muted)' }}>
                                                        {row.debit > 0 ? `Dr ${fmt(row.debit)}` : `Cr ${fmt(row.credit)}`}
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: row.balance < 0 ? '#DC2626' : 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', marginTop: '2px' }}>{fmt(row.balance)}</div>
                                                </div>
                                                {row.status === 'Draft' && (
                                                    <button onClick={() => deleteEntry(row.entryId)} title="Delete this draft entry" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '4px', flexShrink: 0 }}>
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', fontSize: '12.5px', fontWeight: 700, background: 'var(--color-bg)' }}>
                                            <span>Closing balance</span>
                                            <span style={{ fontVariantNumeric: 'tabular-nums', color: g.closing < 0 ? '#DC2626' : 'var(--color-text-main)' }}>{fmt(g.closing)}</span>
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                    <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Date</th>
                                                    <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Reference</th>
                                                    <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Description</th>
                                                    <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Contra Account</th>
                                                    <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Debit</th>
                                                    <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Credit</th>
                                                    <th style={{ padding: '10px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Balance</th>
                                                    <th style={{ padding: '10px 20px', width: '40px' }}></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                    <td style={{ padding: '10px 20px', fontStyle: 'italic', color: 'var(--color-text-muted)' }}>Opening balance</td>
                                                    <td></td><td></td><td></td><td></td><td></td>
                                                    <td style={{ padding: '10px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: g.opening < 0 ? '#DC2626' : 'var(--color-text-secondary)' }}>{fmt(g.opening)}</td>
                                                    <td></td>
                                                </tr>
                                                {g.rows.map(row => (
                                                    <tr key={row.key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                        <td style={{ padding: '10px 20px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{row.date}</td>
                                                        <td style={{ padding: '10px 20px', whiteSpace: 'nowrap' }}><span style={refBadgeStyle}>{row.entryRef}</span></td>
                                                        <td className="d2-khmer" style={{ padding: '10px 20px', color: 'var(--color-text-main)' }}>{row.description}</td>
                                                        <td className="d2-khmer" style={{ padding: '10px 20px', color: 'var(--color-text-secondary)' }}>
                                                            {row.contraIds.length === 1 ? (
                                                                <span className="hover-highlight" onClick={() => setAccountFilter(row.contraIds[0])} title="View this account's ledger" style={{ cursor: 'pointer' }}>{row.contraName}</span>
                                                            ) : row.contraName}
                                                        </td>
                                                        <td style={{ padding: '10px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: row.debit > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{row.debit > 0 ? fmt(row.debit) : '—'}</td>
                                                        <td style={{ padding: '10px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: row.credit > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{row.credit > 0 ? fmt(row.credit) : '—'}</td>
                                                        <td style={{ padding: '10px 20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: row.balance < 0 ? '#DC2626' : 'var(--color-text-main)' }}>{fmt(row.balance)}</td>
                                                        <td style={{ padding: '10px 20px', textAlign: 'center' }}>
                                                            {row.status === 'Draft' && (
                                                                <button onClick={() => deleteEntry(row.entryId)} title="Delete this draft entry" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '2px' }}>
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                                <tr style={{ background: 'var(--color-bg)' }}>
                                                    <td style={{ padding: '10px 20px', fontWeight: 700, color: 'var(--color-text-main)' }}>Closing balance</td>
                                                    <td></td><td></td><td></td>
                                                    <td style={{ padding: '10px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{fmt(g.debits)}</td>
                                                    <td style={{ padding: '10px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{fmt(g.credits)}</td>
                                                    <td style={{ padding: '10px 20px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: g.closing < 0 ? '#DC2626' : 'var(--color-text-main)' }}>{fmt(g.closing)}</td>
                                                    <td></td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Reserved for future widgets — intentionally empty, and left
                out entirely on mobile since there's nothing in it to show. */}
            {!isMobile && (
                <>
                    <div style={{ flex: '1 1 0' }} />
                    <div style={{ flex: '1 1 0' }} />
                </>
            )}
        </div>
    );
};

export default GeneralLedgerPage;
