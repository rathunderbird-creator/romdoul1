import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function main() {
    const { data: users } = await supabase.from('users').select('*');
    console.log("Users:");
    console.dir(users, { depth: null });

    const { data: config } = await supabase.from('app_config').select('data').eq('id', 1).single();
    console.log("Roles:");
    console.dir(config.data.roles, { depth: null });
}

main().catch(console.error);
