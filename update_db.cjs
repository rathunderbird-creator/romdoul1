const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function updateDb() {
  console.log('Updating sales...');
  const { data, error } = await supabase
    .from('sales')
    .update({ shipping_status: 'Drafted' })
    .eq('shipping_status', 'Ordered');
    
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Success!', data);
  }
}

updateDb();
