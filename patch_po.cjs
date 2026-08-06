const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'procurement', 'PurchaseOrdersPage.tsx');
let lines = fs.readFileSync(file, 'utf8').split('\n');

// 1. Add state for Initial Payment
const stateIndex = lines.findIndex(l => l.includes('const [paymentNotes, setPaymentNotes] = useState(\'\');'));
if (stateIndex !== -1 && !lines.some(l => l.includes('poFormPaymentAmount'))) {
    lines.splice(stateIndex + 1, 0,
        `    const [poFormPaymentAmount, setPoFormPaymentAmount] = useState<number | ''>('');`,
        `    const [poFormPaymentMethod, setPoFormPaymentMethod] = useState('Cash');`
    );
}

// 2. Reset state in handleOpenModal
const openModalIndex = lines.findIndex(l => l.includes('setIsModalOpen(true);') && lines[l - 1]?.includes('setLines'));
if (openModalIndex !== -1) {
    if (!lines[openModalIndex - 1].includes('setPoFormPaymentAmount')) {
        lines.splice(openModalIndex, 0,
            `        setPoFormPaymentAmount('');`,
            `        setPoFormPaymentMethod('Cash');`
        );
    }
} else {
    // robust search for handleOpenModal
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('setIsModalOpen(true);')) {
            // Check if we are inside handleOpenModal by looking a few lines up
            let isHandleOpen = false;
            for (let j = i; j > i - 15; j--) {
                if (lines[j] && lines[j].includes('const handleOpenModal = () => {')) {
                    isHandleOpen = true;
                    break;
                }
            }
            if (isHandleOpen && !lines[i - 1].includes('setPoFormPaymentMethod')) {
                lines.splice(i, 0,
                    `        setPoFormPaymentAmount('');`,
                    `        setPoFormPaymentMethod('Cash');`
                );
                break;
            }
        }
    }
}

// 3. Update handleSave
const savePoCallIndex = lines.findIndex(l => l.includes('await savePurchaseOrder('));
if (savePoCallIndex !== -1) {
    if (!lines[savePoCallIndex].includes('const poId =')) {
        lines[savePoCallIndex] = lines[savePoCallIndex].replace('await savePurchaseOrder', 'const poId = await savePurchaseOrder');
    }
}

const setIsModalOpenFalseIndex = lines.findIndex(l => l.includes('setIsModalOpen(false);') && l.trim().startsWith('setIsModalOpen(false)'));
if (setIsModalOpenFalseIndex !== -1) {
    if (!lines[setIsModalOpenFalseIndex - 1].includes('recordSupplierPayment')) {
        lines.splice(setIsModalOpenFalseIndex, 0,
            `            if (poFormPaymentAmount && Number(poFormPaymentAmount) > 0 && poId && !editingPOId) {`,
            `                await recordSupplierPayment(poId, supplierId, Number(poFormPaymentAmount), poFormPaymentMethod, 'Payment on PO creation');`,
            `            }`
        );
    }
}

// 4. Add UI section before Modal Footer
const modalFooterIndex = lines.findIndex(l => l.includes('{/* Modal Footer */}'));
if (modalFooterIndex !== -1) {
    if (!lines[modalFooterIndex - 2].includes('Initial Payment')) {
        lines.splice(modalFooterIndex, 0,
            `                        {/* Initial Payment Section */}`,
            `                        {!editingPOId && (`,
            `                            <div style={{ padding: '0 24px 24px' }}>`,
            `                                <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px', borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}>Initial Payment (Optional)</h3>`,
            `                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>`,
            `                                    <div>`,
            `                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 500 }}>Amount Paid</label>`,
            `                                        <input `,
            `                                            type="number" `,
            `                                            className="input-field" `,
            `                                            style={{ width: '100%', padding: '10px', borderRadius: '8px', fontSize: '14px' }}`,
            `                                            placeholder="0.00"`,
            `                                            value={poFormPaymentAmount}`,
            `                                            onChange={(e) => setPoFormPaymentAmount(parseFloat(e.target.value) || '')}`,
            `                                            min="0" step="0.01"`,
            `                                        />`,
            `                                    </div>`,
            `                                    <div>`,
            `                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 500 }}>Payment Method</label>`,
            `                                        <select `,
            `                                            className="input-field" `,
            `                                            style={{ width: '100%', padding: '10px', borderRadius: '8px', fontSize: '14px' }}`,
            `                                            value={poFormPaymentMethod}`,
            `                                            onChange={(e) => setPoFormPaymentMethod(e.target.value)}`,
            `                                        >`,
            `                                            <option value="Cash">Cash</option>`,
            `                                            <option value="Bank Transfer">Bank Transfer</option>`,
            `                                            <option value="On Credit">On Credit</option>`,
            `                                        </select>`,
            `                                    </div>`,
            `                                </div>`,
            `                            </div>`,
            `                        )}`
        );
    }
}

fs.writeFileSync(file, lines.join('\n'));
console.log('Patched PurchaseOrdersPage.tsx successfully');
