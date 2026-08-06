const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://wkxjmllanbikerrbdjhz.supabase.co',
  'sb_publishable_rO6uW6bothg51v0MVVjlXg_L-vN5dGR'
);

async function checkMovements() {
  const today = '2026-08-05';
  
  // Get all stock movements of type 'out' for today
  const { data: movements, error: movementsError } = await supabase
    .from('stock_movements')
    .select('id, reference_id, product_name, quantity')
    .eq('type', 'out')
    .gte('movement_date', today);
    
  if (movementsError) {
    console.error('Error fetching movements:', movementsError);
    return;
  }

  const uniqueOrders = new Set(movements.map(m => m.reference_id));
  const totalQuantity = movements.reduce((sum, m) => sum + m.quantity, 0);
  
  console.log(`Total Unique Orders: ${uniqueOrders.size}`);
  console.log(`Total Movement Records: ${movements.length}`);
  console.log(`Total Quantity (Items Issued): ${totalQuantity}`);
  
  // Find orders with > 1 record or records with > 1 quantity
  const multiProductOrders = [];
  const multiQuantityRecords = [];
  
  const orderCounts = {};
  movements.forEach(m => {
    orderCounts[m.reference_id] = (orderCounts[m.reference_id] || 0) + 1;
    if (m.quantity > 1) multiQuantityRecords.push(m);
  });
  
  for (const [orderId, count] of Object.entries(orderCounts)) {
    if (count > 1) multiProductOrders.push(orderId);
  }
  
  console.log(`Orders with multiple distinct products: ${multiProductOrders.length}`);
  console.log(`Records with quantity > 1: ${multiQuantityRecords.length}`);
}

checkMovements();
