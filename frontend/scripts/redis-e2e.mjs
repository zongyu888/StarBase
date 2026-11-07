// 前置条件：本机 Redis 测试实例 127.0.0.1:6380（已写入 user:1 / app:config 等示例键），
// 以及一个关闭认证、监听 8630 的 Navideck 后端；连接名默认为 Local Redis 6380。
// 可用 NAVIDECK_TEST_URL / REDIS_CONNECTION_NAME / CHROME_PATH / REDIS_SHOT_DIR 覆盖。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.NAVIDECK_TEST_URL || 'http://127.0.0.1:8630';
const CONNECTION_NAME = process.env.REDIS_CONNECTION_NAME || 'Local Redis 6380';
const CHROME_PATH = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT_DIR = process.env.REDIS_SHOT_DIR || 'C:/Users/mouji/Desktop/线上navicat/screenshots';

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME_PATH,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

const shot = async (name) => {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
};

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.app-shell');

const connectionRow = page.locator('.tree-row', { hasText: CONNECTION_NAME }).first();
await connectionRow.click({ button: 'right' });
await page.locator('.menu-item', { hasText: '打开 Redis 工作台' }).click();
await page.waitForSelector('.redis-workspace');
await page.waitForSelector('.redis-status-card');
await page.waitForTimeout(900);
const serverText = await page.locator('.redis-status-card').first().innerText();
assert.match(serverText, /Redis 版本/);
assert.match(serverText, /7\.4\.0/);
assert.match(serverText, /CYGWIN/);
console.log('dashboard ok');
await shot('redis-dashboard');

await page.locator('.redis-search-row input').fill('user');
await page.waitForTimeout(900);
const keyRows = await page.locator('.redis-tree-key').allTextContents();
assert.ok(keyRows.some((text) => text.includes('1')), `expected user:1 key, got ${keyRows}`);
console.log('search keys:', keyRows);

await page.locator('.redis-tree-key').filter({ hasText: '1' }).first().click();
await page.waitForSelector('.redis-type-badge');
await page.waitForTimeout(500);
assert.equal((await page.locator('.redis-type-badge').innerText()).trim(), 'Hash');
const hashText = await page.locator('.redis-value-table').innerText();
assert.match(hashText, /name/);
assert.match(hashText, /Alice/);
assert.match(hashText, /city/);
console.log('hash detail ok');
await shot('redis-key-detail');

const ageRow = page.locator('.redis-value-row', { hasText: 'age' }).first();
await ageRow.locator('button[title="编辑"]').click();
await page.waitForSelector('.modal-card');
const modal = page.locator('.modal-card');
const valueBox = modal.locator('textarea');
await valueBox.fill('31');
await modal.locator('.modal-footer .btn-primary').click();
await page.waitForSelector('.modal-card', { state: 'detached' });
await page.waitForTimeout(700);
assert.match(await page.locator('.redis-value-table').innerText(), /31/);
console.log('hash edit ok');

await page.locator('.redis-value-actions button', { hasText: '添加' }).click();
await page.waitForSelector('.modal-card');
const addModal = page.locator('.modal-card');
await addModal.locator('input').fill('country');
await addModal.locator('textarea').fill('CN');
await addModal.locator('.modal-footer .btn-primary').click();
await page.waitForSelector('.modal-card', { state: 'detached' });
await page.waitForTimeout(700);
assert.match(await page.locator('.redis-value-table').innerText(), /country/);
console.log('hash add ok');

const ttlInput = page.locator('.redis-ttl-control input');
await ttlInput.fill('120');
await page.locator('.redis-ttl-control button').first().click();
await page.waitForTimeout(800);
assert.match(await page.locator('.redis-detail-meta').innerText(), /TTL 2 分钟/);
await page.locator('.redis-ttl-control button', { hasText: '永久' }).click();
await page.waitForTimeout(700);
assert.match(await page.locator('.redis-detail-meta').innerText(), /TTL 永久/);
console.log('ttl ok');
await shot('redis-key-detail-ttl');

await page.locator('.redis-search-row input').fill('app:config');
await page.waitForTimeout(900);
await page.locator('.redis-tree-key', { hasText: 'config' }).first().click();
await page.waitForSelector('.redis-string-editor');
const stringEditor = page.locator('.redis-string-editor');
assert.match(await stringEditor.inputValue(), /"env"/);
await stringEditor.fill('{"env":"prod","debug":true,"region":"cn"}');
await page.locator('.redis-value-actions button', { hasText: '保存' }).click();
await page.waitForTimeout(900);
assert.match(await stringEditor.inputValue(), /region/);
console.log('string save ok');

await page.locator('.redis-toolbar-actions button', { hasText: 'CLI' }).click();
await page.waitForSelector('.redis-cli');
const cliInput = page.locator('.redis-cli-input input');
await cliInput.fill('GET app:config');
await cliInput.press('Enter');
await page.waitForTimeout(900);
const cliOutput = await page.locator('.redis-cli-output').innerText();
assert.match(cliOutput, /region/);
console.log('cli ok');
await shot('redis-cli');

await page.locator('.redis-toolbar-actions button', { hasText: '新建键' }).click();
await page.waitForSelector('.modal-card');
const newKeyModal = page.locator('.modal-card');
await newKeyModal.locator('input').first().fill('demo:redis:new');
await newKeyModal.locator('textarea').fill('hello redis');
await newKeyModal.locator('.modal-footer .btn-primary').click();
await page.waitForSelector('.modal-card', { state: 'detached' });
await page.waitForTimeout(900);
await page.locator('.redis-search-row input').fill('demo:redis');
await page.waitForTimeout(900);
const newKeyRows = await page.locator('.redis-tree-key').allTextContents();
assert.ok(newKeyRows.some((text) => text.includes('new')), `expected new key, got ${newKeyRows}`);
console.log('new key ok');

await page.locator('.redis-cli-input input').fill('DEL demo:redis:new');
await page.locator('.redis-cli-input input').press('Enter');
await page.waitForTimeout(500);

await page.locator('.redis-search-row input').fill('');
await page.locator('.redis-toolbar-actions button', { hasText: 'CLI' }).click();
await page.waitForTimeout(600);
await shot('redis-workspace-final');

console.log('console errors:', errors);
assert.deepEqual(errors, []);
await browser.close();
console.log('REDIS E2E PASSED');
