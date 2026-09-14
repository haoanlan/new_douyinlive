/**
 * 尺寸一致性体检：逐页收集「同一行内并排卡片」的高度，报告不一致的组。
 * 用法: node scripts/e2e-size-audit.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const FRONT = process.env.CHECK_FRONT || 'http://127.0.0.1:5173';
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
  { name: 'dashboard', hash: '#/douyin/dashboard' },
  { name: 'status', hash: '#/douyin/status' },
  { name: 'search', hash: '#/douyin/search' },
  { name: 'rooms', hash: '#/douyin/rooms' },
  { name: 'trends', hash: '#/douyin/trends' }
];

/** 在页面里找出「同一水平行（top 接近）内并排的 art-card」，比较高度 */
const COLLECT = () => {
  const cards = [...document.querySelectorAll('.art-card')].map((el, i) => {
    const r = el.getBoundingClientRect();
    return { i, top: Math.round(r.top), left: Math.round(r.left), h: Math.round(r.height), w: Math.round(r.width) };
  });
  const groups = [];
  for (const c of cards) {
    // 同一行：top 差异 <= 4px
    let g = groups.find((x) => Math.abs(x.top - c.top) <= 4);
    if (!g) { g = { top: c.top, items: [] }; groups.push(g); }
    g.items.push(c);
  }
  return groups
    .filter((g) => g.items.length > 1)
    .map((g) => ({
      top: g.top,
      heights: g.items.map((x) => x.h),
      widths: g.items.map((x) => x.w),
      consistent: new Set(g.items.map((x) => x.h)).size === 1
    }));
};

async function main() {
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

  // 登录
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
  }
  await page.locator('button:has-text("登录")').first().click().catch(() => {});
  await page.waitForTimeout(3500);

  let bad = 0;
  for (const p of PAGES) {
    await page.goto(`${FRONT}/${p.hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(p.name === 'dashboard' ? 4000 : 2500);
    const groups = await page.evaluate(COLLECT);
    console.log(`\n[${p.name}] 同行卡片组 ${groups.length} 个`);
    for (const g of groups) {
      if (!g.consistent) {
        bad++;
        console.log(`  ✗ top=${g.top} 高度不一致: ${g.heights.join(' / ')}  (宽度 ${g.widths.join(' / ')})`);
      } else {
        console.log(`  ✓ top=${g.top} 高度一致: ${g.heights[0]} ×${g.heights.length}`);
      }
    }
  }

  await browser.close();
  console.log(bad === 0 ? '\n所有同行卡片高度一致' : `\n发现 ${bad} 组高度不一致`);
  process.exitCode = bad ? 1 : 0;
}

main().catch((e) => { console.error('体检失败:', e.message); process.exitCode = 1; });
