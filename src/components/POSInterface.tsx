import React, { useState, useEffect } from 'react';
import { Search, ShoppingCart, Trash2, X, User as UserIcon, Banknote } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import ProductCard from './ProductCard';
import ReceiptModal from './ReceiptModal';
import CheckoutForm from './CheckoutForm';
import type { Sale } from '../types';
import { useMobile } from '../hooks/useMobile';
import LazyAvatar from './LazyAvatar';

interface POSInterfaceProps {
    orderToEdit?: Sale | null;
    onCancelEdit?: () => void;
}

const POSInterface: React.FC<POSInterfaceProps> = ({ orderToEdit, onCancelEdit }) => {
    const { products, addToCart, cart, updateCartQuantity, clearCart, categories, customers, updateCart, pinnedProductIds } = useStore();
    const { showToast } = useToast();
    const isMobile = useMobile();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');

    // View Mode: 'grid' or 'checkout'
    const [viewMode, setViewMode] = useState<'grid' | 'checkout'>('grid');
    const [isCartOpen, setIsCartOpen] = useState(false); // For mobile cart toggle

    // Customer Selection (Grid Mode)
    const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
    const [discount] = useState<number>(0);

    // Initialization for Edit Mode
    useEffect(() => {
        if (orderToEdit) {
            updateCart(orderToEdit.items);
            setViewMode('checkout');
            if (orderToEdit.customer?.id) {
                setSelectedCustomerId(orderToEdit.customer.id);
            }
        }
    }, [orderToEdit]);

    // Lock Header Auto-Hide globally
    useEffect(() => {
        document.body.classList.add('pos-active');
        return () => document.body.classList.remove('pos-active');
    }, []);

    // Payment Flow State
    const [completedSale, setCompletedSale] = useState<Sale | null>(null);

    const allCategories = ['All', ...categories];

    const filteredProducts = products.filter(p => {
        const productName = p.name || '';
        const productModel = p.model || '';
        return (selectedCategory === 'All' || p.category === selectedCategory) &&
            (productName.toLowerCase().includes(searchTerm.toLowerCase()) || productModel.toLowerCase().includes(searchTerm.toLowerCase())) &&
            p.stock > 0;
    }).sort((a, b) => {
        const indexA = pinnedProductIds.indexOf(a.id);
        const indexB = pinnedProductIds.indexOf(b.id);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return 0;
    });

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const finalTotal = Math.max(0, cartTotal - discount);

    const handleAddToCart = (product: any) => {
        addToCart(product);
        showToast(`Added ${product.name} `, 'success');
    };

    const handleProceedToCheckout = () => {
        if (cart.length === 0) return;
        setViewMode('checkout');
        setIsCartOpen(false);
    };

    const handleBackToGrid = () => {
        if (orderToEdit && onCancelEdit) {
            onCancelEdit();
        }
        setViewMode('grid');
    }

    const handleSuccess = () => {
        // window.alert('Debug: POSInterface handleSuccess called');
        clearCart();
        setViewMode('grid');
        setIsCartOpen(false);
        if (onCancelEdit) onCancelEdit();
    };

    return (
        <div style={{ display: 'flex', gap: '24px', height: '100%', flexDirection: isMobile ? 'column' : 'row', position: 'relative' }}>

            {/* Main Content Area: Grid or Checkout Form */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                {viewMode === 'grid' ? (
                    <>
                        <div style={{ marginBottom: '16px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '20px', alignItems: isMobile ? 'stretch' : 'center', padding: '4px' }}>
                            <div style={{
                                width: isMobile ? '100%' : '280px',
                                position: 'relative',
                                flexShrink: 0
                            }}>
                                <Search size={20} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-primary)', opacity: 0.7 }} />
                                <input
                                    type="text"
                                    placeholder="Search products..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="search-input"
                                    style={{
                                        width: '100%',
                                        padding: '12px 14px 12px 42px',
                                        borderRadius: '14px',
                                        fontSize: '15px',
                                        background: 'white',
                                        border: '1px solid transparent',
                                        boxShadow: '0 4px 10px rgba(0,0,0,0.03)'
                                    }}
                                />
                            </div>
                            {!isMobile && <div style={{ width: '1px', height: '32px', background: 'var(--color-border)', margin: '0' }}></div>}
                            <div style={{
                                display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none', msOverflowStyle: 'none',
                                alignItems: 'center', flex: 1
                            }}>
                                {allCategories.map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => setSelectedCategory(cat)}
                                        style={{
                                            padding: '10px 24px',
                                            borderRadius: '20px',
                                            background: selectedCategory === cat ? 'var(--color-primary)' : 'white',
                                            color: selectedCategory === cat ? 'white' : 'var(--color-text-secondary)',
                                            fontWeight: 600,
                                            border: selectedCategory === cat ? 'none' : '1px solid transparent',
                                            cursor: 'pointer',
                                            whiteSpace: 'nowrap',
                                            fontSize: '14px',
                                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                            boxShadow: selectedCategory === cat ? '0 4px 12px rgba(59, 130, 246, 0.4)' : '0 2px 4px rgba(0,0,0,0.02)',
                                            transform: selectedCategory === cat ? 'scale(1.05)' : 'scale(1)'
                                        }}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(140px, 1fr))' : 'repeat(auto-fill, minmax(180px, 1fr))',
                            gap: isMobile ? '12px' : '24px',
                            overflowY: 'auto',
                            padding: '12px',
                            paddingBottom: isMobile ? '80px' : '24px', // Extra padding for mobile cart fab
                            flex: 1
                        }}>
                            {filteredProducts.map(product => {
                                const cartItem = cart.find(item => item.id === product.id);
                                const quantityInCart = cartItem ? cartItem.quantity : 0;
                                return (
                                    <ProductCard
                                        key={product.id}
                                        product={product}
                                        onAdd={handleAddToCart}
                                        cartQuantity={quantityInCart}
                                    />
                                );
                            })}
                        </div>
                    </>
                ) : (
                    <CheckoutForm
                        cartItems={cart}
                        orderToEdit={orderToEdit}
                        onCancel={handleBackToGrid}
                        onSuccess={handleSuccess}
                        onUpdateCart={updateCart}
                    />
                )}
            </div>

            {/* Cart Area */}
            {viewMode === 'grid' && (
                <>
                    {/* Mobile Cart Toggle / FAB */}
                    {isMobile && (
                        <button
                            onClick={() => setIsCartOpen(!isCartOpen)}
                            style={{
                                position: 'fixed',
                                bottom: '24px',
                                right: '24px',
                                width: '60px',
                                height: '60px',
                                borderRadius: '50%',
                                background: 'var(--color-primary)',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 4px 20px rgba(59, 130, 246, 0.5)',
                                zIndex: 1000,
                                border: 'none'
                            }}
                        >
                            <ShoppingCart size={24} />
                            {cart.length > 0 && (
                                <span style={{
                                    position: 'absolute',
                                    top: '-4px',
                                    right: '-4px',
                                    background: '#EF4444',
                                    color: 'white',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: '2px solid white'
                                }}>
                                    {cart.length}
                                </span>
                            )}
                        </button>
                    )}

                    {/* Mobile Cart Overlay - Rendered OUTSIDE the sidebar transformation */}
                    {isMobile && isCartOpen && (
                        <div
                            onClick={() => setIsCartOpen(false)}
                            style={{
                                position: 'fixed',
                                inset: 0,
                                background: 'rgba(0,0,0,0.5)',
                                zIndex: 1001, // Below sidebar (1002), above FAB (1000)
                                backdropFilter: 'blur(2px)'
                            }}
                        />
                    )}

                    {/* Cart Sidebar / Modal */}
                    {(isCartOpen || !isMobile) && (
                        <div className={isMobile ? "" : "glass-panel"} style={{
                            width: isMobile ? '100%' : '400px',
                            height: isMobile ? '85vh' : 'auto', // Mobile: 80% height sheet
                            position: isMobile ? 'fixed' : 'relative',
                            bottom: isMobile ? 0 : 'auto',
                            left: isMobile ? 0 : 'auto',
                            zIndex: isMobile ? 1002 : 1, // Above overlay
                            background: isMobile ? 'white' : 'rgba(255, 255, 255, 0.8)',
                            borderTopLeftRadius: '24px',
                            borderTopRightRadius: '24px',
                            borderRadius: isMobile ? '24px 24px 0 0' : '24px',
                            boxShadow: isMobile ? '0 -10px 40px rgba(0,0,0,0.2)' : '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                            backdropFilter: 'blur(20px)',
                            display: 'flex',
                            flexDirection: 'column',
                            transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)', // Better spring
                            transform: (isMobile && !isCartOpen) ? 'translateY(100%)' : 'translateY(0)',
                            border: isMobile ? 'none' : '1px solid rgba(255, 255, 255, 0.4)'
                        }}>

                            {isMobile && (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: '12px' }} onClick={() => setIsCartOpen(false)}>
                                    <div style={{ width: '40px', height: '4px', background: '#E5E7EB', borderRadius: '2px' }} />
                                </div>
                            )}

                            <div style={{ padding: '24px 28px', borderBottom: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.5)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                        <div style={{
                                            background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
                                            padding: '10px',
                                            borderRadius: '12px',
                                            boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.4)'
                                        }}>
                                            <ShoppingCart size={22} color="white" />
                                        </div>
                                        <div>
                                            <h2 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--color-text-main)', lineHeight: 1.2 }}>Current Order</h2>
                                            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>#{Date.now().toString().slice(-6)}</span>
                                        </div>
                                    </div>
                                    {isMobile && (
                                        <button onClick={() => setIsCartOpen(false)} className="icon-button">
                                            <X size={24} />
                                        </button>
                                    )}
                                </div>

                                {/* Customer Select */}
                                <div>
                                    <div style={{ position: 'relative' }}>
                                        <UserIcon size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-primary)' }} />
                                        <select
                                            value={selectedCustomerId}
                                            onChange={(e) => setSelectedCustomerId(e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '14px 14px 14px 44px',
                                                borderRadius: '14px',
                                                border: '1px solid transparent',
                                                backgroundColor: 'white',
                                                color: 'var(--color-text-main)',
                                                fontSize: '14px',
                                                outline: 'none',
                                                appearance: 'none',
                                                cursor: 'pointer',
                                                fontWeight: 600,
                                                boxShadow: '0 2px 5px rgba(0,0,0,0.02)'
                                            }}
                                        >
                                            <option value="">Guest Customer</option>
                                            {customers.map(c => (
                                                <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
                                {cart.length === 0 ? (
                                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', flexDirection: 'column', gap: '20px', opacity: 0.7 }}>
                                        <div style={{ width: '100px', height: '100px', background: 'rgba(0,0,0,0.03)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Banknote size={48} />
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                            <p style={{ fontWeight: 700, fontSize: '18px', marginBottom: '8px', color: 'var(--color-text-main)' }}>Cart is empty</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {cart.map(item => (
                                            <div key={item.id} style={{
                                                display: 'flex', gap: '16px', padding: '12px',
                                                background: 'white', borderRadius: '16px',
                                                boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                                                border: '1px solid transparent'
                                            }}>
                                                <div style={{ width: '64px', height: '64px', background: '#F9FAFB', borderRadius: '12px', padding: '4px', flexShrink: 0 }}>
                                                    <LazyAvatar productId={item.id} initialImage={item.image} alt={item.name} style={{ width: '100%', height: '100%', borderRadius: '12px' }} />
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                                    <div style={{ fontWeight: 700, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                        <div style={{ fontSize: '14px', color: 'var(--color-primary)', fontWeight: 700 }}>${item.price.toFixed(2)}</div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#F3F4F6', borderRadius: '8px', padding: '2px 4px' }}>
                                                            <button onClick={() => updateCartQuantity(item.id, item.quantity - 1)} style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'white', borderRadius: '6px' }}>-</button>
                                                            <span style={{ fontSize: '13px', minWidth: '20px', textAlign: 'center', fontWeight: 700 }}>{item.quantity}</span>
                                                            <button onClick={() => updateCartQuantity(item.id, item.quantity + 1)} style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'white', borderRadius: '6px' }}>+</button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div style={{ padding: '28px', borderTop: '1px solid rgba(0,0,0,0.05)', backgroundColor: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(10px)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '15px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                                    <span>Subtotal</span>
                                    <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>${cartTotal.toFixed(2)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'flex-end', paddingTop: '20px', borderTop: '2px dashed rgba(0,0,0,0.05)' }}>
                                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-muted)' }}>TOTAL</span>
                                    <span style={{ fontSize: '32px', fontWeight: 900, color: 'var(--color-primary)', lineHeight: 1 }}>${finalTotal.toFixed(2)}</span>
                                </div>

                                <div style={{ display: 'flex', gap: '16px' }}>
                                    <button
                                        onClick={() => clearCart()}
                                        disabled={cart.length === 0}
                                        style={{
                                            padding: '18px', borderRadius: '16px', border: '1px solid #FEE2E2',
                                            background: '#FEF2F2', color: '#EF4444', cursor: cart.length === 0 ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        <Trash2 size={24} />
                                    </button>
                                    <button
                                        onClick={handleProceedToCheckout}
                                        disabled={cart.length === 0}
                                        className="primary-button"
                                        style={{
                                            flex: 1, padding: '18px', fontSize: '18px', fontWeight: 700,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
                                            opacity: cart.length === 0 ? 0.6 : 1, cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
                                            borderRadius: '16px', background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)'
                                        }}
                                    >
                                        <Banknote size={24} />
                                        Checkout
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {completedSale && (
                <ReceiptModal
                    sale={completedSale}
                    onClose={() => setCompletedSale(null)}
                />
            )}
        </div>
    );
};

export default POSInterface;
