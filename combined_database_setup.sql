-- COMBINED SUPABASE SETUP SCRIPT FOR JBL POS
-- This script contains all schemas, views, custom tables, policies, and initial data needed to deploy the database.

-- ==========================================
-- 1. BASE SCHEMA (database.sql)
-- ==========================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
    page_source TEXT,
    last_edited_at TIMESTAMP WITH TIME ZONE,
    last_edited_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    price NUMERIC DEFAULT 0,
    quantity NUMERIC DEFAULT 1,
    image TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    role_id TEXT NOT NULL,
    pin TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_config (
    id BIGINT PRIMARY KEY,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    quantity NUMERIC DEFAULT 0,
    cost NUMERIC DEFAULT 0,
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    added_by TEXT,
    note TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('Income', 'Expense')),
    amount NUMERIC DEFAULT 0,
    category TEXT,
    description TEXT,
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    added_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 2. INITIAL DATA
-- ==========================================
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
            "permissions": ["view_dashboard", "manage_inventory", "process_sales", "view_reports", "manage_settings", "manage_users", "manage_orders", "create_orders", "view_orders", "view_inventory_stock", "manage_income_expense"]
        }
    ],
    "storeName": "JBL Store Main",
    "email": "contact@jblstore.com",
    "phone": "+1 (555) 123-4567",
    "storeAddress": "123 Speaker Ave, Audio City"
}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, name, email, role_id, pin)
VALUES ('admin', 'Admin', 'admin@example.com', 'admin', '1234')
ON CONFLICT (id) DO UPDATE SET pin = '1234';

-- ==========================================
-- 3. CUSTOM LOCATIONS (supabase_custom_locations.sql / remove_pcode_constraint.sql)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.custom_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pcode TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    type TEXT NOT NULL, -- previously checked against IN ('province', 'district', 'commune', 'village'), now open to 'custom'
    courier TEXT,
    province TEXT,
    district TEXT,
    commune TEXT,
    phone TEXT,
    contact_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS custom_locations_pcode_idx ON public.custom_locations (pcode);

-- ==========================================
-- 4. SHIPPING RULES (supabase_shipping_rules.sql)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.shipping_rules (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pcode TEXT NOT NULL UNIQUE,       
    name TEXT NOT NULL,               
    is_shippable BOOLEAN DEFAULT true, 
    shipping_fee NUMERIC DEFAULT 1.50, 
    estimated_days TEXT DEFAULT '1-2 days', 
    supported_couriers JSONB DEFAULT '[]'::jsonb, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 5. VIEWS (supabase_inventory_setup.sql)
-- ==========================================
CREATE OR REPLACE VIEW product_inventory_stats AS
SELECT 
    p.id,
    p.name,
    p.model,
    p.price,
    p.stock,
    p.low_stock_threshold,
    p.image,
    p.category,
    p.created_at,
    (p.price * p.stock) as "totalValue",
    COALESCE(
        (SELECT SUM(si.quantity) 
         FROM sale_items si 
         JOIN sales s ON s.id = si.sale_id 
         WHERE si.product_id = p.id 
         AND s.payment_status IN ('Paid', 'Settled', 'Paid/Settled')
        ), 0
    ) as "soldPaid"
FROM products p;

-- ==========================================
-- 6. INDEXES & PERFORMANCE FIXES (fix-performance.sql)
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_salesman ON sales(salesman);
CREATE INDEX IF NOT EXISTS idx_sales_shipping_status ON sales(shipping_status);
CREATE INDEX IF NOT EXISTS idx_sales_payment_status ON sales(payment_status);

-- ==========================================
-- 7. ROW LEVEL SECURITY FIXES (fix_users_rls.sql / fix_custom_locations_rls.sql)
-- Disable RLS on tables where app handles own local user emulation logic
-- ==========================================
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE restocks DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- ==========================================
-- 8. STORAGE BUCKET POLICIES (supabase_storage_setup.sql)
-- ==========================================
INSERT INTO storage.buckets (id, name, public) VALUES ('products', 'products', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Allow public read access for products bucket" ON storage.objects FOR SELECT TO public USING ( bucket_id = 'products' );
CREATE POLICY "Allow public uploads to products bucket" ON storage.objects FOR INSERT TO public WITH CHECK ( bucket_id = 'products' );
CREATE POLICY "Allow public updates to products bucket" ON storage.objects FOR UPDATE TO public USING ( bucket_id = 'products' );
CREATE POLICY "Allow public deletes from products bucket" ON storage.objects FOR DELETE TO public USING ( bucket_id = 'products' );

-- ==========================================
-- 9. DATA CLEANUP (clean-images.sql)
-- Removes legacy data structure elements
-- ==========================================
UPDATE sale_items SET image = NULL;
