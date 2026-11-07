import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/404/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.locator('.tree-connection', { hasText: '示例数据库 · 电商' }).click();
await page.waitForSelector('.tree-db', { timeout: 15000 });
await page.locator('.tree-db', { hasText: 'main' }).first().click();
await page.waitForSelector('.tree-object', { timeout: 15000 });
await page.locator('.tree-object', { hasText: 'ui_import_test' }).first().click();
await page.waitForSelector('.table-view', { timeout: 15000 });
await page.waitForTimeout(500);
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('.data-toolbar').getByRole('button', { name: '导入', exact: true }).click(),
]);
await chooser.setFiles('C:/Users/404/Documents/Qoder/2026-10-27/15ba3bae/test-import.csv');
const confirm = page.locator('.modal-card');
await confirm.waitFor();
console.log('confirm text:', (await confirm.innerText()).replace(/\n/g, ' | ').slice(0, 300));
await confirm.getByRole('button', { name: '开始导入' }).click();
await page.waitForSelector('.table-data-grid tbody tr', { timeout: 15000 });
await page.waitForTimeout(600);
console.log('imported row count:', await page.locator('.table-data-grid tbody tr').count());
console.log('grid text:', (await page.locator('.table-data-grid').innerText()).replace(/\n/g, ' | ').slice(0, 300));
console.log('toast:', await page.locator('.toast-success').last().innerText().catch(() => 'NO_TOAST'));
await page.screenshot({ path: '../screenshots/20-import-success.png' });
console.log('errors:', JSON.stringify(errors, null, 2));
await browser.close();
