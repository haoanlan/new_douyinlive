/**
 * 离线图标检查（常驻）
 *   拦截所有 iconify CDN 请求（模拟内网/被墙），然后统计页面上图标的渲染情况：
 *     每个 <svg> 是否有 path（有 = 画出来了，无 = 空白图标）
 *   再对比"不拦截"的情况。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'team', 'shots');
const BASE = process.env.CHECK_BASE || 'http://127.0.0.1:9871';
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((c) => fs.existsSync(c));
const CDN = /api\.(iconify\.design|simplesvg\.com|unisvg\.com)/;

const drag = async (page) => {
  for (let a = 0; a < 4; a++) {
    const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
    if (!box) return;
    const hx = box.x + 10, hy = box.y + box.height / 2;
    await page.mouse.move(hx, hy); await page.mouse.down();
    await page.waitForTimeout(110);
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(hx + ((box.width - 20) * i) / 24, hy, { steps: 2 });
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(220);
    await page.mouse.up();
    await page.waitForTimeout(900);
    if (await page.evaluate(() => /验证成功/.test(document.body.innerText))) return;
  }
};

const iconStats = (page) =>
  page.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg')].filter((s) => s.getBoundingClientRect().width > 0);
    let withPath = 0;
    const empty = [];
    for (const s of svgs) {
      const n = s.querySelectorAll('path, circle, rect, g, polygon, polyline, line').length;
      if (n > 0) withPath++;
      else empty.push((s.parentElement?.className || '').toString().slice(0, 40));
    }
    return { svg总数: svgs.length, 有图形: withPath, 空白: empty.length, 空白样例: [...new Set(empty)].slice(0, 4) };
  });

const run = async (b, blockCdn) => {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const cdnHits = [];
  if (blockCdn) {
    await page.route(CDN, (route) => {
      cdnHits.push(route.request().url());
      route.abort();
    });
  }
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  if ((await page.locator('.el-input__inner').count()) >= 2) {
    await page.locator('.el-input__inner').nth(0).fill('admin');
    await page.locator('.el-input__inner').nth(1).fill('123456');
    await drag(page);
    await page.locator('button:has-text("登录")').first().click();
    await page.waitForTimeout(8000);
  }
  await page.goto(BASE + '/?ic=' + Date.now() + '#/douyin/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const stats = await iconStats(page);
  const title = await page.title();
  await page.screenshot({ path: path.join(OUT, blockCdn ? 'icons-offline.png' : 'icons-online.png'), clip: { x: 0, y: 0, width: 420, height: 700 } });
  await page.close();
  return { 拦截CDN: blockCdn, 被拦请求数: cdnHits.length, 标题: title, ...stats };
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  console.log('A) 拦截 CDN（模拟内网）:', JSON.stringify(await run(b, true)));
  console.log('B) 不拦截:', JSON.stringify(await run(b, false)));
  await b.close();
})();
