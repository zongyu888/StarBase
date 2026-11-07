import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const baseUrl = process.env.NAVIDECK_URL || 'http://127.0.0.1:8620';
const launchOptions = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
  launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
} else if (!process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM) {
  launchOptions.channel = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
}

const setupSql = `DROP TABLE IF EXISTS grid_feature_test;
CREATE TABLE grid_feature_test (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note LONGTEXT,
  payload BLOB,
  due DATE,
  flag BOOLEAN DEFAULT 0,
  price REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO grid_feature_test (name, note, payload, due, flag, price) VALUES
('Alpha', '这是第一行的大文本内容，用来测试大文本编辑器。', X'89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6360000000020001E221BC330000000049454E44AE426082', '2026-11-01', 1, 12.5),
('Beta', '第二行', NULL, '2026-12-15', 0, 99.9);
DELETE FROM customers WHERE email = 'batch.edit@example.com';
UPDATE customers SET phone = '13800001001' WHERE id = 1;`;

async function runSql(sql) {
  const response = await fetch(`${baseUrl}/api/connections/demo/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ database: 'main', schema: 'main', sql, maxRows: 100 }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function fetchRows() {
  const response = await fetch(
    `${baseUrl}/api/connections/demo/table/rows?database=main&schema=main&table=customers&page=1&pageSize=500`,
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

await runSql(setupSql);

const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

const step = (message) => console.log(`\n✓ ${message}`);
const active = page.locator('.tab-pane.active');
const grid = active.locator('.table-data-grid');
const toolbar = active.locator('.data-toolbar');
const bulk = active.locator('.bulk-edit-bar');
const cell = (row, column) => grid.locator('tbody tr').nth(row).locator(`td[data-column="${column}"]`);

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '打开示例数据库' }).click().catch(() => {});
  await page.waitForTimeout(400);
  if ((await page.locator('.tree-db').count()) === 0) {
    await page.locator('.tree-connection', { hasText: '示例数据库 · 电商' }).click();
  }
  await page.waitForSelector('.tree-db', { timeout: 15000 });
  const mainDb = page.locator('.tree-db', { hasText: 'main' }).first();
  if ((await page.locator('.tree-object').count()) === 0) await mainDb.click();
  await page.waitForSelector('.tree-object', { timeout: 15000 });
  await page.locator('.tree-object', { hasText: 'customers' }).first().click();
  await page.waitForSelector('.table-view', { timeout: 15000 });
  await grid.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
  step('打开 customers 数据网格');

  // 1. 单元格编辑 + 暂存
  await cell(0, 'phone').dblclick();
  const phoneEditor = active.locator('td[data-column="phone"] .grid-cell-editor');
  await phoneEditor.waitFor();
  await phoneEditor.fill('13911112222');
  await phoneEditor.press('Enter');
  await page.waitForTimeout(300);
  assert.match(await bulk.innerText(), /1 处未保存/);
  assert.equal(await cell(0, 'phone').evaluate((element) => element.classList.contains('cell-pending')), true);
  step('单元格编辑进入待保存状态');

  // 2. 直接输入开始编辑
  await cell(1, 'country').click();
  await page.keyboard.type('US', { delay: 90 });
  const countryEditor = active.locator('td[data-column="country"] .grid-cell-editor');
  await countryEditor.waitFor();
  assert.equal(await countryEditor.inputValue(), 'US');
  await countryEditor.press('Enter');
  await page.waitForTimeout(250);
  assert.match(await bulk.innerText(), /2 处修改/);
  step('键盘直接输入进入编辑');

  // 3. 区域粘贴（随后放弃，避免污染真实数据）
  await page.evaluate(() => navigator.clipboard.writeText('粘贴甲\t中国\n粘贴乙\t美国'));
  await cell(2, 'name').click();
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(350);
  if ((await page.locator('.paste-textarea').count()) > 0) {
    await page.locator('.paste-textarea').fill('粘贴甲\t中国\n粘贴乙\t美国');
    await page.getByRole('button', { name: '解析并粘贴' }).click();
    await page.waitForTimeout(300);
  }
  const pendingText = await bulk.innerText();
  assert.match(pendingText, /6 处修改/);
  step('剪贴板粘贴生成 4 处待保存修改');

  await bulk.getByRole('button', { name: '放弃' }).click();
  await page.locator('.modal-card').getByRole('button', { name: '放弃修改' }).click();
  await bulk.waitFor({ state: 'detached' });
  step('放弃全部未保存修改');

  // 重新做一组要保存的修改
  await cell(0, 'phone').dblclick();
  await active.locator('td[data-column="phone"] .grid-cell-editor').fill('13911112222');
  await active.locator('td[data-column="phone"] .grid-cell-editor').press('Enter');
  await page.waitForTimeout(200);

  // 4. 新增草稿行
  await toolbar.getByRole('button', { name: '新增行' }).click();
  await grid.locator('tbody tr.row-draft').first().waitFor({ timeout: 5000 });
  const draft = grid.locator('tbody tr.row-draft').last();
  await draft.locator('td[data-column="name"]').dblclick();
  await active.locator('td[data-column="name"] .grid-cell-editor').fill('批量编辑测试');
  await active.locator('td[data-column="name"] .grid-cell-editor').press('Enter');
  await page.waitForTimeout(150);
  await draft.locator('td[data-column="email"]').dblclick();
  await active.locator('td[data-column="email"] .grid-cell-editor').fill('batch.edit@example.com');
  await active.locator('td[data-column="email"] .grid-cell-editor').press('Enter');
  await page.waitForTimeout(200);
  assert.equal(await grid.locator('tbody tr.row-draft').count(), 1);
  step('新增草稿行并填写必填字段');

  // 5. 复制行（触发唯一键冲突，验证后撤回草稿）
  await grid.locator('tbody tr').first().locator('input[type=checkbox]').check();
  await toolbar.getByRole('button', { name: '复制行' }).click();
  await page.waitForTimeout(250);
  assert.equal(await grid.locator('tbody tr.row-draft').count(), 2);
  await toolbar.getByRole('button', { name: /删除/ }).click();
  await page.waitForTimeout(250);
  assert.equal(await grid.locator('tbody tr.row-draft').count(), 1);
  step('复制选中行为草稿并可移除');

  // 6. 行详情抽屉
  await grid.locator('tbody tr').first().locator('td.row-number-cell').dblclick();
  const drawer = page.locator('.row-drawer');
  await drawer.waitFor();
  assert.match(await drawer.innerText(), /第 1 行/);
  assert.equal(await drawer.locator('.drawer-field').count(), 7);
  await page.screenshot({ path: '../screenshots/grid-editor-detail.png' });
  await drawer.locator('.row-drawer-foot').getByRole('button', { name: '关闭' }).click();
  await drawer.waitFor({ state: 'detached' });
  step('行详情抽屉打开并显示全部字段');

  // 7. 列宽拖拽
  const nameHeader = active.locator('th[data-column="name"]');
  const beforeWidth = (await nameHeader.boundingBox()).width;
  const resizeHandle = active.locator('th[data-column="name"] .col-resize');
  const handleBox = await resizeHandle.boundingBox();
  await page.mouse.move(handleBox.x + 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 62, handleBox.y + handleBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterWidth = (await nameHeader.boundingBox()).width;
  assert.ok(afterWidth > beforeWidth + 30, `列宽应增加：${beforeWidth} -> ${afterWidth}`);
  step(`列宽拖拽生效：${Math.round(beforeWidth)}px → ${Math.round(afterWidth)}px`);

  // 8. 隐藏/显示列
  await page.getByRole('button', { name: /^列/ }).click();
  const panel = page.locator('.columns-panel');
  await panel.waitFor();
  const createdAtItem = panel.locator('.columns-panel-item', { hasText: 'created_at' });
  await createdAtItem.locator('input').uncheck();
  await page.waitForTimeout(200);
  assert.equal(await active.locator('th[data-column="created_at"]').count(), 0);
  await createdAtItem.locator('input').check();
  await page.waitForTimeout(200);
  assert.equal(await active.locator('th[data-column="created_at"]').count(), 1);
  await page.mouse.click(600, 300);
  step('列显示/隐藏切换生效');

  // 9. Ctrl+S 保存批量修改
  await page.screenshot({ path: '../screenshots/grid-editor-pending.png' });
  await page.keyboard.press('Control+S');
  try {
    await bulk.waitFor({ state: 'detached', timeout: 15000 });
  } catch (error) {
    console.log('保存失败提示:', await page.locator('.toast').allInnerTexts());
    throw error;
  }
  await page.waitForTimeout(1200);
  let rowsData = await fetchRows();
  assert.equal(rowsData.total, 25);
  const saved = rowsData.rows.find((row) => row[2] === 'batch.edit@example.com');
  assert.ok(saved, '新增行应写入数据库');
  const phoneRow = rowsData.rows.find((row) => row[0] === 1);
  assert.equal(phoneRow[3], '13911112222');
  step('Ctrl+S 批量保存成功：更新 1 行、新增 1 行');

  // 10. 暂存删除新增行
  const newRow = grid.locator('tbody tr').filter({ hasText: 'batch.edit@example.com' }).first();
  await newRow.locator('input[type=checkbox]').check();
  await toolbar.getByRole('button', { name: /删除/ }).click();
  await page.waitForTimeout(200);
  assert.equal(await newRow.evaluate((element) => element.classList.contains('row-deleted')), true);
  await page.screenshot({ path: '../screenshots/grid-editor-staged-delete.png' });
  await bulk.getByRole('button', { name: '保存', exact: true }).click();
  await bulk.waitFor({ state: 'detached', timeout: 15000 });
  await page.waitForTimeout(900);
  rowsData = await fetchRows();
  assert.equal(rowsData.total, 24);
  assert.equal(rowsData.rows.some((row) => row[2] === 'batch.edit@example.com'), false);
  step('暂存删除保存成功');
  await page.screenshot({ path: '../screenshots/grid-editor-saved.png' });

  // 11. 类型感知编辑器 + 二进制查看 + 大文本
  await page.locator('.tree-object', { hasText: 'grid_feature_test' }).first().click();
  await page.waitForFunction(
    () => document.querySelector('.tab-pane.active .object-title h2')?.textContent?.includes('grid_feature_test'),
    null,
    { timeout: 15000 },
  );
  await grid.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(400);

  const blobCell = cell(0, 'payload');
  assert.match(await blobCell.innerText(), /BLOB/);
  await blobCell.dblclick();
  const blobModal = page.locator('.modal-card', { hasText: '查看 payload' });
  await blobModal.waitFor();
  await blobModal.locator('.blob-preview img').waitFor();
  const imageSrc = await blobModal.locator('.blob-preview img').getAttribute('src');
  assert.match(imageSrc, /^data:image\/png;base64,/);
  await page.screenshot({ path: '../screenshots/grid-editor-blob.png' });
  await blobModal.locator('.modal-footer').getByRole('button', { name: '关闭' }).click();
  step('BLOB 图片预览与十六进制查看可用');

  await cell(0, 'note').dblclick();
  const largeEditor = page.locator('.large-text-editor');
  await largeEditor.waitFor();
  assert.match(await largeEditor.inputValue(), /大文本内容/);
  await largeEditor.fill('这是第一行的大文本内容，用来测试大文本编辑器。已修改。');
  await page.getByRole('button', { name: '应用' }).click();
  await page.waitForTimeout(250);
  assert.equal(await cell(0, 'note').evaluate((element) => element.classList.contains('cell-pending')), true);
  step('大文本编辑器可修改并暂存');

  await cell(0, 'due').dblclick();
  const dateEditor = active.locator('td[data-column="due"] input[type="date"]');
  await dateEditor.waitFor();
  assert.equal(await dateEditor.inputValue(), '2026-11-01');
  await dateEditor.press('Escape');
  step('DATE 列使用日期选择器');

  await cell(0, 'flag').dblclick();
  const booleanEditor = active.locator('td[data-column="flag"] select.grid-cell-editor');
  await booleanEditor.waitFor();
  assert.deepEqual(await booleanEditor.locator('option').allTextContents(), ['NULL', 'true', 'false']);
  await booleanEditor.press('Escape');
  step('BOOLEAN 列使用 true/false 下拉');

  await bulk.getByRole('button', { name: '放弃' }).click();
  await page.locator('.modal-card').getByRole('button', { name: '放弃修改' }).click();
  await bulk.waitFor({ state: 'detached' });
  step('清理类型测试的暂存修改');

  assert.deepEqual(errors, [], `浏览器错误：\n${errors.join('\n')}`);
  console.log('\n全部端到端验证通过。');
} finally {
  try {
    await runSql(`DROP TABLE IF EXISTS grid_feature_test;
DELETE FROM customers WHERE email = 'batch.edit@example.com';
UPDATE customers SET phone = '13800001001' WHERE id = 1;`);
  } catch (error) {
    console.log('清理测试数据失败:', error.message);
  }
  await browser.close();
}
