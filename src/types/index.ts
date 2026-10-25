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
    // Upfront deposit (always kept, even if the order is later cancelled/returned).
    depositAmount?: number;
    depositDate?: string;
    depositMethod?: string;
    depositAccountId?: string; // chart-of-accounts cash/bank account the settlement is deposited into (persisted: sales.deposit_account_id)
    depositAccountName?: string; // transient, UI-only: resolved account name passed through updateOrder() for the income transaction's "Pay by" — never persisted to the sales table itself
    receiptReference?: string; // transient, UI-only: cheque/transfer reference passed through updateOrder() for the income transaction — never persisted to the sales table
    receiptNotes?: string; // transient, UI-only: note passed through updateOrder() for the income transaction — never persisted to the sales table
    postToLedger?: boolean; // transient, UI-only: when true, updateOrder() also posts a Draft journal entry for this payment — never persisted to the sales table
    lastEditedAt?: string; // ISO string
    lastEditedBy?: string;
    paymentStatus?: 'Unpaid' | 'Deposit' | 'Paid' | 'PdFee' | 'Get File' | 'Cancel';
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

export interface CustomDistrict {
    code: string;
    provinceCode: string;
    khmer: string;
    latin: string;
}

export interface CustomCommune {
    code: string;
    districtCode: string;
    khmer: string;
    latin: string;
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
    // Returns the created product (null on failure) so callers can select it.
    addProduct: (product: Omit<Product, 'id'>) => Promise<Product | null>;
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
    updateShippingRate: (company: string, rate: number) => Promise<void>;
    // Per-company tracking page URL templates ({tracking} = waybill number).
    trackingUrlTemplates: Record<string, string>;
    updateTrackingUrlTemplate: (company: string, template: string) => Promise<void>;
    salesmen: string[];
    categories: string[];
    pages: string[];
    customerCare: string[];

    addShippingCompany: (name: string) => Promise<void>;
    removeShippingCompany: (name: string) => Promise<void>;
    addSalesman: (name: string) => Promise<void>;
    removeSalesman: (name: string) => Promise<void>;
    addCategory: (name: string) => Promise<void>;
    removeCategory: (name: string) => Promise<void>;
    addPage: (name: string) => Promise<void>;
    removePage: (name: string) => Promise<void>;
    addCustomerCare: (name: string) => Promise<void>;
    removeCustomerCare: (name: string) => Promise<void>;

    // Cities
    cities: string[];
    addCity: (name: string) => Promise<void>;
    removeCity: (name: string) => Promise<void>;

    // Custom districts/communes layered on top of the official data/cambodia.json
    // hierarchy (Sales Setup's Provinces browser) — add a local one, or hide an
    // official one that doesn't apply to this shop.
    customDistricts: CustomDistrict[];
    customCommunes: CustomCommune[];
    removedDistrictCodes: string[];
    removedCommuneCodes: string[];
    addCustomDistrict: (provinceCode: string, name: string) => Promise<void>;
    removeDistrictEntry: (code: string, isCustom: boolean) => Promise<void>;
    addCustomCommune: (districtCode: string, name: string) => Promise<void>;
    removeCommuneEntry: (code: string, isCustom: boolean) => Promise<void>;

    // Payment Methods
    paymentMethods: string[];
    addPaymentMethod: (name: string) => Promise<void>;
    removePaymentMethod: (name: string) => Promise<void>;

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
    removeBlockedCustomers: (phones: string[]) => void;
    updateBlockedCustomer: (phone: string, updates: Partial<BlockedCustomer>) => void;

    // User & Role Management
    users: User[];
    roles: Role[];
    addUser: (user: Omit<User, 'id'>) => Promise<void>;
    updateUser: (id: string, user: Partial<User>) => Promise<void>;
    deleteUser: (id: string) => Promise<void>;
    addRole: (role: Omit<Role, 'id'>) => Promise<Role>;
    updateRole: (id: string, role: Partial<Role>) => Promise<void>;
    deleteRole: (id: string) => Promise<void>;

    // Purchasing module defaults (stored in the shared app config)
    purchaseSettings: PurchaseSettings;
    updatePurchaseSettings: (settings: PurchaseSettings) => Promise<void>;

    // Wholesale module defaults (stored in the shared app config)
    wholesaleSettings: WholesaleSettings;
    updateWholesaleSettings: (settings: WholesaleSettings) => Promise<void>;

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
    | 'manage_accounting'
    | 'use_checkbox'
    | 'restock_orders';

// Canonical runtime list of every permission. Keep in sync with the Permission union
// above. The `satisfies` check makes TypeScript flag any value that isn't a valid
// Permission, so a typo here fails the build.
export const ALL_PERMISSIONS = [
    'view_dashboard', 'process_sales', 'manage_inventory', 'view_reports', 'manage_settings',
    'manage_users', 'manage_orders', 'create_orders', 'view_orders', 'view_inventory_stock',
    'manage_income_expense', 'manage_attendance', 'manage_payroll', 'manage_hr', 'manage_crm',
    'manage_procurement', 'manage_accounting', 'use_checkbox', 'restock_orders',
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
    // Write-only from the client's perspective: set/changed via User Management,
    // verified via the check_pin RPC, never read back from the database.
    pin?: string;
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
    // Optional sub-category shown next to the name (e.g. Current Asset).
    // Needs migrations/add_account_subtype.sql on the instance.
    sub_type?: string | null;
    description?: string;
    is_active: boolean;
    created_at?: string;
}

// ── Purchasing setup (defaults for new buy-side documents) ────────────────
export interface PurchaseTermPreset {
    name: string;
    days: number;
}

export interface PurchaseOpeningBalance {
    supplier_id: string;
    amount: number;
    as_of?: string; // YYYY-MM-DD
}

export interface PurchaseSettings {
    vatRate?: number;               // percent
    paymentTermsDays?: number;      // default days until a PO's payment is due
    overReceiptTolerance?: number;  // percent over the ordered quantity a delivery may contain
    defaultWarehouseId?: string;
    defaultPaymentAccountId?: string; // chart_of_accounts id (bank or cash)
    numbering?: {
        requests?: string;
        orders?: string;
        bills?: string;
        payments?: string;
        payRequests?: string;
        opening?: string;
    };
    paymentTerms?: PurchaseTermPreset[];
    apOpeningBalances?: PurchaseOpeningBalance[];
}

// ── Wholesale setup (defaults for new sell-side documents) ────────────────
export interface WholesaleOpeningBalance {
    customer_id: string;
    amount: number;
    as_of?: string; // YYYY-MM-DD
}

export interface WholesaleSettings {
    vatRate?: number;              // percent
    paymentTermsDays?: number;     // default days until a wholesale order's payment is due
    defaultWarehouseId?: string;
    defaultPaymentAccountId?: string; // chart_of_accounts id (bank or cash)
    numbering?: {
        orders?: string;
        receipts?: string;
        opening?: string;
    };
    paymentTerms?: PurchaseTermPreset[];
    arOpeningBalances?: WholesaleOpeningBalance[];
}

export interface JournalEntryLine {
    id?: string;
    journal_entry_id?: string;
    account_id: string;
    debit: number;
    credit: number;
    // Optional per-line note (migrations/add_journal_entry_line_description.sql).
    description?: string;
    created_at?: string;
    // Joined field for UI convenience
    account?: ChartOfAccount;
}

export interface JournalEntry {
    id: string;
    date: string; // YYYY-MM-DD
    description?: string;
    reference_id?: string;
    // Human-readable display ID (JE-{globalSeq}-{TYPE}-{YYYYMMDD}-{dailySeq});
    // additive to reference_id, needs migrations/add_journal_entry_number.sql.
    // Older rows simply don't have one — see src/utils/journalEntryNumber.ts.
    entry_number?: string;
    // Posted (final) or Draft; needs migrations/add_entry_status.sql.
    status?: string;
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
    payments?: { payment_date?: string }[];
}

export interface SupplierPayment {
    id: string;
    purchase_order_id: string;
    supplier_id: string;
    amount: number;
    payment_date: string;
    payment_method?: string;
    notes?: string;
    paid_from_account_id?: string; // chart-of-accounts cash/bank account (migrations/add_supplier_payment_account.sql)
    created_at?: string;
    // Joined field for UI
    supplier?: Supplier;
}

// ==========================================
// Wholesale Orders (customer credit sales) — mirror of Purchase Orders
// ==========================================
export interface WholesaleOrderItem {
    id?: string;
    wholesale_order_id?: string;
    product_id: string;
    product_name?: string;
    quantity: number;
    unit_price: number;
    created_at?: string;
}

export interface CustomerPayment {
    id: string;
    wholesale_order_id: string;
    amount: number;
    payment_date: string;
    payment_method?: string;
    notes?: string;
    received_in_account_id?: string; // chart-of-accounts cash/bank account (migrations/add_customer_payment_account.sql)
    created_at?: string;
}

export interface WholesaleCustomer {
    id: string;
    name: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    address?: string;
    note?: string;
    is_active: boolean;
    created_at?: string;
}

export interface WholesaleOrder {
    id: string;
    invoice_number?: string;
    customer_name: string;
    customer_phone?: string;
    warehouse_id?: string;
    order_date: string;
    due_date?: string;
    status: 'Open' | 'Delivered' | 'Cancelled';
    total_amount: number;
    amount_paid?: number;
    payment_status?: 'Unpaid' | 'Partial' | 'Paid';
    notes?: string;
    created_by?: string;
    created_at?: string;
    // Joined for UI
    items?: WholesaleOrderItem[];
    payments?: CustomerPayment[];
}

// ==========================================
// CRM Types
// ==========================================
export interface Lead {
    id: string;
    name: string;
    company_name?: string;
    email?: string;
    phone?: string;
    status: 'New' | 'Contacted' | 'Qualified' | 'Proposal Sent' | 'Won' | 'Lost';
    source?: string;
    assigned_to?: string;
    notes?: string;
    created_at?: string;
}

export interface Interaction {
    id: string;
    lead_id?: string;
    type: 'Call' | 'Email' | 'Meeting';
    date: string;
    notes?: string;
    performed_by?: string;
    created_at?: string;
    // Joined for UI
    lead?: Lead;
}

export interface QuotationItem {
    name: string;
    quantity: number;
    unit_price: number;
}

export interface Quotation {
    id: string;
    lead_id?: string;
    total_amount: number;
    status: 'Draft' | 'Sent' | 'Accepted' | 'Rejected';
    valid_until?: string;
    items: QuotationItem[];
    created_at?: string;
    // Joined for UI
    lead?: Lead;
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
