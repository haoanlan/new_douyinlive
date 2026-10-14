/**
 * 临时：过渡最终验证
 *   判据（两个都要满足）：
 *     ① 任何一帧都**不能**出现"所有页面视图都不透明"（=两页交叠）
 *     ② 任何一帧都**不能**出现"视图半透明"（=白纱）
 *   即：每帧恰好一个视图、且它完全不透明。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:5173';
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((c) => fs.existsSync(c));

const drag = async (page) => {
  for (let a = 0; a < 4; a++) {
    const box = await page.locator('.drag_verify').first().boundingBox().catch(() => null);
    if (!box) return;
    const hx = box.x + 10, hy = box.y + box.height / 2;
    await page.mouse.move(hx, hy); await page.mouse.down();
    await page.waitForTimeout(120);
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(hx + ((box.width - 20) * i) / 24, hy + (i % 3 === 0 ? 1 : 0), { steps: 3 });
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(900);
    if (await page.evaluate(() => /验证成功/.test(document.body.innerText))) return;
  }
};

const install = (page) =>
  page.evaluate(() => {
    window.__s = [];
    window.__t = performance.now();
    const tick = () => {
      if (performance.now() - window.__t > 2200) return;
      window.__s.push([...document.querySelectorAll('.art-page-view')].map((v) => Number(getComputedStyle(v).opacity).toFixed(2)));
      setTimeout(tick, 40);
    };
    tick();
  });

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('.el-input__inner').nth(0).fill('admin');
  await page.locator('.el-input__inner').nth(1).fill('123456');
  await drag(page);
  await page.locator('button:has-text("登录")').first().click();
  await page.waitForTimeout(8000);

  const routePairs = [
    ['总览 → 房间管理', '#/douyin/dashboard', '#/douyin/rooms'],
    ['房间管理 → 场次详情', '#/douyin/rooms', '#/douyin/detail/153'],
    ['详情 → 总览', '#/douyin/detail/153', '#/douyin/dashboard'],
    ['总览 → 信息查询', '#/douyin/dashboard', '#/douyin/search']
  ];
  let bad = 0;
  for (const [name, from, to] of routePairs) {
    await page.goto(`${BASE}/${from}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    await install(page);
    await page.evaluate((h) => { location.hash = h; }, to);
    await page.waitForTimeout(2600);
    const s = await page.evaluate(() => window.__s);
    // 只看真正处于切换中的帧（视图数 >= 1 且发生过变化）
    const twoViews = s.filter((r) => r.length >= 2 && r.every((o) => Number(o) >= 0.95));
    const translucent = s.filter((r) => r.some((o) => Number(o) < 0.95 && Number(o) > 0.01));
    const ok = twoViews.length === 0 && translucent.length === 0;
    if (!ok) bad++;
    console.log(
      `${ok ? '✓' : '✗'} ${name.padEnd(18)} 采样 ${s.length} · 两页交叠帧 ${twoViews.length} · 半透明帧 ${translucent.length}` +
        (ok ? '' : `  例: ${JSON.stringify([...twoViews, ...translucent].slice(0, 2))}`)
    );
  }
  console.log(bad === 0 ? '\n===== 过渡检查：全部通过（既无白纱，也无交叠）=====' : `\n===== ${bad} 个切换仍有问题 =====`);
  await b.close();
})();
