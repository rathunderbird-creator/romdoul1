import { supabase } from './src/lib/supabase';

async function test() {
    const { data, error } = await supabase.from('stock_movements').select('*').limit(5);
    console.log("Data:", data);
    console.log("Error:", error);
}

test();
