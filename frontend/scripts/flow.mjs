import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/404/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '打开示例数据库' }).click();
await page.waitForSelector('.query-view', { timeout: 15000 });
await page.getByRole('button', { name: '运行', exact: true }).click();
await page.waitForSelector('.result-grid', { timeout: 20000 });
await page.waitForTimeout(500);
console.log('result rows:', await page.locator('.result-grid tbody tr').count());
console.log('result text:', (await page.locator('.result-grid').innerText()).slice(0, 300));
await page.screenshot({ path: '../screenshots/02-query-results.png' });

const demoRow = page.locator('.tree-connection', { hasText: '示例数据库 · 电商' });
await demoRow.click();
await page.waitForSelector('.tree-db', { timeout: 15000 });
const mainDb = page.locator('.tree-db', { hasText: 'main' }).first();
await mainDb.click();
await page.waitForSelector('.tree-object', { timeout: 15000 });
await page.waitForTimeout(400);
await page.screenshot({ path: '../screenshots/03-tree.png' });
console.log('objects:', await page.locator('.tree-object').allInnerTexts());

const orders = page.locator('.tree-object', { hasText: 'orders' }).first();
await orders.click();
await page.waitForSelector('.table-view', { timeout: 15000 });
await page.waitForSelector('.table-data-grid tbody tr', { timeout: 15000 });
await page.waitForTimeout(500);
console.log('table row count:', await page.locator('.table-data-grid tbody tr').count());
console.log('table title:', await page.locator('.object-title-text h2').innerText());
await page.screenshot({ path: '../screenshots/04-table-data.png' });

await page.getByRole('button', { name: '结构' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: '../screenshots/05-table-structure.png' });
await page.getByRole('button', { name: /DDL/ }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: '../screenshots/06-table-ddl.png' });
await page.getByRole('button', { name: '设计' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: '../screenshots/07-table-design.png' });

console.log('errors:', JSON.stringify(errors, null, 2));
await browser.close();
