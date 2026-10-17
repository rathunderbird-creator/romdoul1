import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Search, ArrowDownToLine } from 'lucide-react';
import { useMobile } from '../../hooks/useMobile';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../../components';
import DateRangePicker from '../../components/DateRangePicker';
import { useAccounting } from '../../hooks/useAccounting';
import { supabase } from '../../lib/supabase';
import type { JournalEntryLine } from '../../types';

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};



// One operational transaction ready to become a draft journal entry.
interface ImportCandidate {
    txId: string;
    date: string;
    amount: number;
    description: string;
    source: string;
    debitId: string;
    debitLabel: string;
    creditId: string;
    creditLabel: string;
}

// Posted (green) / Draft (amber) chip, with a Post button on drafts.
const statusChip = (status: string) => (
    <span style={{
        padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.5px',
        background: status === 'Draft' ? '#fef3c7' : '#dcfce7',
        color: status === 'Draft' ? '#92400e' : '#166534',
    }}>{status === 'Draft' ? 'DRAFT' : 'POSTED'}</span>
);

const JournalEntriesPage = () => {
    const isMobile = useMobile();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { journalEntries, accounts, isLoading, fetchJournalEntries, fetchAccounts, saveJournalEntry } = useAccounting();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    
    // Form state
    const [date, setDate] = useState(() => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
    const [description, setDescription] = useState('');
    const [referenceId, setReferenceId] = useState('');
    const [entryStatus, setEntryStatus] = useState<'Posted' | 'Draft'>('Posted');
    const [lines, setLines] = useState<Partial<JournalEntryLine>[]>([
        { account_id: '', debit: 0, credit: 0 },
        { account_id: '', debit: 0, credit: 0 }
    ]);

    // ── Import from operations: supplier payments (#SPP), wholesale receipts
    // (#WSP) and payroll (#PAY) become draft entries, keyed TX-<id> so nothing
    // imports twice. Income & Expense's own rows (manual entries, retail
    // sales, deposits) deliberately stay out of the ledger. ──
    const [importing, setImporting] = useState(false);
    const [importPreview, setImportPreview] = useState<{ candidates: ImportCandidate[]; skipped: number } | null>(null);

    const prepareImport = async () => {
        setImporting(true);
        try {
            type Raw = Record<string, unknown>;
            const txs: Raw[] = [];
            for (let from = 0; from < 100000; from += 1000) {
                const { data, error } = await supabase
                    .from('transactions')
                    .select('id, date, type, category, amount, description, pay_by')
                    .order('date', { ascending: true })
                    .range(from, from + 999);
                if (error) throw error;
                txs.push(...((data || []) as Raw[]));
                if (!data || data.length < 1000) break;
            }
            const { data: existing, error: exErr } = await supabase
                .from('journal_entries').select('reference_id').like('reference_id', 'TX-%');
            if (exErr) throw exErr;
            const alreadyImported = new Set((existing || []).map(r => String((r as Raw).reference_id)));

            const pool = accounts.filter(a => a.is_active);
            const byCode = (code: string) => pool.find(a => a.account_code === code);
            const byName = (re: RegExp, type?: string) => pool.find(a => (!type || a.account_type === type) && re.test(a.account_name));
            const inventory = byCode('1300') || byName(/inventory/i, 'Asset') || byName(/cost of goods|purchas/i, 'Expense');
            const salesRevenue = byCode('4000') || byName(/sales revenue/i, 'Revenue') || pool.find(a => a.account_type === 'Revenue');
            const payrollExp = byName(/payroll|salary/i, 'Expense') || byCode('6000') || pool.find(a => a.account_type === 'Expense');
            const cashFor = (payBy: string) => {
                const assets = pool.filter(a => a.account_type === 'Asset');
                const p = payBy.toLowerCase();
                const find = (re: RegExp) => assets.find(a => re.test(a.account_name.toLowerCase()));
                if (p.includes('aba')) return find(/aba/) || find(/bank/);
                if (p.includes('acleda')) return find(/acleda/) || find(/bank/);
                if (/bank|transfer|card|cheque/.test(p)) return find(/bank/) || find(/cash/);
                return find(/cash on hand/) || find(/cash/) || assets[0];
            };

            const candidates: ImportCandidate[] = [];
            let skipped = 0;
            for (const t of txs) {
                const desc = String(t.description || '');
                if (alreadyImported.has('TX-' + String(t.id))) continue;
                let source = '';
                let main: typeof inventory;
                let isExpense = false;
                if (desc.includes('#SPP-')) { source = 'Supplier payment'; main = inventory; isExpense = true; }
                else if (desc.includes('#WSP-')) { source = 'Wholesale receipt'; main = salesRevenue; }
                else if (desc.includes('#PAY-')) { source = 'Payroll'; main = payrollExp; isExpense = true; }
                else continue; // an Income & Expense row — stays out of the ledger
                const cash = cashFor(String(t.pay_by || ''));
                const amount = Math.round((Number(t.amount) || 0) * 100) / 100;
                if (!main || !cash || amount <= 0) { skipped++; continue; }
                candidates.push({
                    txId: String(t.id),
                    date: String(t.date).slice(0, 10),
                    amount,
                    description: `${desc}${t.category ? ` (${String(t.category)})` : ''}`,
                    source,
                    debitId: isExpense ? main.id : cash.id,
                    debitLabel: isExpense ? main.account_name : cash.account_name,
                    creditId: isExpense ? cash.id : main.id,
                    creditLabel: isExpense ? cash.account_name : main.account_name,
                });
            }
            setImportPreview({ candidates, skipped });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed to scan transactions: ' + msg, 'error');
        } finally {
            setImporting(false);
        }
    };

    const runImport = async () => {
        if (!importPreview) return;
        setImporting(true);
        let ok = 0, failed = 0;
        try {
            for (const c of importPreview.candidates) {
                const payload: Record<string, unknown> = { date: c.date, description: c.description, reference_id: 'TX-' + c.txId, status: 'Draft' };
                const { data: entry, error } = await supabase.from('journal_entries').insert([payload]).select().single();
                if (error && /status/i.test(error.message || '')) {
                    // Never import as instantly-posted: drafts need the status column.
                    showToast('Importing needs migrations/add_entry_status.sql on this instance, so entries arrive as drafts — nothing was imported', 'error');
                    return;
                }
                if (error || !entry) { failed++; continue; }
                const { error: lErr } = await supabase.from('journal_entry_lines').insert([
                    { journal_entry_id: entry.id, account_id: c.debitId, debit: c.amount, credit: 0 },
                    { journal_entry_id: entry.id, account_id: c.creditId, debit: 0, credit: c.amount },
                ]);
                if (lErr) {
                    await supabase.from('journal_entries').delete().eq('id', entry.id);
                    failed++;
                    continue;
                }
                ok++;
            }
            showToast(`Imported ${ok} draft ${ok === 1 ? 'entry' : 'entries'}${failed ? `, ${failed} failed` : ''}`, failed ? 'error' : 'success');
            setImportPreview(null);
            fetchJournalEntries();
        } finally {
            setImporting(false);
        }
    };

    // Reviewing a draft can also mean rejecting it.
    const deleteDraft = async (entryId: string) => {
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

    // Manually post a draft entry.
    const postEntry = async (entryId: string) => {
        try {
            const { error } = await supabase.from('journal_entries').update({ status: 'Posted' }).eq('id', entryId);
            if (error) throw error;
            showToast('Entry posted', 'success');
            fetchJournalEntries();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast(/status/i.test(msg)
                ? 'Posting needs migrations/add_entry_status.sql on this instance'
                : 'Failed to post entry: ' + msg, 'error');
        }
    };

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Journal Entries</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Record and review general journal entries.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchJournalEntries();
        fetchAccounts();
    }, [fetchJournalEntries, fetchAccounts]);



    const handleOpenModal = () => {
        setDate(new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
        setDescription('');
        setReferenceId('');
        setEntryStatus('Posted');
        setLines([
            { account_id: '', debit: 0, credit: 0 },
            { account_id: '', debit: 0, credit: 0 }
        ]);
        setIsModalOpen(true);
    };

    const addLine = () => {
        setLines([...lines, { account_id: '', debit: 0, credit: 0 }]);
    };

    const removeLine = (index: number) => {
        setLines(lines.filter((_, i) => i !== index));
    };

    const updateLine = (index: number, field: keyof JournalEntryLine, value: any) => {
        const newLines = [...lines];
        
        // If updating debit, ensure credit is 0, and vice versa
        if (field === 'debit' && value > 0) {
            newLines[index] = { ...newLines[index], debit: value, credit: 0 };
        } else if (field === 'credit' && value > 0) {
            newLines[index] = { ...newLines[index], credit: value, debit: 0 };
        } else {
            newLines[index] = { ...newLines[index], [field]: value };
        }
        
        setLines(newLines);
    };

    const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
    const isBalanced = totalDebit > 0 && totalDebit === totalCredit;
    const isFormValid = isBalanced && lines.every(l => l.account_id) && date;

    const handleSave = async () => {
        if (!isFormValid) return;
        try {
            await saveJournalEntry(
                { date, description, reference_id: referenceId, status: entryStatus },
                lines
            );
            setIsModalOpen(false);
        } catch (error) {
            console.error(error);
        }
    };

    const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts]);

    const filteredEntries = useMemo(() => {
        let result = journalEntries;

        if (dateRange.start) {
            result = result.filter(e => e.date >= dateRange.start);
        }
        if (dateRange.end) {
            result = result.filter(e => e.date <= dateRange.end);
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(entry => 
                (entry.description?.toLowerCase().includes(q)) ||
                (entry.reference_id?.toLowerCase().includes(q)) ||
                (entry.id.toLowerCase().includes(q))
            );
        }
        
        return result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [journalEntries, searchQuery, dateRange]);

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: '380px' }}>
                        <Search size={16} color="#8792a2" style={{ position: 'absolute', left: '12px', top: '10px' }} />
                        <input 
                            type="text" 
                            placeholder="Search by entry number or description..." 
                            style={{ 
                                width: '100%', padding: '8px 12px 8px 36px', 
                                borderRadius: '8px', border: '1px solid #e2e8f0',
                                fontSize: '14px', outline: 'none', background: 'var(--color-surface)'
                            }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    
                    <div style={{ background: 'var(--color-surface)', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '2px' }}>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>
                    
                    {(dateRange.start || dateRange.end || searchQuery) && (
                        <button 
                            onClick={() => { setDateRange({ start: '', end: '' }); setSearchQuery(''); }} 
                            style={{ 
                                padding: '8px 12px', borderRadius: '8px', fontSize: '13px', 
                                color: '#ef4444', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 500
                            }}
                        >
                            Clear Filters
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                        onClick={prepareImport}
                        disabled={importing}
                        title="Bring supplier payments, wholesale receipts and payroll into the ledger as drafts"
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '10px 16px', borderRadius: '8px',
                            background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
                            border: '1px solid #cbd5e1', fontWeight: 600, fontSize: '14px',
                            cursor: importing ? 'wait' : 'pointer'
                        }}
                    >
                        <ArrowDownToLine size={16} /> {importing ? 'Working…' : 'Import to Ledger'}
                    </button>
                    <button
                        onClick={handleOpenModal}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '10px 16px', borderRadius: '8px',
                            background: '#5469d4', color: 'white', border: 'none',
                            fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                    >
                        <Plus size={16} /> New Entry
                    </button>
                </div>
            </div>

            <div style={{ background: 'var(--color-surface)', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                {isMobile ? (
                    // Phones: one card per entry — no sideways scrolling.
                    isLoading ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading entries...</div>
                    ) : filteredEntries.length === 0 ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px' }}>No entries found</div>
                    ) : (
                        filteredEntries.map(entry => {
                            const totalDebits = entry.lines?.reduce((sum, l) => sum + (l.debit || 0), 0) || 0;
                            const displayId = entry.reference_id || `JE-${entry.id.substring(0, 8).toUpperCase()}`;
                            return (
                                <div key={entry.id} style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
                                        <span style={{ fontWeight: 600, color: '#5469d4', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayId}</span>
                                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                                            {new Date(entry.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })}
                                        </span>
                                    </div>
                                    <div className="d2-khmer" style={{ fontSize: '13px', color: 'var(--color-text-main)', margin: '4px 0 6px', fontWeight: 500 }}>
                                        {entry.description || 'No Description'}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(totalDebits)}</span>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                            {statusChip(entry.status || 'Posted')}
                                            {entry.status === 'Draft' && (
                                                <>
                                                    <button onClick={() => postEntry(entry.id)} style={{ padding: '3px 10px', borderRadius: '7px', border: 'none', background: '#5469d4', color: 'white', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Post</button>
                                                    <Trash2 size={14} color="#ef4444" style={{ cursor: 'pointer' }} onClick={() => deleteDraft(entry.id)} />
                                                </>
                                            )}
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    )
                ) : (
                <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '680px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Entry #</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Date</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Description</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', textAlign: 'right' }}>Debit Total</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', textAlign: 'right' }}>Credit Total</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase', textAlign: 'center' }}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading entries...</td></tr>
                        ) : filteredEntries.length === 0 ? (
                            <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No entries found</td></tr>
                        ) : (
                            filteredEntries.map(entry => {
                                const totalDebits = entry.lines?.reduce((sum, l) => sum + (l.debit || 0), 0) || 0;
                                const totalCredits = entry.lines?.reduce((sum, l) => sum + (l.credit || 0), 0) || 0;
                                const displayId = entry.reference_id || `JE-${entry.id.substring(0, 8).toUpperCase()}`;
                                
                                return (
                                    <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9', background: 'var(--color-surface)', transition: 'background 0.2s' }}>
                                        <td style={{ padding: '16px 24px', fontWeight: '500', color: '#5469d4', cursor: 'pointer' }}>
                                            {displayId}
                                        </td>
                                        <td style={{ padding: '16px 24px', color: 'var(--color-text-secondary)' }}>
                                            {new Date(entry.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })}
                                        </td>
                                        <td style={{ padding: '16px 24px', color: 'var(--color-text-main)', fontWeight: '500' }}>
                                            {entry.description || 'No Description'}
                                        </td>
                                        <td style={{ padding: '16px 24px', fontWeight: '600', textAlign: 'right', color: 'var(--color-text-main)' }}>
                                            {formatCurrency(totalDebits)}
                                        </td>
                                        <td style={{ padding: '16px 24px', fontWeight: '600', textAlign: 'right', color: 'var(--color-text-main)' }}>
                                            {formatCurrency(totalCredits)}
                                        </td>
                                        <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                                {statusChip(entry.status || 'Posted')}
                                                {entry.status === 'Draft' && (
                                                    <>
                                                        <button onClick={() => postEntry(entry.id)} style={{ padding: '3px 10px', borderRadius: '7px', border: 'none', background: '#5469d4', color: 'white', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Post</button>
                                                        <Trash2 size={14} color="#ef4444" style={{ cursor: 'pointer' }} onClick={() => deleteDraft(entry.id)} />
                                                    </>
                                                )}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
                </div>
                )}
            </div>

            {/* Import-to-ledger preview */}
            <Modal
                isOpen={!!importPreview}
                onClose={() => setImportPreview(null)}
                title="Import to Ledger"
            >
                {importPreview && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                            Supplier payments, wholesale receipts and payroll from operations become <b>draft</b> journal entries
                            for you to review and post. Income &amp; Expense's own entries stay out of the ledger, and
                            nothing imports twice.
                        </p>
                        {importPreview.candidates.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '13px', background: 'var(--color-bg)', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                Everything is already in the ledger — nothing new to import.
                                {importPreview.skipped > 0 && <div style={{ marginTop: '6px', fontSize: '12px' }}>({importPreview.skipped} skipped: no matching account)</div>}
                            </div>
                        ) : (
                            <>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                    {importPreview.candidates.length} {importPreview.candidates.length === 1 ? 'transaction' : 'transactions'} ·{' '}
                                    {formatCurrency(importPreview.candidates.reduce((s, c) => s + c.amount, 0))}
                                    {importPreview.skipped > 0 && <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}> · {importPreview.skipped} skipped (no matching account)</span>}
                                </div>
                                <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                                    {importPreview.candidates.map(c => (
                                        <div key={c.txId} style={{ padding: '9px 12px', borderBottom: '1px solid #f1f5f9' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#5469d4', flexShrink: 0 }}>{c.source}</span>
                                                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', flexShrink: 0 }}>{c.date}</span>
                                            </div>
                                            <div className="d2-khmer" style={{ fontSize: '12.5px', color: 'var(--color-text-main)', margin: '3px 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.description}>{c.description}</div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '11.5px', color: 'var(--color-text-secondary)' }}>
                                                <span className="d2-khmer" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Dr {c.debitLabel} → Cr {c.creditLabel}</span>
                                                <span style={{ fontWeight: 700, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatCurrency(c.amount)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button onClick={() => setImportPreview(null)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontWeight: 500, cursor: 'pointer' }}>
                                {importPreview.candidates.length === 0 ? 'Close' : 'Cancel'}
                            </button>
                            {importPreview.candidates.length > 0 && (
                                <button
                                    onClick={runImport}
                                    disabled={importing}
                                    style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#5469d4', color: 'white', fontWeight: 600, cursor: importing ? 'wait' : 'pointer' }}
                                >
                                    {importing ? 'Importing…' : `Import ${importPreview.candidates.length} as Drafts`}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </Modal>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="New Journal Entry"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 0' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px', color: 'var(--color-text-main)' }}>Date</label>
                            <input
                                type="date"
                                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', boxSizing: 'border-box' }}
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px', color: 'var(--color-text-main)' }}>Reference (Optional)</label>
                            <input
                                type="text"
                                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', boxSizing: 'border-box' }}
                                value={referenceId}
                                onChange={(e) => setReferenceId(e.target.value)}
                                placeholder="e.g. INV-1002"
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px', color: 'var(--color-text-main)' }}>Status</label>
                            <select
                                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', background: 'var(--color-surface)', boxSizing: 'border-box' }}
                                value={entryStatus}
                                onChange={(e) => setEntryStatus(e.target.value as 'Posted' | 'Draft')}
                            >
                                <option value="Posted">Posted</option>
                                <option value="Draft">Draft</option>
                            </select>
                        </div>
                    </div>
                    
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px', color: 'var(--color-text-main)' }}>Description</label>
                        <input 
                            type="text" 
                            style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}
                            value={description} 
                            onChange={(e) => setDescription(e.target.value)} 
                            placeholder="Reason for this entry"
                        />
                    </div>

                    <div style={{ marginTop: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <label style={{ fontWeight: 500, fontSize: '14px', color: 'var(--color-text-main)' }}>Line Items</label>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '420px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #cbd5e1', color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>
                                    <th style={{ padding: '8px 4px', textAlign: 'left', fontWeight: 600 }}>Account</th>
                                    <th style={{ padding: '8px 4px', textAlign: 'right', width: '90px', fontWeight: 600 }}>Debit</th>
                                    <th style={{ padding: '8px 4px', textAlign: 'right', width: '90px', fontWeight: 600 }}>Credit</th>
                                    <th style={{ padding: '8px 4px', width: '36px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((line, index) => (
                                    <tr key={index}>
                                        <td style={{ padding: '4px' }}>
                                            <select 
                                                style={{ width: '100%', padding: '8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #cbd5e1', background: 'var(--color-surface)', outline: 'none' }}
                                                value={line.account_id}
                                                onChange={(e) => updateLine(index, 'account_id', e.target.value)}
                                            >
                                                <option value="">Select Account</option>
                                                {activeAccounts.map(acc => (
                                                    <option key={acc.id} value={acc.id}>{acc.account_code} - {acc.account_name}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td style={{ padding: '4px' }}>
                                            <input 
                                                type="number" 
                                                style={{ width: '100%', padding: '8px', textAlign: 'right', fontSize: '13px', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none' }}
                                                value={line.debit || ''}
                                                min="0"
                                                onChange={(e) => updateLine(index, 'debit', parseFloat(e.target.value) || 0)}
                                            />
                                        </td>
                                        <td style={{ padding: '4px' }}>
                                            <input 
                                                type="number" 
                                                style={{ width: '100%', padding: '8px', textAlign: 'right', fontSize: '13px', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none' }}
                                                value={line.credit || ''}
                                                min="0"
                                                onChange={(e) => updateLine(index, 'credit', parseFloat(e.target.value) || 0)}
                                            />
                                        </td>
                                        <td style={{ padding: '4px', textAlign: 'center' }}>
                                            <button 
                                                onClick={() => removeLine(index)} 
                                                disabled={lines.length <= 2}
                                                style={{ 
                                                    background: 'none', border: 'none', cursor: lines.length > 2 ? 'pointer' : 'not-allowed', 
                                                    color: lines.length > 2 ? '#ef4444' : 'var(--color-border)',
                                                    padding: '4px'
                                                }}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>
                        <button
                            onClick={addLine}
                            style={{ marginTop: '8px', padding: '6px 12px', fontSize: '13px', borderRadius: '6px', background: 'var(--color-surface)', border: '1px solid #cbd5e1', color: 'var(--color-text-secondary)', fontWeight: 500, cursor: 'pointer' }}
                        >
                            + Add Line
                        </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '32px', margin: '16px 0', padding: '16px', background: 'var(--color-bg)', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Total Debit</div>
                            <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#10b981' }}>{formatCurrency(totalDebit)}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Total Credit</div>
                            <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#ef4444' }}>{formatCurrency(totalCredit)}</div>
                        </div>
                    </div>
                    {!isBalanced && totalDebit > 0 && totalCredit > 0 && (
                        <div style={{ color: '#ef4444', fontSize: '13px', textAlign: 'right', fontWeight: 500 }}>
                            Debits and Credits must be equal to save. (Difference: {formatCurrency(Math.abs(totalDebit - totalCredit))})
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                        <button onClick={() => setIsModalOpen(false)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                        <button 
                            onClick={handleSave} 
                            disabled={!isFormValid}
                            style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#5469d4', color: 'white', fontWeight: 500, cursor: 'pointer', opacity: (!isFormValid) ? 0.5 : 1 }}
                        >
                            Save Entry
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default JournalEntriesPage;
