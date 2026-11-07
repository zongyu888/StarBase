import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/404/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.screenshot({ path: '../screenshots/welcome-1440.png' });
console.log('title:', await page.title());
console.log('h1:', await page.locator('h1').innerText());
console.log('errors:', JSON.stringify(errors, null, 2));
await browser.close();
