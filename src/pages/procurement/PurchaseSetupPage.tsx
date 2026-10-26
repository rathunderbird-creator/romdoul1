// Purchase Setup — defaults for new buy-side documents (modeled on the
// reference design): a Defaults tab (VAT, payment terms, over-receipt
// tolerance, default warehouse / payment account, document numbering
// prefixes), named Payment Terms presets, and AP Opening Balances per
// supplier invoice.
//
// Defaults persists as one JSON settings blob (updatePurchaseSettings).
// Payment Terms also lives in that blob, but each add/edit/delete saves
// immediately — no separate "Save settings" step for a one-row change.
// AP Opening Balances is the odd one out: "Load balances" creates REAL
// Received purchase_orders rows (so they show up in Supplier Bills,
// Accounts Payable aging and the Purchase Dashboard exactly like any other
// bill — see postOpeningBalanceEntry in useProcurement.ts for why this
// can't reuse savePurchaseOrder, which always posts Dr Inventory and would
// be wrong here), with a Dr [offset account] / Cr Accounts Payable journal
// entry, Draft like every other auto-post in this app. The settings blob
// only keeps a thin pointer (purchase_order_id, invoice/date/amount) so the
// "Already loaded" table can show live outstanding/paid status.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal, CalendarClock, Landmark, Plus, Trash2, Pencil, Search, RefreshCw, Download, Upload, X, Undo2 } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useAccounting } from '../../hooks/useAccounting';
import { useProcurement, postOpeningBalanceEntry, reverseOpeningBalance } from '../../hooks/useProcurement';
import { supabase } from '../../lib/supabase';
import { dayKeyFromDate } from '../../utils/dateRange';
import DataImportModal from '../../components/DataImportModal';
import type { PurchaseSettings, PurchasePaymentTerm, PurchaseOpeningBalance, FallsDueType } from '../../types';

type TabKey = 'defaults' | 'terms' | 'opening';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { key: 'defaults', label: 'Defaults', icon: SlidersHorizontal },
    { key: 'terms', label: 'Payment Terms', icon: CalendarClock },
    { key: 'opening', label: 'AP Opening Balances', icon: Landmark },
];

const DEFAULT_TERMS: PurchasePaymentTerm[] = [
    { code: 'COD', name: 'Due on receipt', fallsDueType: 'receipt', active: true },
    { code: 'NET7', name: 'Net 7 days', fallsDueType: 'net', days: 7, active: true },
    { code: 'NET15', name: 'Net 15 days', fallsDueType: 'net', days: 15, active: true },
    { code: 'NET30', name: 'Net 30 days', fallsDueType: 'net', days: 30, active: true },
    { code: 'NET45', name: 'Net 45 days', fallsDueType: 'net', days: 45, active: true },
    { code: 'NET60', name: 'Net 60 days', fallsDueType: 'net', days: 60, active: true },
    { code: 'EOM', name: 'End of month', fallsDueType: 'eom', active: true },
    { code: 'EOM30', name: 'End of month + 30 days', fallsDueType: 'eom_plus', days: 30, active: true },
];

// A term saved before this shape existed has no fallsDueType (just the old
// {name, days}) — treat that as 'net' so it still reads sensibly instead of
// showing a blank Falls Due.
const fallsDueLabel = (t: { fallsDueType?: FallsDueType; days?: number }): string => {
    switch (t.fallsDueType || (t.days ? 'net' : undefined)) {
        case 'receipt': return 'Due on receipt';
        case 'net': return `${t.days ?? 0} days`;
        case 'eom': return 'End of month';
        case 'eom_plus': return `${t.days ?? 0} days after month end`;
        default: return '';
    }
};

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const todayYmd = () => dayKeyFromDate(new Date());
const genKey = (): string => Math.random().toString(36).slice(2);

interface DraftRow { key: string; supplier_id: string; their_invoice: string; bill_date: string; due_date: string; amount: string }
const emptyDraftRow = (): DraftRow => ({ key: genKey(), supplier_id: '', their_invoice: '', bill_date: todayYmd(), due_date: todayYmd(), amount: '' });

// Excel/CSV cells for a date column can come through as a serial number
// (XLSX.read without cellDates) or as plain text — handle both, since this
// is the same raw-cell data DataImportModal's parser hands back.
const normalizeDate = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') {
        const d = XLSX.SSF.parse_date_code(v);
        if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const parsed = new Date(s);
    return isNaN(parsed.getTime()) ? '' : dayKeyFromDate(parsed);
};

const PurchaseSetupPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const navigate = useNavigate();
    const { warehouses, purchaseSettings, updatePurchaseSettings } = useStore();
    const { accounts, fetchAccounts } = useAccounting();
    const { suppliers, fetchSuppliers, purchaseOrders, fetchPurchaseOrders } = useProcurement();

    const [tab, setTab] = useState<TabKey>('defaults');
    const [saving, setSaving] = useState(false);

    // Local draft of the whole settings object, loaded from the store once.
    const [draft, setDraft] = useState<PurchaseSettings>(() => ({ ...purchaseSettings }));
    useEffect(() => {
        setDraft({ ...purchaseSettings });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(purchaseSettings)]);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Purchase Setup</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Defaults for new buy-side documents, and where you started</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchAccounts();
        fetchSuppliers();
        fetchPurchaseOrders();
    }, [fetchAccounts, fetchSuppliers, fetchPurchaseOrders]);

    // Bank or cash accounts for the default payment account select.
    const paymentAccounts = useMemo(
        () => accounts.filter(a => a.is_active && a.account_type === 'Asset' && /cash|bank/i.test(a.account_name)),
        [accounts]
    );
    const equityAccounts = useMemo(() => accounts.filter(a => a.is_active && a.account_type === 'Equity'), [accounts]);

    const numbering = draft.numbering || {};
    const setNumbering = (key: keyof NonNullable<PurchaseSettings['numbering']>, value: string) =>
        setDraft(d => ({ ...d, numbering: { ...(d.numbering || {}), [key]: value } }));

    const handleSave = async () => {
        setSaving(true);
        try {
            const clean: PurchaseSettings = {
                ...draft,
                vatRate: Math.max(0, Number(draft.vatRate ?? 0) || 0),
                paymentTermsDays: Math.max(0, Math.round(Number(draft.paymentTermsDays ?? 30) || 0)),
                overReceiptTolerance: Math.max(0, Number(draft.overReceiptTolerance ?? 0) || 0),
            };
            await updatePurchaseSettings(clean);
            setDraft(clean);
            showToast('Purchase settings saved', 'success');
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed to save settings: ' + msg, 'error');
        } finally {
            setSaving(false);
        }
    };

    // ── Styles (the flat-card family used across the app) ──
    const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
    const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' };
    const helpStyle: React.CSSProperties = { fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.45, marginTop: '6px' };
    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
        background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
    };
    const saveBtn: React.CSSProperties = {
        padding: '10px 18px', borderRadius: '9px', border: 'none', background: 'var(--color-primary)', color: 'white',
        fontSize: '13px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', alignSelf: 'flex-start',
    };
    const btnStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px',
        border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)',
        fontSize: '13px', fontWeight: 600, cursor: 'pointer',
    };

    // ═══════════════════════════ Payment Terms ═══════════════════════════
    const terms: PurchasePaymentTerm[] = draft.paymentTerms && draft.paymentTerms.length > 0 ? draft.paymentTerms : DEFAULT_TERMS;
    const [termSearch, setTermSearch] = useState('');
    const filteredTerms = useMemo(() => {
        const q = termSearch.trim().toLowerCase();
        if (!q) return terms;
        return terms.filter(t => t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
    }, [terms, termSearch]);

    const persistTerms = useCallback(async (next: PurchasePaymentTerm[]) => {
        const updated = { ...draft, paymentTerms: next };
        setDraft(updated);
        try {
            await updatePurchaseSettings(updated);
        } catch (e) {
            showToast('Failed to save: ' + (e instanceof Error ? e.message : 'unknown error'), 'error');
        }
    }, [draft, updatePurchaseSettings, showToast]);

    const [termModal, setTermModal] = useState<{ index: number | null; code: string; name: string; fallsDueType: FallsDueType; days: string; active: boolean } | null>(null);
    const openNewTerm = () => setTermModal({ index: null, code: '', name: '', fallsDueType: 'net', days: '30', active: true });
    const openEditTerm = (i: number) => {
        const t = terms[i];
        setTermModal({ index: i, code: t.code || '', name: t.name, fallsDueType: t.fallsDueType || (t.days ? 'net' : 'receipt'), days: String(t.days ?? ''), active: t.active !== false });
    };
    const saveTermModal = async () => {
        if (!termModal) return;
        if (!termModal.code.trim() || !termModal.name.trim()) { showToast('Code and name are required', 'error'); return; }
        const entry: PurchasePaymentTerm = {
            code: termModal.code.trim().toUpperCase(),
            name: termModal.name.trim(),
            fallsDueType: termModal.fallsDueType,
            days: (termModal.fallsDueType === 'net' || termModal.fallsDueType === 'eom_plus') ? Math.max(0, Math.round(Number(termModal.days) || 0)) : undefined,
            active: termModal.active,
        };
        const next = termModal.index === null ? [...terms, entry] : terms.map((t, i) => i === termModal.index ? entry : t);
        await persistTerms(next);
        setTermModal(null);
        showToast(termModal.index === null ? 'Payment term added' : 'Payment term updated', 'success');
    };
    const deleteTerm = async (i: number) => {
        if (!confirm(`Delete "${terms[i].name}"?`)) return;
        await persistTerms(terms.filter((_, idx) => idx !== i));
        showToast('Payment term deleted', 'success');
    };

    // ═══════════════════════ AP Opening Balances ═══════════════════════
    const [asAtDate, setAsAtDate] = useState(todayYmd());
    const [offsetAccountId, setOffsetAccountId] = useState('');
    useEffect(() => {
        if (offsetAccountId || accounts.length === 0) return;
        const best = accounts.find(a => a.account_code === '3300')
            || accounts.find(a => a.account_type === 'Equity' && /opening balance/i.test(a.account_name))
            || equityAccounts[0];
        if (best) setOffsetAccountId(best.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accounts]);

    const [draftRows, setDraftRows] = useState<DraftRow[]>([emptyDraftRow()]);
    const updateRow = (key: string, patch: Partial<DraftRow>) => setDraftRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
    const removeRow = (key: string) => setDraftRows(prev => prev.length > 1 ? prev.filter(r => r.key !== key) : prev);

    const validRows = useMemo(() => draftRows.filter(r => r.supplier_id && r.their_invoice.trim() && r.bill_date && r.due_date && parseFloat(r.amount) > 0), [draftRows]);
    const draftTotal = validRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

    const downloadTemplate = () => {
        const ws = XLSX.utils.json_to_sheet([{ Supplier: 'Example Supplier', 'Their Invoice': 'INV-0001', 'Bill Date': '2026-01-01', 'Due Date': '2026-01-31', Amount: 100 }]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Template');
        XLSX.writeFile(wb, 'ap-opening-balances-template.xlsx');
    };

    const [isImportOpen, setIsImportOpen] = useState(false);
    const handleImportRows = async (rows: Record<string, unknown>[]) => {
        const newRows: DraftRow[] = [];
        const notFound: string[] = [];
        for (const row of rows) {
            const name = String(row['Supplier'] ?? '').trim();
            const supplier = suppliers.find(s => s.name.toLowerCase() === name.toLowerCase());
            if (!supplier) { if (name) notFound.push(name); continue; }
            newRows.push({
                key: genKey(),
                supplier_id: supplier.id,
                their_invoice: String(row['Their Invoice'] ?? ''),
                bill_date: normalizeDate(row['Bill Date']) || todayYmd(),
                due_date: normalizeDate(row['Due Date']) || todayYmd(),
                amount: String(row['Amount'] ?? ''),
            });
        }
        if (newRows.length === 0) { showToast('No matching suppliers found in that file (matched by name).', 'error'); return; }
        setDraftRows(prev => {
            const kept = prev.filter(r => r.supplier_id || r.their_invoice || r.amount);
            return [...kept, ...newRows];
        });
        showToast(notFound.length
            ? `Imported ${newRows.length} row(s); ${notFound.length} supplier(s) not found: ${notFound.slice(0, 5).join(', ')}${notFound.length > 5 ? '…' : ''}`
            : `Imported ${newRows.length} row(s)`, notFound.length ? 'info' : 'success');
    };

    const [isLoadingBalances, setIsLoadingBalances] = useState(false);
    const handleLoadBalances = async () => {
        if (!offsetAccountId) { showToast('Choose an offset account', 'error'); return; }
        if (validRows.length === 0) { showToast('Add at least one row with a supplier, invoice, both dates and a positive amount', 'error'); return; }
        setIsLoadingBalances(true);
        try {
            const newEntries: PurchaseOpeningBalance[] = [];
            let failures = 0;
            for (const r of validRows) {
                const supplier = suppliers.find(s => s.id === r.supplier_id);
                const amount = Math.round(parseFloat(r.amount) * 100) / 100;
                const { data: po, error } = await supabase.from('purchase_orders').insert([{
                    supplier_id: r.supplier_id,
                    order_date: r.bill_date,
                    status: 'Received',
                    total_amount: amount,
                    payment_status: 'Unpaid',
                    amount_paid: 0,
                    payment_due_date: r.due_date,
                    invoice_number: r.their_invoice.trim(),
                    notes: 'Opening balance',
                }]).select().single();
                if (error || !po) {
                    failures++;
                    console.error('Failed to load an opening balance:', error);
                    continue;
                }
                await postOpeningBalanceEntry(po.id, amount, offsetAccountId, supplier?.name || 'Supplier', showToast);
                newEntries.push({
                    supplier_id: r.supplier_id,
                    purchase_order_id: po.id,
                    invoice_number: r.their_invoice.trim(),
                    bill_date: r.bill_date,
                    due_date: r.due_date,
                    amount,
                    as_of: asAtDate,
                    offset_account_id: offsetAccountId,
                });
            }
            if (newEntries.length > 0) {
                const updated = { ...draft, apOpeningBalances: [...(draft.apOpeningBalances || []), ...newEntries] };
                setDraft(updated);
                await updatePurchaseSettings(updated);
                await fetchPurchaseOrders(true);
                setDraftRows([emptyDraftRow()]);
            }
            if (failures > 0) showToast(`Loaded ${newEntries.length}, ${failures} failed — see console.`, newEntries.length ? 'info' : 'error');
            else if (newEntries.length > 0) showToast(`Loaded ${newEntries.length} opening balance${newEntries.length === 1 ? '' : 's'}`, 'success');
        } finally {
            setIsLoadingBalances(false);
        }
    };

    const loadedRows = useMemo(() => {
        const list = draft.apOpeningBalances || [];
        const prefix = draft.numbering?.opening || 'OPA';
        return list.map(b => {
            const sameDay = list.filter(x => x.as_of === b.as_of);
            const idx = sameDay.indexOf(b);
            const ymd = (b.as_of || '').replace(/-/g, '');
            const reference = `${prefix}-${ymd}-${String(idx + 1).padStart(3, '0')}`;
            const po = b.purchase_order_id ? purchaseOrders.find(p => p.id === b.purchase_order_id) : undefined;
            const poExists = !!po;
            const outstanding = po ? Math.max(0, (po.total_amount || 0) - (po.amount_paid || 0)) : b.amount;
            const paid = (po?.amount_paid || 0) > 0;
            const status: 'Posted' | 'Paid' = outstanding <= 0.005 ? 'Paid' : 'Posted';
            return { ...b, reference, supplierName: suppliers.find(s => s.id === b.supplier_id)?.name || 'Unknown supplier', outstanding, status, canUndo: poExists && !paid };
        }).sort((a, b) => (b.as_of || '').localeCompare(a.as_of || '') || (b.reference || '').localeCompare(a.reference || ''));
    }, [draft.apOpeningBalances, draft.numbering, purchaseOrders, suppliers]);

    const handleUndo = async (row: typeof loadedRows[number]) => {
        if (!row.canUndo || !row.purchase_order_id) return;
        if (!confirm(`Remove this opening balance for ${row.supplierName}? This deletes its bill and ledger entry.`)) return;
        try {
            await reverseOpeningBalance(row.purchase_order_id);
            const updated = { ...draft, apOpeningBalances: (draft.apOpeningBalances || []).filter(b => b.purchase_order_id !== row.purchase_order_id) };
            setDraft(updated);
            await updatePurchaseSettings(updated);
            await fetchPurchaseOrders(true);
            showToast('Opening balance removed', 'success');
        } catch (e) {
            showToast('Failed to remove: ' + (e instanceof Error ? e.message : 'unknown error'), 'error');
        }
    };

    const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' };

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '4px', flexWrap: 'wrap', alignSelf: 'flex-start' }}>
                {TABS.map(({ key, label, icon: Icon }) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 14px', borderRadius: '9px', border: 'none',
                            background: tab === key ? 'var(--color-surface)' : 'transparent',
                            color: tab === key ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                            boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                        }}
                    >
                        <Icon size={15} /> {label}
                    </button>
                ))}
            </div>

            {/* ── Defaults ── */}
            {tab === 'defaults' && (
                <div style={{ ...cardStyle, padding: '20px 22px', maxWidth: '640px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        Starting values for new documents only. Changing them never alters an order or a bill that has already been saved.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                        <div>
                            <label style={labelStyle}>Default VAT rate (%)</label>
                            <input type="number" min="0" step="0.01" value={draft.vatRate ?? 0}
                                onChange={e => setDraft(d => ({ ...d, vatRate: Number(e.target.value) }))} style={inputStyle} />
                        </div>
                        <div>
                            <label style={labelStyle}>Payment terms (days)</label>
                            <input type="number" min="0" step="1" value={draft.paymentTermsDays ?? 30}
                                onChange={e => setDraft(d => ({ ...d, paymentTermsDays: Number(e.target.value) }))} style={inputStyle} />
                        </div>
                    </div>

                    <div>
                        <label style={labelStyle}>Over-receipt tolerance (%)</label>
                        <input type="number" min="0" step="0.01" value={draft.overReceiptTolerance ?? 0}
                            onChange={e => setDraft(d => ({ ...d, overReceiptTolerance: Number(e.target.value) }))} style={inputStyle} />
                        <div style={helpStyle}>
                            How much more than the ordered quantity a delivery may contain. Zero means exactly what was ordered;
                            suppliers of bulk goods routinely ship a little over.
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                        <div>
                            <label style={labelStyle}>Default warehouse</label>
                            <select value={draft.defaultWarehouseId || ''} className="d2-khmer"
                                onChange={e => setDraft(d => ({ ...d, defaultWarehouseId: e.target.value || undefined }))}
                                style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="">None</option>
                                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Default payment account</label>
                            <select value={draft.defaultPaymentAccountId || ''} className="d2-khmer"
                                onChange={e => setDraft(d => ({ ...d, defaultPaymentAccountId: e.target.value || undefined }))}
                                style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="">Bank or cash account…</option>
                                {paymentAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)', marginBottom: '4px' }}>Document numbering</div>
                        <div style={{ ...helpStyle, marginTop: 0, marginBottom: '10px' }}>
                            Prefixes only. Changing a prefix affects new records only — documents that already exist keep their reference.
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '10px' }}>
                            {([
                                ['Requests', 'requests', 'PR'],
                                ['Orders', 'orders', 'PO'],
                                ['Bills', 'bills', 'BIL'],
                                ['Payments', 'payments', 'PAY'],
                                ['Pay requests', 'payRequests', 'PRQ'],
                                ['Opening', 'opening', 'OPA'],
                            ] as const).map(([label, key, def]) => (
                                <div key={key}>
                                    <label style={{ ...labelStyle, whiteSpace: 'nowrap' }}>{label}</label>
                                    <input type="text" value={numbering[key] ?? def} maxLength={6}
                                        onChange={e => setNumbering(key, e.target.value.toUpperCase())} style={inputStyle} />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        The GL accounts a purchase posts to — payables, input VAT, goods-received-not-invoiced and the inventory asset — are configured under{' '}
                        <b onClick={() => navigate('/inventory/settings')} style={{ color: 'var(--color-primary)', cursor: 'pointer' }}>Inventory Setup</b>, where the posting engine reads them.
                    </div>

                    <button onClick={handleSave} disabled={saving} style={saveBtn}>{saving ? 'Saving…' : 'Save settings'}</button>
                </div>
            )}

            {/* ── Payment Terms ── */}
            {tab === 'terms' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                        <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--color-text-main)' }}>Payment Terms</h2>
                        <button onClick={openNewTerm} className="primary-button" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 16px' }}>
                            <Plus size={15} /> New Payment Term
                        </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: '360px' }}>
                            <Search size={15} color="var(--color-text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                            <input type="text" placeholder="Search payment terms…" value={termSearch} onChange={e => setTermSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: '34px' }} />
                        </div>
                        <button onClick={() => setDraft({ ...purchaseSettings })} title="Reload" style={{ ...btnStyle, padding: '9px 10px' }}>
                            <RefreshCw size={14} />
                        </button>
                    </div>

                    <div style={{ ...cardStyle, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Code</th>
                                    <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Name</th>
                                    <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Falls Due</th>
                                    <th style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Status</th>
                                    <th style={{ padding: '12px 20px', width: '90px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTerms.length === 0 ? (
                                    <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>No payment terms match.</td></tr>
                                ) : filteredTerms.map(t => {
                                    const i = terms.indexOf(t);
                                    return (
                                        <tr key={t.code + i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '12px 20px', fontSize: '11px', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>{t.code}</td>
                                            <td style={{ padding: '12px 20px', fontWeight: 600, color: 'var(--color-text-main)' }}>{t.name}</td>
                                            <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)' }}>{fallsDueLabel(t)}</td>
                                            <td style={{ padding: '12px 20px' }}>
                                                <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px', background: t.active !== false ? 'rgba(16,185,129,0.14)' : 'var(--color-bg)', color: t.active !== false ? '#059669' : 'var(--color-text-secondary)' }}>{t.active !== false ? 'Active' : 'Inactive'}</span>
                                            </td>
                                            <td style={{ padding: '12px 20px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                <button onClick={() => openEditTerm(i)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: '4px' }}><Pencil size={14} /></button>
                                                <button onClick={() => deleteTerm(i)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: '4px' }}><Trash2 size={14} /></button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {termModal && (
                <div style={overlayStyle}>
                    <div style={{ ...cardStyle, width: '100%', maxWidth: '420px', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>{termModal.index === null ? 'New Payment Term' : 'Edit Payment Term'}</h3>
                            <button onClick={() => setTermModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><X size={18} /></button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div>
                                <label style={labelStyle}>Code</label>
                                <input type="text" value={termModal.code} onChange={e => setTermModal(m => m && { ...m, code: e.target.value.toUpperCase() })} placeholder="e.g. NET30" style={inputStyle} maxLength={10} />
                            </div>
                            <div>
                                <label style={labelStyle}>Name</label>
                                <input type="text" value={termModal.name} onChange={e => setTermModal(m => m && { ...m, name: e.target.value })} placeholder="e.g. Net 30 days" style={inputStyle} />
                            </div>
                        </div>
                        <div>
                            <label style={labelStyle}>Falls due</label>
                            <select value={termModal.fallsDueType} onChange={e => setTermModal(m => m && { ...m, fallsDueType: e.target.value as FallsDueType })} style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="receipt">Due on receipt</option>
                                <option value="net">Net N days</option>
                                <option value="eom">End of month</option>
                                <option value="eom_plus">End of month + N days</option>
                            </select>
                        </div>
                        {(termModal.fallsDueType === 'net' || termModal.fallsDueType === 'eom_plus') && (
                            <div>
                                <label style={labelStyle}>Days</label>
                                <input type="number" min="0" step="1" value={termModal.days} onChange={e => setTermModal(m => m && { ...m, days: e.target.value })} style={inputStyle} />
                            </div>
                        )}
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={termModal.active} onChange={e => setTermModal(m => m && { ...m, active: e.target.checked })} style={{ width: '15px', height: '15px', accentColor: 'var(--color-primary)', cursor: 'pointer' }} />
                            Active
                        </label>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
                            <button onClick={() => setTermModal(null)} style={{ ...btnStyle, background: 'var(--color-surface)' }}>Cancel</button>
                            <button onClick={saveTermModal} className="primary-button" style={{ padding: '9px 18px' }}>Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── AP Opening Balances ── */}
            {tab === 'opening' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '920px' }}>
                    <div style={{ ...cardStyle, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '4px' }}>Load balances from your previous system</div>
                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                                One row per unpaid supplier invoice, with the reference and dates your supplier knows. These are offset against the
                                equity account below on the as-at date, but they age from their own due dates — so the aging report reads the way it did before you switched.
                            </p>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                            <div>
                                <label style={labelStyle}>As at *</label>
                                <input type="date" value={asAtDate} onChange={e => setAsAtDate(e.target.value)} style={inputStyle} />
                                <div style={helpStyle}>The date these enter your books.</div>
                            </div>
                            <div>
                                <label style={labelStyle}>Offset against</label>
                                <select value={offsetAccountId} onChange={e => setOffsetAccountId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                    <option value="">Select account…</option>
                                    {equityAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}
                                </select>
                                <div style={helpStyle}>Defaults to 3300 Opening Balance Equity.</div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <button onClick={downloadTemplate} style={btnStyle}><Download size={14} /> Download template</button>
                            <button onClick={() => setIsImportOpen(true)} style={btnStyle}><Upload size={14} /> Import CSV</button>
                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Rows are added to the list below for you to review — nothing is saved until you load them.</span>
                        </div>

                        <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <thead>
                                        <tr style={{ background: 'var(--color-bg)' }}>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Supplier</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Their invoice</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Bill date</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Due date</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Amount</th>
                                            <th style={{ width: '40px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {draftRows.map((r, i) => (
                                            <tr key={r.key} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}>
                                                <td style={{ padding: '8px 12px' }}>
                                                    <select value={r.supplier_id} onChange={e => updateRow(r.key, { supplier_id: e.target.value })} className="d2-khmer" style={{ ...inputStyle, cursor: 'pointer', minWidth: '160px' }}>
                                                        <option value="">Select supplier…</option>
                                                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                    </select>
                                                </td>
                                                <td style={{ padding: '8px 12px' }}>
                                                    <input type="text" placeholder="GZ-2025-0881" value={r.their_invoice} onChange={e => updateRow(r.key, { their_invoice: e.target.value })} style={{ ...inputStyle, minWidth: '130px' }} />
                                                </td>
                                                <td style={{ padding: '8px 12px' }}>
                                                    <input type="date" value={r.bill_date} onChange={e => updateRow(r.key, { bill_date: e.target.value })} style={inputStyle} />
                                                </td>
                                                <td style={{ padding: '8px 12px' }}>
                                                    <input type="date" value={r.due_date} onChange={e => updateRow(r.key, { due_date: e.target.value })} style={inputStyle} />
                                                </td>
                                                <td style={{ padding: '8px 12px' }}>
                                                    <input type="number" min="0" step="0.01" placeholder="0.00" value={r.amount} onChange={e => updateRow(r.key, { amount: e.target.value })} style={{ ...inputStyle, textAlign: 'right' }} />
                                                </td>
                                                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                    <button onClick={() => removeRow(r.key)} title="Remove row" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626' }}><Trash2 size={14} /></button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <button onClick={() => setDraftRows(prev => [...prev, emptyDraftRow()])} style={{ width: '100%', padding: '10px', border: 'none', borderTop: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-primary)', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                <Plus size={14} /> Add row
                            </button>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{validRows.length} row{validRows.length === 1 ? '' : 's'} · <b style={{ color: 'var(--color-text-main)' }}>{fmt(draftTotal)}</b></span>
                            <button onClick={handleLoadBalances} disabled={isLoadingBalances} className="primary-button" style={{ padding: '10px 20px', opacity: isLoadingBalances ? 0.6 : 1 }}>{isLoadingBalances ? 'Loading…' : 'Load balances'}</button>
                        </div>
                    </div>

                    {loadedRows.length > 0 && (
                        <div>
                            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '10px' }}>Already loaded</div>
                            <div style={{ ...cardStyle, overflow: 'hidden' }}>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                <th style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Reference</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Their Invoice</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Supplier</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Due</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Amount</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>Outstanding</th>
                                                <th style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>Status</th>
                                                <th style={{ width: '40px' }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {loadedRows.map(r => (
                                                <tr key={r.purchase_order_id || r.reference} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                    <td style={{ padding: '10px 16px', fontSize: '11px', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>{r.reference}</td>
                                                    <td style={{ padding: '10px 16px' }}>{r.invoice_number}</td>
                                                    <td className="d2-khmer" style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--color-text-main)' }}>{r.supplierName}</td>
                                                    <td style={{ padding: '10px 16px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{r.due_date}</td>
                                                    <td style={{ padding: '10px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.amount)}</td>
                                                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.outstanding)}</td>
                                                    <td style={{ padding: '10px 16px' }}>
                                                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px', background: r.status === 'Paid' ? 'rgba(16,185,129,0.14)' : 'rgba(84,105,212,0.12)', color: r.status === 'Paid' ? '#059669' : '#5469d4' }}>{r.status}</span>
                                                    </td>
                                                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                                        <button
                                                            onClick={() => handleUndo(r)}
                                                            disabled={!r.canUndo}
                                                            title={r.canUndo ? 'Remove this opening balance' : "Can't remove — a payment is already recorded against it"}
                                                            style={{ background: 'none', border: 'none', cursor: r.canUndo ? 'pointer' : 'not-allowed', color: r.canUndo ? 'var(--color-text-secondary)' : 'var(--color-text-muted)', opacity: r.canUndo ? 1 : 0.5, padding: '4px' }}
                                                        ><Undo2 size={14} /></button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {isImportOpen && (
                <DataImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} type="purchase-opening-balance" onImport={handleImportRows} />
            )}
        </div>
    );
};

export default PurchaseSetupPage;
