import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Search, ArrowDownToLine, Eye, Printer, Pencil, CheckCircle2, Download, Check, AlertTriangle } from 'lucide-react';
import { useMobile } from '../../hooks/useMobile';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../../components';
import DateRangePicker from '../../components/DateRangePicker';
import { useAccounting } from '../../hooks/useAccounting';
import { supabase } from '../../lib/supabase';
import { nextJournalEntryNumber, type JournalEntryTypeCode } from '../../utils/journalEntryNumber';
import { dayKeyFromDate } from '../../utils/dateRange';
import type { JournalEntry, JournalEntryLine } from '../../types';

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

// The list shows amounts the reference-design way: "USD 360.00".
const fmtUsd = (n: number) => `USD ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB');

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PRINT_CSS = `
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #111; margin: 32px; font-size: 13px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .muted { color: #666; }
  .meta { margin: 14px 0 18px; display: grid; grid-template-columns: 110px 1fr; row-gap: 5px; }
  .meta b { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #ccc; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mono { font-family: monospace; font-size: 11px; white-space: nowrap; }
  tfoot td { font-weight: 700; background: #fafafa; }
  .foot { margin-top: 22px; font-size: 11px; color: #888; }
`;

// Stacked icon-above-label action button, as in the reference design.
const ActionBtn: React.FC<{ icon: React.ComponentType<{ size?: number }>; label: string; onClick: () => void; color?: string }> = ({ icon: Icon, label, onClick, color }) => (
    <button
        onClick={onClick}
        title={label}
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '2px', background: 'none', border: 'none', cursor: 'pointer', color: color || 'var(--color-text-secondary)', padding: '2px 6px' }}
    >
        <Icon size={15} />
        <span style={{ fontSize: '10px', fontWeight: 600 }}>{label}</span>
    </button>
);



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

// Posted (soft blue) / Draft (amber) chip, as in the reference design.
const statusChip = (status: string) => (
    <span style={{
        padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700,
        background: status === 'Draft' ? '#fef3c7' : 'rgba(84, 105, 212, 0.12)',
        color: status === 'Draft' ? '#92400e' : '#4c5fd0',
    }}>{status === 'Draft' ? 'Draft' : 'Posted'}</span>
);

const JournalEntriesPage = () => {
    const isMobile = useMobile();
    const navigate = useNavigate();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { journalEntries, accounts, isLoading, fetchJournalEntries, fetchAccounts, saveJournalEntry } = useAccounting();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [statusFilter, setStatusFilter] = useState<'All' | 'Posted' | 'Draft'>('All');
    // Editing an existing draft reuses the entry modal; null = creating.
    const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
    const [viewEntry, setViewEntry] = useState<JournalEntry | null>(null);
    
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
            // Supplier payments settle the liability the received PO created
            // (Dr Accounts Payable), matching what recordSupplierPayment now
            // posts directly; only a chart without a payable account falls back
            // to the old direct-expense treatment.
            const supplierPayable = byCode('2000') || byName(/payable/i, 'Liability')
                || byCode('5000') || byName(/cost of goods|cogs|purchas/i, 'Expense') || byCode('1300') || byName(/inventory/i, 'Asset');
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
                let main: typeof supplierPayable;
                let isExpense = false;
                if (desc.includes('#SPP-')) { source = 'Supplier payment'; main = supplierPayable; isExpense = true; }
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

    // Maps an import candidate's `source` label (set in prepareImport above)
    // to its entry_number type code.
    const typeCodeForSource = (source: string): JournalEntryTypeCode =>
        source === 'Supplier payment' ? 'SPP' : source === 'Wholesale receipt' ? 'WSP' : 'PAY';

    const runImport = async () => {
        if (!importPreview) return;
        setImporting(true);
        let ok = 0, failed = 0;
        try {
            for (const c of importPreview.candidates) {
                const entryNumber = await nextJournalEntryNumber(typeCodeForSource(c.source), c.date);
                const payload: Record<string, unknown> = { date: c.date, description: c.description, reference_id: 'TX-' + c.txId, status: 'Draft' };
                if (entryNumber) payload.entry_number = entryNumber;
                let { data: entry, error } = await supabase.from('journal_entries').insert([payload]).select().single();
                // entry_number arrives with migrations/add_journal_entry_number.sql;
                // until an instance has run it, import the entry without it.
                if (error && /entry_number/i.test(error.message || '')) {
                    const withoutEntryNumber = { ...payload };
                    delete withoutEntryNumber.entry_number;
                    ({ data: entry, error } = await supabase.from('journal_entries').insert([withoutEntryNumber]).select().single());
                }
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
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Double-entry ledger with real-time validation.</p>
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
        setEditingEntryId(null);
        setDate(new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
        setDescription('');
        setReferenceId('');
        setEntryStatus('Posted');
        setLines([
            { account_id: '', debit: 0, credit: 0, description: '' },
            { account_id: '', debit: 0, credit: 0, description: '' }
        ]);
        setIsModalOpen(true);
    };

    // Load a draft into the modal for editing.
    const openEdit = (entry: JournalEntry) => {
        setEditingEntryId(entry.id);
        setDate(String(entry.date).slice(0, 10));
        setDescription(entry.description || '');
        setReferenceId(entry.reference_id || '');
        setEntryStatus(entry.status === 'Draft' ? 'Draft' : 'Posted');
        const ls = (entry.lines || []).map(l => ({ account_id: l.account_id, debit: l.debit || 0, credit: l.credit || 0, description: l.description || '' }));
        setLines(ls.length >= 2 ? ls : [...ls, { account_id: '', debit: 0, credit: 0, description: '' }, { account_id: '', debit: 0, credit: 0, description: '' }].slice(0, Math.max(2, ls.length)));
        setIsModalOpen(true);
    };

    const addLine = () => {
        setLines([...lines, { account_id: '', debit: 0, credit: 0, description: '' }]);
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
        if (editingEntryId) {
            // Update the header, then rebuild the lines with the edited values.
            try {
                const headerPayload: Record<string, unknown> = { date, description, reference_id: referenceId, status: entryStatus };
                let { error } = await supabase.from('journal_entries').update(headerPayload).eq('id', editingEntryId);
                if (error && /status/i.test(error.message || '')) {
                    const noStatus = { ...headerPayload };
                    delete noStatus.status;
                    ({ error } = await supabase.from('journal_entries').update(noStatus).eq('id', editingEntryId));
                }
                if (error) throw error;
                const { error: delErr } = await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', editingEntryId);
                if (delErr) throw delErr;
                const linePayloads = lines.map(l => ({
                    journal_entry_id: editingEntryId,
                    account_id: l.account_id,
                    debit: Number(l.debit) || 0,
                    credit: Number(l.credit) || 0,
                    ...(l.description?.trim() ? { description: l.description.trim() } : {})
                }));
                let { error: insErr } = await supabase.from('journal_entry_lines').insert(linePayloads);
                // Line descriptions need migrations/add_journal_entry_line_description.sql.
                if (insErr && /description/i.test(insErr.message || '') && linePayloads.some(l => 'description' in l)) {
                    ({ error: insErr } = await supabase.from('journal_entry_lines').insert(
                        linePayloads.map(l => { const copy: Record<string, unknown> = { ...l }; delete copy.description; return copy; })
                    ));
                    if (!insErr) showToast('Saved without the line descriptions — run migrations/add_journal_entry_line_description.sql to store them', 'info');
                }
                if (insErr) throw insErr;
                showToast('Entry updated', 'success');
                setIsModalOpen(false);
                setEditingEntryId(null);
                fetchJournalEntries();
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                showToast('Failed to update entry: ' + msg, 'error');
            }
            return;
        }
        try {
            const entryNumber = await nextJournalEntryNumber('MAN', date);
            await saveJournalEntry(
                { date, description, reference_id: referenceId, status: entryStatus, ...(entryNumber ? { entry_number: entryNumber } : {}) },
                lines
            );
            setIsModalOpen(false);
        } catch (error) {
            console.error(error);
        }
    };

    // ── View / print / export ──
    const entryTotals = (entry: JournalEntry) => ({
        debit: entry.lines?.reduce((s, l) => s + (l.debit || 0), 0) || 0,
        credit: entry.lines?.reduce((s, l) => s + (l.credit || 0), 0) || 0,
    });
    // Prefer the human-readable entry_number (JE-<n>-<type>-<date>-<seq>, see
    // utils/journalEntryNumber.ts) when this instance has it; older rows and
    // ones from before migrations/add_journal_entry_number.sql fall back to
    // the raw reference_id, then a slice of the entry's own uuid.
    const displayIdOf = (entry: JournalEntry) => entry.entry_number || entry.reference_id || `JE-${entry.id.substring(0, 8).toUpperCase()}`;
    const accountLabelOf = (l: JournalEntryLine) => l.account ? `${l.account.account_code} · ${l.account.account_name}` : '?';

    const openPrintWindow = (title: string, bodyHtml: string) => {
        const w = window.open('', '_blank', 'width=860,height=900');
        if (!w) { showToast('Allow popups to print', 'error'); return; }
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 300);
    };

    const printEntry = (entry: JournalEntry) => {
        const totals = entryTotals(entry);
        const linesHtml = (entry.lines || []).map(l => `
            <tr>
                <td>${escapeHtml(accountLabelOf(l))}</td>
                <td class="num">${(l.debit || 0) > 0 ? fmtUsd(l.debit || 0) : ''}</td>
                <td class="num">${(l.credit || 0) > 0 ? fmtUsd(l.credit || 0) : ''}</td>
            </tr>`).join('');
        openPrintWindow(`Journal Entry ${displayIdOf(entry)}`, `
  <h1>Romdoul ERP System Solution — Journal Entry</h1>
  <div class="muted">${escapeHtml(displayIdOf(entry))}</div>
  <div class="meta">
    <b>Date</b><span>${escapeHtml(fmtDate(entry.date))}</span>
    <b>Status</b><span>${escapeHtml(entry.status === 'Draft' ? 'Draft' : 'Posted')}</span>
    <b>Description</b><span>${escapeHtml(entry.description || '—')}</span>
  </div>
  <table>
    <thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
    <tbody>${linesHtml}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${fmtUsd(totals.debit)}</td><td class="num">${fmtUsd(totals.credit)}</td></tr></tfoot>
  </table>
  <div class="foot">Printed ${new Date().toLocaleString()}</div>`);
    };

    const printList = () => {
        const rowsHtml = filteredEntries.map(entry => {
            const t = entryTotals(entry);
            return `
            <tr>
                <td>${escapeHtml(fmtDate(entry.date))}</td>
                <td class="mono">${escapeHtml(displayIdOf(entry))}</td>
                <td>${escapeHtml(entry.description || '')}</td>
                <td class="num">${fmtUsd(t.debit)}</td>
                <td class="num">${fmtUsd(t.credit)}</td>
                <td>${escapeHtml(entry.status === 'Draft' ? 'Draft' : 'Posted')}</td>
            </tr>`;
        }).join('');
        const grand = filteredEntries.reduce((s, e) => s + entryTotals(e).debit, 0);
        openPrintWindow('Journal Entries', `
  <h1>Romdoul ERP System Solution — Journal Entries</h1>
  <div class="muted">${filteredEntries.length} ${filteredEntries.length === 1 ? 'entry' : 'entries'} · Printed ${new Date().toLocaleString()}</div>
  <table>
    <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th class="num">Debits</th><th class="num">Credits</th><th>Status</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td class="num">${fmtUsd(grand)}</td><td class="num">${fmtUsd(grand)}</td><td></td></tr></tfoot>
  </table>`);
    };

    const exportCsv = () => {
        const cell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const head = ['Date', 'Reference', 'Description', 'Debits', 'Credits', 'Status'];
        const body = filteredEntries.map(entry => {
            const t = entryTotals(entry);
            return [String(entry.date).slice(0, 10), displayIdOf(entry), entry.description || '', t.debit.toFixed(2), t.credit.toFixed(2), entry.status === 'Draft' ? 'Draft' : 'Posted'].map(cell).join(',');
        });
        const blob = new Blob(['﻿' + [head.map(cell).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `journal-entries-${dayKeyFromDate(new Date())}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
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

        if (statusFilter !== 'All') {
            result = result.filter(e => (e.status === 'Draft' ? 'Draft' : 'Posted') === statusFilter);
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(entry =>
                (entry.description?.toLowerCase().includes(q)) ||
                (entry.reference_id?.toLowerCase().includes(q)) ||
                (entry.entry_number?.toLowerCase().includes(q)) ||
                (entry.id.toLowerCase().includes(q))
            );
        }

        return result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [journalEntries, searchQuery, dateRange, statusFilter]);

    // Summary cards: totals over the filtered view, so they track Date/Status/Search.
    const counts = useMemo(() => {
        const draft = filteredEntries.filter(e => e.status === 'Draft').length;
        return { total: filteredEntries.length, posted: filteredEntries.length - draft, draft };
    }, [filteredEntries]);
    const filtersActive = !!(searchQuery.trim() || dateRange.start || dateRange.end || statusFilter !== 'All');

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)' }}>
            {/* Actions (top right, like the reference design) */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
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

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '20px' }}>
                {([
                    [`Total Entries${filtersActive ? ' (Filtered)' : ''}`, counts.total, 'var(--color-text-main)'],
                    [`Posted${filtersActive ? ' (Filtered)' : ''}`, counts.posted, '#4c5fd0'],
                    [`Draft${filtersActive ? ' (Filtered)' : ''}`, counts.draft, '#D97706'],
                ] as const).map(([label, value, color]) => (
                    <div key={label} style={{ background: 'var(--color-surface)', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px' }}>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>{label}</div>
                        <div style={{ fontSize: '26px', fontWeight: 800, color, marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>{isLoading ? '…' : value}</div>
                    </div>
                ))}
            </div>

            {/* Filters: From / To / Status / Search — with Print list & Export CSV on the right */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <DateRangePicker value={dateRange} onChange={setDateRange} />
                <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' }}>Status</label>
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as 'All' | 'Posted' | 'Draft')}
                        style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)', cursor: 'pointer' }}
                    >
                        <option value="All">All statuses</option>
                        <option value="Posted">Posted</option>
                        <option value="Draft">Draft</option>
                    </select>
                </div>
                <div style={{ flex: '1 1 200px', maxWidth: '340px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' }}>Search</label>
                    <div style={{ position: 'relative' }}>
                        <Search size={15} color="#8792a2" style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)' }} />
                        <input
                            type="text"
                            placeholder="Search..."
                            style={{ width: '100%', padding: '8px 12px 8px 33px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)', boxSizing: 'border-box' }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
                {(dateRange.start || dateRange.end || searchQuery || statusFilter !== 'All') && (
                    <button
                        onClick={() => { setDateRange({ start: '', end: '' }); setSearchQuery(''); setStatusFilter('All'); }}
                        style={{ padding: '8px 12px', borderRadius: '8px', fontSize: '13px', color: '#ef4444', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 500 }}
                    >
                        Clear
                    </button>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                        onClick={printList}
                        disabled={isLoading || filteredEntries.length === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (isLoading || filteredEntries.length === 0) ? 0.5 : 1 }}
                    >
                        <Printer size={14} /> Print list
                    </button>
                    <button
                        onClick={exportCsv}
                        disabled={isLoading || filteredEntries.length === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (isLoading || filteredEntries.length === 0) ? 0.5 : 1 }}
                    >
                        <Download size={14} /> Export CSV
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
                            const t = entryTotals(entry);
                            const isDraft = entry.status === 'Draft';
                            return (
                                <div key={entry.id} style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
                                        <span style={{ fontWeight: 600, color: '#5469d4', fontSize: '12px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayIdOf(entry)}</span>
                                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', flexShrink: 0 }}>{fmtDate(entry.date)}</span>
                                    </div>
                                    <div className="d2-khmer" style={{ fontSize: '13px', color: 'var(--color-text-main)', margin: '4px 0 6px', fontWeight: 500 }}>
                                        {entry.description || 'No Description'}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(t.debit)}</span>
                                            {statusChip(entry.status || 'Posted')}
                                        </span>
                                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                                            <ActionBtn icon={Eye} label="View" onClick={() => setViewEntry(entry)} />
                                            <ActionBtn icon={Printer} label="Print" onClick={() => printEntry(entry)} />
                                            {isDraft && (
                                                <>
                                                    <ActionBtn icon={Pencil} label="Edit" onClick={() => openEdit(entry)} />
                                                    <ActionBtn icon={CheckCircle2} label="Post" onClick={() => postEntry(entry.id)} color="#4c5fd0" />
                                                    <ActionBtn icon={Trash2} label="Delete" onClick={() => deleteDraft(entry.id)} color="#ef4444" />
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
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '860px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none' }}>Date</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none' }}>Reference</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none' }}>Description</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none', textAlign: 'right' }}>Debits</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none', textAlign: 'right' }}>Credits</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none' }}>Status</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading entries...</td></tr>
                        ) : filteredEntries.length === 0 ? (
                            <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No entries found</td></tr>
                        ) : (
                            filteredEntries.map(entry => {
                                const t = entryTotals(entry);
                                const isDraft = entry.status === 'Draft';
                                return (
                                    <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9', background: 'var(--color-surface)', transition: 'background 0.2s' }}>
                                        <td style={{ padding: '14px 20px', color: 'var(--color-text-main)', whiteSpace: 'nowrap' }}>
                                            {fmtDate(entry.date)}
                                        </td>
                                        <td style={{ padding: '14px 20px', color: 'var(--color-text-secondary)', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'nowrap', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={displayIdOf(entry)}>
                                            {displayIdOf(entry)}
                                        </td>
                                        <td className="d2-khmer" style={{ padding: '14px 20px', color: 'var(--color-text-main)', fontWeight: '500', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.description || ''}>
                                            {entry.description || 'No Description'}
                                        </td>
                                        <td style={{ padding: '14px 20px', fontWeight: 700, textAlign: 'right', color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                            {fmtUsd(t.debit)}
                                        </td>
                                        <td style={{ padding: '14px 20px', fontWeight: 700, textAlign: 'right', color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                            {fmtUsd(t.credit)}
                                        </td>
                                        <td style={{ padding: '14px 20px' }}>
                                            {statusChip(entry.status || 'Posted')}
                                        </td>
                                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                <ActionBtn icon={Eye} label="View" onClick={() => setViewEntry(entry)} />
                                                <ActionBtn icon={Printer} label="Print" onClick={() => printEntry(entry)} />
                                                {isDraft && (
                                                    <>
                                                        <ActionBtn icon={Pencil} label="Edit" onClick={() => openEdit(entry)} />
                                                        <ActionBtn icon={CheckCircle2} label="Post" onClick={() => postEntry(entry.id)} color="#4c5fd0" />
                                                        <ActionBtn icon={Trash2} label="Delete" onClick={() => deleteDraft(entry.id)} color="#ef4444" />
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

            {/* View entry */}
            <Modal isOpen={!!viewEntry} onClose={() => setViewEntry(null)} title="Journal Entry">
                {viewEntry && (() => {
                    const t = entryTotals(viewEntry);
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: '6px', fontSize: '13px' }}>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Reference</span>
                                <span style={{ color: 'var(--color-text-main)', fontFamily: 'monospace', fontSize: '12px' }}>{displayIdOf(viewEntry)}</span>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Date</span>
                                <span style={{ color: 'var(--color-text-main)' }}>{fmtDate(viewEntry.date)}</span>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Status</span>
                                <span>{statusChip(viewEntry.status || 'Posted')}</span>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Description</span>
                                <span className="d2-khmer" style={{ color: 'var(--color-text-main)' }}>{viewEntry.description || '—'}</span>
                            </div>
                            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid #e2e8f0' }}>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Account</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)', width: '110px' }}>Debit</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)', width: '110px' }}>Credit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(viewEntry.lines || []).map((l, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td
                                                    className={l.account ? 'd2-khmer hover-highlight' : 'd2-khmer'}
                                                    onClick={l.account ? () => navigate(`/accounting/general-ledger?account=${l.account_id}`) : undefined}
                                                    title={l.account ? 'View in General Ledger' : undefined}
                                                    style={{ padding: '8px 12px', color: 'var(--color-text-main)', cursor: l.account ? 'pointer' : 'default' }}
                                                >{accountLabelOf(l)}</td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (l.debit || 0) > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{(l.debit || 0) > 0 ? fmtUsd(l.debit || 0) : '—'}</td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (l.credit || 0) > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{(l.credit || 0) > 0 ? fmtUsd(l.credit || 0) : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ background: 'var(--color-bg)', fontWeight: 700 }}>
                                            <td style={{ padding: '8px 12px', color: 'var(--color-text-main)' }}>Total</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{fmtUsd(t.debit)}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)' }}>{fmtUsd(t.credit)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button
                                    onClick={() => printEntry(viewEntry)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#5469d4', color: 'white', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                                >
                                    <Printer size={15} /> Print
                                </button>
                                <button
                                    onClick={() => setViewEntry(null)}
                                    style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </Modal>

            <Modal
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setEditingEntryId(null); }}
                title={editingEntryId ? 'Edit Journal Entry' : 'Create Journal Entry'}
                width="820px"
            >
                {(() => {
                    const fieldLabel: React.CSSProperties = { display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-main)' };
                    const fieldInput: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none', boxSizing: 'border-box', fontSize: '14px', background: 'var(--color-surface)', color: 'var(--color-text-main)' };
                    const cellInput: React.CSSProperties = { width: '100%', padding: '9px 10px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none', boxSizing: 'border-box', background: 'var(--color-surface)', color: 'var(--color-text-main)' };
                    const thCell: React.CSSProperties = { padding: '10px 10px', textAlign: 'left', fontWeight: 600, fontSize: '13px', color: 'var(--color-text-main)' };
                    // Balanced whenever debits equal credits (an empty form counts, like the mock).
                    const balancedNow = totalDebit === totalCredit;
                    const accent = balancedNow ? '#2742c9' : '#DC2626';
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', padding: '8px 0' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 170px', gap: '16px' }}>
                                <div>
                                    <label style={fieldLabel}>Transaction Date</label>
                                    <input type="date" style={fieldInput} value={date} onChange={(e) => setDate(e.target.value)} />
                                </div>
                                <div>
                                    <label style={fieldLabel}>Reference/JV Number</label>
                                    <input type="text" style={fieldInput} value={referenceId} onChange={(e) => setReferenceId(e.target.value)} placeholder="e.g., JE-001" />
                                </div>
                                <div>
                                    <label style={fieldLabel}>Status</label>
                                    <select style={{ ...fieldInput, cursor: 'pointer' }} value={entryStatus} onChange={(e) => setEntryStatus(e.target.value as 'Posted' | 'Draft')}>
                                        <option value="Posted">Posted</option>
                                        <option value="Draft">Draft</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label style={fieldLabel}>Description</label>
                                <input type="text" className="d2-khmer" style={fieldInput} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the transaction..." />
                            </div>

                            {/* Live balance banner — blue when debits equal credits, red otherwise. */}
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                                padding: '12px 16px', borderRadius: '10px',
                                border: `1.5px solid ${accent}`,
                                background: `color-mix(in srgb, ${accent} 6%, var(--color-surface))`
                            }}>
                                <div>
                                    <div style={{ fontSize: '14px', fontWeight: 700, color: accent, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        {balancedNow ? <>✓ Entry Balanced</> : <>Entry Not Balanced</>}
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                                        Debits: {totalDebit.toFixed(2)} | Credits: {totalCredit.toFixed(2)}
                                        {!balancedNow && <> · difference {Math.abs(totalDebit - totalCredit).toFixed(2)}</>}
                                    </div>
                                </div>
                                {balancedNow
                                    ? <Check size={20} color={accent} style={{ flexShrink: 0 }} />
                                    : <AlertTriangle size={20} color={accent} style={{ flexShrink: 0 }} />}
                            </div>

                            {/* Line items */}
                            <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <th style={thCell}>Account</th>
                                                <th style={thCell}>Description</th>
                                                <th style={{ ...thCell, textAlign: 'right', width: '110px' }}>Debit</th>
                                                <th style={{ ...thCell, textAlign: 'right', width: '110px' }}>Credit</th>
                                                <th style={{ ...thCell, textAlign: 'center', width: '56px' }}>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {lines.map((line, index) => (
                                                <tr key={index} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                    <td style={{ padding: '8px 10px', minWidth: '180px' }}>
                                                        <select
                                                            className="d2-khmer"
                                                            style={{ ...cellInput, cursor: 'pointer' }}
                                                            value={line.account_id}
                                                            onChange={(e) => updateLine(index, 'account_id', e.target.value)}
                                                        >
                                                            <option value="">Select account...</option>
                                                            {activeAccounts.map(acc => (
                                                                <option key={acc.id} value={acc.id}>{acc.account_code} - {acc.account_name}</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td style={{ padding: '8px 10px', minWidth: '150px' }}>
                                                        <input
                                                            type="text"
                                                            className="d2-khmer"
                                                            style={cellInput}
                                                            value={line.description || ''}
                                                            onChange={(e) => updateLine(index, 'description', e.target.value)}
                                                            placeholder="Line description"
                                                        />
                                                    </td>
                                                    <td style={{ padding: '8px 10px' }}>
                                                        <input
                                                            type="number"
                                                            style={{ ...cellInput, textAlign: 'right' }}
                                                            value={line.debit || ''}
                                                            min="0"
                                                            placeholder="0.00"
                                                            onChange={(e) => updateLine(index, 'debit', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </td>
                                                    <td style={{ padding: '8px 10px' }}>
                                                        <input
                                                            type="number"
                                                            style={{ ...cellInput, textAlign: 'right' }}
                                                            value={line.credit || ''}
                                                            min="0"
                                                            placeholder="0.00"
                                                            onChange={(e) => updateLine(index, 'credit', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                                        <button
                                                            onClick={() => removeLine(index)}
                                                            disabled={lines.length <= 2}
                                                            title={lines.length > 2 ? 'Remove line' : 'An entry needs at least two lines'}
                                                            style={{
                                                                background: 'none', border: 'none', cursor: lines.length > 2 ? 'pointer' : 'not-allowed',
                                                                color: lines.length > 2 ? '#ef7a7a' : 'var(--color-border)',
                                                                padding: '4px'
                                                            }}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ background: 'var(--color-bg)' }}>
                                                <td colSpan={2} style={{ padding: '12px 10px', fontWeight: 700, fontSize: '13px', color: 'var(--color-text-main)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Total</td>
                                                <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, fontSize: '13px', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)', whiteSpace: 'nowrap' }}>USD {totalDebit.toFixed(2)}</td>
                                                <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, fontSize: '13px', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-main)', whiteSpace: 'nowrap' }}>USD {totalCredit.toFixed(2)}</td>
                                                <td></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            <button
                                onClick={addLine}
                                style={{
                                    width: '100%', padding: '14px', fontSize: '13.5px', fontWeight: 600,
                                    borderRadius: '10px', border: 'none', background: 'var(--color-bg)',
                                    color: 'var(--color-text-main)', cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                                }}
                            >
                                <Plus size={16} /> Add Line Item
                            </button>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '4px' }}>
                                <button
                                    onClick={() => { setIsModalOpen(false); setEditingEntryId(null); }}
                                    style={{ padding: '10px 18px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)', fontWeight: 600, fontSize: '13.5px', cursor: 'pointer' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={!isFormValid}
                                    style={{ padding: '10px 18px', borderRadius: '8px', border: 'none', background: '#2742c9', color: 'white', fontWeight: 600, fontSize: '13.5px', cursor: isFormValid ? 'pointer' : 'not-allowed', opacity: (!isFormValid) ? 0.55 : 1 }}
                                >
                                    {editingEntryId ? 'Save Changes' : 'Create Entry'}
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </Modal>
        </div>
    );
};

export default JournalEntriesPage;
