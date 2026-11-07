import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/404/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
const log = (...args) => console.log(...args);
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '打开示例数据库' }).click();
await page.waitForSelector('.cm-content', { timeout: 15000 });
await page.waitForTimeout(300);
await page.screenshot({ path: '../screenshots/15-editor-theme.png' });

const editor = page.locator('.cm-content');
await editor.click();
await page.keyboard.press('Control+A');
await page.keyboard.insertText(`SELECT c.country, COUNT(*) AS customers
FROM customers c
GROUP BY c.country
ORDER BY customers DESC;

SELECT status, COUNT(*) AS cnt
FROM orders
GROUP BY status;`);
await page.waitForTimeout(200);
await page.keyboard.press('Control+Enter');
await page.waitForSelector('.result-grid', { timeout: 15000 });
await page.waitForTimeout(400);
log('result tabs:', await page.locator('.result-tab').allInnerTexts());
await page.screenshot({ path: '../screenshots/16-multi-results.png' });

await page.getByRole('button', { name: /消息/ }).click();
await page.waitForTimeout(200);
log('messages:', (await page.locator('.messages-panel').innerText()).slice(0, 200));
await page.screenshot({ path: '../screenshots/17-messages.png' });

// Invalid SQL error path
await editor.click();
await page.keyboard.press('Control+A');
await page.keyboard.insertText('SELECT * FROM table_that_does_not_exist;');
await page.getByRole('button', { name: '运行', exact: true }).click();
await page.waitForSelector('.message-item.has-error', { timeout: 15000 });
await page.waitForTimeout(300);
log('error visible:', await page.locator('.message-error').innerText());
await page.screenshot({ path: '../screenshots/18-query-error.png' });

// Pagination: open order_items (96 rows)
await page.locator('.tree-connection', { hasText: '示例数据库 · 电商' }).click();
await page.waitForSelector('.tree-db', { timeout: 15000 });
await page.locator('.tree-db', { hasText: 'main' }).first().click();
await page.waitForSelector('.tree-object', { timeout: 15000 });
await page.locator('.tree-object', { hasText: 'order_items' }).first().click();
await page.waitForSelector('.table-data-grid tbody tr', { timeout: 15000 });
await page.locator('.pagination-actions select').selectOption('50');
await page.waitForTimeout(600);
log('page indicator:', await page.locator('.page-indicator').innerText());
const firstRowNumber = await page.locator('.table-data-grid tbody tr .row-number-cell').first().innerText();
await page.getByTitle('下一页').click();
await page.waitForTimeout(500);
log('after next page indicator:', await page.locator('.page-indicator').innerText());
log('page 2 first row number:', await page.locator('.table-data-grid tbody tr .row-number-cell').first().innerText());
log('page 1 first row number:', firstRowNumber);
await page.screenshot({ path: '../screenshots/19-pagination.png' });

// Create and delete a temporary connection
await page.locator('.new-connection-btn').click();
const connModal = page.locator('.modal-card');
await connModal.getByRole('button', { name: /SQLite/ }).click();
await connModal.getByPlaceholder('我的本地数据库').fill('UI 测试连接');
await connModal.getByPlaceholder(/demo.db|D:/).fill('ui_conn_test.db');
await connModal.getByRole('button', { name: '保存并连接' }).click();
await page.waitForTimeout(1200);
const tempConn = page.locator('.tree-connection', { hasText: 'UI 测试连接' });
log('temp connection rows:', await tempConn.count());
await tempConn.click({ button: 'right' });
await page.locator('.context-menu').getByRole('button', { name: '删除连接' }).click();
const delModal = page.locator('.modal-card');
await delModal.getByRole('button', { name: '删除连接', exact: true }).click();
await page.waitForTimeout(900);
log('temp connection after delete:', await page.locator('.tree-connection', { hasText: 'UI 测试连接' }).count());
log('errors:', JSON.stringify(errors, null, 2));
await browser.close();
