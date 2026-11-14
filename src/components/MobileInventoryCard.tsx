import React from 'react';
import { Edit2, Trash2, AlertTriangle, ChevronDown, Truck, Eye } from 'lucide-react';
import type { Product } from '../types';
import './MobileInventoryCard.css';
import LazyAvatar from './LazyAvatar';
import { useOptionalLanguage } from '../context/LanguageContext';

interface MobileInventoryCardProps {
    product: Product;
    isSelected: boolean;
    onToggleSelect: () => void;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onEdit: (product: Product) => void;
    onDelete: (id: string) => void;
    onWholesale?: (product: Product) => void;
    onView?: (product: Product) => void;
    /** Hides the edit/delete/wholesale actions for view-only roles. */
    canManage?: boolean;
    /** Shows Last cost and FIFO avg, same as the table's cost column. */
    showCosts?: boolean;
    /** FIFO average of the layers on hand; null = no layers, undefined = FIFO not available. */
    fifoAvgCost?: number | null;
}

const MobileInventoryCard: React.FC<MobileInventoryCardProps> = ({
    product,
    isSelected,
    onToggleSelect: _onToggleSelect,
    isExpanded,
    onToggleExpand,
    onEdit,
    onDelete,
    onWholesale,
    onView,
    canManage = true,
    showCosts = false,
    fifoAvgCost
}) => {
    const lang = useOptionalLanguage();
    const tx = (k: string, en: string) => { const v = lang?.t(k); return v && v !== k ? v : en; };
    const isLowStock = product.stock < (product.lowStockThreshold || 5);

    let cardClass = 'mobile-inventory-card';
    if (isSelected) cardClass += ' selected';
    else if (isLowStock) cardClass += ' low-stock';

    return (
        <div className={cardClass}>
            {/* Header Row */}
            <div
                className="mic-header"
                onClick={onToggleExpand}
            >
                {/* Chevron */}
                <div
                    className="mic-chevron"
                    onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
                    style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                    <ChevronDown size={20} />
                </div>

                {/* Thumb & Info */}
                <LazyAvatar productId={product.id} initialImage={product.image} alt={product.name} className="mic-image" />

                <div className="mic-info">
                    <div className="mic-name">{product.name}</div>
                    <div className="mic-meta-row">
                        <span style={{ fontWeight: 500 }}>${product.price}</span>
                        <span>•</span>
                        <span>{product.model}</span>
                    </div>
                    <div className="mic-meta-row" style={{ marginTop: '2px' }}>
                        <span style={{ color: isLowStock ? '#EF4444' : 'inherit', fontWeight: 500 }}>{tx('ui.inventory.card.nInStock', '{n} in Stock').replace('{n}', String(product.stock))}</span>
                        <span>•</span>
                        <span>{tx('ui.inventory.card.val', 'Val:')} ${(product.stock * product.price).toLocaleString()}</span>
                    </div>
                </div>

                {/* Stock Dot */}
                <div
                    className={`mic-status-dot ${isLowStock ? 'low' : 'ok'}`}
                />
            </div>

            {/* Expanded Content */}
            {isExpanded && (
                <div className="mic-expanded">
                    {/* Stats Grid */}
                    <div className="mic-stats-container">
                        <div className="mic-stat-item">
                            <span className="mic-stat-label">{tx('ui.inventory.card.stockLevel', 'Stock Level')}</span>
                            <span className="mic-stat-value" style={{ color: isLowStock ? '#EF4444' : 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {isLowStock && <AlertTriangle size={12} />}
                                {tx('ui.inventory.card.nUnits', '{n} Units').replace('{n}', String(product.stock))}
                            </span>
                        </div>
                        <div className="mic-stat-item">
                            <span className="mic-stat-label">{tx('ui.inventory.stats.totalValue', 'Total Value')}</span>
                            <span className="mic-stat-value">${(product.stock * product.price).toLocaleString()}</span>
                        </div>
                        {showCosts && (
                            <div className="mic-stat-item">
                                <span className="mic-stat-label">{tx('ui.inventory.card.lastCost', 'Last Cost')}</span>
                                <span className="mic-stat-value">${(product.purchaseCost || 0).toFixed(2)}</span>
                            </div>
                        )}
                        {showCosts && fifoAvgCost !== undefined && (
                            <div className="mic-stat-item">
                                <span className="mic-stat-label">FIFO Avg</span>
                                <span className="mic-stat-value">{fifoAvgCost === null ? '—' : `$${fifoAvgCost.toFixed(2)}`}</span>
                            </div>
                        )}
                        <div className="mic-stat-item">
                            <span className="mic-stat-label">{tx('inventory.category', 'Category')}</span>
                            <span className="mic-stat-value">{product.category}</span>
                        </div>
                        <div className="mic-stat-item">
                            <span className="mic-stat-label">{tx('inventory.model', 'Model')}</span>
                            <span className="mic-stat-value">{product.model || '—'}</span>
                        </div>
                        <div className="mic-stat-item">
                            <span className="mic-stat-label">{tx('ui.inventory.invoiceNumber', 'Invoice Number')}</span>
                            <span className="mic-stat-value">{product.invoiceNumber || '—'}</span>
                        </div>
                        <div className="mic-stat-item">
                            <span className="mic-stat-label">{tx('ui.inventory.col.supplier', 'Supplier')}</span>
                            <span className="mic-stat-value">{product.supplier || '—'}</span>
                        </div>
                    </div>

                    {/* Actions Bar — view-only roles get just the View button */}
                    {(canManage || onView) && (
                    <div className="mic-actions">
                        {canManage && (
                            <button
                                className="mic-action-btn delete"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(product.id);
                                }}
                            >
                                <Trash2 size={18} />
                            </button>
                        )}
                        {canManage && onWholesale && (
                            <button
                                className="mic-action-btn primary"
                                style={{ backgroundColor: '#3B82F6', borderColor: '#3B82F6' }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onWholesale(product);
                                }}
                            >
                                <Truck size={18} />
                            </button>
                        )}
                        {onView && (
                            <button
                                className="mic-action-btn"
                                title={tx('ui.inventory.viewDetails', 'View Details')}
                                aria-label={tx('ui.inventory.viewDetailsOf', 'View details of {name}').replace('{name}', product.name)}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onView(product);
                                }}
                            >
                                <Eye size={18} />
                            </button>
                        )}
                        {canManage && (
                            <button
                                className="mic-action-btn primary"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEdit(product);
                                }}
                            >
                                <Edit2 size={18} />
                            </button>
                        )}
                    </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default MobileInventoryCard;
