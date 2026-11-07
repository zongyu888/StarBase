import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/404/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

const log = (...args) => console.log(...args);
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });

// Expand demo tree
await page.locator('.tree-connection', { hasText: '示例数据库 · 电商' }).click();
await page.waitForSelector('.tree-db', { timeout: 15000 });
const mainDb = page.locator('.tree-db', { hasText: 'main' }).first();
await mainDb.click();
await page.waitForSelector('.tree-object', { timeout: 15000 });
await page.waitForTimeout(300);

// Open database context menu and create table through the UI
await mainDb.click({ button: 'right' });
await page.locator('.context-menu').getByRole('button', { name: '新建表' }).click();
const modal = page.locator('.modal-card');
await modal.waitFor();
await modal.getByPlaceholder('例如 orders').fill('ui_smoke_test');
const rows = modal.locator('.create-column-row');
log('initial create-table column rows:', await rows.count());
await rows.nth(1).locator('input').nth(0).fill('label');
await rows.nth(1).locator('input[type=checkbox]').nth(0).check();
await page.screenshot({ path: '../screenshots/08-create-table.png' });
await modal.getByRole('button', { name: '创建表' }).click();
await page.waitForSelector('.table-view', { timeout: 20000 });
await page.waitForSelector('.empty-state', { timeout: 15000 });
log('table created, empty state visible');
await page.screenshot({ path: '../screenshots/09-empty-table.png' });

// Add row
await page.locator('.data-toolbar').getByRole('button', { name: '新增行' }).click();
const rowModal = page.locator('.modal-card');
await rowModal.waitFor();
const labelField = rowModal.locator('.field').filter({ hasText: 'label' }).locator('input').first();
await labelField.fill('hello');
await rowModal.getByRole('button', { name: '插入' }).click();
await page.waitForSelector('.table-data-grid tbody tr', { timeout: 15000 });
log('row after insert:', await page.locator('.table-data-grid tbody tr').first().innerText());
await page.screenshot({ path: '../screenshots/10-row-added.png' });

// Inline edit
const editedCell = page.locator('.table-data-grid tbody tr td').filter({ hasText: /^hello$/ }).first();
await editedCell.dblclick();
await page.locator('.grid-cell-editor').fill('hello world');
await page.locator('.grid-cell-editor').press('Enter');
await page.waitForTimeout(600);
log('row after edit:', await page.locator('.table-data-grid tbody tr').first().innerText());

// Filter
await page.getByRole('button', { name: /筛选/ }).first().click();
await page.getByRole('button', { name: '添加条件' }).click();
const filterPanel = page.locator('.filter-panel');
await filterPanel.locator('.filter-row select').nth(0).selectOption({ label: 'label' });
await filterPanel.locator('.filter-row input').fill('hello world');
await page.getByRole('button', { name: '应用筛选' }).click();
await page.waitForTimeout(500);
log('filtered total text:', await page.locator('.table-total').innerText());
await page.screenshot({ path: '../screenshots/11-filtered.png' });

// Clear filter
await page.locator('.filter-panel').getByRole('button', { name: '清空' }).click();
await page.waitForTimeout(300);

// Select and delete row
await page.locator('.table-data-grid tbody tr input[type=checkbox]').first().check();
await page.getByRole('button', { name: /删除/ }).first().click();
const confirm = page.locator('.modal-card');
await confirm.getByRole('button', { name: '删除', exact: true }).click();
await page.waitForSelector('.empty-state', { timeout: 15000 });
log('row deleted');

// Design: add column
await page.getByRole('button', { name: '设计' }).click();
await page.getByRole('button', { name: '添加列' }).click();
const addModal = page.locator('.modal-card');
await addModal.locator('.field').filter({ hasText: '列名' }).locator('input').fill('note');
await addModal.locator('.field').filter({ hasText: '数据类型' }).locator('input').fill('TEXT');
await addModal.getByRole('button', { name: '添加列', exact: true }).click();
await page.waitForTimeout(700);
log('design rows after add column:', await page.locator('.design-table').first().locator('tbody tr').count());
await page.screenshot({ path: '../screenshots/12-design-added-column.png' });

// Switch back to query tab to ensure results persist
await page.locator('.editor-tab', { hasText: '示例查询' }).click().catch(() => {});
await page.waitForTimeout(300);
log('query tabs present:', await page.locator('.result-grid').count());

// Drop the smoke table via tree context menu
const smokeObject = page.locator('.tree-object', { hasText: 'ui_smoke_test' }).first();
await smokeObject.click({ button: 'right' });
await page.locator('.context-menu').getByRole('button', { name: '删除表' }).click();
const dropModal = page.locator('.modal-card');
await dropModal.getByRole('button', { name: '删除表', exact: true }).click();
await page.waitForTimeout(1000);
log('smoke object count after drop:', await page.locator('.tree-object', { hasText: 'ui_smoke_test' }).count());

// Light theme screenshot
await page.getByRole('button', { name: '切换主题' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: '../screenshots/13-light-theme.png' });
await page.getByRole('button', { name: '切换主题' }).click();

// Connection dialog smoke test (no save)
await page.locator('.new-connection-btn').click();
const connModal = page.locator('.modal-card');
await connModal.getByRole('button', { name: /SQLite/ }).click();
await connModal.getByPlaceholder('我的本地数据库').fill('UI 临时测试连接');
await connModal.getByPlaceholder(/demo.db|D:/).fill('smoke_test_conn.db');
await connModal.getByRole('button', { name: '测试连接' }).click();
await page.waitForTimeout(1200);
const testResult = await connModal.locator('.test-result').innerText().catch(() => 'NO_RESULT');
log('connection test result:', testResult.replace(/\n/g, ' | '));
await page.screenshot({ path: '../screenshots/14-connection-dialog.png' });
await connModal.getByRole('button', { name: '取消' }).click();

log('errors:', JSON.stringify(errors, null, 2));
await browser.close();
