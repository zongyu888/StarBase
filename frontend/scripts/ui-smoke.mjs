import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.NAVIDECK_UI_BASE || 'http://127.0.0.1:5173';
const shotPath = process.env.NAVIDECK_UI_SHOT || '../docs/chroma-workspace.png';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const bodyText = await page.textContent('body');
  assert(bodyText.includes('连接'), '主界面已渲染');

  const connectionRow = page.locator('.tree-connection', { hasText: 'Chroma Mock' }).first();
  await connectionRow.waitFor({ state: 'visible', timeout: 10000 });
  await connectionRow.click();
  await page.waitForTimeout(1200);

  const databaseRow = page.locator('.tree-db', { hasText: 'default_database' }).first();
  await databaseRow.waitFor({ state: 'visible', timeout: 10000 });
  await databaseRow.click();
  await page.waitForTimeout(1200);

  const collectionRow = page.locator('.tree-object', { hasText: 'products' }).first();
  await collectionRow.waitFor({ state: 'visible', timeout: 10000 });
  await collectionRow.click();
  await page.waitForTimeout(1500);

  await page.waitForSelector('.chroma-workspace', { timeout: 10000 });
  assert(true, 'Chroma 工作台已打开');

  const activeCollection = await page.locator('.chroma-collection-item.active').textContent();
  assert((activeCollection ?? '').includes('products'), '集合 products 已选中');

  const documentsText = await page.locator('.chroma-documents').textContent();
  assert(documentsText.includes('机械键盘'), '文档内容已加载');

  const toolbarText = await page.locator('.chroma-toolbar').textContent();
  assert(toolbarText.includes('Chroma'), '工具栏显示 Chroma 版本/信息');

  await page.getByRole('button', { name: '搜索' }).click();
  await page.waitForSelector('.chroma-search', { timeout: 5000 });
  await page.locator('.chroma-search textarea').first().fill('[0.1, 0.2, 0.3]');
  await page.getByRole('button', { name: '执行搜索' }).click();
  await page.waitForSelector('.chroma-search-results', { timeout: 10000 });
  const searchText = await page.locator('.chroma-search-results').textContent();
  assert(searchText.includes('机械键盘'), '向量搜索结果已返回');
  await page.getByRole('button', { name: '关闭' }).last().click();
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: '详情', exact: true }).click();
  await page.waitForSelector('.chroma-details', { timeout: 5000 });
  const detailsText = await page.locator('.chroma-details').textContent();
  assert(detailsText.includes('cosine'), '集合详情显示 HNSW 距离度量');
  await page.getByRole('button', { name: '关闭' }).last().click();
  await page.waitForTimeout(400);

  mkdirSync('../docs', { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log(`✓ 截图已保存: ${shotPath}`);

  if (consoleErrors.length > 0) {
    console.log('浏览器控制台错误:');
    consoleErrors.forEach((item) => console.log(`  - ${item}`));
    throw new Error('页面存在控制台错误');
  }
  console.log('UI 冒烟测试通过');
} finally {
  await browser.close();
}