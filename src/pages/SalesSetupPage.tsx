// Sales Setup — defaults for new sell-side documents (modeled on the reference
// design): a left-nav settings page in the same family as Purchase Setup and
// Wholesale Setup. In the Defaults section the default deposit accounts are
// real (app_config salesSettings); the other designed fields have no retail
// consumer yet, so they are listed read-only under "Not used yet" with what
// the app does today, instead of inputs that look saved but aren't. Page Name, Shipping
// Company (with each courier's cost per parcel, tracking link and "Get File
// books the COD receipt"), Pay By, Salesmen, Customer Care and Provinces are
// real, store-backed settings. The remaining sections are placeholders until their own data
// model exists.
import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    SlidersHorizontal, Tag, Tags, Users, MapPin, Percent, Truck, Ban, Landmark,
    Megaphone, Building2, Plus, Trash2, Wallet, UserCheck, Headphones
} from 'lucide-react';
import { useHeader } from '../context/HeaderContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { fill } from '../i18n/translate';
// The Provinces section: address tree (gazetteer + custom/hidden districts
// and communes) with the Shipping Points in each commune.
import ProvincesSection from './salesSetup/ProvincesSection';
import { getFileBooksCod, isCashBankAccount, isCodPaymentMethod } from '../utils/cashBankAccounts';
import { isKhrAccountName } from '../utils/currency';
import { useAccounting } from '../hooks/useAccounting';
import type { SalesSettings } from '../types';
import { discountPresetProblem, discountPresetValueLabel } from '../utils/discountPresets';
import { courierDeliveryType } from '../utils/deliveryTypes';
import { MAX_QUOTATION_VALIDITY_DAYS, quotationValidityDays, quotationValidityInput } from '../utils/quotationValidity';
import {
    DEFAULT_PAYMENT_REQUEST_MESSAGE, MAX_PAYMENT_REQUEST_LENGTH, PAYMENT_REQUEST_FIELDS, fillPaymentRequest,
    paymentRequestInput, paymentRequestTemplate, paymentRequestText, unknownPaymentRequestFields,
} from '../utils/paymentRequest';
import { DEFAULT_TRACKING_TEMPLATES, detectCarrier } from '../utils/tracking';

type SectionKey =
    | 'defaults' | 'paymentTerms' | 'priceLevels' | 'customerGroups' | 'provinces'
    | 'discounts' | 'deliveryTypes' | 'rejectionReasons' | 'openingBalances'
    | 'pageNames' | 'shippingCompanies' | 'payBy' | 'salesmen' | 'customerCare';

const SECTIONS: { key: SectionKey; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { key: 'defaults', label: 'Defaults', icon: SlidersHorizontal },
    { key: 'paymentTerms', label: 'Payment Terms', icon: Tag },
    { key: 'priceLevels', label: 'Price Levels', icon: Tags },
    { key: 'customerGroups', label: 'Customer Groups', icon: Users },
    { key: 'provinces', label: 'Provinces', icon: MapPin },
    { key: 'discounts', label: 'Discounts', icon: Percent },
    { key: 'deliveryTypes', label: 'Delivery Types', icon: Truck },
    { key: 'pageNames', label: 'Page Name', icon: Megaphone },
    { key: 'shippingCompanies', label: 'Shipping Company', icon: Building2 },
    { key: 'payBy', label: 'Pay By', icon: Wallet },
    { key: 'salesmen', label: 'Salesmen', icon: UserCheck },
    { key: 'customerCare', label: 'Customer Care', icon: Headphones },
    { key: 'rejectionReasons', label: 'Rejection Reasons', icon: Ban },
    { key: 'openingBalances', label: 'Opening Balances', icon: Landmark },
];

// Sections not in this set fall through to the "reserved" placeholder below.
const LIST_SECTIONS = new Set<SectionKey>(['pageNames', 'shippingCompanies', 'payBy', 'salesmen', 'customerCare', 'provinces', 'rejectionReasons', 'discounts', 'deliveryTypes']);

// Add/remove UI for a flat string list backed by the store's config blob
// (same data CheckoutForm's gear-icon ConfigModal edits — this just gives it
// a proper home in Setup instead of only being reachable mid-checkout).
const SetupListSection: React.FC<{
    title: string; placeholder: string; items: string[];
    onAdd: (name: string) => Promise<unknown>; onRemove: (name: string) => Promise<unknown>;
    // Optional: a line of help under the title, and per-row fields under each item.
    help?: string; renderRowExtra?: (item: string) => React.ReactNode;
    // Optional: a row this list cannot remove shows this note instead of the
    // Remove button (e.g. a Customer Care name that comes from Users).
    lockedNote?: (item: string) => string | null;
}> = ({ title, placeholder, items, onAdd, onRemove, help, renderRowExtra, lockedNote }) => {
    const { showToast } = useToast();
    const { t } = useLanguage();
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);

    const reportError = (err: any) => showToast(fill(t('ui.admin.salesSetup.saveFailed'), { error: err?.message || t('ui.admin.salesSetup.unknownError') }), 'error');

    const handleAdd = () => {
        const name = draft.trim();
        if (!name || busy) return;
        // Already listed: nothing to save (the database would skip it too).
        if (items.includes(name)) { setDraft(''); return; }
        setBusy(true);
        Promise.resolve(onAdd(name)).catch(reportError).finally(() => setBusy(false));
        setDraft('');
    };

    // One save at a time, like add: a list saved whole (defaults on screen)
    // must not be built from a read taken before another remove landed.
    const handleRemove = (name: string) => {
        if (busy) return;
        setBusy(true);
        Promise.resolve(onRemove(name)).catch(reportError).finally(() => setBusy(false));
    };

    return (
        <div style={{ ...cardStyle, padding: '20px 22px', flex: '1 1 560px', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>{title}</div>
            {help && <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{help}</p>}
            <div style={{ display: 'flex', gap: '8px' }}>
                <input
                    type="text" value={draft} placeholder={placeholder} className="search-input"
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                    style={{ flex: 1, padding: '9px 12px' }}
                />
                <button onClick={handleAdd} disabled={!draft.trim() || busy} className="primary-button"
                    style={{ padding: '0 14px', cursor: (!draft.trim() || busy) ? 'not-allowed' : 'pointer', opacity: (!draft.trim() || busy) ? 0.6 : 1 }}>
                    <Plus size={16} />
                </button>
            </div>
            <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                {items.length === 0 ? (
                    <div style={{ padding: '18px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-secondary)' }}>{t('ui.admin.salesSetup.noneYet')}</div>
                ) : items.map(item => (
                    <div key={item} style={{ padding: '9px 12px', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: 'var(--color-text-main)' }}>
                            <span style={{ fontWeight: renderRowExtra ? 600 : 400 }}>{item}</span>
                            {lockedNote?.(item) ? (
                                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{lockedNote(item)}</span>
                            ) : <button onClick={() => handleRemove(item)} title={fill(t('ui.admin.salesSetup.removeItem'), { name: item })} aria-label={fill(t('ui.admin.salesSetup.removeItem'), { name: item })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                <Trash2 size={15} />
                            </button>}
                        </div>
                        {renderRowExtra && renderRowExtra(item)}
                    </div>
                ))}
            </div>
        </div>
    );
};

// A courier's cost per parcel (app_config shippingRates — the Shipping
// report's rates) and tracking link (trackingUrlTemplates, {tracking} = the
// waybill number; J&T has a built-in one). Each saves on blur / Enter, and
// only when it changed, as a write scoped to its own key.
const ShippingCompanyFields: React.FC<{ company: string }> = ({ company }) => {
    const { shippingRates, updateShippingRate, trackingUrlTemplates, updateTrackingUrlTemplate } = useStore();
    const { showToast } = useToast();
    const { t } = useLanguage();
    const idBase = useId();
    const savedRate = shippingRates?.[company];
    const savedLink = trackingUrlTemplates?.[company] || '';
    const carrier = detectCarrier(company);
    const builtIn = carrier ? DEFAULT_TRACKING_TEMPLATES[carrier] : '';
    const [rate, setRate] = useState<string | null>(null);
    const [link, setLink] = useState<string | null>(null);
    const fail = (err: unknown) => showToast(fill(t('ui.admin.salesSetup.saveFailed'), { error: (err as Error)?.message || t('ui.admin.salesSetup.unknownError') }), 'error');
    const commitRate = () => {
        if (rate === null) return;
        const typed = rate.trim();
        setRate(null);
        const val = typed === '' ? 0 : Number(typed);
        if (!Number.isFinite(val) || val < 0) { showToast(t('ui.admin.salesSetup.courier.badRate'), 'error'); return; }
        if (Math.round(val * 100) === Math.round((savedRate || 0) * 100)) return;
        updateShippingRate(company, Math.round(val * 100) / 100).catch(fail);
    };
    const commitLink = () => {
        if (link === null) return;
        const typed = link.trim();
        setLink(null);
        if (typed === savedLink.trim()) return;
        updateTrackingUrlTemplate(company, typed).catch(fail);
    };
    const enterBlurs = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); };
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 140px) 1fr', gap: '10px', marginTop: '8px' }}>
            <div>
                <label htmlFor={idBase + '-rate'} style={{ ...labelStyle, fontSize: '11.5px', marginBottom: '4px' }}>{t('ui.admin.salesSetup.courier.costPerParcel')}</label>
                <input id={idBase + '-rate'} type="number" min="0" step="0.01" inputMode="decimal" className="setup-field"
                    value={rate !== null ? rate : (savedRate ? String(savedRate) : '')} placeholder="0.00"
                    onChange={e => setRate(e.target.value)} onBlur={commitRate} onKeyDown={enterBlurs}
                    style={{ ...inputStyle, padding: '7px 10px' }} />
            </div>
            <div style={{ minWidth: 0 }}>
                <label htmlFor={idBase + '-link'} style={{ ...labelStyle, fontSize: '11.5px', marginBottom: '4px' }}>{t('ui.admin.salesSetup.courier.trackingLink')}</label>
                <input id={idBase + '-link'} type="url" className="setup-field"
                    value={link !== null ? link : savedLink}
                    placeholder={builtIn ? fill(t('ui.admin.salesSetup.courier.builtIn'), { url: builtIn }) : 'https://carrier.example/track?no={tracking}'}
                    onChange={e => setLink(e.target.value)} onBlur={commitLink} onKeyDown={enterBlurs}
                    style={{ ...inputStyle, padding: '7px 10px', fontSize: '12px' }} />
            </div>
        </div>
    );
};

// A card of ticks over one of the lists above (a courier, a Pay By): each
// tick saves on its own (append / removeItems), like the lists themselves.
// `labels` is the i18n branch: title, help, on, off.
const TickListSection: React.FC<{
    labels: string;
    items: string[];
    list: string[];
    isOn: (list: readonly string[], name: string) => boolean;
    save: (name: string, on: boolean) => Promise<void>;
}> = ({ labels, items, list, isOn, save }) => {
    const { showToast } = useToast();
    const { t } = useLanguage();
    const [busy, setBusy] = useState<string | null>(null);
    const toggle = (name: string, on: boolean) => {
        if (busy) return;
        setBusy(name);
        save(name, on)
            .catch((err: unknown) => showToast(fill(t('ui.admin.salesSetup.saveFailed'), { error: (err as Error)?.message || t('ui.admin.salesSetup.unknownError') }), 'error'))
            .finally(() => setBusy(null));
    };
    return (
        <div style={{ ...cardStyle, padding: '20px 22px', flex: '1 1 560px', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>{t(`${labels}.title`)}</div>
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{t(`${labels}.help`)}</p>
            <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                {items.length === 0 ? (
                    <div style={{ padding: '18px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-secondary)' }}>{t('ui.admin.salesSetup.noneYet')}</div>
                ) : items.map(name => {
                    const on = isOn(list, name);
                    return (
                        <label key={name} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderBottom: '1px solid var(--color-border)', fontSize: '13px', color: 'var(--color-text-main)', cursor: busy ? 'wait' : 'pointer' }}>
                            <input type="checkbox" checked={on} disabled={!!busy} onChange={e => toggle(name, e.target.checked)}
                                style={{ width: '16px', height: '16px', cursor: busy ? 'wait' : 'pointer' }} />
                            <span style={{ flex: 1 }}>{name}</span>
                            <span style={{ fontSize: '12px', color: on ? '#4c5fd0' : 'var(--color-text-secondary)', fontWeight: on ? 600 : 400 }}>
                                {on ? t(`${labels}.on`) : t(`${labels}.off`)}
                            </span>
                        </label>
                    );
                })}
            </div>
        </div>
    );
};

// Which couriers' "Get File" books the order's receipt at once to 1210 COD
// receivable (courier) — app_config.codGetFileCompanies, read by the
// database's set_order_payment (migrations/add_order_payment_functions.sql).
const CodGetFileSection: React.FC = () => {
    const { shippingCompanies, codGetFileCompanies, setCodGetFileCompany } = useStore();
    return <TickListSection labels="ui.admin.salesSetup.codGetFile" items={shippingCompanies} list={codGetFileCompanies}
        isOn={getFileBooksCod} save={setCodGetFileCompany} />;
};

// Which Pay By methods mean "the courier collects": an order paid by one of
// them opens the Settle / Record Receipt / Checkout "អ្នកដឹកប្រមូល (COD)"
// box ticked, so its receipt lands on 1210 COD receivable (courier) —
// app_config.codPaymentMethods, also read by set_order_payment
// (wp_internal.op_cod_method) when a save says nothing about the flag.
// Never saved: a Method named COD, if there is one.
const CodMethodsSection: React.FC = () => {
    const { paymentMethods, codPaymentMethods, setCodPaymentMethod } = useStore();
    return <TickListSection labels="ui.admin.salesSetup.codMethods" items={paymentMethods} list={codPaymentMethods}
        isOn={isCodPaymentMethod} save={setCodPaymentMethod} />;
};

// ── Styles (the flat-card family used across the app's other Setup pages) ──
// var(--color-text-secondary), not --color-text-muted, for caption/help copy:
// at this 12-12.5px size --color-text-muted falls under the WCAG AA 4.5:1
// minimum on both the light and dark surface tokens; text-secondary clears it.
const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' };
const helpStyle: React.CSSProperties = { fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.45, marginTop: '6px' };
// className (not just the inline style) so .setup-field:focus below can draw a
// ring — an inline style has no :focus state of its own, and this page would
// otherwise suppress the browser's default outline with nothing to replace it.
const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--color-border)',
    background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
};

// Defaults › Default deposit account: the cash/bank account retail receipts,
// deposits and delivery fees go to when nobody picks one — one for USD, one
// for riel (app_config salesSettings). Pre-selected in the Settle, Deposit,
// Delivery Fee and Record Receipt forms, and used by bulk Paid, the Orders
// Management drawer and Customer Payment › Post Now. A Cash method still goes
// to Cash on Hand of that currency, and a COD receipt stays on 1210. Each
// select saves on change, as its own field.
const DepositAccountDefaults: React.FC<{ fieldId: (name: string) => string }> = ({ fieldId }) => {
    const { t } = useLanguage();
    const { showToast } = useToast();
    const { salesSettings, updateSalesSetting } = useStore();
    const { accounts, fetchAccounts } = useAccounting();
    React.useEffect(() => { fetchAccounts(); }, [fetchAccounts]);
    const cashBank = React.useMemo(() => accounts
        // Never Petty Cash: a customer's payment is not received into the
        // petty-cash float (the Settle form leaves it out too).
        .filter(a => a.is_active !== false && isCashBankAccount(a) && !/petty/i.test(a.account_name))
        .sort((a, b) => (a.account_code || '').localeCompare(b.account_code || '')), [accounts]);
    const rows: { key: keyof SalesSettings; khr: boolean; label: string }[] = [
        { key: 'defaultDepositAccountId', khr: false, label: t('ui.admin.salesSetup.depositAccountUsd') },
        { key: 'defaultDepositAccountIdKhr', khr: true, label: t('ui.admin.salesSetup.depositAccountKhr') },
    ];
    const save = (key: keyof SalesSettings, value: string) => {
        updateSalesSetting(key, value).catch((err: unknown) => showToast(fill(t('ui.admin.salesSetup.saveFailed'),
            { error: (err as Error)?.message || t('ui.admin.salesSetup.unknownError') }), 'error'));
    };
    return (
        <div>
            <div style={labelStyle}>{t('ui.admin.salesSetup.depositAccount')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                {rows.map(r => {
                    const list = cashBank.filter(a => isKhrAccountName(a.account_name) === r.khr);
                    const current = salesSettings[r.key] || '';
                    // A saved account that was removed or deactivated reads as
                    // Automatic (the posting helpers ignore it the same way).
                    const value = list.some(a => a.id === current) ? current : '';
                    return (
                        <div key={r.key}>
                            <label htmlFor={fieldId(r.key)} style={{ ...labelStyle, fontWeight: 500 }}>{r.label}</label>
                            <select id={fieldId(r.key)} value={value} className="setup-field" style={{ ...inputStyle, cursor: 'pointer' }}
                                onChange={e => save(r.key, e.target.value)}>
                                <option value="">{t('ui.admin.salesSetup.depositAccountAuto')}</option>
                                {list.map(a => <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}
                            </select>
                        </div>
                    );
                })}
            </div>
            <div style={helpStyle}>{t('ui.admin.salesSetup.depositAccountHelp')}</div>
        </div>
    );
};

// Defaults › Quotation validity (days): CRM › Quotations pre-fills a new
// quote's Valid until with today + this. Saves on leaving the field (or
// Enter) as its own salesSettings field; empty clears it.
const QuotationValidityDefault: React.FC<{ fieldId: (name: string) => string }> = ({ fieldId }) => {
    const { t } = useLanguage();
    const { showToast } = useToast();
    const { salesSettings, updateSalesSetting } = useStore();
    const saved = quotationValidityDays(salesSettings.quotationValidityDays);
    const savedText = saved === null ? '' : String(saved);
    const [draft, setDraft] = useState(savedText);
    const [bad, setBad] = useState(false);
    const [saving, setSaving] = useState(false);
    // Follow a save made elsewhere (another tab, another user).
    React.useEffect(() => { setDraft(savedText); setBad(false); }, [savedText]);
    const commit = () => {
        if (saving) return; // one save at a time (Enter, then the blur that follows)
        const value = quotationValidityInput(draft);
        if (value === null) { setBad(true); return; }
        setBad(false);
        if (value === savedText) { setDraft(savedText); return; }
        setSaving(true);
        updateSalesSetting('quotationValidityDays', value)
            .catch((err: unknown) => {
                setDraft(savedText);
                showToast(fill(t('ui.admin.salesSetup.saveFailed'), { error: (err as Error)?.message || t('ui.admin.salesSetup.unknownError') }), 'error');
            })
            .finally(() => setSaving(false));
    };
    const id = fieldId('quotationValidityDays');
    return (
        <div>
            <label htmlFor={id} style={labelStyle}>{t('ui.admin.salesSetup.quotationValidity')}</label>
            {/* type=text: a number input reports unparseable text ("14e") as "",
                which would read as Clear; quotationValidityInput judges the raw text.
                readOnly while saving keeps keyboard focus (disabled would drop it). */}
            <input id={id} type="text" inputMode="numeric" autoComplete="off"
                className="setup-field" style={{ ...inputStyle, maxWidth: '160px' }}
                value={draft} readOnly={saving} aria-busy={saving} placeholder={t('ui.admin.salesSetup.quotationValidityNone')}
                aria-invalid={bad} aria-describedby={`${id}-help`}
                onChange={e => { setDraft(e.target.value); setBad(false); }}
                onBlur={commit}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
            <div id={`${id}-help`} style={{ ...helpStyle, color: bad ? 'var(--color-red)' : helpStyle.color }}>
                {bad ? fill(t('ui.admin.salesSetup.quotationValidityBad'), { max: MAX_QUOTATION_VALIDITY_DAYS }) : t('ui.admin.salesSetup.quotationValidityHelp')}
            </div>
        </div>
    );
};

// Defaults › Payment request message: the text Order Details › Copy payment
// request fills from an order. Saves on leaving the box (empty, or the
// default text, goes back to the default); a sample shows the result.
const PAYMENT_REQUEST_SAMPLE: Record<string, string> = {
    name: 'Sok Dara', phone: '012 345 678', order: '07', date: '20-11-2026',
    items: ['- Rice cooker x1 ($25.00)', '- Kettle x2 ($20.00)'].join('\n'), total: '$45.00', paid: '$10.00',
    due: '$35.00', dueKhr: '៛143,500', page: 'Romdoul Page', store: 'Romdoul',
};
const PaymentRequestDefault: React.FC<{ fieldId: (name: string) => string }> = ({ fieldId }) => {
    const { t } = useLanguage();
    const { showToast } = useToast();
    const { salesSettings, updateSalesSetting, storeName } = useStore();
    const savedRaw = typeof salesSettings.paymentRequestMessage === 'string' ? salesSettings.paymentRequestMessage : '';
    const current = paymentRequestTemplate(savedRaw);
    const [draft, setDraft] = useState(current);
    const [saving, setSaving] = useState(false);
    // Follow a save made elsewhere (another tab, another user).
    React.useEffect(() => { setDraft(current); }, [current]);
    // The saved text's length (ends trimmed), the same rule the save uses.
    const savedLength = paymentRequestText(draft).length;
    const tooLong = paymentRequestInput(draft) === null;
    const unknown = unknownPaymentRequestFields(draft);
    const save = (value: string) => {
        if (saving) return;
        if (value === (savedRaw.trim() ? savedRaw : '')) { setDraft(paymentRequestTemplate(value)); return; }
        setSaving(true);
        updateSalesSetting('paymentRequestMessage', value)
            .catch((err: unknown) => {
                setDraft(current);
                showToast(fill(t('ui.admin.salesSetup.saveFailed'), { error: (err as Error)?.message || t('ui.admin.salesSetup.unknownError') }), 'error');
            })
            .finally(() => setSaving(false));
    };
    const commit = () => {
        const value = paymentRequestInput(draft);
        if (value === null) return; // too long: the message below says so
        save(value);
    };
    const id = fieldId('paymentRequestMessage');
    const preview = fillPaymentRequest(draft, { ...PAYMENT_REQUEST_SAMPLE, store: storeName || PAYMENT_REQUEST_SAMPLE.store });
    const isDefault = !savedRaw.trim();
    return (
        <div>
            <label htmlFor={id} style={labelStyle}>{t('ui.admin.salesSetup.paymentRequestMessage')}</label>
            {/* readOnly while saving keeps focus (disabled would drop it). */}
            <textarea id={id} className="setup-field" rows={8} value={draft} readOnly={saving} aria-busy={saving}
                aria-invalid={tooLong} aria-describedby={`${id}-help`}
                style={{ ...inputStyle, fontFamily: 'inherit', lineHeight: 1.45, resize: 'vertical' }}
                onChange={e => setDraft(e.target.value)} onBlur={commit} />
            <div id={`${id}-help`} style={helpStyle}>
                {t('ui.admin.salesSetup.paymentRequestHelp')}{' '}
                {PAYMENT_REQUEST_FIELDS.map((f, i) => <React.Fragment key={f}>{i ? ' ' : ''}<code>{'{' + f + '}'}</code></React.Fragment>)}
            </div>
            {tooLong && (
                <div role="alert" style={{ ...helpStyle, color: 'var(--color-red)' }}>
                    {fill(t('ui.admin.salesSetup.paymentRequestTooLong'), { max: MAX_PAYMENT_REQUEST_LENGTH, n: savedLength })}
                </div>
            )}
            {!tooLong && unknown.length > 0 && (
                <div role="status" style={{ ...helpStyle, color: 'var(--color-text-main)' }}>
                    {fill(t('ui.admin.salesSetup.paymentRequestUnknown'), { fields: unknown.map(f => '{' + f + '}').join(', ') })}
                </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', flexWrap: 'wrap' }}>
                <span style={{ ...helpStyle, marginTop: 0 }}>{t(isDefault ? 'ui.admin.salesSetup.paymentRequestIsDefault' : 'ui.admin.salesSetup.paymentRequestIsCustom')}</span>
                {!isDefault && (
                    <button type="button" className="secondary-button" disabled={saving}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setDraft(DEFAULT_PAYMENT_REQUEST_MESSAGE); save(''); }}
                        style={{ padding: '5px 10px', fontSize: '12px' }}>
                        {t('ui.admin.salesSetup.paymentRequestReset')}
                    </button>
                )}
            </div>
            <div style={{ ...labelStyle, fontWeight: 500, marginTop: '12px' }}>{t('ui.admin.salesSetup.paymentRequestPreview')}</div>
            <pre style={{ margin: 0, padding: '10px 12px', borderRadius: '8px', background: 'var(--color-bg)', border: '1px dashed var(--color-border)', fontFamily: 'inherit', fontSize: '12.5px', color: 'var(--color-text-main)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45 }}>
                {preview}
            </pre>
        </div>
    );
};

// Delivery Types › each shipping company's type. An order shows its
// courier's type (Orders "Delivery type" column), past orders too, so this
// is the only place a type is set. Each select saves on change.
const CourierDeliveryTypes: React.FC = () => {
    const { t } = useLanguage();
    const { showToast } = useToast();
    const { shippingCompanies, deliveryTypes, courierDeliveryTypes, setCourierDeliveryType } = useStore();
    const idBase = useId();
    const [busy, setBusy] = useState<string | null>(null);
    const change = (company: string, type: string) => {
        if (busy) return;
        setBusy(company);
        setCourierDeliveryType(company, type)
            .catch((err: unknown) => showToast(fill(t('ui.admin.salesSetup.saveFailed'), { error: (err as Error)?.message || t('ui.admin.salesSetup.unknownError') }), 'error'))
            .finally(() => setBusy(null));
    };
    return (
        <div style={{ ...cardStyle, padding: '20px 22px', flex: '1 1 560px', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>{t('ui.admin.salesSetup.deliveryType.byCourier')}</div>
                <div style={helpStyle}>{t('ui.admin.salesSetup.deliveryType.byCourierHelp')}</div>
            </div>
            <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                {shippingCompanies.length === 0 ? (
                    <div style={{ padding: '18px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-secondary)' }}>{t('ui.admin.salesSetup.noneYet')}</div>
                ) : shippingCompanies.map((company, i) => {
                    const current = courierDeliveryType(courierDeliveryTypes, company);
                    // A type removed from the list (or another spelling) still shows.
                    const options = current && !deliveryTypes.includes(current) ? [...deliveryTypes, current] : deliveryTypes;
                    return (
                        <div key={company} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 1fr) minmax(150px, 1.4fr)', gap: '10px', alignItems: 'center', padding: '8px 14px', borderTop: i ? '1px solid var(--color-border)' : 'none' }}>
                            <label htmlFor={`${idBase}-${i}`} style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{company}</label>
                            <select id={`${idBase}-${i}`} className="setup-field" value={current} disabled={!!busy}
                                onChange={e => change(company, e.target.value)} style={{ ...inputStyle, padding: '7px 10px', cursor: 'pointer' }}>
                                <option value="">{t('ui.admin.salesSetup.deliveryType.none')}</option>
                                {options.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// Discounts: presets offered as quick picks next to Checkout's discount
// field (app_config discountPresets). A pick fills the USD discount — a
// percent of the items' price, or a fixed amount — and stays editable.
const DiscountsSection: React.FC = () => {
    const { t } = useLanguage();
    const { showToast } = useToast();
    const { discountPresets, addDiscountPreset, removeDiscountPreset } = useStore();
    const idBase = useId();
    const [name, setName] = useState('');
    const [type, setType] = useState<'pct' | 'usd'>('pct');
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    // An add was tried: an empty name or value is then an error, not "still typing".
    const [tried, setTried] = useState(false);
    const fail = (err: unknown) => showToast(fill(t('ui.admin.salesSetup.saveFailed'), { error: (err as Error)?.message || t('ui.admin.salesSetup.unknownError') }), 'error');
    const problem = discountPresetProblem(discountPresets, name, type, value);
    const shownProblem = problem && (tried || (problem !== 'needName' && !(problem === 'badValue' && value.trim() === ''))) ? problem : null;
    const nameBad = shownProblem === 'needName' || shownProblem === 'duplicate';
    const valueBad = shownProblem === 'badValue' || shownProblem === 'pctOver100';
    const add = async () => {
        if (busy) return;
        if (problem) { setTried(true); return; }
        setBusy(true);
        try {
            await addDiscountPreset({ name: name.trim(), type, value: Number(value) });
            setName(''); setValue(''); setTried(false);
        } catch (err) { fail(err); } finally { setBusy(false); }
    };
    const remove = async (n: string) => {
        if (busy) return;
        setBusy(true);
        try { await removeDiscountPreset(n); } catch (err) { fail(err); } finally { setBusy(false); }
    };
    const enterAdds = (e: React.KeyboardEvent) => { if (e.key === 'Enter') add(); };
    return (
        <div style={{ ...cardStyle, padding: '20px 22px', flex: '1 1 560px', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>{t('ui.admin.salesSetup.sections.discounts')}</div>
                <div style={helpStyle}>{t('ui.admin.salesSetup.discount.help')}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: '8px', alignItems: 'end' }}>
                <div>
                    <label htmlFor={idBase + '-name'} style={labelStyle}>{t('ui.admin.salesSetup.discount.name')}</label>
                    <input id={idBase + '-name'} className="setup-field" value={name} maxLength={40} placeholder={t('ui.admin.salesSetup.discount.namePlaceholder')}
                        onChange={e => setName(e.target.value)} onKeyDown={enterAdds} aria-invalid={nameBad} aria-describedby={nameBad ? idBase + '-err' : undefined} style={inputStyle} />
                </div>
                <div>
                    <label htmlFor={idBase + '-type'} style={labelStyle}>{t('ui.admin.salesSetup.discount.type')}</label>
                    <select id={idBase + '-type'} className="setup-field" value={type} onChange={e => setType(e.target.value as 'pct' | 'usd')} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="pct">{t('ui.admin.salesSetup.discount.pct')}</option>
                        <option value="usd">{t('ui.admin.salesSetup.discount.usd')}</option>
                    </select>
                </div>
                <div>
                    <label htmlFor={idBase + '-value'} style={labelStyle}>{type === 'pct' ? t('ui.admin.salesSetup.discount.valuePct') : t('ui.admin.salesSetup.discount.valueUsd')}</label>
                    <input id={idBase + '-value'} className="setup-field" type="number" min="0" step="0.01" inputMode="decimal" value={value} placeholder={type === 'pct' ? '10' : '2.00'}
                        onChange={e => setValue(e.target.value)} onKeyDown={enterAdds} aria-invalid={valueBad} aria-describedby={valueBad ? idBase + '-err' : undefined} style={inputStyle} />
                </div>
                <button onClick={add} disabled={busy} aria-disabled={!!problem} className="primary-button"
                    style={{ padding: '9px 14px', borderRadius: '9px', border: 'none', background: 'var(--color-primary)', color: 'white', fontSize: '13px', fontWeight: 700, cursor: problem || busy ? 'not-allowed' : 'pointer', opacity: problem || busy ? 0.6 : 1 }}>
                    {t('ui.admin.salesSetup.discount.add')}
                </button>
            </div>
            {shownProblem && <div id={idBase + '-err'} role="alert" style={{ fontSize: '12px', color: '#DC2626' }}>{t(`ui.admin.salesSetup.discount.${shownProblem}`)}</div>}
            <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                {discountPresets.length === 0 ? (
                    <div style={{ padding: '18px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-secondary)' }}>{t('ui.admin.salesSetup.noneYet')}</div>
                ) : discountPresets.map((p, i) => (
                    <div key={p.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 14px', borderTop: i ? '1px solid var(--color-border)' : 'none' }}>
                        <span style={{ fontSize: '13px', color: 'var(--color-text-main)' }}>
                            <b>{p.name}</b> <span style={{ color: 'var(--color-text-secondary)' }}>· {discountPresetValueLabel(p)}</span>
                        </span>
                        <button onClick={() => remove(p.name)} disabled={busy} title={fill(t('ui.admin.salesSetup.removeItem'), { name: p.name })} aria-label={fill(t('ui.admin.salesSetup.removeItem'), { name: p.name })}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                            <Trash2 size={15} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Defaults › Not used yet: the designed fields nothing in retail reads. Each
// row says what the app does today, so no one types into a field that
// saves nothing. Wired up one by one as each gets a real consumer.
const NOT_USED_ROWS: { label: string; today: string }[] = [
    { label: 'vatRate', today: 'vat' },
    { label: 'paymentTermsDays', today: 'paymentTerms' },
    { label: 'defaultWarehouse', today: 'warehouse' },
    { label: 'holdsStock', today: 'holdsStock' },
    { label: 'documentNumbering', today: 'numbering' },
];
const NotUsedYet: React.FC = () => {
    const { t } = useLanguage();
    return (
        <section aria-labelledby="sales-setup-not-used" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '14px' }}>
            <div id="sales-setup-not-used" style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>{t('ui.admin.salesSetup.notUsed.title')}</div>
            <div style={{ ...helpStyle, marginTop: '2px', marginBottom: '10px' }}>{t('ui.admin.salesSetup.notUsed.intro')}</div>
            <dl style={{ margin: 0, border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                {NOT_USED_ROWS.map((r, i) => (
                    <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 200px) 1fr', gap: '4px 14px', padding: '9px 14px', borderTop: i ? '1px solid var(--color-border)' : 'none', background: 'var(--color-bg)' }}>
                        <dt style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{t(`ui.admin.salesSetup.${r.label}`)}</dt>
                        <dd style={{ margin: 0, fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: 1.45 }}>{t(`ui.admin.salesSetup.notUsed.${r.today}`)}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
};

// Sections with nothing in retail to connect to: a note, and a link where
// the wholesale side already has it (Wholesale Setup, opened on that tab).
const POINTER_SECTIONS = new Set<SectionKey>(['paymentTerms', 'openingBalances', 'priceLevels', 'customerGroups']);
const POINTER_LINKS: Partial<Record<SectionKey, string>> = {
    paymentTerms: '/wholesale/setup?tab=terms',
    openingBalances: '/wholesale/setup?tab=opening',
};
const PointerSection: React.FC<{ section: SectionKey }> = ({ section }) => {
    const { t } = useLanguage();
    const link = POINTER_LINKS[section];
    return (
        <div style={{ ...cardStyle, padding: '20px 22px', flex: '1 1 560px', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>{t(`ui.admin.salesSetup.sections.${section}`)}</div>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{t(`ui.admin.salesSetup.pointer.${section}`)}</p>
            {link && (
                <Link to={link} style={{ alignSelf: 'flex-start', padding: '9px 14px', borderRadius: '9px', background: 'var(--color-primary)', color: 'white', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>
                    {t(`ui.admin.salesSetup.pointer.${section}Link`)}
                </Link>
            )}
        </div>
    );
};

const SalesSetupPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();
    const {
        pages, shippingCompanies, addPage, removePage, addShippingCompany, removeShippingCompany, paymentMethods, addPaymentMethod, removePaymentMethod,
        salesmen, addSalesman, removeSalesman, customerCare, addCustomerCare, removeCustomerCare, users,
        rejectionReasons, addRejectionReason, removeRejectionReason,
        deliveryTypes, addDeliveryType, removeDeliveryType,
    } = useStore();
    // The store's customerCare list also carries every user whose role is
    // Customer Care or Admin; those rows come from Users and cannot be
    // removed here (removing only edits the configured names).
    const careFromUsers = React.useMemo(() => new Set(users
        .filter(u => u.roleId === 'customer_care' || u.roleId === 'admin')
        .map(u => u.name)), [users]);
    const [section, setSection] = useState<SectionKey>('defaults');
    // Stable per-mount ids so every <label> is programmatically associated
    // with its control (htmlFor/id) — required for its accessible name,
    // independent of the checkbox's own wrapping-label association below.
    const idPrefix = useId();
    const fieldId = (name: string) => `${idPrefix}-${name}`;

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>{t('nav.salesSetup')}</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>{t('ui.admin.salesSetup.subtitle')}</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

    const activeSection = SECTIONS.find(s => s.key === section)!;
    const sectionLabel = (key: SectionKey) => t(`ui.admin.salesSetup.sections.${key}`);

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)', display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Left-nav — same section family as Purchase Setup / Wholesale Setup,
                laid out as a sidebar (matching the mockup) rather than top pills. */}
            <nav style={{ ...cardStyle, width: '220px', flexShrink: 0, padding: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {SECTIONS.map(({ key, icon: Icon }) => {
                    const active = section === key;
                    return (
                        <button
                            key={key}
                            onClick={() => setSection(key)}
                            aria-current={active ? 'page' : undefined}
                            className="setup-field"
                            style={{
                                display: 'flex', alignItems: 'center', gap: '10px',
                                padding: '9px 12px 9px 9px', borderRadius: '8px',
                                border: 'none', borderLeft: active ? '3px solid var(--color-primary)' : '3px solid transparent',
                                background: active ? 'var(--color-primary-light)' : 'transparent',
                                // text-main/text-secondary, not a blue tint on a blue-tinted
                                // background — var(--color-primary) on var(--color-primary-light)
                                // computes under 4.5:1 in light mode (and worse in dark mode's
                                // translucent variant); the left accent bar + bold weight already
                                // carry the "active" signal without relying on low-contrast color.
                                color: active ? 'var(--color-text-main)' : 'var(--color-text-secondary)',
                                fontSize: '13px', fontWeight: active ? 700 : 500, cursor: 'pointer', textAlign: 'left', width: '100%',
                            }}
                        >
                            <Icon size={16} />
                            <span>{sectionLabel(key)}</span>
                        </button>
                    );
                })}
            </nav>

            {/* ── Defaults ── */}
            {section === 'defaults' && (
                <div style={{ ...cardStyle, padding: '20px 22px', flex: '1 1 560px', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        {t('ui.admin.salesSetup.defaultsNote')}
                    </p>

                    <DepositAccountDefaults fieldId={fieldId} />

                    <QuotationValidityDefault fieldId={fieldId} />

                    <PaymentRequestDefault fieldId={fieldId} />

                    <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        {t('ui.admin.salesSetup.glNoteBefore')}<b style={{ color: 'var(--color-text-main)' }}>{t('nav.chartOfAccounts')}</b>{t('ui.admin.salesSetup.glNoteAfter')}
                    </div>

                    <NotUsedYet />
                </div>
            )}

            {/* ── Page Name / Shipping Company: real store-backed lists. ── */}
            {section === 'pageNames' && (
                <SetupListSection title={t('ui.admin.salesSetup.sections.pageNames')} placeholder={t('ui.admin.salesSetup.addPageName')} items={pages}
                    onAdd={addPage} onRemove={removePage} />
            )}
            {/* Shipping Company: the list, and under it which couriers' Get File
                books the COD receipt (a grid column, so each card's own flex
                sizing does not apply and they stack). */}
            {section === 'shippingCompanies' && (
                <div style={{ flex: '1 1 560px', maxWidth: '680px', display: 'grid', gap: '20px' }}>
                    <SetupListSection title={t('ui.admin.salesSetup.sections.shippingCompanies')} placeholder={t('ui.admin.salesSetup.addShippingCompany')} items={shippingCompanies}
                        onAdd={addShippingCompany} onRemove={removeShippingCompany}
                        help={t('ui.admin.salesSetup.courier.help')}
                        renderRowExtra={company => <ShippingCompanyFields company={company} />} />
                    <CodGetFileSection />
                </div>
            )}

            {/* ── Pay By: the payment methods Checkout and the settle forms offer. ── */}
            {section === 'payBy' && (
                <div style={{ flex: '1 1 560px', maxWidth: '680px', display: 'grid', gap: '20px' }}>
                    <SetupListSection title={t('ui.admin.salesSetup.sections.payBy')} placeholder={t('ui.admin.salesSetup.addPayBy')} items={paymentMethods}
                        onAdd={addPaymentMethod} onRemove={removePaymentMethod} help={t('ui.admin.salesSetup.payByHelp')} />
                    <CodMethodsSection />
                </div>
            )}

            {/* ── Salesmen / Customer Care: the staff names Orders Management,
                Delivery and Payment Tracking and the staff reports offer. ── */}
            {section === 'salesmen' && (
                <SetupListSection title={t('ui.admin.salesSetup.sections.salesmen')} placeholder={t('ui.admin.salesSetup.addSalesman')} items={salesmen}
                    onAdd={addSalesman} onRemove={removeSalesman} help={t('ui.admin.salesSetup.salesmenHelp')} />
            )}
            {section === 'customerCare' && (
                <SetupListSection title={t('ui.admin.salesSetup.sections.customerCare')} placeholder={t('ui.admin.salesSetup.addCustomerCare')} items={customerCare}
                    onAdd={addCustomerCare} onRemove={removeCustomerCare} help={t('ui.admin.salesSetup.customerCareHelp')}
                    lockedNote={name => careFromUsers.has(name) ? t('ui.admin.salesSetup.fromUsers') : null} />
            )}

            {/* ── Delivery Types: the list, and each courier's type (an order
                shows its courier's type). ── */}
            {section === 'deliveryTypes' && (
                <div style={{ flex: '1 1 560px', maxWidth: '680px', display: 'grid', gap: '20px' }}>
                    <SetupListSection title={t('ui.admin.salesSetup.sections.deliveryTypes')} placeholder={t('ui.admin.salesSetup.deliveryType.add')} items={deliveryTypes}
                        onAdd={addDeliveryType} onRemove={removeDeliveryType} help={t('ui.admin.salesSetup.deliveryType.help')} />
                    <CourierDeliveryTypes />
                </div>
            )}

            {/* ── Discounts: Checkout's quick-pick presets. ── */}
            {section === 'discounts' && <DiscountsSection />}

            {/* ── Rejection Reasons: offered when an order moves to Returned or
                Cancelled, and in the Orders "Reason" column. ── */}
            {section === 'rejectionReasons' && (
                <SetupListSection title={t('ui.admin.salesSetup.sections.rejectionReasons')} placeholder={t('ui.admin.salesSetup.addRejectionReason')} items={rejectionReasons}
                    onAdd={addRejectionReason} onRemove={removeRejectionReason} help={t('ui.admin.salesSetup.rejectionReasonsHelp')} />
            )}

            {/* ── Provinces: the shared address tree + Shipping Points per commune. ── */}
            {section === 'provinces' && <ProvincesSection />}

            {/* ── Payment Terms / Opening Balances / Price Levels / Customer
                Groups: nothing in retail uses them; say where they live. ── */}
            {POINTER_SECTIONS.has(section) && <PointerSection section={section} />}

            {/* ── Every other section: placeholder until its own data model exists. ── */}
            {section !== 'defaults' && !LIST_SECTIONS.has(section) && !POINTER_SECTIONS.has(section) && (
                <div style={{ ...cardStyle, padding: '20px 22px', flex: '1 1 560px', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>{sectionLabel(activeSection.key)}</div>
                    </div>
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                        padding: '40px 18px', textAlign: 'center', borderRadius: '10px',
                        background: 'var(--color-bg)', border: '1px dashed var(--color-border)',
                    }}>
                        <activeSection.icon size={22} />
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '360px', lineHeight: 1.5 }}>
                            {fill(t('ui.admin.salesSetup.reserved'), { name: sectionLabel(activeSection.key) })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SalesSetupPage;
