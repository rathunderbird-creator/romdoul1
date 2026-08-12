export interface Product {
    id: string;
    name: string;
    model: string;
    sku?: string;
    price: number;
    purchaseCost?: number;
    stock: number;
    lowStockThreshold?: number;
    unitOfMeasure?: string;
    lowStockAlert?: boolean;
    reorderLevel?: number;
    image: string;
    category: string;
    invoiceNumber?: string;
    supplier?: string;
    isActive?: boolean;
    createdAt?: string;
}

export interface InventoryItem {
    id: string;
    productId: string;
    costOfPurchase: number;
    status: 'in_stock' | 'sold' | 'returned';
    saleId?: string;
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
    paymentStatus?: 'Unpaid' | 'Paid' | 'Get File' | 'Cancel';
    orderStatus?: 'Open' | 'Closed';
    orderIndex?: number;
    pageSource?: string;
    isPrinted?: boolean;
    customer?: {
        id?: string; // Added optional ID to link to Customer entity
        name: string;
        phone: string;
        city?: string; // Added city
        district?: string;
        commune?: string;
        village?: string;
        address?: string;
        platform?: 'Facebook' | 'TikTok' | 'Telegram' | 'Walk-in';
        page?: string;
    };
    shipping?: {
        company: string;
        trackingNumber: string;
        status: 'Pending' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned' | 'ReStock' | 'Drafted' | 'Confirmed';
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
    shipping_co?: string | null;
    pay_by?: string | null;
}

export interface StaffAttendance {
    id: string;
    userId: string;
    date: string;
    status: 'Present' | 'Absent' | 'Late' | 'Half Day' | 'Leave';
    clockIn?: string;
    clockOut?: string;
    notes?: string;
}

export interface TelegramConfig {
    id: string;
    name: string;
    botToken: string;
    chatId: string;
    triggerStatuses: string[];
    messageTemplate?: string;
    note?: string;
}

export interface BlockedCustomer {
    phone: string;
    name: string;
    reason?: string;
    blockedAt: string;
    blockedBy?: string;
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
    processSale: (paymentMethod: Sale['paymentMethod'], discount?: number, customer?: Sale['customer']) => Promise<Sale | undefined>;
    addOnlineOrder: (order: Omit<Sale, 'id'>) => Promise<Sale>;
    updateOrderStatus: (id: string, status: NonNullable<Sale['shipping']>['status'], trackingNumber?: string, shippingCompany?: string) => void;
    addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
    updateProduct: (id: string, product: Partial<Product>) => Promise<void>;
    deleteProduct: (id: string) => Promise<void>;
    deleteProducts: (ids: string[]) => Promise<void>;
    updateOrder: (id: string, updates: Partial<Sale>) => Promise<void>;
    updateOrders: (ids: string[], updates: Partial<Sale>) => Promise<void>;
    deleteOrders: (ids: string[]) => Promise<void>;
    restoreOrders: (ids: string[]) => Promise<void>;
    reorderRows: (activeIds: string[], overId: string, leadId: string) => void;

    // Product Ordering
    productOrder: string[];
    updateProductOrder: (order: string[]) => void;

    // Restock Management
    addStock: (productId: string, quantity: number, cost?: number, note?: string, supplier?: string) => Promise<void>;
    adjustStock: (productId: string, newStock: number, reason: string) => Promise<void>;

    // Customer Management
    addCustomer: (customer: Omit<Customer, 'id'>) => void;
    updateCustomer: (id: string, customer: Partial<Customer>) => void;
    deleteCustomer: (id: string) => void;

    // Transaction Management
    addTransaction: (transaction: Omit<Transaction, 'id' | 'created_at'>) => Promise<void>;
    updateTransaction: (id: string, transaction: Partial<Transaction>) => Promise<void>;
    deleteTransaction: (id: string) => Promise<void>;
    deleteTransactions: (ids: string[]) => Promise<void>;

    refreshData: (silent?: boolean) => Promise<void>;
    loadMoreOrders: () => Promise<void>;
    hasMoreOrders: boolean;
    isLoadingMore: boolean;

    shippingCompanies: string[];
    shippingRates: Record<string, number>;
    updateShippingRate: (company: string, rate: number) => void;
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
    bulkRestockOrders: (orderIds: string[]) => Promise<void>;
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
    telegramBotToken?: string;
    telegramChatId?: string;
    telegramConfigs?: TelegramConfig[];
    timezone: string;
    updateTimezone: (timezone: string) => void;
    taxRate: number;
    updateTaxRate: (rate: number) => void;
    currency: string;
    updateCurrency: (currency: string) => void;
    khrExchangeRate: number;
    updateKhrExchangeRate: (rate: number) => void;
    updateStoreAddress: (address: string) => void; // Keep for backward compatibility or refactor
    updateStoreProfile: (data: { storeName?: string; email?: string; phone?: string; storeAddress?: string; timezone?: string; taxRate?: number; currency?: string; khrExchangeRate?: number; logo?: string; telegramBotToken?: string; telegramChatId?: string; telegramConfigs?: TelegramConfig[] }) => void;

    // Blocked Customers (Scammer Blacklist)
    blockedCustomers: BlockedCustomer[];
    addBlockedCustomer: (customer: BlockedCustomer) => Promise<void>;
    addBlockedCustomers: (customers: BlockedCustomer[]) => Promise<void>;
    removeBlockedCustomer: (phone: string) => void;
    updateBlockedCustomer: (phone: string, updates: Partial<BlockedCustomer>) => void;

    // User & Role Management
    users: User[];
    roles: Role[];
    addUser: (user: Omit<User, 'id'>) => Promise<void>;
    updateUser: (id: string, user: Partial<User>) => Promise<void>;
    deleteUser: (id: string) => Promise<void>;
    addRole: (role: Omit<Role, 'id'>) => Promise<void>;
    updateRole: (id: string, role: Partial<Role>) => Promise<void>;
    deleteRole: (id: string) => Promise<void>;

    // Warehouses
    warehouses: Warehouse[];
    warehouseStock: WarehouseStock[];
    addWarehouse: (warehouse: Omit<Warehouse, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    updateWarehouse: (id: string, updates: Partial<Warehouse>) => Promise<void>;
    deleteWarehouse: (id: string) => Promise<void>;
}

export interface Warehouse {
    id: string;
    name: string;
    address?: string;
    contact?: string;
    capacity?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface WarehouseStock {
    id: string;
    warehouseId: string;
    productId: string;
    quantity: number;
    createdAt?: string;
    updatedAt?: string;
}


export type Permission =
    | 'view_dashboard'
    | 'process_sales'
    | 'manage_inventory'
    | 'view_reports'
    | 'manage_settings'
    | 'manage_users'
    | 'manage_orders'
    | 'create_orders'
    | 'view_orders'
    | 'view_inventory_stock'
    | 'manage_income_expense'
    | 'manage_attendance'
    | 'manage_payroll'
    | 'manage_hr'
    | 'manage_crm'
    | 'manage_procurement'
    | 'manage_accounting';

// Canonical runtime list of every permission. Keep in sync with the Permission union
// above. The `satisfies` check makes TypeScript flag any value that isn't a valid
// Permission, so a typo here fails the build.
export const ALL_PERMISSIONS = [
    'view_dashboard', 'process_sales', 'manage_inventory', 'view_reports', 'manage_settings',
    'manage_users', 'manage_orders', 'create_orders', 'view_orders', 'view_inventory_stock',
    'manage_income_expense', 'manage_attendance', 'manage_payroll', 'manage_hr', 'manage_crm',
    'manage_procurement', 'manage_accounting',
] satisfies Permission[];

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
    baseSalary?: number;
    dailyTarget?: number;
    weeklyTarget?: number;
    monthlyTarget?: number;
}

// ==========================================
// ERP: Accounting & Finance Types
// ==========================================
export interface ChartOfAccount {
    id: string;
    account_code: string;
    account_name: string;
    account_type: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';
    description?: string;
    is_active: boolean;
    created_at?: string;
}

export interface JournalEntryLine {
    id?: string;
    journal_entry_id?: string;
    account_id: string;
    debit: number;
    credit: number;
    created_at?: string;
    // Joined field for UI convenience
    account?: ChartOfAccount;
}

export interface JournalEntry {
    id: string;
    date: string; // YYYY-MM-DD
    description?: string;
    reference_id?: string;
    created_at?: string;
    lines?: JournalEntryLine[];
}

// ==========================================
// ERP: Procurement Types
// ==========================================
export interface Supplier {
    id: string;
    name: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    address?: string;
    tax_id?: string;
    is_active: boolean;
    created_at?: string;
}

export interface PurchaseOrderItem {
    id?: string;
    purchase_order_id?: string;
    product_id: string;
    quantity: number;
    unit_price: number;
    created_at?: string;
    // Joined field for UI
    product?: Product;
}

export interface PurchaseOrder {
    id: string;
    supplier_id: string;
    order_date: string;
    expected_delivery_date?: string;
    status: 'Draft' | 'Sent' | 'Received' | 'Cancelled';
    total_amount: number;
    payment_status?: 'Unpaid' | 'Partial' | 'Paid';
    amount_paid?: number;
    payment_due_date?: string;
    invoice_number?: string;
    notes?: string;
    created_at?: string;
    // Joined fields for UI
    supplier?: Supplier;
    items?: PurchaseOrderItem[];
}

export interface SupplierPayment {
    id: string;
    purchase_order_id: string;
    supplier_id: string;
    amount: number;
    payment_date: string;
    payment_method?: string;
    notes?: string;
    created_at?: string;
}

// ==========================================
// ERP: HR & Payroll Types
// ==========================================
export interface Employee {
    id: string;
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    department?: string;
    position?: string;
    hire_date?: string;
    base_salary: number;
    status: string;
    created_at?: string;
}

export interface LeaveRequest {
    id: string;
    employee_id: string;
    leave_type: string;
    start_date: string;
    end_date: string;
    status: string;
    reason?: string;
    created_at?: string;
    // Joined field for UI
    employee?: Employee;
}

export interface PayrollRun {
    id: string;
    employee_id: string;
    month: string;
    base_pay: number;
    bonus: number;
    deductions: number;
    net_pay: number;
    payment_status: string;
    payment_date?: string;
    created_at?: string;
    // Joined field for UI
    employee?: Employee;
}
