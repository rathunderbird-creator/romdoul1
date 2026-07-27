import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf-8');
const supabaseUrl = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const upsertData = [{
      id: crypto.randomUUID(),
      name: 'Test',
      bot_token: 't',
      chat_id: 'c',
      trigger_statuses: ['Ordered'],
      note: 'test note'
  }];
  const { data, error } = await supabase.from('telegram_notifications').upsert(upsertData).select();
  console.log('Error:', error);
  console.log('Data:', data);
}
test();
