import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
    const { data, error } = await supabase.from('daily_expenses').select('*').limit(1);
    if (error) {
        console.log("Table daily_expenses doesn't exist:", error.message);
    } else {
        console.log("Table daily_expenses exists!");
    }
}
check();
