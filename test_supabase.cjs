const SUPABASE_URL = 'https://wkxjmllanbikerrbdjhz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rO6uW6bothg51v0MVVjlXg_L-vN5dGR';

async function fetchMovements() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/stock_movements?type=eq.in&select=*&limit=5`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        const data = await res.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(e);
    }
}
fetchMovements();
