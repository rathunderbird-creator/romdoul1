const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const sql = fs.readFileSync('supabase_custom_locations.sql', 'utf8');

async function run() {
    console.log('Executing SQL...');
    // Note: supabase-js v2 doesn't have a direct raw SQL execution method via the standard client API.
    // Using RPC if available, or just outputting instructions if not.
    // Actually, for creating tables we usually need to run it in the Supabase Dashboard SQL Editor
    // or use the Management API. Let's try to see if there's an `exec_sql` RPC set up,
    // otherwise print a warning.
    const { data, error } = await supabase.rpc('exec_sql', { query: sql });

    if (error) {
        console.error('Error executing SQL via RPC:', error);
        console.log('\n--- IMPORTANT ---');
        console.log('It appears raw SQL execution via the client is not supported or the RPC func is missing.');
        console.log('Please copy the contents of `supabase_custom_locations.sql` and run it manually in your Supabase project SQL Editor.');
        console.log('-----------------\n');
    } else {
        console.log('SQL executed successfully:', data);
    }
}

run();
