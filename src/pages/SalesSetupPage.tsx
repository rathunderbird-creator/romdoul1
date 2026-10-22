// Sales Setup — defaults for new sell-side documents (modeled on the reference
// design): a left-nav settings page in the same family as Purchase Setup and
// Wholesale Setup. DESIGN ONLY for now — every field is local component state;
// nothing here reads or writes the store, Supabase, or app config yet. The
// Defaults section matches the provided mockup field-for-field; the remaining
// sections are placeholders until their own data model exists.
import React, { useId, useState } from 'react';
import {
    SlidersHorizontal, Tag, Tags, Users, MapPin, Percent, Truck, Ban, Landmark
} from 'lucide-react';
import { useHeader } from '../context/HeaderContext';

type SectionKey =
    | 'defaults' | 'paymentTerms' | 'priceLevels' | 'customerGroups' | 'provinces'
    | 'discounts' | 'deliveryTypes' | 'rejectionReasons' | 'openingBalances';

const SECTIONS: { key: SectionKey; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { key: 'defaults', label: 'Defaults', icon: SlidersHorizontal },
    { key: 'paymentTerms', label: 'Payment Terms', icon: Tag },
    { key: 'priceLevels', label: 'Price Levels', icon: Tags },
    { key: 'customerGroups', label: 'Customer Groups', icon: Users },
    { key: 'provinces', label: 'Provinces', icon: MapPin },
    { key: 'discounts', label: 'Discounts', icon: Percent },
    { key: 'deliveryTypes', label: 'Delivery Types', icon: Truck },
    { key: 'rejectionReasons', label: 'Rejection Reasons', icon: Ban },
    { key: 'openingBalances', label: 'Opening Balances', icon: Landmark },
];

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
const disabledInputStyle: React.CSSProperties = { ...inputStyle, color: 'var(--color-text-muted)', cursor: 'not-allowed' };

const SalesSetupPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
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
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--color-text-main)' }}>Sales Setup</h1>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Defaults for new documents, what each customer pays, and where you started</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

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

    return (
        <div className="acct-page" style={{ maxWidth: '100%', margin: '0 auto', background: 'var(--color-bg)', minHeight: 'var(--vh-full)', display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Left-nav — same section family as Purchase Setup / Wholesale Setup,
                laid out as a sidebar (matching the mockup) rather than top pills. */}
            <nav style={{ ...cardStyle, width: '220px', flexShrink: 0, padding: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {SECTIONS.map(({ key, label, icon: Icon }) => {
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
                            <span>{label}</span>
                        </button>
                    );
                })}
            </nav>

            {/* ── Defaults ── */}
            {section === 'defaults' && (
                <div style={{ ...cardStyle, padding: '20px 22px', flex: '1 1 560px', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        These are starting values for new documents only. Changing them never alters a quotation or invoice that has already been saved.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                        <div>
                            <label htmlFor={fieldId('vat-rate')} style={labelStyle}>Default VAT rate (%)</label>
                            <input id={fieldId('vat-rate')} type="number" min="0" step="0.01" value={vatRate} className="setup-field"
                                onChange={e => setVatRate(Number(e.target.value))} style={inputStyle} />
                        </div>
                        <div>
                            <label htmlFor={fieldId('payment-terms-days')} style={labelStyle}>Payment terms (days)</label>
                            <input id={fieldId('payment-terms-days')} type="number" min="0" step="1" value={paymentTermsDays} className="setup-field"
                                onChange={e => setPaymentTermsDays(Number(e.target.value))} style={inputStyle} />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                        <div>
                            <label htmlFor={fieldId('quotation-validity')} style={labelStyle}>Quotation validity (days)</label>
                            <input id={fieldId('quotation-validity')} type="number" min="0" step="1" value={quotationValidityDays} className="setup-field"
                                onChange={e => setQuotationValidityDays(Number(e.target.value))} style={inputStyle} />
                        </div>
                        <div>
                            <label htmlFor={fieldId('default-warehouse')} style={labelStyle}>Default warehouse</label>
                            <select id={fieldId('default-warehouse')} value="" className="setup-field" style={{ ...inputStyle, cursor: 'pointer' }} onChange={() => { /* no warehouses wired yet */ }}>
                                <option value="">None</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label htmlFor={fieldId('deposit-account')} style={labelStyle}>Default deposit account</label>
                        <select id={fieldId('deposit-account')} disabled value="" className="setup-field" style={disabledInputStyle}
                            title="Not wired up yet — the Chart of Accounts isn't connected here.">
                            <option value="">Bank or cash account…</option>
                        </select>
                        <div style={helpStyle}>
                            Not wired up yet. Once connected: pre-selected on the receipt form, with the operator still able to choose a different one per receipt.
                        </div>
                    </div>

                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={holdsStock} onChange={e => setHoldsStock(e.target.checked)} className="setup-field"
                            style={{ marginTop: '2px', width: '15px', height: '15px', accentColor: 'var(--color-primary)', cursor: 'pointer', flexShrink: 0 }} />
                        <span>
                            <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}>Confirmed sales orders hold their stock</span>
                            <span style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.45, marginTop: '2px' }}>
                                When on, an invoice or till sale cannot take stock that an open sales order is holding. Has no effect if negative stock is allowed.
                            </span>
                        </span>
                    </label>

                    <div>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)', marginBottom: '4px' }}>Document numbering</div>
                        <div style={{ ...helpStyle, marginTop: 0, marginBottom: '10px' }}>
                            Prefixes only. Changing a prefix affects new records only — documents that already exist keep their reference.
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '12px' }}>
                            {NUMBERING_FIELDS.map(({ key, label }) => (
                                <div key={key}>
                                    <label htmlFor={fieldId(`num-${key}`)} style={{ ...labelStyle, whiteSpace: 'nowrap' }}>{label}</label>
                                    <input id={fieldId(`num-${key}`)} type="text" maxLength={6} value={numbering[key]} className="setup-field"
                                        onChange={e => setNumberingField(key, e.target.value)} style={inputStyle} />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label htmlFor={fieldId('payment-request-message')} style={labelStyle}>Payment request message</label>
                        <textarea id={fieldId('payment-request-message')} value={paymentRequestMessage} placeholder="Leave blank for the standard wording" className="setup-field"
                            onChange={e => setPaymentRequestMessage(e.target.value)}
                            style={{ ...inputStyle, minHeight: '76px', resize: 'vertical', fontFamily: 'inherit' }} />
                        <div style={helpStyle}>The paragraph above the invoice list on a payment request letter. Leave blank to use the standard wording.</div>
                    </div>

                    <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        The GL accounts a sale posts to — receivables, revenue, VAT, discounts and cost of goods sold — are configured
                        in the <b style={{ color: 'var(--color-text-main)' }}>Chart of Accounts</b>, where the posting engine reads them.
                    </div>

                    <button onClick={handleSave} disabled={saving} className="setup-field" style={saveBtn}>{saving ? 'Saving…' : 'Save settings'}</button>
                </div>
            )}

            {/* ── Every other section: placeholder until its own data model exists. ── */}
            {section !== 'defaults' && (
                <div style={{ ...cardStyle, padding: '20px 22px', flex: '1 1 560px', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>{activeSection.label}</div>
                    </div>
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                        padding: '40px 18px', textAlign: 'center', borderRadius: '10px',
                        background: 'var(--color-bg)', border: '1px dashed var(--color-border)',
                    }}>
                        <activeSection.icon size={22} />
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '360px', lineHeight: 1.5 }}>
                            {activeSection.label} isn't set up yet — this section is reserved for it.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SalesSetupPage;
