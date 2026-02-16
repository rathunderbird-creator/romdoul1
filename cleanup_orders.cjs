const fs = require('fs');
const path = 'src/pages/Orders.tsx';
const lines = fs.readFileSync(path, 'utf8').split('\n');

// We want to delete lines 1651 to 1655 (1-based) -> indices 1650 to 1654.
// Verify the content matches what we expect.
const checkLineStart = lines[1650]; // Line 1651
const checkLineEnd = lines[1654];   // Line 1655

if (!checkLineStart.includes("case 'active'") || !checkLineEnd.includes(');')) {
    console.error('Lines 1651-1655 do not match expected content.');
    console.log('Line 1651:', checkLineStart);
    console.log('Line 1655:', checkLineEnd);
    process.exit(1);
}

// Delete 5 lines starting at index 1650.
lines.splice(1650, 5);

fs.writeFileSync(path, lines.join('\n'));
console.log('Cleaned Orders.tsx');
