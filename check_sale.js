import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
    // Get one of the recent sales with the timestamp ID
    const saleId = '1786093022918';
    const { data: sale, error } = await supabase.from('sales')
        .select('*')
        .eq('id', saleId)
        .single();
    
    if (error) { console.error(error); return; }
    
    console.log("Sale fields:");
    console.log("  id:", sale.id);
    console.log("  customer_name:", sale.customer_name);
    console.log("  customer_phone:", sale.customer_phone);
    console.log("  customer_city:", sale.customer_city);
    
    // Let's also look at the raw customer JSON if it's stored as jsonb
    const keys = Object.keys(sale).filter(k => k.includes('customer') || k.includes('name') || k.includes('phone'));
    console.log("\nAll customer-related fields:");
    keys.forEach(k => console.log(`  ${k}: "${sale[k]}"`));
    
    console.log("\nAll fields:");
    Object.keys(sale).forEach(k => console.log(`  ${k}: ${JSON.stringify(sale[k])}`));
}

check();
