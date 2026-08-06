const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'DashboardPage.tsx');
let content = fs.readFileSync(file, 'utf8');

// Replace t('dashboard.totalSales') with 'Total Orders' since the user just wants the text changed.
// We can just hardcode it or use t('dashboard.totalOrders'). Let's just use t('dashboard.orders') which exists in en.json!
// Actually, let's just replace t('dashboard.totalSales') with "Total Orders" in that specific StatsCard.
// Wait, to keep translation support, we'll replace t('dashboard.totalSales') with t('dashboard.totalOrders') in the file.
content = content.replace("title={t('dashboard.totalSales')}", "title={t('dashboard.totalOrders') || 'Total Orders'}");

fs.writeFileSync(file, content);
console.log('Patched DashboardPage.tsx successfully');

// Add to en.json
const enFile = path.join(__dirname, 'src', 'i18n', 'en.json');
let enContent = fs.readFileSync(enFile, 'utf8');
if (!enContent.includes('"totalOrders"')) {
    enContent = enContent.replace('"totalSales": "Total Sales",', '"totalSales": "Total Sales",\n    "totalOrders": "Total Orders",');
    fs.writeFileSync(enFile, enContent);
}

// Add to km.json
const kmFile = path.join(__dirname, 'src', 'i18n', 'km.json');
let kmContent = fs.readFileSync(kmFile, 'utf8');
if (!kmContent.includes('"totalOrders"')) {
    kmContent = kmContent.replace('"totalSales": "ការលក់សរុប",', '"totalSales": "ការលក់សរុប",\n    "totalOrders": "ការបញ្ជាទិញសរុប",');
    fs.writeFileSync(kmFile, kmContent);
}

