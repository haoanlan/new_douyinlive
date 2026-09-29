/**
 * 登录后对指定路由截全页图（改 UI 前后对比用）。
 * 用法：node scripts/page-shot.js <route> [outfile] [kw] [scopeText]
 *   route     如 douyin/search、douyin/profile/<secUid>
 *   kw        可选：先在信息查询页填关键词并点击查询
 *   scopeText 可选：先在信息查询页选中该直播间范围
 * 截图后会打印页面 hash 与正文前 160 字（截图读取错位时用它确认拍到的是哪页）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const FRONT = 'http://127.0.0.1:5173';
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
function findBrowser() { for (const c of BROWSERS) if (fs.existsSync(c)) return c; throw new Error('no browser'); }

async function main() {
  const route = process.argv[2] || 'douyin/search';
  const out = process.argv[3] || path.join(__dirname, '..', 'logs', `shot-${route.replace(/[\/\\]/g, '_')}.png`);
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 150)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 150)); });

  await page.goto(FRONT, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  const inputs = page.locator('.el-input__inner');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('123456');
  const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
  if (box) {
    const hx = box.x + 20, hy = box.y + box.height / 2;
    await page.mouse.move(hx, hy); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(hx + ((box.width - 40) * i) / 12, hy, { steps: 2 }); await page.waitForTimeout(20); }
    await page.mouse.up(); await page.waitForTimeout(300);
  }
  await page.locator('button:has-text("登录")').first().click().catch(() => {});
  for (let i = 0; i < 50; i++) {
    if (await page.evaluate(() => !!document.querySelector('.douyin-page'))) break;
    await page.waitForTimeout(200);
  }
  await page.goto(`${FRONT}/#/${route}`, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 50; i++) {
    if (await page.evaluate(() => !!document.querySelector('.douyin-page'))) break;
    await page.waitForTimeout(200);
  }
  for (let i = 0; i < 60; i++) {
    const gone = await page.evaluate(() => {
      const m = document.querySelector('.el-loading-mask');
      if (!m) return true;
      const cs = getComputedStyle(m);
      return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05;
    });
    if (gone) break;
    await page.waitForTimeout(200);
  }
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    if (n === 0) break;
    await page.waitForTimeout(150);
  }
  await page.mouse.move(4, 4);
  await page.waitForTimeout(1200);
  // 可选：先选「直播间范围」再查询（信息查询页用）。argv[5] = 范围选项文本
  const scope = process.argv[5];
  if (scope) {
    const sel = page.locator('.dy-query-hero .el-select').first();
    if (await sel.count()) {
      await sel.click();
      await page
        .locator('.el-select-dropdown__item:not(.is-hidden)', { hasText: scope })
        .first()
        .click();
      await page.waitForTimeout(400);
    }
  }
  // 可选：执行一次查询再截图（信息查询页用）
  const kw = process.argv[4];
  if (kw) {
    const searchInput = page.locator(
      '.dy-query-hero input[placeholder="输入昵称关键词，回车查询"]'
    );
    const n = await searchInput.count();
    console.log(`[dbg] input count=${n}`);
    if (n) {
      await searchInput.fill(kw);
      console.log(`[dbg] filled value=${await searchInput.inputValue()}`);
      const btn = page.locator('.dy-query-hero button:has-text("查询")').first();
      console.log(`[dbg] btn count=${await btn.count()}`);
      await btn.click();
      await page.waitForTimeout(6000);
      for (let i = 0; i < 30; i++) {
        const busy = await page.evaluate(() => !!document.querySelector('.el-loading-mask'));
        if (!busy) break;
        await page.waitForTimeout(300);
      }
      await page.mouse.move(4, 4);
      await page.waitForTimeout(600);
    }
  }
  await page.screenshot({ path: out, fullPage: true });
  const probe = await page.evaluate(() => ({
    url: location.hash,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160)
  }));
  console.log('截图:', out);
  console.log('页面状态:', JSON.stringify(probe));
  if (errors.length) console.log('控制台错误:', errors.slice(0, 5));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
