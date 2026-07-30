const fs = require('fs');
const glob = require('glob');
const path = require('path');

const files = glob.sync('src/**/*.{ts,tsx,json}');
let changedFiles = 0;

for (const file of files) {
  const filePath = path.resolve(file);
  let content = fs.readFileSync(filePath, 'utf8');
  let newContent = content
    .replace(/'Ordered'/g, "'Drafted'")
    .replace(/"Ordered"/g, '"Drafted"')
    .replace(/Ordered:/g, 'Drafted:')
    .replace(/ordered: "Ordered"/g, 'ordered: "Drafted"')
    .replace(/>Ordered</g, '>Drafted<');
    
  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    changedFiles++;
    console.log('Updated', file);
  }
}
console.log('Total files changed:', changedFiles);
