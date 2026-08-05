-- Add new columns to purchase_orders
ALTER TABLE public.purchase_orders
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'Unpaid',
ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_due_date DATE;

-- Create supplier_payments table
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

-- Disable RLS for new table
ALTER TABLE public.supplier_payments DISABLE ROW LEVEL SECURITY;
