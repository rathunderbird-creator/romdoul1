// Check Romdoul2 app_config and users to diagnose display issue
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://zroaixkccxcbeqibxpxu.supabase.co',
    'sb_publishable_Y-SRM91COlU33q-66lynsw_d74HpQQG'
);

async function check() {
    console.log('=== Romdoul2 Diagnostic ===\n');

    // 1. Check app_config
    console.log('1. App Config:');
    const { data: config, error: configErr } = await supabase.from('app_config').select('*').eq('id', 1).single();
    if (configErr) {
        console.log('  ❌ ERROR:', configErr.message);
    } else {
        console.log('  ✅ Config exists');
        const d = config.data;
        console.log('    storeName:', d.storeName || '(not set)');
        console.log('    roles:', d.roles?.length || 0, 'roles');
        console.log('    users in config:', d.users?.length || 0);
        if (d.roles) d.roles.forEach(r => console.log('      -', r.id, r.name));
    }

    // 2. Check users table
    console.log('\n2. Users:');
    const { data: users, error: usersErr } = await supabase.from('users').select('*');
    if (usersErr) {
        console.log('  ❌ ERROR:', usersErr.message);
    } else {
        console.log('  ✅', users.length, 'users');
        users.forEach(u => {
            console.log(`    - ${u.name} (${u.email}) role=${u.role_id} pin=${u.pin ? '****' : 'NULL'} base_salary=${u.base_salary}`);
        });
    }

    // 3. Quick sample of products
    console.log('\n3. Products (first 3):');
    const { data: products, error: prodErr } = await supabase.from('products').select('id, name, price, stock').limit(3);
    if (prodErr) {
        console.log('  ❌ ERROR:', prodErr.message);
    } else {
        products.forEach(p => console.log(`    - ${p.name} price=$${p.price} stock=${p.stock}`));
    }

    // 4. Check sales sample
    console.log('\n4. Sales (first 3):');
    const { data: sales, error: salesErr } = await supabase.from('sales').select('id, total, date, payment_status, shipping_status').order('date', { ascending: false }).limit(3);
    if (salesErr) {
        console.log('  ❌ ERROR:', salesErr.message);
    } else {
        sales.forEach(s => console.log(`    - ${s.id.slice(0, 12)}... $${s.total} ${s.payment_status} ${s.shipping_status}`));
    }

    // 5. Check if base_salary column exists
    console.log('\n5. Users table column check (base_salary):');
    const { data: userSample, error: colErr } = await supabase.from('users').select('id, name, base_salary').limit(1);
    if (colErr) {
        console.log('  ❌ base_salary column MISSING:', colErr.message);
        console.log('  >>> Run this in SQL Editor: ALTER TABLE users ADD COLUMN IF NOT EXISTS base_salary NUMERIC DEFAULT 0;');
    } else {
        console.log('  ✅ base_salary column exists, value:', userSample[0]?.base_salary);
    }
}

check().catch(console.error);
