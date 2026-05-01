// Test user insert to diagnose RLS issue
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://wkxjmllanbikerrbdjhz.supabase.co',
    'sb_publishable_rO6uW6bothg51v0MVVjlXg_L-vN5dGR'
);

async function test() {
    // 1. Try inserting a test user
    const testId = 'test_' + Date.now();
    console.log('--- Inserting test user:', testId);
    const { data: insertData, error: insertError } = await supabase.from('users').insert({
        id: testId,
        name: 'Test User Debug',
        email: 'test@debug.com',
        role_id: 'test_role',
        pin: '1234',
        base_salary: 0
    }).select();

    console.log('Insert result:', { data: insertData, error: insertError });

    // 2. Try reading all users
    console.log('\n--- Fetching all users:');
    const { data: users, error: readError } = await supabase.from('users').select('id, name, email');
    console.log('Users count:', users?.length);
    console.log('Read error:', readError);
    if (users) {
        users.forEach(u => console.log('  -', u.id.slice(0, 15), u.name, u.email));
    }

    // 3. Clean up test user
    if (!insertError) {
        console.log('\n--- Cleaning up test user...');
        const { error: delErr } = await supabase.from('users').delete().eq('id', testId);
        console.log('Delete result:', delErr ? delErr.message : 'OK');
    }
}

test().catch(console.error);
