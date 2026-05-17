import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://hcxlrouodijxhqsubdfv.supabase.co', 'sb_publishable_Z2s2Kf7EPi590FYvvaC5dw_lTn_bh8U');

async function main() {
    const { data: config } = await supabase.from('app_config').select('data').eq('id', 1).single();
    console.log(JSON.stringify(config.data.roles, null, 2));
}

main().catch(console.error);
