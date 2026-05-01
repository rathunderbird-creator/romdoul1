-- ============================================================
-- POS FULL DATABASE SCHEMA (Idempotent - Safe to re-run)
-- Last updated: 2026-04-29
-- Run this in each Supabase SQL Editor to ensure all tables,
-- columns, indexes, and policies are in sync.
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. CORE TABLES
-- ============================================================

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

-- Column added in add_daily_number.sql
ALTER TABLE sales ADD COLUMN IF NOT EXISTS daily_number INTEGER;

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

-- Column added in payroll_migration.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS base_salary NUMERIC DEFAULT 0;

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

-- ============================================================
-- 2. FEATURE TABLES
-- ============================================================

-- Stock Movements (stock_movements.sql)
CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('in', 'out')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC DEFAULT 0,
    source TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    reference_id TEXT DEFAULT '',
    shipping_co TEXT DEFAULT '',
    note TEXT DEFAULT '',
    movement_date DATE DEFAULT CURRENT_DATE,
    created_by TEXT DEFAULT 'unknown',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Staff Attendance (staff_attendance.sql)
CREATE TABLE IF NOT EXISTS public.staff_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Present',
    clock_in TIME,
    clock_out TIME,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- Activity Logs (activity_logs.sql)
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    action TEXT NOT NULL,
    description TEXT NOT NULL,
    user_id TEXT,
    user_name TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Custom Locations (supabase_custom_locations.sql)
CREATE TABLE IF NOT EXISTS public.custom_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pcode TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    type TEXT NOT NULL,
    courier TEXT,
    province TEXT,
    district TEXT,
    commune TEXT,
    phone TEXT,
    contact_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Shipping Rules (supabase_shipping_rules.sql)
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

-- ============================================================
-- 3. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_salesman ON sales(salesman);
CREATE INDEX IF NOT EXISTS idx_sales_shipping_status ON sales(shipping_status);
CREATE INDEX IF NOT EXISTS idx_sales_payment_status ON sales(payment_status);
CREATE INDEX IF NOT EXISTS idx_sales_date_daily_number ON sales(date, daily_number);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type_date ON stock_movements(type, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS custom_locations_pcode_idx ON public.custom_locations(pcode);

-- ============================================================
-- 4. VIEWS
-- ============================================================

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

-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================

-- Disable RLS on ALL tables (app uses custom PIN auth, not Supabase auth)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE restocks DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements DISABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_rules DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. STORAGE
-- ============================================================

INSERT INTO storage.buckets (id, name, public) VALUES ('products', 'products', true) ON CONFLICT (id) DO NOTHING;

-- Note: Storage policies may already exist. If you get errors on these, they're already applied.
-- DROP POLICY IF EXISTS "Allow public read access for products bucket" ON storage.objects;
-- DROP POLICY IF EXISTS "Allow public uploads to products bucket" ON storage.objects;
-- DROP POLICY IF EXISTS "Allow public updates to products bucket" ON storage.objects;
-- DROP POLICY IF EXISTS "Allow public deletes from products bucket" ON storage.objects;
-- CREATE POLICY "Allow public read access for products bucket" ON storage.objects FOR SELECT TO public USING ( bucket_id = 'products' );
-- CREATE POLICY "Allow public uploads to products bucket" ON storage.objects FOR INSERT TO public WITH CHECK ( bucket_id = 'products' );
-- CREATE POLICY "Allow public updates to products bucket" ON storage.objects FOR UPDATE TO public USING ( bucket_id = 'products' );
-- CREATE POLICY "Allow public deletes from products bucket" ON storage.objects FOR DELETE TO public USING ( bucket_id = 'products' );

-- ============================================================
-- 7. INITIAL DATA (only if not exists)
-- ============================================================

INSERT INTO app_config (id, data)
VALUES (1, '{
    "shippingCompanies": ["J&T", "VET", "JS Express"],
    "salesmen": [],
    "categories": [],
    "pages": [],
    "customerCare": [],
    "paymentMethods": ["Cash", "QR"],
    "cities": [],
    "users": [{"id": "admin", "name": "Admin", "email": "admin@pos.com", "roleId": "admin", "pin": "1234"}],
    "roles": [{"id": "admin", "name": "Administrator", "description": "Full access", "permissions": ["view_dashboard", "manage_inventory", "process_sales", "view_reports", "manage_settings", "manage_users", "manage_orders", "create_orders", "view_orders", "view_inventory_stock", "manage_income_expense", "manage_attendance", "manage_payroll"]}],
    "storeName": "POS Store",
    "email": "",
    "phone": "",
    "storeAddress": ""
}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, name, email, role_id, pin)
VALUES ('admin', 'Admin', 'admin@pos.com', 'admin', '1234')
ON CONFLICT (id) DO NOTHING;
