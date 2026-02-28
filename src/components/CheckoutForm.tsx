import React, { useState, useEffect } from 'react';
import { Settings, X, Plus, Calendar } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useMobile } from '../hooks/useMobile';
import ConfigModal from './ConfigModal';
import type { Sale, CartItem } from '../types';
import LazyAvatar from './LazyAvatar';

interface CheckoutFormProps {
    cartItems: CartItem[];
    orderToEdit?: Sale | null;
    onCancel: () => void;
    onSuccess: () => void;
    onUpdateCart: (items: CartItem[]) => void;
}

const CheckoutForm: React.FC<CheckoutFormProps> = ({ cartItems, orderToEdit, onCancel, onSuccess, onUpdateCart }) => {
    const { products, pages, shippingCompanies, paymentMethods, cities, addOnlineOrder, updateOrder, currentUser, users } = useStore();
    const { showToast } = useToast();

    const isMobile = useMobile();

    // Salesman Logic
    // Filter out admins (roleId === 'admin')
    const availableSalesmen = users.filter(u => u.roleId !== 'admin');

    // Determine default salesman based on current user role
    const defaultSalesman = (() => {
        if (!currentUser) return '';
        if (currentUser.roleId === 'salesman') return currentUser.name;
        return '';
    })();

    // Customer Care Logic
    const availableCustomerCare = users.filter(u => u.roleId === 'customer_care');

    // Determine default customer care based on current user role
    const defaultCustomerCare = (() => {
        if (!currentUser) return availableCustomerCare[0]?.name || '';
        if (currentUser.roleId === 'customer_care') return currentUser.name;
        return availableCustomerCare[0]?.name || '';
    })();

    // Config Modal State
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
    const [configType, setConfigType] = useState<'shipping' | 'salesman' | 'page' | 'customerCare' | 'paymentMethod' | 'city'>('shipping');

    const initialFormState: {
        customerName: string;
        customerPhone: string;
        pageName: string;
        shippingCompany: string;
        staffName: string;
        customerCare: string;
        salesman: string;
        remark: string;
        city: string;
        address: string;
        amountReceived: number | string;
        settleDate: string;
        paymentMethod: Sale['paymentMethod'];
        paymentAfterDelivery: boolean;
        discount: number | string;
        enableDiscount: boolean;
        shippingStatus: NonNullable<Sale['shipping']>['status'];
        paymentStatus: 'Unpaid' | 'Paid' | 'Cancel';
        date: string;
    } = {
        customerName: '',
        customerPhone: '',
        pageName: '',
        shippingCompany: '',
        staffName: '',
        customerCare: defaultCustomerCare,
        salesman: defaultSalesman, // Use calculated default
        remark: '',
        city: '',
        address: '',
        amountReceived: 0,
        settleDate: '',
        paymentMethod: 'COD',
        paymentAfterDelivery: true,
        discount: 0,
        enableDiscount: false,
        shippingStatus: 'Ordered',
        paymentStatus: 'Unpaid',
        date: ''
    };

    const [formData, setFormData] = useState(initialFormState);
    const [productSelection, setProductSelection] = useState({ id: '', quantity: 1 });
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (orderToEdit) {
            const city = orderToEdit.customer?.city || '';
            let addressDetails = orderToEdit.customer?.address || '';

            // Try to split address details if it starts with city
            if (city && addressDetails.startsWith(city)) {
                addressDetails = addressDetails.substring(city.length).replace(/^,\s*/, '');
            }

            const isCOD = orderToEdit.paymentMethod === 'COD';

            setFormData({
                customerName: orderToEdit.customer?.name || '',
                customerPhone: orderToEdit.customer?.phone || '',
                pageName: orderToEdit.customer?.page || '',
                shippingCompany: orderToEdit.shipping?.company || '',
                staffName: orderToEdit.shipping?.staffName || '',
                customerCare: orderToEdit.customerCare || defaultCustomerCare,
                salesman: orderToEdit.salesman || '',
                remark: orderToEdit.remark || '',
                city: city, // uses updated local var city
                address: addressDetails,
                amountReceived: orderToEdit.amountReceived || 0,
                settleDate: orderToEdit.settleDate || '',
                paymentMethod: orderToEdit.paymentMethod || 'Cash',
                paymentAfterDelivery: isCOD,
                discount: orderToEdit.discount || 0,
                enableDiscount: (orderToEdit.discount || 0) > 0,
                shippingStatus: orderToEdit.shipping?.status || 'Pending',
                paymentStatus: (orderToEdit.paymentStatus as any) === 'Pending' ? 'Unpaid' : (orderToEdit.paymentStatus as 'Unpaid' | 'Paid' | 'Cancel') || 'Unpaid',
                date: orderToEdit.date || ''
            });
        } else {
            // Reset to defaults when not editing
            setFormData({
                ...initialFormState,
                salesman: defaultSalesman, // Ensure default is applied
                customerCare: defaultCustomerCare // Ensure default is applied
            });
        }
    }, [orderToEdit, currentUser]); // Added currentUser dependency

    // Update payment status when checkbox changes
    useEffect(() => {
        if (formData.paymentAfterDelivery) {
            setFormData(prev => ({
                ...prev,
                amountReceived: 0,
                paymentMethod: 'COD',
                paymentStatus: 'Unpaid'
            }));
        } else {
            if (formData.paymentMethod === 'COD') {
                setFormData(prev => ({ ...prev, paymentMethod: 'Cash', paymentStatus: 'Unpaid' }));
            }
        }
    }, [formData.paymentAfterDelivery]);

    const handleAddItem = () => {
        if (!productSelection.id) return;
        const product = products.find(p => p.id === productSelection.id);
        if (!product) return;

        const newItems = [...cartItems];
        const existingIdx = newItems.findIndex(i => i.id === productSelection.id);

        if (existingIdx >= 0) {
            newItems[existingIdx] = { ...newItems[existingIdx], quantity: newItems[existingIdx].quantity + productSelection.quantity };
        } else {
            newItems.push({ ...product, quantity: productSelection.quantity });
        }

        onUpdateCart(newItems);
        setProductSelection({ id: '', quantity: 1 });
    };

    const handleRemoveItem = (id: string) => {
        const newItems = cartItems.filter(i => i.id !== id);
        onUpdateCart(newItems);
    };

    const handleSubmit = async () => {
        if (isSubmitting) return;

        if (!formData.customerName) {
            showToast('Customer name is required', 'error');
            return;
        }
        if (!formData.customerPhone) {
            showToast('Phone number is required', 'error');
            return;
        }
        if (!formData.city) {
            showToast('City / Province is required', 'error');
            return;
        }
        if (!formData.pageName) {
            showToast('Page Source is required', 'error');
            return;
        }
        if (!formData.salesman) {
            showToast('Salesman is required', 'error');
            return;
        }
        if (!formData.customerCare) {
            showToast('Customer Care is required', 'error');
            return;
        }
        if (!formData.shippingCompany) {
            showToast('Shipping Company is required', 'error');
            return;
        }
        if (cartItems.length === 0) {
            showToast('Add at least one product', 'error');
            return;
        }

        try {
            const discountVal = formData.discount === '' ? 0 : Number(formData.discount);
            const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const discount = formData.enableDiscount ? discountVal : 0;
            const total = Math.max(0, subtotal - discount);

            const amountReceivedVal = formData.amountReceived === '' ? 0 : Number(formData.amountReceived);

            setIsSubmitting(true);

            const orderData = {
                items: cartItems,
                total,
                discount,
                paymentMethod: formData.paymentMethod,
                type: 'Online' as const,
                salesman: formData.salesman,
                customerCare: formData.customerCare,
                remark: formData.remark,
                amountReceived: formData.paymentAfterDelivery ? 0 : amountReceivedVal,
                settleDate: formData.settleDate,
                paymentStatus: formData.paymentStatus,
                customer: {
                    name: formData.customerName,
                    phone: formData.customerPhone,
                    platform: 'Facebook' as const,
                    page: formData.pageName,
                    city: formData.city,
                    address: formData.city ? `${formData.city}, ${formData.address}` : formData.address
                },
                shipping: {
                    company: formData.shippingCompany,
                    trackingNumber: (orderToEdit && orderToEdit.shipping) ? orderToEdit.shipping.trackingNumber : '',
                    status: formData.shippingStatus,
                    cost: 0,
                    staffName: formData.staffName
                }
            };

            if (orderToEdit) {
                await updateOrder(orderToEdit.id, { ...orderData, date: formData.date || orderToEdit.date });
                showToast('Order updated', 'success');
            } else {
                await addOnlineOrder({ ...orderData, date: formData.date || new Date().toISOString() });
                showToast('Order created', 'success');
            }

            onSuccess();
        } catch (error) {
            console.error('Checkout failed:', error);
            showToast('Failed to save order. Please try again.', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div style={{ padding: isMobile ? '12px' : '8px', height: '100%', overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: isMobile ? '12px' : '20px', alignItems: 'center' }}>
                <div>
                    <h2 style={{ fontSize: isMobile ? '18px' : '24px', fontWeight: '700', color: 'var(--color-text-main)' }}>{orderToEdit ? 'Edit Order' : 'Checkout'}</h2>
                    {!isMobile && <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Complete the order information below</p>}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {!isMobile && (
                        <>
                            <button onClick={onCancel} disabled={isSubmitting} style={{ padding: '10px 20px', background: 'white', border: '1px solid var(--color-border)', borderRadius: '10px', cursor: isSubmitting ? 'not-allowed' : 'pointer', color: 'var(--color-text-secondary)', fontWeight: 600, transition: 'all 0.2s', fontSize: '14px', opacity: isSubmitting ? 0.7 : 1 }}>Cancel</button>
                            <button onClick={handleSubmit} disabled={isSubmitting} className="primary-button" style={{ padding: '10px 32px', borderRadius: '10px', fontSize: '15px', boxShadow: '0 4px 10px rgba(239, 68, 68, 0.2)', cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1 }}>
                                {isSubmitting ? 'Saving...' : (orderToEdit ? 'Update Order' : 'Confirm Order')}
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '24px', flex: 1, overflow: 'hidden' }}>
                {/* Left Column: Form Fields */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: isMobile ? '12px' : '20px',
                    overflowY: 'auto',
                    paddingRight: '4px',
                    flex: isMobile ? 1 : 1.4
                }}>
                    <div className="glass-panel" style={{ padding: isMobile ? '16px' : '24px', border: '1px solid var(--color-border)' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '20px', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            Customer Information
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '12px' : '20px', marginBottom: isMobile ? '12px' : '20px' }}>
                            {(currentUser?.roleId === 'admin' || currentUser?.roleId === 'customer_care') && (
                                <div style={{ marginBottom: '0' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-primary)' }}>Order Date</label>
                                        <button
                                            onClick={() => setFormData({ ...formData, date: new Date().toISOString() })}
                                            style={{
                                                fontSize: '11px',
                                                padding: '2px 8px',
                                                background: 'var(--color-primary-light)',
                                                color: 'var(--color-primary)',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontWeight: 600
                                            }}
                                        >
                                            Set Now
                                        </button>
                                    </div>
                                    {isMobile ? (
                                        <div style={{ position: 'relative', width: '100%' }}>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '12px',
                                                background: 'white',
                                                border: '1px solid var(--color-border)',
                                                borderRadius: '10px',
                                                fontSize: '14px',
                                                color: formData.date ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                            }}>
                                                <span style={{ fontWeight: 500 }}>
                                                    {formData.date
                                                        ? new Date(formData.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                                                        : 'Select Date & Time...'}
                                                </span>
                                                <Calendar size={18} color="var(--color-primary)" />
                                            </div>
                                            <input
                                                type="datetime-local"
                                                style={{
                                                    position: 'absolute',
                                                    inset: 0,
                                                    opacity: 0,
                                                    width: '100%',
                                                    height: '100%',
                                                    zIndex: 10
                                                }}
                                                value={formData.date ? new Date(new Date(formData.date).getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16) : ''}
                                                onChange={e => {
                                                    const localDate = new Date(e.target.value);
                                                    const utcDate = new Date(localDate.getTime());
                                                    setFormData({ ...formData, date: utcDate.toISOString() });
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <input
                                            type="datetime-local"
                                            className="search-input"
                                            style={{ width: '100%', padding: '10px 12px', maxWidth: '100%', minWidth: '0' }}
                                            value={formData.date ? new Date(new Date(formData.date).getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16) : ''}
                                            onChange={e => {
                                                const localDate = new Date(e.target.value);
                                                const utcDate = new Date(localDate.getTime());
                                                setFormData({ ...formData, date: utcDate.toISOString() });
                                            }}
                                        />
                                    )}
                                </div>
                            )}
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Customer Name <span style={{ color: '#EF4444' }}>*</span></label>
                                <input className="search-input" style={{ width: '100%', padding: '10px 12px' }} value={formData.customerName} onChange={e => setFormData({ ...formData, customerName: e.target.value })} placeholder="Enter name" />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Phone Number <span style={{ color: '#EF4444' }}>*</span></label>
                                <input className="search-input" style={{ width: '100%', padding: '10px 12px' }} value={formData.customerPhone} onChange={e => setFormData({ ...formData, customerPhone: e.target.value.replace(/\D/g, '') })} placeholder="012..." />
                            </div>
                        </div>
                        <div style={{ marginBottom: isMobile ? '12px' : '20px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.5fr 1fr', gap: isMobile ? '12px' : '20px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>City / Province <span style={{ color: '#EF4444' }}>*</span></label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <select className="search-input" style={{ flex: 1, padding: '10px 12px' }} value={formData.city} onChange={e => setFormData({ ...formData, city: e.target.value })}>
                                            <option value="">Select City...</option>
                                            {cities.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        {!isMobile && (
                                            <button onClick={() => { setConfigType('city'); setIsConfigModalOpen(true); }} style={{ padding: '0 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><Settings size={18} /></button>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Address Details</label>
                                    <input className="search-input" style={{ width: '100%', padding: '10px 12px' }} value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} placeholder="House, Street, etc..." />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Page Source <span style={{ color: '#EF4444' }}>*</span></label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <select className="search-input" style={{ flex: 1, padding: '10px 12px' }} value={formData.pageName} onChange={e => setFormData({ ...formData, pageName: e.target.value })}>
                                            <option value="">Select Page...</option>
                                            {pages.map(p => <option key={p} value={p}>{p}</option>)}
                                        </select>
                                        {!isMobile && (
                                            <button onClick={() => { setConfigType('page'); setIsConfigModalOpen(true); }} style={{ padding: '0 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><Settings size={18} /></button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel" style={{ padding: isMobile ? '16px' : '24px', border: '1px solid var(--color-border)' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '20px', color: 'var(--color-primary)' }}>Order & Payment</h3>

                        {/* Shipping & Staff Details */}
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: isMobile ? '12px' : '20px', marginBottom: isMobile ? '12px' : '20px' }}>

                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Salesman <span style={{ color: '#EF4444' }}>*</span></label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select
                                        className="search-input"
                                        style={{ flex: 1, padding: '10px 12px', background: currentUser?.roleId === 'salesman' ? 'var(--color-bg)' : 'white', opacity: currentUser?.roleId === 'salesman' ? 0.7 : 1 }}
                                        value={formData.salesman}
                                        onChange={e => setFormData({ ...formData, salesman: e.target.value })}
                                        disabled={currentUser?.roleId === 'salesman'}
                                    >
                                        <option value="">Select Salesman...</option>
                                        {availableSalesmen.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                    </select>

                                </div>
                            </div>
                            {/* Customer Care */}
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Customer Care <span style={{ color: '#EF4444' }}>*</span></label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select className="search-input" style={{ flex: 1, padding: '10px 12px' }} value={formData.customerCare} onChange={e => setFormData({ ...formData, customerCare: e.target.value })}>
                                        <option value="">Select Customer Care...</option>
                                        {availableCustomerCare.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Shipping Company <span style={{ color: '#EF4444' }}>*</span></label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select className="search-input" style={{ flex: 1, padding: '10px 12px' }} value={formData.shippingCompany} onChange={e => setFormData({ ...formData, shippingCompany: e.target.value })}>
                                        <option value="">Select Shipping Company...</option>
                                        {shippingCompanies.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    {!isMobile && (
                                        <button onClick={() => { setConfigType('shipping'); setIsConfigModalOpen(true); }} style={{ padding: '0 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><Settings size={18} /></button>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Shipping Status</label>
                                <select
                                    className="search-input"
                                    style={{ width: '100%', padding: '10px 12px', background: currentUser?.roleId === 'salesman' ? 'var(--color-bg)' : 'white', opacity: currentUser?.roleId === 'salesman' ? 0.7 : 1 }}
                                    value={formData.shippingStatus}
                                    onChange={e => setFormData({ ...formData, shippingStatus: e.target.value as any })}
                                    disabled={currentUser?.roleId === 'salesman'}
                                >
                                    {['Ordered', 'Pending', 'Shipped', 'Delivered', 'Returned'].map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Payment Status</label>
                                <select
                                    className="search-input"
                                    style={{ width: '100%', padding: '10px 12px', background: currentUser?.roleId === 'salesman' ? 'var(--color-bg)' : 'white', opacity: currentUser?.roleId === 'salesman' ? 0.7 : 1 }}
                                    value={formData.paymentStatus}
                                    onChange={e => setFormData({ ...formData, paymentStatus: e.target.value as any })}
                                    disabled={currentUser?.roleId === 'salesman'}
                                >
                                    {['Unpaid', 'Paid', 'Cancel'].map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Payment Details */}
                        <div style={{ marginBottom: isMobile ? '12px' : '20px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={formData.paymentAfterDelivery}
                                    onChange={e => setFormData({
                                        ...formData,
                                        paymentAfterDelivery: e.target.checked,
                                        paymentMethod: e.target.checked ? 'COD' : formData.paymentMethod
                                    })}
                                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                />
                                Payment After Delivery (COD)
                            </label>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '12px' : '20px', marginBottom: isMobile ? '12px' : '20px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Payment Method</label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select
                                        className="search-input"
                                        style={{ flex: 1, padding: '10px 12px', background: formData.paymentAfterDelivery ? 'var(--color-bg)' : 'white' }}
                                        value={formData.paymentMethod}
                                        onChange={e => setFormData({ ...formData, paymentMethod: e.target.value as any })}
                                        disabled={formData.paymentAfterDelivery}
                                    >
                                        <option value="">Select Payment Method...</option>
                                        {paymentMethods.map(method => <option key={method} value={method}>{method}</option>)}
                                    </select>
                                    {!isMobile && (
                                        <button onClick={() => { setConfigType('paymentMethod'); setIsConfigModalOpen(true); }} disabled={formData.paymentAfterDelivery} style={{ padding: '0 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: formData.paymentAfterDelivery ? 'not-allowed' : 'pointer', color: 'var(--color-text-secondary)', opacity: formData.paymentAfterDelivery ? 0.5 : 1 }}><Settings size={18} /></button>
                                    )}
                                </div>
                            </div>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Amount Received ($)</label>
                                    <span style={{ fontSize: '11px', color: 'var(--color-primary)', cursor: 'pointer', opacity: formData.paymentAfterDelivery ? 0.5 : 1 }} onClick={() => !formData.paymentAfterDelivery && setFormData({ ...formData, amountReceived: cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0) })}>Set Full</span>
                                </div>
                                <input
                                    type="number"
                                    className="search-input"
                                    style={{ width: '100%', padding: '10px 12px', background: formData.paymentAfterDelivery ? 'var(--color-bg)' : 'white' }}
                                    value={formData.amountReceived}
                                    onChange={e => {
                                        const val = e.target.value;
                                        setFormData({ ...formData, amountReceived: val === '' ? '' : Number(val) });
                                    }}
                                    disabled={formData.paymentAfterDelivery}
                                />
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Remark / Note</label>
                            <input className="search-input" style={{ width: '100%', padding: '10px 12px', fontFamily: 'Battambang' }} value={formData.remark} onChange={e => setFormData({ ...formData, remark: e.target.value })} placeholder="Add any special instructions..." />
                        </div>
                    </div>
                </div>

                {/* Right Column: Order Items */}
                <div className="glass-panel" style={{
                    padding: isMobile ? '16px' : '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    height: isMobile ? 'auto' : '100%',
                    border: '1px solid var(--color-border)',
                    flex: 1,
                    minHeight: isMobile ? '400px' : '0'
                }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '16px', color: 'var(--color-primary)' }}>Order Items</h3>

                    <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                        <select className="search-input" style={{ flex: 1, padding: '10px 12px' }} value={productSelection.id} onChange={e => setProductSelection({ ...productSelection, id: e.target.value })}>
                            <option value="">Quick Add Product...</option>
                            {products.filter(p => p.stock > 0).map(p => <option key={p.id} value={p.id}>{p.name} - ${p.price}</option>)}
                        </select>
                        <input type="number" className="search-input" style={{ width: '70px', padding: '10px' }} value={productSelection.quantity} onChange={e => setProductSelection({ ...productSelection, quantity: Number(e.target.value) })} min={1} />
                        <button onClick={handleAddItem} className="primary-button" style={{ padding: '0 14px', borderRadius: '8px' }}><Plus size={20} /></button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', maxHeight: isMobile ? '300px' : 'none' }}>
                        {cartItems.map((item) => (
                            <div key={item.id} style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px', padding: '8px', borderRadius: '8px', background: 'var(--color-bg)', border: '1px solid transparent' }}>
                                <div style={{ width: '48px', height: '48px', background: 'white', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,0,0,0.05)' }}>
                                    <LazyAvatar productId={item.id} initialImage={item.image} alt="" style={{ width: '100%', height: '100%', borderRadius: '8px' }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)' }}>{item.name}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>${item.price.toFixed(2)} x {item.quantity}</div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <div style={{ fontWeight: '700', fontSize: '14px' }}>${(item.price * item.quantity).toFixed(2)}</div>
                                    <button onClick={() => handleRemoveItem(item.id)} style={{ color: '#EF4444', background: 'rgba(239, 68, 68, 0.1)', border: 'none', cursor: 'pointer', padding: '6px', borderRadius: '6px' }}><X size={14} /></button>
                                </div>
                            </div>
                        ))}
                        {cartItems.length === 0 && (
                            <div style={{ height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', flexDirection: 'column', border: '2px dashed var(--color-border)', borderRadius: '12px' }}>
                                <p style={{ fontSize: '14px' }}>No items in cart</p>
                            </div>
                        )}
                    </div>

                    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
                        {/* Discount Section - Same as before */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)', cursor: 'pointer', marginBottom: '8px' }}>
                                <input
                                    type="checkbox"
                                    checked={formData.enableDiscount}
                                    onChange={e => setFormData({
                                        ...formData,
                                        enableDiscount: e.target.checked,
                                        discount: e.target.checked ? formData.discount : 0
                                    })}
                                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                />
                                Add Discount
                            </label>
                            {formData.enableDiscount && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', width: '80px' }}>Amount ($):</span>
                                    <input
                                        type="number"
                                        className="search-input"
                                        style={{ flex: 1, padding: '8px 12px' }}
                                        value={formData.discount}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setFormData({ ...formData, discount: val === '' ? '' : Number(val) });
                                        }}
                                        placeholder="0.00"
                                        min="0"
                                    />
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                            <span>Subtotal</span>
                            <span>${cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2)}</span>
                        </div>
                        {formData.enableDiscount && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '8px', color: '#EF4444' }}>
                                <span>Discount</span>
                                <span>-${(formData.discount === '' ? 0 : Number(formData.discount)).toFixed(2)}</span>
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '20px', fontWeight: '800', color: 'var(--color-primary)' }}>
                            <span>Total Due</span>
                            <span>${Math.max(0, cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0) - (formData.enableDiscount ? (formData.discount === '' ? 0 : Number(formData.discount)) : 0)).toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            </div >

            {isMobile && (
                <div style={{ paddingTop: '12px', marginTop: 'auto', display: 'flex', gap: '12px', background: 'white', padding: '12px', borderTop: '1px solid var(--color-border)', position: 'sticky', bottom: 0, zIndex: 1000 }}>
                    <button onClick={onCancel} disabled={isSubmitting} style={{ flex: 1, padding: '12px', background: 'white', border: '1px solid var(--color-border)', borderRadius: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', opacity: isSubmitting ? 0.7 : 1 }}>Cancel</button>
                    <button onClick={handleSubmit} disabled={isSubmitting} className="primary-button" style={{ flex: 2, padding: '12px', borderRadius: '12px', fontSize: '16px', fontWeight: 700, boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)', opacity: isSubmitting ? 0.7 : 1 }}>
                        {isSubmitting ? 'Saving...' : (orderToEdit ? 'Update Order' : 'Confirm Order')}
                    </button>
                </div>
            )}

            <ConfigModal
                isOpen={isConfigModalOpen}
                onClose={() => setIsConfigModalOpen(false)}
                type={configType}
            />
        </div >
    );
};

export default CheckoutForm;
