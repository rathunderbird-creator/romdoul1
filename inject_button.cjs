const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Inventory.tsx');
let content = fs.readFileSync(file, 'utf8');

// Match the Mark Out of Stock button block
const regex = /(<button[^>]*title="Mark Out of Stock">\s*<AlertTriangle[^>]*>\s*<\/button>)/i;

const injection = `$1
                                                <button onClick={() => setAdjustStockProduct(product)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#10B981' }} title="Adjust Stock">
                                                    <Layers size={14} />
                                                </button>`;

if (regex.test(content)) {
    content = content.replace(regex, injection);
    fs.writeFileSync(file, content);
    console.log('Button injected successfully with Regex!');
} else {
    console.log('Target not found with Regex!');
}
