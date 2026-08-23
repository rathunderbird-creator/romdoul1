import React, { useState, useEffect, useMemo } from 'react';
import { Search, Tag, Copy, Check, Download, ArrowUp, ArrowDown, ChevronsUpDown, Package } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useHeader } from '../context/HeaderContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useMobile } from '../hooks/useMobile';
import { supabase } from '../lib/supabase';

type SortKey = 'sold' | 'name' | 'model' | 'category' | 'price' | 'stock';

// Window used for the "top sold" ordering.
const SOLD_WINDOW_DAYS = 90;

// Product lines left out of the price list (matched case-insensitively
// against the category and the product name).
const EXCLUDED_TERMS = ['partybox', 'portable'];

const fmt = (n: number) => '$' + (Number(n) || 0).toFixed(2);

const PriceListPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { products } = useStore();
    const { showToast } = useToast();
    const isMobile = useMobile();

    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('All');
    // Top-sold products first by default.
    const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'sold', direction: 'desc' });
    const [copied, setCopied] = useState(false);
    // Quick filters (independent toggles).
    const [onlyTopSold, setOnlyTopSold] = useState(false);
    const [onlyInStock, setOnlyInStock] = useState(false);

    // Units sold per product over the last SOLD_WINDOW_DAYS (order line items).
    const [soldMap, setSoldMap] = useState<Record<string, number>>({});
    useEffect(() => {
        const load = async () => {
            try {
                const since = new Date(Date.now() - SOLD_WINDOW_DAYS * 86400000).toISOString();
                const { data, error } = await supabase
                    .from('sale_items')
                    .select('product_id, quantity, sales!inner(date, shipping_status)')
                    .gte('sales.date', since)
                    .not('sales.shipping_status', 'in', '("Cancelled","Returned","ReStock")');
                if (error) throw error;
                const map: Record<string, number> = {};
                for (const r of (data || []) as any[]) {
                    if (!r.product_id) continue;
                    map[r.product_id] = (map[r.product_id] || 0) + (Number(r.quantity) || 0);
                }
                setSoldMap(map);
            } catch (e) {
                console.error('Failed to load sold counts:', e);
            }
        };
        load();
    }, []);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: isMobile ? '8px' : 0 }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Price List</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Sell prices for all products</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, isMobile]);

    // Active products only (inactive ones are hidden from the sellable list),
    // minus the excluded product lines.
    const activeProducts = useMemo(() => products.filter(p => {
        if (p.isActive === false) return false;
        const hay = `${p.category || ''} ${p.name || ''}`.toLowerCase();
        return !EXCLUDED_TERMS.some(term => hay.includes(term));
    }), [products]);

    const categories = useMemo(() => {
        const set = new Set<string>();
        activeProducts.forEach(p => { if (p.category) set.add(p.category); });
        return ['All', ...Array.from(set).sort()];
    }, [activeProducts]);

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list = activeProducts.filter(p =>
            (category === 'All' || p.category === category) &&
            (!onlyTopSold || (soldMap[p.id] || 0) > 0) &&
            (!onlyInStock || (p.stock ?? 0) > 0) &&
            (!q || (p.name || '').toLowerCase().includes(q) || (p.model || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
        );
        const { key, direction } = sort;
        const val = (p: typeof list[number]) => key === 'sold' ? (soldMap[p.id] || 0) : (p[key] ?? '');
        list = [...list].sort((a, b) => {
            const av = val(a);
            const bv = val(b);
            const cmp = typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv));
            // Ties (e.g. equal sold counts) fall back to name A→Z.
            return (direction === 'asc' ? cmp : -cmp) || a.name.localeCompare(b.name);
        });
        return list;
    }, [activeProducts, search, category, sort, soldMap, onlyTopSold, onlyInStock]);

    const toggleSort = (key: SortKey) => {
        setSort(prev => prev.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
    };

    const SortIcon = ({ k }: { k: SortKey }) => sort.key === k
        ? (sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
        : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />;

    // Plain-text list for chat / Telegram: "Name — $price" per line.
    const copyList = async () => {
        const lines = [
            `📋 Price List${category !== 'All' ? ` — ${category}` : ''}`,
            '',
            ...rows.map(p => `• ${p.name}${p.model ? ` (${p.model})` : ''} — ${fmt(p.price)}`)
        ];
        try {
            await navigator.clipboard.writeText(lines.join('\n'));
            setCopied(true);
            showToast(`Copied ${rows.length} products`, 'success');
            setTimeout(() => setCopied(false), 1500);
        } catch {
            showToast('Copy failed', 'error');
        }
    };

    const exportExcel = () => {
        if (rows.length === 0) return;
        const ws = XLSX.utils.json_to_sheet(rows.map(p => ({
            'Product': p.name, 'Model': p.model || '', 'SKU': p.sku || '', 'Category': p.category || '',
            'Sell Price': Number(p.price) || 0, 'Stock': p.stock ?? 0, [`Sold (${SOLD_WINDOW_DAYS}d)`]: soldMap[p.id] || 0
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Price List');
        XLSX.writeFile(wb, `Price_List_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const thStyle: React.CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--color-bg)', zIndex: 2 };
    const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: '13px', borderBottom: '1px solid var(--color-border)' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Toolbar */}
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: isMobile ? '100%' : '240px' }}>
                        <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input
                            type="text"
                            placeholder="Search product, model, SKU..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ width: '100%', padding: '9px 10px 9px 32px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text-main)' }}
                        />
                    </div>
                    <button
                        onClick={copyList}
                        disabled={rows.length === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #3B82F6, #2563EB)', color: 'white', fontSize: '13px', fontWeight: 600, cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.6 }}
                    >
                        {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy List'}
                    </button>
                    <button
                        onClick={exportExcel}
                        disabled={rows.length === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-main)', fontSize: '13px', fontWeight: 500, cursor: rows.length ? 'pointer' : 'not-allowed' }}
                    >
                        <Download size={15} /> {!isMobile && 'Export'}
                    </button>
                </div>
                {/* Category chips */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {categories.map(c => {
                        const active = category === c;
                        return (
                            <button
                                key={c}
                                onClick={() => setCategory(c)}
                                style={{ padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, background: active ? 'var(--color-primary)' : 'var(--color-surface)', color: active ? 'white' : 'var(--color-text-main)', cursor: 'pointer', transition: 'all 0.15s' }}
                            >
                                {c === 'All' ? `All (${activeProducts.length})` : c}
                            </button>
                        );
                    })}
                    <div style={{ width: '1px', height: '18px', background: 'var(--color-border)', margin: '0 4px' }} />
                    {/* Quick filters */}
                    <button
                        onClick={() => {
                            const next = !onlyTopSold;
                            setOnlyTopSold(next);
                            // Turning it on also orders by sold count, highest first.
                            if (next) setSort({ key: 'sold', direction: 'desc' });
                        }}
                        style={{ padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, border: `1px solid ${onlyTopSold ? '#059669' : 'var(--color-border)'}`, background: onlyTopSold ? '#059669' : 'var(--color-surface)', color: onlyTopSold ? 'white' : 'var(--color-text-main)', cursor: 'pointer', transition: 'all 0.15s' }}
                    >
                        🔥 Top Sold
                    </button>
                    <button
                        onClick={() => setOnlyInStock(v => !v)}
                        style={{ padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, border: `1px solid ${onlyInStock ? '#2563EB' : 'var(--color-border)'}`, background: onlyInStock ? '#2563EB' : 'var(--color-surface)', color: onlyInStock ? 'white' : 'var(--color-text-main)', cursor: 'pointer', transition: 'all 0.15s' }}
                    >
                        In Stock
                    </button>
                    <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{rows.length} products</span>
                </div>
            </div>

            {/* List */}
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
                {rows.length === 0 ? (
                    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                        <Package size={40} style={{ opacity: 0.15, margin: '0 auto 12px', display: 'block' }} />
                        No products found.
                    </div>
                ) : isMobile ? (
                    // Mobile: flat rows — name/model on the left, price on the right
                    <div>
                        {rows.map(p => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderBottom: '1px solid var(--color-border)' }}>
                                {p.image ? (
                                    <img src={p.image} alt="" style={{ width: '38px', height: '38px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0, background: 'var(--color-bg)' }} />
                                ) : (
                                    <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                                        <Tag size={16} />
                                    </div>
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {[p.model, p.category].filter(Boolean).join(' · ')}
                                        {(soldMap[p.id] || 0) > 0 && <span style={{ marginLeft: '6px', color: '#059669', fontWeight: 600 }}>· {soldMap[p.id]} sold</span>}
                                    </div>
                                </div>
                                <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmt(p.price)}</div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 290px)', overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '13px' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...thStyle, width: '56px', cursor: 'default' }}></th>
                                    <th onClick={() => toggleSort('name')} style={thStyle}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>Product <SortIcon k="name" /></span></th>
                                    <th onClick={() => toggleSort('model')} style={thStyle}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>Model <SortIcon k="model" /></span></th>
                                    <th onClick={() => toggleSort('category')} style={thStyle}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>Category <SortIcon k="category" /></span></th>
                                    <th onClick={() => toggleSort('sold')} style={{ ...thStyle, textAlign: 'center', color: '#059669' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>Sold ({SOLD_WINDOW_DAYS}d) <SortIcon k="sold" /></span></th>
                                    <th onClick={() => toggleSort('stock')} style={{ ...thStyle, textAlign: 'center' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>Stock <SortIcon k="stock" /></span></th>
                                    <th onClick={() => toggleSort('price')} style={{ ...thStyle, textAlign: 'right' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>Sell Price <SortIcon k="price" /></span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((p, idx) => (
                                    <tr key={p.id} className="hover-highlight" style={{ background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : undefined }}>
                                        <td style={{ ...tdStyle, padding: '6px 12px' }}>
                                            {p.image ? (
                                                <img src={p.image} alt="" style={{ width: '34px', height: '34px', borderRadius: '8px', objectFit: 'cover', background: 'var(--color-bg)', display: 'block' }} />
                                            ) : (
                                                <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                                                    <Tag size={15} />
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--color-text-main)' }}>{p.name}</td>
                                        <td style={{ ...tdStyle, color: 'var(--color-text-secondary)', fontFamily: 'monospace', fontSize: '12px' }}>{p.model || '—'}</td>
                                        <td style={tdStyle}>
                                            {p.category ? (
                                                <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{p.category}</span>
                                            ) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                                            {(soldMap[p.id] || 0) > 0
                                                ? <span style={{ display: 'inline-block', minWidth: '34px', padding: '2px 9px', borderRadius: '12px', fontSize: '12px', fontWeight: 700, background: 'rgba(16,185,129,0.1)', color: '#059669' }}>{soldMap[p.id]}</span>
                                                : <span style={{ color: 'var(--color-text-muted)' }}>0</span>}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center', color: (p.stock ?? 0) > 0 ? 'var(--color-text-secondary)' : '#DC2626', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{p.stock ?? 0}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, fontSize: '14px', color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}>{fmt(p.price)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PriceListPage;
