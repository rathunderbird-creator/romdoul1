import React from 'react';
import { Package } from 'lucide-react';
import Modal from './Modal';
import type { Product } from '../types';

export type StockStatus = 'Out of Stock' | 'Low Stock' | 'In Stock';

const STATUS_COLORS: Record<StockStatus, { background: string; color: string }> = {
    'Out of Stock': { background: '#FEE2E2', color: '#EF4444' },
    'Low Stock': { background: '#FEF3C7', color: '#F59E0B' },
    'In Stock': { background: '#D1FAE5', color: '#10B981' },
};

const money = (n: number): string =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>{label}</div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)', overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
);

const ProductDetailsModal: React.FC<{
    product: Product | null;
    stockStatus: StockStatus;
    onClose: () => void;
    /** Cost and stock value are hidden from roles without financial access. */
    canViewFinancials: boolean;
}> = ({ product, stockStatus, onClose, canViewFinancials }) => {
    if (!product) return null;

    return (
        <Modal isOpen onClose={onClose} title="Product Details" width="560px">
            <div style={{ width: '100%', height: product.image ? '300px' : '120px', flexShrink: 0, borderRadius: '12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: '16px' }}>
                {product.image
                    ? <img src={product.image} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                    : <Package size={40} color="var(--color-text-muted)" />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '20px' }}>
                <div style={{ minWidth: 0, fontSize: '18px', fontWeight: 700, color: 'var(--color-text-main)', overflowWrap: 'anywhere' }}>{product.name}</div>
                <span style={{ flexShrink: 0, padding: '4px 12px', borderRadius: '16px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', whiteSpace: 'nowrap', ...STATUS_COLORS[stockStatus] }}>
                    {stockStatus}
                </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '18px 16px' }}>
                <Field label="SKU" value={product.sku || '—'} />
                <Field label="Model" value={product.model || '—'} />
                <Field label="Category" value={product.category || '—'} />
                <Field label="Supplier" value={product.supplier || '—'} />
                <Field label="Invoice Number" value={product.invoiceNumber || '—'} />
                <Field label="Sell Price" value={money(product.price)} />
                {canViewFinancials && <Field label="Cost" value={money(product.purchaseCost || 0)} />}
                <Field label="Stock" value={`${product.stock.toLocaleString('en-US')} pcs`} />
                <Field label="Low Stock Threshold" value={`${(product.lowStockThreshold || 5).toLocaleString('en-US')} pcs`} />
                {canViewFinancials && <Field label="Total Value" value={money(product.price * product.stock)} />}
                <Field label="Date Added" value={product.createdAt ? new Date(product.createdAt).toLocaleDateString('en-GB') : '—'} />
            </div>
        </Modal>
    );
};

export default ProductDetailsModal;
