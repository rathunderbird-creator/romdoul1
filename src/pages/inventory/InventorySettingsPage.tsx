// Inventory Settings — mockup built from reference screenshots. Nothing on
// this page is saved anywhere: costing method, the behaviour toggles and the
// GL account mappings are all local-only drafts. This is deliberately a
// mockup, not a feature — the app has no costing-method field, no per-stock
// GL account mapping config, and no stock-count workflow yet, so "Save"
// shows a toast rather than silently pretending to persist something real.
// The GL Accounts selects ARE populated from the real chart of accounts
// (pre-selected by matching account name, falling back to account code) so
// the mockup is honest about what each instance's chart of accounts
// actually has.
import React, { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, Landmark } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useAccounting } from '../../hooks/useAccounting';
import type { ChartOfAccount } from '../../types';

type TabKey = 'behaviour' | 'gl-accounts';
const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { key: 'behaviour', label: 'Behaviour', icon: SlidersHorizontal },
    { key: 'gl-accounts', label: 'GL Accounts', icon: Landmark },
];

interface AcctField { key: string; label: string; code: string; namePattern: RegExp; type?: ChartOfAccount['account_type']; help: string; required?: boolean }

// Matched by account_code first (the reference screenshot's demo codes), then
// by namePattern within the same account_type — this app's own chart of
// accounts doesn't necessarily use the same codes (e.g. this app's real
// Inventory account is 1300, confirmed by src/hooks/useStockAdjustments.ts,
// not 1200 as in the screenshot), so a code-only match can silently pick the
// wrong account by coincidence.
const REQUIRED_FIELDS: AcctField[] = [
    { key: 'inventoryAsset', label: 'Inventory asset', code: '1200', namePattern: /inventor|stock/i, type: 'Asset', required: true, help: 'Debited when stock arrives, credited when it leaves. Your balance-sheet stock value.' },
    { key: 'cogs', label: 'Cost of goods sold', code: '5000', namePattern: /cost of goods|cogs/i, type: 'Expense', required: true, help: 'Debited when a sales invoice is posted, for what the goods that left actually cost. Point this at your COGS account — an invoice will not post without it.' },
    { key: 'grni', label: 'Goods received not invoiced', code: '2050', namePattern: /goods received|accrued payable/i, type: 'Liability', required: true, help: 'Credited on every goods receipt. Nothing clears it automatically any more — settle it with a journal entry when you pay the supplier, or it will keep accruing.' },
    { key: 'inventoryAdjustment', label: 'Inventory adjustment', code: '5030', namePattern: /inventory adjust/i, type: 'Expense', required: true, help: 'The counter-account for corrections, theft and anything not otherwise routed. An expense account is right here — opening stock has its own account on the Behaviour tab, because it is value the business started with rather than a cost it incurred.' },
    { key: 'stockVariance', label: 'Stock variance', code: '5040', namePattern: /stock.*variance|count variance/i, type: 'Expense', required: true, help: 'Count differences, rounding residue and cost variances land here.' },
];

const OPTIONAL_FIELDS: AcctField[] = [
    { key: 'scrapWriteOff', label: 'Scrap / write-off', code: '5050', namePattern: /write.?off|scrap/i, type: 'Expense', help: 'Used for damage, expiry and sample write-offs. Falls back to Inventory adjustment.' },
    { key: 'salesRevenue', label: 'Sales revenue', code: '4000', namePattern: /sales revenue/i, type: 'Revenue', help: 'Credited when an invoice is posted, for the value of the goods sold. Required before an invoice can post.' },
    { key: 'accountsReceivable', label: 'Accounts receivable', code: '1100', namePattern: /accounts receivable/i, type: 'Asset', help: "Debited by an invoice and credited by a customer receipt. The company-wide default: a customer can be given an AR account of their own on their record, but never a per-category one — a receivable raised on one account and settled against another would never clear." },
    { key: 'customerDeposits', label: 'Customer deposits', code: '2010', namePattern: /customer deposit/i, type: 'Liability', help: 'A liability account (e.g. 2010 Customer Deposit). A receipt taken before the invoice exists is credited here rather than to receivables, and moves to receivables when you apply it to an invoice. Leave it unset and advances credit Accounts receivable as before.' },
    { key: 'outputVat', label: 'Output VAT payable', code: '2250', namePattern: /output vat|vat payable/i, type: 'Liability', help: 'Credited with the VAT charged on an invoice. Required as soon as any line carries a tax rate.' },
    { key: 'salesDiscounts', label: 'Sales discounts', code: '4020', namePattern: /sales discount/i, type: 'Revenue', help: 'Contra-revenue: debited with discounts given, so the gross and the discount are both visible. Leave it unset and discounts are simply netted off revenue instead.' },
    { key: 'salesReturns', label: 'Sales returns & allowances', code: '4010', namePattern: /sales return/i, type: 'Revenue', help: 'Contra-revenue: debited when goods come back, so gross sales and the returns rate stay readable on the income statement (e.g. 4010). Leave it unset and a return reduces the original revenue accounts instead, which balances but hides the returns figure entirely.' },
    { key: 'serviceRevenue', label: 'Service revenue', code: '4050', namePattern: /service revenue/i, type: 'Revenue', help: 'Credited for lines whose product is a service. Falls back to Sales revenue.' },
    { key: 'fxGainLoss', label: 'Foreign exchange gain / loss', code: '7100', namePattern: /foreign exchange|fx gain/i, help: 'Where the difference goes when a document is settled at a different rate than it was raised at (e.g. 7100). Only needed if you trade in more than one currency — without it, such a settlement is refused rather than left unbalanced.' },
    { key: 'loyaltyPointsPayable', label: 'Loyalty points payable', code: '2030', namePattern: /loyalty points/i, type: 'Liability', help: "What customers' unspent points are worth. Credited as points are earned, debited as they are spent or expire." },
    { key: 'loyaltyExpense', label: 'Loyalty & promotion expense', code: '6650', namePattern: /loyalty.*expense|promotion expense/i, type: 'Expense', help: 'The cost of points given away, and of wallet top-up bonuses. Expired points come back off it.' },
    { key: 'customerWalletPayable', label: 'Customer wallet payable', code: '2020', namePattern: /wallet payable/i, type: 'Liability', help: 'Money customers have loaded onto their e-wallet and not yet spent.' },
    { key: 'rentalDepositsHeld', label: 'Rental deposits held', code: '2040', namePattern: /rental deposit/i, type: 'Liability', help: 'Security deposits taken against rented equipment. Owed back to the customer, so a liability — and kept apart from customer deposits, which can be spent on any invoice.' },
    { key: 'rentalIncome', label: 'Rental income', code: '4060', namePattern: /rental income/i, type: 'Revenue', help: 'Rent invoiced on equipment rental contracts.' },
    { key: 'rentalDamageRecovery', label: 'Rental damage & loss recovery', code: '4310', namePattern: /rental damage/i, type: 'Revenue', help: 'Fees charged when rented equipment comes back damaged or does not come back.' },
];

const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' };
const helpStyle: React.CSSProperties = { fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.45, marginTop: '6px' };
const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
    background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
};
const saveBtn: React.CSSProperties = {
    padding: '10px 18px', borderRadius: '9px', border: 'none', background: 'var(--color-primary)', color: 'white',
    fontSize: '13px', fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start',
};

const InventorySettingsPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const { accounts, fetchAccounts } = useAccounting();

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Inventory Settings</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>How stock behaves, and which accounts it posts to.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

    const [tab, setTab] = useState<TabKey>('behaviour');

    // ── Behaviour (local draft only — nothing persists) ──
    const [costingMethod, setCostingMethod] = useState<'Average' | 'FIFO' | 'LIFO' | 'Manual'>('FIFO');
    const [allowNegativeStock, setAllowNegativeStock] = useState(false);
    const [allowBackdatedPosting, setAllowBackdatedPosting] = useState(false);
    const [postToGLAutomatically, setPostToGLAutomatically] = useState(true);
    const [blockExpiredIssue, setBlockExpiredIssue] = useState(true);
    const [requireBatchOnExpiry, setRequireBatchOnExpiry] = useState(true);

    const equityAccounts = useMemo(() => accounts.filter(a => a.is_active && a.account_type === 'Equity'), [accounts]);
    const openingDefault = useMemo(() => accounts.find(a => a.account_code === '3300') || equityAccounts[0], [accounts, equityAccounts]);
    const [openingStockAccountId, setOpeningStockAccountId] = useState('');

    const handleSaveBehaviour = () => showToast("Mockup only — behaviour settings aren't saved yet. Decide which of these the app actually needs before this gets built for real.", 'info');
    const handleSaveAccounts = () => showToast("Mockup only — GL account mappings aren't saved yet. Decide which of these the app actually needs before this gets built for real.", 'info');

    // ── GL Accounts (local draft, pre-selected against this instance's real
    // chart of accounts) ──
    const [mapping, setMapping] = useState<Record<string, string>>({});
    const accountsReady = accounts.length > 0;
    useEffect(() => {
        if (!accountsReady) return;
        const next: Record<string, string> = {};
        for (const f of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
            // A name match is unambiguous ("Inventory" means Inventory); a
            // code match just assumes this instance's numbering follows the
            // same convention as the reference screenshot's demo chart of
            // accounts, which it may not — so name wins when both exist.
            const typed = f.type ? accounts.filter(a => a.account_type === f.type) : accounts;
            const match = typed.find(a => f.namePattern.test(a.account_name)) || typed.find(a => a.account_code === f.code);
            if (match) next[f.key] = match.id;
        }
        setMapping(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountsReady]);

    const optionsFor = (field: AcctField) => accounts.filter(a => a.is_active && (!field.type || a.account_type === field.type));

    const AccountField: React.FC<{ field: AcctField }> = ({ field }) => {
        const opts = optionsFor(field);
        return (
            <div>
                <label style={labelStyle}>{field.label}{field.required ? ' *' : ''}</label>
                <select value={mapping[field.key] || ''} onChange={e => setMapping(m => ({ ...m, [field.key]: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="">— not set —</option>
                    {opts.map(a => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}
                </select>
                <div style={helpStyle}>{field.help}</div>
            </div>
        );
    };

    return (
        <div className="acct-page" style={{ maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '18px' }}>
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

            {tab === 'behaviour' && (
                <div style={{ ...cardStyle, padding: '20px 22px', maxWidth: '640px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                    <div>
                        <label style={labelStyle}>Default costing method</label>
                        <select value={costingMethod} onChange={e => setCostingMethod(e.target.value as typeof costingMethod)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            <option value="Average">Average (moving weighted)</option>
                            <option value="FIFO">FIFO</option>
                            <option value="LIFO">LIFO</option>
                            <option value="Manual">Manual (standard cost)</option>
                        </select>
                        <div style={helpStyle}>Applies to any product that does not choose its own. A product's method is locked once it holds stock.</div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--color-border)' }} />

                    {[
                        { checked: allowNegativeStock, set: setAllowNegativeStock, label: 'Allow negative stock', help: 'Off is recommended: perpetual inventory should refuse to issue stock you do not have, rather than guess at a cost.' },
                        { checked: allowBackdatedPosting, set: setAllowBackdatedPosting, label: 'Allow backdated posting', help: 'Off is recommended: FIFO orders cost layers by date, so a backdated receipt would claim a consumption order that never happened.' },
                        { checked: postToGLAutomatically, set: setPostToGLAutomatically, label: 'Post to the general ledger automatically', help: 'On: every stock movement writes its own journal entry. Off: quantities still move, but your accountant posts the value manually.' },
                        { checked: blockExpiredIssue, set: setBlockExpiredIssue, label: 'Block issuing expired batches', help: 'Expired stock can still be removed with a stock adjustment.' },
                        { checked: requireBatchOnExpiry, set: setRequireBatchOnExpiry, label: 'Require a batch on expiry-tracked products', help: 'Expiry dates are meaningless without a batch to attach them to.' },
                    ].map(row => (
                        <label key={row.label} style={{ display: 'flex', gap: '10px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={row.checked} onChange={e => row.set(e.target.checked)} style={{ marginTop: '2px', width: '15px', height: '15px', accentColor: 'var(--color-primary)', cursor: 'pointer', flexShrink: 0 }} />
                            <div>
                                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}>{row.label}</div>
                                <div style={{ ...helpStyle, marginTop: '2px' }}>{row.help}</div>
                            </div>
                        </label>
                    ))}

                    <div style={{ borderTop: '1px solid var(--color-border)' }} />

                    <div>
                        <label style={labelStyle}>Opening stock account</label>
                        <select value={openingStockAccountId} onChange={e => setOpeningStockAccountId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            <option value="">{openingDefault ? `Automatic (${openingDefault.account_code} ${openingDefault.account_name})` : 'Automatic'}</option>
                            {equityAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}
                        </select>
                        <div style={helpStyle}>The counter-entry for a stock adjustment with reason Opening Balance. Opening stock is value the business started with, not a cost it incurred, so it is offset against equity rather than an expense.</div>
                    </div>

                    <div>
                        <button onClick={handleSaveBehaviour} style={saveBtn}>Save settings</button>
                    </div>
                </div>
            )}

            {tab === 'gl-accounts' && (
                <div style={{ ...cardStyle, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        These are pre-filled from the default trading chart of accounts when your company is created. Anything you change here is kept — re-importing the chart only fills accounts that are still blank.
                    </p>

                    <div>
                        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>Required</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '18px' }}>
                            {REQUIRED_FIELDS.map(f => <AccountField key={f.key} field={f} />)}
                        </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--color-border)' }} />

                    <div>
                        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>Optional</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '18px' }}>
                            {OPTIONAL_FIELDS.map(f => <AccountField key={f.key} field={f} />)}
                        </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '18px' }}>
                        <button onClick={handleSaveAccounts} style={saveBtn}>Save accounts</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InventorySettingsPage;
