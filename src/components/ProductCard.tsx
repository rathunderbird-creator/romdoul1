import React from 'react';
import { Plus, Pin } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useMobile } from '../hooks/useMobile';
import type { Product } from '../types';

interface ProductCardProps {
    product: Product;
    onAdd: (product: Product) => void;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, onAdd }) => {
    const { pinnedProductIds, toggleProductPin } = useStore();
    const isMobile = useMobile();
    const isPinned = pinnedProductIds.includes(product.id);
    const isOutOfStock = product.stock === 0;
    const isLowStock = product.stock > 0 && product.stock <= 5;

    return (
        <div className="glass-panel" style={{
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            height: '100%', // Fill grid height
            width: '100%',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            cursor: isOutOfStock ? 'not-allowed' : 'pointer',
            opacity: isOutOfStock ? 0.7 : 1,
            position: 'relative',
            border: isLowStock ? '1px solid #F59E0B' : (isPinned ? '1px solid var(--color-primary)' : '1px solid rgba(255, 255, 255, 0.4)'),
            boxShadow: isPinned ? '0 4px 12px rgba(59, 130, 246, 0.15)' : '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
            background: 'rgba(255, 255, 255, 0.7)'
        }}
            onMouseEnter={(e) => !isOutOfStock && !isMobile && (
                e.currentTarget.style.transform = 'translateY(-6px)',
                e.currentTarget.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                e.currentTarget.style.borderColor = 'var(--color-primary)'
            )}
            onMouseLeave={(e) => !isOutOfStock && !isMobile && (
                e.currentTarget.style.transform = 'translateY(0)',
                e.currentTarget.style.boxShadow = isPinned ? '0 4px 12px rgba(59, 130, 246, 0.15)' : '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
                e.currentTarget.style.borderColor = isLowStock ? '#F59E0B' : (isPinned ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.4)')
            )}
            onClick={() => !isOutOfStock && onAdd(product)}
        >
            {/* Pin Button */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    toggleProductPin(product.id);
                }}
                style={{
                    position: 'absolute',
                    top: isMobile ? '6px' : '10px',
                    left: isMobile ? '6px' : '10px',
                    zIndex: 20,
                    padding: isMobile ? '4px' : '6px',
                    borderRadius: '50%',
                    background: isPinned ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.8)',
                    color: isPinned ? 'white' : 'var(--color-text-secondary)',
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s'
                }}
                title={isPinned ? 'Unpin Product' : 'Pin Product'}
            >
                <Pin size={isMobile ? 12 : 14} fill={isPinned ? 'currentColor' : 'none'} />
            </button>

            {isLowStock && (
                <div style={{
                    position: 'absolute', top: isMobile ? '6px' : '10px', right: isMobile ? '6px' : '10px',
                    background: 'rgba(245, 158, 11, 0.95)', color: 'white', fontSize: isMobile ? '9px' : '10px', fontWeight: '700',
                    padding: '2px 6px', borderRadius: '12px', zIndex: 10, backdropFilter: 'blur(4px)',
                    boxShadow: '0 2px 8px rgba(245, 158, 11, 0.4)'
                }}>
                    Low Stock
                </div>
            )}

            <div style={{
                height: isMobile ? '120px' : '200px', // Fixed height on desktop too for consistency
                flexShrink: 0,
                background: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6px',
                position: 'relative',
                borderBottom: '1px solid rgba(0,0,0,0.03)'
            }}>
                <img
                    src={product.image}
                    alt={product.name}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)' }}
                />
            </div>

            <div style={{ padding: isMobile ? '8px' : '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                    <div style={{
                        fontSize: '9px',
                        color: 'var(--color-primary)',
                        marginBottom: '2px',
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        background: 'var(--color-primary-light)',
                        alignSelf: 'flex-start',
                        display: 'inline-block',
                        padding: '2px 6px',
                        borderRadius: '4px'
                    }}>
                        {product.category}
                    </div>
                    <h3 style={{
                        fontSize: isMobile ? '12px' : '13px',
                        fontWeight: '600',
                        marginBottom: '0',
                        lineHeight: '1.25',
                        color: 'var(--color-text-main)',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                    }}>
                        {product.name}
                        {isPinned && <span style={{ marginLeft: '6px', color: 'var(--color-primary)', fontSize: '12px' }}>📌</span>}
                    </h3>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                    <div style={{ fontSize: isMobile ? '14px' : '16px', fontWeight: '800', color: 'var(--color-text-main)', display: 'flex', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '11px', marginRight: '1px', fontWeight: '600', color: 'var(--color-text-secondary)' }}>$</span>{product.price}
                    </div>

                    {isOutOfStock ? (
                        <span style={{ fontSize: '10px', color: '#EF4444', fontWeight: 'bold', background: '#FEE2E2', padding: '4px 6px', borderRadius: '4px' }}>Sold Out</span>
                    ) : (
                        <button
                            style={{
                                width: isMobile ? '28px' : '32px',
                                height: isMobile ? '28px' : '32px',
                                borderRadius: '8px',
                                background: 'var(--color-primary)',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: 'none',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                boxShadow: '0 4px 10px rgba(59, 130, 246, 0.3)'
                            }}
                            onMouseEnter={() => !isMobile && {
                                transform: 'scale(1.1) rotate(5deg)',
                                background: 'var(--color-primary-hover)'
                            }}
                            onMouseLeave={() => !isMobile && {
                                transform: 'scale(1) rotate(0deg)',
                                background: 'var(--color-primary)'
                            }}
                        >
                            <Plus size={isMobile ? 16 : 18} strokeWidth={3} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProductCard;
