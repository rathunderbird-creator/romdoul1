const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Inventory.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Add adjustStock to useStore
content = content.replace(
    'const { products, addProduct, updateProduct, deleteProduct, deleteProducts, categories, currentUser, productOrder, updateProductOrder, refreshData, addStock } = useStore();',
    'const { products, addProduct, updateProduct, deleteProduct, deleteProducts, categories, currentUser, productOrder, updateProductOrder, refreshData, addStock, adjustStock } = useStore();'
);

// 2. Add state
content = content.replace(
    "const [addStockCost, setAddStockCost] = useState<number | string>('');",
    `const [addStockCost, setAddStockCost] = useState<number | string>('');
    const [adjustStockProduct, setAdjustStockProduct] = useState<Product | null>(null);
    const [adjustStockAmount, setAdjustStockAmount] = useState<number | string>('');
    const [adjustStockReason, setAdjustStockReason] = useState<string>('');
    const [recentlyUpdatedId, setRecentlyUpdatedId] = useState<string | null>(null);`
);

// 3. Add button in table
content = content.replace(
    '<button onClick={() => updateProduct(product.id, { stock: 0 })} style={{ background: \'none\', border: \'none\', cursor: \'pointer\', color: \'#F59E0B\' }} title="Mark Out of Stock">\n                                                    <AlertTriangle size={14} />\n                                                </button>',
    `<button onClick={() => updateProduct(product.id, { stock: 0 })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F59E0B' }} title="Mark Out of Stock">
                                                    <AlertTriangle size={14} />
                                                </button>
                                                <button onClick={() => setAdjustStockProduct(product)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#10B981' }} title="Adjust Stock">
                                                    <Layers size={14} />
                                                </button>`
);

// 4. Add modal and modify table row styling
// Find the row definition:
content = content.replace(
    '<tr key={product.id} style={{ borderBottom: \'1px solid var(--color-border)\' }}>',
    `<tr key={product.id} style={{ 
                                    borderBottom: '1px solid var(--color-border)',
                                    backgroundColor: recentlyUpdatedId === product.id ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                                    transition: 'background-color 0.8s ease'
                                }}>`
);

// 5. Add recently updated to addStock
content = content.replace(
    'await addStock(addStockProduct.id, Number(addStockAmount), Number(addStockCost) || 0);\n                                                    showToast(`Added ${addStockAmount} stock to ${addStockProduct.name}`, \'success\');\n                                                    setAddStockProduct(null);',
    `const pid = addStockProduct.id;
                                                    await addStock(pid, Number(addStockAmount), Number(addStockCost) || 0);
                                                    showToast(\`Added \${addStockAmount} stock to \${addStockProduct.name}\`, 'success');
                                                    setAddStockProduct(null);
                                                    setRecentlyUpdatedId(pid);
                                                    setTimeout(() => setRecentlyUpdatedId(null), 2000);`
);

content = content.replace(
    'await addStock(addStockProduct.id, Number(addStockAmount), Number(addStockCost) || 0);\n                                        showToast(`Added ${addStockAmount} stock to ${addStockProduct.name}`, \'success\');\n                                        setAddStockProduct(null);',
    `const pid = addStockProduct.id;
                                        await addStock(pid, Number(addStockAmount), Number(addStockCost) || 0);
                                        showToast(\`Added \${addStockAmount} stock to \${addStockProduct.name}\`, 'success');
                                        setAddStockProduct(null);
                                        setRecentlyUpdatedId(pid);
                                        setTimeout(() => setRecentlyUpdatedId(null), 2000);`
);

// 6. Append modal at the bottom
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
            }
        </div>
    );
};
export default Inventory;
`;

content = content.replace('        </div>\n    );\n};\n\nexport default Inventory;', modalHtml);
content = content.replace('        </div >\n    );\n};\nexport default Inventory;', modalHtml);

fs.writeFileSync(file, content);
console.log('Patched Inventory.tsx');
