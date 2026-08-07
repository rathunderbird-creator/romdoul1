import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing Supabase credentials in .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function backfill() {
    console.log("Fetching stock_movements missing customer_name...");
    
    // Fetch movements that might be from orders, newest first
    const { data: movements, error: fetchErr } = await supabase
        .from('stock_movements')
        .select('*')
        .or('customer_name.eq."",customer_name.is.null')
        .eq('type', 'out')
        .order('created_at', { ascending: false });

    if (fetchErr) {
        console.error("Error fetching movements:", fetchErr);
        return;
    }

    console.log(`Found ${movements.length} movements without customer_name.`);

    if (movements.length === 0) return;

    const referenceIds = [...new Set(movements.map(m => m.reference_id).filter(Boolean))];
    
    console.log(`Fetching ${referenceIds.length} unique sales references in chunks...`);

    const chunkSize = 500;
    const salesMap = {};

    for (let i = 0; i < referenceIds.length; i += chunkSize) {
        const chunk = referenceIds.slice(i, i + chunkSize);
        const { data: sales, error: salesErr } = await supabase
            .from('sales')
            .select('id, customer_snapshot')
            .in('id', chunk);

        if (salesErr) {
            console.error("Error fetching sales chunk:", salesErr);
            continue;
        }

        for (const sale of sales) {
            salesMap[sale.id] = sale.customer_snapshot;
        }
    }

    console.log("Updating movements concurrently...");
    let updatedCount = 0;
    const updatePromises = [];

    for (const movement of movements) {
        if (!movement.reference_id) continue;
        const customer = salesMap[movement.reference_id];
        
        if (customer && (customer.name || customer.phone)) {
            const customerName = customer.name || '';
            const customerPhone = customer.phone || '';
            
            updatePromises.push(
                supabase
                    .from('stock_movements')
                    .update({
                        customer_name: customerName,
                        customer_phone: customerPhone
                    })
                    .eq('id', movement.id)
                    .then(({ error }) => {
                        if (error) console.error(`Failed to update ${movement.id}:`, error);
                        else {
                            updatedCount++;
                            if (updatedCount % 500 === 0) console.log(`Updated ${updatedCount} records...`);
                        }
                    })
            );
        }

        if (updatePromises.length >= 100) {
            await Promise.all(updatePromises);
            updatePromises.length = 0;
        }
    }

    if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
    }

    console.log(`Successfully backfilled ${updatedCount} records.`);
}

backfill();
