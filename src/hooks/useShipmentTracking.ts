import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Sale } from '../types';
import { detectCarrier, canAutoTrack, isRecentlyChecked, type ShipmentTrackingRow } from '../utils/tracking';

// Carrier status for orders: cached rows live in `shipment_tracking` (one per
// tracking number); fresh lookups go through the /api/track-shipments
// serverless function and are written back here.
//
// Cache rules keep carrier traffic polite: delivered parcels are never
// re-checked, and anything checked within MIN_RECHECK_MINUTES is skipped.
const MIN_RECHECK_MINUTES = 60;
// Matches the serverless function's per-request cap (its time budget).
const MAX_PER_RUN = 12;

export interface TrackRunSummary { checked: number; updated: number; delivered: number; failed: number; skipped: number; error?: string }

export const useShipmentTracking = () => {
    const [trackingMap, setTrackingMapState] = useState<Record<string, ShipmentTrackingRow>>({});
    const [isTracking, setIsTracking] = useState(false);
    const [lastRun, setLastRun] = useState<TrackRunSummary | null>(null);
    const loadedRef = useRef<Set<string>>(new Set());
    // Live mirrors so callbacks created before a state update (e.g. an effect
    // that awaits loadCached and then tracks) still see the freshest cache and
    // can't start a second run while one is in flight.
    const mapRef = useRef<Record<string, ShipmentTrackingRow>>({});
    const inFlightRef = useRef(false);
    const setTrackingMap = useCallback((updater: (prev: Record<string, ShipmentTrackingRow>) => Record<string, ShipmentTrackingRow>) => {
        mapRef.current = updater(mapRef.current);
        setTrackingMapState(mapRef.current);
    }, []);

    // Load cached rows for the given tracking numbers (skips ones already held).
    const loadCached = useCallback(async (trackingNos: string[]) => {
        const wanted = Array.from(new Set(trackingNos.map(t => String(t || '').trim()).filter(Boolean)))
            .filter(t => !loadedRef.current.has(t));
        if (wanted.length === 0) return;
        wanted.forEach(t => loadedRef.current.add(t));
        for (let i = 0; i < wanted.length; i += 200) {
            const chunk = wanted.slice(i, i + 200);
            const { data, error } = await supabase.from('shipment_tracking').select('*').in('tracking_no', chunk);
            if (error) {
                // Table missing (migration not run) or network — leave the map as is.
                console.warn('shipment_tracking read failed:', error.message);
                chunk.forEach(t => loadedRef.current.delete(t));
                return;
            }
            if (data && data.length > 0) {
                setTrackingMap(prev => {
                    const next = { ...prev };
                    for (const row of data as ShipmentTrackingRow[]) next[row.tracking_no] = row;
                    return next;
                });
            }
        }
    }, [setTrackingMap]);

    // Orders worth checking now: shipped (not yet delivered in the app), with a
    // tracking number, on a carrier we have an adapter for, not delivered per
    // the carrier already, and not checked recently.
    const pickCandidates = useCallback((orders: Sale[], maxAgeMinutes = MIN_RECHECK_MINUTES) => {
        const seen = new Set<string>();
        const out: Array<{ trackingNo: string; carrier: string }> = [];
        for (const o of orders) {
            const no = String(o.shipping?.trackingNumber || '').trim();
            const carrier = detectCarrier(o.shipping?.company);
            // Only carriers with a working server-side adapter (see canAutoTrack).
            if (!no || !carrier || !canAutoTrack(o.shipping?.company) || seen.has(no)) continue;
            if (o.shipping?.status !== 'Shipped') continue;
            const cached = mapRef.current[no];
            if (cached?.is_delivered) continue;
            if (isRecentlyChecked(cached, maxAgeMinutes)) continue;
            seen.add(no);
            out.push({ trackingNo: no, carrier });
            if (out.length >= MAX_PER_RUN) break;
        }
        return out;
    }, []);

    // Run lookups for the given orders and cache the results.
    const trackOrders = useCallback(async (orders: Sale[], opts?: { maxAgeMinutes?: number }): Promise<TrackRunSummary> => {
        const candidates = pickCandidates(orders, opts?.maxAgeMinutes);
        const summary: TrackRunSummary = { checked: 0, updated: 0, delivered: 0, failed: 0, skipped: orders.length - candidates.length };
        if (candidates.length === 0 || inFlightRef.current) { setLastRun(summary); return summary; }
        inFlightRef.current = true;
        setIsTracking(true);
        try {
            const res = await fetch('/api/track-shipments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: candidates }),
            });
            if (!res.ok) {
                summary.error = res.status === 404
                    ? 'Tracking service not available here (it runs on the deployed site)'
                    : `Tracking service error ${res.status}`;
                setLastRun(summary);
                return summary;
            }
            const json = await res.json();
            const results: any[] = json?.results || [];
            const now = new Date().toISOString();
            const prev = mapRef.current;
            const rows: ShipmentTrackingRow[] = results.map(r => {
                const old = prev[r.trackingNo];
                return {
                    tracking_no: r.trackingNo,
                    carrier: r.carrier || null,
                    last_status: r.ok ? (r.status || null) : (old?.last_status || null),
                    last_event_at: r.ok ? (r.lastEventAt || null) : (old?.last_event_at || null),
                    is_delivered: r.ok ? !!r.isDelivered : !!old?.is_delivered,
                    events: r.ok ? (r.events || []) : (old?.events || []),
                    error: r.ok ? null : (r.error || 'Lookup failed'),
                    checked_at: now,
                };
            });
            summary.checked = rows.length;
            summary.updated = rows.filter(r => !r.error).length;
            summary.delivered = rows.filter(r => r.is_delivered).length;
            summary.failed = rows.filter(r => !!r.error).length;

            setTrackingMap(current => {
                const next = { ...current };
                for (const row of rows) next[row.tracking_no] = row;
                return next;
            });
            if (rows.length > 0) {
                const { error } = await supabase.from('shipment_tracking').upsert(rows, { onConflict: 'tracking_no' });
                if (error) {
                    console.warn('shipment_tracking upsert failed (run migrations/shipment_tracking.sql?):', error.message);
                    summary.error = 'Statuses fetched but not saved: ' + error.message;
                }
            }
            setLastRun(summary);
            return summary;
        } catch (e: any) {
            summary.error = e?.message || 'Tracking failed';
            setLastRun(summary);
            return summary;
        } finally {
            inFlightRef.current = false;
            setIsTracking(false);
        }
    }, [pickCandidates, setTrackingMap]);

    return { trackingMap, isTracking, lastRun, loadCached, trackOrders, pickCandidates };
};
