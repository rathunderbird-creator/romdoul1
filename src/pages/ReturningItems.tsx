// Returning Items: parcels a carrier is bringing back (order status 'Returned',
// shown to staff as "Returning") that have not been restocked yet. While an
// order sits here its goods are counted OUT of stock but are not on the shelf,
// so this page is where staff chase the carrier and, once the parcel is
// physically back in the shop, restock it (ReStock puts the units back).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Boxes, Clock, ExternalLink, Package, RefreshCw, Search, Undo2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useHeader } from '../context/HeaderContext';
import { useMobile } from '../hooks/useMobile';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../utils/fetchAll';
import { mapSaleEntity } from '../utils/mapper';
import { buildTrackingUrl } from '../utils/tracking';
import { formatPhoneDisplay } from '../utils/telecom';
import { getShippingCoColor } from '../utils/orderUtils';
import { StatsCard, Modal } from '../components';
import type { Sale } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
type AgeFilter = 'all' | '7' | '30';

// When the order became Returning: its latest "status → Returned" activity-log
// entry. Without one (older orders, or a failed log write) fall back to the
// last edit — any edit moves that, so it's labelled as such.
type Since = { at: string; fromLog: boolean };
const sinceOf = (o: Sale, returnedAt: Map<string, string>): Since => {
    const logged = returnedAt.get(String(o.id));
    return logged ? { at: logged, fromLog: true } : { at: o.lastEditedAt || o.date || '', fromLog: false };
};
const daysSince = (iso: string, now: number): number => {
    const ref = Date.parse(iso);
    return Number.isFinite(ref) ? Math.max(0, Math.floor((now - ref) / DAY_MS)) : 0;
};
const ageColor = (d: number) => (d >= 30 ? '#DC2626' : d >= 7 ? '#D97706' : 'var(--color-text-secondary)');
const money = (n: number) => `$${n.toFixed(2)}`;
const errorText = (e: unknown, fallback: string): string => {
    const m = e && typeof e === 'object' ? (e as { message?: unknown }).message : undefined;
    return typeof m === 'string' && m ? m : fallback;
};
const shortDate = (iso?: string) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
};

const ReturningItems: React.FC = () => {
    const { products, bulkRestockOrders, hasPermission, salesUpdatedAt, trackingUrlTemplates } = useStore();
    const { showToast } = useToast();
    const { setHeaderContent } = useHeader();
    const isMobile = useMobile();
    const navigate = useNavigate();
    const canRestock = hasPermission('restock_orders');

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Returning Items</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Parcels on their way back that are not restocked yet</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const [orders, setOrders] = useState<Sale[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [search, setSearch] = useState('');
    const [carrier, setCarrier] = useState('');
    const [age, setAge] = useState<AgeFilter>('all');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
    const [restocking, setRestocking] = useState(false);
    // Fixed per load, so ages don't shift while the page is open.
    const [now, setNow] = useState(() => Date.now());
    const [returnedAt, setReturnedAt] = useState<Map<string, string>>(new Map());
    // Only the latest load may commit (a restock triggers a reload while one may run).
    const loadSeq = useRef(0);

    const load = useCallback(async () => {
        const seq = ++loadSeq.current;
        setLoading(true);
        setLoadError('');
        try {
            const rows = await fetchAll((from, to) => supabase.from('sales')
                .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                .eq('shipping_status', 'Returned')
                .order('id').range(from, to), 1000, { label: 'ReturningItems' });
            const mapped = rows.map(mapSaleEntity);
            // When each became Returning, from the activity log (best effort).
            const since = new Map<string, string>();
            const ids = mapped.map(s => String(s.id));
            for (let i = 0; i < ids.length; i += 100) {
                const { data, error } = await supabase.from('activity_logs')
                    .select('metadata, created_at')
                    .eq('action', 'order_status')
                    .eq('metadata->>status', 'Returned')
                    .in('metadata->>orderId', ids.slice(i, i + 100));
                if (error) break;
                for (const row of (data || []) as { metadata?: { orderId?: string }; created_at: string }[]) {
                    const id = String(row.metadata?.orderId || '');
                    if (id && (!since.has(id) || row.created_at > (since.get(id) as string))) since.set(id, row.created_at);
                }
            }
            if (seq !== loadSeq.current) return;
            setOrders(mapped);
            setReturnedAt(since);
            // Keep a selection across reloads where the order is still listed.
            setSelected(prev => new Set([...prev].filter(id => ids.includes(id))));
            setNow(Date.now());
        } catch (e) {
            console.error('Failed to load returning orders:', e);
            if (seq === loadSeq.current) setLoadError(errorText(e, 'Could not load returning orders.'));
        } finally {
            if (seq === loadSeq.current) setLoading(false);
        }
    }, []);
    // Reload when orders change anywhere (e.g. restocked from Orders Management).
    useEffect(() => { load(); }, [load, salesUpdatedAt]);

    const costOf = useMemo(() => {
        const m = new Map(products.map(p => [String(p.id), Number(p.purchaseCost) || 0]));
        return (o: Sale) => o.items.reduce((s, i) => s + (m.get(String(i.id)) || 0) * (Number(i.quantity) || 0), 0);
    }, [products]);

    const carriers = useMemo(() => Array.from(new Set(orders.map(o => o.shipping?.company || '').filter(Boolean))).sort(), [orders]);

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        const qDigits = q.replace(/\D/g, '');
        return orders
            .filter(o => !carrier || (o.shipping?.company || '') === carrier)
            .filter(o => age === 'all' || daysSince(sinceOf(o, returnedAt).at, now) >= Number(age))
            .filter(o => {
                if (!q) return true;
                const phone = String(o.customer?.phone || '').replace(/\D/g, '');
                return String(o.id).includes(q)
                    || (o.customer?.name || '').toLowerCase().includes(q)
                    || (!!qDigits && phone.includes(qDigits))
                    || (o.shipping?.trackingNumber || '').toLowerCase().includes(q)
                    || o.items.some(i => (i.name || '').toLowerCase().includes(q));
            })
            .sort((a, b) => daysSince(sinceOf(b, returnedAt).at, now) - daysSince(sinceOf(a, returnedAt).at, now));
    }, [orders, search, carrier, age, now, returnedAt]);

    const stats = useMemo(() => {
        const units = orders.reduce((s, o) => s + o.items.reduce((n, i) => n + (Number(i.quantity) || 0), 0), 0);
        const value = orders.reduce((s, o) => s + costOf(o), 0);
        const oldest = orders.reduce((m, o) => Math.max(m, daysSince(sinceOf(o, returnedAt).at, now)), 0);
        const over30 = orders.filter(o => daysSince(sinceOf(o, returnedAt).at, now) >= 30).length;
        return { parcels: orders.length, units, value, oldest, over30 };
    }, [orders, costOf, now, returnedAt]);

    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const allShownSelected = rows.length > 0 && rows.every(o => selected.has(o.id));
    const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(rows.map(o => o.id)));

    const doRestock = async () => {
        if (!confirmIds?.length) return;
        setRestocking(true);
        try {
            const n = await bulkRestockOrders(confirmIds);
            const skipped = confirmIds.length - n;
            showToast(n === 0
                ? 'Nothing restocked: these orders are no longer Returning.'
                : `Restocked ${n} order${n === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} skipped — no longer Returning)` : ''}.`, n === 0 ? 'info' : 'success');
            setConfirmIds(null);
            // bulkRestockOrders bumps salesUpdatedAt, which reloads this list.
        } catch (e) {
            showToast(errorText(e, 'Restock failed.'), 'error');
        } finally {
            setRestocking(false);
        }
    };

    const confirmOrders = useMemo(() => orders.filter(o => confirmIds?.includes(o.id)), [orders, confirmIds]);

    const trackingCell = (o: Sale) => {
        const no = o.shipping?.trackingNumber || '';
        const url = buildTrackingUrl(o.shipping?.company, no, trackingUrlTemplates);
        if (!no) return <span style={{ color: 'var(--color-text-muted)' }}>-</span>;
        return url
            ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>{no}<ExternalLink size={12} /></a>
            : <span>{no}</span>;
    };

    const itemsText = (o: Sale) => o.items.map(i => `${i.name} ×${i.quantity}`).join(', ') || '-';

    const restockButton = (ids: string[], label: string) => canRestock && (
        <button
            onClick={() => setConfirmIds(ids)}
            disabled={ids.length === 0}
            title="Use only when the parcel is physically back in the shop"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '8px', border: '1px solid #C084FC', background: '#F5F3FF', color: '#7E22CE', fontWeight: 600, fontSize: '12px', cursor: ids.length ? 'pointer' : 'not-allowed', opacity: ids.length ? 1 : 0.5, whiteSpace: 'nowrap' }}
        >
            <Undo2 size={14} /> {label}
        </button>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '12px' }}>
                <StatsCard title="Parcels returning" value={stats.parcels} icon={Package} color="#DC2626" />
                <StatsCard title="Units" value={stats.units} icon={Boxes} color="#2563EB" />
                <StatsCard title="Value at cost" value={money(stats.value)} icon={AlertTriangle} color="#D97706" />
                <StatsCard title="Oldest (days)" value={stats.oldest} icon={Clock} color="#7E22CE"
                    trend={stats.over30 > 0 ? <span style={{ color: '#DC2626' }}>{stats.over30} over 30 days</span> : undefined} />
            </div>

            <div className="glass-panel" style={{ padding: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: isMobile ? '1 1 100%' : '1 1 260px' }}>
                    <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                    <input className="search-input" value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search order, customer, phone, tracking, product"
                        style={{ width: '100%', padding: '8px 10px 8px 30px' }} />
                </div>
                <select value={carrier} onChange={e => setCarrier(e.target.value)} className="search-input" style={{ padding: '8px 10px' }}>
                    <option value="">All carriers</option>
                    {carriers.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={age} onChange={e => setAge(e.target.value as AgeFilter)} className="search-input" style={{ padding: '8px 10px' }}>
                    <option value="all">Any age</option>
                    <option value="7">7+ days</option>
                    <option value="30">30+ days</option>
                </select>
                <button onClick={load} title="Refresh" className="search-input" style={{ padding: '8px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                    <RefreshCw size={14} />
                </button>
                <div style={{ flex: 1 }} />
                {!isMobile && restockButton(Array.from(selected), `Received → ReStock (${selected.size})`)}
            </div>

            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                <AlertTriangle size={14} style={{ color: '#D97706', flexShrink: 0, marginTop: '1px' }} />
                <span>These goods are already counted out of stock. Press ReStock only when the parcel is physically back in the shop; until then, follow it up with the carrier using the tracking number.</span>
            </div>

            {loadError && <div style={{ color: '#DC2626', fontSize: '13px' }}>{loadError}</div>}

            {isMobile ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {rows.map(o => {
                        const d = daysSince(sinceOf(o, returnedAt).at, now);
                        return (
                            <div key={o.id} className="glass-panel" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                                    <button onClick={() => navigate(`/orders/${o.id}`)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>#{o.id}</button>
                                    <span style={{ color: ageColor(d), fontWeight: 600, fontSize: '12px' }}>{d} days</span>
                                </div>
                                <div style={{ fontWeight: 600 }}>{o.customer?.name || '-'} <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)' }}>{formatPhoneDisplay(o.customer?.phone)}</span></div>
                                <div style={{ fontSize: '12px' }}><span style={{ color: getShippingCoColor(o.shipping?.company || '') }}>{o.shipping?.company || '-'}</span> · {trackingCell(o)}</div>
                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{itemsText(o)} · {money(costOf(o))}</div>
                                {restockButton([o.id], 'Received → ReStock')}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="glass-panel" style={{ padding: 0, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', background: 'var(--color-surface-hover)' }}>
                                {canRestock && <th style={{ padding: '10px 12px', width: '32px' }}><input type="checkbox" checked={allShownSelected} onChange={toggleAll} /></th>}
                                <th style={{ padding: '10px 12px' }}>Order</th>
                                <th style={{ padding: '10px 12px' }}>Order date</th>
                                <th style={{ padding: '10px 12px' }}>Waiting</th>
                                <th style={{ padding: '10px 12px' }}>Customer</th>
                                <th style={{ padding: '10px 12px' }}>Phone</th>
                                <th style={{ padding: '10px 12px' }}>Carrier</th>
                                <th style={{ padding: '10px 12px' }}>Tracking</th>
                                <th style={{ padding: '10px 12px' }}>Items</th>
                                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Cost</th>
                                <th style={{ padding: '10px 12px' }}>Remark</th>
                                {canRestock && <th style={{ padding: '10px 12px' }} />}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(o => {
                                const d = daysSince(sinceOf(o, returnedAt).at, now);
                                return (
                                    <tr key={o.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                                        {canRestock && <td style={{ padding: '8px 12px' }}><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} /></td>}
                                        <td style={{ padding: '8px 12px' }}>
                                            <button onClick={() => navigate(`/orders/${o.id}`)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>{o.id}</button>
                                        </td>
                                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{shortDate(o.date)}</td>
                                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: ageColor(d), fontWeight: 600 }} title={sinceOf(o, returnedAt).fromLog ? `Returning since ${shortDate(sinceOf(o, returnedAt).at)}` : `Since ${shortDate(sinceOf(o, returnedAt).at)} (last change to the order — no status log found)`}>{d} days</td>
                                        <td style={{ padding: '8px 12px' }}>{o.customer?.name || '-'}</td>
                                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{formatPhoneDisplay(o.customer?.phone) || '-'}</td>
                                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: getShippingCoColor(o.shipping?.company || ''), fontWeight: 600 }}>{o.shipping?.company || '-'}</td>
                                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{trackingCell(o)}</td>
                                        <td style={{ padding: '8px 12px' }}>{itemsText(o)}</td>
                                        <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(costOf(o))}</td>
                                        <td style={{ padding: '8px 12px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }} title={o.remark || ''}>{o.remark || '-'}</td>
                                        {canRestock && <td style={{ padding: '8px 12px' }}>{restockButton([o.id], 'ReStock')}</td>}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {!loading && !loadError && rows.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-secondary)' }}>
                    {orders.length === 0 ? 'No parcels are returning. 🎉' : 'No returning parcels match these filters.'}
                </div>
            )}
            {loading && <div style={{ textAlign: 'center', padding: '16px', color: 'var(--color-text-secondary)' }}>Loading…</div>}

            <Modal isOpen={!!confirmIds} onClose={() => !restocking && setConfirmIds(null)} title="Parcel received — restock?" width="480px">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
                    <p>Restock {confirmOrders.length} order{confirmOrders.length === 1 ? '' : 's'}? Their goods go back into stock and the order{confirmOrders.length === 1 ? ' becomes' : 's become'} ReStock.</p>
                    <div style={{ maxHeight: '180px', overflowY: 'auto', background: 'var(--color-surface-hover)', borderRadius: '8px', padding: '8px 12px' }}>
                        {confirmOrders.map(o => <div key={o.id}>#{o.id} · {itemsText(o)}</div>)}
                    </div>
                    <p style={{ color: '#B45309', fontWeight: 600 }}>Only confirm if the parcel{confirmOrders.length === 1 ? ' is' : 's are'} physically back in the shop.</p>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button onClick={() => setConfirmIds(null)} disabled={restocking} className="search-input" style={{ padding: '8px 14px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={doRestock} disabled={restocking} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#7E22CE', color: 'white', fontWeight: 600, cursor: restocking ? 'wait' : 'pointer' }}>
                            {restocking ? 'Restocking…' : 'Yes, restock'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ReturningItems;
