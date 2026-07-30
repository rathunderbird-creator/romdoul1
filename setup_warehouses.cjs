const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
    const sql = `
-- Create Warehouses Table
CREATE TABLE IF NOT EXISTS public.warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    address TEXT,
    contact TEXT,
    capacity INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Create Warehouse Stock Table
CREATE TABLE IF NOT EXISTS public.warehouse_stock (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES public.products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(warehouse_id, product_id)
);

-- Alter stock_movements
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;

-- Disable RLS
ALTER TABLE public.warehouses DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_stock DISABLE ROW LEVEL SECURITY;
    `;

    console.log("Since Supabase JS client doesn't support raw SQL easily unless using a function, I will execute the creation through REST or instruct the user to run it if it fails.");

    // Let's create a default warehouse via Supabase JS
    const { data: existingWarehouses } = await supabase.from('warehouses').select('id').limit(1);
    
    if (existingWarehouses && existingWarehouses.length > 0) {
        console.log('Warehouses already exist. Skipping default creation.');
        return;
    }

    // Since we don't have direct SQL exec, we will try to insert a warehouse
    // If the table doesn't exist, it will fail.
    const { data: newWarehouse, error: insertError } = await supabase.from('warehouses').insert({
        name: 'Main Warehouse',
        address: 'Default HQ',
        contact: 'Admin',
        capacity: 10000
    }).select('id').single();

    if (insertError) {
        console.error('Failed to create default warehouse:', insertError.message);
        console.error('This means the tables are NOT created. Please run the SQL manually in Supabase SQL Editor.');
        console.error(sql);
        return;
    }

    console.log('Created Main Warehouse:', newWarehouse.id);

    // Migrate existing stock
    const { data: products } = await supabase.from('products').select('id, stock');
    if (products) {
        const stockInserts = products.map(p => ({
            warehouse_id: newWarehouse.id,
            product_id: p.id,
            quantity: p.stock
        }));

        if (stockInserts.length > 0) {
            const { error: stockError } = await supabase.from('warehouse_stock').insert(stockInserts);
            if (stockError) {
                console.error('Failed to migrate stock:', stockError.message);
            } else {
                console.log('Successfully migrated stock for', stockInserts.length, 'products to Main Warehouse.');
            }
        }
    }
}
run();
