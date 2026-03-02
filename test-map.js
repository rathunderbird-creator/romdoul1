import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log('Browser Error:', msg.text());
        }
    });

    page.on('pageerror', err => {
        console.log('Uncaught Error:', err.message);
    });

    console.log("Setting up authentication...");
    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
        localStorage.setItem('currentUser', JSON.stringify({
            id: 'admin', name: 'Admin', roleId: 'admin', pin: '1234'
        }));
    });

    console.log("Navigating to shipping location...");
    await page.goto('http://localhost:5173/shipping-location', { waitUntil: 'networkidle' });

    await page.waitForTimeout(5000);

    console.log("Checking if map canvas exists...");
    const canvas = await page.$('.maplibregl-canvas');
    if (canvas) {
        console.log("SUCCESS: Map canvas found!");
    } else {
        console.log("FAILURE: Map canvas not found.");
    }

    await browser.close();
})();
