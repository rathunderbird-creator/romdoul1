// Sales Setup › Provinces — the address tree every picker uses (gazetteer +
// this shop's custom / hidden districts and communes, see
// utils/locationTree.ts), with the Shipping Points (custom_locations rows)
// that sit in each commune listed under it.
//
// custom_locations stays the ONE source for points: this section reads and
// writes it through utils/shippingPoints.ts, the same helpers the Shipping
// Point map page uses. Nothing is copied into app_config.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Plus, Trash2, ChevronRight, ChevronDown, Search, MapPin, Edit2, Power, EyeOff, RotateCcw, AlertTriangle, X,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { useLocationTree } from '../../hooks/useLocationTree';
import { getShippingCoColor } from '../../utils/orderUtils';
import {
    findByName, locLabel, pickerOptions, visibleOnly,
    type LocNode, type LocProvince, type LocDistrict, type LocCommune,
} from '../../utils/locationTree';
import {
    fetchShippingPoints, saveShippingPoint, setShippingPointShutdown, deleteShippingPoint, parseLatLng, isInCambodia, placeShippingPoints,
    type ShippingPoint, type ShippingPointFields,
} from '../../utils/shippingPoints';

const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px' };
const helpStyle: React.CSSProperties = { fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.45, marginTop: '6px' };
const smallBtn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' };
const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--color-border)',
    background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', boxSizing: 'border-box',
};
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' };

const errText = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));

// Khmer or Latin, case-insensitive substring.
const matchesQuery = (info: LocNode, q: string) =>
    !q || info.khmer.includes(q) || info.latin.toLowerCase().includes(q.toLowerCase());

const pointHaystack = (p: ShippingPoint) =>
    [p.name, p.courier, p.phone, p.contact_name].filter(Boolean).join(' ').toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '');

const countChip = (n: number, title: string) => n > 0 ? (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10.5px', fontWeight: 700, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '1px 7px', borderRadius: '999px', flexShrink: 0 }}>
        <MapPin size={10} />{n}
    </span>
) : null;

// ─── One shipping point ────────────────────────────────────────────────────

const PointRow: React.FC<{
    point: ShippingPoint; note?: string; busy: boolean;
    onEdit: () => void; onToggle: () => void; onDelete: () => void;
}> = ({ point, note, busy, onEdit, onToggle, onDelete }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 10px', borderRadius: '8px', background: 'var(--color-bg)', opacity: point.is_shutdown ? 0.65 : 1 }}>
        <MapPin size={13} style={{ marginTop: '3px', flexShrink: 0, color: getShippingCoColor(point.courier || '') }} />
        <div style={{ flex: 1, minWidth: 0, fontSize: '12px', lineHeight: 1.4 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                {point.courier && <span style={{ fontWeight: 800, color: getShippingCoColor(point.courier) }}>{point.courier}</span>}
                <span style={{ fontWeight: 600, color: 'var(--color-text-main)', wordBreak: 'break-word' }}>{point.name}</span>
                {point.is_shutdown && (
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#b91c1c', background: '#fee2e2', padding: '1px 6px', borderRadius: '999px' }}>បិទបណ្តោះអាសន្ន · Shutdown</span>
                )}
            </div>
            {(point.phone || point.contact_name) && (
                <div style={{ color: 'var(--color-text-secondary)' }}>{[point.contact_name, point.phone].filter(Boolean).join(' · ')}</div>
            )}
            {note && <div style={{ color: '#b45309', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={11} />{note}</div>}
        </div>
        <button onClick={onToggle} disabled={busy} title={point.is_shutdown ? 'Reactivate' : 'Temporarily shut down'} aria-label={point.is_shutdown ? `Reactivate ${point.name}` : `Shut down ${point.name}`}
            style={{ ...smallBtn, color: point.is_shutdown ? '#16a34a' : '#d97706' }}><Power size={13} /></button>
        <button onClick={onEdit} disabled={busy} title="Edit" aria-label={`Edit ${point.name}`} style={{ ...smallBtn, color: 'var(--color-text-secondary)' }}><Edit2 size={13} /></button>
        <button onClick={onDelete} disabled={busy} title="Delete" aria-label={`Delete ${point.name}`} style={{ ...smallBtn, color: '#ef4444' }}><Trash2 size={13} /></button>
    </div>
);

// ─── Add / edit a shipping point ───────────────────────────────────────────

interface EditorState {
    id: string | null;
    fields: Omit<ShippingPointFields, 'lat' | 'lng'>;
    latLng: string;
    /** The position text the editor opened with (edit only). An unchanged
     *  stored position is saved as is even if it is outside the Cambodia box. */
    originalLatLng?: string;
    /** Average position of the points already in the chosen area, if any. */
    suggestion?: { lat: number; lng: number; count: number; where: string };
}

const PointEditor: React.FC<{
    state: EditorState; tree: LocProvince[]; couriers: string[];
    onChange: (s: EditorState) => void; onCancel: () => void; onSaved: () => void;
}> = ({ state, tree, couriers, onChange, onCancel, onSaved }) => {
    const { showToast } = useToast();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const f = state.fields;
    const set = (patch: Partial<EditorState['fields']>) => onChange({ ...state, fields: { ...f, ...patch } });

    const districts = findByName(tree, f.province)?.districts || [];
    const communes = findByName(districts, f.district)?.communes || [];
    const pp = pickerOptions(tree, f.province);
    const dp = pickerOptions(districts, f.district);
    const cp = pickerOptions(communes, f.commune);
    const courierOptions = f.courier && !couriers.includes(f.courier) ? [...couriers, f.courier] : couriers;

    const submit = async () => {
        setError(null);
        const ll = parseLatLng(state.latLng);
        if (!f.name.trim()) { setError('សូមបញ្ចូលឈ្មោះទីតាំង (Enter a name)'); return; }
        if (!ll) {
            setError(/^\s*-?\d{3}\.\d+\s*,\s*-?\d{1,2}\.\d+\s*$/.test(state.latLng)
                ? 'Latitude and longitude look swapped. Enter latitude first (about 10–14.7), then longitude (about 102–108), e.g. 11.5564, 104.9282.'
                : 'Enter the position as "latitude, longitude" (e.g. 11.5564, 104.9282) or paste a Google Maps link.');
            return;
        }
        const unchanged = state.id !== null && state.latLng.trim() === (state.originalLatLng || '').trim();
        if (!isInCambodia(ll[0], ll[1]) && !unchanged) {
            setError(isInCambodia(ll[1], ll[0])
                ? `${ll[0]}, ${ll[1]} is outside Cambodia — latitude and longitude look swapped. Enter latitude first (about 10–14.7), then longitude (about 102–108).`
                : `${ll[0]}, ${ll[1]} is outside Cambodia. Latitude is about 10–14.7 and longitude about 102–108.`);
            return;
        }
        setSaving(true);
        try {
            await saveShippingPoint({ ...f, lat: ll[0], lng: ll[1] }, state.id);
            showToast(`Shipping point saved: ${f.name.trim()}`, 'success');
            onSaved();
        } catch (e) {
            setError(errText(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div role="dialog" aria-modal="true" aria-label={state.id ? 'Edit shipping point' : 'Add shipping point'}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div style={{ ...cardStyle, width: '100%', maxWidth: '520px', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-text-main)' }}>{state.id ? 'Edit shipping point' : 'Add shipping point'}</div>
                    <button onClick={onCancel} aria-label="Close" style={{ ...smallBtn, color: 'var(--color-text-secondary)' }}><X size={18} /></button>
                </div>
                {error && <div style={{ padding: '8px 10px', borderRadius: '8px', background: '#fee2e2', color: '#b91c1c', fontSize: '12.5px' }}>{error}</div>}
                <div>
                    <label style={fieldLabel}>Name / ឈ្មោះទីតាំង *</label>
                    <input className="search-input" style={fieldStyle} value={f.name} onChange={e => set({ name: e.target.value })} />
                </div>
                <div>
                    <label style={fieldLabel}>Courier / សេវាដឹកជញ្ជូន</label>
                    <select style={{ ...fieldStyle, color: f.courier ? getShippingCoColor(f.courier) : 'var(--color-text-main)' }} value={f.courier} onChange={e => set({ courier: e.target.value })}>
                        <option value="">—</option>
                        {courierOptions.map(c => <option key={c} value={c} style={{ color: getShippingCoColor(c) }}>{c}</option>)}
                    </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                    <div>
                        <label style={fieldLabel}>Province / ខេត្ត</label>
                        <select style={fieldStyle} value={pp.value} onChange={e => set({ province: e.target.value, district: '', commune: '' })}>
                            <option value="">—</option>
                            {pp.options.map(o => <option key={o.code} value={o.khmer}>{locLabel(o)}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={fieldLabel}>District / ស្រុក</label>
                        <select style={fieldStyle} value={dp.value} onChange={e => set({ district: e.target.value, commune: '' })} disabled={!f.province}>
                            <option value="">—</option>
                            {dp.options.map(o => <option key={o.code} value={o.khmer}>{locLabel(o)}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={fieldLabel}>Commune / ឃុំ</label>
                        <select style={fieldStyle} value={cp.value} onChange={e => set({ commune: e.target.value })} disabled={!f.district}>
                            <option value="">—</option>
                            {cp.options.map(o => <option key={o.code} value={o.khmer}>{locLabel(o)}</option>)}
                        </select>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                    <div>
                        <label style={fieldLabel}>Phone / លេខទូរស័ព្ទ</label>
                        <input className="search-input" style={fieldStyle} value={f.phone} onChange={e => set({ phone: e.target.value })} />
                    </div>
                    <div>
                        <label style={fieldLabel}>Contact name / ឈ្មោះអ្នកទទួល</label>
                        <input className="search-input" style={fieldStyle} value={f.contactName} onChange={e => set({ contactName: e.target.value })} />
                    </div>
                </div>
                <div>
                    <label style={fieldLabel}>Position (latitude, longitude) *</label>
                    <input className="search-input" style={fieldStyle} value={state.latLng} placeholder="11.5564, 104.9282 — or paste a Google Maps link"
                        onChange={e => onChange({ ...state, latLng: e.target.value })} />
                    {state.suggestion && !parseLatLng(state.latLng) && (
                        <button onClick={() => onChange({ ...state, latLng: `${state.suggestion!.lat.toFixed(6)}, ${state.suggestion!.lng.toFixed(6)}` })}
                            style={{ marginTop: '6px', background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                            Use the average of the {state.suggestion.count} point{state.suggestion.count === 1 ? '' : 's'} in {state.suggestion.where} (approximate)
                        </button>
                    )}
                    <div style={helpStyle}>For an exact pin, drop it on the map on the Shipping Points page.</div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-main)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={f.isShutdown} onChange={e => set({ isShutdown: e.target.checked })} style={{ width: '15px', height: '15px', accentColor: 'var(--color-primary)' }} />
                    បិទទីតាំងនេះជាបណ្តោះអាសន្ន (Temporarily shut down)
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button onClick={onCancel} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
                    <button onClick={submit} disabled={saving} className="primary-button" style={{ padding: '8px 16px', fontSize: '13px', cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
            </div>
        </div>
    );
};

// ─── The section ───────────────────────────────────────────────────────────

interface CommuneView { node: LocCommune; points: ShippingPoint[] }
interface DistrictView { node: LocDistrict; communes: CommuneView[]; points: ShippingPoint[] }
interface ProvinceView { node: LocProvince; districts: DistrictView[]; points: ShippingPoint[] }

const ProvincesSection: React.FC = () => {
    const {
        addCustomDistrict, removeDistrictEntry, addCustomCommune, removeCommuneEntry,
        restoreDistrictEntry, restoreCommuneEntry, shippingCompanies,
    } = useStore();
    const { showToast } = useToast();
    const { tree, loaded } = useLocationTree();

    const [points, setPoints] = useState<ShippingPoint[] | null>(null);
    const [pointsError, setPointsError] = useState<string | null>(null);
    const [busyPoint, setBusyPoint] = useState<string | null>(null);
    const [editor, setEditor] = useState<EditorState | null>(null);

    const [query, setQuery] = useState('');
    const [openProvinces, setOpenProvinces] = useState<Set<string>>(new Set());
    const [openDistricts, setOpenDistricts] = useState<Set<string>>(new Set());
    const [openCommunes, setOpenCommunes] = useState<Set<string>>(new Set());
    const [unplacedOpen, setUnplacedOpen] = useState(false);
    const [hiddenOpen, setHiddenOpen] = useState(false);
    const [districtDrafts, setDistrictDrafts] = useState<Record<string, string>>({});
    const [communeDrafts, setCommuneDrafts] = useState<Record<string, string>>({});

    const loadPoints = useCallback(async () => {
        try {
            setPoints(await fetchShippingPoints());
            setPointsError(null);
        } catch (e) {
            setPointsError(errText(e));
        }
    }, []);
    useEffect(() => { loadPoints(); }, [loadPoints]);

    const reportError = (err: unknown) => showToast('Failed to save: ' + errText(err), 'error');

    const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, code: string) => {
        const next = new Set(set);
        if (next.has(code)) next.delete(code); else next.add(code);
        setSet(next);
    };

    const placement = useMemo(() => placeShippingPoints(tree, points || []), [tree, points]);

    // ── Filtered view ──
    const q = query.trim();
    const qLower = q.toLowerCase();
    const haystacks = useMemo(() => new Map((points || []).map(p => [p.id, pointHaystack(p)])), [points]);
    const pointHit = useCallback((p: ShippingPoint) => !!qLower && (haystacks.get(p.id) || '').includes(qLower), [haystacks, qLower]);

    const view = useMemo((): ProvinceView[] => {
        const out: ProvinceView[] = [];
        for (const p of tree) {
            const pSelf = !q || matchesQuery(p, q);
            const districts: DistrictView[] = [];
            for (const d of visibleOnly(p.districts)) {
                const dSelf = pSelf || matchesQuery(d, q);
                const communes: CommuneView[] = [];
                for (const c of visibleOnly(d.communes)) {
                    const cSelf = dSelf || matchesQuery(c, q);
                    const all = placement.byCommune.get(c.code) || [];
                    const pts = cSelf ? all : all.filter(pointHit);
                    if (cSelf || pts.length) communes.push({ node: c, points: pts });
                }
                const dAll = placement.byDistrict.get(d.code) || [];
                const dPts = dSelf ? dAll : dAll.filter(pointHit);
                if (dSelf || communes.length || dPts.length) districts.push({ node: d, communes, points: dPts });
            }
            const pAll = placement.byProvince.get(p.code) || [];
            const pPts = pSelf ? pAll : pAll.filter(pointHit);
            if (pSelf || districts.length || pPts.length) out.push({ node: p, districts, points: pPts });
        }
        return out;
    }, [tree, q, placement, pointHit]);

    const unplaced = useMemo(
        () => (q ? placement.unplaced.filter(pointHit) : placement.unplaced),
        [placement, q, pointHit]
    );

    const hiddenEntries = useMemo(() => {
        const ds: { province: LocProvince; district: LocDistrict }[] = [];
        const cs: { province: LocProvince; district: LocDistrict; commune: LocCommune }[] = [];
        for (const p of tree) for (const d of p.districts || []) {
            if (d.isHidden) ds.push({ province: p, district: d });
            for (const c of d.communes || []) if (c.isHidden) cs.push({ province: p, district: d, commune: c });
        }
        return { districts: ds, communes: cs };
    }, [tree]);
    const hiddenCount = hiddenEntries.districts.length + hiddenEntries.communes.length;

    // ── District / commune edits ──
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
    const pointsNote = (n: number) => n > 0 ? `\n\n${n} shipping point${n === 1 ? '' : 's'} there will move up a level (nothing is deleted).` : '';
    const handleRemoveDistrict = (d: LocDistrict) => {
        const n = placement.districtCounts.get(d.code) || 0;
        const msg = d.isCustom
            ? `Delete the custom district "${d.khmer}" and its custom communes?${pointsNote(n)}`
            : `Hide the district "${locLabel(d)}" from the address pickers?\nYou can restore it later from "Hidden".${pointsNote(n)}`;
        if (!window.confirm(msg)) return;
        Promise.resolve(removeDistrictEntry(d.code, !!d.isCustom)).catch(reportError);
    };
    const handleRemoveCommune = (c: LocCommune) => {
        const n = placement.byCommune.get(c.code)?.length || 0;
        const msg = c.isCustom
            ? `Delete the custom commune "${c.khmer}"?${pointsNote(n)}`
            : `Hide the commune "${locLabel(c)}" from the address pickers?\nYou can restore it later from "Hidden".${pointsNote(n)}`;
        if (!window.confirm(msg)) return;
        Promise.resolve(removeCommuneEntry(c.code, !!c.isCustom)).catch(reportError);
    };

    // ── Shipping point edits ──
    const average = (list: ShippingPoint[]) => {
        const ok = list.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        if (!ok.length) return undefined;
        return { lat: ok.reduce((s, p) => s + p.lat, 0) / ok.length, lng: ok.reduce((s, p) => s + p.lng, 0) / ok.length, count: ok.length };
    };
    const openAdd = (p: LocProvince, d?: LocDistrict, c?: LocCommune) => {
        let suggestion: EditorState['suggestion'];
        if (c) {
            const a = average(placement.byCommune.get(c.code) || []);
            if (a) suggestion = { ...a, where: c.khmer };
        }
        if (!suggestion && d) {
            const list = [...(placement.byDistrict.get(d.code) || []), ...visibleOnly(d.communes).flatMap(x => placement.byCommune.get(x.code) || [])];
            const a = average(list);
            if (a) suggestion = { ...a, where: d.khmer };
        }
        setEditor({
            id: null, latLng: '', suggestion,
            fields: {
                name: '', courier: (Array.isArray(shippingCompanies) && shippingCompanies[0]) || '', province: p.khmer, district: d?.khmer || '', commune: c?.khmer || '',
                phone: '', contactName: '', isShutdown: false,
            },
        });
    };
    const openEdit = (pt: ShippingPoint) => {
        const latLng = Number.isFinite(pt.lat) && Number.isFinite(pt.lng) ? `${pt.lat}, ${pt.lng}` : '';
        setEditor({
            id: pt.id,
            latLng,
            originalLatLng: latLng,
            fields: {
                name: pt.name || '', courier: pt.courier || '', province: pt.province || '', district: pt.district || '', commune: pt.commune || '',
                phone: pt.phone || '', contactName: pt.contact_name || '', isShutdown: !!pt.is_shutdown,
            },
        });
    };
    const togglePoint = async (pt: ShippingPoint) => {
        setBusyPoint(pt.id);
        try {
            await setShippingPointShutdown(pt.id, !pt.is_shutdown);
            await loadPoints();
            showToast(`"${pt.name}" is now ${pt.is_shutdown ? 'reactivated' : 'temporarily shut down'}`, 'success');
        } catch (e) { reportError(e); } finally { setBusyPoint(null); }
    };
    const removePoint = async (pt: ShippingPoint) => {
        if (!window.confirm(`តើអ្នកពិតជាចង់លុបទីតាំង "${pt.name}" មែនទេ?\nDelete this shipping point permanently?`)) return;
        setBusyPoint(pt.id);
        try {
            await deleteShippingPoint(pt.id);
            await loadPoints();
            showToast(`Shipping point removed: ${pt.name}`, 'success');
        } catch (e) { reportError(e); } finally { setBusyPoint(null); }
    };
    const renderPoints = (list: ShippingPoint[], indent: string) => list.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: `2px 12px 6px ${indent}` }}>
            {list.map(pt => (
                <PointRow key={pt.id} point={pt} note={placement.notes.get(pt.id)} busy={busyPoint === pt.id}
                    onEdit={() => openEdit(pt)} onToggle={() => togglePoint(pt)} onDelete={() => removePoint(pt)} />
            ))}
        </div>
    );
    const addPointBtn = (label: string, onClick: () => void) => (
        <button onClick={onClick} title={label} aria-label={label} style={{ ...smallBtn, color: 'var(--color-primary)' }}>
            <MapPin size={13} /><Plus size={10} style={{ marginLeft: '-2px' }} />
        </button>
    );

    const totalPoints = points?.length ?? 0;

    return (
        <div style={{ ...cardStyle, padding: '20px 22px', flex: '1 1 560px', maxWidth: '760px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-text-main)' }}>Provinces</div>
                <div style={{ ...helpStyle, marginTop: '4px' }}>
                    The address list the checkout form and the Shipping Points page use. Provinces are fixed; add a district or commune of your own, or hide one that doesn't apply.
                    Each commune lists the shipping points in it — add, edit or remove them here, or pin them on the map on the Shipping Points page.
                </div>
            </div>
            <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
                <input
                    type="text" value={query} placeholder="Search province, district, commune or shipping point..." className="search-input"
                    onChange={e => setQuery(e.target.value)} aria-label="Search provinces and shipping points"
                    style={{ width: '100%', padding: '9px 12px 9px 34px', boxSizing: 'border-box' }}
                />
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                {points === null && !pointsError && <span>Loading shipping points…</span>}
                {points !== null && <span>{totalPoints} shipping points · {totalPoints - placement.unplaced.length} placed in the tree</span>}
                {pointsError && <span style={{ color: '#b91c1c' }}>Couldn't load shipping points: {pointsError} <button onClick={loadPoints} style={{ ...smallBtn, display: 'inline', color: 'var(--color-primary)', fontWeight: 600 }}>Retry</button></span>}
            </div>
            {!loaded ? (
                <div style={{ padding: '18px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-secondary)' }}>Loading…</div>
            ) : (
                <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px', maxHeight: '620px', overflowY: 'auto' }}>
                    {/* Points whose province matches nothing — never dropped. */}
                    {unplaced.length > 0 && (
                        <div style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(245, 158, 11, 0.06)' }}>
                            <button onClick={() => setUnplacedOpen(o => !o)} aria-expanded={q ? true : unplacedOpen}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '13px', fontWeight: 700, color: '#b45309' }}>
                                {(q || unplacedOpen) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                <AlertTriangle size={14} />
                                <span>Unplaced points</span>
                                <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>no matching province — edit one to place it</span>
                                <span style={{ marginLeft: 'auto' }}>{countChip(unplaced.length, 'Unplaced shipping points')}</span>
                            </button>
                            {(q || unplacedOpen) && renderPoints(unplaced, '22px')}
                        </div>
                    )}
                    {view.length === 0 && unplaced.length === 0 && (
                        <div style={{ padding: '18px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-secondary)' }}>No match for "{q}".</div>
                    )}
                    {view.map(({ node: p, districts, points: pPoints }) => {
                        const isOpen = q ? true : openProvinces.has(p.code);
                        return (
                            <div key={p.code} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <button
                                        onClick={() => toggle(openProvinces, setOpenProvinces, p.code)} aria-expanded={isOpen}
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}
                                    >
                                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                        <span>{p.khmer} ({p.latin})</span>
                                        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 500, color: 'var(--color-text-secondary)', flexShrink: 0 }}>
                                            {visibleOnly(p.districts).length} districts
                                            {countChip(placement.provinceCounts.get(p.code) || 0, 'Shipping points in this province')}
                                        </span>
                                    </button>
                                    <div style={{ marginRight: '10px' }}>{addPointBtn(`Add a shipping point in ${p.latin}`, () => openAdd(p))}</div>
                                </div>
                                {isOpen && pPoints.length > 0 && (
                                    <div style={{ padding: '0 0 4px 22px' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', padding: '2px 12px' }}>No district set</div>
                                        {renderPoints(pPoints, '12px')}
                                    </div>
                                )}
                                {isOpen && districts.map(({ node: d, communes, points: dPoints }) => {
                                    const dOpen = q ? true : openDistricts.has(d.code);
                                    return (
                                        <div key={d.code} style={{ paddingLeft: '22px', borderTop: '1px solid var(--color-border)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <button
                                                    onClick={() => toggle(openDistricts, setOpenDistricts, d.code)} aria-expanded={dOpen}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '12.5px', fontWeight: 500, color: 'var(--color-text-main)' }}
                                                >
                                                    {dOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{locLabel(d)}</span>
                                                    {d.isCustom && <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '1px 6px', borderRadius: '999px' }}>Custom</span>}
                                                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
                                                        {visibleOnly(d.communes).length} communes
                                                        {countChip(placement.districtCounts.get(d.code) || 0, 'Shipping points in this district')}
                                                    </span>
                                                </button>
                                                {addPointBtn(`Add a shipping point in ${d.latin}`, () => openAdd(p, d))}
                                                <button onClick={() => handleRemoveDistrict(d)} title={d.isCustom ? `Delete ${d.latin}` : `Hide ${d.latin}`} aria-label={d.isCustom ? `Delete ${d.latin}` : `Hide ${d.latin}`} style={{ ...smallBtn, color: '#ef4444', marginRight: '8px' }}>
                                                    {d.isCustom ? <Trash2 size={14} /> : <EyeOff size={14} />}
                                                </button>
                                            </div>
                                            {dOpen && (
                                                <>
                                                    {dPoints.length > 0 && (
                                                        <div>
                                                            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', padding: '2px 12px 2px 28px' }}>No commune set</div>
                                                            {renderPoints(dPoints, '28px')}
                                                        </div>
                                                    )}
                                                    <div style={{ display: 'flex', flexDirection: 'column', padding: '0 0 4px 22px' }}>
                                                        {communes.map(({ node: c, points: cPoints }) => {
                                                            const total = placement.byCommune.get(c.code)?.length || 0;
                                                            const cOpen = (q && cPoints.length > 0 && !matchesQuery(c, q)) || openCommunes.has(c.code);
                                                            return (
                                                                <div key={c.code}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                                        <button onClick={() => total > 0 && toggle(openCommunes, setOpenCommunes, c.code)} aria-expanded={total > 0 ? !!cOpen : undefined}
                                                                            style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0, padding: '4px 6px', background: 'transparent', border: 'none', cursor: total > 0 ? 'pointer' : 'default', textAlign: 'left', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                                            {total > 0 ? (cOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12, flexShrink: 0 }} />}
                                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{locLabel(c)}</span>
                                                                            {c.isCustom && <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--color-primary)', flexShrink: 0 }}>•custom</span>}
                                                                            <span style={{ marginLeft: 'auto' }}>{countChip(total, 'Shipping points in this commune')}</span>
                                                                        </button>
                                                                        {addPointBtn(`Add a shipping point in ${c.latin}`, () => openAdd(p, d, c))}
                                                                        <button onClick={() => handleRemoveCommune(c)} title={c.isCustom ? `Delete ${c.latin}` : `Hide ${c.latin}`} aria-label={c.isCustom ? `Delete ${c.latin}` : `Hide ${c.latin}`} style={{ ...smallBtn, color: '#ef4444', marginRight: '8px', flexShrink: 0 }}>
                                                                            {c.isCustom ? <Trash2 size={12} /> : <EyeOff size={12} />}
                                                                        </button>
                                                                    </div>
                                                                    {cOpen && renderPoints(cPoints, '24px')}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '6px', padding: '0 12px 10px 28px' }}>
                                                        <input
                                                            type="text" value={communeDrafts[d.code] || ''} placeholder="Add a commune..." className="search-input"
                                                            onChange={e => setCommuneDrafts(prev => ({ ...prev, [d.code]: e.target.value }))}
                                                            onKeyDown={e => { if (e.key === 'Enter') handleAddCommune(d.code); }}
                                                            style={{ flex: 1, minWidth: 0, padding: '6px 10px', fontSize: '12px' }}
                                                        />
                                                        <button onClick={() => handleAddCommune(d.code)} disabled={!(communeDrafts[d.code] || '').trim()} className="primary-button" aria-label="Add commune"
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
                                            style={{ flex: 1, minWidth: 0, padding: '7px 10px', fontSize: '12.5px' }}
                                        />
                                        <button onClick={() => handleAddDistrict(p.code)} disabled={!(districtDrafts[p.code] || '').trim()} className="primary-button" aria-label="Add district"
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

            {/* Hidden official entries, with restore. */}
            {loaded && hiddenCount > 0 && (
                <div style={{ border: '1px solid var(--color-border)', borderRadius: '10px' }}>
                    <button onClick={() => setHiddenOpen(o => !o)} aria-expanded={hiddenOpen}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)' }}>
                        {hiddenOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        <EyeOff size={14} /> Hidden ({hiddenCount}) – restore
                    </button>
                    {hiddenOpen && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 12px 10px 34px' }}>
                            {hiddenEntries.districts.map(({ province, district }) => (
                                <div key={district.code} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--color-text-main)' }}>
                                    <span style={{ flex: 1, minWidth: 0 }}>District · {province.khmer} › {district.khmer} ({district.latin})</span>
                                    <button onClick={() => Promise.resolve(restoreDistrictEntry(district.code)).catch(reportError)}
                                        style={{ ...smallBtn, gap: '4px', color: 'var(--color-primary)', fontSize: '12px', fontWeight: 600 }}><RotateCcw size={12} />Restore</button>
                                </div>
                            ))}
                            {hiddenEntries.communes.map(({ province, district, commune }) => (
                                <div key={commune.code} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--color-text-main)' }}>
                                    <span style={{ flex: 1, minWidth: 0 }}>Commune · {province.khmer} › {district.khmer} › {commune.khmer} ({commune.latin})</span>
                                    <button onClick={() => Promise.resolve(restoreCommuneEntry(commune.code)).catch(reportError)}
                                        style={{ ...smallBtn, gap: '4px', color: 'var(--color-primary)', fontSize: '12px', fontWeight: 600 }}><RotateCcw size={12} />Restore</button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {editor && (
                <PointEditor state={editor} tree={tree} couriers={Array.isArray(shippingCompanies) ? shippingCompanies : []}
                    onChange={setEditor} onCancel={() => setEditor(null)}
                    onSaved={() => { setEditor(null); loadPoints(); }} />
            )}
        </div>
    );
};

export default ProvincesSection;
