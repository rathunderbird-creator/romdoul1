import { createClient } from '@supabase/supabase-js';

const instances = [
    { name: 'Romdoul1', url: 'https://vksylygxyjytzztvwjkk.supabase.co', key: 'sb_publishable_Z2s2Kf7EPi590FYvvaC5dw_lTn_bh8U' },
    { name: 'Romdoul2', url: 'https://hcxlrouodijxhqsubdfv.supabase.co', key: 'sb_publishable_Z2s2Kf7EPi590FYvvaC5dw_lTn_bh8U' },
    { name: 'Romdoul3', url: 'https://hcxlrouodijxhqsubdfv.supabase.co', key: 'sb_publishable_Z2s2Kf7EPi590FYvvaC5dw_lTn_bh8U' }
];

async function main() {
    for (const inst of instances) {
        console.log(`Checking ${inst.name}...`);
        const supabase = createClient(inst.url, inst.key);
        const { data: users, error } = await supabase.from('users').select('*');
        if (error) {
            console.error(`Error fetching users for ${inst.name}:`, error);
            continue;
        }

        for (const user of users) {
            if (!user.role_id) {
                console.log(`Found user without role_id: ${user.name}`);
                const defaultRole = user.name.toLowerCase().includes('admin') ? 'admin' : 'salesman';
                await supabase.from('users').update({ role_id: defaultRole }).eq('id', user.id);
                console.log(`Updated ${user.name} to ${defaultRole}`);
            }
        }
    }
}

main().catch(console.error);
