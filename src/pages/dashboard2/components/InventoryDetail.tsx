// Dashboard2 — Inventory detail (spec §4.7). Reference data that sits at the
// bottom of the page: collapsed by default (remembered per user) and never
// tier 1, except the low-stock tile while there is something to act on.
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Package } from 'lucide-react';
import type { InventoryDetailProps } from '../types';
import { D2, cardStyle, tabular, fmtInt } from '../theme';
import { Card, SectionHeader, ErrorInline, useLocalStorageState } from '../ui';

const STORAGE_KEY = 'd2_inventory_collapsed';
const BODY_ID = 'd2-inventory-body';

// Every tile (and the error block that can replace two of them) keeps the
// same minimum height so the grid never shifts between states (spec §8).
const TILE_MIN_HEIGHT = 78;

// Label sits above the number; a fixed two-line min-height means a wrapping
// label (narrow columns, Khmer locale) never pushes its number out of line
// with the neighbouring tiles.
const labelStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-end',
    minHeight: 32,
    marginBottom: 4,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.45,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: D2.muted,
};

const valueStyle: CSSProperties = {
    ...tabular,
    display: 'block',
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1.2,
    color: D2.ink,
};

// Text-link button in the section header ("Open inventory →").
const linkButtonStyle: CSSProperties = {
    background: 'none',
    border: 'none',
    padding: '4px 6px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    color: D2.blue,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
};

// ─── Metric tile ──────────────────────────────────────────────────────────

interface TileProps {
    label: string;
    value: string;
    // Tier-1 treatment (tinted bg + left accent) — only the low-stock tile
    // while it has something to report.
    accent?: { bg: string; line: string };
    valueColor?: string;
    // Tier 3: muted, smaller, opacity .42 (applied by Card).
    passive?: boolean;
    onClick: () => void;
    ariaLabel: string;
}

// Tier 2 by default. Always rendered as a button (Card onClick): every number
// on the page is a link (spec §6). Children are spans so the markup inside
// the <button> stays phrasing content.
const Tile = ({ label, value, accent, valueColor, passive, onClick, ariaLabel }: TileProps) => (
    <Card
        onClick={onClick}
        ariaLabel={ariaLabel}
        title={ariaLabel}
        accent={accent}
        passive={passive}
        style={{ padding: '12px 14px', minHeight: TILE_MIN_HEIGHT }}
    >
        <span style={labelStyle}>{label}</span>
        <span style={{ ...valueStyle, ...(passive ? { fontSize: 18, color: D2.muted } : {}), ...(valueColor ? { color: valueColor } : {}) }}>
            {value}
        </span>
    </Card>
);

// ─── Section ──────────────────────────────────────────────────────────────

const InventoryDetail = ({ products, lowStockCount, stockIn, stockOut, error, onOpenInventory, t }: InventoryDetailProps) => {
    const [collapsed, setCollapsed] = useLocalStorageState<boolean>(STORAGE_KEY, true);

    // Units on hand across the active catalogue. Inactive products are hidden
    // from the inventory page, so they don't count here either.
    const unitsInStock = useMemo(
        () => products.reduce((sum, p) => (p.isActive === false ? sum : sum + (Number(p.stock) || 0)), 0),
        [products],
    );

    const title = t('dashboard2.inventory');
    const openLabel = t('dashboard2.openInventory');
    // "Products in stock: 1,234 — Open inventory" (aria-label + tooltip).
    const describe = (label: string, value: string) => `${label}: ${value} — ${openLabel}`;

    const inStockLabel = t('dashboard2.productsInStock');
    const lowStockLabel = t('dashboard2.lowStockAlerts');
    const stockInLabel = t('dashboard2.stockIn');
    const stockOutLabel = t('dashboard2.stockOut');

    const hasLowStock = lowStockCount > 0;

    return (
        <section aria-label={title} style={{ marginBottom: 14 }}>
            {/* When collapsed the header's own 10px bottom margin doubles as the
                card's bottom padding, so the card stays compact. */}
            <div style={{ ...cardStyle, padding: collapsed ? '10px 16px 0' : '12px 16px 14px' }}>
                <SectionHeader
                    title={title}
                    icon={Package}
                    collapsed={collapsed}
                    onToggle={() => setCollapsed(c => !c)}
                    id={BODY_ID}
                    extra={(
                        <button type="button" onClick={onOpenInventory} title={openLabel} aria-label={openLabel} style={linkButtonStyle}>
                            {openLabel} <span aria-hidden>→</span>
                        </button>
                    )}
                />

                {!collapsed && (
                    <div id={BODY_ID} className="d2-inventory-grid">
                        {/* Tiles 1–2 come from the catalogue, so they render even
                            when the stock-movements fetch failed. */}
                        <Tile
                            label={inStockLabel}
                            value={fmtInt(unitsInStock)}
                            passive={unitsInStock === 0}
                            onClick={onOpenInventory}
                            ariaLabel={describe(inStockLabel, fmtInt(unitsInStock))}
                        />
                        <Tile
                            label={lowStockLabel}
                            value={fmtInt(lowStockCount)}
                            accent={hasLowStock ? { bg: D2.redBg, line: D2.redLine } : undefined}
                            valueColor={hasLowStock ? D2.red : undefined}
                            passive={!hasLowStock}
                            onClick={onOpenInventory}
                            ariaLabel={describe(lowStockLabel, fmtInt(lowStockCount))}
                        />

                        {error ? (
                            // Replaces tiles 3–4; the grid wrapper stretches the
                            // alert to the tile height so nothing jumps on retry.
                            <div style={{ gridColumn: 'span 2', display: 'grid', minHeight: TILE_MIN_HEIGHT }}>
                                <ErrorInline
                                    message={`${t('dashboard2.inventoryError')} ${error.message}`}
                                    onRetry={error.retry}
                                    retryLabel={t('dashboard2.retry')}
                                />
                            </div>
                        ) : (
                            <>
                                <Tile
                                    label={stockInLabel}
                                    value={fmtInt(stockIn)}
                                    passive={stockIn === 0}
                                    onClick={onOpenInventory}
                                    ariaLabel={describe(stockInLabel, fmtInt(stockIn))}
                                />
                                <Tile
                                    label={stockOutLabel}
                                    value={fmtInt(stockOut)}
                                    passive={stockOut === 0}
                                    onClick={onOpenInventory}
                                    ariaLabel={describe(stockOutLabel, fmtInt(stockOut))}
                                />
                            </>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
};

export default InventoryDetail;
