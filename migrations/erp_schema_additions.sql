-- ==========================================
-- ERP MODULES EXPANSION SCRIPT
-- ==========================================

-- ------------------------------------------
-- 1. HR & PAYROLL
-- ------------------------------------------
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
    month TEXT NOT NULL, -- e.g., '2026-07'
    base_pay NUMERIC DEFAULT 0,
    bonus NUMERIC DEFAULT 0,
    deductions NUMERIC DEFAULT 0,
    net_pay NUMERIC DEFAULT 0,
    payment_status TEXT DEFAULT 'Pending', -- Pending, Paid
    payment_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ------------------------------------------
-- 2. CRM (Customer Relationship Management)
-- ------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    company_name TEXT,
    email TEXT,
    phone TEXT,
    status TEXT DEFAULT 'New', -- New, Contacted, Qualified, Proposal Sent, Won, Lost
    source TEXT,
    assigned_to TEXT, -- user id or name
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
    items JSONB DEFAULT '[]'::jsonb, -- Array of items quoted
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ------------------------------------------
-- 3. PROCUREMENT & SUPPLY CHAIN
-- ------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    payment_terms TEXT,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    order_date DATE DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    total_amount NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'Draft', -- Draft, Ordered, Received, Cancelled
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS po_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    quantity NUMERIC DEFAULT 1,
    unit_price NUMERIC DEFAULT 0,
    total_price NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ------------------------------------------
-- 4. ACCOUNTING & FINANCE
-- ------------------------------------------
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
    reference_id TEXT, -- E.g., Sale ID, PO ID
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

-- Insert some default Chart of Accounts
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

-- Update RLS policies to disable them for simplicity just like the main app
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE leads DISABLE ROW LEVEL SECURITY;
ALTER TABLE interactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE quotations DISABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers DISABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE po_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines DISABLE ROW LEVEL SECURITY;
