import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Product, CartItem, Sale, StoreContextType, Customer } from '../types';

interface ConfigState {
    shippingCompanies: string[];
    salesmen: string[];
    categories: string[];
    pages: string[];
    customerCare: string[];
    paymentMethods: string[];
    cities: string[];
    pinnedProducts?: string[];
    pinnedOrderColumns?: string[]; // Added pinned order columns
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

// Initial Dummy Data


export const StoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [products, setProducts] = useState<Product[]>([]);
    const [sales, setSales] = useState<Sale[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [config, setConfig] = useState<ConfigState>({
        shippingCompanies: ['J&T', 'VET', 'JS Express'],
        salesmen: ['Sokheng', 'Thida'],
        categories: ['Portable', 'PartyBox'],
        pages: ['Chantha Sound'],
        customerCare: ['Chantha'],
        paymentMethods: ['Cash', 'QR'],
        cities: [
            'រាជធានីភ្នំពេញ',
            'ខេត្តបន្ទាយមានជ័យ',
            'ខេត្តបាត់ដំបង',
            'ខេត្តកំពង់ចាម',
            'ខេត្តកំពង់ឆ្នាំង',
            'ខេត្តកំពង់ស្ពឺ',
            'ខេត្តកំពង់ធំ',
            'ខេត្តកំពត',
            'ខេត្តកណ្តាល',
            'ខេត្តកោះកុង',
            'ខេត្តក្រចេះ',
            'ខេត្តមណ្ឌលគិរី',
            'ខេត្តព្រះវិហារ',
            'ខេត្តព្រៃវែង',
            'ខេត្តពោធិ៍សាត់',
            'ខេត្តរតនគិរី',
            'ខេត្តសៀមរាប',
            'ខេត្តព្រះសីហនុ',
            'ខេត្តស្ទឹងត្រែង',
            'ខេត្តស្វាយរៀង',
            'ខេត្តតាកែវ',
            'ខេត្តឧត្តរមានជ័យ',
            'ខេត្តកែប',
            'ខេត្តប៉ៃលិន',
            'ខេត្តត្បូងឃ្មុំ'
        ],
        pinnedProducts: [],
        pinnedOrderColumns: []
    });



    // Initial Fetch
    useEffect(() => {
        const fetchData = async () => {


            // Products
            const { data: productsData } = await supabase.from('products').select('*');
            if (productsData) setProducts(productsData);

            // Customers
            const { data: customersData } = await supabase.from('customers').select('*');
            if (customersData) setCustomers(customersData);

            // Sales (Fetch last 500 or so? For now all)
            // We need to fetch sale_items too or join?
            // Simple approach: fetch sales, then items on demand? No, dashboard needs totals.
            // Let's fetch sales with items.
            const { data: salesData } = await supabase.from('sales').select(`*, items:sale_items(*)`);
            if (salesData) {
                // Map DB structure to App structure
                const mappedSales: Sale[] = salesData.map(s => ({
                    id: s.id,
                    total: Number(s.total),
                    discount: Number(s.discount),
                    date: s.date,
                    paymentMethod: s.payment_method as any,
                    type: s.type as any,
                    salesman: s.salesman,
                    customerCare: s.customer_care,
                    remark: s.remark,
                    amountReceived: Number(s.amount_received),
                    settleDate: s.settle_date,
                    paymentStatus: s.payment_status as any,
                    orderStatus: s.order_status as any,
                    shipping: s.shipping_status ? {
                        company: s.shipping_company,
                        trackingNumber: s.tracking_number || '',
                        status: s.shipping_status as any,
                        cost: Number(s.shipping_cost || 0),
                        staffName: ''
                    } : undefined,
                    customer: s.customer_snapshot,
                    items: s.items.map((i: any) => ({
                        id: i.product_id,
                        name: i.name,
                        price: Number(i.price),
                        quantity: i.quantity,
                        image: i.image,
                        model: '', // Optional in CartItem
                        stock: 0, // Not needed in history
                        category: ''
                    }))
                }));
                // Sort by date desc
                setSales(mappedSales.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            }

            // Config
            const { data: configData } = await supabase.from('app_config').select('data').eq('id', 1).single();

            if (configData) {
                const loadedConfig = configData.data;
                const needsMigration = !loadedConfig.cities ||
                    loadedConfig.cities.length === 0 ||
                    loadedConfig.cities.includes('Phnom Penh') ||
                    !loadedConfig.cities.includes('រាជធានីភ្នំពេញ') ||
                    !loadedConfig.pinnedProducts; // Check for new field

                if (needsMigration) {
                    const updatedConfig = {
                        ...loadedConfig,
                        cities: loadedConfig.cities && loadedConfig.cities.includes('រាជធានីភ្នំពេញ') ? loadedConfig.cities : [
                            'រាជធានីភ្នំពេញ',
                            'ខេត្តបន្ទាយមានជ័យ',
                            'ខេត្តបាត់ដំបង',
                            'ខេត្តកំពង់ចាម',
                            'ខេត្តកំពង់ឆ្នាំង',
                            'ខេត្តកំពង់ស្ពឺ',
                            'ខេត្តកំពង់ធំ',
                            'ខេត្តកំពត',
                            'ខេត្តកណ្តាល',
                            'ខេត្តកោះកុង',
                            'ខេត្តក្រចេះ',
                            'ខេត្តមណ្ឌលគិរី',
                            'ខេត្តព្រះវិហារ',
                            'ខេត្តព្រៃវែង',
                            'ខេត្តពោធិ៍សាត់',
                            'ខេត្តរតនគិរី',
                            'ខេត្តសៀមរាប',
                            'ខេត្តព្រះសីហនុ',
                            'ខេត្តស្ទឹងត្រែង',
                            'ខេត្តស្វាយរៀង',
                            'ខេត្តតាកែវ',
                            'ខេត្តឧត្តរមានជ័យ',
                            'ខេត្តកែប',
                            'ខេត្តប៉ៃលិន',
                            'ខេត្តត្បូងឃ្មុំ'
                        ],
                        pinnedProducts: loadedConfig.pinnedProducts || [],
                        pinnedOrderColumns: loadedConfig.pinnedOrderColumns || []
                    };
                    setConfig(updatedConfig);
                    await supabase.from('app_config').upsert({ id: 1, data: updatedConfig });
                } else {
                    setConfig(loadedConfig);
                }
            } else {
                // Initial if no config found
                const defaultConfig = {
                    shippingCompanies: ['J&T', 'VET', 'JS Express'],
                    salesmen: ['Sokheng', 'Thida'],
                    categories: ['Portable', 'PartyBox'],
                    pages: ['Chantha Sound'],
                    customerCare: ['Chantha'],
                    paymentMethods: ['Cash', 'QR'],
                    cities: [
                        'រាជធានីភ្នំពេញ',
                        'ខេត្តបន្ទាយមានជ័យ',
                        'ខេត្តបាត់ដំបង',
                        'ខេត្តកំពង់ចាម',
                        'ខេត្តកំពង់ឆ្នាំង',
                        'ខេត្តកំពង់ស្ពឺ',
                        'ខេត្តកំពង់ធំ',
                        'ខេត្តកំពត',
                        'ខេត្តកណ្តាល',
                        'ខេត្តកោះកុង',
                        'ខេត្តក្រចេះ',
                        'ខេត្តមណ្ឌលគិរី',
                        'ខេត្តព្រះវិហារ',
                        'ខេត្តព្រៃវែង',
                        'ខេត្តពោធិ៍សាត់',
                        'ខេត្តរតនគិរី',
                        'ខេត្តសៀមរាប',
                        'ខេត្តព្រះសីហនុ',
                        'ខេត្តស្ទឹងត្រែង',
                        'ខេត្តស្វាយរៀង',
                        'ខេត្តតាកែវ',
                        'ខេត្តឧត្តរមានជ័យ',
                        'ខេត្តកែប',
                        'ខេត្តប៉ៃលិន',
                        'ខេត្តត្បូងឃ្មុំ'
                    ],
                    pinnedProducts: [],
                    pinnedOrderColumns: []
                };
                setConfig(defaultConfig);
                await supabase.from('app_config').upsert({ id: 1, data: defaultConfig });
            }


        };
        fetchData();
    }, []);

    // Sync Config to DB
    const updateConfig = async (newConfig: ConfigState) => {
        setConfig(newConfig);
        await supabase.from('app_config').upsert({ id: 1, data: newConfig });
    };

    const addShippingCompany = (name: string) => {
        if (!config.shippingCompanies.includes(name)) {
            updateConfig({ ...config, shippingCompanies: [...config.shippingCompanies, name] });
        }
    };

    const removeShippingCompany = (name: string) => {
        updateConfig({ ...config, shippingCompanies: config.shippingCompanies.filter(c => c !== name) });
    };

    const addSalesman = (name: string) => {
        if (!config.salesmen.includes(name)) {
            updateConfig({ ...config, salesmen: [...config.salesmen, name] });
        }
    };

    const removeSalesman = (name: string) => {
        updateConfig({ ...config, salesmen: config.salesmen.filter(s => s !== name) });
    };

    const addCategory = (name: string) => {
        if (!config.categories.includes(name)) {
            updateConfig({ ...config, categories: [...config.categories, name] });
        }
    };

    const removeCategory = (name: string) => {
        updateConfig({ ...config, categories: config.categories.filter(c => c !== name) });
    };

    const addPage = (name: string) => {
        if (!config.pages.includes(name)) {
            updateConfig({ ...config, pages: [...config.pages, name] });
        }
    };

    const removePage = (name: string) => {
        updateConfig({ ...config, pages: config.pages.filter(p => p !== name) });
    };

    const addCustomerCare = (name: string) => {
        if (!config.customerCare.includes(name)) {
            updateConfig({ ...config, customerCare: [...config.customerCare, name] });
        }
    };

    const removeCustomerCare = (name: string) => {
        updateConfig({ ...config, customerCare: config.customerCare.filter(c => c !== name) });
    };

    const addPaymentMethod = (name: string) => {
        if (!config.paymentMethods.includes(name)) {
            updateConfig({ ...config, paymentMethods: [...config.paymentMethods, name] });
        }
    };

    const removePaymentMethod = (name: string) => {
        updateConfig({ ...config, paymentMethods: config.paymentMethods.filter(p => p !== name) });
    };

    const addCity = (name: string) => {
        if (!config.cities.includes(name)) {
            updateConfig({ ...config, cities: [...config.cities, name] });
        }
    };

    const removeCity = (name: string) => {
        updateConfig({ ...config, cities: config.cities.filter(c => c !== name) });
    };

    const toggleProductPin = (productId: string) => {
        const pinned = config.pinnedProducts || [];
        if (pinned.includes(productId)) {
            updateConfig({ ...config, pinnedProducts: pinned.filter(id => id !== productId) });
        } else {
            updateConfig({ ...config, pinnedProducts: [...pinned, productId] });
        }
    };

    const toggleOrderColumnPin = (columnId: string) => {
        const pinned = config.pinnedOrderColumns || [];
        if (pinned.includes(columnId)) {
            updateConfig({ ...config, pinnedOrderColumns: pinned.filter(id => id !== columnId) });
        } else {
            updateConfig({ ...config, pinnedOrderColumns: [...pinned, columnId] });
        }
    };

    const [cart, setCart] = useState<CartItem[]>([]);
    const [editingOrder, setEditingOrder] = useState<Sale | null>(null);

    // Persistence - REMOVED (Migrated to Supabase)
    // LocalStorage syncing caused QuotaExceededError and is no longer needed.


    // Cart Actions
    const addToCart = (product: Product) => {
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) {
                // Check stock limit
                if (existing.quantity >= product.stock) return prev;
                return prev.map(item =>
                    item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
                );
            }
            return [...prev, { ...product, quantity: 1 }];
        });
    };

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.id !== productId));
    };

    const updateCartQuantity = (productId: string, quantity: number) => {
        if (quantity <= 0) {
            removeFromCart(productId);
            return;
        }

        const product = products.find(p => p.id === productId);
        if (!product || quantity > product.stock) return;

        setCart(prev => prev.map(item =>
            item.id === productId ? { ...item, quantity } : item
        ));
    };

    const clearCart = () => setCart([]);
    const updateCart = (items: CartItem[]) => setCart(items);

    // Customer Actions
    const addCustomer = async (customerData: Omit<Customer, 'id'>) => {
        const newCustomer: Customer = {
            ...customerData,
            id: Date.now().toString()
        };
        setCustomers(prev => [...prev, newCustomer]);
        await supabase.from('customers').insert(newCustomer);
    };

    const updateCustomer = async (id: string, updates: Partial<Customer>) => {
        setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
        await supabase.from('customers').update(updates).eq('id', id);
    };

    const deleteCustomer = async (id: string) => {
        setCustomers(prev => prev.filter(c => c.id !== id));
        await supabase.from('customers').delete().eq('id', id);
    };

    // Sales Actions
    const processSale = async (paymentMethod: Sale['paymentMethod'], discount: number = 0, customer?: Sale['customer']) => {
        if (cart.length === 0) return;

        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const total = Math.max(0, subtotal - discount);

        const newSale: Sale = {
            id: Date.now().toString(),
            items: [...cart],
            total,
            discount,
            date: new Date().toISOString(),
            paymentMethod,
            type: 'POS',
            customer: customer || {
                name: 'General Customer',
                phone: '',
            },
            amountReceived: paymentMethod === 'COD' ? 0 : total, // Initial logic for receipt
            paymentStatus: paymentMethod === 'COD' ? 'Unpaid' : 'Paid', // Assuming instant pay if not COD
            salesman: 'Sokheng', // Default or fetch from auth
            customerCare: 'Chantha'
        };

        // Update Sales Local
        setSales(prev => [newSale, ...prev]);

        // Clear Cart Local
        clearCart();

        // Async Updates
        // 1. Insert Sale
        const { error: saleError } = await supabase.from('sales').insert({
            id: newSale.id,
            total,
            discount,
            date: newSale.date,
            payment_method: paymentMethod,
            type: 'POS',
            salesman: newSale.salesman,
            customer_care: newSale.customerCare,
            amount_received: newSale.amountReceived,
            payment_status: newSale.paymentStatus,
            customer_snapshot: newSale.customer,
            order_status: 'Closed' // POS sales usually closed? Or Open?
        });

        if (saleError) console.error('Sale insert error', saleError);

        // 2. Insert Items
        const itemsPayload = newSale.items.map(item => ({
            sale_id: newSale.id,
            product_id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            image: item.image
        }));
        await supabase.from('sale_items').insert(itemsPayload);

        // 3. Update Stock
        newSale.items.forEach(async (item) => {
            // Optimistic local update
            setProducts(prev => prev.map(p => {
                if (p.id === item.id) return { ...p, stock: p.stock - item.quantity };
                return p;
            }));

            // DB Update (Decrement)
            // Ideally use RPC for atomic decrement, but here simple update:
            const { data: current } = await supabase.from('products').select('stock').eq('id', item.id).single();
            if (current) {
                await supabase.from('products').update({ stock: current.stock - item.quantity }).eq('id', item.id);
            }
        });
    };

    // Inventory Actions
    const addProduct = async (productData: Omit<Product, 'id'>) => {
        const newProduct: Product = {
            ...productData,
            id: Date.now().toString()
        };
        setProducts(prev => [...prev, newProduct]);
        await supabase.from('products').insert(newProduct);
    };

    const updateProduct = async (id: string, updates: Partial<Product>) => {
        setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
        await supabase.from('products').update(updates).eq('id', id);
    };

    const deleteProduct = async (id: string) => {
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) {
            console.error('Error deleting product:', error);
            // Optionally revert local state if needed, but for now just log
            alert(`Failed to delete product: ${error.message}`);
            // Re-fetch to sync state?
            const { data } = await supabase.from('products').select('*').eq('id', id).single();
            if (data) setProducts(prev => [...prev, data]);
        } else {
            setProducts(prev => prev.filter(p => p.id !== id));
        }
    };

    const deleteProducts = async (ids: string[]) => {
        const { error } = await supabase.from('products').delete().in('id', ids);
        if (error) {
            console.error('Error deleting products:', error);
            alert(`Failed to delete products: ${error.message}`);
        } else {
            setProducts(prev => prev.filter(p => !ids.includes(p.id)));
        }
    };

    const addOnlineOrder = async (order: Omit<Sale, 'id' | 'date'>) => {
        const newSale: Sale = {
            ...order,
            id: Date.now().toString(),
            date: new Date().toISOString()
        };
        setSales(prev => [newSale, ...prev]);

        // DB Insert
        const { error: saleError } = await supabase.from('sales').insert({
            id: newSale.id,
            total: newSale.total,
            discount: newSale.discount,
            date: newSale.date,
            payment_method: newSale.paymentMethod,
            type: 'Online',
            salesman: newSale.salesman,
            customer_care: newSale.customerCare,
            amount_received: newSale.amountReceived,
            payment_status: newSale.paymentStatus,
            customer_snapshot: newSale.customer,
            order_status: 'Open',
            shipping_company: newSale.shipping?.company,
            shipping_status: newSale.shipping?.status,
            tracking_number: newSale.shipping?.trackingNumber
        });

        if (saleError) {
            console.error("Error creating online order:", saleError);
        }

        // Items
        const itemsPayload = newSale.items.map(item => ({
            sale_id: newSale.id,
            product_id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            image: item.image
        }));
        await supabase.from('sale_items').insert(itemsPayload);

        // Update Stock
        newSale.items.forEach(async (item) => {
            // Local
            setProducts(prev => prev.map(p => {
                if (p.id === item.id) return { ...p, stock: p.stock - item.quantity };
                return p;
            }));
            // DB
            const { data: current } = await supabase.from('products').select('stock').eq('id', item.id).single();
            if (current) {
                await supabase.from('products').update({ stock: current.stock - item.quantity }).eq('id', item.id);
            }
        });
    };

    const updateOrderStatus = async (id: string, status: NonNullable<Sale['shipping']>['status'], trackingNumber?: string) => {
        setSales(prev => prev.map(sale => {
            if (sale.id === id) {
                return {
                    ...sale,
                    shipping: {
                        ...(sale.shipping || {
                            company: '',
                            trackingNumber: '',
                            cost: 0,
                            staffId: '',
                            staffName: '',
                            status: 'Pending'
                        }),
                        status,
                        trackingNumber: trackingNumber ?? (sale.shipping?.trackingNumber || '')
                    }
                };
            }
            return sale;
        }));

        const updates: any = { shipping_status: status };
        if (trackingNumber) updates.tracking_number = trackingNumber;
        await supabase.from('sales').update(updates).eq('id', id);
    };

    const updateOrder = async (id: string, updates: Partial<Sale>) => {
        // 1. Optimistic Local Update
        setSales(prev => prev.map(sale =>
            sale.id === id ? { ...sale, ...updates } : sale
        ));

        // 2. Prepare DB Updates for 'sales' table
        const dbUpdates: any = {};
        if (updates.total !== undefined) dbUpdates.total = updates.total;
        if (updates.discount !== undefined) dbUpdates.discount = updates.discount;
        if (updates.paymentMethod !== undefined) dbUpdates.payment_method = updates.paymentMethod;
        if (updates.salesman !== undefined) dbUpdates.salesman = updates.salesman;
        if (updates.customerCare !== undefined) dbUpdates.customer_care = updates.customerCare;
        if (updates.remark !== undefined) dbUpdates.remark = updates.remark;
        if (updates.amountReceived !== undefined) dbUpdates.amount_received = updates.amountReceived;
        if (updates.settleDate !== undefined) dbUpdates.settle_date = updates.settleDate || null;
        if (updates.paymentStatus !== undefined) dbUpdates.payment_status = updates.paymentStatus;
        if (updates.orderStatus !== undefined) dbUpdates.order_status = updates.orderStatus;
        if (updates.customer !== undefined) dbUpdates.customer_snapshot = updates.customer;

        // Shipping updates need special handling if they are partial, but usually we pass full object or handle in updateOrderStatus
        if (updates.shipping !== undefined) {
            dbUpdates.shipping_company = updates.shipping.company;
            dbUpdates.tracking_number = updates.shipping.trackingNumber;
            dbUpdates.shipping_status = updates.shipping.status;
            dbUpdates.shipping_cost = updates.shipping.cost;
        }

        // 3. Update 'sales' table
        if (Object.keys(dbUpdates).length > 0) {
            const { error } = await supabase.from('sales').update(dbUpdates).eq('id', id);
            if (error) {
                console.error("Error updating sale:", error);
                alert(`Failed to update sale: ${error.message}`);
            }
        }

        // 4. Handle Items Update (Delete Old -> Insert New)
        // Only if 'items' is present in updates
        if (updates.items && updates.items.length > 0) {
            // A. Delete existing items
            const { error: deleteError } = await supabase.from('sale_items').delete().eq('sale_id', id);
            if (deleteError) {
                console.error("Error deleting old items:", deleteError);
                return;
            }

            // B. Insert new items
            const itemsPayload = updates.items.map(item => ({
                sale_id: id,
                product_id: item.id,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                image: item.image
            }));

            const { error: insertError } = await supabase.from('sale_items').insert(itemsPayload);
            if (insertError) {
                console.error("Error inserting new items:", insertError);
                alert(`Failed to update items: ${insertError.message}`);
            }
        }
    };

    const deleteOrders = async (ids: string[]) => {
        setSales(prev => prev.filter(sale => !ids.includes(sale.id)));
        await supabase.from('sales').delete().in('id', ids);
    };

    return (
        <StoreContext.Provider value={{
            products,
            cart,
            sales,
            customers,
            addToCart,
            removeFromCart,
            updateCartQuantity,
            clearCart,
            processSale,
            addProduct,
            updateProduct,
            deleteProduct,
            deleteProducts,
            addOnlineOrder,
            updateOrderStatus,
            updateOrder,
            deleteOrders,
            addCustomer,
            updateCustomer,
            deleteCustomer,
            shippingCompanies: config.shippingCompanies,
            salesmen: config.salesmen,
            categories: config.categories,
            addShippingCompany,
            removeShippingCompany,
            addSalesman,
            removeSalesman,
            addCategory,
            removeCategory,
            pages: config.pages,
            customerCare: config.customerCare,
            addPage,
            removePage,
            addCustomerCare,
            removeCustomerCare,

            paymentMethods: config.paymentMethods,
            addPaymentMethod,
            removePaymentMethod,

            cities: config.cities,
            addCity,
            removeCity,

            pinnedProductIds: config.pinnedProducts || [],
            toggleProductPin,

            pinnedOrderColumns: config.pinnedOrderColumns || [],
            toggleOrderColumnPin,

            updateCart,
            editingOrder,
            setEditingOrder
        }}>
            {children}
        </StoreContext.Provider>
    );
};

export const useStore = () => {
    const context = useContext(StoreContext);
    if (context === undefined) {
        throw new Error('useStore must be used within a StoreProvider');
    }
    return context;
};
