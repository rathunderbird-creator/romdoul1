const fs = require('fs');
const path = 'src/pages/Orders.tsx';
const lines = fs.readFileSync(path, 'utf8').split('\n');

// We want to delete lines 1615 to 1650 (1-based) -> indices 1614 to 1649.
// But first verify the content matches what we expect to avoid deleting wrong things.
// In step 730 view_file, line 1615 is: type = "text"
// Indices are 0-based. Line 1 shows at index 0. Line 1615 at index 1614.
const checkLine = lines[1614];
if (!checkLine.includes('type') && !checkLine.includes('text')) {
    console.error('Line 1615 does not match expected content:', checkLine);
    // Print surrounding lines to help debug
    console.log('Line 1614:', lines[1613]);
    console.log('Line 1615:', lines[1614]);
    console.log('Line 1616:', lines[1615]);
    process.exit(1);
}

// Delete lines 1615 to 1650 (inclusive).
// 1650 - 1615 + 1 = 36 lines.
lines.splice(1614, 36);

// Now insert `case 'remark'` block before `case 'lastEdit'` (which was at 1598, now at 1598).
// Index 1597.
const remarkBlock = `                                                                    case 'remark':
                                                                        return (
                                                                            <td key={colId} style={{ ...cellStyle, padding: '4px' }}>
                                                                                <input
                                                                                    type="text"
                                                                                    readOnly={!canEdit}
                                                                                    className="search-input"
                                                                                    defaultValue={order.remark || ''}
                                                                                    placeholder="Add Remark"
                                                                                    style={{
                                                                                        width: '100%',
                                                                                        padding: '4px 8px',
                                                                                        fontSize: 'inherit',
                                                                                        color: 'inherit',
                                                                                        fontFamily: 'Battambang',
                                                                                        border: '1px solid transparent',
                                                                                        background: 'transparent'
                                                                                    }}
                                                                                    onFocus={(e) => {
                                                                                        e.target.style.background = 'white';
                                                                                        e.target.style.borderColor = 'var(--color-primary)';
                                                                                    }}
                                                                                    onBlur={(e) => {
                                                                                        e.target.style.background = 'transparent';
                                                                                        e.target.style.borderColor = 'transparent';
                                                                                        const val = e.target.value.trim();
                                                                                        if (val !== (order.remark || '')) {
                                                                                            updateOrder(order.id, { remark: val });
                                                                                        }
                                                                                    }}
                                                                                    onKeyDown={(e) => {
                                                                                        if (e.key === ' ') e.stopPropagation();
                                                                                        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                                                                                    }}
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                    onMouseDown={(e) => e.stopPropagation()}
                                                                                    onPointerDown={(e) => e.stopPropagation()}
                                                                                />
                                                                            </td>
                                                                        );`;

lines.splice(1597, 0, remarkBlock);

fs.writeFileSync(path, lines.join('\n'));
console.log('Fixed Orders.tsx');
