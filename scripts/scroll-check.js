/**
 * 滚动条一致性检查（常驻）
 *   遍历每个页面的所有可滚动容器，报出它们的 computed
 *   scrollbar-width / scrollbar-color（Chromium 121+ 支持这两个属性的计算值），
 *   并检查是否**全部一致**；同时读根节点的滑块变量（浅色/深色）。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'team', 'shots');
const BASE = process.env.CHECK_BASE || 'http://127.0.0.1:9871';
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((c) => fs.existsSync(c));

const PAGES = [
  ['总览', '/#/douyin/dashboard'],
  ['房间管理', '/#/douyin/rooms'],
  ['趋势分析', '/#/douyin/trends'],
  ['状态监控', '/#/douyin/status'],
  ['用户画像', '/#/douyin/profile/MS4wLjABAAAAV0ix862LmB3foIAiEkC9sLh9aHlWjw_mXHI24ckprsw'],
  ['场次详情', '/#/douyin/detail/153']
];

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

const scan = (page) =>
  page.evaluate(() => {
    const styles = new Map();
    let count = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) continue;
      if (el.scrollHeight <= el.clientHeight + 2 && el.scrollWidth <= el.clientWidth + 2) continue;
      count++;
      const key = `${cs.scrollbarWidth} | ${cs.scrollbarColor}`;
      if (!styles.has(key)) {
        styles.set(key, {
          样例: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''),
          宽: el.clientWidth,
          高: el.clientHeight
        });
      }
    }
    return {
      可滚动容器数: count,
      不同的滚动条样式: [...styles.entries()].map(([k, v]) => ({ 样式: k, ...v })),
      根滑块变量: getComputedStyle(document.documentElement).getPropertyValue('--dy-scrollbar-thumb').trim(),
      根滑块悬停: getComputedStyle(document.documentElement).getPropertyValue('--dy-scrollbar-thumb-hover').trim()
    };
  });

const waitApp = async (page, url) => {
  for (let i = 0; i < 8; i++) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    if (await page.evaluate(() => !!document.querySelector('.douyin-page') || !!document.querySelector('.el-input__inner'))) return true;
  }
  return false;
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await waitApp(page, BASE);
  if ((await page.locator('.el-input__inner').count()) >= 2) {
    await page.locator('.el-input__inner').nth(0).fill('admin');
    await page.locator('.el-input__inner').nth(1).fill('123456');
    await drag(page);
    await page.locator('button:has-text("登录")').first().click();
    await page.waitForTimeout(7000);
  }
  let allSame = true;
  for (const [name, hash] of PAGES) {
    await waitApp(page, BASE + '/?sc=' + Date.now() + hash);
    await page.waitForTimeout(4800);
    const r = await scan(page);
    const styles = r.不同的滚动条样式.map((s) => s.样式);
    if (styles.length > 1) allSame = false;
    console.log(
      `${name.padEnd(5)} 可滚动容器 ${String(r.可滚动容器数).padStart(2)} · 样式种类 ${styles.length} ${styles.length > 1 ? '✗' : '✓'} · 滑块变量 ${r.根滑块变量}`
    );
    for (const s of r.不同的滚动条样式.slice(0, 3)) console.log(`        ${s.样式}  ← ${s.样例} (${s.宽}×${s.高})`);
  }
  console.log(allSame ? '\n===== 每个页面内滚动条样式唯一（跨页同款）=====' : '\n===== 仍有多种滚动条样式 ✗ =====');
  await page.screenshot({ path: path.join(OUT, 'scrollbar-check.png'), clip: { x: 300, y: 100, width: 1140, height: 700 } });
  await b.close();
})();
