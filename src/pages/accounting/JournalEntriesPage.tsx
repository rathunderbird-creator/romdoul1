import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Search, ArrowDownToLine, Eye, Printer, Pencil, CheckCircle2, Download, Check, AlertTriangle } from 'lucide-react';
import { useMobile } from '../../hooks/useMobile';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../context/StoreContext';
import { Modal } from '../../components';
import DateRangePicker from '../../components/DateRangePicker';
import FilterDropdown from '../../components/FilterDropdown';
import { useAccounting } from '../../hooks/useAccounting';
import { usePersistedDateRange } from '../../hooks/usePersistedDateRange';
import { supabase } from '../../lib/supabase';
import { nextJournalEntryNumber, entryDescription, type JournalEntryTypeCode } from '../../utils/journalEntryNumber';
import { pickCashBankAccount } from '../../utils/cashBankAccounts';
import { insertJournalLines } from '../../utils/journalEntryLines';
import { fetchAll } from '../../utils/fetchAll';
import { fetchLedgerStartDate, isBeforeLedgerStart, formatLedgerStart } from '../../utils/ledgerStart';
import { useColumnWidths } from '../pageIncomePrediction/useColumnWidths';
// Brings the .pip-resize-handle grip styling the shared hook's handles rely on.
import '../pageIncomePrediction/pageIncomePrediction.css';
import { dayKeyFromDate } from '../../utils/dateRange';
import type { JournalEntry, JournalEntryLine } from '../../types';

// Height of every control in the filter bar (the Area dropdown and the Print / Export buttons are 36px).
const FILTER_H = 36;

// .in()/.delete() batch size for bulk unpost/delete — well under PostgREST's URL limit.
const CHUNK = 150;
const chunk = <T,>(items: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
};

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

// An entry written by a payment flow (Customer Payment, Procurement or
// Wholesale) carries a reference_id of TX-<transaction id> — same test
// Revenue/Expense uses for its own AUTO/MANUAL chip.
const isSystemEntry = (entry: JournalEntry) => (entry.reference_id || '').startsWith('TX-');

// Same AUTO (blue) / MANUAL (amber) pair as Revenue and Expense, so the same
// word means the same thing — and the same color — on every ledger page.
const originChip = (isSystem: boolean) => (
    <span
        title={isSystem
            ? 'Created automatically by a payment flow (Retail Payment, Procurement or Wholesale).'
            : 'Recorded directly on this page.'}
        style={{
            fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap',
            color: isSystem ? '#1D4ED8' : '#B45309',
            background: isSystem ? 'rgba(37, 99, 235, 0.12)' : 'rgba(217, 119, 6, 0.12)',
            cursor: 'help', textTransform: 'uppercase', letterSpacing: '0.4px',
        }}>{isSystem ? 'auto' : 'manual'}</span>
);

// ── Business-area filter: with thousands of retail receipts in the ledger,
// a type filter is the only way the rest stays findable. The area comes from
// the entry_number's type code (JE-<n>-<TYPE>-…); rows from before that
// migration fall back to reference/description markers the posting flows
// write, and plain manual entries land in Manual. ──
// "General" (not "Manual") to avoid colliding with the amber auto/manual
// ORIGIN chip: general-journal entries booked right on this page, versus
// rows that originate in the retail/wholesale/purchase/expense flows.
const AREA_LABELS = ['Retail', 'Wholesale', 'Purchases', 'Payments', 'Rev & Exp', 'General', 'Other'] as const;
type Area = typeof AREA_LABELS[number];
const CODE_AREA: Record<string, Area> = {
    RCP: 'Retail', DEP: 'Retail', DLV: 'Retail',
    WSP: 'Wholesale',
    PUR: 'Purchases', GRN: 'Purchases', OPA: 'Purchases', ADJ: 'Purchases',
    SPP: 'Payments', PAY: 'Payments',
    REV: 'Rev & Exp', EXP: 'Rev & Exp',
    MAN: 'General',
};
const areaOf = (e: JournalEntry): Area => {
    const m = /^JE-\d+-([A-Z]+)-/.exec(e.entry_number || '');
    if (m && CODE_AREA[m[1]]) return CODE_AREA[m[1]];
    const ref = e.reference_id || '';
    if (ref.startsWith('WSO-')) return 'Wholesale';
    if (ref.startsWith('ORD-')) return 'Retail';
    // Revenue & Expense's default machine reference, for rows from before
    // the entry_number migration (which doesn't backfill).
    if (ref.startsWith('REV-') || ref.startsWith('EXP-')) return 'Rev & Exp';
    // Imported legacy entries (TX-…) carry the flow marker in their description.
    const d = e.description || '';
    if (d.includes('#SPP-') || d.includes('#PAY-')) return 'Payments';
    if (d.includes('#WSP-')) return 'Wholesale';
    return isSystemEntry(e) ? 'Other' : 'General';
};

// Rows rendered per "Show more" click — exports and summary cards still
// cover the whole filtered set.
const PAGE_SIZE = 100;

const JournalEntriesPage = () => {
    const isMobile = useMobile();
    const navigate = useNavigate();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { currentUser } = useStore();
    // Unposting rewinds finalized books, so it stays admin-only — same gate
    // as Customer Payment's and Revenue/Expense's bulk Unpost.
    const isAdmin = currentUser?.roleId === 'admin';
    const { journalEntries, accounts, isLoading, fetchJournalEntries, patchJournalEntry, fetchAccounts, saveJournalEntry } = useAccounting();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSavingEntry, setIsSavingEntry] = useState(false);
    const savingEntryRef = useRef(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = usePersistedDateRange('journal_entries_range');
    const [statusFilter, setStatusFilter] = useState<'All' | 'Posted' | 'Draft'>('All');
    const [originFilter, setOriginFilter] = useState<'All' | 'Auto' | 'Manual'>('All');
    // Multi-select dropdown: empty set = all areas. Ticking an option
    // toggles its area in and out of the view.
    const [areaFilters, setAreaFilters] = useState<ReadonlySet<Area>>(new Set());
    const toggleAreaFilter = (a: Area) => setAreaFilters(prev => {
        const n = new Set(prev);
        if (n.has(a)) n.delete(a); else n.add(a);
        return n;
    });
    // How many filtered rows are rendered; resets whenever the view changes.
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
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
    const [importPreview, setImportPreview] = useState<{ candidates: ImportCandidate[]; skipped: number; beforeStart: number; start: string | null } | null>(null);

    const prepareImport = async () => {
        setImporting(true);
        try {
            type Raw = Record<string, unknown>;
            // Paged with the unique id breaking date ties (payments share one
            // UTC-midnight date), and merged by id, so rows can't repeat or be
            // skipped between pages.
            const txs = await fetchAll<Raw>((from, to) => supabase
                .from('transactions')
                .select('id, date, type, category, amount, description, pay_by')
                .order('date', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to), 1000, { label: 'JournalEntriesPage.prepareImport transactions' });
            // The already-booked check must see EVERY TX-% reference — retail
            // receipts use TX- too, so there are thousands of matches and an
            // unpaged read tops out at ~1000, re-offering imported entries.
            const existing = await fetchAll<{ id: string; reference_id: string | null }>((from, to) => supabase
                .from('journal_entries')
                .select('id, reference_id')
                .like('reference_id', 'TX-%')
                .order('id', { ascending: true })
                .range(from, to), 1000, { label: 'JournalEntriesPage.prepareImport existing' });
            const alreadyImported = new Set(existing.map(r => String(r.reference_id)));

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
            // Shared method-aware matcher — same resolution the live posting
            // flows use, so an import lands in the same account a direct post
            // would have. Revenue (wholesale receipts) defaults to the bank
            // account; outflows (supplier payments, payroll) stay method-aware.
            const cashFor = (payBy: string, isRevenue: boolean) => pickCashBankAccount(pool, payBy, { preferBank: isRevenue });

            // The ledger starts at this store's opening stock count; older
            // operations stay in Income & Expense (see utils/ledgerStart.ts).
            const start = await fetchLedgerStartDate();
            const candidates: ImportCandidate[] = [];
            let skipped = 0;
            let beforeStart = 0;
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
                if (isBeforeLedgerStart(String(t.date).slice(0, 10), start)) { beforeStart++; continue; }
                const cash = cashFor(String(t.pay_by || ''), source === 'Wholesale receipt');
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
            setImportPreview({ candidates, skipped, beforeStart, start });
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
                // Supplier/wholesale candidates lead with the counterparty
                // ('{Name} · PO-… #SPP-…'); the unified format echoes just that
                // name. Payroll (no business area) keeps the fuller text.
                const counterparty = c.description.split(' · ')[0].trim();
                const payload: Record<string, unknown> = {
                    date: c.date,
                    description: entryDescription(entryNumber, counterparty) || c.description,
                    reference_id: 'TX-' + c.txId,
                    status: 'Draft'
                };
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
                const lineDescs = c.source === 'Wholesale receipt'
                    ? { debit: `Receipt — ${counterparty}`, credit: `Sales — ${counterparty}` }
                    : c.source === 'Supplier payment'
                        ? { debit: /payable/i.test(c.debitLabel) ? `Settle payable — ${counterparty}` : `Purchase — ${counterparty}`, credit: `Payment — ${counterparty}` }
                        : { debit: `Payroll — ${counterparty}`, credit: `Payment — ${counterparty}` };
                const { error: lErr } = await insertJournalLines([
                    { journal_entry_id: entry.id, account_id: c.debitId, debit: c.amount, credit: 0, description: lineDescs.debit },
                    { journal_entry_id: entry.id, account_id: c.creditId, debit: 0, credit: c.amount, description: lineDescs.credit },
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

    // Entries mid-post/mid-delete, so a double-click — or a bulk action
    // racing a single-row one on the same entry — can't fire twice.
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    const markBusy = (id: string, busy: boolean) => setBusyIds(prev => {
        const n = new Set(prev);
        if (busy) n.add(id); else n.delete(id);
        return n;
    });
    // Bulk checkbox selection (derived values and handlers are defined below,
    // once filteredEntries exists).
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBulkUnposting, setIsBulkUnposting] = useState(false);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);

    // Resizable list columns — same drag pattern (and localStorage persistence)
    // as the prediction tables'. The select-all checkbox column stays fixed.
    const { widthStyle, resizeHandle, totalWidth } = useColumnWidths('je_list', {
        date: 110, reference: 200, description: 340, debits: 110, credits: 110, status: 160, actions: 180,
    });

    // Delete a Draft entry (anyone), or an already-Posted one (admin only —
    // same gate as Unpost, since it changes finalized books). Edit/Post stay
    // Draft-only (unchanged below); only Delete is widened.
    const handleDelete = async (entry: JournalEntry) => {
        const entryId = entry.id;
        if (entry.status !== 'Draft' && !isAdmin) { showToast('Posted entries can only be deleted by an admin — unpost it first, or ask an admin.', 'info'); return; }
        if (busyIds.has(entryId)) return;
        const postedWarn = entry.status !== 'Draft' ? ' This entry is already Posted — deleting it changes the finalized books.' : '';
        if (!confirm(`Delete this entry? Its lines are removed too.${postedWarn}`)) return;
        markBusy(entryId, true);
        try {
            const { error: lErr } = await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', entryId);
            if (lErr) throw lErr;
            const { error } = await supabase.from('journal_entries').delete().eq('id', entryId);
            if (error) throw error;
            // The entry just deleted may be the one open in the edit modal.
            if (editingEntryId === entryId) { setIsModalOpen(false); setEditingEntryId(null); }
            showToast('Entry deleted', 'success');
            fetchJournalEntries();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed to delete entry: ' + msg, 'error');
        } finally {
            markBusy(entryId, false);
        }
    };

    // Manually post a draft entry.
    const postEntry = async (entryId: string) => {
        if (busyIds.has(entryId)) return;
        markBusy(entryId, true);
        try {
            const { error } = await supabase.from('journal_entries').update({ status: 'Posted' }).eq('id', entryId);
            if (error) throw error;
            showToast('Entry posted', 'success');
            // Only the status changed — update that one row in place instead of
            // refetching the whole ledger (which flashes the table's loading state).
            patchJournalEntry(entryId, { status: 'Posted' });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast(/status/i.test(msg)
                ? 'Posting needs migrations/add_entry_status.sql on this instance'
                : 'Failed to post entry: ' + msg, 'error');
        } finally {
            markBusy(entryId, false);
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
        if (!isFormValid || savingEntryRef.current) return;
        savingEntryRef.current = true;
        setIsSavingEntry(true);
        try {
            await persistEntry();
        } finally {
            savingEntryRef.current = false;
            setIsSavingEntry(false);
        }
    };

    const persistEntry = async () => {
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
                <td>${escapeHtml(l.description || '')}</td>
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
    <thead><tr><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
    <tbody>${linesHtml}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td class="num">${fmtUsd(totals.debit)}</td><td class="num">${fmtUsd(totals.credit)}</td></tr></tfoot>
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

    // Everything except the area filter — its counts come from this set, so
    // each option shows what it would leave visible under the other filters.
    const baseFiltered = useMemo(() => {
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

        if (originFilter !== 'All') {
            result = result.filter(e => (originFilter === 'Auto' ? isSystemEntry(e) : !isSystemEntry(e)));
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

        // Same-day entries need a tiebreaker: `date` is a plain YYYY-MM-DD, so
        // every entry dated today compares equal and the newest one (e.g. the
        // highest entry_number) isn't guaranteed to land first. created_at is
        // a real timestamp and always distinct.
        return [...result].sort((a, b) => {
            const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
            if (dateDiff !== 0) return dateDiff;
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        });
    }, [journalEntries, searchQuery, dateRange, statusFilter, originFilter]);

    const areaCounts = useMemo(() => {
        const c: Partial<Record<Area, number>> = {};
        for (const e of baseFiltered) {
            const a = areaOf(e);
            c[a] = (c[a] || 0) + 1;
        }
        return c;
    }, [baseFiltered]);

    // Which areas exist in the whole journal (ignoring every filter): those
    // options stay listed — dimmed when the current filters leave them at 0 —
    // so the menu doesn't reflow under the pointer while typing a search
    // or narrowing dates. Areas this business never books stay hidden.
    const existingAreas = useMemo(() => {
        const s = new Set<Area>();
        for (const e of journalEntries) s.add(areaOf(e));
        return s;
    }, [journalEntries]);

    const filteredEntries = useMemo(
        () => areaFilters.size === 0 ? baseFiltered : baseFiltered.filter(e => areaFilters.has(areaOf(e))),
        [baseFiltered, areaFilters]
    );

    // A changed view starts back at the first page — adjusted during render
    // (not in an effect), so a "Show all" depth never commits one frame of
    // thousands of rows against the new filter before resetting.
    const filterSig = `${searchQuery}\u0000${dateRange.start}\u0000${dateRange.end}\u0000${statusFilter}\u0000${originFilter}\u0000${[...areaFilters].sort().join(',')}`;
    const [lastFilterSig, setLastFilterSig] = useState(filterSig);
    if (filterSig !== lastFilterSig) {
        setLastFilterSig(filterSig);
        setVisibleCount(PAGE_SIZE);
    }

    const visibleEntries = useMemo(() => filteredEntries.slice(0, visibleCount), [filteredEntries, visibleCount]);

    // Selection never outlives the rendered rows: a filter or page change
    // that hides a row also deselects it, so the bulk bar can't hold rows
    // that aren't on screen anywhere.
    useEffect(() => {
        setSelectedIds(prev => {
            if (prev.size === 0) return prev;
            const visible = new Set(visibleEntries.map(e => e.id));
            const kept = new Set<string>();
            prev.forEach(id => { if (visible.has(id)) kept.add(id); });
            return kept.size === prev.size ? prev : kept;
        });
    }, [visibleEntries]);

    // Summary cards: totals over the filtered view, so they track Date/Status/Search.
    const counts = useMemo(() => {
        const draft = filteredEntries.filter(e => e.status === 'Draft').length;
        return { total: filteredEntries.length, posted: filteredEntries.length - draft, draft };
    }, [filteredEntries]);
    const filtersActive = !!(searchQuery.trim() || dateRange.start || dateRange.end || statusFilter !== 'All' || originFilter !== 'All' || areaFilters.size > 0);

    // ── Bulk checkbox selection: Unpost (admin-only, Posted rows) / Delete
    // (Draft rows for anyone, Posted rows admin-only — same split as the
    // single-row action above). Matches this page's existing rule that
    // Auto/Manual origin makes no difference to what can be mutated. ──
    // Derived from visibleEntries (not filteredEntries) so bulk actions can
    // only ever target rendered rows, even in the render before the pruning
    // effect above has run.
    const selectedRows = useMemo(
        () => selectedIds.size === 0 ? [] : visibleEntries.filter(e => selectedIds.has(e.id)),
        [selectedIds, visibleEntries]
    );
    // A row already mid-post/mid-delete via its own single-row action can't
    // also be a bulk target — excluded here, not just from new picks
    // (selectableIds, below), or a concurrent bulk+single action could race.
    const selectedDeletableRows = useMemo(
        () => selectedRows.filter(e => !busyIds.has(e.id) && (e.status === 'Draft' || isAdmin)),
        [selectedRows, busyIds, isAdmin]
    );
    const selectedPostedRows = useMemo(
        () => selectedRows.filter(e => !busyIds.has(e.id) && e.status !== 'Draft'),
        [selectedRows, busyIds]
    );
    // Select-all covers only the rendered rows — never entries hidden behind
    // "Show more", so a bulk Delete/Unpost can't grab rows nobody has seen.
    const selectableIds = useMemo(() => visibleEntries.filter(e => !busyIds.has(e.id)).map(e => e.id), [visibleEntries, busyIds]);
    const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));
    const someSelected = selectableIds.some(id => selectedIds.has(id));

    const toggleSelect = (id: string) => setSelectedIds(prev => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
    });
    const toggleSelectAll = () => setSelectedIds(prev => {
        const n = new Set(prev);
        if (allSelected) selectableIds.forEach(id => n.delete(id));
        else selectableIds.forEach(id => n.add(id));
        return n;
    });

    const handleBulkUnpost = async () => {
        const targets = selectedPostedRows;
        if (!isAdmin || targets.length === 0 || isBulkUnposting) return;
        if (!confirm(`Return ${targets.length} posted ${targets.length === 1 ? 'entry' : 'entries'} to Draft?\nThey can then be corrected and posted again.`)) return;
        setIsBulkUnposting(true);
        const ids = targets.map(e => e.id);
        setBusyIds(prev => new Set([...prev, ...ids]));
        let allIds = ids;
        try {
            // A TX-<id> receipt entry may have a paired ORD-<orderId>-COGS
            // companion entry (Customer Payment's full-coverage-deposit
            // postings — see postRetailCogsOnlyEntry in StoreContext.tsx) —
            // unposting only the receipt half would misstate the books (cost
            // booked against revenue that's now Draft), so pull any Posted
            // companion back to Draft with it, same as Customer Payment's own
            // bulk Unpost already does for this exact pairing.
            const txIds = targets.filter(e => isSystemEntry(e)).map(e => (e.reference_id || '').slice(3));
            if (txIds.length > 0) {
                const { data: txRows, error: txErr } = await supabase.from('transactions').select('id, order_id').in('id', txIds);
                if (txErr) throw txErr;
                const orderIds = Array.from(new Set((txRows || []).map((t: { order_id?: string | null }) => t.order_id).filter((id): id is string => !!id)));
                if (orderIds.length > 0) {
                    const companionRefs = orderIds.map(id => `ORD-${id}-COGS`);
                    const { data: companions, error: compErr } = await supabase.from('journal_entries').select('id').in('reference_id', companionRefs).eq('status', 'Posted');
                    if (compErr) throw compErr;
                    const companionIds = (companions || []).map((c: { id: string }) => c.id);
                    if (companionIds.length > 0) {
                        allIds = Array.from(new Set([...ids, ...companionIds]));
                        setBusyIds(prev => new Set([...prev, ...companionIds]));
                    }
                }
            }
            for (const batch of chunk(allIds, CHUNK)) {
                const { error } = await supabase.from('journal_entries').update({ status: 'Draft' }).in('id', batch);
                if (error) throw error;
            }
            const extra = allIds.length - ids.length;
            showToast(`Returned ${targets.length} ${targets.length === 1 ? 'entry' : 'entries'} to Draft${extra > 0 ? ` (plus ${extra} linked COGS ${extra === 1 ? 'entry' : 'entries'})` : ''}`, 'success');
            setSelectedIds(prev => { const n = new Set(prev); allIds.forEach(id => n.delete(id)); return n; });
            fetchJournalEntries();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast(/status/i.test(msg)
                ? 'Unposting needs migrations/add_entry_status.sql on this instance'
                : 'Failed to unpost: ' + msg, 'error');
            fetchJournalEntries();
        } finally {
            setBusyIds(prev => { const n = new Set(prev); allIds.forEach(id => n.delete(id)); return n; });
            setIsBulkUnposting(false);
        }
    };

    const handleBulkDelete = async () => {
        const targets = selectedDeletableRows;
        if (targets.length === 0 || isBulkDeleting) return;
        const postedCount = targets.filter(e => e.status !== 'Draft').length;
        const warn = postedCount > 0 ? `\n${postedCount} ${postedCount === 1 ? 'is' : 'are'} already Posted — deleting them changes the finalized books.` : '';
        if (!confirm(`Delete ${targets.length} ${targets.length === 1 ? 'entry' : 'entries'}? Their lines are removed too.${warn}`)) return;
        setIsBulkDeleting(true);
        const ids = targets.map(e => e.id);
        setBusyIds(prev => new Set([...prev, ...ids]));
        try {
            // Lines then entries WITHIN each batch (not two separate passes
            // over the whole selection) — a batch failing after an earlier
            // one succeeded leaves only that one batch's size at risk of a
            // lines-deleted-but-entry-row-left orphan, not the whole selection.
            for (const batch of chunk(ids, CHUNK)) {
                const { error: lineErr } = await supabase.from('journal_entry_lines').delete().in('journal_entry_id', batch);
                if (lineErr) throw lineErr;
                const { error: entryErr } = await supabase.from('journal_entries').delete().in('id', batch);
                if (entryErr) throw entryErr;
            }
            // The entry just deleted may be the one open in the edit modal.
            if (editingEntryId && ids.includes(editingEntryId)) { setIsModalOpen(false); setEditingEntryId(null); }
            showToast(`Deleted ${targets.length} ${targets.length === 1 ? 'entry' : 'entries'}`, 'success');
            setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
            fetchJournalEntries();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed to delete: ' + msg, 'error');
            fetchJournalEntries();
        } finally {
            setBusyIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
            setIsBulkDeleting(false);
        }
    };

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

            {/* Filters: From / To / Status / Origin / Area / Search — with Print list & Export CSV on the right */}
            {/* Every control here is FILTER_H tall so the row lines up. */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' }}>Date</label>
                    <DateRangePicker value={dateRange} onChange={setDateRange} height={FILTER_H} />
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' }}>Status</label>
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as 'All' | 'Posted' | 'Draft')}
                        style={{ height: `${FILTER_H}px`, boxSizing: 'border-box', padding: '0 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)', cursor: 'pointer' }}
                    >
                        <option value="All">All statuses</option>
                        <option value="Posted">Posted</option>
                        <option value="Draft">Draft</option>
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' }}>Origin</label>
                    <select
                        value={originFilter}
                        onChange={e => setOriginFilter(e.target.value as 'All' | 'Auto' | 'Manual')}
                        style={{ height: `${FILTER_H}px`, boxSizing: 'border-box', padding: '0 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)', cursor: 'pointer' }}
                    >
                        <option value="All">Auto &amp; Manual</option>
                        <option value="Auto">Auto only</option>
                        <option value="Manual">Manual only</option>
                    </select>
                </div>
                {/* Business-area filter — multi-select dropdown (none ticked
                    = all). With thousands of retail receipts in the ledger,
                    this is the only way the rest stays findable. No isLoading
                    gate: the page refetches after every post/delete/bulk
                    action, and journalEntries keeps its stale rows during
                    one, so unmounting would just blink the control out and
                    reflow the bar while an active filter kept applying. */}
                {(existingAreas.size > 0 || areaFilters.size > 0) && (
                    <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' }}>Area</label>
                        <FilterDropdown
                            allLabel="All Areas"
                            noun="area"
                            options={AREA_LABELS
                                .filter(a => existingAreas.has(a) || areaFilters.has(a))
                                .map(a => ({
                                    key: a, label: a, count: areaCounts[a] || 0,
                                    title: a === 'General' ? 'General-journal entries recorded directly on this page (New Entry)' : a,
                                }))}
                            selected={areaFilters}
                            onToggle={a => toggleAreaFilter(a as Area)}
                            onClear={() => setAreaFilters(new Set())}
                            emptyTitle="No entries in this area under the current filters"
                        />
                    </div>
                )}
                <div style={{ flex: '1 1 200px', maxWidth: '340px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '5px' }}>Search</label>
                    <div style={{ position: 'relative' }}>
                        <Search size={15} color="#8792a2" style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)' }} />
                        <input
                            type="text"
                            placeholder="Search..."
                            style={{ width: '100%', height: `${FILTER_H}px`, padding: '0 12px 0 33px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none', background: 'var(--color-surface)', color: 'var(--color-text-main)', boxSizing: 'border-box' }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
                {(dateRange.start || dateRange.end || searchQuery || statusFilter !== 'All' || originFilter !== 'All' || areaFilters.size > 0) && (
                    <button
                        onClick={() => { setDateRange({ start: '', end: '' }); setSearchQuery(''); setStatusFilter('All'); setOriginFilter('All'); setAreaFilters(new Set()); }}
                        style={{ height: `${FILTER_H}px`, padding: '0 12px', borderRadius: '8px', fontSize: '13px', color: '#ef4444', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 500 }}
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
                        visibleEntries.map(entry => {
                            const t = entryTotals(entry);
                            const isDraft = entry.status === 'Draft';
                            const canDeleteRow = isDraft || isAdmin;
                            const busy = busyIds.has(entry.id);
                            return (
                                <div key={entry.id} style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', rowGap: '4px' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(entry.id)}
                                                onChange={() => toggleSelect(entry.id)}
                                                disabled={busy}
                                                title={busy ? 'Busy…' : 'Select entry'}
                                                style={{ cursor: busy ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                                            />
                                            <span style={{ fontWeight: 600, color: '#5469d4', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayIdOf(entry)}</span>
                                        </span>
                                        <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', flexShrink: 0 }}>{fmtDate(entry.date)}</span>
                                    </div>
                                    <div className="d2-khmer" style={{ fontSize: '13px', color: 'var(--color-text-main)', margin: '4px 0 6px', fontWeight: 500 }}>
                                        {entry.description || 'No Description'}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(t.debit)}</span>
                                            {statusChip(entry.status || 'Posted')}
                                            {originChip(isSystemEntry(entry))}
                                        </span>
                                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                                            <ActionBtn icon={Eye} label="View" onClick={() => setViewEntry(entry)} />
                                            <ActionBtn icon={Printer} label="Print" onClick={() => printEntry(entry)} />
                                            {isDraft && (
                                                <>
                                                    <ActionBtn icon={Pencil} label="Edit" onClick={() => openEdit(entry)} />
                                                    <ActionBtn icon={CheckCircle2} label="Post" onClick={() => postEntry(entry.id)} color="#4c5fd0" />
                                                </>
                                            )}
                                            {canDeleteRow && <ActionBtn icon={Trash2} label="Delete" onClick={() => handleDelete(entry)} color="#ef4444" />}
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    )
                ) : (
                <div style={{ overflowX: 'auto' }}>
                <table style={{ width: totalWidth + 32, minWidth: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '14px 8px 14px 20px', width: '32px' }}>
                                <input
                                    type="checkbox"
                                    checked={allSelected}
                                    ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
                                    onChange={toggleSelectAll}
                                    disabled={selectableIds.length === 0}
                                    title="Select all shown entries"
                                    style={{ cursor: selectableIds.length === 0 ? 'not-allowed' : 'pointer' }}
                                />
                            </th>
                            <th style={{ ...widthStyle('date'), position: 'relative', padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none' }}>Date{resizeHandle('date')}</th>
                            <th style={{ ...widthStyle('reference'), position: 'relative', padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none' }}>Reference{resizeHandle('reference')}</th>
                            <th style={{ ...widthStyle('description'), position: 'relative', padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none' }}>Description{resizeHandle('description')}</th>
                            <th style={{ ...widthStyle('debits'), position: 'relative', padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none', textAlign: 'right' }}>Debits{resizeHandle('debits')}</th>
                            <th style={{ ...widthStyle('credits'), position: 'relative', padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none', textAlign: 'right' }}>Credits{resizeHandle('credits')}</th>
                            <th style={{ ...widthStyle('status'), position: 'relative', padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none' }}>Status{resizeHandle('status')}</th>
                            <th style={{ ...widthStyle('actions'), position: 'relative', padding: '14px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '12px', textTransform: 'none' }}>Actions{resizeHandle('actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading entries...</td></tr>
                        ) : filteredEntries.length === 0 ? (
                            <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No entries found</td></tr>
                        ) : (
                            visibleEntries.map(entry => {
                                const t = entryTotals(entry);
                                const isDraft = entry.status === 'Draft';
                                const canDeleteRow = isDraft || isAdmin;
                                const busy = busyIds.has(entry.id);
                                return (
                                    <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9', background: 'var(--color-surface)', transition: 'background 0.2s' }}>
                                        <td style={{ padding: '14px 8px 14px 20px' }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(entry.id)}
                                                onChange={() => toggleSelect(entry.id)}
                                                disabled={busy}
                                                title={busy ? 'Busy…' : 'Select entry'}
                                                style={{ cursor: busy ? 'not-allowed' : 'pointer' }}
                                            />
                                        </td>
                                        <td style={{ ...widthStyle('date'), padding: '14px 20px', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {fmtDate(entry.date)}
                                        </td>
                                        <td style={{ ...widthStyle('reference'), padding: '14px 20px', color: 'var(--color-text-secondary)', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={displayIdOf(entry)}>
                                            {displayIdOf(entry)}
                                        </td>
                                        <td className="d2-khmer" style={{ ...widthStyle('description'), padding: '14px 20px', color: 'var(--color-text-main)', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.description || ''}>
                                            {entry.description || 'No Description'}
                                        </td>
                                        <td style={{ ...widthStyle('debits'), padding: '14px 20px', fontWeight: 700, textAlign: 'right', color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                                            {fmtUsd(t.debit)}
                                        </td>
                                        <td style={{ ...widthStyle('credits'), padding: '14px 20px', fontWeight: 700, textAlign: 'right', color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                                            {fmtUsd(t.credit)}
                                        </td>
                                        <td style={{ ...widthStyle('status'), padding: '14px 20px', overflow: 'hidden' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                {statusChip(entry.status || 'Posted')}
                                                {originChip(isSystemEntry(entry))}
                                            </span>
                                        </td>
                                        <td style={{ ...widthStyle('actions'), padding: '10px 14px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                <ActionBtn icon={Eye} label="View" onClick={() => setViewEntry(entry)} />
                                                <ActionBtn icon={Printer} label="Print" onClick={() => printEntry(entry)} />
                                                {isDraft && (
                                                    <>
                                                        <ActionBtn icon={Pencil} label="Edit" onClick={() => openEdit(entry)} />
                                                        <ActionBtn icon={CheckCircle2} label="Post" onClick={() => postEntry(entry.id)} color="#4c5fd0" />
                                                    </>
                                                )}
                                                {canDeleteRow && <ActionBtn icon={Trash2} label="Delete" onClick={() => handleDelete(entry)} color="#ef4444" />}
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
                {/* Pagination footer — rendering stops at visibleCount, but the
                    summary cards, Print list and Export CSV always cover the
                    whole filtered set. */}
                {!isLoading && filteredEntries.length > PAGE_SIZE && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', flexWrap: 'wrap', padding: '14px 20px', borderTop: '1px solid var(--color-border)' }}>
                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                            Showing {Math.min(visibleCount, filteredEntries.length).toLocaleString()} of {filteredEntries.length.toLocaleString()} entries
                        </span>
                        {filteredEntries.length > visibleCount && (
                            <>
                                <button
                                    onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                                    style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #5469d4', background: 'var(--color-surface)', color: '#5469d4', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    Show {Math.min(PAGE_SIZE, filteredEntries.length - visibleCount).toLocaleString()} more
                                </button>
                                <button
                                    onClick={() => setVisibleCount(filteredEntries.length)}
                                    style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    Show all
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Bulk selection bar — floats at the bottom-center once any row is
                checked, same place/style as Customer Payment's and Revenue/
                Expense's. Unpost (admin only) shows when the selection
                includes a Posted row; Delete applies to Draft entries for
                anyone and Posted entries for an admin only. Stays mounted
                (via the isBulk*ing OR below) through an in-flight operation
                even if selectedIds empties out some other way. */}
            {(selectedRows.length > 0 || isBulkUnposting || isBulkDeleting) && (() => {
                const bulkBusy = isBulkUnposting || isBulkDeleting;
                return (
                    <div style={{
                        position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
                        zIndex: 500, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                        justifyContent: 'center', maxWidth: 'calc(100vw - 32px)',
                        padding: '12px 18px', borderRadius: '14px',
                        background: 'var(--color-surface)', border: '1px solid #e2e8f0',
                        boxShadow: '0 10px 32px rgba(0,0,0,0.22)'
                    }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)', whiteSpace: 'nowrap' }}>
                            {selectedRows.length > 0 ? `${selectedRows.length} selected` : 'Working…'}
                        </span>
                        {isAdmin && (selectedPostedRows.length > 0 || isBulkUnposting) && (
                            <button
                                onClick={handleBulkUnpost}
                                disabled={bulkBusy}
                                title="Return the selected posted entries to Draft so they can be corrected"
                                style={{
                                    padding: '8px 16px', borderRadius: '8px',
                                    border: '1px solid #D97706', background: '#FEF3C7', color: '#92400E',
                                    fontSize: '13px', fontWeight: 600, cursor: bulkBusy ? 'not-allowed' : 'pointer',
                                    opacity: bulkBusy ? 0.7 : 1, whiteSpace: 'nowrap'
                                }}
                            >
                                {isBulkUnposting ? 'Unposting…' : `Unpost (${selectedPostedRows.length})`}
                            </button>
                        )}
                        {(selectedDeletableRows.length > 0 || isBulkDeleting) && (
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
                                <Trash2 size={14} /> {isBulkDeleting ? 'Deleting…' : `Delete (${selectedDeletableRows.length})`}
                            </button>
                        )}
                        <button
                            onClick={() => setSelectedIds(new Set())}
                            disabled={bulkBusy}
                            style={{
                                padding: '8px 14px', borderRadius: '8px', border: '1px solid #e2e8f0',
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
                                {importPreview.beforeStart > 0 && importPreview.start && <div style={{ marginTop: '6px', fontSize: '12px' }}>({importPreview.beforeStart} from before {formatLedgerStart(importPreview.start)} left out: the ledger starts at the opening stock count)</div>}
                            </div>
                        ) : (
                            <>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                    {importPreview.candidates.length} {importPreview.candidates.length === 1 ? 'transaction' : 'transactions'} ·{' '}
                                    {formatCurrency(importPreview.candidates.reduce((s, c) => s + c.amount, 0))}
                                    {importPreview.skipped > 0 && <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}> · {importPreview.skipped} skipped (no matching account)</span>}
                                    {importPreview.beforeStart > 0 && importPreview.start && <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}> · {importPreview.beforeStart} before {formatLedgerStart(importPreview.start)} left out</span>}
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
            <Modal isOpen={!!viewEntry} onClose={() => setViewEntry(null)} title="Journal Entry" width="820px">
                {viewEntry && (() => {
                    const t = entryTotals(viewEntry);
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: '6px', fontSize: '13px' }}>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Reference</span>
                                <span style={{ color: 'var(--color-text-main)', fontSize: '12px' }}>{displayIdOf(viewEntry)}</span>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Date</span>
                                <span style={{ color: 'var(--color-text-main)' }}>{fmtDate(viewEntry.date)}</span>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Status</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    {statusChip(viewEntry.status || 'Posted')}
                                    {originChip(isSystemEntry(viewEntry))}
                                </span>
                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Description</span>
                                <span className="d2-khmer" style={{ color: 'var(--color-text-main)' }}>{viewEntry.description || '—'}</span>
                            </div>
                            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid #e2e8f0' }}>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Account</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Description</th>
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
                                                <td className="d2-khmer" style={{ padding: '8px 12px', color: l.description ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{l.description || '—'}</td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (l.debit || 0) > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{(l.debit || 0) > 0 ? fmtUsd(l.debit || 0) : '—'}</td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (l.credit || 0) > 0 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>{(l.credit || 0) > 0 ? fmtUsd(l.credit || 0) : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ background: 'var(--color-bg)', fontWeight: 700 }}>
                                            <td colSpan={2} style={{ padding: '8px 12px', color: 'var(--color-text-main)' }}>Total</td>
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
                                    disabled={!isFormValid || isSavingEntry}
                                    style={{ padding: '10px 18px', borderRadius: '8px', border: 'none', background: '#2742c9', color: 'white', fontWeight: 600, fontSize: '13.5px', cursor: isFormValid && !isSavingEntry ? 'pointer' : 'not-allowed', opacity: (!isFormValid || isSavingEntry) ? 0.55 : 1 }}
                                >
                                    {isSavingEntry ? 'Saving…' : editingEntryId ? 'Save Changes' : 'Create Entry'}
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
