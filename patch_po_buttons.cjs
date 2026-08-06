const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'procurement', 'PurchaseOrdersPage.tsx');
let lines = fs.readFileSync(file, 'utf8').split('\n');

// 1. Add state for payingPORemaining
const paymentAmountStateIndex = lines.findIndex(l => l.includes('const [paymentAmount, setPaymentAmount] = useState<number | \'\'>(\'\');'));
if (paymentAmountStateIndex !== -1 && !lines.some(l => l.includes('payingPORemaining'))) {
    lines.splice(paymentAmountStateIndex, 0, `    const [payingPORemaining, setPayingPORemaining] = useState<number>(0);`);
}

// 2. Set payingPORemaining in handleOpenPaymentModal
const openPaymentModalIndex = lines.findIndex(l => l.includes('const remaining = (po.total_amount || 0) - (po.amount_paid || 0);'));
if (openPaymentModalIndex !== -1 && !lines.some(l => l.includes('setPayingPORemaining(remaining'))) {
    lines.splice(openPaymentModalIndex + 1, 0, `        setPayingPORemaining(remaining > 0 ? remaining : 0);`);
}

// 3. Add partial payment buttons below the amount input
const amountInputClosingIndex = lines.findIndex((l, i) => l.includes('min="0" step="0.01"') && i > 0 && lines[i - 1].includes('setPaymentAmount'));
if (amountInputClosingIndex !== -1) {
    const wrapperClosingIndex = amountInputClosingIndex + 2;
    if (lines[wrapperClosingIndex].includes('</div>') && !lines[wrapperClosingIndex + 1]?.includes('payingPORemaining > 0')) {
        lines.splice(wrapperClosingIndex, 0,
            `                                {payingPORemaining > 0 && (`,
            `                                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>`,
            `                                        <button className="secondary-button" style={{ padding: '6px 12px', fontSize: '12px', flex: 1 }} onClick={() => setPaymentAmount(payingPORemaining)}>Full</button>`,
            `                                        <button className="secondary-button" style={{ padding: '6px 12px', fontSize: '12px', flex: 1 }} onClick={() => setPaymentAmount(payingPORemaining * 0.75)}>75%</button>`,
            `                                        <button className="secondary-button" style={{ padding: '6px 12px', fontSize: '12px', flex: 1 }} onClick={() => setPaymentAmount(payingPORemaining * 0.5)}>50%</button>`,
            `                                        <button className="secondary-button" style={{ padding: '6px 12px', fontSize: '12px', flex: 1 }} onClick={() => setPaymentAmount(payingPORemaining * 0.25)}>25%</button>`,
            `                                    </div>`,
            `                                )}`
        );
    }
}

fs.writeFileSync(file, lines.join('\n'));
console.log('Patched PurchaseOrdersPage.tsx with partial buttons successfully');
