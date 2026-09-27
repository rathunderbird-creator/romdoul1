-- ============================================================
-- POS FULL DATABASE SCHEMA — single consolidated migration
-- Last updated: 2026-09-27
--
-- THE one file to run: sets up a brand-new Supabase project
-- completely, and brings an old instance up to date. Idempotent —
-- safe to re-run any time (IF NOT EXISTS / ADD COLUMN IF NOT
-- EXISTS everywhere). Run it in the Supabase SQL editor.
--
-- It consolidates every former per-feature migration file (now
-- archived in migrations/applied/) PLUS columns that only ever
-- existed hand-made on the live instances (purchase_orders'
-- payment columns, suppliers' tax_id/is_active, sales.customer_id,
-- todos, todo_projects, purchase_order_items, supplier_payments).
--
-- NOT included (one-time data fixes, already applied; see
-- migrations/applied/): clear_settle_date_on_get_file.sql,
-- rename_retail_income_category.sql, and create_inventory_items'
-- stock backfill block (not idempotent).
--
-- Note on the PIN lockdown (§13): the current app uses the
-- check_pin RPC. Old pre-2026-09 app builds break once §13 runs,
-- so update any installed desktop build first (see the archived
-- secure_pin_check.sql header for the full story).
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
    sku TEXT,
    price NUMERIC DEFAULT 0,
    purchase_cost NUMERIC DEFAULT 0,
    stock NUMERIC DEFAULT 0,
    low_stock_threshold NUMERIC DEFAULT 5,
    low_stock_alert BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    image TEXT,
    category TEXT,
    invoice_number TEXT,
    supplier TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- Same columns for instances whose products table predates them.
ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_cost NUMERIC DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_alert BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier TEXT;

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
    customer_id TEXT,
    customer_snapshot JSONB,
    page_source TEXT,
    last_edited_at TIMESTAMP WITH TIME ZONE,
    last_edited_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    daily_number INTEGER,
    -- Deposit tracking: customer pays part upfront, remainder via COD.
    -- Business rule: deposits are always kept, even after cancel/return.
    deposit_amount NUMERIC DEFAULT 0,
    deposit_date DATE,
    deposit_method TEXT
);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS daily_number INTEGER;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_date DATE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_method TEXT;

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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    base_salary NUMERIC DEFAULT 0,
    daily_target NUMERIC DEFAULT 0,
    weekly_target NUMERIC DEFAULT 0,
    monthly_target NUMERIC DEFAULT 0
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS base_salary NUMERIC DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_target NUMERIC DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_target NUMERIC DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_target NUMERIC DEFAULT 0;

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
    shipping_co TEXT,
    pay_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS shipping_co TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pay_by TEXT;

-- Per-unit purchase costs (create_inventory_items.sql). The one-time
-- backfill from products.stock is NOT repeated here — it was not
-- idempotent; see migrations/applied/create_inventory_items.sql.
CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    cost_of_purchase NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold', 'returned')),
    sale_id TEXT REFERENCES sales(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 2. STOCK MOVEMENTS (the app's stock ledger)
-- ============================================================

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
    created_at TIMESTAMPTZ DEFAULT now(),
    customer_name TEXT,
    customer_phone TEXT,
    order_id TEXT,
    warehouse_id TEXT,     -- written by wholesale orders / warehouse filter
    supplier TEXT DEFAULT '' -- written when receiving purchase orders
);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS warehouse_id TEXT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS supplier TEXT DEFAULT '';

-- ============================================================
-- 3. HR / STAFF
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Present',
    clock_in TIME,
    clock_out TIME,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    department TEXT,
    position TEXT,
    hire_date DATE,
    base_salary NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'Active', -- Active, On Leave, Terminated
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    leave_type TEXT NOT NULL, -- Sick, Vacation, Unpaid
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT DEFAULT 'Pending', -- Pending, Approved, Rejected
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    month TEXT NOT NULL, -- e.g. '2026-07'
    base_pay NUMERIC DEFAULT 0,
    bonus NUMERIC DEFAULT 0,
    deductions NUMERIC DEFAULT 0,
    net_pay NUMERIC DEFAULT 0,
    payment_status TEXT DEFAULT 'Pending', -- Pending, Paid
    payment_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 4. CRM
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    company_name TEXT,
    email TEXT,
    phone TEXT,
    status TEXT DEFAULT 'New', -- New, Contacted, Qualified, Proposal Sent, Won, Lost
    source TEXT,
    assigned_to TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- Call, Email, Meeting
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT,
    performed_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    total_amount NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'Draft', -- Draft, Sent, Accepted, Rejected
    valid_until DATE,
    items JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 5. PROCUREMENT
-- ============================================================

-- Column layout mirrors the live instances (the app writes tax_id /
-- is_active — see src/hooks/useProcurement.ts), not the old ERP draft.
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    tax_id TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    order_date DATE DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    total_amount NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'Draft', -- Draft, Ordered, Received, Cancelled
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Payment tracking, added by hand on the live instances:
    payment_status TEXT DEFAULT 'Unpaid', -- Unpaid, Partial, Paid
    amount_paid NUMERIC DEFAULT 0,
    payment_due_date DATE,
    invoice_number TEXT
);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'Unpaid';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS amount_paid NUMERIC DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_due_date DATE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_number TEXT;

-- The PO line items the app actually uses. The product FK is REQUIRED:
-- Procurement embeds product:products(...) through it, and PostgREST
-- refuses the whole query without the relationship ("Could not find a
-- relationship between 'purchase_order_items' and 'products'").
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    quantity NUMERIC DEFAULT 1,
    unit_price NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- Add the FK where the table pre-exists without one (any constraint
-- name counts, so instances that already have it are left untouched —
-- a SECOND FK to products would make the embed ambiguous).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
         AND kcu.table_schema = tc.table_schema
         AND kcu.table_name = tc.table_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'purchase_order_items'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'product_id'
    ) THEN
        ALTER TABLE purchase_order_items
            ADD CONSTRAINT purchase_order_items_product_id_fkey
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    supplier_id UUID,
    amount NUMERIC DEFAULT 0,
    payment_date DATE DEFAULT CURRENT_DATE,
    payment_method TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Legacy (unused by the app — purchase_order_items above is the live
-- one); kept so old instances and new ones have the same tables.
CREATE TABLE IF NOT EXISTS po_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    quantity NUMERIC DEFAULT 1,
    unit_price NUMERIC DEFAULT 0,
    total_price NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 6. WAREHOUSES, TRANSFERS (receivables), WHOLESALE
-- ============================================================

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT,
    contact TEXT,
    capacity INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One row per (warehouse, product). Ids are TEXT with no FK, matching
-- how wholesale_orders / warehouse_transfers / stock_movements store them.
CREATE TABLE IF NOT EXISTS warehouse_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (warehouse_id, product_id)
);

-- Stock transferred on credit: the destination owes the value.
CREATE TABLE IF NOT EXISTS warehouse_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT DEFAULT 'transfer',          -- 'transfer' | 'wholesale'
    transfer_date DATE DEFAULT CURRENT_DATE,
    from_warehouse_id TEXT,
    to_warehouse_id TEXT,
    to_warehouse_name TEXT,
    counterparty_phone TEXT,
    product_id TEXT,
    product_name TEXT,
    quantity NUMERIC DEFAULT 0,
    unit_price NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    amount_received NUMERIC DEFAULT 0,
    payment_status TEXT DEFAULT 'Unpaid',  -- Unpaid, Partial, Paid
    due_date DATE,
    note TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'transfer';
ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS counterparty_phone TEXT;

CREATE TABLE IF NOT EXISTS warehouse_transfer_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID REFERENCES warehouse_transfers(id) ON DELETE CASCADE,
    amount NUMERIC DEFAULT 0,
    receipt_date DATE DEFAULT CURRENT_DATE,
    payment_method TEXT,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Wholesale = customer credit sales (mirror of purchase orders).
CREATE TABLE IF NOT EXISTS wholesale_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number TEXT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    warehouse_id TEXT,
    order_date DATE DEFAULT CURRENT_DATE,
    due_date DATE,
    status TEXT DEFAULT 'Open',            -- Open, Cancelled
    total_amount NUMERIC DEFAULT 0,
    amount_paid NUMERIC DEFAULT 0,
    payment_status TEXT DEFAULT 'Unpaid',  -- Unpaid, Partial, Paid
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wholesale_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesale_order_id UUID REFERENCES wholesale_orders(id) ON DELETE CASCADE,
    product_id TEXT,
    product_name TEXT,
    quantity NUMERIC DEFAULT 0,
    unit_price NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesale_order_id UUID REFERENCES wholesale_orders(id) ON DELETE CASCADE,
    amount NUMERIC DEFAULT 0,
    payment_date DATE DEFAULT CURRENT_DATE,
    payment_method TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wholesale_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    note TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 7. ACCOUNTING
-- ============================================================

CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code TEXT UNIQUE NOT NULL,
    account_name TEXT NOT NULL,
    account_type TEXT NOT NULL, -- Asset, Liability, Equity, Revenue, Expense
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE DEFAULT CURRENT_DATE,
    description TEXT,
    reference_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    debit NUMERIC DEFAULT 0,
    credit NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO chart_of_accounts (account_code, account_name, account_type, description) VALUES
('1000', 'Cash', 'Asset', 'Cash on hand'),
('1200', 'Accounts Receivable', 'Asset', 'Money owed by customers'),
('1300', 'Inventory', 'Asset', 'Value of goods in stock'),
('2000', 'Accounts Payable', 'Liability', 'Money owed to suppliers'),
('3000', 'Owner Equity', 'Equity', 'Initial investments and retained earnings'),
('4000', 'Sales Revenue', 'Revenue', 'Income from goods sold'),
('5000', 'Cost of Goods Sold', 'Expense', 'Direct costs of items sold'),
('6000', 'Payroll Expense', 'Expense', 'Employee salaries and wages'),
('6100', 'Rent Expense', 'Expense', 'Office and warehouse rent')
ON CONFLICT (account_code) DO NOTHING;

-- ============================================================
-- 8. TODOS
-- ============================================================
-- (Layout copied from the live instances; there was never a create file.)

CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    due_date DATE,
    priority INTEGER DEFAULT 4,
    status TEXT DEFAULT 'pending',
    project TEXT DEFAULT 'Inbox',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id TEXT,
    -- Recurring tasks + reminders (add_repeat_and_reminder_to_todos.sql):
    repeat_rule TEXT,        -- 'daily' | 'weekly' | 'monthly' | NULL
    remind_at TEXT,          -- 'HH:MM' local, NULL = no reminder
    last_reminded_on DATE    -- reminds at most once per day
);
ALTER TABLE todos ADD COLUMN IF NOT EXISTS repeat_rule TEXT;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS remind_at TEXT;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS last_reminded_on DATE;
ALTER TABLE todos DROP CONSTRAINT IF EXISTS todos_repeat_rule_check;
ALTER TABLE todos ADD CONSTRAINT todos_repeat_rule_check
    CHECK (repeat_rule IS NULL OR repeat_rule IN ('daily', 'weekly', 'monthly'));

CREATE TABLE IF NOT EXISTS todo_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id TEXT
);

-- ============================================================
-- 9. LOGS, LOCATIONS, SHIPPING, TELEGRAM, TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    action TEXT NOT NULL,
    description TEXT NOT NULL,
    user_id TEXT,
    user_name TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_locations (
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
    is_shutdown BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE custom_locations ADD COLUMN IF NOT EXISTS is_shutdown BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS shipping_rules (
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

CREATE TABLE IF NOT EXISTS telegram_notifications (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    name TEXT NOT NULL,
    bot_token TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    trigger_statuses TEXT[] DEFAULT '{}',
    message_template TEXT,   -- NULL = default message format
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE telegram_notifications ADD COLUMN IF NOT EXISTS message_template TEXT;

-- Carrier tracking cache (one row per tracking number).
CREATE TABLE IF NOT EXISTS shipment_tracking (
    tracking_no TEXT PRIMARY KEY,
    carrier TEXT,
    last_status TEXT,
    last_event_at TEXT,           -- carrier's own timestamp string, shown as-is
    is_delivered BOOLEAN DEFAULT false,
    events JSONB DEFAULT '[]'::jsonb,
    error TEXT,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 10. DELETED ORDERS ARCHIVE
-- ============================================================

CREATE TABLE IF NOT EXISTS deleted_orders (
    id TEXT PRIMARY KEY,
    total NUMERIC DEFAULT 0,
    discount NUMERIC DEFAULT 0,
    date TIMESTAMP WITH TIME ZONE,
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
    created_at TIMESTAMP WITH TIME ZONE,
    daily_number INTEGER,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Deposits must survive delete+restore (add_deposit_to_deleted_orders.sql)
    deposit_amount NUMERIC DEFAULT 0,
    deposit_date DATE,
    deposit_method TEXT
);
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC DEFAULT 0;
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_date DATE;
ALTER TABLE deleted_orders ADD COLUMN IF NOT EXISTS deposit_method TEXT;

CREATE TABLE IF NOT EXISTS deleted_sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT REFERENCES deleted_orders(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    price NUMERIC DEFAULT 0,
    quantity NUMERIC DEFAULT 1,
    image TEXT,
    created_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================
-- 11. INCOME PREDICTION FAMILY
-- ============================================================

-- One frozen row per day (Save pressed on Income Prediction).
CREATE TABLE IF NOT EXISTS income_predictions (
    date DATE PRIMARY KEY,
    shipped_delivered NUMERIC DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    cogs NUMERIC DEFAULT 0,
    shipping NUMERIC DEFAULT 0,
    boost_page NUMERIC DEFAULT 0,
    staff NUMERIC DEFAULT 0,
    profit NUMERIC DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT
);

-- Daily staff cost, auto-saved as typed (independent of freezing).
CREATE TABLE IF NOT EXISTS income_prediction_staff (
    date DATE PRIMARY KEY,
    staff NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT
);

-- Prediction by Page manual inputs: ad boost + shipping override per (day, page).
CREATE TABLE IF NOT EXISTS page_income_predictions (
    date DATE NOT NULL,
    page TEXT NOT NULL CHECK (page = btrim(page)), -- '' = "(unassigned)"
    boost_page NUMERIC DEFAULT 0,
    shipping NUMERIC,        -- NULL = use the shipping-rate table
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    PRIMARY KEY (date, page)
);

-- ============================================================
-- 12. INDEXES AND VIEWS
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
CREATE INDEX IF NOT EXISTS custom_locations_pcode_idx ON custom_locations(pcode);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_product ON warehouse_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_wt_status ON warehouse_transfers(payment_status);
CREATE INDEX IF NOT EXISTS idx_wt_receipts_transfer ON warehouse_transfer_receipts(transfer_id);
CREATE INDEX IF NOT EXISTS idx_wo_payment_status ON wholesale_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_wo_items_order ON wholesale_order_items(wholesale_order_id);
CREATE INDEX IF NOT EXISTS idx_cust_pay_order ON customer_payments(wholesale_order_id);

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
-- 13. SECURITY: RLS OFF + SERVER-SIDE PIN CHECK
-- ============================================================
-- The app uses its own PIN auth with the anon key, not Supabase Auth,
-- so RLS is disabled everywhere; users.pin is protected by column
-- privileges + the check_pin RPC instead (see the note at the top).

ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE restocks DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements DISABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE leads DISABLE ROW LEVEL SECURITY;
ALTER TABLE interactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE quotations DISABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers DISABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE po_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses DISABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_stock DISABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_transfers DISABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_transfer_receipts DISABLE ROW LEVEL SECURITY;
ALTER TABLE wholesale_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE wholesale_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE wholesale_customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE todos DISABLE ROW LEVEL SECURITY;
ALTER TABLE todo_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE custom_locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_tracking DISABLE ROW LEVEL SECURITY;
ALTER TABLE deleted_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE deleted_sale_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE income_predictions DISABLE ROW LEVEL SECURITY;
ALTER TABLE income_prediction_staff DISABLE ROW LEVEL SECURITY;
ALTER TABLE page_income_predictions DISABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER verifier: checks a PIN for ONE account and returns
-- the matched account WITHOUT the pin. Empty/unset PINs never match;
-- a NULL user id matches nothing (no table-wide PIN spraying).
CREATE OR REPLACE FUNCTION check_pin(p_pin TEXT, p_user_id TEXT DEFAULT NULL)
RETURNS TABLE (id TEXT, name TEXT, email TEXT, role_id TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.name, u.email, u.role_id
    FROM users u
    WHERE p_user_id IS NOT NULL
      AND u.id = p_user_id
      AND btrim(coalesce(u.pin, '')) <> ''
      AND btrim(u.pin) = btrim(p_pin)
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION check_pin(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_pin(TEXT, TEXT) TO anon, authenticated;

-- The API can no longer READ users.pin; writes are kept so User
-- Management can still set/change PINs.
REVOKE SELECT ON users FROM anon;
REVOKE SELECT ON users FROM authenticated;
GRANT SELECT (id, name, email, role_id, created_at, base_salary, daily_target, weekly_target, monthly_target)
    ON users TO anon, authenticated;

-- ============================================================
-- 14. STORAGE BUCKET + POLICIES (product images)
-- ============================================================
-- storage.objects always has RLS enabled and a new project has no
-- policies, so without these EVERY image upload fails with
-- "new row violates row-level security policy".

INSERT INTO storage.buckets (id, name, public) VALUES ('products', 'products', true) ON CONFLICT (id) DO NOTHING;

-- Wrapped so the rest of this file still completes on a project where
-- the SQL role may not manage storage policies; in that case create
-- the same four policies in Dashboard -> Storage -> products -> Policies
-- (allow SELECT / INSERT / UPDATE / DELETE for bucket_id = 'products').
DO $$
BEGIN
    DROP POLICY IF EXISTS "Allow public read access for products bucket" ON storage.objects;
    DROP POLICY IF EXISTS "Allow public uploads to products bucket" ON storage.objects;
    DROP POLICY IF EXISTS "Allow public updates to products bucket" ON storage.objects;
    DROP POLICY IF EXISTS "Allow public deletes from products bucket" ON storage.objects;
    CREATE POLICY "Allow public read access for products bucket" ON storage.objects FOR SELECT TO public USING (bucket_id = 'products');
    CREATE POLICY "Allow public uploads to products bucket" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'products');
    CREATE POLICY "Allow public updates to products bucket" ON storage.objects FOR UPDATE TO public USING (bucket_id = 'products') WITH CHECK (bucket_id = 'products');
    CREATE POLICY "Allow public deletes from products bucket" ON storage.objects FOR DELETE TO public USING (bucket_id = 'products');
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'This role cannot manage storage.objects policies — create the four products-bucket policies in Dashboard -> Storage -> Policies instead.';
END $$;

-- ============================================================
-- 15. INITIAL DATA (new instances only; no-op where rows exist)
-- ============================================================
-- Default admin PIN is 1234 — CHANGE IT in User Management right
-- after the first login.

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

-- Make PostgREST pick everything up immediately.
NOTIFY pgrst, 'reload schema';
