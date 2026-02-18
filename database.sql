-- Enable UUID extension (optional, if you want to generate UUIDs db-side)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Products Table
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT,
    price NUMERIC DEFAULT 0,
    stock NUMERIC DEFAULT 0,
    low_stock_threshold NUMERIC DEFAULT 5,
    image TEXT,
    category TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Customers Table
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    platform TEXT,
    page TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Sales Table
CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    total NUMERIC DEFAULT 0,
    discount NUMERIC DEFAULT 0,
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    payment_method TEXT,
    type TEXT,
    salesman TEXT,
    customer_care TEXT,
    remark TEXT,
    amount_received NUMERIC DEFAULT 0,
    settle_date TIMESTAMP WITH TIME ZONE,
    payment_status TEXT,
    order_status TEXT,
    shipping_company TEXT,
    tracking_number TEXT,
    shipping_status TEXT,
    shipping_cost NUMERIC DEFAULT 0,
    customer_snapshot JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Sale Items Table
CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL, -- Nullable if product deleted or imported without ID
    name TEXT NOT NULL,
    price NUMERIC DEFAULT 0,
    quantity NUMERIC DEFAULT 1,
    image TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Users Table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    role_id TEXT NOT NULL,
    pin TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. App Config Table (Stores dynamic configuration, roles)
CREATE TABLE IF NOT EXISTS app_config (
    id BIGINT PRIMARY KEY,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initial Data for App Config
INSERT INTO app_config (id, data)
VALUES (1, '{
    "shippingCompanies": ["J&T", "VET", "JS Express"],
    "salesmen": ["Sokheng", "Thida"],
    "categories": ["Portable", "PartyBox"],
    "pages": ["Chantha Sound"],
    "customerCare": ["Chantha"],
    "paymentMethods": ["Cash", "QR"],
    "cities": [
        "រាជធានីភ្នំពេញ", "ខេត្តបន្ទាយមានជ័យ", "ខេត្តបាត់ដំបង", "ខេត្តកំពង់ចាម", "ខេត្តកំពង់ឆ្នាំង", 
        "ខេត្តកំពង់ស្ពឺ", "ខេត្តកំពង់ធំ", "ខេត្តកំពត", "ខេត្តកណ្តាល", "ខេត្តកោះកុង", 
        "ខេត្តក្រចេះ", "ខេត្តមណ្ឌលគិរី", "ខេត្តព្រះវិហារ", "ខេត្តព្រៃវែង", "ខេត្តពោធិ៍សាត់", 
        "ខេត្តរតនគិរី", "ខេត្តសៀមរាប", "ខេត្តព្រះសីហនុ", "ខេត្តស្ទឹងត្រែង", "ខេត្តស្វាយរៀង", 
        "ខេត្តតាកែវ", "ខេត្តឧត្តរមានជ័យ", "ខេត្តកែប", "ខេត្តប៉ៃលិន", "ខេត្តត្បូងឃ្មុំ"
    ],
    "users": [
        {
            "id": "admin", 
            "name": "Admin", 
            "email": "admin@example.com", 
            "roleId": "admin", 
            "pin": "1234"
        }
    ],
    "roles": [
        {
            "id": "admin", 
            "name": "Administrator", 
            "description": "Full access to all features", 
            "permissions": []
        }
    ],
    "storeName": "JBL Store Main",
    "email": "contact@jblstore.com",
    "phone": "+1 (555) 123-4567",
    "storeAddress": "123 Speaker Ave, Audio City"
}')
ON CONFLICT (id) DO NOTHING;

-- Initial Data for Users
INSERT INTO users (id, name, email, role_id, pin)
VALUES ('admin', 'Admin', 'admin@example.com', 'admin', '1234')
ON CONFLICT (id) DO NOTHING;

-- Policies (Row Level Security - Optional, referencing for completeness)
-- You would enable RLS and add policies here if authentication was Supabase Auth based.
-- Since this app manages Users in JSON, we rely on application-level logic or open access (if public).
-- For production, heavily recommend migrating 'users' to supabase.auth.users.
