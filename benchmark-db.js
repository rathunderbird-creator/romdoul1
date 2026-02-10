import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wkxjmllanbikerrbdjhz.supabase.co';
const supabaseAnonKey = 'sb_publishable_rO6uW6bothg51v0MVVjlXg_L-vN5dGR';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function benchmark() {
    console.log('Starting Supabase Benchmark (Phase 4 - Optimization)...');

    // 1. Optimized Query (No Image)
    console.log('\nBenchmarking Optimized Query (No Image)...');
    const startOpt = performance.now();
    const { data: dataOpt, error: errorOpt } = await supabase
        .from('sales')
        .select('*, items:sale_items(id, sale_id, product_id, name, price, quantity)') // Explicitly exclude image
        .order('date', { ascending: false })
        .limit(200);
    const endOpt = performance.now();

    if (errorOpt) console.error('Error fetching optimized:', errorOpt);
    else {
        const size = JSON.stringify(dataOpt).length;
        console.log(`Fetched ${dataOpt.length} rows in ${(endOpt - startOpt).toFixed(2)}ms`);
        console.log(`Payload size: ${(size / 1024).toFixed(2)} KB`);
    }

    // 2. Original Query (With Image) - Control
    console.log('\nBenchmarking Original Query (With Image)...');
    const startOrig = performance.now();
    const { data: dataOrig, error: errorOrig } = await supabase
        .from('sales')
        .select('*, items:sale_items(*)')
        .order('date', { ascending: false })
        .limit(200);
    const endOrig = performance.now();

    if (errorOrig) console.error('Error fetching original:', errorOrig);
    else {
        const size = JSON.stringify(dataOrig).length;
        console.log(`Fetched ${dataOrig.length} rows in ${(endOrig - startOrig).toFixed(2)}ms`);
        console.log(`Payload size: ${(size / 1024 / 1024).toFixed(2)} MB`);
    }
}

benchmark();
