import React, { useState, useEffect } from 'react';
import { Search, Trash2, Banknote, ShoppingCart, User as UserIcon } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import ProductCard from './ProductCard';
import ReceiptModal from './ReceiptModal';
import CheckoutForm from './CheckoutForm';
import type { Sale } from '../types';

interface POSInterfaceProps {
    orderToEdit?: Sale | null;
    onCancelEdit?: () => void;
}

const POSInterface: React.FC<POSInterfaceProps> = ({ orderToEdit, onCancelEdit }) => {
    const { products, addToCart, cart, updateCartQuantity, clearCart, categories, customers, updateCart, pinnedProductIds } = useStore();
    const { showToast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');

    // View Mode: 'grid' or 'checkout'
    const [viewMode, setViewMode] = useState<'grid' | 'checkout'>('grid');

    // Customer Selection (Grid Mode)
    const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
    const [discount, setDiscount] = useState<number>(0);

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

    // Payment Flow State
    const [completedSale, setCompletedSale] = useState<Sale | null>(null);

    const allCategories = ['All', ...categories];

    const filteredProducts = products.filter(p =>
        (selectedCategory === 'All' || p.category === selectedCategory) &&
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
    ).sort((a, b) => {
        const indexA = pinnedProductIds.indexOf(a.id);
        const indexB = pinnedProductIds.indexOf(b.id);

        if (indexA !== -1 && indexB !== -1) {
            return indexA - indexB;
        }

        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;

        return 0;
    });

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const finalTotal = Math.max(0, cartTotal - discount);

    const handleAddToCart = (product: any) => {
        addToCart(product);
        showToast(`Added ${product.name}`, 'success');
    };

    const handleProceedToCheckout = () => {
        if (cart.length === 0) return;
        setViewMode('checkout');
    };

    const handleBackToGrid = () => {
        // If editing, Maybe confirm? For now just go back
        if (orderToEdit && onCancelEdit) {
            onCancelEdit();
        }
        setViewMode('grid');
    }

    const handleSuccess = () => {
        clearCart();
        setViewMode('grid');
        if (onCancelEdit) onCancelEdit();
    };

    return (
        <div style={{ display: 'flex', gap: '24px', height: 'calc(100vh - 100px)' }}>

            {/* Main Content Area: Grid or Checkout Form */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
                {viewMode === 'grid' ? (
                    <>

                        <div style={{ marginBottom: '16px', display: 'flex', gap: '20px', alignItems: 'center', padding: '4px' }}>
                            <div style={{
                                width: '280px',
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
                            <div style={{ width: '1px', height: '32px', background: 'var(--color-border)', margin: '0' }}></div>
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
                                        onMouseEnter={(e) => {
                                            if (selectedCategory !== cat) {
                                                e.currentTarget.style.background = 'var(--color-primary-light)';
                                                e.currentTarget.style.color = 'var(--color-primary)';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (selectedCategory !== cat) {
                                                e.currentTarget.style.background = 'white';
                                                e.currentTarget.style.color = 'var(--color-text-secondary)';
                                            }
                                        }}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)', // Enforce 4 columns
                            gap: '24px',
                            overflowY: 'auto',
                            padding: '12px', // More internal padding for shadow clips
                            paddingBottom: '24px',
                            flex: 1
                        }}>
                            {filteredProducts.map(product => (
                                <ProductCard key={product.id} product={product} onAdd={handleAddToCart} />
                            ))}
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

            {/* Cart Area - Only visible in Grid Mode, or maybe summarized in Checkout Mode? */}
            {/* The CheckoutForm has its own item list. So we hide this sidebar in Checkout Mode */}
            {viewMode === 'grid' && (
                <div className="glass-panel" style={{
                    width: '400px',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    border: '1px solid rgba(255, 255, 255, 0.4)',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', // Deeper shadow
                    borderRadius: '24px',
                    background: 'rgba(255, 255, 255, 0.8)',
                    backdropFilter: 'blur(20px)'
                }}>
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
                                    <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Transaction ID: #{Date.now().toString().slice(-6)}</span>
                                </div>
                            </div>
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
                                <div style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--color-text-muted)' }}>
                                    <svg width="12" height="7" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </div>
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
                                    <p style={{ fontSize: '14px' }}>Scan barcode or select products</p>
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {cart.map(item => (
                                    <div key={item.id} style={{
                                        display: 'flex', gap: '16px', padding: '12px',
                                        background: 'white', borderRadius: '16px',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                                        transition: 'transform 0.2s',
                                        border: '1px solid transparent'
                                    }}
                                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.02)'; }}
                                    >
                                        <div style={{ width: '64px', height: '64px', background: '#F9FAFB', borderRadius: '12px', padding: '4px', flexShrink: 0, border: '1px solid rgba(0,0,0,0.05)' }}>
                                            <img src={item.image} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                            <div style={{ fontWeight: 700, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text-main)' }}>{item.name}</div>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <div style={{ fontSize: '14px', color: 'var(--color-primary)', fontWeight: 700 }}>${item.price.toFixed(2)}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#F3F4F6', borderRadius: '8px', padding: '2px 4px' }}>
                                                    <button onClick={() => updateCartQuantity(item.id, item.quantity - 1)} style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'white', border: '1px solid rgba(0,0,0,0.05)', borderRadius: '6px', color: 'var(--color-text-main)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>-</button>
                                                    <span style={{ fontSize: '13px', minWidth: '20px', textAlign: 'center', fontWeight: 700 }}>{item.quantity}</span>
                                                    <button onClick={() => updateCartQuantity(item.id, item.quantity + 1)} style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'white', border: '1px solid rgba(0,0,0,0.05)', borderRadius: '6px', color: 'var(--color-text-main)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>+</button>
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', fontSize: '15px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                            <span>Discount</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>-$</span>
                                <input
                                    type="number"
                                    value={discount}
                                    onChange={(e) => setDiscount(Number(e.target.value))}
                                    style={{
                                        width: '80px', padding: '6px 10px', borderRadius: '8px', border: '1px solid transparent',
                                        textAlign: 'right', fontSize: '15px', background: 'white', fontWeight: 700, color: 'var(--color-text-main)',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                                    }}
                                    min="0"
                                />
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'flex-end', paddingTop: '20px', borderTop: '2px dashed rgba(0,0,0,0.05)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Payable</span>
                            </div>
                            <span style={{ fontSize: '32px', fontWeight: 900, color: 'var(--color-primary)', lineHeight: 1, letterSpacing: '-0.02em' }}>${finalTotal.toFixed(2)}</span>
                        </div>

                        <div style={{ display: 'flex', gap: '16px' }}>
                            <button
                                onClick={() => clearCart()}
                                disabled={cart.length === 0}
                                style={{
                                    padding: '18px', borderRadius: '16px', border: '1px solid #FEE2E2',
                                    background: '#FEF2F2', color: '#EF4444', cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.2s',
                                    boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.1)'
                                }}
                                onMouseEnter={(e) => !cart.length ? null : (e.currentTarget.style.transform = 'scale(1.05)')}
                                onMouseLeave={(e) => !cart.length ? null : (e.currentTarget.style.transform = 'scale(1)')}
                            >
                                <Trash2 size={24} />
                            </button>
                            <button
                                onClick={handleProceedToCheckout}
                                disabled={cart.length === 0}
                                className="primary-button"
                                style={{
                                    flex: 1,
                                    padding: '18px',
                                    fontSize: '18px',
                                    fontWeight: 700,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
                                    opacity: cart.length === 0 ? 0.6 : 1,
                                    cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
                                    borderRadius: '16px',
                                    boxShadow: '0 10px 20px -5px rgba(59, 130, 246, 0.4)',
                                    background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
                                    transition: 'all 0.3s'
                                }}
                                onMouseEnter={(e) => !cart.length ? null : (e.currentTarget.style.transform = 'translateY(-2px)', e.currentTarget.style.boxShadow = '0 15px 25px -5px rgba(59, 130, 246, 0.5)')}
                                onMouseLeave={(e) => !cart.length ? null : (e.currentTarget.style.transform = 'translateY(0)', e.currentTarget.style.boxShadow = '0 10px 20px -5px rgba(59, 130, 246, 0.4)')}
                            >
                                <Banknote size={24} />
                                Checkout Now
                            </button>
                        </div>
                    </div>
                </div>
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
