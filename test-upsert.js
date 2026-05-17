import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://hcxlrouodijxhqsubdfv.supabase.co', 'sb_publishable_Z2s2Kf7EPi590FYvvaC5dw_lTn_bh8U');

async function main() {
    const { data: config } = await supabase.from('app_config').select('data').eq('id', 1).single();
    const loadedConfig = config.data;
    
    // update customer_care
    loadedConfig.roles = loadedConfig.roles.map(r => {
        if (r.id === 'customer_care') {
            return {
                ...r,
                permissions: Array.from(new Set([...r.permissions, 'create_orders', 'process_sales']))
            }
        }
        return r;
    });

    console.log("Attempting to upsert...");
    const { data, error } = await supabase.from('app_config').upsert({ id: 1, data: loadedConfig });
    console.log("Upsert result:", { data, error });
}

main().catch(console.error);
