import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
    const { data, error } = await supabase.from('sales').select('shipping_cost, shipping_status').in('shipping_status', ['Shipped', 'Delivered']).limit(10);
    if (error) {
        console.error(error);
    } else {
        console.log(data);
    }
}
check();
