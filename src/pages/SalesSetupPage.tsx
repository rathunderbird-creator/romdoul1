// Sales Setup — defaults for new sell-side documents (modeled on the reference
// design): a left-nav settings page in the same family as Purchase Setup and
// Wholesale Setup. In the Defaults section only the default deposit accounts
// are real (app_config salesSettings); the other fields are still DESIGN ONLY
// (local state, matching the mockup; nothing reads those values yet). Page Name, Shipping
// Company (with each courier's cost per parcel, tracking link and "Get File
// books the COD receipt"), Pay By, Salesmen, Customer Care and Provinces are
// real, store-backed settings. The remaining sections are placeholders until their own data
// model exists.
import React, { useId, useState } from 'react';
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
const LIST_SECTIONS = new Set<SectionKey>(['pageNames', 'shippingCompanies', 'payBy', 'salesmen', 'customerCare', 'provinces']);

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

    const handleRemove = (name: string) => {
        Promise.resolve(onRemove(name)).catch(reportError);
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

const NUMBERING_FIELDS: { key: 'quotations' | 'salesOrders' | 'invoices' | 'receipts' | 'refunds'; label: string; def: string }[] = [
    { key: 'quotations', label: 'Quotations', def: 'QUO' },
    { key: 'salesOrders', label: 'Sales orders', def: 'SO' },
    { key: 'invoices', label: 'Invoices', def: 'INV' },
    { key: 'receipts', label: 'Receipts', def: 'RCP' },
    { key: 'refunds', label: 'Refunds', def: 'REF' },
];

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

const SalesSetupPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();
    const {
        pages, shippingCompanies, addPage, removePage, addShippingCompany, removeShippingCompany, paymentMethods, addPaymentMethod, removePaymentMethod,
        salesmen, addSalesman, removeSalesman, customerCare, addCustomerCare, removeCustomerCare, users,
    } = useStore();
    // The store's customerCare list also carries every user whose role is
    // Customer Care or Admin; those rows come from Users and cannot be
    // removed here (removing only edits the configured names).
    const careFromUsers = React.useMemo(() => new Set(users
        .filter(u => u.roleId === 'customer_care' || u.roleId === 'admin')
        .map(u => u.name)), [users]);
    const [section, setSection] = useState<SectionKey>('defaults');
    const [saving, setSaving] = useState(false);

    // Defaults section — local draft only, matching the mockup's starting values.
    const [vatRate, setVatRate] = useState(0);
    const [paymentTermsDays, setPaymentTermsDays] = useState(30);
    const [quotationValidityDays, setQuotationValidityDays] = useState(14);
    const [holdsStock, setHoldsStock] = useState(true);
    const [numbering, setNumbering] = useState({ quotations: 'QUO', salesOrders: 'SO', invoices: 'INV', receipts: 'RCP', refunds: 'REF' });
    const [paymentRequestMessage, setPaymentRequestMessage] = useState('');

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

    const setNumberingField = (key: keyof typeof numbering, value: string) =>
        setNumbering(n => ({ ...n, [key]: value.toUpperCase() }));

    // No backend yet — this only simulates the Save affordance shown in the
    // mockup so the page reads as finished, not as broken.
    const handleSave = () => {
        setSaving(true);
        setTimeout(() => setSaving(false), 400);
    };

    const saveBtn: React.CSSProperties = {
        padding: '10px 18px', borderRadius: '9px', border: 'none', background: 'var(--color-primary)', color: 'white',
        fontSize: '13px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', alignSelf: 'flex-start',
    };

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

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                        <div>
                            <label htmlFor={fieldId('vat-rate')} style={labelStyle}>{t('ui.admin.salesSetup.vatRate')}</label>
                            <input id={fieldId('vat-rate')} type="number" min="0" step="0.01" value={vatRate} className="setup-field"
                                onChange={e => setVatRate(Number(e.target.value))} style={inputStyle} />
                        </div>
                        <div>
                            <label htmlFor={fieldId('payment-terms-days')} style={labelStyle}>{t('ui.admin.salesSetup.paymentTermsDays')}</label>
                            <input id={fieldId('payment-terms-days')} type="number" min="0" step="1" value={paymentTermsDays} className="setup-field"
                                onChange={e => setPaymentTermsDays(Number(e.target.value))} style={inputStyle} />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                        <div>
                            <label htmlFor={fieldId('quotation-validity')} style={labelStyle}>{t('ui.admin.salesSetup.quotationValidity')}</label>
                            <input id={fieldId('quotation-validity')} type="number" min="0" step="1" value={quotationValidityDays} className="setup-field"
                                onChange={e => setQuotationValidityDays(Number(e.target.value))} style={inputStyle} />
                        </div>
                        <div>
                            <label htmlFor={fieldId('default-warehouse')} style={labelStyle}>{t('ui.admin.salesSetup.defaultWarehouse')}</label>
                            <select id={fieldId('default-warehouse')} value="" className="setup-field" style={{ ...inputStyle, cursor: 'pointer' }} onChange={() => { /* no warehouses wired yet */ }}>
                                <option value="">{t('ui.admin.salesSetup.none')}</option>
                            </select>
                        </div>
                    </div>

                    <DepositAccountDefaults fieldId={fieldId} />

                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={holdsStock} onChange={e => setHoldsStock(e.target.checked)} className="setup-field"
                            style={{ marginTop: '2px', width: '15px', height: '15px', accentColor: 'var(--color-primary)', cursor: 'pointer', flexShrink: 0 }} />
                        <span>
                            <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}>{t('ui.admin.salesSetup.holdsStock')}</span>
                            <span style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.45, marginTop: '2px' }}>
                                {t('ui.admin.salesSetup.holdsStockHelp')}
                            </span>
                        </span>
                    </label>

                    <div>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)', marginBottom: '4px' }}>{t('ui.admin.salesSetup.documentNumbering')}</div>
                        <div style={{ ...helpStyle, marginTop: 0, marginBottom: '10px' }}>
                            {t('ui.admin.salesSetup.numberingHelp')}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '12px' }}>
                            {NUMBERING_FIELDS.map(({ key }) => (
                                <div key={key}>
                                    <label htmlFor={fieldId(`num-${key}`)} style={{ ...labelStyle, whiteSpace: 'nowrap' }}>{t(`ui.admin.salesSetup.numbering.${key}`)}</label>
                                    <input id={fieldId(`num-${key}`)} type="text" maxLength={6} value={numbering[key]} className="setup-field"
                                        onChange={e => setNumberingField(key, e.target.value)} style={inputStyle} />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label htmlFor={fieldId('payment-request-message')} style={labelStyle}>{t('ui.admin.salesSetup.paymentRequestMessage')}</label>
                        <textarea id={fieldId('payment-request-message')} value={paymentRequestMessage} placeholder={t('ui.admin.salesSetup.paymentRequestPlaceholder')} className="setup-field"
                            onChange={e => setPaymentRequestMessage(e.target.value)}
                            style={{ ...inputStyle, minHeight: '76px', resize: 'vertical', fontFamily: 'inherit' }} />
                        <div style={helpStyle}>{t('ui.admin.salesSetup.paymentRequestHelp')}</div>
                    </div>

                    <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        {t('ui.admin.salesSetup.glNoteBefore')}<b style={{ color: 'var(--color-text-main)' }}>{t('nav.chartOfAccounts')}</b>{t('ui.admin.salesSetup.glNoteAfter')}
                    </div>

                    <button onClick={handleSave} disabled={saving} className="setup-field" style={saveBtn}>{saving ? t('ui.admin.telegram.saving') : t('ui.admin.salesSetup.saveSettings')}</button>
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

            {/* ── Provinces: the shared address tree + Shipping Points per commune. ── */}
            {section === 'provinces' && <ProvincesSection />}

            {/* ── Every other section: placeholder until its own data model exists. ── */}
            {section !== 'defaults' && !LIST_SECTIONS.has(section) && (
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
