const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://wkxjmllanbikerrbdjhz.supabase.co',
  'sb_publishable_rO6uW6bothg51v0MVVjlXg_L-vN5dGR'
);

async function getMissingOrders() {
  const today = '2026-08-05';
  
  // Get all Shipped and Delivered orders
  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('id, shipping_status, date')
    .in('shipping_status', ['Delivered', 'Shipped'])
    .gte('date', today + 'T00:00:00Z');

  if (salesError) {
    console.error('Error fetching sales:', salesError);
    return;
  }

  // Get all stock movements of type 'out' for today
  const { data: movements, error: movementsError } = await supabase
    .from('stock_movements')
    .select('reference_id')
    .eq('type', 'out')
    .gte('movement_date', today);
    
  if (movementsError) {
    console.error('Error fetching movements:', movementsError);
    return;
  }

  const movementIds = new Set(movements.map(m => m.reference_id));
  
  const missing = sales.filter(s => !movementIds.has(s.id));
  
  console.log(`Total Shipped/Delivered Today: ${sales.length}`);
  console.log(`Total Missing Stock Movement: ${missing.length}`);
  console.log('Missing Order IDs (Delivered):');
  missing.filter(s => s.shipping_status === 'Delivered').forEach(s => console.log(s.id));
  console.log('Missing Order IDs (Shipped):');
  missing.filter(s => s.shipping_status === 'Shipped').forEach(s => console.log(s.id));
}

getMissingOrders();
