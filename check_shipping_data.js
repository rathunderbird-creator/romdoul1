import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
    // Check the Revenue page or IncomeExpense page logic — how does it compute shipping?
    // Let's check how shipping_co field is used in transactions 
    const { data } = await supabase.from('transactions')
        .select('date, amount, category, shipping_co')
        .eq('type', 'Expense')
        .not('shipping_co', 'is', null)
        .order('date', { ascending: false })
        .limit(20);
    console.log('=== Transactions with shipping_co set ===');
    console.log(data?.map(t => ({ date: t.date?.substring(0,10), amount: t.amount, category: t.category, shipping_co: t.shipping_co })));

    // Check all unique categories that contain "ship" 
    const { data: allCats } = await supabase.from('transactions')
        .select('category')
        .eq('type', 'Expense')
        .not('category', 'is', null)
        .limit(500);
    const cats = new Set();
    (allCats || []).forEach(t => { if (t.category) cats.add(t.category); });
    const shipCats = Array.from(cats).filter(c => c.toLowerCase().includes('ship'));
    console.log('\n=== All categories with "ship" ===');
    console.log(shipCats);
    
    // Check how many orders are shipped per day with their shipping company
    // The real shipping cost might be calculated from a per-company rate
    const { data: dailyShipped } = await supabase.from('sales')
        .select('date, shipping_company, shipping_status')
        .in('shipping_status', ['Shipped', 'Delivered'])
        .gte('date', '2026-08-01T00:00:00.000Z')
        .lte('date', '2026-08-08T23:59:59.999Z');
    
    // Count per company per day
    const counts = {};
    (dailyShipped || []).forEach(s => {
        const d = s.date?.substring(0, 10);
        const co = s.shipping_company || 'Unknown';
        const key = `${d} | ${co}`;
        counts[key] = (counts[key] || 0) + 1;
    });
    console.log('\n=== Shipped orders by company by day (Aug 1-8) ===');
    console.log(counts);
}
check();
