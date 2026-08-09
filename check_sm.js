import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
    const { data, error } = await supabase
        .from('stock_movements')
        .select('id, product_name, type, supplier, customer_name, customer_phone, source, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) { console.error(error); return; }
    
    console.log("Latest 10 stock movements:");
    data.forEach((r, i) => {
        console.log(`${i+1}. [${r.type.toUpperCase()}] ${r.product_name} | supplier="${r.supplier || ''}" | customer="${r.customer_name || ''}" | phone="${r.customer_phone || ''}" | source="${r.source || ''}" | reason="${r.reason || ''}"`);
    });

    // Count how many have supplier or customer populated
    const { data: allData } = await supabase.from('stock_movements').select('id, supplier, customer_name, type');
    if (allData) {
        const withSupplier = allData.filter(r => r.supplier);
        const withCustomer = allData.filter(r => r.customer_name);
        const outRecords = allData.filter(r => r.type === 'out');
        const inRecords = allData.filter(r => r.type === 'in');
        console.log(`\nTotal: ${allData.length} | IN: ${inRecords.length} | OUT: ${outRecords.length}`);
        console.log(`With supplier: ${withSupplier.length} | With customer_name: ${withCustomer.length}`);
        console.log(`OUT without customer: ${outRecords.filter(r => !r.customer_name).length}`);
        console.log(`IN without supplier: ${inRecords.filter(r => !r.supplier).length}`);
    }
}

check();
