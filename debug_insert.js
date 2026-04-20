import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
    const { data, error } = await supabase.from('stock_movements').insert({
        product_id: 'test',
        product_name: 'test',
        type: 'in',
        quantity: 1,
        created_by: 'system'
    }).select();
    console.log(error || data);
})();
