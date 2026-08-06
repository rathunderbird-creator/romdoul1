const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'procurement', 'SupplierDetailsPage.tsx');
let lines = fs.readFileSync(file, 'utf8').split('\n');

// 1. Add Trash2 to imports
const lucideIndex = lines.findIndex(l => l.includes('from \'lucide-react\''));
if (lucideIndex !== -1 && !lines[lucideIndex].includes('Trash2')) {
    lines[lucideIndex] = lines[lucideIndex].replace('}', ', Trash2 }');
}

// 2. Add deletePurchaseOrder and deleteSupplierPayment to useProcurement
const procIndex = lines.findIndex(l => l.includes('useProcurement()'));
if (procIndex !== -1) {
    if (!lines[procIndex].includes('deletePurchaseOrder')) {
        lines[procIndex] = lines[procIndex].replace('}', ', deletePurchaseOrder }');
    }
    if (!lines[procIndex].includes('deleteSupplierPayment')) {
        lines[procIndex] = lines[procIndex].replace('}', ', deleteSupplierPayment }');
    }
}

// 3. Add handleDeleteLedgerEntry function
const returnIndex = lines.findIndex(l => l.trim() === 'return (');
if (returnIndex !== -1 && !lines.some(l => l.includes('handleDeleteLedgerEntry'))) {
    lines.splice(returnIndex, 0,
        `    const handleDeleteLedgerEntry = async (entry: LedgerEntry) => {`,
        `        if (!window.confirm(\`Are you sure you want to delete this \${entry.type}? This action cannot be undone.\`)) return;`,
        `        if (entry.id.startsWith('po-')) {`,
        `            await deletePurchaseOrder(entry.id.replace('po-', ''));`,
        `        } else if (entry.id.startsWith('pay-')) {`,
        `            await deleteSupplierPayment(entry.id.replace('pay-', ''));`,
        `        }`,
        `    };`,
        ``
    );
}

// 4. Update table headers
const clearInvoiceThIndex = lines.findIndex(l => l.includes('>Clear Invoice</th>'));
if (clearInvoiceThIndex !== -1) {
    // Add Actions th
    if (!lines[clearInvoiceThIndex + 1]?.includes('>Actions</th>')) {
        lines.splice(clearInvoiceThIndex + 1, 0,
            `                            <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textAlign: 'right', width: '80px' }}>Actions</th>`
        );
    }
}

// 5. Update table rows
const colSpanIndex = lines.findIndex(l => l.includes('colSpan={8}'));
if (colSpanIndex !== -1) {
    lines[colSpanIndex] = lines[colSpanIndex].replace('colSpan={8}', 'colSpan={9}');
}

const balanceTdIndex = lines.findIndex((l, i) => l.includes('{formatCurrency(entry.balance)}') && i > 0 && lines[i - 1].includes('td'));
if (balanceTdIndex !== -1) {
    // We are at the {formatCurrency... line. The td closing is on the next line.
    const tdCloseIndex = balanceTdIndex + 1;
    if (lines[tdCloseIndex].includes('</td>') && !lines[tdCloseIndex + 2]?.includes('handleDeleteLedgerEntry')) {
        lines.splice(tdCloseIndex + 1, 0,
            `                                    <td style={{ padding: '12px 20px', textAlign: 'right' }}>`,
            `                                        <button `,
            `                                            onClick={() => handleDeleteLedgerEntry(entry)}`,
            `                                            style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', opacity: 0.7 }}`,
            `                                            title="Delete Entry"`,
            `                                        >`,
            `                                            <Trash2 size={16} />`,
            `                                        </button>`,
            `                                    </td>`
        );
    }
}

fs.writeFileSync(file, lines.join('\n'));
console.log('Patched SupplierDetailsPage.tsx successfully');
