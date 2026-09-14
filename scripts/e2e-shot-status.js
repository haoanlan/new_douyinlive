/**
 * 单独截取状态监控页（全页 + 首屏），用于视觉检查。
 * 用法: node scripts/e2e-shot-status.js [--clip]
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  // 用常见笔记本宽度，更接近真实观感
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();

  await page.goto(FRONT, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
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
  }
  await page.locator('button:has-text("登录")').first().click().catch(() => {});
  await page.waitForTimeout(3500);

  // 关掉右侧设置抽屉的浮动提示，避免干扰
  for (const [name, hash, wait] of [
    ['watch-status', '#/douyin/status', 3200],
    ['watch-dashboard', '#/douyin/dashboard', 4200]
  ]) {
    await page.goto(`${FRONT}/${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(OUT, `${name}-fold.png`), fullPage: false });
    await page.screenshot({ path: path.join(OUT, `${name}-full.png`), fullPage: true });
    console.log(`${name}: 已截图（首屏 + 全页）`);
  }

  await browser.close();
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
