/**
 * 视觉体检：量化页面构成（留白比例、字号层级、配色种类、对齐），
 * 用于在没有视觉反馈的情况下判断"哪里丑"。
 * 用法: node scripts/e2e-visual-metrics.js
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

const COLLECT = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const page = document.querySelector('.p-4') || document.body;
  const cards = [...document.querySelectorAll('.art-card')];
  const totalCardArea = cards.reduce((s, c) => {
    const r = c.getBoundingClientRect();
    return s + r.width * r.height;
  }, 0);
  const pageH = page.scrollHeight;
  const contentArea = vw * pageH;
  const fontSizes = {};
  const colors = {};
  document.querySelectorAll('h3, h4, p, span, div').forEach((el) => {
    const t = (el.innerText || '').trim();
    if (!t || el.children.length > 0) return;
    const cs = getComputedStyle(el);
    const fs2 = Math.round(parseFloat(cs.fontSize));
    fontSizes[fs2] = (fontSizes[fs2] || 0) + 1;
    const key = cs.color.replace(/\s/g, '');
    colors[key] = (colors[key] || 0) + 1;
  });
  return {
    viewport: { vw, vh },
    pageHeight: pageH,
    scrollRatio: +(pageH / vh).toFixed(2),
    cardCount: cards.length,
    cardAreaRatio: +(totalCardArea / contentArea).toFixed(2),
    cards: cards.map((c) => {
      const r = c.getBoundingClientRect();
      const title = c.querySelector('h4')?.innerText?.trim() || '-';
      return { title, w: Math.round(r.width), h: Math.round(r.height) };
    }),
    fontSizes: Object.entries(fontSizes).sort((a, b) => b[1] - a[1]).slice(0, 8),
    colorCount: Object.keys(colors).length,
    topColors: Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 8)
  };
};

async function main() {
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();

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

  for (const [name, hash, wait] of [
    ['总览（用户认可的风格基准）', '#/douyin/dashboard', 4000],
    ['状态监控（我重做的）', '#/douyin/status', 3000]
  ]) {
    await page.goto(`${FRONT}/${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(wait);
    const m = await page.evaluate(COLLECT);
    console.log(`\n===== ${name} =====`);
    console.log(`视口 ${m.viewport.vw}x${m.viewport.vh}，页面高 ${m.pageHeight}px（纵向滚动比 ${m.scrollRatio} 屏）`);
    console.log(`卡片数 ${m.cardCount}，卡片面积占比 ${(m.cardAreaRatio * 100).toFixed(0)}%`);
    console.log('卡片尺寸:');
    m.cards.forEach((c) => console.log(`   ${String(c.h).padStart(4)}px × ${String(c.w).padStart(4)}px  ${c.title}`));
    console.log(`字号种类 ${m.fontSizes.length}: ${m.fontSizes.map(([s, n]) => `${s}px×${n}`).join(', ')}`);
    console.log(`文字颜色种类 ${m.colorCount}`);
    console.log(`最多用的颜色: ${m.topColors.map(([c, n]) => `${c}×${n}`).join(', ')}`);
  }

  await browser.close();
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
