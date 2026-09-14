/**
 * 逐元素校验工具条对齐：外层控件（开关框/按钮）与内层小控件（开关轨道）的
 * 位置、尺寸、圆角、内边距，确认视觉上是否真的齐平。
 * 用法: node scripts/e2e-toolbar-align.js
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

async function main() {
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

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

  await page.goto(`${FRONT}/#/douyin/status`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const detail = await page.evaluate(() => {
    const pick = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        h: +r.height.toFixed(1),
        w: +r.width.toFixed(1),
        top: +r.top.toFixed(1),
        bottom: +r.bottom.toFixed(1),
        radius: cs.borderRadius,
        padding: cs.padding,
        border: cs.borderTopWidth,
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12)
      };
    };
    const bar = document.querySelector('.art-card.dy-toolbar');
    const actions = bar.querySelector('.dy-toolbar-actions');
    const kids = [...actions.children];
    const out = [];
    kids.forEach((el, i) => {
      out.push({ level: 'outer', i, tag: el.tagName.toLowerCase(), ...pick(el) });
      const inner = el.querySelector('.el-switch');
      if (inner) out.push({ level: 'inner', i, tag: 'el-switch', ...pick(inner) });
    });
    return { barH: +bar.getBoundingClientRect().height.toFixed(1), out };
  });

  console.log(`工具条高度 ${detail.barH}px\n`);
  detail.out.forEach((o) => {
    console.log(
      `${o.level === 'outer' ? '【外层】' : '  └ 内层'} ${o.tag.padEnd(9)} 高=${String(o.h).padStart(5)} 宽=${String(o.w).padStart(6)} top=${String(o.top).padStart(6)} bottom=${String(o.bottom).padStart(6)} radius=${o.radius} border=${o.border}  "${o.text}"`
    );
  });

  const outers = detail.out.filter((o) => o.level === 'outer');
  const heights = outers.map((o) => o.h);
  const tops = outers.map((o) => o.top);
  const bottoms = outers.map((o) => o.bottom);
  const radii = [...new Set(outers.map((o) => o.radius))];
  console.log(`\n外层控件高度:  ${JSON.stringify(heights)}  ${new Set(heights).size === 1 ? '✓ 一致' : '✗ 不一致'}`);
  console.log(`外层控件 top:   ${JSON.stringify(tops)}  ${new Set(tops).size === 1 ? '✓ 齐平' : '✗ 不齐'}`);
  console.log(`外层控件 bottom:${JSON.stringify(bottoms)}  ${new Set(bottoms).size === 1 ? '✓ 齐平' : '✗ 不齐'}`);
  console.log(`外层控件圆角:   ${JSON.stringify(radii)}  ${radii.length === 1 ? '✓ 统一' : '✗ 不统一'}`);

  await browser.close();
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1; });
