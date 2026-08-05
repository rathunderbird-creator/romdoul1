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
    sku TEXT,
    price NUMERIC DEFAULT 0,
    stock NUMERIC DEFAULT 0,
    low_stock_threshold NUMERIC DEFAULT 5,
    unit_of_measure TEXT DEFAULT 'PCS',
    low_stock_alert BOOLEAN DEFAULT true,
    reorder_level NUMERIC DEFAULT 5,
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
            "permissions": ["view_dashboard", "manage_inventory", "process_sales", "view_reports", "manage_settings", "manage_users", "manage_orders", "create_orders", "view_orders", "view_inventory_stock", "manage_income_expense", "manage_hr", "manage_crm", "manage_procurement", "manage_accounting"]
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
    is_shutdown BOOLEAN DEFAULT false,
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
DROP POLICY IF EXISTS "Allow public read access for products bucket" ON storage.objects;
CREATE POLICY "Allow public read access for products bucket" ON storage.objects FOR SELECT TO public USING ( bucket_id = 'products' );

DROP POLICY IF EXISTS "Allow public uploads to products bucket" ON storage.objects;
CREATE POLICY "Allow public uploads to products bucket" ON storage.objects FOR INSERT TO public WITH CHECK ( bucket_id = 'products' );

DROP POLICY IF EXISTS "Allow public updates to products bucket" ON storage.objects;
CREATE POLICY "Allow public updates to products bucket" ON storage.objects FOR UPDATE TO public USING ( bucket_id = 'products' );

DROP POLICY IF EXISTS "Allow public deletes from products bucket" ON storage.objects;
CREATE POLICY "Allow public deletes from products bucket" ON storage.objects FOR DELETE TO public USING ( bucket_id = 'products' );

-- ==========================================
-- 9. DATA CLEANUP (clean-images.sql)
-- Removes legacy data structure elements
-- ==========================================
UPDATE sale_items SET image = NULL;

-- ==========================================
-- 10. RECENT MIGRATIONS
-- Safe to re-run column additions
-- ==========================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT;

-- ==========================================
-- 11. ERP MODULES
-- ==========================================

-- Procurement: Suppliers
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    tax_id TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Procurement: Purchase Orders
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    order_date DATE NOT NULL,
    expected_delivery_date DATE,
    status TEXT DEFAULT 'Draft',
    total_amount NUMERIC(12, 2) DEFAULT 0,
    payment_status TEXT DEFAULT 'Unpaid',
    amount_paid NUMERIC(12, 2) DEFAULT 0,
    payment_due_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Procurement: Supplier Payments
CREATE TABLE IF NOT EXISTS public.supplier_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    payment_date DATE NOT NULL,
    payment_method TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Procurement: Purchase Order Items
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- HR: Staff Attendance
CREATE TABLE IF NOT EXISTS public.staff_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status TEXT NOT NULL,
    clock_in TEXT,
    clock_out TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Accounting: Chart of Accounts
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_code TEXT NOT NULL UNIQUE,
    account_name TEXT NOT NULL,
    account_type TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Accounting: Journal Entries
CREATE TABLE IF NOT EXISTS public.journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    description TEXT,
    reference_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Accounting: Journal Entry Lines
CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE CASCADE,
    account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
    debit NUMERIC(12, 2) DEFAULT 0,
    credit NUMERIC(12, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM: Leads
CREATE TABLE IF NOT EXISTS public.crm_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    status TEXT DEFAULT 'New',
    source TEXT,
    assigned_to TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM: Interactions
CREATE TABLE IF NOT EXISTS public.crm_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
    type TEXT,
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT,
    created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL
);

-- CRM: Quotations
CREATE TABLE IF NOT EXISTS public.crm_quotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    valid_until DATE,
    total_amount NUMERIC(12, 2) DEFAULT 0,
    status TEXT DEFAULT 'Draft',
    created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM: Quotation Items
CREATE TABLE IF NOT EXISTS public.crm_quotation_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quotation_id UUID REFERENCES public.crm_quotations(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0
);

-- Warehouses
CREATE TABLE IF NOT EXISTS public.warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    address TEXT,
    contact TEXT,
    capacity INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Warehouse Stock
CREATE TABLE IF NOT EXISTS public.warehouse_stock (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES public.products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(warehouse_id, product_id)
);

-- Disable RLS on new tables
ALTER TABLE public.suppliers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attendance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_leads DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_interactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_quotations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_quotation_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_stock DISABLE ROW LEVEL SECURITY;
