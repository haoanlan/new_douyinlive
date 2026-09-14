/**
 * 真浏览器端到端自检：用本机已装的 Chrome 跑一遍登录流程，抓控制台错误与失败请求。
 *
 * 用法: node scripts/e2e-login-check.js
 * 环境变量: CHROME_PATH 可覆盖浏览器路径; CHECK_FRONT 覆盖前端地址
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';
const OUT = path.join(__dirname, '..', 'logs', 'e2e');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

function findBrowser() {
  for (const c of CHROME_CANDIDATES) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('找不到可用的 Chrome/Edge 可执行文件');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();

  const consoleMsgs = [];
  const failedReqs = [];
  const responses = [];

  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) consoleMsgs.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => failedReqs.push(`${r.method()} ${r.url()} -> ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/') || r.status() >= 400) responses.push(`${r.status()} ${r.request().method()} ${u}`);
  });

  console.log(`打开 ${FRONT}`);
  await page.goto(FRONT, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  console.log(`当前 URL: ${page.url()}`);
  await page.screenshot({ path: path.join(OUT, '1-login.png'), fullPage: true });

  // 登录表单
  const inputs = page.locator('.el-input__inner');
  const inputCount = await inputs.count();
  console.log(`输入框数量: ${inputCount}`);
  if (inputCount >= 2) {
    await inputs.nth(0).fill('admin');
    await inputs.nth(1).fill('123456');
  }

  // 拖拽验证：按住滑块拖到最右
  const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
  if (box) {
    const hx = box.x + 20;
    const hy = box.y + box.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(hx + ((box.width - 40) * i) / steps, hy, { steps: 2 });
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    console.log('已执行拖拽验证');
  } else {
    console.log('未找到拖拽组件（可能是隐藏的）');
  }
  await page.screenshot({ path: path.join(OUT, '2-before-submit.png'), fullPage: true });

  // 点登录
  await page.locator('button:has-text("登录")').first().click().catch(() => {});
  await page.waitForTimeout(4000);
  console.log(`登录后 URL: ${page.url()}`);
  await page.screenshot({ path: path.join(OUT, '3-after-login.png'), fullPage: true });

  // 页面可见文案
  const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\n{2,}/g, '\n').trim();
  console.log('\n--- 页面可见文案（前 600 字） ---');
  console.log(bodyText.slice(0, 600));

  // 是否有错误页
  const is500 = /服务器出错|500/.test(bodyText);
  const is404 = /页面不存在|404/.test(bodyText);
  console.log(`\n疑似 500 错误页: ${is500}`);
  console.log(`疑似 404 错误页: ${is404}`);

  console.log('\n--- /api 请求及 4xx/5xx 响应 ---');
  responses.slice(0, 30).forEach((r) => console.log('  ' + r));

  console.log('\n--- 失败请求 ---');
  failedReqs.slice(0, 20).forEach((r) => console.log('  ' + r));

  console.log('\n--- 控制台 error/warning ---');
  consoleMsgs.slice(0, 30).forEach((r) => console.log('  ' + r));

  await browser.close();
  console.log(`\n截图已保存到 ${OUT}`);
}

main().catch((e) => { console.error('E2E 失败:', e.message); process.exitCode = 1; });
