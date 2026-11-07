import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const prefix = fileURLToPath(new URL('../../screenshots/', import.meta.url));
const baseUrl = process.env.NAVIDECK_URL || 'http://127.0.0.1:8621';
const launchOptions = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
  launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
} else if (!process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM) {
  launchOptions.channel = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
}
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: `${prefix}hero-dark.png` });

await page.getByRole('button', { name: '打开示例数据库' }).click();
await page.waitForSelector('.cm-content', { timeout: 15000 });
await page.getByRole('button', { name: '运行', exact: true }).click();
await page.waitForSelector('.result-grid', { timeout: 15000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${prefix}query-results.png` });

await page.locator('.tree-connection', { hasText: '示例数据库 · 电商' }).click();
await page.waitForSelector('.tree-db', { timeout: 15000 });
await page.locator('.tree-db', { hasText: 'main' }).first().click();
await page.waitForSelector('.tree-object', { timeout: 15000 });
await page.locator('.tree-object', { hasText: 'orders' }).first().click();
await page.waitForSelector('.table-data-grid tbody tr', { timeout: 15000 });
await page.waitForTimeout(700);
await page.screenshot({ path: `${prefix}data-grid.png` });

await page.getByRole('button', { name: '结构' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${prefix}structure.png` });

await page.getByRole('button', { name: '设计' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${prefix}design.png` });

await page.getByRole('button', { name: '数据' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '导入', exact: true }).click();
await page.waitForSelector('.modal-card', { timeout: 5000 });
await page.locator('.modal-card input[type=file]').setInputFiles({
  name: 'orders-sample.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from('customer_id,order_no,status,total\n1,SO-DEMO-9001,已完成,99.5\n2,SO-DEMO-9002,待付款,268.0\n', 'utf8'),
});
await page.waitForSelector('.import-mapping-table', { timeout: 5000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${prefix}import-mapping.png` });
await page.locator('.modal-card').getByRole('button', { name: '取消' }).click();

await page.locator('.editor-tab', { hasText: '开始' }).click();
await page.getByRole('button', { name: '切换主题' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${prefix}light.png` });

await page.getByRole('button', { name: '切换主题' }).click();
await page.locator('.new-connection-btn').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${prefix}connection-dialog.png` });
await page.locator('.modal-card').getByRole('button', { name: '取消' }).click();

await page.locator('.editor-tab', { hasText: '示例查询' }).click();
await page.getByRole('button', { name: '查询收藏（保存 / 载入常用 SQL）' }).click();
await page.waitForSelector('.modal-card', { timeout: 5000 });
await page.getByRole('button', { name: '收藏当前 SQL' }).click();
await page.waitForSelector('.favorite-item', { timeout: 5000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${prefix}query-favorites.png` });

console.log('errors:', JSON.stringify(errors, null, 2));
await browser.close();
