import React from 'react';
import { Edit2, Trash2, AlertTriangle, ChevronDown } from 'lucide-react';
import type { Product } from '../types';
import './MobileInventoryCard.css';
import LazyAvatar from './LazyAvatar';

interface MobileInventoryCardProps {
    product: Product;
    isSelected: boolean;
    onToggleSelect: () => void;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onEdit: (product: Product) => void;
    onDelete: (id: string) => void;
}

const MobileInventoryCard: React.FC<MobileInventoryCardProps> = ({
    product,
    isSelected,
    onToggleSelect: _onToggleSelect,
    isExpanded,
    onToggleExpand,
    onEdit,
    onDelete
}) => {
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
                        <span style={{ color: isLowStock ? '#EF4444' : 'inherit', fontWeight: 500 }}>{product.stock} in Stock</span>
                        <span>•</span>
                        <span>Val: ${(product.stock * product.price).toLocaleString()}</span>
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
                            <span className="mic-stat-label">Stock Level</span>
                            <span className="mic-stat-value" style={{ color: isLowStock ? '#EF4444' : 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {isLowStock && <AlertTriangle size={12} />}
                                {product.stock} Units
                            </span>
                        </div>
                        <div className="mic-stat-item">
                            <span className="mic-stat-label">Total Value</span>
                            <span className="mic-stat-value">${(product.stock * product.price).toLocaleString()}</span>
                        </div>
                        <div className="mic-stat-item">
                            <span className="mic-stat-label">Category</span>
                            <span className="mic-stat-value">{product.category}</span>
                        </div>
                        <div className="mic-stat-item">
                            <span className="mic-stat-label">Model</span>
                            <span className="mic-stat-value">{product.model}</span>
                        </div>
                    </div>

                    {/* Actions Bar */}
                    <div className="mic-actions">
                        <button
                            className="mic-action-btn delete"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(product.id);
                            }}
                        >
                            <Trash2 size={18} />
                        </button>
                        <button
                            className="mic-action-btn primary"
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit(product);
                            }}
                        >
                            <Edit2 size={18} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MobileInventoryCard;
