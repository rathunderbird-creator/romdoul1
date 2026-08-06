const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Inventory.tsx');
let lines = fs.readFileSync(file, 'utf8').split('\n');

// 1. Add adjustStock to useStore
const useStoreLineIndex = lines.findIndex(l => l.includes('const { products, addProduct, updateProduct, deleteProduct, deleteProducts, categories, currentUser, productOrder, updateProductOrder, refreshData, addStock } = useStore();'));
if (useStoreLineIndex !== -1) {
    lines[useStoreLineIndex] = lines[useStoreLineIndex].replace('addStock }', 'addStock, adjustStock }');
}

// 2. Add State
const stateIndex = lines.findIndex(l => l.includes('const [addStockCost, setAddStockCost] = useState<number | string>(\'\');'));
if (stateIndex !== -1) {
    lines.splice(stateIndex + 1, 0,
        `    const [adjustStockProduct, setAdjustStockProduct] = useState<Product | null>(null);`,
        `    const [adjustStockAmount, setAdjustStockAmount] = useState<number | string>('');`,
        `    const [adjustStockReason, setAdjustStockReason] = useState<string>('');`,
        `    const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null);`
    );
}

// 3. Add row style
const rowStyleIndex = lines.findIndex(l => l.includes('<tr key={product.id} style={{ borderBottom: \'1px solid var(--color-border)\' }}>'));
if (rowStyleIndex !== -1) {
    lines[rowStyleIndex] = `                                <tr key={product.id} style={{ 
                                    borderBottom: '1px solid var(--color-border)',
                                    backgroundColor: recentlyUpdatedId === product.id ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                                    transition: 'background-color 0.8s ease'
                                }}>`;
}

// 4. Add Adjust Stock button
const editBtnIndex = lines.findIndex(l => l.includes('<button onClick={() => openEditModal(product)} style={{ background: \'none\', border: \'none\', cursor: \'pointer\', color: \'var(--color-primary)\' }} title="Edit Product">'));
if (editBtnIndex !== -1) {
    lines.splice(editBtnIndex, 0,
        `                                                <button onClick={() => setAdjustStockProduct(product)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#10B981' }} title="Adjust Stock">`,
        `                                                    <Layers size={14} />`,
        `                                                </button>`
    );
}

// 5. Update addStock recentlyUpdatedId
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('await addStock(addStockProduct.id, Number(addStockAmount), Number(addStockCost) || 0);')) {
        lines[i] = `                                        const pid = addStockProduct.id;
                                        await addStock(pid, Number(addStockAmount), Number(addStockCost) || 0);`;
    }
    if (lines[i].includes('setAddStockProduct(null);')) {
        lines[i] = `                                        setAddStockProduct(null);
                                        setRecentlyUpdatedId(pid);
                                        setTimeout(() => setRecentlyUpdatedId(null), 2000);`;
    }
}

const modalHtml = `
            {/* Adjust Stock Modal */}
            {
                adjustStockProduct && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                    }}>
                        <div className="glass-panel" style={{ width: '400px', padding: '32px', animation: 'slideIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                <div>
                                    <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Adjust Stock</h3>
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', marginTop: '4px' }}>
                                        {adjustStockProduct.name} - Current Stock: <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{adjustStockProduct.stock}</span>
                                    </p>
                                </div>
                                <button onClick={() => setAdjustStockProduct(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', height: 'fit-content' }}><X size={24} /></button>
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-main)', fontWeight: 500 }}>New Stock Quantity</label>
                                        <input
                                            className="search-input"
                                            type="number"
                                            style={{ width: '100%', fontSize: '16px', padding: '12px' }}
                                            placeholder="e.g. 50"
                                            autoFocus
                                            value={adjustStockAmount}
                                            onChange={e => setAdjustStockAmount(e.target.value === '' ? '' : Number(e.target.value))}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-main)', fontWeight: 500 }}>Reason for Adjustment</label>
                                        <input
                                            className="search-input"
                                            type="text"
                                            style={{ width: '100%', fontSize: '14px', padding: '12px' }}
                                            placeholder="e.g. Damaged goods, recount, etc."
                                            value={adjustStockReason}
                                            onChange={e => setAdjustStockReason(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button onClick={() => setAdjustStockProduct(null)} style={{ padding: '10px 20px', borderRadius: '8px', backgroundColor: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Cancel</button>
                                <button
                                    onClick={async () => {
                                        if (adjustStockAmount === '' || Number(adjustStockAmount) < 0) {
                                            showToast('Please enter a valid stock amount', 'error');
                                            return;
                                        }
                                        const pid = adjustStockProduct.id;
                                        await adjustStock(pid, Number(adjustStockAmount), adjustStockReason);
                                        showToast(\`Adjusted stock for \${adjustStockProduct.name}\`, 'success');
                                        setAdjustStockProduct(null);
                                        setRecentlyUpdatedId(pid);
                                        setTimeout(() => setRecentlyUpdatedId(null), 2000);
                                    }}
                                    className="primary-button"
                                    style={{ padding: '10px 24px' }}
                                    disabled={adjustStockAmount === '' || Number(adjustStockAmount) < 0}
                                >
                                    Confirm Adjustment
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }`;

// 6. Add Modal accurately before export default Inventory;
const exportIndex = lines.findIndex(l => l.includes('export default Inventory;'));
if (exportIndex !== -1) {
    // We insert it above the last '    );' and '};'
    lines.splice(exportIndex - 3, 0, modalHtml);
}

fs.writeFileSync(file, lines.join('\n'));
console.log('Patched Inventory.tsx line-by-line successfully with Modal!');
