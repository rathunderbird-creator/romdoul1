const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'DashboardPage.tsx');
let lines = fs.readFileSync(file, 'utf8').split('\n');

// 1. Add state for inventory counts
const stateIndex = lines.findIndex(l => l.includes('const [isLoadingSales, setIsLoadingSales] = React.useState(false);'));
if (stateIndex !== -1 && !lines.some(l => l.includes('stockInCount'))) {
    lines.splice(stateIndex, 0,
        `    const [stockInCount, setStockInCount] = React.useState(0);`,
        `    const [stockOutCount, setStockOutCount] = React.useState(0);`
    );
}

// 2. Fetch inventory stats inside fetchDashboardSales
const tryIndex = lines.findIndex((l, i) => l.includes('try {') && lines[i - 1]?.includes('setIsLoadingSales(true);'));
if (tryIndex !== -1 && !lines.some(l => l.includes("let invQuery = supabase.from('stock_movements')"))) {
    lines.splice(tryIndex + 1, 0,
        `            let invQuery = supabase.from('stock_movements').select('type, quantity');`,
        `            if (dateRange.start) {`,
        `                invQuery = invQuery.gte('movement_date', dateRange.start);`,
        `            }`,
        `            if (dateRange.end) {`,
        `                invQuery = invQuery.lte('movement_date', dateRange.end);`,
        `            }`,
        `            const { data: invData } = await invQuery;`,
        `            if (invData) {`,
        `                const inTotal = invData.filter((d: any) => d.type === 'in').reduce((sum: number, d: any) => sum + (d.quantity || 0), 0);`,
        `                const outTotal = invData.filter((d: any) => d.type === 'out').reduce((sum: number, d: any) => sum + (d.quantity || 0), 0);`,
        `                setStockInCount(inTotal);`,
        `                setStockOutCount(outTotal);`,
        `            }`,
        ``
    );
}

// 3. Add Stock-In and Stock-Out cards to the UI
const inventorySectionIndex = lines.findIndex(l => l.includes("title={t('dashboard.lowStockAlert')}"));
if (inventorySectionIndex !== -1) {
    // Find the end of the StatsCard for lowStockAlert
    let endOfCard = inventorySectionIndex;
    while (!lines[endOfCard].includes('/>')) {
        endOfCard++;
    }
    
    if (!lines.some(l => l.includes('title="Stock-In (Qty)"'))) {
        lines.splice(endOfCard + 1, 0,
            `                <StatsCard`,
            `                    title="Stock-In (Qty)"`,
            `                    value={stockInCount}`,
            `                    icon={Package}`,
            `                    color="#059669"`,
            `                    bgColor="#D1FAE5"`,
            `                    onClick={() => navigate('/stock-in')}`,
            `                />`,
            `                <StatsCard`,
            `                    title="Stock-Out (Qty)"`,
            `                    value={stockOutCount}`,
            `                    icon={Package}`,
            `                    color="#DC2626"`,
            `                    bgColor="#FEE2E2"`,
            `                    onClick={() => navigate('/stock-out')}`,
            `                />`
        );
    }
}

fs.writeFileSync(file, lines.join('\n'));
console.log('Patched DashboardPage.tsx successfully');
