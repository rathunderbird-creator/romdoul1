import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
    // Get the reference_ids of stock movements without customer_name
    const { data: emptyOnes } = await supabase.from('stock_movements')
        .select('reference_id, customer_name, created_at')
        .eq('type', 'out')
        .is('customer_name', null)
        .order('created_at', { ascending: false })
        .limit(5);

    // Also check for empty string
    const { data: emptyStr } = await supabase.from('stock_movements')
        .select('reference_id, customer_name, created_at')
        .eq('type', 'out')
        .eq('customer_name', '')
        .order('created_at', { ascending: false })
        .limit(5);
    
    const samples = [...(emptyOnes || []), ...(emptyStr || [])].slice(0, 5);
    
    console.log("Stock movements with empty customer_name:");
    for (const sm of samples) {
        console.log(`  ref=${sm.reference_id}, customer_name="${sm.customer_name}", created=${sm.created_at}`);
        
        // Look up the sales order
        if (sm.reference_id) {
            const { data: sale } = await supabase.from('sales')
                .select('id, customer_name, customer_phone, customer_city')
                .eq('id', sm.reference_id)
                .single();
            if (sale) {
                console.log(`    => Sale found: customer_name="${sale.customer_name}", phone="${sale.customer_phone}"`);
            } else {
                console.log(`    => Sale NOT found`);
            }
        }
    }
}

check();
