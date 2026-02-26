export interface Product {
    id: string;
    name: string;
    model: string;
    price: number;
    stock: number;
    lowStockThreshold?: number;
    image: string;
    category: string;
    createdAt?: string;
}

export interface CartItem extends Product {
    quantity: number;
}

export interface Customer {
    id: string;
    name: string;
    phone: string;
    email?: string;
    address?: string; // keeping it simple for now
    city?: string;
    platform?: 'Facebook' | 'TikTok' | 'Telegram' | 'Walk-in';
    page?: string;
}

export interface Sale {
    id: string;
    items: CartItem[];
    total: number;
    date: string; // ISO string
    discount?: number;
    paymentMethod: 'Cash' | 'Card' | 'QR' | 'Bank Transfer' | 'COD';
    type: 'POS' | 'Online';
    salesman?: string;
    customerCare?: string;
    remark?: string;
    amountReceived?: number;
    settleDate?: string;
    lastEditedAt?: string; // ISO string
    lastEditedBy?: string;
    paymentStatus?: 'Paid' | 'Unpaid' | 'Settled' | 'Not Settle' | 'Cancel' | 'Pending';
    orderStatus?: 'Open' | 'Closed';
    orderIndex?: number;
    customer?: {
        id?: string; // Added optional ID to link to Customer entity
        name: string;
        phone: string;
        city?: string; // Added city
        address?: string;
        platform?: 'Facebook' | 'TikTok' | 'Telegram' | 'Walk-in';
        page?: string;
    };
    shipping?: {
        company: string;
        trackingNumber: string;
        status: 'Pending' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned' | 'ReStock' | 'Ordered';
        cost: number;
        staffName?: string;
    };
}

export interface Restock {
    id: string;
    productId: string;
    quantity: number;
    cost: number;
    date: string;
    addedBy?: string;
    note?: string;
}

export interface Transaction {
    id: string;
    type: 'Income' | 'Expense';
    amount: number;
    category?: string;
    description?: string;
    date: string;
    added_by?: string;
    created_at?: string;
}

export interface StoreContextType {
    products: Product[];
    cart: CartItem[];
    sales: Sale[];
    restocks: Restock[]; // Added restocks
    transactions: Transaction[]; // Added transactions
    customers: Customer[]; // Added customers
    productsUpdatedAt: number; // Added to trigger re-fetches
    salesUpdatedAt: number;
    addToCart: (product: Product) => void;
    removeFromCart: (productId: string) => void;
    updateCartQuantity: (productId: string, quantity: number) => void;
    updateCart: (items: CartItem[]) => void;
    clearCart: () => void;
    processSale: (paymentMethod: Sale['paymentMethod'], discount?: number, customer?: Sale['customer']) => void; // Updated signature
    addOnlineOrder: (order: Omit<Sale, 'id'>) => Promise<void>;
    updateOrderStatus: (id: string, status: NonNullable<Sale['shipping']>['status'], trackingNumber?: string, shippingCompany?: string) => void;
    addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
    updateProduct: (id: string, product: Partial<Product>) => Promise<void>;
    deleteProduct: (id: string) => Promise<void>;
    deleteProducts: (ids: string[]) => Promise<void>;
    updateOrder: (id: string, updates: Partial<Sale>) => Promise<void>;
    updateOrders: (ids: string[], updates: Partial<Sale>) => Promise<void>;
    deleteOrders: (ids: string[]) => Promise<void>;
    reorderRows: (activeIds: string[], overId: string, leadId: string) => void;

    // Restock Management
    addStock: (productId: string, quantity: number, cost?: number, note?: string) => Promise<void>;

    // Customer Management
    addCustomer: (customer: Omit<Customer, 'id'>) => void;
    updateCustomer: (id: string, customer: Partial<Customer>) => void;
    deleteCustomer: (id: string) => void;

    // Transaction Management
    addTransaction: (transaction: Omit<Transaction, 'id' | 'created_at'>) => Promise<void>;
    updateTransaction: (id: string, transaction: Partial<Transaction>) => Promise<void>;
    deleteTransaction: (id: string) => Promise<void>;

    refreshData: (silent?: boolean) => Promise<void>;
    loadMoreOrders: () => Promise<void>;
    hasMoreOrders: boolean;
    isLoadingMore: boolean;

    shippingCompanies: string[];
    salesmen: string[];
    categories: string[];
    pages: string[];
    customerCare: string[];

    addShippingCompany: (name: string) => void;
    removeShippingCompany: (name: string) => void;
    addSalesman: (name: string) => void;
    removeSalesman: (name: string) => void;
    addCategory: (name: string) => void;
    removeCategory: (name: string) => void;
    addPage: (name: string) => void;
    removePage: (name: string) => void;
    addCustomerCare: (name: string) => void;
    removeCustomerCare: (name: string) => void;

    // Cities
    cities: string[];
    addCity: (name: string) => void;
    removeCity: (name: string) => void;

    // Payment Methods
    paymentMethods: string[];
    addPaymentMethod: (name: string) => void;
    removePaymentMethod: (name: string) => void;

    editingOrder: Sale | null;
    setEditingOrder: (order: Sale | null) => void;

    // Pinned
    pinnedProductIds: string[];
    toggleProductPin: (productId: string) => void;
    pinnedOrderColumns: string[];
    toggleOrderColumnPin: (columnId: string) => void;

    importProducts: (products: any[]) => Promise<void>;
    importOrders: (orders: any[]) => Promise<void>;
    restockOrder: (orderId: string) => Promise<void>;
    backupData: () => Promise<void>;
    restoreData: (jsonData: any) => Promise<void>;

    // Authentication
    currentUser: User | null;
    login: (pin: string, userId?: string) => Promise<boolean>;
    logout: () => void;
    hasPermission: (permission: import('./index').Permission) => boolean;

    // Loading State
    isLoading: boolean;

    // Store Config
    storeAddress: string;
    storeName: string;
    logo?: string;
    email: string;
    phone: string;
    timezone: string;
    updateTimezone: (timezone: string) => void;
    taxRate: number;
    updateTaxRate: (rate: number) => void;
    currency: string;
    updateCurrency: (currency: string) => void;
    updateStoreAddress: (address: string) => void; // Keep for backward compatibility or refactor
    updateStoreProfile: (data: { storeName?: string; email?: string; phone?: string; storeAddress?: string; timezone?: string; taxRate?: number; currency?: string; logo?: string }) => void;

    // User & Role Management
    users: User[];
    roles: Role[];
    addUser: (user: Omit<User, 'id'>) => Promise<void>;
    updateUser: (id: string, user: Partial<User>) => Promise<void>;
    deleteUser: (id: string) => Promise<void>;
    addRole: (role: Omit<Role, 'id'>) => Promise<void>;
    updateRole: (id: string, role: Partial<Role>) => Promise<void>;
    deleteRole: (id: string) => Promise<void>;
}


export type Permission =
    | 'view_dashboard'
    | 'manage_inventory'
    | 'view_reports'
    | 'manage_settings'
    | 'manage_users'
    | 'manage_orders'
    | 'create_orders'
    | 'view_orders'
    | 'view_inventory_stock'
    | 'manage_income_expense';

export interface Role {
    id: string;
    name: string;
    description: string;
    permissions: Permission[];
}

export interface User {
    id: string;
    name: string;
    email: string;
    roleId: string;
    pin?: string; // Optional numeric PIN for quick login
    avatar?: string;
}
