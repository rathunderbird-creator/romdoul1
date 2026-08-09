import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function fixEmptyCustomers() {
    console.log("Looking for stock movements with empty customer names...");
    
    // Find all out movements with missing customer_name
    const { data: movements, error } = await supabase.from('stock_movements')
        .select('id, reference_id')
        .eq('type', 'out')
        .or('customer_name.eq."",customer_name.is.null')
        .not('reference_id', 'is', null);
        
    if (error) {
        console.error("Error fetching movements:", error);
        return;
    }
    
    if (!movements || movements.length === 0) {
        console.log("No empty customer names found!");
        return;
    }
    
    console.log(`Found ${movements.length} movements missing customer data. Looking up sales...`);
    
    // Group by reference_id to batch sales lookup
    const refIds = [...new Set(movements.map(m => m.reference_id).filter(Boolean))];
    
    const { data: sales, error: salesError } = await supabase.from('sales')
        .select('id, customer_snapshot')
        .in('id', refIds);
        
    if (salesError) {
        console.error("Error fetching sales:", salesError);
        return;
    }
    
    const salesMap = new Map();
    sales?.forEach(s => salesMap.set(s.id, s));
    
    let updatedCount = 0;
    
    for (const m of movements) {
        if (!m.reference_id) continue;
        
        const sale = salesMap.get(m.reference_id);
        if (sale?.customer_snapshot) {
            const name = sale.customer_snapshot.name || '';
            const phone = sale.customer_snapshot.phone || '';
            
            if (name || phone) {
                await supabase.from('stock_movements')
                    .update({ customer_name: name, customer_phone: phone })
                    .eq('id', m.id);
                updatedCount++;
            }
        }
    }
    
    console.log(`Successfully backfilled ${updatedCount} stock movements.`);
}

fixEmptyCustomers();
