-- ==========================================
-- WHOLESALE ORDERS (customer credit sales) — mirror of Purchase Orders
-- ==========================================
-- Purchase Orders track what you owe suppliers (Accounts Payable).
-- Wholesale Orders track what customers owe you (Accounts Receivable).
--   wholesale_orders        <-> purchase_orders
--   wholesale_order_items   <-> purchase_order_items
--   customer_payments       <-> supplier_payments
--
-- IDs for products/warehouses are stored as TEXT (no FK) to match how the app joins them.

CREATE TABLE IF NOT EXISTS wholesale_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number TEXT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    warehouse_id TEXT,                      -- source warehouse stock is drawn from
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

-- Wholesale customer directory (mirror of suppliers).
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

CREATE INDEX IF NOT EXISTS idx_wo_payment_status ON wholesale_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_wo_items_order ON wholesale_order_items(wholesale_order_id);
CREATE INDEX IF NOT EXISTS idx_cust_pay_order ON customer_payments(wholesale_order_id);

-- Match the rest of the app, which runs with RLS disabled.
ALTER TABLE wholesale_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE wholesale_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE wholesale_customers DISABLE ROW LEVEL SECURITY;
