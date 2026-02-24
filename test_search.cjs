const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function test() {
    const term = '012';
    // Searching inside customer_snapshot JSONB
    // And regular columns
    const { data, error } = await supabase
        .from('sales')
        .select('id, salesman, customer_snapshot')
        .or(`salesman.ilike.%${term}%,customer_snapshot->>name.ilike.%${term}%,customer_snapshot->>phone.ilike.%${term}%`)
        .limit(5);

    if (error) {
        console.error("Error:", error);
    } else {
        console.log("Success! Found:", data.length);
        console.log(JSON.stringify(data, null, 2));
    }
}
test();
