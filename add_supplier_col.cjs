const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
    // Test if supplier column already exists
    const { data, error } = await supabase.from('stock_movements').select('supplier').limit(1);
    if (error) {
        console.log('supplier column does not exist yet, error:', error.message);
        console.log('Please add it manually in Supabase SQL editor:');
        console.log('ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS supplier TEXT DEFAULT \'\';');
    } else {
        console.log('supplier column already exists:', data);
    }
}
run();
