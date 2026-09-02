import { createContext, useContext, useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { mapSaleEntity } from '../utils/mapper';
import { dispatchActivity } from '../utils/activityLogger';
import { ALL_PERMISSIONS } from '../types';
import type {
    Product, 
    CartItem, 
    Sale, 
    StoreContextType, 
    Customer, 
    User, 
    Role, 
    Permission, 
    Restock, 
    Transaction, 
    TelegramConfig, 
    BlockedCustomer,
    Warehouse,
    WarehouseStock
} from '../types';

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
    productOrder?: string[]; // Custom order for the All Stock inventory table
    shippingRates?: Record<string, number>; // Cost per item for each shipping company
    users?: User[];
    roles?: Role[];
    storeAddress?: string;
    storeName?: string;
    email?: string;
    phone?: string;
    timezone?: string;
    taxRate?: number;
    currency?: string;
    khrExchangeRate?: number;
    logo?: string;
    telegramBotToken?: string;
    telegramChatId?: string;
    telegramConfigs?: TelegramConfig[];
    blockedCustomers?: BlockedCustomer[];
}
const generateUUID = () => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }
    // Fallback using Math.random for insecure environments (like local HTTP)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

const getLocalYYYYMMDD = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

// Digits-only phone comparison: blocklist entries and order snapshots carry
// mixed formats ('012 345 678', '+855 12…', Excel imports without the leading
// zero), so an exact-string match let blocked customers slip through.
export const normalizePhone = (v: any): string => String(v ?? '').replace(/\D/g, '');

// True only for "the function does not exist" (migration not applied yet) —
// network blips and server errors must NOT be treated as a missing migration.
export const isRpcMissingError = (err: any): boolean => {
    const code = String(err?.code || '');
    const msg = String(err?.message || '');
    return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(msg);
};

// Local calendar day of a stored date value: plain YYYY-MM-DD strings pass
// through; ISO timestamps convert to the LOCAL day (a settle stamped between
// midnight and 07:00 local lives on the previous UTC day, so comparing raw
// ISO slices would miss a genuine one-day correction).
const localDayOf = (v: string | null | undefined): string => {
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    if (isNaN(d.getTime())) return v.slice(0, 10);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

// Stock leaves the building at 'Shipped', and only then. Delivery is a later
// confirmation of the same physical movement, so it must not deduct again or rewrite
// the original stock-out record — the goods are counted out exactly once.
const countsAsStockOut = (status: string) => status === 'Shipped';

// Statuses where the stock is already gone. Used to decide whether stock should be
// put back: moving Shipped -> Delivered stays "consumed", so nothing is restored.
const isStockConsumed = (status: string) => ['Shipped', 'Delivered'].includes(status);

// Statuses that only make sense once the goods have physically left: you cannot deliver
// or receive a return for something that was never shipped.
//
// Both also drive stock accounting on delete — deleteOrders restocks Shipped/Delivered/
// Returned orders — so an order reaching 'Returned' straight from 'Pending' would credit
// stock on deletion that was never deducted in the first place.
const POST_DISPATCH_STATUSES = ['Delivered', 'Returned'];

// 'Shipped' is the valid predecessor for both. 'Returned' may additionally be entered
// from 'Delivered' — a customer can return goods after receiving them (and it's also
// the correction path when Delivered was picked by mistake). Stock stays consistent:
// both states have stock counted out, and restocking only happens via the Restock
// button. 'Delivered' itself remains reachable only from 'Shipped'.
const canEnterPostDispatch = (currentStatus: string, targetStatus?: string) =>
    currentStatus === 'Shipped' || (targetStatus === 'Returned' && currentStatus === 'Delivered');

const POST_DISPATCH_BLOCKED_MESSAGE = (currentStatus: string, targetStatus: string) =>
    `This order is "${currentStatus}" and cannot be marked ${targetStatus} directly.\n\n` +
    `Stock is counted out when an order is Shipped, so skipping that step would leave ` +
    `inventory unchanged — and deleting the order later would add stock back that was ` +
    `never taken.\n\n` +
    `Set the order back to Drafted, then move it through Confirmed → Shipped.`;

const StoreContext = createContext<StoreContextType | undefined>(undefined);

// Initial Dummy Data


export const StoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [products, setProducts] = useState<Product[]>([]);
    const [sales, setSales] = useState<Sale[]>([]);
    const [restocks, setRestocks] = useState<Restock[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [users, setUsers] = useState<User[]>([]); // Added users state
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [warehouseStock, setWarehouseStock] = useState<WarehouseStock[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMoreOrders, setHasMoreOrders] = useState(true);
    const [productsUpdatedAt, setProductsUpdatedAt] = useState<number>(Date.now());
    const [salesUpdatedAt, setSalesUpdatedAt] = useState<number>(Date.now());
    const [pinnedOrderColumns, setPinnedOrderColumns] = useState<string[]>([]);
    const [config, setConfig] = useState<ConfigState>({
        shippingCompanies: ['J&T', 'VET', 'JS Express', 'D2D'],
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
        currency: 'USD ($)',
        khrExchangeRate: 4100,
        logo: '',
        telegramBotToken: '',
        telegramChatId: '',
        telegramConfigs: []
    });



    // Authentication
    const [currentUser, setCurrentUser] = useState<User | null>(() => {
        // Guarded: a corrupt localStorage value must not crash-loop the whole
        // app at the very first render (the error boundary's only offer is
        // Reload, which would just re-parse the same bad value forever).
        try {
            const saved = localStorage.getItem('currentUser');
            return saved ? JSON.parse(saved) : null;
        } catch {
            localStorage.removeItem('currentUser');
            return null;
        }
    });
    // Live view of the session for async completions: a refresh that was
    // in flight across a logout/user switch must not act on the old session.
    const currentUserRef = useRef(currentUser);
    currentUserRef.current = currentUser;

    const login = async (pin: string, userId?: string): Promise<boolean> => {
        const safePin = String(pin).trim();
        if (!safePin) return false;

        let user: User | undefined;

        // Server-side verification (check_pin, SECURITY DEFINER): the PIN is
        // compared in the database and never needs to exist in the browser.
        const { data: matched, error: rpcError } = await supabase.rpc('check_pin', {
            p_pin: safePin,
            p_user_id: userId || null
        });
        if (!rpcError) {
            const row = Array.isArray(matched) ? matched[0] : matched;
            if (row) {
                const known = users.find(u => u.id === row.id);
                user = {
                    ...(known || {}),
                    id: row.id,
                    name: row.name,
                    email: row.email,
                    roleId: row.role_id
                } as User;
            }
        } else if (isRpcMissingError(rpcError)) {
            // secure_pin_check.sql not applied yet: fall back to the legacy
            // client-side comparison via a one-off read. This path dies the
            // moment the migration runs (the pin column read is then rejected
            // and the RPC exists).
            console.warn('check_pin RPC unavailable, using legacy login:', rpcError.message);
            const { data: legacyUsers } = await supabase.from('users').select('id, name, email, role_id, pin');
            const hit = (legacyUsers || []).find((u: any) =>
                String(u.pin || '').trim() === safePin && (!userId || u.id === userId)
            );
            if (hit) {
                user = { id: hit.id, name: hit.name, email: hit.email, roleId: hit.role_id } as User;
            }
        } else {
            // A real failure (network blip, server error) — never report it as a
            // wrong password. The Login page's catch shows its own message.
            console.error('check_pin failed:', rpcError);
            throw new Error('Could not verify password — check the connection and try again');
        }

        if (user) {
            // Note: the stored snapshot never contains the PIN.
            setCurrentUser(user);
            localStorage.setItem('currentUser', JSON.stringify(user));
            dispatchActivity({ action: 'user_login', description: `${user.name} logged in`, userId: user.id, userName: user.name });
            return true;
        }
        return false;
    };

    const logout = () => {
        setCurrentUser(null);
        localStorage.removeItem('currentUser');
    };

    const hasPermission = (permission: Permission): boolean => {
        if (!currentUser) {
            // console.warn(`hasPermission check failed for ${permission}: No currentUser`);
            return false;
        }
        // Optimization: Admin always has full permissions, check roleId directly first
        if (currentUser.roleId === 'admin') return true;

        const userRole = (config.roles || []).find(r => r.id === currentUser.roleId);
        if (!userRole) {
            // console.warn(`hasPermission check failed for ${permission}: Role ${currentUser.roleId} not found in config`);
            return false;
        }

        // Redundant safely check inside role (though optimization above catches it)
        if (userRole.id === 'admin') return true;
        
        const hasPerm = userRole.permissions.includes(permission);
        if (!hasPerm && (permission === 'create_orders' || permission === 'manage_orders' || permission === 'process_sales')) {
            console.warn(`hasPermission check failed for ${permission}: Role ${userRole.name} does not have it. Current permissions:`, userRole.permissions);
        }
        return hasPerm;
    };

    const loadMoreOrders = async () => {
        if (isLoadingMore || !hasMoreOrders) return;
        setIsLoadingMore(true);
        try {
            const currentCount = sales.length;
            const { data, error } = await supabase
                .from('sales')
                .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                .order('date', { ascending: false })
                .range(currentCount, currentCount + 49);

            if (error) throw error;
            if (data && data.length > 0) {
                const mappedSales = data.map(mapSaleEntity);
                setSales(prev => {
                    // Prevent duplicates just in case
                    const existingIds = new Set(prev.map(s => s.id));
                    const newUniqueSales = mappedSales.filter(s => !existingIds.has(s.id));
                    return [...prev, ...newUniqueSales];
                });
                if (data.length < 50) {
                    setHasMoreOrders(false);
                }
            } else {
                setHasMoreOrders(false);
            }
        } catch (e) {
            console.error('Failed to load more orders:', e);
        } finally {
            setIsLoadingMore(false);
        }
    };

    // Initial Fetch
    const refreshData = async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const fetchAllSales = async () => {
                const { data, error } = await supabase
                    .from('sales')
                    .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                    .order('date', { ascending: false })
                    .limit(50);

                return { data: data || [], error };
            };

            // Fetch core data.
            const [productsResult, customersResult, salesResult, configResult, usersResult, restocksResult, transactionsResult, telegramConfigsResult, warehousesResult, warehouseStockResult] = await Promise.all([
                supabase.from('products').select('id, name, model, sku, price, purchase_cost, stock, category, low_stock_threshold, image, invoice_number, supplier, created_at, is_active').order('created_at', { ascending: false }),
                // Select all customer detail fields, not just id/name/phone: the checkout
                // form saves email/address/city/platform/page, and a narrower select would
                // silently drop them from the in-memory store on every reload.
                supabase.from('customers').select('id, name, phone, email, address, city, platform, page'),
                fetchAllSales(),
                supabase.from('app_config').select('data').eq('id', 1).single(),
                // Explicit columns — never the pin. PINs are verified server-side
                // (check_pin RPC) and must not be downloaded to the browser.
                supabase.from('users').select('id, name, email, role_id, created_at, base_salary, daily_target, weekly_target, monthly_target'),
                supabase.from('restocks').select('*').order('date', { ascending: false }).limit(50),
                supabase.from('transactions').select('*').order('date', { ascending: false }).limit(50),
                supabase.from('telegram_notifications').select('*'),
                supabase.from('warehouses').select('*').order('created_at', { ascending: true }),
                supabase.from('warehouse_stock').select('*')
            ]);

            // Surface fetch failures. PostgREST reports these on `.error` instead of
            // throwing, so they never reach the catch below — and because each block
            // below is guarded by `if (result.data)`, a failed query silently leaves
            // its list empty. A single unknown column drops the whole table this way.
            const fetchResults: Array<[string, { error: unknown }]> = [
                ['products', productsResult],
                ['customers', customersResult],
                ['sales', salesResult],
                ['app_config', configResult],
                ['users', usersResult],
                ['restocks', restocksResult],
                ['transactions', transactionsResult],
                ['telegram_notifications', telegramConfigsResult],
                ['warehouses', warehousesResult],
                ['warehouse_stock', warehouseStockResult],
            ];
            for (const [table, result] of fetchResults) {
                if (result.error) {
                    const message = (result.error as { message?: string }).message ?? result.error;
                    console.error(`Failed to fetch "${table}":`, message);
                }
            }

            // Products
            if (productsResult.data) {
                setProducts(productsResult.data
                    .filter((p: any) => p.is_active !== false)
                    .map((p: any) => ({
                    ...p,
                    isActive: p.is_active ?? true,
                    lowStockThreshold: p.low_stock_threshold || p.lowStockThreshold || 5,
                    stock: Number(p.stock),
                    price: Number(p.price),
                    purchaseCost: Number(p.purchase_cost || 0),
                    sku: p.sku || '',
                    invoiceNumber: p.invoice_number,
                    supplier: p.supplier,
                    createdAt: p.created_at
                })));
            }

            // Warehouses
            if (warehousesResult.data) {
                setWarehouses(warehousesResult.data.map((w: any) => ({
                    ...w,
                    createdAt: w.created_at,
                    updatedAt: w.updated_at
                })));
            }

            if (warehouseStockResult.data) {
                setWarehouseStock(warehouseStockResult.data.map((ws: any) => ({
                    ...ws,
                    warehouseId: ws.warehouse_id,
                    productId: ws.product_id,
                    createdAt: ws.created_at,
                    updatedAt: ws.updated_at
                })));
            }

            // Customers
            if (customersResult.data) setCustomers(customersResult.data);

            // Sales
            if (salesResult.data) {
                // Map DB structure to App structure
                const mappedSales: Sale[] = salesResult.data.map(mapSaleEntity);
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
                setHasMoreOrders(mappedSales.length >= 50);
            }

            // Restocks
            if (restocksResult.data) {
                setRestocks(restocksResult.data.map((r: any) => ({
                    id: r.id,
                    productId: r.product_id,
                    quantity: Number(r.quantity),
                    cost: Number(r.cost),
                    date: r.date,
                    addedBy: r.added_by,
                    note: r.note
                })));
            }

            // Transactions
            if (transactionsResult && transactionsResult.data) {
                setTransactions(transactionsResult.data);
            }

            // Users (PINs deliberately never leave the database — see login()).
            if (usersResult.data) {
                setUsers(usersResult.data.map((u: any) => ({
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    roleId: u.role_id, // Map snake_case to camelCase
                    baseSalary: Number(u.base_salary) || 0,
                    dailyTarget: Number(u.daily_target) || 0,
                    weeklyTarget: Number(u.weekly_target) || 0,
                    monthlyTarget: Number(u.monthly_target) || 0
                })));

                // Revalidate the persisted session against the fresh users table:
                // a deleted account is logged out; a renamed or demoted/promoted
                // one gets its fresh role immediately instead of keeping the old
                // localStorage snapshot's access forever. Only runs when the
                // users fetch succeeded, so a network blip can't log anyone out.
                // Reads the LIVE session (ref, not this closure) so a refresh
                // spanning a logout or user switch acts on the current user.
                const liveUser = currentUserRef.current;
                if (liveUser) {
                    const freshSelf = usersResult.data.find((u: any) => u.id === liveUser.id);
                    if (!freshSelf) {
                        setCurrentUser(null);
                        localStorage.removeItem('currentUser');
                    } else if (
                        freshSelf.role_id !== liveUser.roleId ||
                        freshSelf.name !== liveUser.name ||
                        (freshSelf.email || '') !== (liveUser.email || '')
                    ) {
                        const updatedSelf = { ...liveUser, roleId: freshSelf.role_id, name: freshSelf.name, email: freshSelf.email };
                        setCurrentUser(updatedSelf);
                        localStorage.setItem('currentUser', JSON.stringify(updatedSelf));
                    }
                }
            }

            // Config
            if (configResult.error) {
                console.error('Config fetch error:', configResult.error);
                if (configResult.error.code === 'PGRST116') {
                    // Initial if no config found in DB
                    const defaultConfig = {
                        shippingCompanies: ['J&T', 'VET', 'JS Express', 'D2D'],
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
                                permissions: ['view_dashboard', 'manage_inventory', 'process_sales', 'view_reports', 'manage_settings', 'manage_users', 'manage_orders', 'create_orders', 'view_orders', 'view_inventory_stock', 'manage_income_expense', 'manage_attendance'] as any[]
                            },
                            {
                                id: 'accountant',
                                name: 'Accountant',
                                description: 'Manage finances and records',
                                permissions: ['view_dashboard', 'view_reports', 'manage_income_expense', 'view_orders'] as any[]
                            },
                            {
                                id: 'store_manager',
                                name: 'Store Manager',
                                description: 'Manage store operations',
                                permissions: ['view_dashboard', 'process_sales', 'view_reports', 'manage_orders', 'manage_users', 'create_orders', 'view_orders', 'manage_attendance'] as any[]
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
                                permissions: ['view_dashboard', 'manage_orders', 'view_orders', 'manage_settings', 'create_orders', 'process_sales'] as any[]
                            },
                            {
                                id: 'salesman',
                                name: 'Salesman',
                                description: 'Sales and order viewing',
                                permissions: ['process_sales', 'view_dashboard', 'manage_orders', 'view_orders', 'create_orders'] as any[]
                            }
                        ],
                        storeAddress: '123 Speaker Ave, Audio City',
                        storeName: 'JBL Store Main',
                        email: 'contact@jblstore.com',
                        phone: '+1 (555) 123-4567',
                        timezone: 'Asia/Phnom_Penh',
                        taxRate: 0,
                        currency: 'USD ($)',
                        telegramBotToken: '',
                        telegramChatId: '',
                        telegramConfigs: []
                    };
                    setConfig(defaultConfig);
                    await supabase.from('app_config').insert({ id: 1, data: defaultConfig });
                }
                // If it's another error (e.g. network), do nothing to DB, retain current state fallback
            } else if (configResult.data) {
                const loadedConfig = configResult.data.data;
                
                // Inject telegram configs from their own table
                if (telegramConfigsResult?.data) {
                    loadedConfig.telegramConfigs = telegramConfigsResult.data.map((tc: any) => ({
                        id: tc.id,
                        name: tc.name,
                        botToken: tc.bot_token,
                        chatId: tc.chat_id,
                        triggerStatuses: tc.trigger_statuses || [],
                        messageTemplate: tc.message_template || '',
                        note: tc.note || ''
                    }));
                }

                const needsMigration = !loadedConfig.cities ||
                    loadedConfig.cities.length === 0 ||
                    loadedConfig.cities.includes('Phnom Penh') ||
                    !loadedConfig.cities.includes('រាជធានីភ្នំពេញ') ||
                    !loadedConfig.pinnedProducts ||
                    !loadedConfig.roles ||
                    !(loadedConfig.roles.find((r: Role) => r.id === 'admin')?.permissions?.includes('view_orders')) ||
                    !(loadedConfig.roles.find((r: Role) => r.id === 'admin')?.permissions?.includes('view_inventory_stock')) ||
                    !(loadedConfig.roles.find((r: Role) => r.id === 'admin')?.permissions?.includes('manage_attendance')) ||
                    !loadedConfig.shippingCompanies?.includes('D2D');

                if (needsMigration) {
                    // Re-inject missing cities, but PRESERVE all existing custom roles or custom permissions
                    // Only update the Admin role to ensure it never loses access
                    const updatedRoles = (loadedConfig.roles || []).map((r: Role) => {
                        if (r.id === 'admin') {
                            return {
                                ...r,
                                permissions: Array.from(new Set([
                                    ...r.permissions, 
                                    'view_dashboard', 'manage_inventory', 'process_sales', 'view_reports', 'manage_settings', 'manage_users', 'manage_orders', 'create_orders', 'view_orders', 'view_inventory_stock', 'manage_income_expense', 'manage_attendance', 'manage_payroll'
                                ]))
                            };
                        }
                        return r;
                    });

                    // Add base roles only if they completely don't exist yet
                    const baseRoles = [
                        { id: 'admin', name: 'Administrator', description: 'Full system access', permissions: ['view_dashboard', 'manage_inventory', 'process_sales', 'view_reports', 'manage_settings', 'manage_users', 'manage_orders', 'create_orders', 'view_orders', 'view_inventory_stock', 'manage_income_expense', 'manage_attendance', 'manage_payroll'] },
                        { id: 'accountant', name: 'Accountant', description: 'Manage finances and records', permissions: ['view_dashboard', 'view_reports', 'manage_income_expense', 'view_orders'] },
                        { id: 'store_manager', name: 'Store Manager', description: 'Manage store operations', permissions: ['view_dashboard', 'process_sales', 'view_reports', 'manage_orders', 'manage_users', 'create_orders', 'view_orders', 'manage_attendance'] },
                        { id: 'salesman', name: 'Salesman', description: 'Sales and order viewing', permissions: ['process_sales', 'view_dashboard', 'manage_orders', 'view_orders', 'create_orders'] },
                        { id: 'cashier', name: 'Cashier', description: 'Process sales and payments', permissions: ['process_sales', 'view_dashboard', 'create_orders', 'view_orders'] },
                        { id: 'customer_care', name: 'Customer Care', description: 'Manage support and orders', permissions: ['view_dashboard', 'manage_orders', 'view_orders', 'manage_settings', 'create_orders', 'process_sales'] }
                    ];

                    baseRoles.forEach(br => {
                        if (!updatedRoles.find((ur: Role) => ur.id === br.id)) {
                            updatedRoles.push(br as any);
                        }
                    });

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
                        productOrder: loadedConfig.productOrder || [],
                        shippingCompanies: loadedConfig.shippingCompanies?.includes('D2D') 
                            ? loadedConfig.shippingCompanies 
                            : [...(loadedConfig.shippingCompanies || []), 'D2D'],
                        roles: updatedRoles
                    };
                    setConfig(updatedConfig);
                    await supabase.from('app_config').upsert({ id: 1, data: updatedConfig });
                } else {
                    setConfig(loadedConfig);
                }
            }
        } catch (error) {
            console.error("Error fetching data:", error);
        } finally {
            if (!silent) setIsLoading(false);
        }
    };

    useEffect(() => {
        refreshData();
    }, []);

    const customerCare = useMemo(() => {
        const userNames = users
            .filter(u => u.roleId === 'customer_care' || u.roleId === 'admin')
            .map(u => u.name);
        return Array.from(new Set([...userNames, ...(config.customerCare || [])])).filter(Boolean);
    }, [users, config.customerCare]);

    // Sync Config to DB
    const updateConfig = async (newConfig: ConfigState) => {
        setConfig(newConfig);
        const { error } = await supabase.from('app_config').upsert({ id: 1, data: newConfig });
        if (error) {
            console.error('Failed to update config in Supabase:', error);
            throw new Error('Failed to update configuration: ' + error.message);
        }
    };

    // Prepend a new order id to config.salesOrder WITHOUT clobbering the rest
    // of the config. Order creation used to upsert the entire in-memory blob,
    // so a terminal holding a stale config (roles, blocklist, settings edited
    // on another machine) silently reverted those edits with every new order.
    // Read-merge-write scopes the change to salesOrder alone.
    const prependToSalesOrder = async (saleId: string) => {
        setConfig(prev => ({ ...prev, salesOrder: [saleId, ...(prev.salesOrder || [])] }));
        try {
            const { data: cfgRow, error: readErr } = await supabase.from('app_config').select('data').eq('id', 1).single();
            // NEVER write after a failed/empty read: merging into {} would
            // replace the whole config blob with just salesOrder, destroying
            // roles, the scammer blocklist, shipping settings, everything.
            // The manual row position for one order is not worth that risk.
            if (readErr || !cfgRow?.data || typeof cfgRow.data !== 'object') {
                console.error('Skipped persisting sales order position (config read failed):', readErr?.message || 'no config data');
                return;
            }
            const freshData = cfgRow.data as any;
            const merged = { ...freshData, salesOrder: [saleId, ...(freshData.salesOrder || [])] };
            const { error } = await supabase.from('app_config').upsert({ id: 1, data: merged });
            if (error) console.error('Failed to persist sales order position:', error);
        } catch (e) {
            console.error('Failed to persist sales order position:', e);
        }
    };

    const addShippingCompany = (name: string) => {
        if (!config.shippingCompanies.includes(name)) {
            updateConfig({ ...config, shippingCompanies: [...config.shippingCompanies, name] });
        }
    };

    const removeShippingCompany = (name: string) => {
        updateConfig({ ...config, shippingCompanies: config.shippingCompanies.filter(c => c !== name) });
    };

    const updateShippingRate = (company: string, rate: number) => {
        updateConfig({ ...config, shippingRates: { ...(config.shippingRates || {}), [company]: rate } });
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

    // All blocklist matching is by normalized (digits-only) phone — entries and
    // order snapshots carry mixed formats, and exact-string comparison let
    // blocked customers slip through.
    const addBlockedCustomer = async (customer: BlockedCustomer) => {
        const existing = config.blockedCustomers || [];
        if (existing.some(c => normalizePhone(c.phone) === normalizePhone(customer.phone))) return; // already blocked
        try {
            await updateConfig({ ...config, blockedCustomers: [...existing, customer] });
        } catch (error: any) {
            alert("Failed to mark scammer: " + error.message);
        }
    };

    const addBlockedCustomers = async (customers: BlockedCustomer[]) => {
        const existing = config.blockedCustomers || [];
        const seen = new Set(existing.map(e => normalizePhone(e.phone)));
        const newCustomers: BlockedCustomer[] = [];
        for (const c of customers) {
            const key = normalizePhone(c.phone);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            newCustomers.push(c);
        }
        if (newCustomers.length === 0) return;
        try {
            await updateConfig({ ...config, blockedCustomers: [...existing, ...newCustomers] });
        } catch (error: any) {
            alert("Failed to mark scammers: " + error.message);
        }
    };

    const removeBlockedCustomer = (phone: string) => {
        const key = normalizePhone(phone);
        const existing = config.blockedCustomers || [];
        updateConfig({ ...config, blockedCustomers: existing.filter(c => normalizePhone(c.phone) !== key) });
    };

    // Batched unblock in ONE config write: looping removeBlockedCustomer built
    // every removal from the same stale array, so only the last call survived.
    const removeBlockedCustomers = (phones: string[]) => {
        const keys = new Set(phones.map(normalizePhone));
        const existing = config.blockedCustomers || [];
        updateConfig({ ...config, blockedCustomers: existing.filter(c => !keys.has(normalizePhone(c.phone))) });
    };

    const updateBlockedCustomer = (phone: string, updates: Partial<BlockedCustomer>) => {
        const key = normalizePhone(phone);
        const existing = config.blockedCustomers || [];
        updateConfig({
            ...config,
            blockedCustomers: existing.map(c => normalizePhone(c.phone) === key ? { ...c, ...updates } : c)
        });
    };

    const toggleProductPin = (productId: string) => {
        const pinned = config.pinnedProducts || [];
        if (pinned.includes(productId)) {
            updateConfig({ ...config, pinnedProducts: pinned.filter(id => id !== productId) });
        } else {
            updateConfig({ ...config, pinnedProducts: [...pinned, productId] });
        }
    };

    // Load pinned columns from localStorage on user change
    useEffect(() => {
        if (currentUser) {
            const key = `pinnedOrderColumns_${currentUser.id || currentUser.name}`;
            const stored = localStorage.getItem(key);
            setPinnedOrderColumns(stored ? JSON.parse(stored) : []);
        } else {
            setPinnedOrderColumns([]);
        }
    }, [currentUser]);

    const toggleOrderColumnPin = (columnId: string) => {
        setPinnedOrderColumns(prev => {
            const updated = prev.includes(columnId)
                ? prev.filter(id => id !== columnId)
                : [...prev, columnId];
            if (currentUser) {
                const key = `pinnedOrderColumns_${currentUser.id || currentUser.name}`;
                localStorage.setItem(key, JSON.stringify(updated));
            }
            return updated;
        });
    };

    const updateProductOrder = (order: string[]) => {
        updateConfig({ ...config, productOrder: order });
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

    // Transaction Actions
    const addTransaction = async (transaction: Omit<Transaction, 'id' | 'created_at'>) => {
        try {
            const newTransaction = {
                ...transaction,
                id: generateUUID()
            };
            const { data, error } = await supabase.from('transactions').insert([newTransaction]).select().single();
            if (error) throw error;
            if (data) setTransactions(prev => [data, ...prev]);
        } catch (error) {
            console.error('Error adding transaction:', error);
            throw error;
        }
    };

    const updateTransaction = async (id: string, updates: Partial<Transaction>) => {
        try {
            const { data, error } = await supabase.from('transactions').update(updates).eq('id', id).select().single();
            if (error) throw error;
            if (data) setTransactions(prev => prev.map(t => t.id === id ? data : t));
        } catch (error) {
            console.error('Error updating transaction:', error);
            throw error;
        }
    };

    const deleteTransaction = async (id: string) => {
        try {
            const { error } = await supabase.from('transactions').delete().eq('id', id);
            if (error) throw error;
            setTransactions(prev => prev.filter(t => t.id !== id));
        } catch (error) {
            console.error('Error deleting transaction:', error);
            throw error;
        }
    };

    const deleteTransactions = async (ids: string[]) => {
        try {
            const { error } = await supabase.from('transactions').delete().in('id', ids);
            if (error) throw error;
            setTransactions(prev => prev.filter(t => !ids.includes(t.id)));
        } catch (error) {
            console.error('Error deleting transactions:', error);
            throw error;
        }
    };

    // Sales Actions
    const processSale = async (paymentMethod: Sale['paymentMethod'], discount: number = 0, customer?: Sale['customer']): Promise<Sale | undefined> => {
        if (cart.length === 0) return;

        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const total = Math.max(0, subtotal - discount);

        const newSale: Sale = {
            id: generateUUID(),
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

        // If paying instantly (not COD), record the income transaction
        if (newSale.paymentStatus === 'Paid') {
            const transactionId = generateUUID();
            const newTransaction = {
                id: transactionId,
                date: new Date().toISOString(),
                type: 'Income' as const,
                category: 'លក់រាយ',
                amount: newSale.amountReceived || newSale.total,
                description: newSale.customer?.name || 'Customer',
                addedBy: currentUser?.name || 'System'
            };

            // Optimistic update
            setTransactions(prev => [newTransaction, ...prev]);

            // Async insert
            supabase.from('transactions').insert([{
                id: newTransaction.id,
                date: newTransaction.date,
                type: newTransaction.type,
                category: newTransaction.category,
                amount: newTransaction.amount,
                description: newTransaction.description,
                added_by: newTransaction.addedBy
            }]).then(({ error }) => {
                if (error) console.error('Failed to create transaction for POS sale:', error);
            });
        }

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
            order_status: 'Closed', // POS sales usually closed? Or Open?
            page_source: newSale.customer?.page || null
        });

        if (saleError) console.error('Sale insert error', saleError);

        // 2. Insert Items
        const itemsPayload = newSale.items.map(item => ({
            id: generateUUID(),
            sale_id: newSale.id,
            product_id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity
            // image: item.image - Removed to save DB space
        }));
        const { error: itemsError } = await supabase.from('sale_items').insert(itemsPayload);
        if (itemsError) {
            console.error('Failed to insert items:', itemsError);
            throw new Error('Failed to insert items: ' + itemsError.message);
        }

        // 3. Update Stock - REMOVED (As requested by user, skip POS auto deduct)
        /*
        newSale.items.forEach(async (item) => {
            // Local update
            setProducts(prev => prev.map(p => {
                if (p.id === item.id) return { ...p, stock: p.stock - item.quantity };
                return p;
            }));
            // DB update
            const { data: current } = await supabase.from('products').select('stock').eq('id', item.id).single();
            if (current) {
                await supabase.from('products').update({ stock: current.stock - item.quantity }).eq('id', item.id);
            }
        });
        */

        // Update salesOrder config (scoped write — see prependToSalesOrder)
        prependToSalesOrder(newSale.id);

        return newSale;
    };

    // Inventory Actions
    const addProduct = async (productData: Omit<Product, 'id'>) => {
        const newProduct: Product = {
            ...productData,
            id: Date.now().toString()
        };
        // Optimistic update
        setProducts(prev => [...prev, newProduct]);

        // Map to DB structure
        const dbProduct = {
            id: newProduct.id,
            name: newProduct.name,
            price: newProduct.price,
            purchase_cost: newProduct.purchaseCost || 0,
            stock: newProduct.stock,
            low_stock_threshold: newProduct.lowStockThreshold,
            image: newProduct.image,
            category: newProduct.category,
            model: newProduct.model,
            sku: newProduct.sku,
            invoice_number: newProduct.invoiceNumber,
            supplier: newProduct.supplier
        };

        const { error } = await supabase.from('products').insert(dbProduct);
        if (error) {
            console.error('Error adding product:', error);
            alert(`Failed to add product: ${error.message}\nPlease check database permissions (RLS) or connection.`);
            // Rollback local state
            setProducts(prev => prev.filter(p => p.id !== newProduct.id));
        } else {
            if (newProduct.stock > 0) {
                const inventoryItems = Array.from({ length: newProduct.stock }).map(() => ({
                    product_id: newProduct.id,
                    cost_of_purchase: newProduct.purchaseCost || 0,
                    status: 'in_stock'
                }));
                await supabase.from('inventory_items').insert(inventoryItems);
            }
            setProductsUpdatedAt(Date.now());
            dispatchActivity({ action: 'product_added', description: `Product "${newProduct.name}" added`, userId: currentUser?.id, userName: currentUser?.name, metadata: { productId: newProduct.id } });
        }
    };

    const updateProduct = async (id: string, updates: Partial<Product>) => {
        if (updates.stock !== undefined) {
            updates.stock = Math.max(0, updates.stock);
        }
        setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));

        // Map updates to DB structure
        const dbUpdates: any = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.price !== undefined) dbUpdates.price = updates.price;
        if (updates.purchaseCost !== undefined) dbUpdates.purchase_cost = updates.purchaseCost;
        if (updates.stock !== undefined) dbUpdates.stock = Math.max(0, updates.stock);
        if (updates.lowStockThreshold !== undefined) dbUpdates.low_stock_threshold = updates.lowStockThreshold;
        if (updates.image !== undefined) dbUpdates.image = updates.image;
        if (updates.category !== undefined) dbUpdates.category = updates.category;
        if (updates.model !== undefined) dbUpdates.model = updates.model;
        if (updates.sku !== undefined) dbUpdates.sku = updates.sku;
        if (updates.invoiceNumber !== undefined) dbUpdates.invoice_number = updates.invoiceNumber;
        if (updates.supplier !== undefined) dbUpdates.supplier = updates.supplier;

        await supabase.from('products').update(dbUpdates).eq('id', id);
        setProductsUpdatedAt(Date.now());
    };

    const deleteProduct = async (id: string) => {
        // Soft delete the product to preserve foreign key constraints in sale_items
        const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id);
        if (error) {
            console.error('Error soft-deleting product:', error);
            alert(`Failed to delete product: ${error.message}`);
            // Re-fetch to sync state?
            const { data } = await supabase.from('products').select('*').eq('id', id).single();
            if (data) setProducts(prev => [...prev, data]);
        } else {
            setProducts(prev => prev.filter(p => p.id !== id));
            setProductsUpdatedAt(Date.now());
            dispatchActivity({ action: 'product_deleted', description: `Product deleted`, userId: currentUser?.id, userName: currentUser?.name, metadata: { productId: id } });
        }
    };

    const deleteProducts = async (ids: string[]) => {
        // Soft delete the products to preserve foreign key constraints
        const { error } = await supabase.from('products').update({ is_active: false }).in('id', ids);
        if (error) {
            console.error('Error soft-deleting products:', error);
            alert(`Failed to delete products: ${error.message}`);
        } else {
            setProducts(prev => prev.filter(p => !ids.includes(p.id)));
            setProductsUpdatedAt(Date.now());
        }
    };

    // `supplier` feeds the "Supplier / Customer" column in Stock Movements. Without it
    // every stock-in row rendered as "-", since that column falls back to customer_name
    // which is only set for sales-side movements.
    const addStock = async (productId: string, quantity: number, cost?: number, note?: string, supplier?: string) => {
        setIsLoading(true);
        try {
            const id = generateUUID();
            const date = new Date().toISOString();

            // 1. Fetch current product (stock from the DB — the local closure is
            // stale inside the PO-receive loop and after other edits).
            const product = products.find(p => p.id === productId);
            if (!product) throw new Error("Product not found");
            const { data: dbProduct, error: readError } = await supabase.from('products').select('stock').eq('id', productId).single();
            if (readError) throw readError;
            const newStock = (dbProduct ? Number(dbProduct.stock) : product.stock) + quantity;

            // 2. Insert into inventory_items
            const inventoryItems = Array.from({ length: quantity }).map(() => ({
                product_id: productId,
                cost_of_purchase: cost || product.purchaseCost || 0,
                status: 'in_stock'
            }));
            const { error: invError } = await supabase.from('inventory_items').insert(inventoryItems);
            if (invError) throw invError;

            // 3. Update product stock in DB
            const { error: productError } = await supabase.from('products').update({ stock: newStock }).eq('id', productId);
            if (productError) throw productError;

            // 4. Insert restock record — AFTER the stock update, so a failure
            // earlier never leaves history for stock that was never added.
            const { error: restockError } = await supabase.from('restocks').insert([{
                id,
                product_id: productId,
                quantity,
                cost: cost || 0,
                date,
                added_by: currentUser?.name || 'Unknown',
                note: note || ''
            }]);
            if (restockError) throw restockError;

            // 4.5 Log to stock_movements
            const { error: movementError } = await supabase.from('stock_movements').insert({
                product_id: productId,
                product_name: product.name,
                type: 'in',
                quantity: quantity,
                unit_price: cost || product.purchaseCost || 0,
                source: note?.startsWith('Received from PO') ? 'Purchase Order' : 'Inventory Adjustment',
                supplier: supplier || '',
                note: note || '',
                movement_date: getLocalYYYYMMDD(),
                created_by: currentUser?.id
            });
            if (movementError) console.error('Failed to log stock movement:', movementError);

            // 5. Update local state (functional form — loops must compose)
            setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: newStock } : p));
            setProductsUpdatedAt(Date.now());
        } catch (error: any) {
            // Rethrow so callers can react — the PO receive flow must NOT mark a
            // PO 'Received' (and toast success) when the stock was never added.
            console.error("Error adding stock:", error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    };

    // NOTE: deliberately does NOT toggle the global isLoading — App renders a
    // full-screen loader on that flag, and this runs from inline cell edits and
    // bulk loops where blanking the app (and losing page state) is wrong.
    const adjustStock = async (productId: string, newStock: number, reason: string) => {
        try {
            const product = products.find(p => p.id === productId);
            if (!product) throw new Error("Product not found");

            // Read the current stock from the DB, not the render closure — in a
            // bulk loop or right after another edit the closure value is stale
            // and would produce a wrong ledger delta.
            const { data: dbProduct, error: readError } = await supabase.from('products').select('stock').eq('id', productId).single();
            if (readError) throw readError;
            const currentStock = dbProduct ? Number(dbProduct.stock) : product.stock;
            const difference = newStock - currentStock;

            if (difference === 0) return; // No change

            // 1. Update product stock in DB
            const { error: productError } = await supabase.from('products').update({ stock: newStock }).eq('id', productId);
            if (productError) throw productError;

            // 2. Log to stock_movements
            const type = difference > 0 ? 'in' : 'out';
            const { error: movementError } = await supabase.from('stock_movements').insert({
                product_id: productId,
                product_name: product.name,
                type: type,
                quantity: Math.abs(difference),
                unit_price: product.purchaseCost || 0,
                source: 'Manual Adjustment',
                reason: 'Stock Count / Adjustment',
                note: reason || `Adjusted from ${currentStock} to ${newStock}`,
                movement_date: getLocalYYYYMMDD(),
                created_by: currentUser?.id
            });
            
            if (movementError) console.error('Failed to log stock adjustment movement:', movementError);

            // 3. (Optional) If positive adjustment, we could add to inventory_items, 
            // but for a generic adjustment, we'll just adjust the total stock for now.

            // 4. Update local state — functional form, so concurrent/looped
            // adjustments and a preceding updateProduct compose instead of the
            // last call clobbering the others with a stale array.
            setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: newStock } : p));
            setProductsUpdatedAt(Date.now());
        } catch (error: any) {
            console.error("Error adjusting stock:", error);
            alert(`Failed to adjust stock: ${error.message}`);
        }
    };

    const addOnlineOrder = async (order: Omit<Sale, 'id'>): Promise<Sale> => {
        const newSale: Sale = {
            ...order,
            id: Date.now().toString(),
            date: order.date || new Date().toISOString()
        };

        const isPaidStatus = (s: string | undefined) => ['Paid', 'Settled', 'Paid/Settled'].includes(s || '');

        // If creating a new order as already paid, record the income transaction
        if (isPaidStatus(newSale.paymentStatus)) {
            const transactionId = generateUUID();
            const rawDate = order.settleDate || new Date().toISOString();
            const normalizedDate = rawDate.match(/^\d{4}-\d{2}-\d{2}$/) 
                ? new Date(rawDate).toISOString() 
                : rawDate;

            const newTransaction = {
                id: transactionId,
                date: normalizedDate,
                type: 'Income' as const,
                category: 'លក់រាយ',
                amount: newSale.amountReceived || newSale.total,
                description: newSale.customer?.name || 'Customer',
                addedBy: currentUser?.name || 'System'
            };

            // Optimistic update
            setTransactions(prev => [newTransaction, ...prev]);

            // Async insert
            supabase.from('transactions').insert([{
                id: newTransaction.id,
                date: newTransaction.date,
                type: newTransaction.type,
                category: newTransaction.category,
                amount: newTransaction.amount,
                description: newTransaction.description,
                added_by: newTransaction.addedBy
            }]).then(({ error }) => {
                if (error) console.error('Failed to create transaction for online order:', error);
            });
        } else if (newSale.paymentStatus === 'Deposit' && (newSale.depositAmount || 0) > 0) {
            // Order created straight from checkout with a partial payment:
            // log the deposit as income right away (mirror of the updateOrder
            // Deposit branch — deposits are always kept, never removed).
            const depAmount = Number(newSale.depositAmount) || 0;
            const rawDepDate = newSale.depositDate || new Date().toISOString();
            const depDateIso = rawDepDate.match(/^\d{4}-\d{2}-\d{2}$/) ? new Date(rawDepDate).toISOString() : rawDepDate;
            const depTxn = {
                id: generateUUID(),
                date: depDateIso,
                type: 'Income' as const,
                category: 'កក់ប្រាក់',
                amount: depAmount,
                description: `${newSale.customer?.name || 'Customer'} #DEP-${newSale.id.slice(0, 8)}`,
                addedBy: currentUser?.name || 'System',
                shipping_co: newSale.shipping?.company || null,
                pay_by: newSale.depositMethod || null
            };
            setTransactions(prev => [depTxn, ...prev]);
            supabase.from('transactions').insert([{
                id: depTxn.id,
                date: depTxn.date,
                type: depTxn.type,
                category: depTxn.category,
                amount: depTxn.amount,
                description: depTxn.description,
                added_by: depTxn.addedBy,
                pay_by: depTxn.pay_by,
                shipping_co: depTxn.shipping_co
            }]).then(({ error }) => {
                if (error) console.error('Failed to log deposit income for new order:', error);
            });
        }

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
            deposit_amount: newSale.depositAmount || 0,
            deposit_date: newSale.depositDate || null,
            deposit_method: newSale.depositMethod || null,
            customer_snapshot: newSale.customer,
            order_status: 'Open',
            page_source: newSale.customer?.page || null,
            shipping_company: newSale.shipping?.company,
            tracking_number: newSale.shipping?.trackingNumber,
            shipping_status: newSale.shipping?.status,
            remark: newSale.remark
        });

        if (saleError) {
            console.error("Error creating online order:", saleError);
            throw new Error("Failed to create order: " + saleError.message);
        }

        // Items
        const itemsPayload = newSale.items.map(item => ({
            id: generateUUID(),
            sale_id: newSale.id,
            product_id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity
            // image: item.image - Removed to save DB space
        }));
        const { error: itemsError } = await supabase.from('sale_items').insert(itemsPayload);
        if (itemsError) {
            console.error('Failed to insert online items:', itemsError);
            throw new Error('Failed to insert items: ' + itemsError.message);
        }

        // 3. Update Stock - REMOVED (Stock now deducted on 'Shipped' status)
        /*
        newSale.items.forEach(async (item) => {
            // ...
        });
        */

        // Update salesOrder config (scoped write — see prependToSalesOrder)
        prependToSalesOrder(newSale.id);
        setSalesUpdatedAt(Date.now());
        dispatchActivity({ action: 'order_created', description: `New order #${newSale.id.slice(0, 8)} created — $${newSale.total}`, userId: currentUser?.id, userName: currentUser?.name, metadata: { orderId: newSale.id, total: newSale.total } });
        return newSale;
    };

    const updateOrderStatus = async (id: string, status: NonNullable<Sale['shipping']>['status'], trackingNumber?: string, shippingCompany?: string) => {
        // Checked before the optimistic setSales below — otherwise the row would flip to
        // the new status on screen even though the change is rejected.
        if (POST_DISPATCH_STATUSES.includes(status)) {
            // `sales` only holds the loaded page, so an order reached via search or an
            // older page is absent from it. Defaulting to 'Pending' in that case made
            // this guard reject perfectly valid Shipped -> Delivered changes, so fall
            // back to the database rather than to an assumption.
            let currentStatus: string = sales.find(s => s.id === id)?.shipping?.status ?? '';
            if (!currentStatus) {
                const { data, error } = await supabase.from('sales').select('shipping_status').eq('id', id).single();
                if (error) {
                    console.error('Could not read current status before changing it:', error.message);
                    alert('Could not verify this order’s current status. Please refresh and try again.');
                    return;
                }
                currentStatus = data?.shipping_status || 'Pending';
            }
            // Already at the target status: a silent no-op, not an error. Bulk
            // selections routinely mix rows already in the target status — each
            // one must not pop a blocking alert.
            if (currentStatus === status) {
                return;
            }
            if (!canEnterPostDispatch(currentStatus, status)) {
                alert(POST_DISPATCH_BLOCKED_MESSAGE(currentStatus, status));
                return;
            }
        }

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
                        trackingNumber: trackingNumber ?? (sale.shipping?.trackingNumber || ''),
                        company: shippingCompany ?? (sale.shipping?.company || '')
                    }
                };
            }
            return sale;
        }));

        // --- Stock Management Logic ---
        // `sales` is only the currently loaded page. An order opened from search or an
        // older page is missing from it, and this block used to be skipped entirely in
        // that case — so shipping such an order never deducted its stock. Fall back to
        // the database (items included) so stock is applied regardless of what's loaded.
        let salesOrder = sales.find(s => s.id === id);
        if (!salesOrder) {
            const { data, error } = await supabase
                .from('sales')
                .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)')
                .eq('id', id)
                .single();
            if (error) {
                console.error('Could not load order for stock adjustment:', error.message);
            } else if (data) {
                salesOrder = mapSaleEntity(data);
            }
        }
        if (salesOrder) {
            const oldStatus = salesOrder.shipping?.status || 'Pending';

            // Case 1: Changing TO 'Shipped' (from a status where stock is still on hand)
            // -> DEDUCT Stock. Delivered deliberately does not deduct: the goods already
            // left at Shipped, and counting again would double-deduct. 'Returned' is
            // excluded too: the goods left at the original Shipped and never came back
            // (Case 2 deliberately keeps them counted out), so re-shipping a Returned
            // order is a stock no-op — deducting again would double-deduct.
            if (countsAsStockOut(status) && !isStockConsumed(oldStatus) && oldStatus !== 'Returned') {
                for (const item of salesOrder.items) {
                    // Local
                    setProducts(prev => prev.map(p => {
                        if (p.id === item.id) return { ...p, stock: Math.max(0, p.stock - item.quantity) };
                        return p;
                    }));
                    // DB
                    const { data: current } = await supabase.from('products').select('stock').eq('id', item.id).single();
                    if (current) {
                        await supabase.from('products').update({ stock: Math.max(0, current.stock - item.quantity) }).eq('id', item.id);
                    }

                    // Deduct specific inventory items (FIFO)
                    const { data: invItems } = await supabase.from('inventory_items')
                        .select('id')
                        .eq('product_id', item.id)
                        .eq('status', 'in_stock')
                        .order('created_at', { ascending: true })
                        .limit(item.quantity);
                    
                    if (invItems && invItems.length > 0) {
                        const idsToUpdate = invItems.map((i: any) => i.id);
                        await supabase.from('inventory_items')
                            .update({ status: 'sold', sale_id: id })
                            .in('id', idsToUpdate);
                    }
                }
            }
            // Case 2: Changing FROM 'Shipped' or 'Delivered' (to non-shipped) -> RESTORE Stock
            // EXCEPTION: If changing to 'Returned', do NOT restore stock automatically.
            // 'Returned' means it's on the way back but hasn't arrived. (Restock button in Inventory will restore it).
            // 'Returned' -> pre-ship (un-returning to Pending/Confirmed/Drafted) is a full
            // reversal too: the goods are still counted out from the original shipment, so
            // restore here — otherwise a later re-ship would deduct them a second time.
            // ReStock is excluded from that: the Restock flow does its own stock restore.
            else if ((isStockConsumed(oldStatus) || (oldStatus === 'Returned' && status !== 'ReStock')) && !isStockConsumed(status) && status !== 'Returned') {
                for (const item of salesOrder.items) {
                    // Local
                    setProducts(prev => prev.map(p => {
                        if (p.id === item.id) return { ...p, stock: p.stock + item.quantity };
                        return p;
                    }));
                    // DB
                    const { data: current } = await supabase.from('products').select('stock').eq('id', item.id).single();
                    if (current) {
                        await supabase.from('products').update({ stock: current.stock + item.quantity }).eq('id', item.id);
                    }

                    // Restore specific inventory items
                    const { data: soldItems } = await supabase.from('inventory_items')
                        .select('id')
                        .eq('sale_id', id)
                        .eq('product_id', item.id);
                    
                    if (soldItems && soldItems.length > 0) {
                        const idsToUpdate = soldItems.map((i: any) => i.id);
                        await supabase.from('inventory_items')
                            .update({ status: 'in_stock', sale_id: null })
                            .in('id', idsToUpdate);
                    }
                }
                
                // Delete stock-out records since the order is no longer shipped.
                // Only the NEWEST generation: an order re-shipped after a return/restock
                // cycle carries one out generation per shipment (each insert batch shares
                // a created_at), and only the shipment being reversed here — one item
                // set's worth of stock was restored above — may leave the ledger.
                const { data: outRows } = await supabase.from('stock_movements')
                    .select('id, created_at')
                    .eq('reference_id', id)
                    .eq('type', 'out');
                if (outRows && outRows.length > 0) {
                    const newest = outRows.reduce((m, r: any) => (r.created_at > m ? r.created_at : m), outRows[0].created_at);
                    const idsToDelete = outRows.filter((r: any) => r.created_at === newest).map((r: any) => r.id);
                    await supabase.from('stock_movements').delete().in('id', idsToDelete);
                }
            }
        }
        // ------------------------------

        const updates: any = { shipping_status: status };
        if (trackingNumber) updates.tracking_number = trackingNumber;
        if (shippingCompany) updates.shipping_company = shippingCompany;

        if (currentUser) {
            updates.last_edited_at = now;
            updates.last_edited_by = currentUser.name;
        }

        // Surface a failed status write instead of continuing on optimistic state —
        // callers (e.g. the bulk-edit loops) rely on this to show their error toast.
        const { error: statusWriteError } = await supabase.from('sales').update(updates).eq('id', id);
        if (statusWriteError) {
            console.error('Failed to update order status:', statusWriteError);
            setSalesUpdatedAt(Date.now());
            throw statusWriteError;
        }

        // Log the stock-out movement only when the order ships. Delivery must leave the
        // existing record untouched — rewriting it re-dated the movement to the delivery
        // day, which moved it in stock-out reports.
        if (salesOrder && countsAsStockOut(status)) {
            const oldStatus = salesOrder.shipping?.status || 'Pending';
            // Only log or update if this is a new transition
            if (oldStatus !== status) {
                // Check if stock-out records already exist for this order
                const { data: existingMovements } = await supabase.from('stock_movements')
                    .select('id')
                    .eq('reference_id', id)
                    .eq('type', 'out');

                const customerName = salesOrder.customer?.name || '';
                const customerPhone = salesOrder.customer?.phone || '';

                // If customer info is empty (order may not be fully loaded in local state), fetch from DB
                let finalCustomerName = customerName;
                let finalCustomerPhone = customerPhone;
                if (!finalCustomerName) {
                    const { data: dbSale } = await supabase.from('sales').select('customer_snapshot').eq('id', id).single();
                    if (dbSale?.customer_snapshot) {
                        finalCustomerName = dbSale.customer_snapshot.name || '';
                        finalCustomerPhone = dbSale.customer_snapshot.phone || '';
                    }
                }
                const customerInfo = [finalCustomerName, finalCustomerPhone].filter(Boolean).join(' | ');

                // Did Case 1 above actually deduct stock on this transition? If so, this
                // is a genuinely new shipment (e.g. a ReStock-reopened order shipping
                // again) and must INSERT fresh out rows even when the first shipment's
                // rows still exist — otherwise the ledger nets 0 while stock netted −N.
                const stockDeductedThisTransition = !isStockConsumed(oldStatus) && oldStatus !== 'Returned';

                if (existingMovements && existingMovements.length > 0 && !stockDeductedThisTransition) {
                    // Refresh existing records without re-dating them: a correction like
                    // Delivered -> Shipped must keep the date the goods actually left.
                    await supabase.from('stock_movements')
                        .update({
                            reason: 'Shipped',
                            source: 'Order Shipped',
                            customer_name: finalCustomerName,
                            customer_phone: finalCustomerPhone
                        })
                        .eq('reference_id', id)
                        .eq('type', 'out')
                        .then(({ error }) => {
                            if (error) console.error('Failed to update stock-out movements:', error);
                        });
                } else {
                    // Insert new records

                    const stockOutMovements = salesOrder.items
                        .filter(item => item.id)
                        .map(item => ({
                            product_id: item.id,
                            product_name: item.name || 'Unknown',
                            type: 'out',
                            quantity: item.quantity,
                            unit_price: item.price || 0,
                            reason: 'Shipped',
                            reference_id: id,
                            source: 'Order Shipped',
                            shipping_co: shippingCompany ?? (salesOrder.shipping?.company || ''),
                            note: `Order #${id.slice(0, 8)}${customerInfo ? ' — ' + customerInfo : ''}`,
                            movement_date: getLocalYYYYMMDD(),
                            created_by: currentUser?.id || 'unknown',
                            customer_name: finalCustomerName,
                            customer_phone: finalCustomerPhone
                        }));

                    if (stockOutMovements.length > 0) {
                        supabase.from('stock_movements').insert(stockOutMovements).then(({ error }) => {
                            if (error) console.error('Failed to log stock-out movements:', error);
                        });
                    }
                }
            }
        }

        if (salesOrder && trackingNumber && trackingNumber !== salesOrder.shipping?.trackingNumber) {
            dispatchActivity({ 
                action: 'order_updated', 
                description: `Tracking ID updated for Order #${id.slice(0, 8)}`, 
                userId: currentUser?.id, 
                userName: currentUser?.name, 
                metadata: { 
                    orderId: id, 
                    oldTracking: salesOrder.shipping?.trackingNumber || '',
                    newTracking: trackingNumber 
                } 
            });
        }

        setSalesUpdatedAt(Date.now());
        const oldStatus = salesOrder?.shipping?.status || 'Pending';
        if (oldStatus !== status) {
            dispatchActivity({ action: 'order_status', description: `Order #${id.slice(0, 8)} status → ${status}`, userId: currentUser?.id, userName: currentUser?.name, metadata: { orderId: id, status } });
        }
    };

    const updateOrder = async (id: string, updates: Partial<Sale>): Promise<void> => {
        // Find existing order BEFORE local update for checking status change
        let existingOrder = sales.find(s => s.id === id);

        if (!existingOrder) {
            const { data } = await supabase.from('sales').select('*').eq('id', id).single();
            if (data) {
                existingOrder = mapSaleEntity(data) as any;
            }
        }

        // The stock-movement block at the end keys off the status BEFORE this update.
        // The local cache can be stale: the status badges run updateOrderStatus (which
        // owns stock + ledger) and then this function for payment side-effects with
        // the same target status — by then the cache still shows the pre-transition
        // status, and replaying the transition here would delete a second movement
        // generation. Read the DB so an already-applied transition reads as a no-op.
        let shippingStatusBeforeUpdate = existingOrder?.shipping?.status;
        if (updates.shipping?.status) {
            const { data: freshStatusRow } = await supabase.from('sales').select('shipping_status').eq('id', id).single();
            if (freshStatusRow?.shipping_status) {
                shippingStatusBeforeUpdate = freshStatusRow.shipping_status;
            }
        }

        // Same rule as updateOrderStatus — this is a second way in (including the bulk
        // edit path, which calls through here per order), so it needs the same guard.
        //
        // Only an actual *change* is rejected here. Saving an edit to a delivered order
        // re-sends its current status unchanged, and treating that as a transition would
        // make every delivered order impossible to edit.
        if (updates.shipping?.status && POST_DISPATCH_STATUSES.includes(updates.shipping.status)) {
            const currentStatus = existingOrder?.shipping?.status || 'Pending';
            const isRealChange = currentStatus !== updates.shipping.status;
            if (isRealChange && !canEnterPostDispatch(currentStatus, updates.shipping.status)) {
                alert(POST_DISPATCH_BLOCKED_MESSAGE(currentStatus, updates.shipping.status));
                return;
            }
        }

        // Leaving Paid/Settled for ANY non-paid status — Cancel, or an admin unlocking a
        // mistaken Paid back to Unpaid/Get File/Deposit — removes the income that was
        // logged when the order was marked Paid, so the books don't keep revenue that is
        // no longer collected. Matched the same way income is looked up elsewhere.
        // The deposit entry itself (កក់ប្រាក់) is never removed: deposits are always kept.
        const PAID_STATUSES = ['Paid', 'Settled', 'Paid/Settled'];
        if (
            updates.paymentStatus !== undefined &&
            !PAID_STATUSES.includes(updates.paymentStatus || '') &&
            existingOrder && PAID_STATUSES.includes(existingOrder.paymentStatus || '')
        ) {
            const custName = existingOrder.customer?.name || 'Customer';
            // Deposit orders logged only the remainder as sales income — match that too.
            // Zero amounts are excluded: real income rows are always > 0 (the paid
            // transition never inserts $0 rows), and matching amount.eq.0 could
            // only ever hit an unrelated row of the same customer.
            const dep = existingOrder.depositAmount || 0;
            const amountMatches = [existingOrder.amountReceived || 0, existingOrder.total];
            if (dep > 0) amountMatches.push(Math.max(0, (existingOrder.amountReceived || 0) - dep), Math.max(0, existingOrder.total - dep));
            const positiveMatches = amountMatches.filter(a => a > 0);
            if (positiveMatches.length > 0) try {
                const { data: paidTxns } = await supabase.from('transactions')
                    .select('id')
                    .eq('type', 'Income')
                    // Also match the pre-rename category so older rows still clean up.
                    .in('category', ['លក់រាយ', 'លក់ឥវ៉ាន់'])
                    .eq('description', custName)
                    .or(positiveMatches.map(a => `amount.eq.${a}`).join(','))
                    .limit(1);
                if (paidTxns && paidTxns.length > 0) {
                    await supabase.from('transactions').delete().eq('id', paidTxns[0].id);
                    setTransactions(prev => prev.filter(t => t.id !== paidTxns[0].id));
                }
            } catch (e) {
                console.error('Failed to remove income for un-paid order:', e);
            }
        }

        // A paid order's customer rename must follow through to its income row:
        // every later lookup (settle-date sync, leaving-Paid cleanup) matches by
        // description, so a row left under the old name would be missed — and the
        // settle-date heal branch would then insert a duplicate income row.
        if (
            updates.customer?.name && existingOrder?.customer?.name &&
            updates.customer.name !== existingOrder.customer.name &&
            PAID_STATUSES.includes(existingOrder.paymentStatus || '') &&
            (updates.paymentStatus === undefined || PAID_STATUSES.includes(updates.paymentStatus || ''))
        ) {
            const oldName = existingOrder.customer.name;
            const newName = updates.customer.name;
            const renameDep = existingOrder.depositAmount || 0;
            const renameMatches = [existingOrder.amountReceived || 0, existingOrder.total];
            if (renameDep > 0) renameMatches.push(Math.max(0, (existingOrder.amountReceived || 0) - renameDep), Math.max(0, existingOrder.total - renameDep));
            // Zero amounts excluded — see the leaving-Paid cleanup above.
            const positiveRenameMatches = renameMatches.filter(a => a > 0);
            if (positiveRenameMatches.length > 0) try {
                const { data: rowToRename } = await supabase.from('transactions')
                    .select('id')
                    .eq('type', 'Income')
                    .in('category', ['លក់រាយ', 'លក់ឥវ៉ាន់'])
                    .eq('description', oldName)
                    .or(positiveRenameMatches.map(a => `amount.eq.${a}`).join(','))
                    .limit(1);
                if (rowToRename && rowToRename.length > 0) {
                    await supabase.from('transactions').update({ description: newName }).eq('id', rowToRename[0].id);
                    setTransactions(prev => prev.map(t => t.id === rowToRename[0].id ? { ...t, description: newName } : t));
                }
            } catch (e) {
                console.error('Failed to rename income row with customer:', e);
            }
        }

        if (updates.paymentStatus === 'Cancel') {
            // Cancelling payment normally sends shipping back to 'Pending' so the order can
            // be re-processed. But when the caller ALSO sets a shipping status (the
            // Returned / Cancelled / ReStock transitions cancel payment as a side effect and
            // pass their own status), respect that status instead of forcing 'Pending'.
            // Without this, changing e.g. Shipped -> Returned flipped the order to Pending,
            // because `existingOrder` is read from the not-yet-committed local state (still
            // 'Shipped') and so failed the Returned/Cancelled check below.
            if (!updates.shipping?.status) {
                const currentShippingStatus = existingOrder?.shipping?.status;
                if (currentShippingStatus !== 'Returned' && currentShippingStatus !== 'Cancelled' && currentShippingStatus !== 'ReStock') {
                    updates.shipping = {
                        ...(existingOrder?.shipping || {}),
                        status: 'Pending'
                    } as any;
                }
            }
        } else if (updates.paymentStatus === 'Get File') {
            updates.shipping = { 
                ...(existingOrder?.shipping || {}), 
                ...(updates.shipping || {}), 
                status: 'Delivered' 
            } as any;
        }

        // 1. Optimistic Local Update
        setSales(prev => prev.map(sale =>
            sale.id === id ? { ...sale, ...updates } : sale
        ));

        const isPaidStatus = (s: string | undefined) => ['Paid', 'Settled', 'Paid/Settled'].includes(s || '');

        // Sync Income/Expense: If changed to 'Paid'/'Settled' (and wasn't before)
        if (isPaidStatus(updates.paymentStatus) && existingOrder && !isPaidStatus(existingOrder.paymentStatus)) {
            const transactionId = generateUUID();
            // A deposit was already logged as income when it was received, so an
            // order that ever took a deposit only logs the COD remainder here —
            // even when it settles from 'Get File' or a reverted 'Unpaid', where
            // the deposit row (កក់ប្រាក់) is still on the books. When no explicit
            // amount is passed, a deposit order is treated as fully collected
            // (amountReceived currently holds just the deposit).
            const depositPaid = existingOrder.depositAmount || 0;
            if (depositPaid > 0 && updates.amountReceived === undefined) {
                updates.amountReceived = existingOrder.total;
            }
            const grossReceived = updates.amountReceived !== undefined
                ? updates.amountReceived
                : (existingOrder.amountReceived || existingOrder.total);
            const amountToRecord = Math.max(0, (grossReceived || 0) - depositPaid);

            const customerName = updates.customer?.name
                || existingOrder.customer?.name
                || 'Customer';

            const rawDate = updates.settleDate || existingOrder.settleDate || new Date().toISOString();
            const normalizedDate = rawDate.match(/^\d{4}-\d{2}-\d{2}$/) 
                ? new Date(rawDate).toISOString() 
                : rawDate;

            const shippingCoToRecord = updates.shipping?.company || existingOrder.shipping?.company || null;

            // Nothing to book when the deposit already covered everything —
            // inserting a $0 row would only clutter Income & Expense (and could
            // be matched by later amount.eq.0 lookups).
            if (amountToRecord > 0) {
                const newTransaction = {
                    id: transactionId,
                    date: normalizedDate,
                    type: 'Income' as const,
                    category: 'លក់រាយ',
                    amount: amountToRecord,
                    description: customerName,
                    addedBy: currentUser?.name || 'System',
                    shipping_co: shippingCoToRecord,
                    // The Pay By chosen in the settle modal (falls back to the order's method).
                    pay_by: updates.paymentMethod || existingOrder.paymentMethod || null
                };

                // Optimistic update
                setTransactions(prev => [newTransaction, ...prev]);

                // Async insert
                supabase.from('transactions').insert([{
                    id: newTransaction.id,
                    date: newTransaction.date,
                    type: newTransaction.type,
                    category: newTransaction.category,
                    amount: newTransaction.amount,
                    description: newTransaction.description,
                    added_by: newTransaction.addedBy,
                    shipping_co: newTransaction.shipping_co,
                    pay_by: newTransaction.pay_by
                }]).then(({ error }) => {
                    if (error) console.error('Failed to create transaction for updated order:', error);
                });
            }
        } else if (
            updates.settleDate &&
            existingOrder &&
            // Run when the settle day actually moved (compared as LOCAL days), or
            // when a paid order's received amount was corrected — both must reach
            // the income row. An ordinary no-op re-save (CheckoutForm resends the
            // stored settleDate, and COD orders resend amountReceived 0) skips, so
            // edits like fixing a customer-name typo can't duplicate the row via
            // the heal branch below.
            (
                localDayOf(updates.settleDate) !== localDayOf(existingOrder.settleDate) ||
                (updates.amountReceived !== undefined && updates.amountReceived > 0 && updates.amountReceived !== (existingOrder.amountReceived || 0))
            ) &&
            isPaidStatus(updates.paymentStatus !== undefined ? updates.paymentStatus : existingOrder.paymentStatus)
        ) {
            // A paid order's settle date changed without a payment-status transition
            // (e.g. the bulk settle-date edit when the shipping company pays out).
            // Move its income transaction to the new date so Income & Expense matches
            // the settle-date view — and if it was never logged (silent failure or
            // legacy data), create it now.
            const settleDayChanged = localDayOf(updates.settleDate) !== localDayOf(existingOrder.settleDate);
            // Look the row up under BOTH names: normally it still carries the old
            // customer name, but when a rename lands in the same save the rename
            // sync above has already moved it to the new one.
            const lookupName = existingOrder.customer?.name || 'Customer';
            const customerName = updates.customer?.name || lookupName;
            const lookupNames = Array.from(new Set([lookupName, customerName]));
            // Deposit orders keep the deposit income separate — the sales entry only
            // holds the remainder, so match and update against remainder amounts too.
            const depositHeld = existingOrder.depositAmount || 0;
            const grossForSync = updates.amountReceived !== undefined
                ? updates.amountReceived
                : (existingOrder.amountReceived || existingOrder.total);
            const amountToRecord = Math.max(0, (grossForSync || 0) - depositHeld);
            const syncMatches = [existingOrder.amountReceived || 0, existingOrder.total];
            if (depositHeld > 0) syncMatches.push(Math.max(0, (existingOrder.amountReceived || 0) - depositHeld), Math.max(0, existingOrder.total - depositHeld));
            // Zero amounts excluded — real income rows are always > 0, and a
            // deposit-covered order (no income row by design) must not have its
            // lookup land on an unrelated row of the same customer.
            const positiveSyncMatches = syncMatches.filter(a => a > 0);
            const rawDate = updates.settleDate;
            const normalizedDate = rawDate.match(/^\d{4}-\d{2}-\d{2}$/) ? new Date(rawDate).toISOString() : rawDate;
            if (positiveSyncMatches.length > 0) try {
                const { data: txns } = await supabase.from('transactions')
                    .select('id, amount')
                    .eq('type', 'Income')
                    // Also match the pre-rename category so older rows still sync.
                    .in('category', ['លក់រាយ', 'លក់ឥវ៉ាន់'])
                    .in('description', lookupNames)
                    .or(positiveSyncMatches.map(a => `amount.eq.${a}`).join(','))
                    .limit(1);
                if (txns && txns.length > 0) {
                    await supabase.from('transactions')
                        .update({ date: normalizedDate, amount: amountToRecord || txns[0].amount, description: customerName })
                        .eq('id', txns[0].id);
                    setTransactions(prev => prev.map(t => t.id === txns[0].id ? { ...t, date: normalizedDate, amount: amountToRecord || t.amount, description: customerName } : t));
                } else if (settleDayChanged && amountToRecord > 0) {
                    // Heal a missing row only on a real settle-day change AND when
                    // there is actual income to book — a deposit-covered order has
                    // no income row by design, and an amount-only correction that
                    // fails to find its row must not insert a fresh one (that
                    // would risk duplicate revenue).
                    const healed = {
                        id: generateUUID(),
                        date: normalizedDate,
                        type: 'Income' as const,
                        category: 'លក់រាយ',
                        amount: amountToRecord,
                        description: customerName,
                        addedBy: currentUser?.name || 'System',
                        shipping_co: updates.shipping?.company || existingOrder.shipping?.company || null,
                        pay_by: updates.paymentMethod || existingOrder.paymentMethod || null
                    };
                    setTransactions(prev => [healed, ...prev]);
                    const { error: healErr } = await supabase.from('transactions').insert([{
                        id: healed.id,
                        date: healed.date,
                        type: healed.type,
                        category: healed.category,
                        amount: healed.amount,
                        description: healed.description,
                        added_by: healed.addedBy,
                        shipping_co: healed.shipping_co,
                        pay_by: healed.pay_by
                    }]);
                    if (healErr) console.error('Failed to create missing income transaction:', healErr);
                }
            } catch (e) {
                console.error('Failed to sync income transaction with settle date:', e);
            }
        } else if (updates.paymentStatus === 'Deposit' && existingOrder) {
            // Deposit received: log it as income right away (category កក់ប្រាក់).
            // Deposits are always kept — cancelling the order later never removes
            // this entry (the cancel cleanup only targets 'លក់រាយ').
            // Fires on ANY save into/within Deposit and logs only the POSITIVE
            // DELTA: a first deposit logs its full amount (prev = 0), raising an
            // existing deposit ($30 -> $50) logs the extra $20, and re-saving an
            // unchanged deposit logs nothing (delta 0 — no duplicate rows).
            const prevDep = existingOrder.paymentStatus === 'Deposit' ? (existingOrder.depositAmount || 0) : 0;
            const depAmount = Math.max(0, (Number(updates.depositAmount) || 0) - prevDep);
            if (depAmount > 0) {
                const custName = updates.customer?.name || existingOrder.customer?.name || 'Customer';
                // A top-up delta is money received TODAY — the edit forms resend
                // the original deposit date, and backdating the delta row would
                // silently rewrite a past day's income totals. Only a first
                // deposit honors the passed date.
                const rawDepDate = (prevDep > 0 ? null : updates.depositDate) || new Date().toISOString();
                const depDateIso = rawDepDate.match(/^\d{4}-\d{2}-\d{2}$/) ? new Date(rawDepDate).toISOString() : rawDepDate;
                const depTxn = {
                    id: generateUUID(),
                    date: depDateIso,
                    type: 'Income' as const,
                    category: 'កក់ប្រាក់',
                    amount: depAmount,
                    description: `${custName} #DEP-${id.slice(0, 8)}`,
                    addedBy: currentUser?.name || 'System',
                    shipping_co: existingOrder.shipping?.company || null,
                    pay_by: updates.depositMethod || null
                };
                setTransactions(prev => [depTxn, ...prev]);
                supabase.from('transactions').insert([{
                    id: depTxn.id,
                    date: depTxn.date,
                    type: depTxn.type,
                    category: depTxn.category,
                    amount: depTxn.amount,
                    description: depTxn.description,
                    added_by: depTxn.addedBy,
                    pay_by: updates.depositMethod || null,
                    shipping_co: depTxn.shipping_co
                }]).then(({ error }) => {
                    if (error) console.error('Failed to log deposit income:', error);
                });
            }
        }

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
        if (updates.depositAmount !== undefined) dbUpdates.deposit_amount = updates.depositAmount;
        if (updates.depositDate !== undefined) dbUpdates.deposit_date = updates.depositDate || null;
        if (updates.depositMethod !== undefined) dbUpdates.deposit_method = updates.depositMethod || null;
        if (updates.paymentStatus !== undefined) dbUpdates.payment_status = updates.paymentStatus;
        if (updates.orderStatus !== undefined) dbUpdates.order_status = updates.orderStatus;
        if (updates.customer !== undefined) {
            dbUpdates.customer_snapshot = updates.customer;
            if (updates.customer.page !== undefined) {
                dbUpdates.page_source = updates.customer.page;
            }
        }
        // Shipping updates
        if (updates.shipping !== undefined) {
            dbUpdates.shipping_company = updates.shipping.company;
            dbUpdates.tracking_number = updates.shipping.trackingNumber;
            dbUpdates.shipping_status = updates.shipping.status;
            dbUpdates.shipping_cost = updates.shipping.cost;
        }

        // Add Last Edit Info
        const now = new Date().toISOString();
        if (currentUser) {
            dbUpdates.last_edited_at = now;
            dbUpdates.last_edited_by = currentUser.name;
        }

        try {
            // 3. Update 'sales' table
            if (Object.keys(dbUpdates).length > 0) {
                const { error } = await supabase.from('sales').update(dbUpdates).eq('id', id);
                if (error) throw error;
            }

            // 4. Handle Items Update (Delete Old -> Insert New)
            if (updates.items && updates.items.length > 0) {
                // A. Delete existing items
                const { error: deleteError } = await supabase.from('sale_items').delete().eq('sale_id', id);
                if (deleteError) throw deleteError;

                // B. Insert new items
                const itemsPayload = updates.items.map(item => ({
                    id: generateUUID(),
                    sale_id: id,
                    product_id: item.id,
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    image: item.image
                }));

                const { error: insertError } = await supabase.from('sale_items').insert(itemsPayload);
                if (insertError) throw insertError;
            }

            let loggedSpecific = false;

            if (updates.remark !== undefined && existingOrder && updates.remark !== (existingOrder.remark || '')) {
                dispatchActivity({ 
                    action: 'order_updated', 
                    description: `Remark updated for Order #${id.slice(0, 8)}`, 
                    userId: currentUser?.id, 
                    userName: currentUser?.name, 
                    metadata: { 
                        orderId: id, 
                        oldRemark: existingOrder.remark || '',
                        newRemark: updates.remark 
                    } 
                });
                loggedSpecific = true;
            }

            if (updates.shipping?.trackingNumber !== undefined && existingOrder && updates.shipping.trackingNumber !== (existingOrder.shipping?.trackingNumber || '')) {
                dispatchActivity({ 
                    action: 'order_updated', 
                    description: `Tracking ID updated for Order #${id.slice(0, 8)}`, 
                    userId: currentUser?.id, 
                    userName: currentUser?.name, 
                    metadata: { 
                        orderId: id, 
                        oldTracking: existingOrder.shipping?.trackingNumber || '',
                        newTracking: updates.shipping.trackingNumber 
                    } 
                });
                loggedSpecific = true;
            }

            setSalesUpdatedAt(Date.now());
            if (!loggedSpecific) {
                dispatchActivity({ action: 'order_status', description: `Order #${id.slice(0, 8)} updated`, userId: currentUser?.id, userName: currentUser?.name, metadata: { orderId: id } });
            }

            // 5. Log stock-out movement only when shipping status changes to Shipped or Delivered
            if (updates.shipping?.status && existingOrder) {
                const newStatus = updates.shipping.status;
                // Fresh DB status from the top of this function — NOT the possibly
                // stale cache — so a transition updateOrderStatus already applied
                // is a no-op here instead of a second ledger delete/insert.
                const oldStatus = shippingStatusBeforeUpdate || 'Pending';
                // The caller must also have MEANT a change: forms and the tracking
                // field echo the rendered row's status back verbatim, and when the
                // DB has moved on in the meantime that echo must not manufacture a
                // transition (deleting or inserting ledger rows with no stock change).
                const callerIntendedChange = newStatus !== (existingOrder.shipping?.status || 'Pending');
                if (callerIntendedChange && countsAsStockOut(newStatus) && oldStatus !== newStatus) {
                    // Check if stock-out records already exist for this order
                    const { data: existingMovements } = await supabase.from('stock_movements')
                        .select('id')
                        .eq('reference_id', id)
                        .eq('type', 'out');

                    const customerName = updates.customer?.name || existingOrder.customer?.name || '';
                    const customerPhone = updates.customer?.phone || existingOrder.customer?.phone || '';
                    
                    let finalCustomerName = customerName;
                    let finalCustomerPhone = customerPhone;
                    if (!finalCustomerName) {
                        const { data: dbSale } = await supabase.from('sales').select('customer_snapshot').eq('id', id).single();
                        if (dbSale?.customer_snapshot) {
                            finalCustomerName = dbSale.customer_snapshot.name || '';
                            finalCustomerPhone = dbSale.customer_snapshot.phone || '';
                        }
                    }

                    const customerInfo = [finalCustomerName, finalCustomerPhone].filter(Boolean).join(' | ');

                    if (existingMovements && existingMovements.length > 0) {
                        // Update existing records
                        // Only reached when shipping, so the reason/source stay 'Shipped'
                        // and the movement keeps the date the goods actually left
                        // (movement_date is deliberately NOT rewritten here).
                        await supabase.from('stock_movements')
                            .update({
                                reason: 'Shipped',
                                source: 'Order Shipped',
                                customer_name: finalCustomerName,
                                customer_phone: finalCustomerPhone
                            })
                            .eq('reference_id', id)
                            .eq('type', 'out')
                            .then(({ error }) => {
                                if (error) console.error('Failed to update stock-out movements:', error);
                            });
                    } else {
                        // Insert new records
                        const orderItems = updates.items || existingOrder.items || [];

                        const stockOutMovements = orderItems
                            .filter(item => item.id)
                            .map(item => ({
                                product_id: item.id,
                                product_name: item.name || 'Unknown',
                                type: 'out',
                                quantity: item.quantity,
                                unit_price: item.price || 0,
                                // This branch only runs on 'Shipped', so both are fixed.
                                reason: 'Shipped',
                                reference_id: id,
                                source: 'Order Shipped',
                                shipping_co: updates.shipping?.company || existingOrder.shipping?.company || '',
                                note: `Order #${id.slice(0, 8)}${customerInfo ? ' — ' + customerInfo : ''}`,
                                movement_date: getLocalYYYYMMDD(),
                                created_by: currentUser?.id || 'unknown',
                                customer_name: finalCustomerName,
                                customer_phone: finalCustomerPhone
                            }));

                        if (stockOutMovements.length > 0) {
                            supabase.from('stock_movements').insert(stockOutMovements).then(({ error }) => {
                                if (error) console.error('Failed to log stock-out movements:', error);
                            });
                        }
                    }
                } else if (callerIntendedChange && isStockConsumed(oldStatus) && !isStockConsumed(newStatus) && newStatus !== 'Returned') {
                    // Only when the order genuinely comes back out of a shipped/delivered
                    // state — Shipped -> Delivered keeps its record. Only the NEWEST
                    // generation is removed: a re-shipped order carries one out
                    // generation per shipment, and earlier trips stay on the ledger.
                    const { data: outRows } = await supabase.from('stock_movements')
                        .select('id, created_at')
                        .eq('reference_id', id)
                        .eq('type', 'out');
                    if (outRows && outRows.length > 0) {
                        const newest = outRows.reduce((m, r: any) => (r.created_at > m ? r.created_at : m), outRows[0].created_at);
                        const idsToDelete = outRows.filter((r: any) => r.created_at === newest).map((r: any) => r.id);
                        await supabase.from('stock_movements').delete().in('id', idsToDelete);
                    }
                }
            }

        } catch (error: any) {
            console.error('Error updating order:', error);
            alert(`Failed to update order: ${error.message}`);
            // Revert local state if needed (complex without previous state copy)
        }
    };

    const updateOrders = async (ids: string[], updates: Partial<Sale>): Promise<void> => {
        try {
            // Fetch missing orders from DB for accurate transaction logging
            const missingIds = ids.filter(id => !sales.find(s => s.id === id));
            if (missingIds.length > 0) {
                const { data: dbOrders } = await supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)').in('id', missingIds);
                if (dbOrders && dbOrders.length > 0) {
                    const mappedOrders = dbOrders.map(mapSaleEntity);
                    setSales(prev => [...prev, ...mappedOrders] as any);
                    
                    // Small delay to let React state update locally? 
                    // No, setSales is async. Let's just pass the fetched DB order context to updateOrder.
                    // Actually, updateOrder pulls from `sales` from the closure.
                    // This is a common React ref issue. `sales` is stale.
                }
            }

            const promises = ids.map(async id => {
                let currentOrder = sales.find(s => s.id === id);
                
                // fallback to fetch it individually if not in stale cache
                if (!currentOrder) {
                    const { data } = await supabase.from('sales').select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)').eq('id', id).single();
                    if (data) {
                        currentOrder = mapSaleEntity(data);
                        // Temp inject into sales array reference for `updateOrder` closure trick
                        sales.push(currentOrder as any);
                    }
                }

                if (!currentOrder) return Promise.resolve();

                const mergedUpdates = { ...updates };
                // Handle deep merge for shipping if needed
                if (updates.shipping && currentOrder && currentOrder.shipping) {
                    mergedUpdates.shipping = { ...currentOrder.shipping, ...updates.shipping };
                }
                return updateOrder(id, mergedUpdates);
            });
            await Promise.all(promises);
            setSalesUpdatedAt(Date.now());
        } catch (error) {
            console.error('Error batch updating orders:', error);
            throw error;
        }
    };

    const deleteOrders = async (ids: string[]): Promise<void> => {
        try {
            // 1. Fetch DB orders and items directly since local `sales` state is now paginated/stale
            const { data: dbOrders, error: ordersErr } = await supabase.from('sales').select('*').in('id', ids);
            if (ordersErr) throw ordersErr;

            const { data: dbItems, error: itemsErr } = await supabase.from('sale_items').select('*').in('sale_id', ids);
            if (itemsErr) throw itemsErr;

            const ordersToDelete = dbOrders || [];
            const allItemsToDelete = dbItems || [];

            // 1.5 Archive to deleted tables — pick only columns that exist in deleted_orders/deleted_sale_items
            if (ordersToDelete.length > 0) {
                const archiveOrders = ordersToDelete.map(o => ({
                    id: o.id, total: o.total, discount: o.discount, date: o.date,
                    payment_method: o.payment_method, type: o.type, salesman: o.salesman,
                    customer_care: o.customer_care, remark: o.remark, amount_received: o.amount_received,
                    settle_date: o.settle_date, payment_status: o.payment_status, order_status: o.order_status,
                    shipping_company: o.shipping_company, tracking_number: o.tracking_number,
                    shipping_status: o.shipping_status, shipping_cost: o.shipping_cost,
                    customer_snapshot: o.customer_snapshot, page_source: o.page_source,
                    last_edited_at: o.last_edited_at, last_edited_by: o.last_edited_by,
                    created_at: o.created_at, daily_number: o.daily_number
                }));
                // Deposit fields must survive delete+restore, or settling a
                // restored deposit order double-counts revenue. Retry without
                // them if add_deposit_to_deleted_orders.sql hasn't run yet.
                const withDeposits = archiveOrders.map((a, idx) => ({
                    ...a,
                    deposit_amount: ordersToDelete[idx].deposit_amount || 0,
                    deposit_date: ordersToDelete[idx].deposit_date || null,
                    deposit_method: ordersToDelete[idx].deposit_method || null
                }));
                let { error: insOrdErr } = await supabase.from('deleted_orders').insert(withDeposits);
                if (insOrdErr) {
                    ({ error: insOrdErr } = await supabase.from('deleted_orders').insert(archiveOrders));
                }
                if (insOrdErr) throw insOrdErr;
            }
            if (allItemsToDelete.length > 0) {
                const archiveItems = allItemsToDelete.map(i => ({
                    id: i.id, sale_id: i.sale_id, product_id: i.product_id,
                    name: i.name, price: i.price, quantity: i.quantity,
                    image: i.image, created_at: i.created_at
                }));
                const { error: insItemErr } = await supabase.from('deleted_sale_items').insert(archiveItems);
                if (insItemErr) throw insItemErr;
            }

            // 2. Restock Items based on real source of truth
            for (const order of ordersToDelete) {
                // Only restore stock if status is Shipped, Delivered, or Returned
                // (Pending/Ordered means stock wasn't deducted yet, so don't increment)
                const status = order.shipping_status || 'Pending';
                if (['Shipped', 'Delivered', 'Returned'].includes(status)) {
                    const orderItems = allItemsToDelete.filter(item => item.sale_id === order.id);
                    for (const item of orderItems) {
                        // DB Update (Increment)
                        const { data: originProduct } = await supabase.from('products').select('stock').eq('id', item.product_id).single();
                        if (originProduct) {
                            await supabase.from('products').update({ stock: originProduct.stock + item.quantity }).eq('id', item.product_id);
                        }
                    }

                    // Keep the ledger and FIFO pool consistent with the restock:
                    // return this order's sold inventory items to the pool (done
                    // BEFORE the sales rows are deleted, while sale_id still
                    // links them), and remove the NEWEST out-movement generation
                    // — exactly the shipment whose stock was just restored;
                    // earlier trips (already balanced by return/restock rows)
                    // stay on the ledger.
                    await supabase.from('inventory_items')
                        .update({ status: 'in_stock', sale_id: null })
                        .eq('sale_id', order.id)
                        .eq('status', 'sold');
                    const { data: outRows } = await supabase.from('stock_movements')
                        .select('id, created_at')
                        .eq('reference_id', order.id)
                        .eq('type', 'out');
                    if (outRows && outRows.length > 0) {
                        const newest = outRows.reduce((m, r: any) => (r.created_at > m ? r.created_at : m), outRows[0].created_at);
                        const idsToDelete = outRows.filter((r: any) => r.created_at === newest).map((r: any) => r.id);
                        await supabase.from('stock_movements').delete().in('id', idsToDelete);
                    }
                }
            }

            // 3. Batch deletion to avoid API limits (e.g. URL length or max row count)
            const BATCH_SIZE = 500;
            for (let i = 0; i < ids.length; i += BATCH_SIZE) {
                const batch = ids.slice(i, i + BATCH_SIZE);
                // Delete items first (Constraint usually cascades, but good practice)
                const { error: itemsDelErr } = await supabase.from('sale_items').delete().in('sale_id', batch);
                if (itemsDelErr) {
                    console.error('Error deleting items batch:', itemsDelErr);
                    throw itemsDelErr;
                }

                const { error } = await supabase.from('sales').delete().in('id', batch);
                if (error) {
                    console.error(`Error deleting batch ${i}-${i + BATCH_SIZE}:`, error);
                    throw error;
                }
            }

            // 4. Trigger UI Updates
            setProductsUpdatedAt(Date.now());
            setSalesUpdatedAt(Date.now());
            dispatchActivity({ action: 'order_deleted', description: `${ids.length} order(s) deleted`, userId: currentUser?.id, userName: currentUser?.name, metadata: { count: ids.length } });
        } catch (error) {
            console.error('Error deleting orders:', error);
            throw error;
        }
    };

    const restoreOrders = async (ids: string[]): Promise<void> => {
        try {
            const { data: dbOrders, error: ordersErr } = await supabase.from('deleted_orders').select('*').in('id', ids);
            if (ordersErr) throw ordersErr;

            const { data: dbItems, error: itemsErr } = await supabase.from('deleted_sale_items').select('*').in('sale_id', ids);
            if (itemsErr) throw itemsErr;

            const ordersToRestore = dbOrders || [];
            const allItemsToRestore = dbItems || [];

            // Remove deleted_at before inserting back to sales
            const salesToInsert = ordersToRestore.map(({ deleted_at, ...rest }) => rest);

            if (salesToInsert.length > 0) {
                const { error: insOrdErr } = await supabase.from('sales').insert(salesToInsert);
                if (insOrdErr) throw insOrdErr;
            }

            if (allItemsToRestore.length > 0) {
                const { error: insItemErr } = await supabase.from('sale_items').insert(allItemsToRestore);
                if (insItemErr) throw insItemErr;
            }

            // Deduct stock if it was previously restocked upon deletion — and
            // rebuild what the deletion removed from the ledger/FIFO pool, so
            // stock, stock_movements, and inventory_items stay in step.
            for (const order of ordersToRestore) {
                const status = order.shipping_status || 'Pending';
                if (['Shipped', 'Delivered', 'Returned'].includes(status)) {
                    const orderItems = allItemsToRestore.filter(item => item.sale_id === order.id);
                    for (const item of orderItems) {
                        const { data: originProduct } = await supabase.from('products').select('stock').eq('id', item.product_id).single();
                        if (originProduct) {
                            await supabase.from('products').update({ stock: Math.max(0, originProduct.stock - item.quantity) }).eq('id', item.product_id);
                        }

                        // Re-mark FIFO items as sold for this order (deletion
                        // returned them to the pool).
                        const { data: invItems } = await supabase.from('inventory_items')
                            .select('id')
                            .eq('product_id', item.product_id)
                            .eq('status', 'in_stock')
                            .order('created_at', { ascending: true })
                            .limit(item.quantity);
                        if (invItems && invItems.length > 0) {
                            await supabase.from('inventory_items')
                                .update({ status: 'sold', sale_id: order.id })
                                .in('id', invItems.map((i: any) => i.id));
                        }
                    }

                    // Re-log the out movements the deletion removed (dated today
                    // — the original ship date left with the deleted rows).
                    const customerName = order.customer_snapshot?.name || '';
                    const customerPhone = order.customer_snapshot?.phone || '';
                    const restoredMovements = orderItems
                        .filter(item => item.product_id)
                        .map(item => ({
                            product_id: item.product_id,
                            product_name: item.name || 'Unknown',
                            type: 'out',
                            quantity: item.quantity,
                            unit_price: item.price || 0,
                            reason: 'Shipped',
                            reference_id: order.id,
                            source: 'Order Shipped',
                            shipping_co: order.shipping_company || '',
                            note: `Order #${String(order.id).slice(0, 8)} — restored from deleted`,
                            movement_date: getLocalYYYYMMDD(),
                            created_by: currentUser?.id || 'unknown',
                            customer_name: customerName,
                            customer_phone: customerPhone
                        }));
                    if (restoredMovements.length > 0) {
                        const { error: moveErr } = await supabase.from('stock_movements').insert(restoredMovements);
                        if (moveErr) console.error('Failed to re-log movements for restored order:', moveErr);
                    }
                }
            }

            // Delete from deleted tables
            const BATCH_SIZE = 500;
            for (let i = 0; i < ids.length; i += BATCH_SIZE) {
                const batch = ids.slice(i, i + BATCH_SIZE);
                await supabase.from('deleted_sale_items').delete().in('sale_id', batch);
                await supabase.from('deleted_orders').delete().in('id', batch);
            }

            setProductsUpdatedAt(Date.now());
            setSalesUpdatedAt(Date.now());
            dispatchActivity({ action: 'order_restored', description: `${ids.length} order(s) restored`, userId: currentUser?.id, userName: currentUser?.name, metadata: { count: ids.length } });
        } catch (error) {
            console.error('Error restoring orders:', error);
            throw error;
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
            setProductsUpdatedAt(Date.now());
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
        const processedSaleIds = new Set<string>(); // Keep track of processed IDs

        importedOrders.forEach(order => {
            // Skip header row if it somehow got included (check if 'Total' is 'Total' string)
            if (order['Total'] === 'Total' || order['Received'] === 'Received') return;

            const id = order['Order ID'] || Date.now().toString() + Math.random().toString(36).substring(2);
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

            // Prepare Sale Record (only once per ID in this batch)
            if (!processedSaleIds.has(id)) {
                processedSaleIds.add(id);

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
            }

            // Prepare Sale Items Records
            items.forEach(item => {
                const itemId = Date.now().toString() + Math.random().toString(36).substring(2);
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

        // 1. Upsert Sales
        const { data: insertedSales, error: salesError } = await supabase.from('sales').upsert(salesToInsert).select();

        if (salesError) {
            console.error('Error importing orders:', salesError);
            throw new Error('Failed to import orders: ' + salesError.message);
        }

        // 2. Insert Sale Items (if any)
        if (saleItemsToInsert.length > 0) {
            // Clear existing items for these sales to prevent duplicates on re-import
            const saleIdsToClear = salesToInsert.map(s => s.id);
            await supabase.from('sale_items').delete().in('sale_id', saleIdsToClear);

            const { error: itemsError } = await supabase.from('sale_items').insert(saleItemsToInsert);
            if (itemsError) {
                console.error('Error importing sale items:', itemsError);
                // Note: Sales were already upserted.
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
            setSalesUpdatedAt(Date.now());
        }
    };
    const restockOrder = async (orderId: string): Promise<void> => {
        try {
            const localOrder = sales.find(s => s.id === orderId);
            let orderItems = localOrder?.items;
            let customerName = localOrder?.customer?.name || '';
            let customerPhone = localOrder?.customer?.phone || '';

            if (!orderItems) {
                const { data } = await supabase.from('sale_items').select('*').eq('sale_id', orderId);
                if (data) {
                    orderItems = data.map(dbItem => ({
                        id: dbItem.product_id,
                        name: dbItem.name,
                        price: dbItem.price,
                        quantity: dbItem.quantity
                    })) as any;
                }
            }

            // Fetch customer info from DB if not available locally
            if (!customerName) {
                const { data: orderData } = await supabase.from('sales').select('customer_snapshot').eq('id', orderId).single();
                if (orderData?.customer_snapshot) {
                    customerName = orderData.customer_snapshot.name || '';
                    customerPhone = orderData.customer_snapshot.phone || '';
                }
            }

            if (!orderItems || orderItems.length === 0) {
                console.error("No items found for order", orderId);
                return;
            }

            const now = new Date().toISOString();
            const restockRecords = [];

            for (const item of orderItems) {
                if (!item.id) {
                    console.warn(`Skipping stock update for item '${item.name}' because product ID is missing (likely imported).`);
                    continue;
                }

                const qty = Number(item.quantity);
                if (isNaN(qty) || qty <= 0) continue;

                // DB Update (Increment Stock)
                const { data: originProduct, error: productErr } = await supabase.from('products').select('stock').eq('id', item.id).single();

                if (productErr) {
                    console.error(`Failed to find product ${item.id} for restock:`, productErr);
                    continue;
                }

                if (originProduct) {
                    const newStock = Number(originProduct.stock) + qty;
                    await supabase.from('products').update({ stock: newStock }).eq('id', item.id);
                    // Local State Update
                    setProducts(prev => prev.map(p => p.id === item.id ? { ...p, stock: newStock } : p));
                }

                // Prepare restock record
                const restockId = generateUUID();
                // Build note with customer info
                const customerInfo = [customerName, customerPhone].filter(Boolean).join(' | ');
                const noteText = `Restocked from order #${orderId.slice(0, 8)}${customerInfo ? ' — ' + customerInfo : ''}`;

                restockRecords.push({
                    id: restockId,
                    product_id: item.id,
                    quantity: qty,
                    cost: 0,
                    date: now,
                    added_by: currentUser?.name || 'System',
                    note: noteText
                });

                // Local restock history update
                setRestocks(prev => [{
                    id: restockId,
                    productId: item.id,
                    quantity: qty,
                    cost: 0,
                    date: now,
                    addedBy: currentUser?.name || 'System',
                    note: noteText
                }, ...prev]);
            }

            // Return the shipment's FIFO items to the pool — shipping marked them
            // status 'sold' with this sale_id, and without this flip every
            // return/restock cycle permanently drains in_stock rows while
            // products.stock recovers. The status guard keeps re-runs idempotent.
            await supabase.from('inventory_items')
                .update({ status: 'in_stock', sale_id: null })
                .eq('sale_id', orderId)
                .eq('status', 'sold');

            if (restockRecords.length > 0) {
                const { error: insertErr } = await supabase.from('restocks').insert(restockRecords);
                if (insertErr) {
                    console.error("Failed to insert restock records:", insertErr);
                    throw insertErr;
                }

                // Also log to stock_movements for Stock-In tracking
                const stockMovements = restockRecords.map(r => ({
                    product_id: r.product_id,
                    product_name: orderItems?.find(i => i.id === r.product_id)?.name || 'Unknown',
                    type: 'in',
                    quantity: r.quantity,
                    unit_price: 0,
                    source: 'Customer Return',
                    shipping_co: localOrder?.shipping?.company || '',
                    note: r.note,
                    movement_date: getLocalYYYYMMDD(),
                    created_by: currentUser?.id || 'unknown',
                    customer_name: customerName,
                    customer_phone: customerPhone
                }));
                await supabase.from('stock_movements').insert(stockMovements).then(({ error }) => {
                    if (error) console.error('Failed to log stock movements for restock:', error);
                });
            }

            setProductsUpdatedAt(Date.now());
        } catch (error) {
            console.error('Error restocking order:', error);
            throw error;
        }
    };

    const bulkRestockOrders = async (orderIds: string[]): Promise<void> => {
        try {
            // 1. Fetch DB items for all these orders
            const { data: dbItems, error: itemsErr } = await supabase.from('sale_items').select('product_id, quantity, sale_id').in('sale_id', orderIds);
            if (itemsErr) throw itemsErr;

            // Fetch customer info for all orders
            const { data: orderDataList } = await supabase.from('sales').select('id, customer_snapshot').in('id', orderIds);
            const orderCustomerMap: Record<string, { name: string; phone: string }> = {};
            (orderDataList || []).forEach(o => {
                orderCustomerMap[o.id] = {
                    name: o.customer_snapshot?.name || '',
                    phone: o.customer_snapshot?.phone || ''
                };
            });

            // 2. Aggregate quantities by product, track which orders contributed
            const restockItems = dbItems || [];
            const productUpdates: Record<string, number> = {};
            // Track order-to-product mapping for notes
            const productOrderSources: Record<string, Set<string>> = {};
            
            for (const item of restockItems) {
                if (!item.product_id) continue;
                const qty = Number(item.quantity);
                if (isNaN(qty) || qty <= 0) continue;
                productUpdates[item.product_id] = (productUpdates[item.product_id] || 0) + qty;
                if (!productOrderSources[item.product_id]) productOrderSources[item.product_id] = new Set();
                productOrderSources[item.product_id].add(item.sale_id);
            }

            // 3. Update product stock in DB and Local
            // Return the shipments' FIFO items to the pool first (shipping marked
            // them 'sold' with these sale_ids); the status guard keeps re-runs
            // idempotent. Without this every restock permanently drains in_stock
            // rows while products.stock recovers.
            await supabase.from('inventory_items')
                .update({ status: 'in_stock', sale_id: null })
                .in('sale_id', orderIds)
                .eq('status', 'sold');

            const now = new Date().toISOString();
            const restockRecords: any[] = [];
            const localProductUpdates: Record<string, number> = {};

            for (const [productId, addQty] of Object.entries(productUpdates)) {
                // Fetch current stock from DB to avoid race conditions
                const { data: originProduct } = await supabase.from('products').select('stock').eq('id', productId).single();
                if (originProduct) {
                    const newStock = Number(originProduct.stock) + addQty;
                    await supabase.from('products').update({ stock: newStock }).eq('id', productId);
                    localProductUpdates[productId] = newStock;
                }

                // Build note with customer info from contributing orders
                const sourceOrderIds = productOrderSources[productId] ? [...productOrderSources[productId]] : [];
                const customerInfoParts = sourceOrderIds.map(oid => {
                    const c = orderCustomerMap[oid];
                    const info = [c?.name, c?.phone].filter(Boolean).join(' ');
                    return `#${oid.slice(0, 8)}${info ? ' (' + info + ')' : ''}`;
                });
                const noteText = `Bulk restocked from ${customerInfoParts.join(', ')}`;

                const restockId = generateUUID();
                restockRecords.push({
                    id: restockId,
                    product_id: productId,
                    quantity: addQty,
                    cost: 0,
                    date: now,
                    added_by: currentUser?.name || 'System',
                    note: noteText
                });
            }

            if (restockRecords.length > 0) {
                await supabase.from('restocks').insert(restockRecords);
                setRestocks(prev => [...restockRecords.map(r => ({
                    id: r.id,
                    productId: r.product_id,
                    quantity: r.quantity,
                    cost: r.cost,
                    date: r.date,
                    addedBy: r.added_by,
                    note: r.note
                })), ...prev]);

                // Also log to stock_movements for Stock-In tracking
                const stockMovements = restockRecords.map(r => {
                    // A bulk restock can merge the same product from several orders, so
                    // list every contributing customer. Without this the movement showed
                    // "-" in the Supplier / Customer column even though the note named them.
                    const sourceOrders = [...(productOrderSources[r.product_id] || [])];
                    const names = [...new Set(sourceOrders.map(id => orderCustomerMap[id]?.name).filter(Boolean))];
                    const phones = [...new Set(sourceOrders.map(id => orderCustomerMap[id]?.phone).filter(Boolean))];
                    return {
                        product_id: r.product_id,
                        product_name: restockItems.find(i => i.product_id === r.product_id)?.product_id || r.product_id,
                        type: 'in',
                        quantity: r.quantity,
                        unit_price: 0,
                        source: 'Customer Return',
                        shipping_co: '', // Bulk order returns mixed shipping companies
                        note: r.note,
                        movement_date: getLocalYYYYMMDD(),
                        created_by: currentUser?.id || 'unknown',
                        customer_name: names.join(', '),
                        customer_phone: phones.join(', ')
                    };
                });

                // Fetch product names for the movements
                const productIds = [...new Set(stockMovements.map(m => m.product_id))];
                const { data: productData } = await supabase.from('products').select('id, name').in('id', productIds);
                const nameMap: Record<string, string> = {};
                (productData || []).forEach(p => { nameMap[p.id] = p.name; });
                stockMovements.forEach(m => { m.product_name = nameMap[m.product_id] || m.product_id; });

                await supabase.from('stock_movements').insert(stockMovements).then(({ error }) => {
                    if (error) console.error('Failed to log stock movements for bulk restock:', error);
                });
            }

            setProducts(prev => prev.map(p => 
                localProductUpdates[p.id] !== undefined 
                ? { ...p, stock: localProductUpdates[p.id] } 
                : p
            ));
            
            // 4. Update sales records to ReStock and Cancelled
            // DB Update — stamped as an edit, so the Last Edit column shows the
            // restock. Without the stamp a Returned order restocked today kept
            // the older edit's date (this path bypasses updateOrder).
            await supabase.from('sales').update({
                shipping_status: 'ReStock',
                payment_status: 'Cancel',
                ...(currentUser ? { last_edited_at: now, last_edited_by: currentUser.name } : {})
            }).in('id', orderIds);

            // Local State Update
            setSales(prev => prev.map(sale =>
                orderIds.includes(sale.id)
                ? {
                    ...sale,
                    paymentStatus: 'Cancel',
                    lastEditedAt: currentUser ? now : sale.lastEditedAt,
                    lastEditedBy: currentUser ? currentUser.name : sale.lastEditedBy,
                    shipping: { ...(sale.shipping || { company: '', trackingNumber: '', cost: 0 }), status: 'ReStock' as any }
                }
                : sale
            ));

            dispatchActivity({
                action: 'stock_restock',
                description: `Restocked ${orderIds.length} order${orderIds.length === 1 ? '' : 's'}: ${orderIds.map(id => '#' + id.slice(0, 8)).join(', ')}`,
                userId: currentUser?.id,
                userName: currentUser?.name,
                metadata: { orderIds }
            });

            // Trigger single refresh event for UI listeners
            setProductsUpdatedAt(Date.now());
            setSalesUpdatedAt(Date.now());
        } catch (error) {
            console.error('Error bulk restocking orders:', error);
            throw error;
        }
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
                phone: config.phone,
                khrExchangeRate: config.khrExchangeRate || 4100
            }
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup-${new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]}.json`;
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
                setProductsUpdatedAt(Date.now());
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
                                id: Date.now().toString() + Math.random().toString(36).substring(2), // Generate new ID
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
                        phone: jsonData.config.phone,
                        khrExchangeRate: jsonData.config.khrExchangeRate || 4100
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
        const newUser: User = { ...userData, id: Date.now().toString() + Math.random().toString(36).substring(2) };

        // No .select() on the insert: it would request RETURNING * — and once
        // secure_pin_check.sql revokes read access on the pin column, the whole
        // INSERT would be rejected. Nothing needs the returned row anyway.
        const { error } = await supabase.from('users').insert({
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            role_id: newUser.roleId,
            pin: newUser.pin,
            base_salary: newUser.baseSalary || 0,
            daily_target: newUser.dailyTarget || 0,
            weekly_target: newUser.weeklyTarget || 0,
            monthly_target: newUser.monthlyTarget || 0
        });

        if (error) {
            console.error('Failed to add user to database:', error);
            throw new Error('Failed to add user: ' + error.message);
        }

        setUsers(prev => [...prev, { ...newUser, pin: undefined }]);
    };

    const updateUser = async (id: string, updates: Partial<User>) => {
        const dbUpdates: any = {};
        if (updates.name) dbUpdates.name = updates.name;
        if (updates.email) dbUpdates.email = updates.email;
        if (updates.roleId) dbUpdates.role_id = updates.roleId;
        if (updates.pin !== undefined) dbUpdates.pin = updates.pin; // allow empty pin
        if (updates.baseSalary !== undefined) dbUpdates.base_salary = updates.baseSalary;
        if (updates.dailyTarget !== undefined) dbUpdates.daily_target = updates.dailyTarget;
        if (updates.weeklyTarget !== undefined) dbUpdates.weekly_target = updates.weeklyTarget;
        if (updates.monthlyTarget !== undefined) dbUpdates.monthly_target = updates.monthlyTarget;

        const { error } = await supabase.from('users').update(dbUpdates).eq('id', id);
        if (error) {
            console.error('Failed to update user:', error);
            throw new Error('Failed to update user: ' + error.message);
        }

        setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
    };

    const deleteUser = async (id: string) => {
        const { error } = await supabase.from('users').delete().eq('id', id);
        if (error) {
            console.error('Failed to delete user:', error);
            throw new Error('Failed to delete user: ' + error.message);
        }

        setUsers(prev => prev.filter(u => u.id !== id));
    };

    const addRole = async (roleData: Omit<Role, 'id'>) => {
        const newRole: Role = { ...roleData, id: Date.now().toString() };
        const newRoles = [...(config.roles || []), newRole];
        await updateConfig({ ...config, roles: newRoles });
    };

    const updateRole = async (id: string, updates: Partial<Role>) => {
        // The built-in Admin role is always full-access (hasPermission hardcodes it), so
        // its permission list is display-only. Keep it truthful rather than let someone
        // save a half-checked Admin role that still behaves as full access.
        if (id === 'admin' && updates.permissions) {
            updates = { ...updates, permissions: ALL_PERMISSIONS };
        }
        // Self-lockout guard: removing "Manage Users" from your own role would take away
        // access to this very page, with no way back short of editing the database.
        if (
            updates.permissions &&
            currentUser?.roleId === id &&
            currentUser?.roleId !== 'admin' &&
            !updates.permissions.includes('manage_users')
        ) {
            throw new Error('You cannot remove "Manage Users" from your own role — you would lock yourself out of this page.');
        }
        const newRoles = (config.roles || []).map(r => r.id === id ? { ...r, ...updates } : r);
        await updateConfig({ ...config, roles: newRoles });
    };

    const deleteRole = async (id: string) => {
        if (id === 'admin') {
            throw new Error('The Admin role is protected and cannot be deleted.');
        }
        if (users.some(u => u.roleId === id)) {
            throw new Error('This role is still assigned to one or more users. Reassign them before deleting it.');
        }
        if (currentUser?.roleId === id) {
            throw new Error('You cannot delete the role you are currently signed in with.');
        }
        const newRoles = (config.roles || []).filter(r => r.id !== id);
        await updateConfig({ ...config, roles: newRoles });
    };

    const updateStoreAddress = async (address: string) => {
        updateConfig({ ...config, storeAddress: address });
    };

    const updateKhrExchangeRate = async (rate: number) => {
        updateConfig({ ...config, khrExchangeRate: rate });
    };

    const updateStoreProfile = async (data: { storeName?: string; email?: string; phone?: string; storeAddress?: string; timezone?: string; taxRate?: number; currency?: string; khrExchangeRate?: number; logo?: string; telegramBotToken?: string; telegramChatId?: string; telegramConfigs?: TelegramConfig[] }) => {
        const { telegramConfigs, ...restData } = data;
        let newConfig = { ...config, ...restData };
        
        if (telegramConfigs !== undefined) {
            // First, find what's deleted
            const currentIds = config.telegramConfigs?.map(c => c.id) || [];
            const newIds = telegramConfigs.map(c => c.id);
            const deletedIds = currentIds.filter(id => !newIds.includes(id));
            
            if (deletedIds.length > 0) {
                await supabase.from('telegram_notifications').delete().in('id', deletedIds);
            }
            
            // Upsert remaining
            if (telegramConfigs.length > 0) {
                const upsertData = telegramConfigs.map(tc => ({
                    id: tc.id,
                    name: tc.name,
                    bot_token: tc.botToken,
                    chat_id: tc.chatId,
                    trigger_statuses: tc.triggerStatuses,
                    message_template: tc.messageTemplate,
                    note: tc.note
                }));
                const { error } = await supabase.from('telegram_notifications').upsert(upsertData);
                if (error) {
                    console.error("Error upserting telegram configs:", error);
                    throw new Error("Database error saving telegram config: " + error.message);
                }
            }
            
            newConfig.telegramConfigs = telegramConfigs;
        }

        updateConfig(newConfig);
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

    // Warehouse Operations
    const addWarehouse = async (warehouse: Omit<Warehouse, 'id' | 'createdAt' | 'updatedAt'>) => {
        const { data, error } = await supabase.from('warehouses').insert([warehouse]).select().single();
        if (error) throw error;
        setWarehouses(prev => [...prev, { ...data, createdAt: data.created_at, updatedAt: data.updated_at }]);
    };

    const updateWarehouse = async (id: string, updates: Partial<Warehouse>) => {
        const { error } = await supabase.from('warehouses').update(updates).eq('id', id);
        if (error) throw error;
        setWarehouses(prev => prev.map(w => w.id === id ? { ...w, ...updates } : w));
    };

    const deleteWarehouse = async (id: string) => {
        const { error } = await supabase.from('warehouses').delete().eq('id', id);
        if (error) throw error;
        setWarehouses(prev => prev.filter(w => w.id !== id));
    };

    return (
        <StoreContext.Provider value={{
            products,
            cart,
            sales,
            restocks, // Added restocks to context
            customers,
            productsUpdatedAt,
            salesUpdatedAt,
            hasMoreOrders,
            isLoadingMore,
            loadMoreOrders,
            users: users,
            roles: config.roles || [],
            addUser,
            updateUser,
            deleteUser,
            addRole,
            updateRole,
            deleteRole,
            warehouses,
            warehouseStock,
            addWarehouse,
            updateWarehouse,
            deleteWarehouse,
            addToCart,
            removeFromCart,
            updateCartQuantity,
            clearCart,
            processSale,
            addProduct,
            updateProduct,
            deleteProduct,
            deleteProducts,
            addStock, // Added addStock to context
            adjustStock, // Added adjustStock to context
            transactions,
            addTransaction,
            updateTransaction,
            deleteTransaction,
            deleteTransactions,
            addOnlineOrder,
            updateOrderStatus,
            updateOrder,
            updateOrders,
            deleteOrders,
            restoreOrders,
            reorderRows,
            addCustomer,
            updateCustomer,
            deleteCustomer,
            shippingCompanies: config.shippingCompanies,
            shippingRates: config.shippingRates || {},
            updateShippingRate,
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
            customerCare,
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
            pinnedOrderColumns,
            toggleOrderColumnPin,
            productOrder: config.productOrder || [],
            updateProductOrder,
            updateCart,
            importProducts,
            importOrders,
            restockOrder,
            bulkRestockOrders,
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
            logo: config.logo || '',
            email: config.email || '',
            phone: config.phone || '',
            telegramBotToken: config.telegramBotToken || '',
            telegramChatId: config.telegramChatId || '',
            telegramConfigs: config.telegramConfigs || [],
            updateStoreAddress,
            updateStoreProfile,
            timezone: config.timezone || 'Asia/Phnom_Penh',
            updateTimezone,
            taxRate: config.taxRate || 0,
            updateTaxRate,
            currency: config.currency || 'USD ($)',
            updateCurrency,
            khrExchangeRate: config.khrExchangeRate || 4100,
            updateKhrExchangeRate,
            blockedCustomers: config.blockedCustomers || [],
            addBlockedCustomer,
            addBlockedCustomers,
            removeBlockedCustomer,
            removeBlockedCustomers,
            updateBlockedCustomer,
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
