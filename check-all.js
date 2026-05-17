import { createClient } from '@supabase/supabase-js';

const instances = [
  { name: 'Romdoul1', url: 'https://wkxjmllanbikerrbdjhz.supabase.co', key: 'sb_publishable_rO6uW6bothg51v0MVVjlXg_L-vN5dGR' },
  { name: 'Romdoul2', url: 'https://zroaixkccxcbeqibxpxu.supabase.co', key: 'sb_publishable_Y-SRM91COlU33q-66lynsw_d74HpQQG' },
  { name: 'Romdoul3', url: 'https://hcxlrouodijxhqsubdfv.supabase.co', key: 'sb_publishable_Z2s2Kf7EPi590FYvvaC5dw_lTn_bh8U' }
];

async function main() {
  for (const inst of instances) {
    const supabase = createClient(inst.url, inst.key);
    const { data: users } = await supabase.from('users').select('*');
    const { data: config } = await supabase.from('app_config').select('data').eq('id', 1).single();
    
    console.log(`\n--- ${inst.name} ---`);
    console.log("Users:", users?.map(u => `${u.name} (${u.roleId})`));
    const ccRole = config?.data?.roles?.find(r => r.id === 'customer_care');
    console.log("Customer Care Permissions:", ccRole?.permissions);
  }
}

main().catch(console.error);
