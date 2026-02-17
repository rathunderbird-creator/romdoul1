import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Product, CartItem, Sale, StoreContextType, Customer, User, Role, Permission } from '../types';

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
    salesOrder?: string[]; // Added sales custom order
    users?: User[];
    roles?: Role[];
    storeAddress?: string;
    storeName?: string;
    email?: string;
    phone?: string;
    timezone?: string;
    taxRate?: number;
    currency?: string;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

// Initial Dummy Data


export const StoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [products, setProducts] = useState<Product[]>([]);
    const [sales, setSales] = useState<Sale[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
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
        pinnedOrderColumns: [],
        users: [],
        roles: [],
        storeAddress: '123 Speaker Ave, Audio City',
        storeName: 'JBL Store Main',
        email: 'contact@jblstore.com',
        phone: '+1 (555) 123-4567',
        timezone: 'Asia/Phnom_Penh',
        taxRate: 0,
        currency: 'USD ($)'
    });



    // Authentication
    const [currentUser, setCurrentUser] = useState<User | null>(() => {
        const saved = localStorage.getItem('currentUser');
        return saved ? JSON.parse(saved) : null;
    });

    const login = async (pin: string, userId?: string): Promise<boolean> => {
        // Find user
        console.log('Attempting login with PIN:', pin, 'UserID:', userId);

        let user: User | undefined;

        if (userId) {
            user = (config.users || []).find(u => u.id === userId && u.pin === pin);
        } else {
            user = (config.users || []).find(u => u.pin === pin);
        }

        if (user) {
            console.log('User found:', user);
            setCurrentUser(user);
            localStorage.setItem('currentUser', JSON.stringify(user));
            return true;
        }
        console.log('User not found or PIN incorrect');
        return false;
    };

    const logout = () => {
        setCurrentUser(null);
        localStorage.removeItem('currentUser');
    };

    const hasPermission = (permission: Permission): boolean => {
        if (!currentUser) return false;
        const userRole = (config.roles || []).find(r => r.id === currentUser.roleId);
        if (!userRole) return false;
        // Admin has all permissions implicitly or explicitly
        if (userRole.id === 'admin') return true;
        return userRole.permissions.includes(permission);
    };

    // Initial Fetch
    // Initial Fetch
    // Initial Fetch
    const refreshData = async () => {
        setIsLoading(true);
        try {
            const [productsResult, customersResult, salesResult, configResult] = await Promise.all([
                supabase.from('products').select('*'),
                supabase.from('customers').select('*'),
                supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)').order('date', { ascending: false }).range(0, 9999),
                supabase.from('app_config').select('data').eq('id', 1).single()
            ]);

            console.log('Fetched Sales Count:', salesResult.data?.length);
            if (salesResult.error) console.error('Sales Fetch Error:', salesResult.error);

            // Products
            if (productsResult.data) {
                setProducts(productsResult.data.map((p: any) => ({
                    ...p,
                    lowStockThreshold: p.low_stock_threshold || p.lowStockThreshold || 5,
                    stock: Number(p.stock),
                    price: Number(p.price)
                })));
            }

            // Customers
            if (customersResult.data) setCustomers(customersResult.data);

            // Sales
            if (salesResult.data) {
                // Map DB structure to App structure
                const mappedSales: Sale[] = salesResult.data.map((s: any) => ({
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
                    lastEditedAt: s.last_edited_at,
                    lastEditedBy: s.last_edited_by,
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
                setSales(mappedSales);

                // Apply sort if config is ready (But config is fetched in parallel, so we might need useEffect or dependency)
                // Actually, we can just sort here if accessing configResult directly
                if (configResult.data?.data?.salesOrder) {
                    const orderMap = new Map(configResult.data.data.salesOrder.map((id: string, index: number) => [id, index]));
                    mappedSales.sort((a, b) => {
                        const indexA = orderMap.has(a.id) ? orderMap.get(a.id)! : -1;
                        const indexB = orderMap.has(b.id) ? orderMap.get(b.id)! : -1;

                        // If both have index, sort by index
                        if (indexA !== -1 && indexB !== -1) return (indexA as number) - (indexB as number);

                        // If one has index (it's manually ordered), it goes ? 
                        // Actually, un-ordered items (new ones?) should probably go to top or bottom.
                        // Let's say -1 (not found) means "new" -> Top.

                        if (indexA === -1 && indexB !== -1) return -1; // A is new, A comes first
                        if (indexA !== -1 && indexB === -1) return 1; // B is new, B comes first

                        // If neither has index, sort by date desc (default)
                        return ((new Date(b.date).getTime() || 0) as any) - ((new Date(a.date).getTime() || 0) as any);
                    });
                    setSales(mappedSales);
                }
            }

            // Config
            if (configResult.data) {
                const loadedConfig = configResult.data.data;
                const needsMigration = !loadedConfig.cities ||
                    loadedConfig.cities.length === 0 ||
                    loadedConfig.cities.includes('Phnom Penh') ||
                    !loadedConfig.cities.includes('រាជធានីភ្នំពេញ') ||
                    !loadedConfig.pinnedProducts ||
                    !loadedConfig.users ||
                    !loadedConfig.users.length ||
                    !loadedConfig.roles ||
                    // Force update if Admin role is missing permissions (Repair)
                    !(loadedConfig.roles.find((r: Role) => r.id === 'admin')?.permissions?.includes('view_orders')) ||
                    !(loadedConfig.roles.find((r: Role) => r.id === 'admin')?.permissions?.includes('view_inventory_stock'));

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
                        pinnedOrderColumns: loadedConfig.pinnedOrderColumns || [],
                        salesOrder: loadedConfig.salesOrder || [],
                        users: (loadedConfig.users && loadedConfig.users.length > 0) ? loadedConfig.users : [
                            { id: '1', name: 'Admin', email: 'admin@pos.com', roleId: 'admin', pin: '1234' }
                        ],
                        roles: [
                            // Ensure Admin always has full permissions
                            {
                                id: 'admin',
                                name: 'Administrator',
                                description: 'Full system access',
                                permissions: ['view_dashboard', 'manage_inventory', 'process_sales', 'view_reports', 'manage_settings', 'manage_users', 'manage_orders', 'create_orders', 'view_orders', 'view_inventory_stock'] as any[]
                            },
                            // Merge other roles, preventing duplicates (Reset Store Manager too to enforce new defaults)
                            ...(loadedConfig.roles || []).filter((r: Role) => r.id !== 'admin' && r.id !== 'store_manager')
                        ]
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
                    pinnedOrderColumns: [],
                    salesOrder: [],
                    users: [
                        { id: '1', name: 'Admin', email: 'admin@pos.com', roleId: 'admin', pin: '1234' }
                    ],
                    roles: [
                        {
                            id: 'admin',
                            name: 'Administrator',
                            description: 'Full system access',
                            permissions: ['view_dashboard', 'manage_inventory', 'process_sales', 'view_reports', 'manage_settings', 'manage_users', 'manage_orders', 'create_orders', 'view_orders', 'view_inventory_stock'] as any[]
                        },
                        {
                            id: 'store_manager',
                            name: 'Store Manager',
                            description: 'Manage store operations',
                            permissions: ['view_dashboard', 'process_sales', 'view_reports', 'manage_orders', 'manage_users', 'create_orders', 'view_orders'] as any[]
                        },
                        {
                            id: 'cashier',
                            name: 'Cashier',
                            description: 'Process sales and payments',
                            permissions: ['process_sales', 'view_dashboard', 'create_orders', 'view_orders'] as any[]
                        },
                        {
                            id: 'customer_care',
                            name: 'Customer Care',
                            description: 'Manage support and orders',
                            permissions: ['view_dashboard', 'manage_orders', 'view_orders', 'manage_settings'] as any[]
                        },
                        {
                            id: 'salesman',
                            name: 'Salesman',
                            description: 'Sales and order viewing',
                            permissions: ['process_sales', 'view_dashboard', 'manage_orders', 'view_orders'] as any[]
                        }
                    ],
                    storeAddress: '123 Speaker Ave, Audio City',
                    storeName: 'JBL Store Main',
                    email: 'contact@jblstore.com',
                    phone: '+1 (555) 123-4567',
                    timezone: 'Asia/Phnom_Penh',
                    taxRate: 0,
                    currency: 'USD ($)'
                };
                setConfig(defaultConfig);
                await supabase.from('app_config').upsert({ id: 1, data: defaultConfig });
            }
        } catch (error) {
            console.error("Error fetching data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        refreshData();
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
            quantity: item.quantity
            // image: item.image - Removed to save DB space
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

        // Update salesOrder config
        const currentSalesOrder = config.salesOrder || [];
        updateConfig({ ...config, salesOrder: [newSale.id, ...currentSalesOrder] });
    };

    // Inventory Actions
    const addProduct = async (productData: Omit<Product, 'id'>) => {
        const newProduct: Product = {
            ...productData,
            id: Date.now().toString()
        };
        setProducts(prev => [...prev, newProduct]);

        // Map to DB structure
        const dbProduct = {
            id: newProduct.id,
            name: newProduct.name,
            price: newProduct.price,
            stock: newProduct.stock,
            low_stock_threshold: newProduct.lowStockThreshold,
            image: newProduct.image,
            category: newProduct.category,
            model: newProduct.model
        };
        await supabase.from('products').insert(dbProduct);
    };

    const updateProduct = async (id: string, updates: Partial<Product>) => {
        setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));

        // Map updates to DB structure
        const dbUpdates: any = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.price !== undefined) dbUpdates.price = updates.price;
        if (updates.stock !== undefined) dbUpdates.stock = updates.stock;
        if (updates.lowStockThreshold !== undefined) dbUpdates.low_stock_threshold = updates.lowStockThreshold;
        if (updates.image !== undefined) dbUpdates.image = updates.image;
        if (updates.category !== undefined) dbUpdates.category = updates.category;
        if (updates.model !== undefined) dbUpdates.model = updates.model;

        await supabase.from('products').update(dbUpdates).eq('id', id);
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

    const addOnlineOrder = async (order: Omit<Sale, 'id'>) => {
        const newSale: Sale = {
            ...order,
            id: Date.now().toString(),
            date: order.date || new Date().toISOString()
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
            tracking_number: newSale.shipping?.trackingNumber,
            remark: newSale.remark
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
            quantity: item.quantity
            // image: item.image - Removed to save DB space
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

        // Update salesOrder config
        const currentSalesOrder = config.salesOrder || [];
        updateConfig({ ...config, salesOrder: [newSale.id, ...currentSalesOrder] });
    };

    const updateOrderStatus = async (id: string, status: NonNullable<Sale['shipping']>['status'], trackingNumber?: string) => {
        const now = new Date().toISOString();
        const editorName = currentUser?.name;

        setSales(prev => prev.map(sale => {
            if (sale.id === id) {
                return {
                    ...sale,
                    lastEditedAt: editorName ? now : sale.lastEditedAt,
                    lastEditedBy: editorName ? editorName : sale.lastEditedBy,
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

        if (currentUser) {
            updates.last_edited_at = now;
            updates.last_edited_by = currentUser.name;
        }

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
        if (updates.date !== undefined) dbUpdates.date = updates.date;
        if (updates.paymentMethod !== undefined) dbUpdates.payment_method = updates.paymentMethod;
        if (updates.salesman !== undefined) dbUpdates.salesman = updates.salesman;
        if (updates.customerCare !== undefined) dbUpdates.customer_care = updates.customerCare;
        if (updates.remark !== undefined) dbUpdates.remark = updates.remark;
        if (updates.amountReceived !== undefined) dbUpdates.amount_received = updates.amountReceived;
        if (updates.settleDate !== undefined) dbUpdates.settle_date = updates.settleDate || null;
        if (updates.paymentStatus !== undefined) dbUpdates.payment_status = updates.paymentStatus;
        if (updates.orderStatus !== undefined) dbUpdates.order_status = updates.orderStatus;
        if (updates.customer !== undefined) dbUpdates.customer_snapshot = updates.customer;

        // Add Last Edit Info automatically
        if (currentUser) {
            const now = new Date().toISOString();
            updates.lastEditedAt = now;
            updates.lastEditedBy = currentUser.name;

            dbUpdates.last_edited_at = now;
            dbUpdates.last_edited_by = currentUser.name;
        }

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
        // 1. Restock Items
        const ordersToDelete = sales.filter(s => ids.includes(s.id));

        for (const order of ordersToDelete) {
            // Skip restocking if order status is 'Cancelled' or 'Returned' as stock might have already been handled?
            // Actually, if it's 'Open' or 'Closed' and valid items, we should restock.
            // Let's assume deletion always means "undo this sale". Use with caution.

            for (const item of order.items) {
                // Local Update
                setProducts(prev => prev.map(p => {
                    if (p.id === item.id) return { ...p, stock: p.stock + item.quantity };
                    return p;
                }));

                // DB Update (Increment)
                const { data: current } = await supabase.from('products').select('stock').eq('id', item.id).single();
                if (current) {
                    await supabase.from('products').update({ stock: current.stock + item.quantity }).eq('id', item.id);
                }
            }
        }

        // 2. Optimistic UI update (Remove Order)
        setSales(prev => prev.filter(sale => !ids.includes(sale.id)));

        // 3. Batch deletion to avoid API limits (e.g. URL length or max row count)
        const BATCH_SIZE = 500;
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            const batch = ids.slice(i, i + BATCH_SIZE);
            // Delete items first (Constraint usually cascades, but good practice)
            await supabase.from('sale_items').delete().in('sale_id', batch);

            const { error } = await supabase.from('sales').delete().in('id', batch);
            if (error) {
                console.error(`Error deleting batch ${i}-${i + BATCH_SIZE}:`, error);
                // Optionally alert user, but since we already updated UI, it might be confusing.
                // Best to log and maybe show a toast if possible (but toast is not in context here).
            }
        }
    };

    const reorderRows = (activeIds: string[], overId: string, leadId: string) => {
        setSales((prev) => {
            const moveSet = new Set(activeIds);

            // If target is part of selection, do nothing
            if (moveSet.has(overId)) return prev;

            const itemsToMove: Sale[] = [];
            const remainingItems: Sale[] = [];

            // Get indices from original list to determine direction
            const oldIndex = prev.findIndex(s => s.id === leadId);
            const newIndex = prev.findIndex(s => s.id === overId);

            // Separate items (maintaining relative order)
            prev.forEach(item => {
                if (moveSet.has(item.id)) {
                    itemsToMove.push(item);
                } else {
                    remainingItems.push(item);
                }
            });

            // Find insert position
            let insertIndex = remainingItems.findIndex(s => s.id === overId);

            if (insertIndex === -1) return prev;

            // If dragging down, insert after the target
            if (oldIndex !== -1 && newIndex !== -1 && oldIndex < newIndex) {
                insertIndex++;
            }

            // Insert items
            remainingItems.splice(insertIndex, 0, ...itemsToMove);

            // Update Config
            const newOrderIds = remainingItems.map(s => s.id);
            updateConfig({ ...config, salesOrder: newOrderIds });

            return remainingItems;
        });
    };

    const importProducts = async (newProducts: Omit<Product, 'id'>[]) => {
        // 1. Insert into Supabase
        const { data, error } = await supabase.from('products').insert(newProducts).select();

        if (error) {
            console.error('Error importing products:', error);
            throw new Error('Failed to import products: ' + error.message);
        }

        if (data) {
            // 2. Update Local State
            setProducts(prev => [...prev, ...data]);
        }
    };

    const convertExcelDate = (serial: any) => {
        if (!serial) return null;
        try {
            // If it's a number (Excel serial date), convert it
            if (typeof serial === 'number') {
                const utc_days = Math.floor(serial - 25569);
                const utc_value = utc_days * 86400;
                const date_info = new Date(utc_value * 1000);
                return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate()).toISOString();
            }
            // If it's already a string, try to use it
            const parsed = new Date(serial);
            if (isNaN(parsed.getTime())) return null; // Invalid date
            return parsed.toISOString();
        } catch (e) {
            console.warn("Date parse error for value:", serial, e);
            return null;
        }
    };

    const parseProductsString = (productsStr: string): any[] => {
        if (!productsStr) return [];
        // Split by comma
        return productsStr.split(',').map(itemStr => {
            const trimmed = itemStr.trim();
            // Try to match "Item Name xQuantity" or "Item Name (xQuantity)"
            // Regex explanations:
            // (.*?) - Capture name (lazy)
            // [\s\(]* - Optional space or opening parenthesis
            // [xX*] - The multiplier char
            // (\d+) - Capture quantity digits
            // [\)]* - Optional closing parenthesis
            // $ - End of string
            const match = trimmed.match(/^(.*?)[\s\(]*[xX*](\d+)[\)]*$/);

            if (match) {
                return {
                    name: match[1].trim(),
                    quantity: parseInt(match[2], 10),
                    price: 0 // Price is unknown from simple string import
                };
            } else {
                return {
                    name: trimmed,
                    quantity: 1,
                    price: 0
                };
            }
        }).filter(item => item.name);
    };

    const parseNumber = (value: any): number => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            // Remove currency symbols, commas, spaces
            const cleaned = value.replace(/[^0-9.-]/g, '');
            const parsed = parseFloat(cleaned);
            return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
    };

    const importOrders = async (importedOrders: any[]) => {
        // Prepare arrays for bulk insert
        const salesToInsert: any[] = [];
        const saleItemsToInsert: any[] = [];
        const localSalesMap: Record<string, any[]> = {}; // Map saleId -> items

        importedOrders.forEach(order => {
            // Skip header row if it somehow got included (check if 'Total' is 'Total' string)
            if (order['Total'] === 'Total' || order['Received'] === 'Received') return;

            const id = order['Order ID'] || crypto.randomUUID();
            const productsStr = order['Products'] || order['Items'] || '';
            const items = parseProductsString(productsStr);

            const total = parseNumber(order['Total'] || order['Total Amount']);
            // Determine amount received
            let amountReceived = 0;
            if (order['Received'] !== undefined) {
                amountReceived = parseNumber(order['Received']);
            } else if (order['Pay Status'] === 'Paid' || order['Pay Status'] === 'Settled' || order['Payment Status'] === 'Paid') {
                amountReceived = total;
            }

            // Prepare Sale Record
            salesToInsert.push({
                id: id,
                date: convertExcelDate(order['Date']) || new Date().toISOString(),
                customer_snapshot: {
                    name: order['Customer'] || 'Unknown',
                    phone: order['Phone'] || '',
                    address: order['Address'] || '',
                    city: order['City / Province'] || '',
                    page: order['Page Name'] || '',
                    platform: order['Platform'] || 'Facebook'
                },
                total: total,
                payment_method: order['Pay By'] || order['Payment Method'] || 'Cash',
                payment_status: order['Pay Status'] || order['Payment Status'] || 'Unpaid',
                order_status: 'Closed',
                salesman: order['Salesman'] || '',
                customer_care: order['Customer Care'] || '',
                amount_received: amountReceived,
                settle_date: convertExcelDate(order['Settled/Paid Date']) || ((order['Pay Status'] === 'Paid' || order['Pay Status'] === 'Settled') ? new Date().toISOString() : null),
                remark: order['Remark'] || order['Remarks'] || (items.length === 0 ? 'Imported Order' : ''),
                type: 'POS',
                shipping_company: order['Shipping Co'] || order['Shipping Company'] || '',
                tracking_number: order['Tracking ID'] || order['Tracking Number'] || '',
                shipping_status: order['Ship Status'] || order['Shipping Status'] || 'Pending',
            });

            // Prepare Sale Items Records
            items.forEach(item => {
                const itemId = crypto.randomUUID();
                saleItemsToInsert.push({
                    id: itemId,
                    sale_id: id,
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    // Product ID is unknown, maybe link if name matches? For now leave null or dummy
                    product_id: null
                });

                // For local state
                if (!localSalesMap[id]) localSalesMap[id] = [];
                localSalesMap[id].push({ ...item, id: itemId });
            });
        });

        // 1. Insert Sales
        const { data: insertedSales, error: salesError } = await supabase.from('sales').insert(salesToInsert).select();

        if (salesError) {
            console.error('Error importing orders:', salesError);
            throw new Error('Failed to import orders: ' + salesError.message);
        }

        // 2. Insert Sale Items (if any)
        if (saleItemsToInsert.length > 0) {
            const { error: itemsError } = await supabase.from('sale_items').insert(saleItemsToInsert);
            if (itemsError) {
                console.error('Error importing sale items:', itemsError);
                // Note: Sales were already inserted. We might want to warn user but simpler to throw
                throw new Error('Failed to import order items: ' + itemsError.message);
            }
        }

        // 3. Update Local State
        if (insertedSales) {
            const newSales: Sale[] = insertedSales.map(s => ({
                id: s.id,
                total: Number(s.total),
                discount: 0,
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
                customer: s.customer_snapshot,
                items: localSalesMap[s.id] || [],
                shipping: {
                    company: s.shipping_company || '',
                    trackingNumber: s.tracking_number || '',
                    status: s.shipping_status as any || 'Pending',
                    cost: s.shipping_cost || 0
                }
            }));
            setSales(prev => [...newSales, ...prev]);
        }
    };

    const restockOrder = async (orderId: string) => {
        const order = sales.find(s => s.id === orderId);
        if (!order) return;

        // Sync Stock: Increment for each item
        order.items.forEach(async (item) => {
            // Local Update
            setProducts(prev => prev.map(p => {
                if (p.id === item.id) return { ...p, stock: p.stock + item.quantity };
                return p;
            }));

            // DB Update (Increment)
            const { data: current } = await supabase.from('products').select('stock').eq('id', item.id).single();
            if (current) {
                await supabase.from('products').update({ stock: current.stock + item.quantity }).eq('id', item.id);
            }
        });
    };

    const backupData = async () => {
        const data = {
            timestamp: new Date().toISOString(),
            products,
            sales,
            customers,
            users: config.users || [],
            roles: config.roles || [],
            config: {
                shippingCompanies: config.shippingCompanies,
                salesmen: config.salesmen,
                categories: config.categories,
                pages: config.pages,
                customerCare: config.customerCare,
                paymentMethods: config.paymentMethods,
                cities: config.cities,
                storeName: config.storeName,
                storeAddress: config.storeAddress,
                email: config.email,
                phone: config.phone
            }
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const restoreData = async (jsonData: any) => {
        setIsLoading(true);
        try {
            // 1. Validate (Simple check)
            if (!jsonData.products || !jsonData.sales || !jsonData.customers) {
                throw new Error("Invalid backup file format");
            }

            // 2. Restore Products
            if (jsonData.products.length > 0) {
                const { error } = await supabase.from('products').upsert(jsonData.products);
                if (error) throw new Error("Failed to restore products: " + error.message);
            }

            // 3. Restore Customers
            if (jsonData.customers.length > 0) {
                const { error } = await supabase.from('customers').upsert(jsonData.customers);
                if (error) throw new Error("Failed to restore customers: " + error.message);
            }

            // 4. Restore Sales
            if (jsonData.sales.length > 0) {
                // We need to map back to DB structure for sales
                const dbSales = jsonData.sales.map((s: Sale) => ({
                    id: s.id,
                    total: s.total,
                    discount: s.discount,
                    date: s.date,
                    payment_method: s.paymentMethod,
                    type: s.type,
                    salesman: s.salesman,
                    customer_care: s.customerCare,
                    remark: s.remark,
                    amount_received: s.amountReceived,
                    settle_date: s.settleDate,
                    payment_status: s.paymentStatus,
                    order_status: s.orderStatus,
                    shipping_company: s.shipping?.company,
                    tracking_number: s.shipping?.trackingNumber,
                    shipping_status: s.shipping?.status,
                    shipping_cost: s.shipping?.cost,
                    customer_snapshot: s.customer
                }));
                const { error: salesError } = await supabase.from('sales').upsert(dbSales);
                if (salesError) throw new Error("Failed to restore sales: " + salesError.message);

                // Restore Sale Items
                // We need to flatten all items from all sales
                const allItems: any[] = [];
                jsonData.sales.forEach((s: Sale) => {
                    if (s.items) {
                        s.items.forEach(item => {
                            allItems.push({
                                id: crypto.randomUUID(), // Generate new ID or use item.id if available (CartItem might not have unique ID in backup if not from DB)
                                sale_id: s.id,
                                product_id: item.id, // This is product ID
                                name: item.name,
                                price: item.price,
                                quantity: item.quantity,
                                image: item.image
                            });
                        });
                    }
                });

                if (allItems.length > 0) {
                    // Delete existing items for these sales to avoid duplicates?
                    // Actually upsert might be tricky without ID.
                    // For safety, let's delete items for these sales first
                    const saleIds = jsonData.sales.map((s: Sale) => s.id);
                    await supabase.from('sale_items').delete().in('sale_id', saleIds);

                    const { error: itemsError } = await supabase.from('sale_items').insert(allItems);
                    if (itemsError) throw new Error("Failed to restore sale items: " + itemsError.message);
                }
            }

            // 5. Restore Config
            if (jsonData.config) {
                // Upsert config to ID 1
                const { error } = await supabase.from('app_config').upsert({
                    id: 1,
                    data: {
                        shippingCompanies: jsonData.config.shippingCompanies,
                        salesmen: jsonData.config.salesmen,
                        categories: jsonData.config.categories,
                        pages: jsonData.config.pages,
                        customerCare: jsonData.config.customerCare,
                        paymentMethods: jsonData.config.paymentMethods,
                        cities: jsonData.config.cities,
                        users: jsonData.users,
                        roles: jsonData.roles,
                        storeName: jsonData.config.storeName,
                        storeAddress: jsonData.config.storeAddress,
                        email: jsonData.config.email,
                        phone: jsonData.config.phone
                    }
                });
                if (error) throw new Error("Failed to restore config: " + error.message);
            }

            alert("Restore completed successfully! Page will reload.");
            window.location.reload();

        } catch (e: any) {
            console.error("Restore failed:", e);
            alert("Restore failed: " + e.message);
        } finally {
            setIsLoading(false);
        }
    };

    // User & Role Management
    const addUser = async (userData: Omit<User, 'id'>) => {
        const newUser: User = { ...userData, id: Date.now().toString() };
        const newUsers = [...(config.users || []), newUser];
        updateConfig({ ...config, users: newUsers });
    };

    const updateUser = async (id: string, updates: Partial<User>) => {
        const newUsers = (config.users || []).map(u => u.id === id ? { ...u, ...updates } : u);
        updateConfig({ ...config, users: newUsers });
    };

    const deleteUser = async (id: string) => {
        const newUsers = (config.users || []).filter(u => u.id !== id);
        updateConfig({ ...config, users: newUsers });
    };

    const addRole = async (roleData: Omit<Role, 'id'>) => {
        const newRole: Role = { ...roleData, id: Date.now().toString() };
        const newRoles = [...(config.roles || []), newRole];
        updateConfig({ ...config, roles: newRoles });
    };

    const updateRole = async (id: string, updates: Partial<Role>) => {
        const newRoles = (config.roles || []).map(r => r.id === id ? { ...r, ...updates } : r);
        updateConfig({ ...config, roles: newRoles });
    };

    const deleteRole = async (id: string) => {
        const newRoles = (config.roles || []).filter(r => r.id !== id);
        updateConfig({ ...config, roles: newRoles });
    };

    const updateStoreAddress = async (address: string) => {
        updateConfig({ ...config, storeAddress: address });
    };

    const updateStoreProfile = async (data: { storeName?: string; email?: string; phone?: string; storeAddress?: string; timezone?: string; taxRate?: number; currency?: string }) => {
        updateConfig({ ...config, ...data });
    };

    // Timezone
    const updateTimezone = async (timezone: string) => {
        updateConfig({ ...config, timezone });
    };

    const updateTaxRate = async (taxRate: number) => {
        updateConfig({ ...config, taxRate });
    };

    const updateCurrency = async (currency: string) => {
        updateConfig({ ...config, currency });
    };

    // Authentication logic moved to top

    return (
        <StoreContext.Provider value={{
            products,
            cart,
            sales,
            customers,
            users: config.users || [],
            roles: config.roles || [],
            addUser,
            updateUser,
            deleteUser,
            addRole,
            updateRole,
            deleteRole,
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
            reorderRows,
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
            addPage,
            removePage,
            pages: config.pages,
            customerCare: config.customerCare,
            addCustomerCare,
            removeCustomerCare,
            cities: config.cities,
            addCity,
            removeCity,
            paymentMethods: config.paymentMethods,
            addPaymentMethod,
            removePaymentMethod,
            editingOrder,
            setEditingOrder,
            pinnedProductIds: config.pinnedProducts || [],
            toggleProductPin,
            pinnedOrderColumns: config.pinnedOrderColumns || [],
            toggleOrderColumnPin,
            updateCart,
            importProducts,
            importOrders,
            restockOrder,
            backupData,
            restoreData,
            // Authentication
            currentUser,
            login,
            logout,
            hasPermission,
            isLoading,
            storeAddress: config.storeAddress || '',
            storeName: config.storeName || '',
            email: config.email || '',
            phone: config.phone || '',
            updateStoreAddress,
            updateStoreProfile,
            timezone: config.timezone || 'Asia/Phnom_Penh',
            updateTimezone,
            taxRate: config.taxRate || 0,
            updateTaxRate,
            currency: config.currency || 'USD ($)',
            updateCurrency,
            refreshData
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
