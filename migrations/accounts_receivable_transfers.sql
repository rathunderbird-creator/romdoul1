-- ==========================================
-- ACCOUNTS RECEIVABLE: Warehouse transfers on credit
-- ==========================================
-- Records stock transferred to another warehouse "on credit": the destination
-- (another branch / warehouse / party) owes the value of the goods. Each row is
-- a receivable; receipts against it are logged in warehouse_transfer_receipts.
--
-- IDs are stored as TEXT (no FK constraints) so this migration runs regardless of
-- how products / warehouses key their rows, matching how the app already joins them.

CREATE TABLE IF NOT EXISTS warehouse_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT DEFAULT 'transfer',          -- 'transfer' (warehouse->warehouse) | 'wholesale' (sale to a customer)
    transfer_date DATE DEFAULT CURRENT_DATE,
    from_warehouse_id TEXT,
    to_warehouse_id TEXT,
    to_warehouse_name TEXT,      -- denormalised label of who owes (branch/warehouse OR customer)
    counterparty_phone TEXT,     -- customer phone, for wholesale sales
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

-- Safe to re-run: adds the wholesale columns if the table already existed.
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

CREATE INDEX IF NOT EXISTS idx_wt_status ON warehouse_transfers(payment_status);
CREATE INDEX IF NOT EXISTS idx_wt_receipts_transfer ON warehouse_transfer_receipts(transfer_id);

-- Match the rest of the app, which runs with RLS disabled.
ALTER TABLE warehouse_transfers DISABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_transfer_receipts DISABLE ROW LEVEL SECURITY;
