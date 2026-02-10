
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wkxjmllanbikerrbdjhz.supabase.co';
const supabaseAnonKey = 'sb_publishable_rO6uW6bothg51v0MVVjlXg_L-vN5dGR';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkColumn() {
    console.log('Fetching one product...');
    const { data, error } = await supabase.from('products').select('*').limit(1);

    if (error) {
        console.error('Error fetching product:', error);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No products found in table.');
        return;
    }

    const product = data[0];
    console.log('Product keys:', Object.keys(product));

    if ('low_stock_threshold' in product) {
        console.log('✅ Column "low_stock_threshold" exists!');
        console.log('Value:', product.low_stock_threshold);
    } else {
        console.log('❌ Column "low_stock_threshold" DOES NOT exist.');

        // Check for camelCase version just in case
        if ('lowStockThreshold' in product) {
            console.log('⚠️ Found "lowStockThreshold" column instead (camelCase).');
        }
    }
}

checkColumn();
