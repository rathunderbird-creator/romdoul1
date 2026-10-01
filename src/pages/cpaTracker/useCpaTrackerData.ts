// Data layer for the Profit & CPA Tracker: the range's sales with line items
// (one parallel fetch per calendar month — same select as Prediction by Page,
// so every Income & Expense screen sees identical rows), the WHOLE product
// catalogue (active + inactive — a discontinued SKU's history keeps its real
// price/cost; see ../../utils/fetchAllProducts.ts), the range's manual daily
// inputs, and every unit-economics setting.
//
// The two cpa_* tables are read separately from the orders: the app runs on
// several hand-migrated Supabase instances, so where full_schema.sql hasn't
// been re-run yet the screen still shows the counted orders, with the inputs
// disabled (`missingTables`) instead of failing outright.
//
// Writes are COLUMN-SCOPED: an edit upserts only the field that changed, so
// it can never overwrite another field someone else (another tab, another
// user) saved since this page loaded. A row that ends up with nothing in it
// is removed by a conditional delete that only matches if it is empty on the
// server too.
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../utils/fetchAll';
import { fetchInMonthWindows } from '../../utils/fetchInMonthWindows';
import { fetchAllProducts } from '../../utils/fetchAllProducts';
import { isMissingTableError, errMessage } from '../../utils/supabaseErrors';
import { mapSaleEntity } from '../../utils/mapper';
import type { DateRange } from '../../utils/dateRange';
import type { Product } from '../../types';
import {
    entryKey, isEmptyEntry,
    type Order, type DailyEntryRow, type ProductSettingRow, type EntryField, type EntryPatch, type SettingField,
} from './metrics';

const ENTRY_TABLE = 'cpa_daily_entries';
const SETTINGS_TABLE = 'cpa_product_settings';

const ENTRY_COLUMN: Record<EntryField, string> = {
    adSpend: 'ad_spend', inboundChats: 'inbound_chats', closedOverride: 'closed_override', deliveredOverride: 'delivered_override',
};
const SETTING_COLUMN: Record<SettingField, string> = {
    courierFee: 'courier_fee', packaging: 'packaging', desiredProfit: 'desired_profit', expectedDeliveryRate: 'expected_delivery_rate',
};

const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

const mapEntry = (r: any): DailyEntryRow => ({
    date: String(r.date),
    page: String(r.page ?? ''),
    productId: String(r.product_id ?? ''),
    adSpend: Number(r.ad_spend) || 0,
    inboundChats: numOrNull(r.inbound_chats),
    closedOverride: numOrNull(r.closed_override),
    deliveredOverride: numOrNull(r.delivered_override),
});

const mapSetting = (r: any): ProductSettingRow => ({
    productId: String(r.product_id),
    courierFee: numOrNull(r.courier_fee),
    packaging: numOrNull(r.packaging),
    desiredProfit: numOrNull(r.desired_profit),
    expectedDeliveryRate: numOrNull(r.expected_delivery_rate),
});

export interface CpaTrackerDataState {
    sales: Order[];
    products: Product[];
    entries: DailyEntryRow[];
    settings: ProductSettingRow[];
    now: Date;
    loading: boolean;
    refreshing: boolean;
    ready: boolean;            // the current range's data has loaded at least once
    error: string | null;
    missingTables: boolean;
    refresh: () => void;
    commitEntry: (date: string, page: string, productId: string, patch: EntryPatch) => Promise<void>;
    commitSetting: (productId: string, field: SettingField, value: number | null) => Promise<void>;
}

// Queue per key so overlapping edits to one row are applied in order, each
// from the state the previous one left.
const useChain = () => {
    const chainRef = useRef<Record<string, Promise<void>>>({});
    return useCallback((key: string, task: () => Promise<void>): Promise<void> => {
        const prior = chainRef.current[key] ?? Promise.resolve();
        const run = prior.catch(() => {}).then(task);
        chainRef.current[key] = run.catch(() => {});
        return run;
    }, []);
};

export const useCpaTrackerData = (range: DateRange, userName: string | undefined): CpaTrackerDataState => {
    const { from: rangeFrom, to: rangeTo } = range;
    const rangeKey = `${rangeFrom}|${rangeTo}`;
    const [sales, setSales] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [entries, setEntries] = useState<DailyEntryRow[]>([]);
    const [settings, setSettings] = useState<ProductSettingRow[]>([]);
    const [now, setNow] = useState<Date>(() => new Date());
    const [loading, setLoading] = useState(true);
    // Which range the data belongs to — so a range switch never renders the
    // previous range's rows (filtered to nothing) as a false "empty period".
    const [loadedRange, setLoadedRange] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [missingTables, setMissingTables] = useState(false);
    const reqRef = useRef(0);
    const entriesRef = useRef(entries);
    const settingsRef = useRef(settings);
    // A load must never replace a row with an older server snapshot while one
    // of this page's own writes to it is queued, in flight, or landed after
    // the load's selects went out. Each commit is counted as pending from the
    // moment it's requested until its write settles, and re-stamped with a
    // sequence number when it settles; the merge keeps the local row for every
    // key that is pending or was stamped after the selects were sent.
    const commitSeqRef = useRef(0);
    const touchedRef = useRef<Map<string, number>>(new Map());
    const pendingRef = useRef<Map<string, number>>(new Map());
    const chain = useChain();

    const setEntriesBoth = (rows: DailyEntryRow[]) => { entriesRef.current = rows; setEntries(rows); };
    const setSettingsBoth = (rows: ProductSettingRow[]) => { settingsRef.current = rows; setSettings(rows); };
    const touch = (key: string) => { commitSeqRef.current += 1; touchedRef.current.set(key, commitSeqRef.current); };
    // Wraps a commit: pending from request to settle, stamped again when it settles.
    const tracked = (key: string, run: () => Promise<void>): Promise<void> => {
        pendingRef.current.set(key, (pendingRef.current.get(key) ?? 0) + 1);
        return run().finally(() => {
            const left = (pendingRef.current.get(key) ?? 1) - 1;
            if (left > 0) pendingRef.current.set(key, left); else pendingRef.current.delete(key);
            touch(key);
        });
    };

    const load = useCallback(async () => {
        const id = ++reqRef.current;
        setLoading(true);
        setError(null);
        const bounds: DateRange = { from: rangeFrom, to: rangeTo };
        try {
            const [salesRows, productRows] = await Promise.all([
                fetchInMonthWindows(bounds, (startIso, endIso) => (from, to) =>
                    supabase.from('sales')
                        .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                        .gte('date', startIso).lt('date', endIso)
                        .order('id', { ascending: true }).range(from, to)
                ),
                fetchAllProducts(),
            ]);
            if (id !== reqRef.current) return;

            const seqAtFetch = commitSeqRef.current;
            let entryRows: DailyEntryRow[] = [];
            let settingRows: ProductSettingRow[] = [];
            let missing = false;
            try {
                const [e, s] = await Promise.all([
                    fetchAll((from, to) =>
                        supabase.from(ENTRY_TABLE).select('*')
                            .gte('date', bounds.from).lte('date', bounds.to)
                            .order('date', { ascending: true }).order('page', { ascending: true }).order('product_id', { ascending: true })
                            .range(from, to)
                    ),
                    fetchAll((from, to) =>
                        supabase.from(SETTINGS_TABLE).select('*').order('product_id', { ascending: true }).range(from, to)
                    ),
                ]);
                // An all-empty row is a cleanup that didn't land: no row at all.
                entryRows = e.map(mapEntry).filter(r => !isEmptyEntry(r));
                settingRows = s.map(mapSetting);
            } catch (e) {
                if (!isMissingTableError(e)) throw e;
                missing = true;
            }
            if (id !== reqRef.current) return;

            // Rows this page wrote since the selects went out — or is still
            // writing — keep their current local value.
            const recent = new Set([
                ...Array.from(touchedRef.current).filter(([, seq]) => seq > seqAtFetch).map(([k]) => k),
                ...pendingRef.current.keys(),
            ]);
            if (recent.size > 0) {
                const keyOfEntry = (r: DailyEntryRow) => `entry|${entryKey(r.date, r.page, r.productId)}`;
                entryRows = [...entryRows.filter(r => !recent.has(keyOfEntry(r))), ...entriesRef.current.filter(r => recent.has(keyOfEntry(r)))];
                settingRows = [...settingRows.filter(r => !recent.has(`setting|${r.productId}`)), ...settingsRef.current.filter(r => recent.has(`setting|${r.productId}`))];
            }

            setSales(salesRows.map(mapSaleEntity));
            setProducts(productRows);
            setEntriesBoth(entryRows);
            setSettingsBoth(settingRows);
            setMissingTables(missing);
            setNow(new Date());
            setLoadedRange(rangeKey);
        } catch (e) {
            if (id !== reqRef.current) return;
            console.error('Profit & CPA Tracker: fetch failed', e);
            setError(errMessage(e));
        } finally {
            if (id === reqRef.current) setLoading(false);
        }
    }, [rangeFrom, rangeTo, rangeKey]);

    useEffect(() => { load(); }, [load]);

    const commitEntry = useCallback((date: string, page: string, productId: string, patch: EntryPatch): Promise<void> => {
        const key = `entry|${entryKey(date, page, productId)}`;
        return tracked(key, () => chain(key, async () => {
            const same = (r: DailyEntryRow) => r.date === date && r.page === page && r.productId === productId;
            const existing = entriesRef.current.find(same);
            const next: DailyEntryRow = existing ? { ...existing } : { date, page, productId, adSpend: 0, inboundChats: null, closedOverride: null, deliveredOverride: null };
            const payload: Record<string, unknown> = {};
            for (const [field, raw] of Object.entries(patch) as [EntryField, number | null][]) {
                if (field === 'adSpend') { next.adSpend = raw ?? 0; payload[ENTRY_COLUMN.adSpend] = next.adSpend; }
                else { next[field] = raw === null ? null : Math.round(raw); payload[ENTRY_COLUMN[field]] = next[field]; }
            }
            const empty = isEmptyEntry(next);
            if (!existing && empty) return;   // nothing to store, nothing stored

            // Optimistic. If the write fails, only THIS row's patched fields go
            // back — onto the row as it is NOW (a load may have refreshed its
            // other fields meanwhile).
            setEntriesBoth([...entriesRef.current.filter(r => !same(r)), ...(empty ? [] : [next])]);
            try {
                const { error: upError } = await supabase.from(ENTRY_TABLE).upsert({
                    date, page, product_id: productId, ...payload,
                    updated_at: new Date().toISOString(),
                    updated_by: userName || 'System',
                }, { onConflict: 'date,page,product_id' });
                if (upError) throw upError;
                if (empty) {
                    const { error: delError } = await supabase.from(ENTRY_TABLE).delete()
                        .eq('date', date).eq('page', page).eq('product_id', productId)
                        .or('ad_spend.is.null,ad_spend.eq.0')
                        .is('inbound_chats', null).is('closed_override', null).is('delivered_override', null);
                    if (delError) console.warn('Profit & CPA Tracker: empty-row cleanup failed (harmless)', delError);
                }
            } catch (e) {
                const current = entriesRef.current.find(same);
                const base: DailyEntryRow = current ?? existing ?? { date, page, productId, adSpend: 0, inboundChats: null, closedOverride: null, deliveredOverride: null };
                const restored: DailyEntryRow = { ...base };
                for (const field of Object.keys(patch) as EntryField[]) {
                    if (field === 'adSpend') restored.adSpend = existing?.adSpend ?? 0;
                    else restored[field] = existing ? existing[field] : null;
                }
                setEntriesBoth([...entriesRef.current.filter(r => !same(r)), ...(isEmptyEntry(restored) ? [] : [restored])]);
                throw e;
            }
        }));
    }, [chain, userName]);

    const commitSetting = useCallback((productId: string, field: SettingField, value: number | null): Promise<void> => {
        const key = `setting|${productId}`;
        return tracked(key, () => chain(key, async () => {
            const existing = settingsRef.current.find(s => s.productId === productId);
            const next: ProductSettingRow = existing ? { ...existing } : { productId, courierFee: null, packaging: null, desiredProfit: null, expectedDeliveryRate: null };
            next[field] = value;
            const empty = next.courierFee === null && next.packaging === null && next.desiredProfit === null && next.expectedDeliveryRate === null;
            if (!existing && empty) return;

            setSettingsBoth([...settingsRef.current.filter(s => s.productId !== productId), ...(empty ? [] : [next])]);
            try {
                const { error: upError } = await supabase.from(SETTINGS_TABLE).upsert({
                    product_id: productId,
                    [SETTING_COLUMN[field]]: value,
                    updated_at: new Date().toISOString(),
                    updated_by: userName || 'System',
                }, { onConflict: 'product_id' });
                if (upError) throw upError;
                if (empty) {
                    const { error: delError } = await supabase.from(SETTINGS_TABLE).delete().eq('product_id', productId)
                        .is('courier_fee', null).is('packaging', null).is('desired_profit', null).is('expected_delivery_rate', null);
                    if (delError) console.warn('Profit & CPA Tracker: empty-setting cleanup failed (harmless)', delError);
                }
            } catch (e) {
                const current = settingsRef.current.find(s => s.productId === productId);
                const restored: ProductSettingRow = { ...(current ?? existing ?? next), [field]: existing ? existing[field] : null };
                const restoredEmpty = restored.courierFee === null && restored.packaging === null && restored.desiredProfit === null && restored.expectedDeliveryRate === null;
                setSettingsBoth([...settingsRef.current.filter(s => s.productId !== productId), ...(restoredEmpty ? [] : [restored])]);
                throw e;
            }
        }));
    }, [chain, userName]);

    const hasData = loadedRange === rangeKey;
    return {
        sales: hasData ? sales : [],
        products: hasData ? products : [],
        entries: hasData ? entries : [],
        settings: hasData ? settings : [],
        now,
        loading: loading && !hasData,
        refreshing: loading && hasData,
        ready: hasData,
        error,
        missingTables,
        refresh: load,
        commitEntry,
        commitSetting,
    };
};
