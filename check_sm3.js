import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
    // Get latest sales
    const { data: sales } = await supabase.from('sales')
        .select('id, customer_name, customer_phone')
        .order('created_at', { ascending: false })
        .limit(3);
    
    console.log("Latest sales IDs:");
    sales?.forEach(s => console.log(`  id="${s.id}" customer="${s.customer_name}" phone="${s.customer_phone}"`));
    
    // Now look at the stock movements that ARE empty, with an actual reference to a sale
    const { data: movements } = await supabase.from('stock_movements')
        .select('id, reference_id, customer_name, source, reason, created_at')
        .eq('type', 'out')
        .eq('customer_name', '')
        .order('created_at', { ascending: false })
        .limit(15);
    
    console.log("\nStock movements with empty customer, reference IDs:");
    movements?.forEach(m => console.log(`  ref="${m.reference_id}" source="${m.source}" reason="${m.reason}" created=${m.created_at}`));

    // Check if any of those reference_ids actually exist in sales
    if (movements && movements.length > 0) {
        const refs = [...new Set(movements.map(m => m.reference_id).filter(Boolean))];
        const { data: foundSales } = await supabase.from('sales').select('id').in('id', refs);
        console.log(`\nOut of ${refs.length} unique refs, ${foundSales?.length || 0} found in sales table`);
    }
}

check();
