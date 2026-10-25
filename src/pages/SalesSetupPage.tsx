// Sales Setup — defaults for new sell-side documents (modeled on the reference
// design): a left-nav settings page in the same family as Purchase Setup and
// Wholesale Setup. DESIGN ONLY for now — every field is local component state;
// nothing here reads or writes the store, Supabase, or app config yet. The
// Defaults section matches the provided mockup field-for-field; the remaining
// sections are placeholders until their own data model exists.
import React, { useId, useState } from 'react';
import {
    SlidersHorizontal, Tag, Tags, Users, MapPin, Percent, Truck, Ban, Landmark,
    Megaphone, Building2, Plus, Trash2, ChevronRight, ChevronDown, Search
} from 'lucide-react';
import { useHeader } from '../context/HeaderContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';

type SectionKey =
    | 'defaults' | 'paymentTerms' | 'priceLevels' | 'customerGroups' | 'provinces'
    | 'discounts' | 'deliveryTypes' | 'rejectionReasons' | 'openingBalances'
    | 'pageNames' | 'shippingCompanies';

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
    { key: 'rejectionReasons', label: 'Rejection Reasons', icon: Ban },
    { key: 'openingBalances', label: 'Opening Balances', icon: Landmark },
];

// Sections not in this set fall through to the "reserved" placeholder below.
const LIST_SECTIONS = new Set<SectionKey>(['pageNames', 'shippingCompanies', 'provinces']);

interface LocationInfo { code: string; khmer: string; latin: string }
type CommuneData = LocationInfo;
interface DistrictData extends LocationInfo { communes?: CommuneData[] }
interface ProvinceData extends LocationInfo { districts?: DistrictData[] }

// Add/remove UI for a flat string list backed by the store's config blob
// (same data CheckoutForm's gear-icon ConfigModal edits — this just gives it
// a proper home in Setup instead of only being reachable mid-checkout).
const SetupListSection: React.FC<{
    title: string; placeholder: string; items: string[];
    onAdd: (name: string) => Promise<unknown>; onRemove: (name: string) => Promise<unknown>;
}> = ({ title, placeholder, items, onAdd, onRemove }) => {
    const { showToast } = useToast();
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);

    const reportError = (err: any) => showToast('Failed to save: ' + (err?.message || 'unknown error'), 'error');

    const handleAdd = () => {
        const name = draft.trim();
        if (!name || busy) return;
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
                    <div style={{ padding: '18px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-secondary)' }}>None added yet.</div>
                ) : items.map(item => (
                    <div key={item} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', borderBottom: '1px solid var(--color-border)', fontSize: '13px', color: 'var(--color-text-main)' }}>
                        <span>{item}</span>
                        <button onClick={() => handleRemove(item)} title={`Remove ${item}`} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                            <Trash2 size={15} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Khmer or Latin, case-insensitive substring.
const matchesQuery = (info: LocationInfo, q: string) =>
    !q || info.khmer.includes(q) || info.latin.toLowerCase().includes(q.toLowerCase());

// A district or commune row, official or custom, tagged so the UI can tell
// which "remove" semantics apply (splice vs. add-to-hidden-list).
type DistrictRow = DistrictData & { isCustom: boolean };
type CommuneRow = LocationInfo & { isCustom: boolean };

// Browser over the official province → district → commune hierarchy
// CheckoutForm's address cascade already uses (src/data/cambodia.json,
// lazy-imported here the same way — it's ~85k lines, no reason to ship it in
// the main bundle for pages that never open this section). Provinces stay
// fixed (official, complete), but districts/communes can be extended with
// shop-specific entries or have an official one hidden — see
// addCustomDistrict/removeDistrictEntry and their commune equivalents.
const ProvincesBrowser: React.FC = () => {
    const {
        customDistricts, customCommunes, removedDistrictCodes, removedCommuneCodes,
        addCustomDistrict, removeDistrictEntry, addCustomCommune, removeCommuneEntry
    } = useStore();
    const { showToast } = useToast();
    const [provincesData, setProvincesData] = useState<ProvinceData[] | null>(null);
    const [query, setQuery] = useState('');
    const [openProvinces, setOpenProvinces] = useState<Set<string>>(new Set());
    const [openDistricts, setOpenDistricts] = useState<Set<string>>(new Set());
    const [districtDrafts, setDistrictDrafts] = useState<Record<string, string>>({});
    const [communeDrafts, setCommuneDrafts] = useState<Record<string, string>>({});

    React.useEffect(() => {
        let cancelled = false;
        import('../data/cambodia.json').then(mod => {
            if (!cancelled) setProvincesData(mod.default as ProvinceData[]);
        });
        return () => { cancelled = true; };
    }, []);

    const reportError = (err: any) => showToast('Failed to save: ' + (err?.message || 'unknown error'), 'error');

    const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, code: string) => {
        const next = new Set(set);
        if (next.has(code)) next.delete(code); else next.add(code);
        setSet(next);
    };

    // Official districts (minus hidden ones) + this province's custom ones.
    const districtsOf = (p: ProvinceData): DistrictRow[] => [
        ...(p.districts || []).filter(d => !removedDistrictCodes.includes(d.code)).map(d => ({ ...d, isCustom: false })),
        ...customDistricts.filter(cd => cd.provinceCode === p.code).map(cd => ({ code: cd.code, khmer: cd.khmer, latin: cd.latin, isCustom: true } as DistrictRow)),
    ];
    // Official communes (minus hidden ones) + this district's custom ones.
    const communesOf = (d: DistrictData): CommuneRow[] => [
        ...(d.communes || []).filter(c => !removedCommuneCodes.includes(c.code)).map(c => ({ ...c, isCustom: false })),
        ...customCommunes.filter(cc => cc.districtCode === d.code).map(cc => ({ code: cc.code, khmer: cc.khmer, latin: cc.latin, isCustom: true })),
    ];

    const handleAddDistrict = (provinceCode: string) => {
        const name = (districtDrafts[provinceCode] || '').trim();
        if (!name) return;
        Promise.resolve(addCustomDistrict(provinceCode, name)).catch(reportError);
        setDistrictDrafts(prev => ({ ...prev, [provinceCode]: '' }));
    };
    const handleAddCommune = (districtCode: string) => {
        const name = (communeDrafts[districtCode] || '').trim();
        if (!name) return;
        Promise.resolve(addCustomCommune(districtCode, name)).catch(reportError);
        setCommuneDrafts(prev => ({ ...prev, [districtCode]: '' }));
    };

    const q = query.trim();
    // While searching, auto-expand every province/district that contains a
    // match anywhere below it — otherwise a hit stays hidden inside a
    // collapsed node and the search box would look broken.
    const matchingProvinceCodes = React.useMemo(() => {
        if (!q || !provincesData) return null;
        const codes = new Set<string>();
        for (const p of provincesData) {
            const districts = districtsOf(p);
            const hit = matchesQuery(p, q) || districts.some(d =>
                matchesQuery(d, q) || communesOf(d).some(c => matchesQuery(c, q)));
            if (hit) codes.add(p.code);
        }
        return codes;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provincesData, q, customDistricts, customCommunes, removedDistrictCodes, removedCommuneCodes]);
    const matchingDistrictCodes = React.useMemo(() => {
        if (!q || !provincesData) return null;
        const codes = new Set<string>();
        for (const p of provincesData) {
            for (const d of districtsOf(p)) {
                if (matchesQuery(d, q) || communesOf(d).some(c => matchesQuery(c, q))) codes.add(d.code);
            }
        }
        return codes;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provincesData, q, customDistricts, customCommunes, removedDistrictCodes, removedCommuneCodes]);

    const smallBtn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' };

    return (
        <div style={{ ...cardStyle, padding: '20px 22px', flex: '1 1 560px', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>Provinces</div>
                <div style={{ ...helpStyle, marginTop: '4px' }}>
                    The official hierarchy — same data the address fields use when placing an order. Provinces themselves are fixed, but you can add a district or commune of your own, or remove one that doesn't apply.
                </div>
            </div>
            <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                <input
                    type="text" value={query} placeholder="Search province, district or commune..." className="search-input"
                    onChange={e => setQuery(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px 9px 34px', boxSizing: 'border-box' }}
                />
            </div>
            {!provincesData ? (
                <div style={{ padding: '18px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Loading…</div>
            ) : (
                <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', maxHeight: '520px', overflowY: 'auto' }}>
                    {provincesData
                        .filter(p => !matchingProvinceCodes || matchingProvinceCodes.has(p.code))
                        .map(p => {
                            const isOpen = q ? true : openProvinces.has(p.code);
                            const districts = districtsOf(p)
                                .filter(d => !matchingDistrictCodes || matchingDistrictCodes.has(d.code));
                            return (
                                <div key={p.code} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <button
                                        onClick={() => toggle(openProvinces, setOpenProvinces, p.code)}
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}
                                    >
                                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                        <span>{p.khmer} ({p.latin})</span>
                                        <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{districts.length} districts</span>
                                    </button>
                                    {isOpen && districts.map(d => {
                                        const dOpen = q ? true : openDistricts.has(d.code);
                                        const communes = communesOf(d).filter(c => !q || matchesQuery(c, q));
                                        return (
                                            <div key={d.code} style={{ paddingLeft: '22px', borderTop: '1px solid var(--color-border)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <button
                                                        onClick={() => toggle(openDistricts, setOpenDistricts, d.code)}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '12.5px', fontWeight: 500, color: 'var(--color-text-main)' }}
                                                    >
                                                        {dOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                                        <span>{d.khmer === d.latin ? d.khmer : `${d.khmer} (${d.latin})`}</span>
                                                        {d.isCustom && <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '1px 6px', borderRadius: '999px' }}>Custom</span>}
                                                        <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--color-text-secondary)' }}>{communes.length} communes</span>
                                                    </button>
                                                    <button onClick={() => removeDistrictEntry(d.code, d.isCustom).catch(reportError)} title={`Remove ${d.latin}`} style={{ ...smallBtn, color: '#ef4444', marginRight: '8px' }}>
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                                {dOpen && (
                                                    <>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '4px 10px', padding: '2px 12px 6px 28px' }}>
                                                            {communes.map(c => (
                                                                <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.khmer === c.latin ? c.khmer : `${c.khmer} (${c.latin})`}</span>
                                                                    {c.isCustom && <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--color-primary)', flexShrink: 0 }}>•custom</span>}
                                                                    <button onClick={() => removeCommuneEntry(c.code, c.isCustom).catch(reportError)} title={`Remove ${c.latin}`} style={{ ...smallBtn, color: '#ef4444', flexShrink: 0 }}>
                                                                        <Trash2 size={12} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '6px', padding: '0 12px 10px 28px' }}>
                                                            <input
                                                                type="text" value={communeDrafts[d.code] || ''} placeholder="Add a commune..." className="search-input"
                                                                onChange={e => setCommuneDrafts(prev => ({ ...prev, [d.code]: e.target.value }))}
                                                                onKeyDown={e => { if (e.key === 'Enter') handleAddCommune(d.code); }}
                                                                style={{ flex: 1, padding: '6px 10px', fontSize: '12px' }}
                                                            />
                                                            <button onClick={() => handleAddCommune(d.code)} disabled={!(communeDrafts[d.code] || '').trim()} className="primary-button"
                                                                style={{ padding: '0 10px', cursor: (communeDrafts[d.code] || '').trim() ? 'pointer' : 'not-allowed', opacity: (communeDrafts[d.code] || '').trim() ? 1 : 0.6 }}>
                                                                <Plus size={14} />
                                                            </button>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {isOpen && (
                                        <div style={{ display: 'flex', gap: '6px', padding: '0 12px 10px 22px' }}>
                                            <input
                                                type="text" value={districtDrafts[p.code] || ''} placeholder="Add a district..." className="search-input"
                                                onChange={e => setDistrictDrafts(prev => ({ ...prev, [p.code]: e.target.value }))}
                                                onKeyDown={e => { if (e.key === 'Enter') handleAddDistrict(p.code); }}
                                                style={{ flex: 1, padding: '7px 10px', fontSize: '12.5px' }}
                                            />
                                            <button onClick={() => handleAddDistrict(p.code)} disabled={!(districtDrafts[p.code] || '').trim()} className="primary-button"
                                                style={{ padding: '0 10px', cursor: (districtDrafts[p.code] || '').trim() ? 'pointer' : 'not-allowed', opacity: (districtDrafts[p.code] || '').trim() ? 1 : 0.6 }}>
                                                <Plus size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                </div>
            )}
        </div>
    );
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
const disabledInputStyle: React.CSSProperties = { ...inputStyle, color: 'var(--color-text-muted)', cursor: 'not-allowed' };

const SalesSetupPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { pages, shippingCompanies, addPage, removePage, addShippingCompany, removeShippingCompany } = useStore();
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

            {/* ── Page Name / Shipping Company: real store-backed lists. ── */}
            {section === 'pageNames' && (
                <SetupListSection title="Page Name" placeholder="Add a page name..." items={pages}
                    onAdd={addPage} onRemove={removePage} />
            )}
            {section === 'shippingCompanies' && (
                <SetupListSection title="Shipping Company" placeholder="Add a shipping company..." items={shippingCompanies}
                    onAdd={addShippingCompany} onRemove={removeShippingCompany} />
            )}

            {/* ── Provinces: read-only browse of the official admin hierarchy. ── */}
            {section === 'provinces' && <ProvincesBrowser />}

            {/* ── Every other section: placeholder until its own data model exists. ── */}
            {section !== 'defaults' && !LIST_SECTIONS.has(section) && (
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
