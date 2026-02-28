import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

async function main() {
    console.log("Testing two-step search with inner join on sales...");
    const term = 'NR-3026'.toLowerCase();

    let itemQuery = supabase
        .from('sale_items')
        .select('sale_id, sales!inner(date)')
        .ilike('name', `%${term}%`);

    const start = new Date();
    start.setDate(start.getDate() - 30); // 30 days ago

    // Testing filtering on the inner joined table
    itemQuery = itemQuery.gte('sales.date', start.toISOString());

    const { data: itemMatches, error: itemError } = await itemQuery.limit(200);

    console.log("Item Matches:", itemMatches?.length, "Error:", itemError);
    if (itemMatches && itemMatches.length > 0) {
        console.log("First match:", itemMatches[0]);
    }
}

main();
