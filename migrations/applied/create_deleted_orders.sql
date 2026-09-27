-- ============================================================
-- Add deleted_orders and deleted_sale_items tables
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
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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

-- Note: No indexes created as this is an archive table, but you could add them if performance is an issue later.
