/**
 * 页面级 E2E 检查：登录后依次访问 总览/匿名查询/状态监控 等页面，
 * 记录每个页面的控制台报错、失败请求与 4xx/5xx，并截图。
 *
 * 用法: node scripts/e2e-pages-check.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';
const OUT = path.join(__dirname, '..', 'logs', 'e2e');
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

function findBrowser() {
  for (const c of BROWSERS) if (fs.existsSync(c)) return c;
  throw new Error('找不到 Chrome/Edge');
}

const PAGES = [
  { name: 'dashboard', hash: '#/douyin/dashboard', wait: 3500 },
  { name: 'search', hash: '#/douyin/search', wait: 1500, action: 'search' },
  { name: 'status', hash: '#/douyin/status', wait: 2500 },
  { name: 'rooms', hash: '#/douyin/rooms', wait: 2500 },
  { name: 'trends', hash: '#/douyin/trends', wait: 3000 }
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' });
  const page = await ctx.newPage();

  const errors = [];
  let current = 'boot';
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${current}] console.error: ${m.text().slice(0, 220)}`);
  });
  page.on('pageerror', (e) => errors.push(`[${current}] pageerror: ${e.message.slice(0, 220)}`));
  page.on('requestfailed', (r) =>
    errors.push(`[${current}] requestfailed: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`)
  );
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`[${current}] HTTP ${r.status()} ${r.url().slice(0, 140)}`);
  });

  // 登录
  current = 'login';
  await page.goto(FRONT, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  const inputs = page.locator('.el-input__inner');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('123456');
  const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
  if (box) {
    const hx = box.x + 20;
    const hy = box.y + box.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(hx + ((box.width - 40) * i) / 12, hy, { steps: 2 });
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  await page.locator('button:has-text("登录")').first().click().catch(() => {});
  await page.waitForTimeout(4000);
  console.log(`登录后 URL: ${page.url()}`);

  for (const p of PAGES) {
    current = p.name;
    await page.goto(`${FRONT}/${p.hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(p.wait);

    if (p.action === 'search') {
      const q = page.locator('input[placeholder*="昵称关键词"]').first();
      await q.fill('无限').catch(() => {});
      await page.locator('button:has-text("查询")').first().click().catch(() => {});
      await page.waitForTimeout(9000);
    }

    await page.screenshot({ path: path.join(OUT, `page-${p.name}.png`), fullPage: true });
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log(`\n[${p.name}] ${page.url()}`);
    console.log('  ' + text.slice(0, 420));
  }

  console.log('\n=== 页面错误汇总 ===');
  if (!errors.length) console.log('  无');
  errors.slice(0, 40).forEach((e) => console.log('  ' + e));
  console.log(`\n截图目录: ${OUT}`);

  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
}

main().catch((e) => { console.error('E2E 失败:', e.message); process.exitCode = 1; });
