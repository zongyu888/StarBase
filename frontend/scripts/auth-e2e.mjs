import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import net from 'node:net';

const baseUrl = process.env.NAVIDECK_URL || 'http://127.0.0.1:8621';
const launchOptions = { headless: true };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
  launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
} else if (!process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM) {
  launchOptions.channel = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
}

const dummyDb = net.createServer((socket) => socket.destroy());
await new Promise((resolve, reject) => dummyDb.listen(3399, '127.0.0.1', resolve).on('error', reject));

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

const step = (text) => console.log(`\n✓ ${text}`);
const runId = Date.now().toString(36).slice(-6);
const testUsername = `user_${runId}`;
const testEmail = `${testUsername}@example.com`;
const authField = (text) => page.locator('.auth-field').filter({ hasText: text });
const devCodeIn = async (text) => {
  const hint = authField(text).locator('.auth-dev-code').first();
  await hint.waitFor({ timeout: 10000 });
  return (await hint.innerText()).replace(/^.*?：/, '').trim();
};

async function login(login, password) {
  await page.getByLabel('用户名或邮箱').fill(login);
  await page.getByLabel('密码', { exact: true }).fill(password);
  const captcha = await devCodeIn('图形验证码');
  await page.getByLabel('图形验证码').fill(captcha);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

async function logout() {
  await page.locator('.user-chip').click();
  await page.locator('.dropdown-menu').getByRole('button', { name: '退出登录' }).click();
  await page.locator('.auth-card').waitFor({ timeout: 10000 });
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('.auth-card').waitFor();
  assert.match(await page.locator('.auth-card').innerText(), /登录 Navideck/);
  await page.screenshot({ path: '../screenshots/auth-login.png' });
  step('未登录时显示登录页，API 受保护');

  await login('admin', 'Admin@12345');
  await page.locator('.app-shell').waitFor({ timeout: 15000 });
  await page.locator('.tree-connection').first().waitFor({ timeout: 15000 });
  assert.match(await page.locator('.user-chip').innerText(), /管理员/);
  let connections = await page.evaluate(async () => (await (await fetch('/api/connections')).json()).connections);
  assert.equal(connections.length, 1);
  assert.equal(connections[0].name, '示例数据库 · 电商');
  const adminDial = await page.evaluate(async () => {
    const response = await fetch('/api/connections/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dummy', driver: 'mysql', host: '127.0.0.1', port: 3399, username: 'root', password: 'x', database: 'mysql' }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(adminDial.status, 200);
  assert.equal(adminDial.body.ok, false);
  assert.doesNotMatch(adminDial.body.message || '', /安全隔离/);
  step('管理员连接本机端口可通过安全拨号器（非隔离拦截）');

  await logout();
  step('退出登录回到认证页');

  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByLabel('用户名', { exact: true }).fill(testUsername);
  await page.getByLabel('显示名称（可选）').fill('普通用户一');
  await authField('邮箱').first().locator('input').fill(testEmail);
  await page.getByRole('button', { name: '发送验证码' }).click();
  const emailCode = await devCodeIn('邮箱验证码');
  assert.equal(emailCode.length, 6);
  await page.getByLabel('邮箱验证码').fill(emailCode);
  await page.getByLabel('密码', { exact: true }).fill('User@12345');
  await page.getByLabel('确认密码').fill('User@12345');
  const registerCaptcha = await devCodeIn('图形验证码');
  await page.getByLabel('图形验证码').fill(registerCaptcha);
  await page.getByRole('button', { name: '注册并登录' }).click();
  await page.locator('.app-shell').waitFor({ timeout: 15000 });
  assert.match(await page.locator('.user-chip').innerText(), /用户/);
  connections = await page.evaluate(async () => (await (await fetch('/api/connections')).json()).connections);
  assert.equal(connections.length, 1);
  assert.ok(connections[0].sqlitePath.startsWith('users/'), '新用户应拿到个人沙箱示例库');
  step('邮箱验证码注册成功，并获得个人示例库');

  await page.locator('.new-connection-btn').click();
  const modal = page.locator('.modal-card');
  await modal.waitFor();
  assert.match(await modal.locator('.connection-security-note').innerText(), /普通用户/);
  assert.equal(await modal.locator('.driver-option').count(), 8, '普通用户不应看到 SQLite 新建入口');
  assert.equal(await modal.getByLabel('主机').getAttribute('placeholder'), 'db.example.com');
  await modal.getByLabel('连接名称').fill('本机 MySQL');
  await modal.getByLabel('主机').fill('127.0.0.1');
  await modal.getByLabel('端口').fill('3306');
  await modal.getByLabel('用户名').fill('root');
  await modal.getByLabel('密码').fill('secret');
  await modal.getByLabel('数据库').first().fill('mysql');
  await modal.getByRole('button', { name: '测试连接' }).click();
  const testResult = modal.locator('.test-result');
  await testResult.waitFor({ timeout: 15000 });
  assert.match(await testResult.innerText(), /安全隔离/);
  await page.screenshot({ path: '../screenshots/auth-connection-isolation.png' });
  step('普通用户连接 127.0.0.1 被明确拒绝');
  await modal.locator('.modal-footer').getByRole('button', { name: '取消' }).click();

  const foreignStatus = await page.evaluate(async () => (await fetch('/api/connections/demo/databases')).status);
  assert.equal(foreignStatus, 404, '普通用户不能访问管理员的连接');
  const sqliteEscape = await page.evaluate(async () => {
    const response = await fetch('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'escape', driver: 'sqlite', sqlitePath: '../secret.key' }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(sqliteEscape.status, 403);
  assert.match(sqliteEscape.body.error, /沙箱|安全隔离/);
  step('越权访问与 SQLite 路径逃逸均被拒绝');

  await logout();
  await login('admin', 'Admin@12345');
  await page.locator('.app-shell').waitFor({ timeout: 15000 });
  await page.locator('.user-chip').click();
  await page.locator('.dropdown-menu').getByRole('button', { name: '用户管理' }).click();
  const usersModal = page.locator('.modal-card', { hasText: '用户管理' });
  await usersModal.waitFor();
  await usersModal.locator('.admin-users-table tbody tr').first().waitFor();
  assert.ok((await usersModal.locator('.admin-users-table tbody tr').count()) >= 2);
  const userRow = usersModal.locator('.admin-users-table tbody tr', { hasText: testUsername });
  await userRow.getByTitle('禁用账号').click();
  await page.waitForTimeout(500);
  assert.match(await userRow.innerText(), /已禁用/);
  await userRow.getByTitle('启用账号').click();
  await page.waitForTimeout(500);
  assert.match(await userRow.innerText(), /正常/);
  await page.screenshot({ path: '../screenshots/admin-users.png' });
  step('管理员可查看、禁用和启用用户');
  await usersModal.locator('.modal-footer').getByRole('button', { name: '关闭' }).click();

  await logout();
  const anonymousStatus = await page.evaluate(async () => (await fetch('/api/connections')).status);
  assert.equal(anonymousStatus, 401);
  step('退出后 API 立即恢复 401');

  assert.deepEqual(pageErrors, [], `页面错误:\n${pageErrors.join('\n')}`);
  console.log('\n认证与隔离端到端验证通过。');
  if (consoleErrors.length) {
    console.log('浏览器控制台错误（可能包含预期的 401/403 请求）:', consoleErrors);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => dummyDb.close(resolve));
}
