import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing credentials");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testInsert() {
    const { data: supplier } = await supabase.from('suppliers').select('id').limit(1).single();
    if (!supplier) {
        console.error("No supplier found");
        return;
    }

    const poPayload = {
        supplier_id: supplier.id,
        order_date: new Date().toISOString(),
        status: 'Draft',
        total_amount: 100,
        payment_status: 'Unpaid',
        amount_paid: 0,
        invoice_number: 'TEST-INV-123'
    };

    console.log("Inserting PO:", poPayload);
    const { data, error } = await supabase
        .from('purchase_orders')
        .insert([poPayload])
        .select()
        .single();

    if (error) {
        console.error("Insert error:", error);
    } else {
        console.log("Inserted successfully:", data);
        
        // clean up
        await supabase.from('purchase_orders').delete().eq('id', data.id);
        console.log("Cleaned up test PO");
    }
}

testInsert();
