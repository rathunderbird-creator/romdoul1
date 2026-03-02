import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wkxjmllanbikerrbdjhz.supabase.co';
const supabaseKey = 'sb_publishable_rO6uW6bothg51v0MVVjlXg_L-vN5dGR';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log("Fetching a single customer to inspect columns...");
    // Try to fetch * to see what columns come back
    const { data, error } = await supabase.from('customers').select('*').limit(1);
    if (error) {
        console.error("Error:", error);
    } else if (data && data.length > 0) {
        console.log("Columns:", Object.keys(data[0]));
    } else {
        console.log("No data returned, cannot infer schema from empty * query. Let's try select with id.");
    }
}
checkSchema();
