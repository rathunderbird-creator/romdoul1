export interface Product {
    id: string;
    name: string;
    model: string;
    price: number;
    stock: number;
    image: string;
    category: string;
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
    paymentStatus?: 'Paid' | 'Unpaid' | 'Settle' | 'Not Settle' | 'Cancel';
    orderStatus?: 'Open' | 'Closed';
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
        status: 'Pending' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned';
        cost: number;
        staffName?: string;
    };
}

export interface StoreContextType {
    products: Product[];
    cart: CartItem[];
    sales: Sale[];
    customers: Customer[]; // Added customers
    addToCart: (product: Product) => void;
    removeFromCart: (productId: string) => void;
    updateCartQuantity: (productId: string, quantity: number) => void;
    updateCart: (items: CartItem[]) => void;
    clearCart: () => void;
    processSale: (paymentMethod: Sale['paymentMethod'], discount?: number, customer?: Sale['customer']) => void; // Updated signature
    addOnlineOrder: (order: Omit<Sale, 'id' | 'date'>) => void;
    updateOrderStatus: (id: string, status: NonNullable<Sale['shipping']>['status'], trackingNumber?: string) => void;
    addProduct: (product: Omit<Product, 'id'>) => void;
    updateProduct: (id: string, product: Partial<Product>) => void;
    deleteProduct: (id: string) => void;
    deleteProducts: (ids: string[]) => void;

    // Customer Management
    addCustomer: (customer: Omit<Customer, 'id'>) => void;
    updateCustomer: (id: string, customer: Partial<Customer>) => void;
    deleteCustomer: (id: string) => void;

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
    addPaymentMethod: (method: string) => void;
    removePaymentMethod: (method: string) => void;

    updateOrder: (id: string, order: Partial<Sale>) => void;
    deleteOrders: (ids: string[]) => void;
    editingOrder: Sale | null;
    setEditingOrder: (order: Sale | null) => void;

    // Pinned Products
    pinnedProductIds: string[];
    toggleProductPin: (productId: string) => void;

    // Pinned Order Columns
    pinnedOrderColumns: string[];
    toggleOrderColumnPin: (columnId: string) => void;
}
