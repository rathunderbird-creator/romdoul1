import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, X, Plus, Calendar, MapPin, User, Phone, AlertTriangle } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useMobile } from '../hooks/useMobile';
import ConfigModal from './ConfigModal';
import type { Sale, CartItem } from '../types';
import LazyAvatar from './LazyAvatar';
import ShippingPointSelector from './ShippingPointSelector';

import { sendTelegramOrderNotification } from '../utils/telegram';

interface LocationInfo {
    code: string;
    khmer: string;
    latin: string;
}
interface Commune extends LocationInfo {
    villages?: LocationInfo[];
}
interface District extends LocationInfo {
    communes?: Commune[];
}
interface Province extends LocationInfo {
    districts?: District[];
}

interface CheckoutFormProps {
    cartItems: CartItem[];
    orderToEdit?: Sale | null;
    onCancel: () => void;
    onSuccess: () => void;
    onUpdateCart: (items: CartItem[]) => void;
}

export const PROVINCE_TRANSLATIONS: Record<string, string> = {
    "ភ្នំពេញ": "Phnom Penh",
    "បន្ទាយមានជ័យ": "Banteay Meanchey",
    "បាត់ដំបង": "Battambang",
    "កំពង់ចាម": "Kampong Cham",
    "កំពង់ឆ្នាំង": "Kampong Chhnang",
    "កំពង់ស្ពឺ": "Kampong Speu",
    "កំពង់ធំ": "Kampong Thom",
    "កំពត": "Kampot",
    "កណ្តាល": "Kandal",
    "កែប": "Kep",
    "កោះកុង": "Koh Kong",
    "ក្រចេះ": "Kratie",
    "មណ្ឌលគិរី": "Mondulkiri",
    "ឧត្តរមានជ័យ": "Oddar Meanchey",
    "ប៉ៃលិន": "Pailin",
    "ព្រះសីហនុ": "Preah Sihanouk",
    "ព្រះវិហារ": "Preah Vihear",
    "ព្រៃវែង": "Prey Veng",
    "ពោធិ៍សាត់": "Pursat",
    "រតនគិរី": "Ratanakiri",
    "សៀមរាប": "Siem Reap",
    "ស្ទឹងត្រែង": "Stung Treng",
    "ស្វាយរៀង": "Svay Rieng",
    "តាកែវ": "Takeo",
    "ត្បូងឃ្មុំ": "Tboung Khmum"
};

const CheckoutForm: React.FC<CheckoutFormProps> = ({ cartItems, orderToEdit, onCancel, onSuccess, onUpdateCart }) => {
    const { products, pages, shippingCompanies, paymentMethods, cities, addOnlineOrder, updateOrder, currentUser, users, telegramBotToken, telegramChatId, telegramConfigs, sales, khrExchangeRate, blockedCustomers } = useStore();
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
        if (!currentUser) return '';
        if (currentUser.roleId === 'customer_care') return currentUser.name;
        return '';
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
        district: string;
        commune: string;
        village: string;
        address: string;
        amountReceived: number | string;
        settleDate: string;
        paymentMethod: Sale['paymentMethod'];
        paymentAfterDelivery: boolean;
        discount: number | string;
        enableDiscount: boolean;
        shippingStatus: NonNullable<Sale['shipping']>['status'];
        paymentStatus: 'Unpaid' | 'Paid' | 'Get File' | 'Cancel';
        date: string;
    } = {
        customerName: orderToEdit?.customer?.name || '',
        customerPhone: orderToEdit?.customer?.phone || '',
        pageName: orderToEdit?.customer?.page || '',
        shippingCompany: orderToEdit?.shipping?.company || '',
        staffName: orderToEdit?.shipping?.staffName || '',
        customerCare: orderToEdit?.customerCare || defaultCustomerCare,
        salesman: orderToEdit?.salesman || defaultSalesman,
        remark: orderToEdit?.remark || '',
        city: orderToEdit?.customer?.city || '',
        district: orderToEdit?.customer?.district || '',
        commune: orderToEdit?.customer?.commune || '',
        village: orderToEdit?.customer?.village || '',
        address: orderToEdit?.customer?.address || '',
        amountReceived: orderToEdit?.amountReceived || '',
        settleDate: orderToEdit?.settleDate || '',
        paymentMethod: orderToEdit?.paymentMethod || ('' as any),
        paymentAfterDelivery: orderToEdit?.paymentStatus === 'Unpaid',
        discount: orderToEdit?.discount || '',
        enableDiscount: (orderToEdit?.discount || 0) > 0,
        shippingStatus: orderToEdit?.shipping?.status || 'Ordered',
        paymentStatus: orderToEdit?.paymentStatus || 'Unpaid',
        date: orderToEdit?.date || new Date().toISOString()
    };

    const [formData, setFormData] = useState(initialFormState);
    const [locationData, setLocationData] = useState<Province[]>([]);
    
    useEffect(() => {
        import('../data/cambodia.json').then((module) => {
            setLocationData(module.default as Province[]);
        });
    }, []);
    const [productSelection, setProductSelection] = useState({ id: '', quantity: 1 });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isShippingPointSelectorOpen, setIsShippingPointSelectorOpen] = useState(false);

    // --- Customer Autofill Suggestions ---
    const [showPhoneSuggestions, setShowPhoneSuggestions] = useState(false);
    const [showNameSuggestions, setShowNameSuggestions] = useState(false);
    const phoneInputRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLDivElement>(null);

    // Build a deduplicated map of customers from past orders (most recent first)
    const customerLookup = React.useMemo(() => {
        const map = new Map<string, {
            name: string;
            phone: string;
            city: string;
            district: string;
            commune: string;
            village: string;
            address: string;
            page: string;
            date: string;
        }>();
        // Sort sales by date descending so we keep the most recent customer info
        const sorted = [...sales].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        for (const sale of sorted) {
            if (sale.customer?.phone && !map.has(sale.customer.phone)) {
                map.set(sale.customer.phone, {
                    name: sale.customer.name || '',
                    phone: sale.customer.phone,
                    city: sale.customer.city || '',
                    district: sale.customer.district || '',
                    commune: sale.customer.commune || '',
                    village: sale.customer.village || '',
                    address: sale.customer.address || '',
                    page: sale.customer.page || '',
                    date: sale.date,
                });
            }
        }
        return map;
    }, [sales]);

    // Filter suggestions based on current phone input
    const phoneSuggestions = React.useMemo(() => {
        const query = formData.customerPhone.trim();
        if (!query || query.length < 2) return [];
        const results: { name: string; phone: string; city: string; district: string; commune: string; village: string; address: string; page: string; date: string }[] = [];
        for (const [phone, cust] of customerLookup) {
            if (phone.includes(query) && phone !== query) {
                results.push(cust);
            }
            if (results.length >= 8) break;
        }
        return results;
    }, [formData.customerPhone, customerLookup]);

    // Filter suggestions based on current name input
    const nameSuggestions = React.useMemo(() => {
        const query = formData.customerName.trim().toLowerCase();
        if (!query || query.length < 2) return [];
        const results: { name: string; phone: string; city: string; district: string; commune: string; village: string; address: string; page: string; date: string }[] = [];
        const seen = new Set<string>();
        for (const [, cust] of customerLookup) {
            if (cust.name.toLowerCase().includes(query) && !seen.has(cust.phone)) {
                results.push(cust);
                seen.add(cust.phone);
            }
            if (results.length >= 8) break;
        }
        return results;
    }, [formData.customerName, customerLookup]);

    // Apply a selected customer suggestion to autofill all fields
    const applyCustomerSuggestion = useCallback((cust: { name: string; phone: string; city: string; district: string; commune: string; village: string; address: string; page: string }) => {
        // Parse the saved full address to extract just the street/house part
        // The stored address is the full preview: "street, commune, district, city"
        // We need to strip out the structured parts to get just the street detail
        let streetAddress = cust.address || '';
        const partsToRemove = [cust.city, cust.district, cust.commune, cust.village].filter(Boolean);
        partsToRemove.forEach(part => {
            if (streetAddress.includes(part)) {
                streetAddress = streetAddress.replace(part, '');
            }
        });
        streetAddress = streetAddress.replace(/ខេត្ត\s*|រាជធានី\s*/g, '').trim();
        streetAddress = streetAddress.split(',').map(s => s.trim()).filter(Boolean).join(', ');

        setFormData(prev => ({
            ...prev,
            customerName: cust.name,
            customerPhone: cust.phone,
            city: cust.city,
            district: cust.district,
            commune: cust.commune,
            village: cust.village,
            address: streetAddress,
            pageName: cust.page || prev.pageName,
        }));
        setShowPhoneSuggestions(false);
        setShowNameSuggestions(false);
    }, []);

    // --- Scammer Detection ---
    const detectedScammer = React.useMemo(() => {
        const phone = formData.customerPhone.trim();
        if (!phone || phone.length < 3) return null;
        return blockedCustomers.find(bc => bc.phone === phone) || null;
    }, [formData.customerPhone, blockedCustomers]);

    // Close suggestions when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (phoneInputRef.current && !phoneInputRef.current.contains(e.target as Node)) {
                setShowPhoneSuggestions(false);
            }
            if (nameInputRef.current && !nameInputRef.current.contains(e.target as Node)) {
                setShowNameSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const cleanCityPreview = formData.city ? formData.city.replace(/ខេត្ត\s*|រាជធានី\s*/g, '').trim() : '';
    const addressPreviewText = [formData.address, formData.commune, formData.district, cleanCityPreview].filter(Boolean).join(', ');

    // Derived Location Hierarchy
    const availableDistricts = React.useMemo(() => {
        if (!formData.city) return [];
        for (const p of locationData) {
            if (formData.city.includes(p.khmer)) {
                return p.districts || [];
            }
        }
        return [];
    }, [formData.city]);

    const availableCommunes = React.useMemo(() => {
        if (!formData.district || availableDistricts.length === 0) return [];
        const dFound = availableDistricts.find(d => d.khmer === formData.district);
        return dFound?.communes || [];
    }, [formData.district, availableDistricts]);

    const handleShippingPointSelect = (data: {
        province: string;
        provinceLatin?: string;
        district?: string;
        commune?: string;
        village?: string;
        addressDetail: string;
        customName: string;
        courier: string;
        phone: string;
        contactName: string;
    }) => {
        const translatedCity = (PROVINCE_TRANSLATIONS[data.province] || data.provinceLatin || data.province).trim();
        const cleanProv = (data.province || '').trim();

        let matchedCity = '';
        if (translatedCity && cities.includes(translatedCity)) {
            matchedCity = translatedCity;
        } else if (cleanProv && cities.includes(cleanProv)) {
            matchedCity = cleanProv;
        } else if (translatedCity && cities.some(c => c.toLowerCase() === translatedCity.toLowerCase())) {
            matchedCity = cities.find(c => c.toLowerCase() === translatedCity.toLowerCase()) || '';
        } else if (cleanProv && cities.some(c => c.includes(cleanProv))) {
            // Highly robust match for 'រាជធានីភ្នំពេញ' including 'ភ្នំពេញ'
            matchedCity = cities.find(c => c.includes(cleanProv)) || '';
        } else if (translatedCity && cities.some(c => c.toLowerCase().includes(translatedCity.toLowerCase()) || translatedCity.toLowerCase().includes(c.toLowerCase()))) {
            matchedCity = cities.find(c => c.toLowerCase().includes(translatedCity.toLowerCase()) || translatedCity.toLowerCase().includes(c.toLowerCase())) || '';
        }

        setFormData(prev => ({
            ...prev,
            city: matchedCity || data.province || prev.city,
            district: data.district || '',
            commune: data.commune || '',
            village: data.village || '',
            address: data.addressDetail || '',
            shippingCompany: data.courier || prev.shippingCompany,
            customerPhone: data.phone || prev.customerPhone,
            customerName: data.contactName || prev.customerName
        }));
    };

    useEffect(() => {
        if (orderToEdit) {
            const city = orderToEdit.customer?.city || '';
            const district = orderToEdit.customer?.district || '';
            const commune = orderToEdit.customer?.commune || '';
            let addressDetails = orderToEdit.customer?.address || '';

            // Clean up the address detail string by removing the structured components
            const partsToRemove = [city, district, commune].filter(Boolean);
            partsToRemove.forEach(part => {
                if (addressDetails.includes(part)) {
                    addressDetails = addressDetails.replace(part, '');
                }
            });
            // Clean up any double commas and trimming
            addressDetails = addressDetails.split(',').map(s => s.trim()).filter(Boolean).join(', ');

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
                district: orderToEdit.customer?.district || '',
                commune: orderToEdit.customer?.commune || '',
                village: orderToEdit.customer?.village || '',
                address: addressDetails,
                amountReceived: orderToEdit.amountReceived || 0,
                settleDate: orderToEdit.settleDate || '',
                paymentMethod: (orderToEdit.paymentMethod || '') as any,
                paymentAfterDelivery: isCOD,
                discount: orderToEdit.discount || 0,
                enableDiscount: (orderToEdit.discount || 0) > 0,
                shippingStatus: orderToEdit.shipping?.status || 'Ordered',
                paymentStatus: (orderToEdit.paymentStatus as any) === 'Pending' ? 'Unpaid' : (orderToEdit.paymentStatus as 'Unpaid' | 'Paid' | 'Get File' | 'Cancel') || 'Unpaid',
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

    // (Removed useEffect that was overwriting paymentStatus on load)

    const subtotal = React.useMemo(() => cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0), [cartItems]);
    const discount = React.useMemo(() => formData.enableDiscount ? (formData.discount === '' ? 0 : Number(formData.discount)) : 0, [formData.enableDiscount, formData.discount]);
    const total = React.useMemo(() => Math.max(0, subtotal - discount), [subtotal, discount]);

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

        // Block scammer orders
        if (detectedScammer) {
            showToast('⛔ អតិថិជននេះស្ថិតក្នុងបញ្ជីខ្មៅ (Scammer)! មិនអាចបង្កើតការកម្ម៉ង់បានទេ។', 'error');
            return;
        }

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

            const cleanCity = formData.city ? formData.city.replace(/ខេត្ត\s*|រាជធានី\s*/g, '').trim() : '';

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
                    city: cleanCity,
                    district: formData.district,
                    commune: formData.commune,
                    village: formData.village,
                    address: addressPreviewText
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

                // Send Telegram Notification if status changed
                if (orderToEdit.shipping?.status !== formData.shippingStatus) {
                    const orderCopy = { ...orderToEdit, ...orderData, date: formData.date || orderToEdit.date } as Sale;
                    if (telegramConfigs && telegramConfigs.length > 0) {
                        const matchingConfigs = telegramConfigs.filter(c => c.triggerStatuses.includes(formData.shippingStatus));
                        matchingConfigs.forEach(config => {
                            if (config.botToken && config.chatId) {
                                sendTelegramOrderNotification(config.botToken, config.chatId, orderCopy, orderCopy.orderIndex || 0).catch(err => {
                                    console.error('Failed to send Telegram notification:', err);
                                });
                            }
                        });
                    }
                }
            } else {
                const createdSale = await addOnlineOrder({ ...orderData, date: formData.date || new Date().toISOString() });
                // We need the current sales to calculate sequence
                const sequenceNumber = (sales.filter(s => new Date(s.date).toDateString() === new Date(createdSale.date).toDateString()).length) + 1;
                
                showToast('Order created', 'success');

                // Send Telegram Notification
                if (telegramConfigs && telegramConfigs.length > 0) {
                    const matchingConfigs = telegramConfigs.filter(c => c.triggerStatuses.includes(formData.shippingStatus));
                    matchingConfigs.forEach(config => {
                        if (config.botToken && config.chatId) {
                            sendTelegramOrderNotification(config.botToken, config.chatId, createdSale, sequenceNumber).catch(err => {
                                console.error('Failed to send Telegram notification:', err);
                                showToast(`Telegram Error: ${err.message}`, 'error');
                            });
                        }
                    });
                } else if (telegramBotToken && telegramChatId) {
                    sendTelegramOrderNotification(telegramBotToken, telegramChatId, createdSale, sequenceNumber).catch(err => {
                        console.error('Failed to send Telegram notification:', err);
                        showToast(`Telegram Error: ${err.message}`, 'error');
                    });
                }
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
                            <button onClick={handleSubmit} disabled={isSubmitting || !!detectedScammer} className="primary-button" style={{ padding: '10px 32px', borderRadius: '10px', fontSize: '15px', boxShadow: detectedScammer ? 'none' : '0 4px 10px rgba(239, 68, 68, 0.2)', cursor: (isSubmitting || detectedScammer) ? 'not-allowed' : 'pointer', opacity: (isSubmitting || detectedScammer) ? 0.5 : 1, background: detectedScammer ? '#9CA3AF' : undefined }}>
                                {detectedScammer ? '⛔ Scammer — Blocked' : isSubmitting ? 'Saving...' : (orderToEdit ? 'Update Order' : 'Confirm Order')}
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
                            ព័ត៌មានអតិថិជន
                        </h3>

                        {/* Scammer Warning Banner */}
                        {detectedScammer && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '12px',
                                padding: '14px 16px',
                                background: 'linear-gradient(135deg, #FEF2F2, #FEE2E2)',
                                border: '2px solid #EF4444',
                                borderRadius: '12px',
                                marginBottom: '20px',
                                animation: 'pulse 2s infinite'
                            }}>
                                <div style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '50%',
                                    background: '#EF4444',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0
                                }}>
                                    <AlertTriangle size={20} color="white" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#DC2626', marginBottom: '4px' }}>
                                        ⛔ អតិថិជន Scammer — បានបិទការកម្ម៉ង់
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#991B1B', lineHeight: 1.5 }}>
                                        <strong>{detectedScammer.name}</strong> ({detectedScammer.phone}) ស្ថិតក្នុងបញ្ជីខ្មៅ។
                                        {detectedScammer.reason && (
                                            <><br />មូលហេតុ: {detectedScammer.reason}</>
                                        )}
                                        {detectedScammer.blockedBy && (
                                            <><br />បានបិទដោយ: {detectedScammer.blockedBy} — {new Date(detectedScammer.blockedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '12px' : '20px', marginBottom: isMobile ? '12px' : '20px' }}>
                                <div style={{ marginBottom: '0' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-primary)' }}>កាលបរិច្ឆេទកម្ម៉ង់</label>
                                        {currentUser?.roleId !== 'salesman' && (
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
                                            កំណត់ឥឡូវនេះ
                                            </button>
                                        )}
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
                                                        : 'ជ្រើសរើសកាលបរិច្ឆេទ...'}
                                                </span>
                                                <Calendar size={18} color="var(--color-primary)" />
                                            </div>
                                            <input
                                                type="datetime-local"
                                                disabled={currentUser?.roleId === 'salesman'}
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
                                            disabled={currentUser?.roleId === 'salesman'}
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
                            <div ref={nameInputRef} style={{ position: 'relative' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>ឈ្មោះអតិថិជន <span style={{ color: '#EF4444' }}>*</span></label>
                                <input
                                    className="search-input"
                                    style={{ width: '100%', padding: '10px 12px' }}
                                    value={formData.customerName}
                                    onChange={e => {
                                        setFormData({ ...formData, customerName: e.target.value });
                                        setShowNameSuggestions(true);
                                    }}
                                    onFocus={() => setShowNameSuggestions(true)}
                                    placeholder="បញ្ចូលឈ្មោះ"
                                    autoComplete="off"
                                />
                                {showNameSuggestions && nameSuggestions.length > 0 && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '100%',
                                        left: 0,
                                        right: 0,
                                        zIndex: 1000,
                                        background: 'white',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '0 0 10px 10px',
                                        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                        maxHeight: '240px',
                                        overflowY: 'auto',
                                        marginTop: '-1px'
                                    }}>
                                        <div style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <User size={12} /> អតិថិជនមុន
                                        </div>
                                        {nameSuggestions.map((cust, idx) => (
                                            <div
                                                key={`name-${cust.phone}-${idx}`}
                                                onClick={() => applyCustomerSuggestion(cust)}
                                                style={{
                                                    padding: '10px 12px',
                                                    cursor: 'pointer',
                                                    borderBottom: idx < nameSuggestions.length - 1 ? '1px solid var(--color-border)' : 'none',
                                                    transition: 'background 0.15s',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px'
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-primary-light)')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                                            >
                                                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                    <User size={14} color="var(--color-primary)" />
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cust.name}</div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        📞 {cust.phone}{cust.city ? ` · ${cust.city}` : ''}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div ref={phoneInputRef} style={{ position: 'relative' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>លេខទូរស័ព្ទ <span style={{ color: '#EF4444' }}>*</span></label>
                                <input
                                    className="search-input"
                                    style={{ width: '100%', padding: '10px 12px' }}
                                    value={formData.customerPhone}
                                    onChange={e => {
                                        setFormData({ ...formData, customerPhone: e.target.value.replace(/\D/g, '') });
                                        setShowPhoneSuggestions(true);
                                    }}
                                    onFocus={() => setShowPhoneSuggestions(true)}
                                    placeholder="០១២..."
                                    autoComplete="off"
                                />
                                {showPhoneSuggestions && phoneSuggestions.length > 0 && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '100%',
                                        left: 0,
                                        right: 0,
                                        zIndex: 1000,
                                        background: 'white',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '0 0 10px 10px',
                                        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                        maxHeight: '240px',
                                        overflowY: 'auto',
                                        marginTop: '-1px'
                                    }}>
                                        <div style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Phone size={12} /> លេខទូរស័ព្ទដែលធ្លាប់កម្ម៉ង់
                                        </div>
                                        {phoneSuggestions.map((cust, idx) => (
                                            <div
                                                key={`phone-${cust.phone}-${idx}`}
                                                onClick={() => applyCustomerSuggestion(cust)}
                                                style={{
                                                    padding: '10px 12px',
                                                    cursor: 'pointer',
                                                    borderBottom: idx < phoneSuggestions.length - 1 ? '1px solid var(--color-border)' : 'none',
                                                    transition: 'background 0.15s',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px'
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-primary-light)')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                                            >
                                                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                    <Phone size={14} color="var(--color-primary)" />
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cust.phone}</div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        👤 {cust.name}{cust.city ? ` · ${cust.city}` : ''}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>ប្រភពទំព័រ <span style={{ color: '#EF4444' }}>*</span></label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select className="search-input" style={{ flex: 1, padding: '10px 12px', background: 'white' }} value={formData.pageName} onChange={e => setFormData({ ...formData, pageName: e.target.value })}>
                                        <option value="">ជ្រើសរើសទំព័រ...</option>
                                        {pages.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                    {!isMobile && (
                                        <button onClick={() => { setConfigType('page'); setIsConfigModalOpen(true); }} style={{ padding: '0 12px', background: 'white', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><Settings size={18} /></button>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div style={{ marginBottom: isMobile ? '12px' : '20px', background: 'var(--color-bg)', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)' }}>អាសយដ្ឋានដឹកជញ្ជូន</label>
                                <button 
                                    onClick={() => setIsShippingPointSelectorOpen(true)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 16px', cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)' }}
                                >
                                    <MapPin size={14} /> ជ្រើសរើសទីតាំង
                                </button>
                            </div>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '2fr 1fr 1fr', gap: isMobile ? '12px' : '16px', marginBottom: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>រាជធានី / ខេត្ត <span style={{ color: '#EF4444' }}>*</span></label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <select className="search-input" style={{ flex: 1, padding: '10px 12px', background: 'white' }} value={formData.city} onChange={e => setFormData({ ...formData, city: e.target.value })}>
                                            <option value="">-- បង្ហាញរាជធានី និងខេត្ត --</option>
                                            {locationData.map(p => (
                                                <option key={p.code} value={p.khmer}>
                                                    {p.khmer} ({p.latin})
                                                </option>
                                            ))}
                                        </select>
                                        {!isMobile && (
                                            <button onClick={() => { setConfigType('city'); setIsConfigModalOpen(true); }} style={{ padding: '0 12px', background: 'white', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><Settings size={18} /></button>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>ស្រុក / ខណ្ឌ</label>
                                    {availableDistricts.length > 0 ? (
                                        <select 
                                            className="search-input" 
                                            style={{ width: '100%', padding: '10px 12px', background: 'white' }} 
                                            value={formData.district} 
                                            onChange={e => setFormData({ ...formData, district: e.target.value, commune: '' })}
                                        >
                                            <option value="">ជ្រើសរើសស្រុក...</option>
                                            {availableDistricts.map(d => <option key={d.code} value={d.khmer}>{d.khmer} ({d.latin})</option>)}
                                        </select>
                                    ) : (
                                        <input className="search-input" style={{ width: '100%', padding: '10px 12px', background: 'white' }} value={formData.district} onChange={e => setFormData({ ...formData, district: e.target.value })} placeholder="ស្រុក / ខណ្ឌ" disabled={!formData.city} />
                                    )}
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>ឃុំ / សង្កាត់</label>
                                    {availableCommunes.length > 0 ? (
                                        <select 
                                            className="search-input" 
                                            style={{ width: '100%', padding: '10px 12px', background: 'white' }} 
                                            value={formData.commune} 
                                            onChange={e => setFormData({ ...formData, commune: e.target.value })}
                                        >
                                            <option value="">ជ្រើសរើសឃុំ...</option>
                                            {availableCommunes.map(c => <option key={c.code} value={c.khmer}>{c.khmer} ({c.latin})</option>)}
                                        </select>
                                    ) : (
                                        <input className="search-input" style={{ width: '100%', padding: '10px 12px', background: 'white' }} value={formData.commune} onChange={e => setFormData({ ...formData, commune: e.target.value })} placeholder="ឃុំ / សង្កាត់" disabled={!formData.district} />
                                    )}
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: isMobile ? '12px' : '16px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>ផ្លូវ / លេខផ្ទះ</label>
                                    <input className="search-input" style={{ width: '100%', padding: '10px 12px', background: 'white' }} value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} placeholder="ផ្ទះ, ផ្លូវ ។ល។" />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>ក្រុមហ៊ុនដឹកជញ្ជូន <span style={{ color: '#EF4444' }}>*</span></label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <select className="search-input" style={{ flex: 1, padding: '10px 12px', background: 'white' }} value={formData.shippingCompany} onChange={e => setFormData({ ...formData, shippingCompany: e.target.value })}>
                                            <option value="">ជ្រើសរើសក្រុមហ៊ុនដឹកជញ្ជូន...</option>
                                            <option value="អ្នកដឹក">អ្នកដឹក</option>
                                            {shippingCompanies.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        {!isMobile && (
                                            <button onClick={() => { setConfigType('shipping'); setIsConfigModalOpen(true); }} style={{ padding: '0 12px', background: 'white', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><Settings size={18} /></button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div style={{ marginTop: '16px' }}>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-primary)', marginBottom: '8px' }}>រូបរាងអាសយដ្ឋានពេញ (Address Preview)</label>
                                <div style={{ 
                                    padding: '12px 16px', 
                                    background: 'var(--color-primary-light)', 
                                    border: '1px solid var(--color-primary)', 
                                    borderRadius: '8px', 
                                    color: 'var(--color-primary-dark)', 
                                    fontSize: '14px', 
                                    fontWeight: 500,
                                    minHeight: '44px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    wordBreak: 'break-word'
                                }}>
                                    {addressPreviewText || <span style={{ opacity: 0.5, fontStyle: 'italic' }}>មិនទាន់មានទិន្នន័យទីតាំងទេ...</span>}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel" style={{ padding: isMobile ? '16px' : '24px', border: '1px solid var(--color-border)' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '20px', color: 'var(--color-primary)' }}>ការកម្ម៉ង់ និងការទូទាត់</h3>

                        {/* Shipping & Staff Details */}
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '12px' : '20px', marginBottom: isMobile ? '12px' : '20px' }}>

                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>អ្នកលក់ <span style={{ color: '#EF4444' }}>*</span></label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select
                                        className="search-input"
                                        style={{ flex: 1, padding: '10px 12px', background: currentUser?.roleId === 'salesman' ? 'var(--color-bg)' : 'white', opacity: currentUser?.roleId === 'salesman' ? 0.7 : 1 }}
                                        value={formData.salesman}
                                        onChange={e => setFormData({ ...formData, salesman: e.target.value })}
                                        disabled={currentUser?.roleId === 'salesman'}
                                    >
                                        <option value="">ជ្រើសរើសអ្នកលក់...</option>
                                        {availableSalesmen.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                    </select>

                                </div>
                            </div>
                            {/* Customer Care */}
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>ផ្នែកថែទាំអតិថិជន</label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select className="search-input" style={{ flex: 1, padding: '10px 12px' }} value={formData.customerCare} onChange={e => setFormData({ ...formData, customerCare: e.target.value })}>
                                        <option value="">ជ្រើសរើសផ្នែកថែទាំអតិថិជន...</option>
                                        {availableCustomerCare.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Delivery Status</label>
                                <select
                                    className="search-input"
                                    style={{ width: '100%', padding: '10px 12px', background: currentUser?.roleId === 'salesman' ? 'var(--color-bg)' : 'white', opacity: currentUser?.roleId === 'salesman' ? 0.7 : 1 }}
                                    value={formData.shippingStatus}
                                    onChange={e => setFormData({ ...formData, shippingStatus: e.target.value as any })}
                                    disabled={currentUser?.roleId === 'salesman'}
                                >
                                    {[{id: 'Ordered', name: 'Ordered'},{id: 'Pending', name: 'Pending'},{id: 'Confirmed', name: 'Confirmed'},{id: 'Shipped', name: 'Shipped'},{id: 'Delivered', name: 'Delivered'},{id: 'Returned', name: 'Returned'}].map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                                    {[{id: 'Unpaid', name: 'Unpaid'}, {id: 'Paid', name: 'Paid'}, {id: 'Get File', name: 'Get File'}, {id: 'Cancel', name: 'Cancel'}].map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                                        paymentMethod: '' as any,
                                        paymentStatus: 'Unpaid',
                                        amountReceived: e.target.checked ? 0 : formData.amountReceived
                                    })}
                                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                />
                                ទូទាត់ប្រាក់ពេលទទួលទំនិញ (COD)
                            </label>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '12px' : '20px', marginBottom: isMobile ? '12px' : '20px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>វិធីសាស្ត្រទូទាត់</label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select
                                        className="search-input"
                                        style={{ flex: 1, padding: '10px 12px', background: formData.paymentAfterDelivery ? 'var(--color-bg)' : 'white' }}
                                        value={formData.paymentMethod || ''}
                                        onChange={e => setFormData({ ...formData, paymentMethod: e.target.value as any })}
                                        disabled={formData.paymentAfterDelivery}
                                    >
                                        <option value="">ជ្រើសរើសវិធីសាស្ត្រទូទាត់...</option>
                                        {paymentMethods.map(method => <option key={method} value={method}>{method}</option>)}
                                    </select>
                                    {!isMobile && (
                                        <button onClick={() => { setConfigType('paymentMethod'); setIsConfigModalOpen(true); }} disabled={formData.paymentAfterDelivery} style={{ padding: '0 12px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: formData.paymentAfterDelivery ? 'not-allowed' : 'pointer', color: 'var(--color-text-secondary)', opacity: formData.paymentAfterDelivery ? 0.5 : 1 }}><Settings size={18} /></button>
                                    )}
                                </div>
                            </div>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>ប្រាក់ទទួលបាន ($)</label>
                                    <span style={{ fontSize: '11px', color: 'var(--color-primary)', cursor: 'pointer', opacity: formData.paymentAfterDelivery ? 0.5 : 1 }} onClick={() => !formData.paymentAfterDelivery && setFormData({ ...formData, amountReceived: cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0) })}>ដាក់ពេញ</span>
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
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>ចំណាំ / Note</label>
                            <input className="search-input" style={{ width: '100%', padding: '10px 12px', fontFamily: 'Battambang' }} value={formData.remark} onChange={e => setFormData({ ...formData, remark: e.target.value })} placeholder="បញ្ចូលចំណាំបន្ថែម..." />
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
                    <h3 style={{ fontSize: '16px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '16px', color: 'var(--color-primary)' }}>ទំនិញដែលបានកម្ម៉ង់</h3>

                    <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                        <select className="search-input" style={{ flex: 1, padding: '10px 12px' }} value={productSelection.id} onChange={e => setProductSelection({ ...productSelection, id: e.target.value })}>
                            <option value="">បន្ថែមទំនិញរហ័ស...</option>
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
                                <p style={{ fontSize: '14px' }}>មិនមានទំនិញក្នុងកន្ត្រកទេ</p>
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
                                បន្ថែមការបញ្ចុះតម្លៃ
                            </label>
                            {formData.enableDiscount && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', width: '80px' }}>ចំនួន ($):</span>
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
                            <span>សរុប (Subtotal)</span>
                            <span>${subtotal.toFixed(2)}</span>
                        </div>
                        {formData.enableDiscount && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '8px', color: '#EF4444' }}>
                                <span>បញ្ចុះតម្លៃ</span>
                                <span>-${discount.toFixed(2)}</span>
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '20px', fontWeight: '800', color: 'var(--color-primary)' }}>
                            <span>សរុបទាំងអស់</span>
                            <span>${total.toFixed(2)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: '600', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                            <span>សរុបជាប្រាក់រៀល (KHR)</span>
                            <span>{(total * khrExchangeRate).toLocaleString()} ៛</span>
                        </div>
                    </div>
                </div>
            </div >

            {isMobile && (
                <div style={{ paddingTop: '12px', marginTop: 'auto', display: 'flex', gap: '12px', background: 'white', padding: '12px', borderTop: '1px solid var(--color-border)', position: 'sticky', bottom: 0, zIndex: 1000 }}>
                    <button onClick={onCancel} disabled={isSubmitting} style={{ flex: 1, padding: '12px', background: 'white', border: '1px solid var(--color-border)', borderRadius: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', opacity: isSubmitting ? 0.7 : 1 }}>បោះបង់</button>
                    <button onClick={handleSubmit} disabled={isSubmitting || !!detectedScammer} className="primary-button" style={{ flex: 2, padding: '12px', borderRadius: '12px', fontSize: '16px', fontWeight: 700, boxShadow: detectedScammer ? 'none' : '0 4px 12px rgba(239, 68, 68, 0.2)', opacity: (isSubmitting || detectedScammer) ? 0.5 : 1, background: detectedScammer ? '#9CA3AF' : undefined }}>
                        {detectedScammer ? '⛔ Scammer' : isSubmitting ? 'កំពុងរក្សាទុក...' : (orderToEdit ? 'កែប្រែការកម្ម៉ង់' : 'បញ្ជាក់ការកម្ម៉ង់')}
                    </button>
                </div>
            )}

            <ConfigModal
                isOpen={isConfigModalOpen}
                onClose={() => setIsConfigModalOpen(false)}
                type={configType}
            />

            <ShippingPointSelector 
                isOpen={isShippingPointSelectorOpen}
                onClose={() => setIsShippingPointSelectorOpen(false)}
                onSelect={handleShippingPointSelect}
                shippingCompanies={shippingCompanies}
            />
        </div >
    );
};

export default CheckoutForm;
